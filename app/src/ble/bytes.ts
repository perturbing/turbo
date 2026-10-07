export function toDataView(data: ArrayBuffer | ArrayBufferView): DataView {
  if (data instanceof ArrayBuffer) return new DataView(data);
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

export function u8(view: DataView, offset: number): number {
  return view.getUint8(offset);
}

export function u16le(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

export function i16le(view: DataView, offset: number): number {
  return view.getInt16(offset, true);
}

export function u24le(view: DataView, offset: number): number {
  return view.getUint16(offset, true) + (view.getUint8(offset + 2) << 16);
}

export function u32le(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

export function hex(data: ArrayBuffer | ArrayBufferView): string {
  const view = toDataView(data);
  let out = '';
  for (let i = 0; i < view.byteLength; i++) out += view.getUint8(i).toString(16).padStart(2, '0');
  return out;
}

export function fromHex(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
