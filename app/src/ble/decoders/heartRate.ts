import { toDataView, u16le } from '../bytes';

export interface HeartRateSample {
  hrBpm: number;
  rrIntervalsS?: number[];
}

// Heart Rate Measurement (0x2A37): flags bit0 = 16-bit bpm, bit3 = energy
// expended present (u16, skipped), bit4 = RR intervals (u16 each, 1/1024 s).
export function parseHeartRate(data: ArrayBuffer | ArrayBufferView): HeartRateSample {
  const v = toDataView(data);
  const flags = v.getUint8(0);
  let off: number;
  let bpm: number;
  if (flags & 0x01) {
    bpm = u16le(v, 1);
    off = 3;
  } else {
    bpm = v.getUint8(1);
    off = 2;
  }
  const out: HeartRateSample = { hrBpm: bpm };
  if (flags & 0x08) off += 2;
  if (flags & 0x10) {
    const rr: number[] = [];
    while (off + 1 < v.byteLength) {
      rr.push(u16le(v, off) / 1024);
      off += 2;
    }
    out.rrIntervalsS = rr;
  }
  return out;
}
