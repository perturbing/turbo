import { describe, expect, it } from 'vitest';
import { fromHex } from '../bytes';
import { CrankTracker, parseCyclingPower } from './cyclingPower';
import { parseIndoorBikeData } from './indoorBikeData';
import { parseHeartRate } from './heartRate';
import {
  buildSetSimulation,
  buildSetTargetPower,
  parseFtmsAck,
  parseRange,
} from './ftmsControl';
import {
  decodeRideBattery,
  decodeRideNotification,
  isRideOnAck,
  mergeAnalog,
  parseProtobuf,
  zigzag,
} from './zwiftRide';

// All hex fixtures are lifted verbatim from the Python PoC logs
// (bt-comm-test/blezwift/logs/).

describe('parseCyclingPower (0x2A63)', () => {
  it('decodes a real KICKR packet (flags 0x0034)', () => {
    const s = parseCyclingPower(fromHex('34009b006a63168f000081881b2eb0b1'));
    expect(s.powerW).toBe(155);
    expect(s.torqueNm).toBeCloseTo(795.3, 1);
    expect(s.wheelRevs).toBe(36630);
    expect(s.crankRevs).toBe(11803);
    expect(s.crankEventTime1024).toBe(45488);
  });
});

describe('CrankTracker', () => {
  it('computes cadence from crank deltas (96 rpm)', () => {
    const t = new CrankTracker();
    t.update(11801, 44208, 0);
    // +2 revs in 1280/1024 s = 1.25 s -> 96 rpm
    expect(t.update(11803, 45488, 1000)).toBeCloseTo(96, 1);
  });

  it('handles uint16 rollover on both counters', () => {
    const t = new CrankTracker();
    t.update(0xfffe, 0xfc00, 0);
    // revs 0xFFFE -> 0x0001 = 3 revs; time 0xFC00 -> 0x0380 = 0x0780 ticks = 1.875 s -> 96 rpm
    expect(t.update(0x0001, 0x0380, 1000)).toBeCloseTo(96, 1);
  });

  it('decays to zero after 3 s of repeated samples', () => {
    const t = new CrankTracker();
    t.update(100, 1024, 0);
    expect(t.update(102, 2304, 1000)).toBeCloseTo(96, 1);
    // Device repeats the same sample; cadence holds until wall-clock timeout.
    expect(t.update(102, 2304, 2000)).toBeCloseTo(96, 1);
    expect(t.update(102, 2304, 4100)).toBe(0);
  });
});

describe('parseIndoorBikeData (0x2AD2)', () => {
  it('decodes a real KICKR packet (flags 0x0044)', () => {
    const s = parseIndoorBikeData(fromHex('4400450ec0009a00'));
    expect(s.speedKmh).toBeCloseTo(36.53, 2);
    expect(s.cadenceRpm).toBe(96);
    expect(s.powerW).toBe(154);
  });

  it('treats bit0 as inverted "More Data" (speed absent when set)', () => {
    const s = parseIndoorBikeData(fromHex('4500c0009a00'));
    expect(s.speedKmh).toBeUndefined();
    expect(s.cadenceRpm).toBe(96);
    expect(s.powerW).toBe(154);
  });
});

describe('parseHeartRate (0x2A37)', () => {
  it('decodes a real HRM200 packet with RR interval', () => {
    const s = parseHeartRate(fromHex('108bb901'));
    expect(s.hrBpm).toBe(139);
    expect(s.rrIntervalsS?.[0]).toBeCloseTo(441 / 1024, 4);
  });

  it('decodes 16-bit bpm', () => {
    const s = parseHeartRate(fromHex('012c01'));
    expect(s.hrBpm).toBe(300);
  });
});

