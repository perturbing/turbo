import { i16le, toDataView, u16le, u24le } from '../bytes';

export interface IndoorBikeDataSample {
  speedKmh?: number;
  cadenceRpm?: number;
  distanceM?: number;
  resistance?: number;
  powerW?: number;
  hrBpm?: number;
  elapsedS?: number;
}

// FTMS Indoor Bike Data (0x2AD2). The KICKR always sends flags 0x0044 (8 bytes):
// instantaneous speed + cadence + power at ~1 Hz.
//
// FTMS quirk: bit0 is "More Data" and is INVERTED — instantaneous speed is
// present when bit0 is CLEAR. Cadence is in 0.5 rpm units, speed in 0.01 km/h.
export function parseIndoorBikeData(data: ArrayBuffer | ArrayBufferView): IndoorBikeDataSample {
  const v = toDataView(data);
  const flags = u16le(v, 0);
  const out: IndoorBikeDataSample = {};
  let off = 2;
  if (!(flags & 0x0001)) {
    out.speedKmh = u16le(v, off) / 100;
    off += 2;
  }
  if (flags & 0x0002) off += 2; // average speed
  if (flags & 0x0004) {
    out.cadenceRpm = u16le(v, off) / 2;
    off += 2;
  }
  if (flags & 0x0008) off += 2; // average cadence
  if (flags & 0x0010) {
    out.distanceM = u24le(v, off);
    off += 3;
  }
  if (flags & 0x0020) {
    out.resistance = i16le(v, off);
    off += 2;
  }
  if (flags & 0x0040) {
    out.powerW = i16le(v, off);
    off += 2;
  }
  if (flags & 0x0080) off += 2; // average power
  if (flags & 0x0100) off += 5; // expended energy (u16 total, u16 per hour, u8 per minute)
  if (flags & 0x0200) {
    out.hrBpm = v.getUint8(off);
    off += 1;
  }
  if (flags & 0x0400) off += 1; // metabolic equivalent
  if (flags & 0x0800) {
    out.elapsedS = u16le(v, off);
    off += 2;
  }
  return out;
}
