import { i16le, toDataView, u16le, u32le } from '../bytes';

export interface CyclingPowerSample {
  powerW: number;
  balancePct?: number;
  torqueNm?: number;
  wheelRevs?: number;
  wheelEventTime2048?: number;
  crankRevs?: number;
  crankEventTime1024?: number;
}

// Cycling Power Measurement (0x2A63). The KICKR CORE always sends flags 0x0034:
// accumulated torque + wheel revolution data + crank revolution data (16 bytes).
export function parseCyclingPower(data: ArrayBuffer | ArrayBufferView): CyclingPowerSample {
  const v = toDataView(data);
  const flags = u16le(v, 0);
  const out: CyclingPowerSample = { powerW: i16le(v, 2) };
  let off = 4;
  if (flags & 0x0001) {
    out.balancePct = v.getUint8(off) / 2;
    off += 1;
  }
  if (flags & 0x0004) {
    out.torqueNm = u16le(v, off) / 32;
    off += 2;
  }
  if (flags & 0x0010) {
    out.wheelRevs = u32le(v, off);
    out.wheelEventTime2048 = u16le(v, off + 4);
    off += 6;
  }
  if (flags & 0x0020) {
    out.crankRevs = u16le(v, off);
    out.crankEventTime1024 = u16le(v, off + 2);
    off += 4;
  }
  return out;
}

// Derives cadence from cumulative crank revolutions + event time (1/1024 s).
// Both counters are uint16 and roll over. The trainer repeats the last crank
// sample when pedalling stops, so cadence must decay to zero on wall-clock
// silence rather than event-time deltas.
export class CrankTracker {
  private lastRevs: number | null = null;
  private lastTime1024 = 0;
  private lastChangeMs = 0;
  private cadenceRpm = 0;

  constructor(private readonly staleAfterMs = 3000) {}

  update(revs: number, time1024: number, nowMs: number = Date.now()): number {
    if (this.lastRevs !== null) {
      const dRevs = (revs - this.lastRevs) & 0xffff;
      const dt = ((time1024 - this.lastTime1024) & 0xffff) / 1024;
      if (dt > 0 && dRevs > 0) {
        this.cadenceRpm = (dRevs / dt) * 60;
        this.lastChangeMs = nowMs;
      } else if (nowMs - this.lastChangeMs > this.staleAfterMs) {
        this.cadenceRpm = 0;
      }
    } else {
      this.lastChangeMs = nowMs;
    }
    this.lastRevs = revs;
    this.lastTime1024 = time1024;
    return this.cadenceRpm;
  }

  reset(): void {
    this.lastRevs = null;
    this.cadenceRpm = 0;
  }
}
