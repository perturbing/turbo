// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { resetDbForTests } from '../data/db';
import { getRecording, loadSamples } from '../data/repositories/recordings';
import { MockTrainer } from '../ble/mock/mockTrainer';
import { RideEngine } from './rideEngine';
import type { ResolvedPlan } from '../data/schema';

const plan: ResolvedPlan = {
  totalS: 12,
  steps: [
    { startS: 0, endS: 6, kind: 'steady', targetW: 100, label: 'Warm-up' },
    { startS: 6, endS: 12, kind: 'steady', targetW: 150, label: 'Effort' },
  ],
};

describe('RideEngine end-to-end with mock trainer', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    resetDbForTests();
    // Leave setImmediate/microtasks real: fake-indexeddb schedules with them.
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a short ERG workout: targets acked, samples recorded, recording saved', async () => {
    const trainer = new MockTrainer();
    const connectP = trainer.connect();
    await vi.advanceTimersByTimeAsync(700);
    await connectP;

    const engine = new RideEngine({
      kind: 'workout',
      recordingId: 'test-ride',
      name: 'Test ride',
      mode: 'erg',
      ftpUsed: 200,
      plan,
      trainer,
      hrm: null,
    });

    const finished = new Promise((resolve) => engine.onFinished(resolve));
    await engine.start();
    // Let the whole 12 s plan play out (plus slack for the final tick).
    await vi.advanceTimersByTimeAsync(14_000);
    await finished;

    const rec = await getRecording('test-ride');
    expect(rec).toBeDefined();
    expect(rec!.state).toBe('completed');
    expect(rec!.ftpUsed).toBe(200);
    expect(rec!.resolvedPlan).toEqual(plan);

    // Both step targets were sent and acknowledged.
    const targets = rec!.events.filter((e) => e.type === 'targetSet').map((e) => e.detail?.targetW);
    expect(targets).toContain(100);
    expect(targets).toContain(150);
    expect(rec!.events.some((e) => e.type === 'targetFailed')).toBe(false);

    const samples = await loadSamples('test-ride');
    expect(samples.length).toBeGreaterThanOrEqual(11);
    // The mock trainer produces power once per second; samples carry values.
    expect(samples.some((s) => s.powerW !== null)).toBe(true);
    expect(rec!.summary?.avgPowerW).toBeGreaterThan(0);
  });

  it('pause stops plan progression but keeps recording samples', async () => {
    const trainer = new MockTrainer();
    const connectP = trainer.connect();
    await vi.advanceTimersByTimeAsync(700);
    await connectP;

    const engine = new RideEngine({
      kind: 'workout',
      recordingId: 'pause-ride',
      name: 'Pause ride',
      mode: 'erg',
      ftpUsed: 200,
      plan,
      trainer,
      hrm: null,
    });
    await engine.start();
    await vi.advanceTimersByTimeAsync(3000);
    engine.pause();
    const pausedAt = engine.snapshot().planElapsedS;
    await vi.advanceTimersByTimeAsync(5000);
    expect(engine.snapshot().planElapsedS).toBeCloseTo(pausedAt, 1);
    expect(engine.snapshot().rideElapsedS).toBeGreaterThan(pausedAt + 4);
    engine.resume();
    await vi.advanceTimersByTimeAsync(2000);
    expect(engine.snapshot().planElapsedS).toBeGreaterThan(pausedAt + 1);

    const rec = await engine.finish('ended-early');
    expect(rec.state).toBe('ended-early');
    expect(rec.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['start', 'pause', 'resume', 'finish']),
    );
    // Samples kept flowing during the pause.
    const samples = await loadSamples('pause-ride');
    expect(samples.length).toBeGreaterThanOrEqual(9);
  });

  it('records heart rate pushed mid-ride (e.g. strap connected after start)', async () => {
    const trainer = new MockTrainer();
    const connectP = trainer.connect();
    await vi.advanceTimersByTimeAsync(700);
    await connectP;

    const engine = new RideEngine({
      kind: 'workout',
      recordingId: 'hr-ride',
      name: 'HR ride',
      mode: 'erg',
      ftpUsed: 200,
      plan,
      trainer,
      hrm: null, // no HRM at start
    });
    await engine.start();
    await vi.advanceTimersByTimeAsync(3000);
    // Strap connects mid-ride; HR arrives via the external feed.
    engine.pushTelemetry({ source: 'hrm', ts: Date.now(), hrBpm: 142 });
    await vi.advanceTimersByTimeAsync(2000);
    const rec = await engine.finish('ended-early');

    const samples = await loadSamples('hr-ride');
    expect(samples.some((s) => s.hrBpm === null)).toBe(true); // before the strap: explicit gap
    expect(samples.some((s) => s.hrBpm === 142)).toBe(true); // after: recorded
    expect(rec.summary?.avgHrBpm).toBe(142);
  });

  it('ramp test mode follows the ramp protocol and honours cooldown', async () => {
    const trainer = new MockTrainer();
    const connectP = trainer.connect();
    await vi.advanceTimersByTimeAsync(700);
    await connectP;

    const engine = new RideEngine({
      kind: 'rampTest',
      recordingId: 'ramp-ride',
      name: 'Ramp test',
      mode: 'erg',
      ftpUsed: null,
      plan: null,
      trainer,
      hrm: null,
    });
    await engine.start();
    expect(engine.snapshot().targetW).toBe(100); // warm-up
    await vi.advanceTimersByTimeAsync(2000);
    engine.startRampCooldown();
    expect(engine.snapshot().targetW).toBe(100); // cooldown target
    const rec = await engine.finish('completed');
    expect(rec.kind).toBe('rampTest');
    expect(rec.resolvedPlan).toBeNull();
    expect(rec.events.some((e) => e.type === 'stageAdvanced' && e.detail?.cooldown)).toBe(true);
  });
});
