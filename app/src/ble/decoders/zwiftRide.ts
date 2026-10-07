// Zwift Ride controller protocol. Message framing: byte 0 = message type,
// remaining bytes = protobuf wire-format payload (decoded schema-less).

export const RIDE_MSG = {
  controllerState: 0x23,
  battery: 0x19,
  idleTick: 0x15,
  handshakeInfo: 0x2a,
  deviceInfo: 0xff,
} as const;

export const RIDE_HANDSHAKE = new TextEncoder().encode('RideOn');

export function isRideOnAck(data: Uint8Array): boolean {
  if (data.byteLength < RIDE_HANDSHAKE.byteLength) return false;
  return RIDE_HANDSHAKE.every((b, i) => data[i] === b);
}

// Empirically verified 2026-09-18 on firmware 1.3.0 (both pods). The Ride is
// TWO BLE devices, one per pod, sharing one bit layout; each pod reports only
// its own buttons. Bitmap is INVERTED: 0 = pressed, idle = 0xFFFFFFFF.
// NOTE: differs from published community enums (Z there = 0x100); this
// firmware uses contiguous bits with Z = 0x80.
export const RIDE_BUTTONS = [
  'DPad_Left',
  'DPad_Up',
  'DPad_Right',
  'DPad_Down',
  'A',
  'B',
  'Y',
  'Z',
  'Shift_L_Top',
  'Shift_L_Bottom',
  'Shift_L_Extra',
  'Power_L',
  'Shift_R_Top',
  'Shift_R_Bottom',
  'Shift_R_Extra',
  'Power_R',
] as const;

export type RideButton = (typeof RIDE_BUTTONS)[number];

// Analog levers (message field 3, entries {1: location, 2: zigzag value}):
//   loc 0 = left lever:  steer left = -100 .. 0 .. +100 = brake
//   loc 1 = right lever: brake      = -100 .. 0 .. +100 = steer right
export const RIDE_ANALOG: Record<number, string> = { 0: 'Lever_L', 1: 'Lever_R' };

export type ProtoValue = number | ProtoMessage | ProtoValue[];
export interface ProtoMessage {
  [field: number]: ProtoValue;
}

export function zigzag(n: number): number {
  return (n >>> 1) ^ -(n & 1);
}

// Minimal schema-less protobuf wire-format reader: wire types 0 (varint),
// 1 (64-bit), 2 (length-delimited, recursed when it parses), 5 (32-bit).
// Repeated fields collapse into arrays. Returns null on malformed input.
export function parseProtobuf(data: Uint8Array): ProtoMessage | null {
  const msg: ProtoMessage = {};
  let off = 0;

  const readVarint = (): number | null => {
    let shift = 0;
    let value = 0;
    while (off < data.byteLength) {
      const b = data[off++];
      value += (b & 0x7f) * 2 ** shift; // avoid 32-bit overflow for 5-byte varints
      if (!(b & 0x80)) return value;
      shift += 7;
      if (shift > 63) return null;
    }
    return null;
  };

  while (off < data.byteLength) {
    const tag = readVarint();
    if (tag === null) return null;
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    let value: ProtoValue;
    if (wire === 0) {
      const v = readVarint();
      if (v === null) return null;
      value = v;
    } else if (wire === 1) {
      if (off + 8 > data.byteLength) return null;
      value = Number(new DataView(data.buffer, data.byteOffset + off, 8).getBigUint64(0, true));
      off += 8;
    } else if (wire === 5) {
      if (off + 4 > data.byteLength) return null;
      value = new DataView(data.buffer, data.byteOffset + off, 4).getUint32(0, true);
      off += 4;
    } else if (wire === 2) {
      const len = readVarint();
      if (len === null || off + len > data.byteLength) return null;
      const chunk = data.subarray(off, off + len);
      off += len;
      value = parseProtobuf(chunk) ?? (chunk.byteLength as ProtoValue);
    } else {
      return null;
    }
    const existing = msg[field];
    if (existing === undefined) msg[field] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else msg[field] = [existing, value];
  }
  return msg;
}

export interface RideControllerState {
  pressed: RideButton[];
  analog: Record<string, number>;
}

// Decodes a 0x23 controller notification payload (the full message including
// the leading type byte). Shape: {1: u32 inverted button bitmap,
// 3: [{1: location, 2: zigzag analog}]}. Entries with zero value are omitted
// by the pod, so an empty analog map means "all levers centred".
export function decodeRideNotification(data: Uint8Array): RideControllerState {
  const msg = parseProtobuf(data.subarray(1));
  const bitmap = typeof msg?.[1] === 'number' ? (msg[1] as number) : 0xffffffff;
  const pressed: RideButton[] = [];
  for (let bit = 0; bit < RIDE_BUTTONS.length; bit++) {
    if (!((bitmap >>> bit) & 1)) pressed.push(RIDE_BUTTONS[bit]);
  }
  const analog: Record<string, number> = {};
  const rawGroups = msg?.[3];
  const groups = Array.isArray(rawGroups) ? rawGroups : rawGroups !== undefined ? [rawGroups] : [];
  for (const g of groups) {
    if (typeof g !== 'object' || Array.isArray(g)) continue;
    const loc = typeof g[1] === 'number' ? g[1] : 0;
    const raw = typeof g[2] === 'number' ? g[2] : 0;
    if (raw !== 0) analog[RIDE_ANALOG[loc] ?? `loc${loc}`] = zigzag(raw);
  }
  return { pressed, analog };
}

// Merges per-pod analog lever states. The left pod mirrors the right pod's
// state but not vice versa, so frames disagree while a lever is held (the
// non-owning pod reports 0). Per lever, the reading with the largest magnitude
// wins — the owning pod's live value — which stops the merged value flickering
// between 0 and the pressed level.
export function mergeAnalog(perPod: Record<string, number>[]): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const levers of perPod) {
    for (const [name, value] of Object.entries(levers)) {
      if (merged[name] === undefined || Math.abs(value) > Math.abs(merged[name])) {
        merged[name] = value;
      }
    }
  }
  return merged;
}

// Battery message 0x19: protobuf {2: percent}.
export function decodeRideBattery(data: Uint8Array): number | null {
  const msg = parseProtobuf(data.subarray(1));
  return typeof msg?.[2] === 'number' ? (msg[2] as number) : null;
}
