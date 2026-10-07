import { toDataView, u16le } from '../bytes';

export const FTMS_OPCODE = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetResistance: 0x04,
  setTargetPower: 0x05,
  startResume: 0x07,
  stopPause: 0x08,
  setIndoorBikeSimulation: 0x11,
} as const;

export type FtmsResult =
  | 'success'
  | 'not_supported'
  | 'invalid_parameter'
  | 'operation_failed'
  | 'control_not_permitted'
  | 'unknown';

const FTMS_RESULT: Record<number, FtmsResult> = {
  0x01: 'success',
  0x02: 'not_supported',
  0x03: 'invalid_parameter',
  0x04: 'operation_failed',
  0x05: 'control_not_permitted',
};

export function buildRequestControl(): Uint8Array {
  return Uint8Array.of(FTMS_OPCODE.requestControl);
}

export function buildReset(): Uint8Array {
  return Uint8Array.of(FTMS_OPCODE.reset);
}

export function buildSetTargetPower(watts: number): Uint8Array {
  const buf = new Uint8Array(3);
  const v = new DataView(buf.buffer);
  v.setUint8(0, FTMS_OPCODE.setTargetPower);
  v.setInt16(1, Math.round(watts), true);
  return buf;
}

// FTMS Resistance Level has 0.1 resolution: the KICKR's supported range of raw
// 0..100 means levels 0.0–10.0, NOT percent. Never exercised on real hardware —
// provisional. `level` is in FTMS units (tenths), i.e. level 5.0 -> raw 50.
export function buildSetTargetResistance(levelTenths: number): Uint8Array {
  const clamped = Math.max(0, Math.min(100, Math.round(levelTenths)));
  return Uint8Array.of(FTMS_OPCODE.setTargetResistance, clamped);
}

export interface SimulationParams {
  windMps?: number;
  gradePct?: number;
  crr?: number; // rolling resistance coefficient, default 0.004
  cw?: number; // wind resistance coefficient kg/m, default 0.51
}

export function buildSetSimulation(params: SimulationParams): Uint8Array {
  const { windMps = 0, gradePct = 0, crr = 0.004, cw = 0.51 } = params;
  const buf = new Uint8Array(7);
  const v = new DataView(buf.buffer);
  v.setUint8(0, FTMS_OPCODE.setIndoorBikeSimulation);
  v.setInt16(1, Math.round(windMps * 1000), true); // 0.001 m/s
  v.setInt16(3, Math.round(gradePct * 100), true); // 0.01 %
  v.setUint8(5, Math.round(crr * 20000)); // 0.00005
  v.setUint8(6, Math.round(cw * 100)); // 0.01 kg/m
  return buf;
}

export interface FtmsAck {
  requestOpcode: number;
  result: FtmsResult;
}

// Control point acks arrive as indications on 0x2AD9: 0x80, request opcode, result.
export function parseFtmsAck(data: ArrayBuffer | ArrayBufferView): FtmsAck | null {
  const v = toDataView(data);
  if (v.byteLength < 3 || v.getUint8(0) !== 0x80) return null;
  return {
    requestOpcode: v.getUint8(1),
    result: FTMS_RESULT[v.getUint8(2)] ?? 'unknown',
  };
}

export interface Range {
  min: number;
  max: number;
  increment: number;
}

// Supported Power Range (0x2AD8) / Supported Resistance Level Range (0x2AD6):
// i16 min, i16 max, u16 increment.
export function parseRange(data: ArrayBuffer | ArrayBufferView): Range {
  const v = toDataView(data);
  return { min: v.getInt16(0, true), max: v.getInt16(2, true), increment: u16le(v, 4) };
}
