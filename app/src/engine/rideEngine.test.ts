// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { resetDbForTests } from '../data/db';
import { getRecording, loadSamples } from '../data/repositories/recordings';
import { MockTrainer } from '../ble/mock/mockTrainer';
import { RideEngine } from './rideEngine';
import type { ResolvedPlan } from '../data/schema';

// Lets a test make every sample-chunk write fail while the real repository
// still backs everything else.
const chunkWrite = vi.hoisted(() => ({ error: null as Error | null }));
vi.mock('../data/repositories/recordings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/repositories/recordings')>();
  return {
    ...actual,
    saveSampleChunk: async (chunk: Parameters<typeof actual.saveSampleChunk>[0]) => {
      if (chunkWrite.error) throw chunkWrite.error;
      return actual.saveSampleChunk(chunk);
    },
  };
});

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
    chunkWrite.error = null;
    vi.useRealTimers();
  });

  async function connectedTrainer(): Promise<MockTrainer> {
    const trainer = new MockTrainer();
    const connectP = trainer.connect();
    await vi.advanceTimersByTimeAsync(700);
    await connectP;
    return trainer;
  }

  it('a zero RR interval from the strap is dropped, not recorded (2026-10-15 ride)', async () => {
    const engine = new RideEngine({
      kind: 'workout',
      recordingId: 'rr-ride',
      name: 'RR ride',
      mode: 'erg',
      ftpUsed: 200,
      plan,
      trainer: await connectedTrainer(),
      hrm: null,
    });
    await engine.start();
    await vi.advanceTimersByTimeAsync(1000);
    // A missed beat shows up as a 0 s interval between two real ones.
    engine.pushTelemetry({ source: 'hrm', ts: Date.now(), hrBpm: 116, rrIntervalsS: [0.52, 0, 0.53] });
    // Let the autosave at 10 s and the finish both write.
    await vi.advanceTimersByTimeAsync(14_000);
    await vi.waitFor(() => expect(engine.snapshot().phase).toBe('finished'));

    expect(engine.snapshot().saveError).toBeNull();
    const samples = await loadSamples('rr-ride');
    expect(samples.map((s) => s.elapsedS)).toEqual(engine.getSamples().map((s) => s.elapsedS));
    expect(samples.find((s) => s.rrMs)?.rrMs).toEqual([520, 530]);
    expect((await getRecording('rr-ride'))!.state).toBe('completed');
  });

  it('a sample the schema rejects is stored without its bad values instead of blocking every later save', async () => {
    const engine = new RideEngine({
      kind: 'workout',
      recordingId: 'nan-ride',
      name: 'NaN ride',
      mode: 'erg',
      ftpUsed: 200,
      plan,
      trainer: await connectedTrainer(),
      hrm: null,
    });
    await engine.start();
    await vi.advanceTimersByTimeAsync(1000);
    engine.pushTelemetry({ source: 'hrm', ts: Date.now(), hrBpm: Number.NaN });
    await vi.advanceTimersByTimeAsync(14_000);
    await vi.waitFor(() => expect(engine.snapshot().phase).toBe('finished'));

    expect(engine.snapshot().saveError).toBeNull();
    const samples = await loadSamples('nan-ride');
    expect(samples.length).toBe(engine.getSamples().length);
    expect(samples.every((s) => s.hrBpm === null)).toBe(true);
  });

  it('the header is still saved when a sample chunk cannot be written, and the error is surfaced', async () => {
    const engine = new RideEngine({
      kind: 'workout',
      recordingId: 'chunk-fail-ride',
      name: 'Chunk fail ride',
      mode: 'erg',
      ftpUsed: 200,
      plan,
      trainer: await connectedTrainer(),
      hrm: null,
    });
    await engine.start();
    chunkWrite.error = new Error('samples store is broken');
    await vi.advanceTimersByTimeAsync(11_000); // autosave at 10 s fails
    expect(engine.snapshot().saveError).toBe('samples store is broken');

    const rec = await engine.finish('ended-early');
    expect(engine.snapshot().saveError).toBe('samples store is broken');
    // The final header landed regardless of the chunk failure.
    const saved = await getRecording('chunk-fail-ride');
    expect(saved!.state).toBe('ended-early');
    expect(saved!.summary?.durationS).toBe(rec.summary?.durationS);
    expect(await loadSamples('chunk-fail-ride')).toEqual([]);
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

  it('a trainer command that never settles cannot stall the ride loop (2026-10-13 phone rides)', async () => {
    const trainer = new MockTrainer();
    const connectP = trainer.connect();
    await vi.advanceTimersByTimeAsync(700);
    await connectP;
    // Reproduce the field failure: one setTargetPower promise never resolves,
    // then the trainer behaves normally again.
    const realSet = trainer.setTargetPower.bind(trainer);
    let hangNext = false;
    let calls = 0;
    trainer.setTargetPower = (w: number) => {
      calls++;
      if (hangNext) {
        hangNext = false;
        return new Promise(() => {});
      }
      return realSet(w);
    };

    const engine = new RideEngine({
      kind: 'workout',
      recordingId: 'hang-ride',
      name: 'Hang ride',
      mode: 'erg',
      ftpUsed: 200,
      plan: {
        totalS: 60,
        steps: [
          { startS: 0, endS: 5, kind: 'steady', targetW: 100 },
          { startS: 5, endS: 60, kind: 'recovery', targetW: 60 },
        ],
      },
      trainer,
      hrm: null,
    });
    await engine.start();
    await vi.advanceTimersByTimeAsync(2500);
    hangNext = true; // the 60 W step entry at t=5 s will hang
    await vi.advanceTimersByTimeAsync(5000); // t = 7.5 s: write pending, deadline not reached
    expect(calls).toBe(2);
    expect(engine.snapshot().targetW).toBe(60);
    expect(engine.snapshot().targetConfirmed).toBe(true); // still the last confirmed one
    expect(engine.getEvents().filter((e) => e.type === 'targetSet').map((e) => e.detail?.targetW)).toEqual([100]);

    // Ticks kept going: samples recorded and autosaved while the command hung.
    await vi.advanceTimersByTimeAsync(5000); // t = 12.5 s
    expect(engine.getSamples().length).toBeGreaterThanOrEqual(11);
    expect((await loadSamples('hang-ride')).length).toBeGreaterThan(0);

    // Deadline (10 s) passed: failure recorded, retried on the next tick, acked.
    await vi.advanceTimersByTimeAsync(4000); // t = 16.5 s
    const events = engine.getEvents();
    expect(events.some((e) => e.type === 'targetFailed' && e.detail?.value === 60)).toBe(true);
    expect(events.filter((e) => e.type === 'targetSet').map((e) => e.detail?.targetW)).toEqual([100, 60]);
    expect(engine.snapshot().targetConfirmed).toBe(true);
    expect(calls).toBe(3); // exactly one retry: ticks during the hang did not pile up

    // Ending the ride while the trainer hangs on release still completes at once.
    trainer.release = () => new Promise(() => {});
    const rec = await engine.finish('ended-early');
    expect(rec.state).toBe('ended-early');
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await getRecording('hang-ride'))!.state).toBe('ended-early'); // no late autosave overwrote it
  });

  it('ending early is not overwritten by an autosave that was already running', async () => {
    const trainer = new MockTrainer();
    const connectP = trainer.connect();
    await vi.advanceTimersByTimeAsync(700);
    await connectP;
    const engine = new RideEngine({
      kind: 'workout',
      recordingId: 'race-ride',
      name: 'Race ride',
      mode: 'erg',
      ftpUsed: 200,
      plan,
      trainer,
      hrm: null,
    });
    await engine.start();
    // The autosave at t=10 s starts (async IndexedDB work) right before finish.
    await vi.advanceTimersByTimeAsync(10_000);
    const rec = await engine.finish('ended-early');
    expect(rec.state).toBe('ended-early');
    await vi.advanceTimersByTimeAsync(1000);
    const saved = await getRecording('race-ride');
    expect(saved!.state).toBe('ended-early');
    expect(saved!.events.map((e) => e.type)).toContain('finish');
    // No samples lost or duplicated by interleaved chunk writes.
    const samples = await loadSamples('race-ride');
    expect(samples.map((s) => s.elapsedS)).toEqual(engine.getSamples().map((s) => s.elapsedS));
  });
});