describe('FTMS control point', () => {
  it('builds target power payloads matching the live log', () => {
    expect(buildSetTargetPower(100)).toEqual(fromHex('056400'));
    expect(buildSetTargetPower(150)).toEqual(fromHex('059600'));
  });

  it('builds simulation payloads with spec scaling', () => {
    const p = buildSetSimulation({ gradePct: 1.5 });
    expect(p).toEqual(fromHex('110000960050 33'.replace(' ', '')));
  });

  it('parses ack indications (80 op result)', () => {
    expect(parseFtmsAck(fromHex('800001'))).toEqual({ requestOpcode: 0x00, result: 'success' });
    expect(parseFtmsAck(fromHex('800505'))).toEqual({
      requestOpcode: 0x05,
      result: 'control_not_permitted',
    });
    expect(parseFtmsAck(fromHex('01'))).toBeNull();
  });

  it('parses supported ranges from real reads', () => {
    expect(parseRange(fromHex('0000d0070100'))).toEqual({ min: 0, max: 2000, increment: 1 });
    expect(parseRange(fromHex('000064000100'))).toEqual({ min: 0, max: 100, increment: 1 });
  });
});

describe('Zwift Ride decoding', () => {
  it('zigzag decodes', () => {
    expect(zigzag(0)).toBe(0);
    expect(zigzag(200)).toBe(100);
    expect(zigzag(199)).toBe(-100);
  });

  it('parses the idle controller frame (nothing pressed, left pod)', () => {
    const s = decodeRideNotification(
      fromHex('2308ffffffff0f1a04080010051a04080110001a04080210001a0408031000'),
    );
    expect(s.pressed).toEqual([]);
  });

  it('decodes a DPad_Left press (bit0 cleared)', () => {
    const s = decodeRideNotification(
      fromHex('2308feffffff0f1a04080010001a04080110001a04080210001a0408031000'),
    );
    expect(s.pressed).toEqual(['DPad_Left']);
  });

  it('decodes Shift_R_Extra (bit14) on the right pod', () => {
    const s = decodeRideNotification(fromHex('2308fffffeff0f1a04080010001a0408011000'));
    expect(s.pressed).toEqual(['Shift_R_Extra']);
  });

  it('decodes analog lever full right steer (+100) and full brake (-100)', () => {
    const right = decodeRideNotification(fromHex('2308ffffffff0f1a04080010001a05080110c801'));
    expect(right.analog).toEqual({ Lever_R: 100 });
    const brake = decodeRideNotification(fromHex('2308ffffffff0f1a04080010001a05080110c701'));
    expect(brake.analog).toEqual({ Lever_R: -100 });
  });

  it('decodes battery message 19105f -> 95 %', () => {
    expect(decodeRideBattery(fromHex('19105f'))).toBe(95);
  });

  it('merges analog across pods without flicker (owning pod wins per lever)', () => {
    // Both levers held: left pod reads its own lever (and mirrors nothing back
    // for the right in this scenario), right pod reports its own lever and 0
    // for the left. Frames interleave; merged output must stay steady.
    const leftPod = { Lever_L: -80, Lever_R: 60 }; // mirrors right's value
    const rightPod = { Lever_L: 0, Lever_R: 60 }; // reports only its own
    expect(mergeAnalog([leftPod, rightPod])).toEqual({ Lever_L: -80, Lever_R: 60 });
    expect(mergeAnalog([rightPod, leftPod])).toEqual({ Lever_L: -80, Lever_R: 60 });
    // Release: both pods at zero -> merged returns to centre.
    expect(mergeAnalog([{ Lever_L: 0, Lever_R: 0 }, { Lever_L: 0, Lever_R: 0 }])).toEqual({
      Lever_L: 0,
      Lever_R: 0,
    });
    // Single pod connected still works.
    expect(mergeAnalog([{ Lever_L: -100, Lever_R: 0 }])).toEqual({ Lever_L: -100, Lever_R: 0 });
  });

  it('recognizes the RideOn handshake ack', () => {
    expect(isRideOnAck(fromHex('526964654f6e'))).toBe(true);
    expect(isRideOnAck(fromHex('15'))).toBe(false);
  });

  it('parses nested protobuf without crashing on device-info frames', () => {
    const msg = parseProtobuf(fromHex('2a08031211220f4154582030332c2053545820303300').subarray(1));
    expect(msg).not.toBeNull();
  });
});
