import type { Trainer, HeartRateMonitor, TelemetryUpdate, Unsubscribe } from '../ble/types';
import type { ResolvedPlan, ResolvedStep, RideEvent, RideMode, RideRecording } from '../data/schema';
import { RideSample } from '../data/schema';
import { saveRecording, saveSampleChunk } from '../data/repositories/recordings';
import { interpolatedTargetW, targetAt } from './planResolve';
import { clampGear, DEFAULT_GEAR, gearToGradePct } from './virtualGears';
import { rampTargetAt, RAMP_V1 } from './rampTest';
import { TrainerController, type DesiredTrainerState } from './trainerController';

export type RidePhase = 'ready' | 'riding' | 'paused' | 'interrupted' | 'finished';

export interface EngineSnapshot {
  phase: RidePhase;
  rideElapsedS: number; // wall clock since start; drives sample timeline
  planElapsedS: number; // advances only while riding; drives plan progression
  currentStep: ResolvedStep | null;
  nextStep: ResolvedStep | null;
  targetW: number | null;
  targetConfirmed: boolean;
  gear: number;
  gradePct: number;
  rampStage: number | null;
  rampStageEndsS: number | null;
  live: { powerW: number | null; cadenceRpm: number | null; speedKmh: number | null; hrBpm: number | null };
  saveError: string | null;
}

export interface EngineOptions {
  kind: 'workout' | 'rampTest';
  recordingId: string;
  name: string;
  mode: RideMode;
  ftpUsed: number | null;
  plan: ResolvedPlan | null; // null for the open-ended ramp test
  recipeId?: string;
  recipeRevision?: number;
  intensityPct?: number;
  trainer: Trainer | null;
  hrm: HeartRateMonitor | null;
}

const FRESHNESS_MS = 3000;
const SAMPLES_PER_CHUNK = 60;
const AUTOSAVE_MS = 10_000;

interface Fresh {
  value: number;
  atMs: number;
}

export class RideEngine {
  private phase: RidePhase = 'ready';
  private startedAtMs = 0;
  private rideElapsedS = 0;
  private planElapsedS = 0;
  private lastTickMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  private power: Fresh | null = null;
  private cadence: Fresh | null = null;
  private speed: Fresh | null = null;
  private hr: Fresh | null = null;
  private rrPending: number[] = [];

  private samples: RideSample[] = [];
  private flushedSamples = 0;
  private nextChunkIndex = 0;
  private lastAutosaveMs = 0;
  private saveError: string | null = null;

  private events: RideEvent[] = [];
  // Owns the trainer: the engine only declares the desired state (see
  // trainerController.ts); acks, retries, deadlines and reconnects live there.
  private readonly controller: TrainerController;
  private finishedRecording: RideRecording | null = null;
  // All IndexedDB writes go through one chain: an autosave and a finish that
  // overlap would otherwise interleave chunk writes (losing samples) or let
  // the autosave's in-progress header land after the final record.
  private saveChain: Promise<void> = Promise.resolve();
  private gear = DEFAULT_GEAR;
  private rampCooldownFromS: number | null = null;

  private unsubs: Unsubscribe[] = [];
  private listeners = new Set<(s: EngineSnapshot) => void>();
  private finishedListeners = new Set<(rec: RideRecording) => void>();

  constructor(private readonly opts: EngineOptions) {
    this.controller = new TrainerController(opts.trainer);
    this.controller.onEvent((e) => {
      if (e.type === 'applied') {
        // Routine re-asserts of an unchanged target are not worth an event.
        if (e.reason === 'reassert' && e.state.kind !== 'released') return;
        if (e.state.kind === 'erg') this.addEvent('targetSet', { targetW: e.state.watts });
        else if (e.state.kind === 'sim') this.addEvent('targetSet', { gradePct: e.state.gradePct });
      } else {
        const value = e.state.kind === 'erg' ? e.state.watts : e.state.kind === 'sim' ? e.state.gradePct : 0;
        this.addEvent('targetFailed', { value, reason: e.reason, attempt: e.attempt });
      }
    });
  }

  onSnapshot(cb: (s: EngineSnapshot) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onFinished(cb: (rec: RideRecording) => void): Unsubscribe {
    this.finishedListeners.add(cb);
    return () => this.finishedListeners.delete(cb);
  }

  getSamples(): readonly RideSample[] {
    return this.samples;
  }

  getEvents(): readonly RideEvent[] {
    return this.events;
  }

  // The recording as it stands right now (in-progress header until finished).
  // Feeds the emergency export so an unsaved ride leaves the phone as a file
  // the app can import, not just a bag of samples.
  recordingSoFar(): RideRecording {
    return this.finishedRecording ?? this.buildRecording('in-progress');
  }

  snapshot(): EngineSnapshot {
    const now = Date.now();
    const freshOrNull = (f: Fresh | null) => (f && now - f.atMs <= FRESHNESS_MS ? f.value : null);
    const step = this.opts.plan ? targetAt(this.opts.plan, this.planElapsedS) : null;
    const next = this.opts.plan
      ? this.opts.plan.steps.find((s) => s.startS >= (step?.endS ?? this.planElapsedS)) ?? null
      : null;
    let rampStage: number | null = null;
    let rampStageEndsS: number | null = null;
    if (this.opts.kind === 'rampTest' && this.rampCooldownFromS === null) {
      const r = rampTargetAt(this.planElapsedS);
      rampStage = r.stage;
      rampStageEndsS = r.stageEndsS;
    }
    return {
      phase: this.phase,
      rideElapsedS: this.rideElapsedS,
      planElapsedS: this.planElapsedS,
      currentStep: step,
      nextStep: next,
      targetW: this.currentTargetW(),
      // False only while the trainer is failing to take a target (the UI shows
      // "retrying"); a fresh, not-yet-acked target is not an error.
      targetConfirmed: this.controller.status.consecutiveFailures === 0,
      gear: this.gear,
      gradePct: gearToGradePct(this.gear),
      rampStage,
      rampStageEndsS,
      live: {
        powerW: freshOrNull(this.power),
        cadenceRpm: freshOrNull(this.cadence),
        speedKmh: freshOrNull(this.speed),
        hrBpm: freshOrNull(this.hr),
      },
      saveError: this.saveError,
    };
  }

  private emit(): void {
    const s = this.snapshot();
    for (const cb of this.listeners) cb(s);
  }

  private addEvent(type: RideEvent['type'], detail?: RideEvent['detail']): void {
    this.events.push({
      elapsedS: Math.round(this.rideElapsedS),
      ts: new Date().toISOString(),
      type,
      ...(detail ? { detail } : {}),
    });
  }

  async start(): Promise<void> {
    if (this.phase !== 'ready') return;
    this.startedAtMs = Date.now();
    this.lastTickMs = this.startedAtMs;
    this.lastAutosaveMs = this.startedAtMs;
    this.addEvent('start');

    const { trainer, hrm } = this.opts;
    if (trainer) {
      this.unsubs.push(trainer.onTelemetry((u) => this.onTelemetry(u)));
      this.unsubs.push(
        trainer.onConnectionChange((state) => {
          if (state === 'connected' && this.phase === 'interrupted') void this.recoverFromInterruption();
          else if (state !== 'connected' && (this.phase === 'riding' || this.phase === 'paused')) {
            this.addEvent('deviceDisconnected', { device: 'trainer' });
            this.phase = 'interrupted';
            this.emit();
          }
        }),
      );
    }
    if (hrm) this.unsubs.push(hrm.onTelemetry((u) => this.onTelemetry(u)));

    this.phase = 'riding';
    await this.persistHeader();
    // The ride starts without waiting for the trainer: the controller applies
    // the first target in the background and keeps it applied from then on.
    this.controller.start();
    this.syncDesired();
    this.timer = setInterval(() => void this.tick(), 1000);
    this.emit();
  }

  // External telemetry feed (e.g. heart rate piped from the device store, so a
  // strap that connects mid-ride is still recorded).
  pushTelemetry(u: TelemetryUpdate): void {
    this.onTelemetry(u);
  }

  private onTelemetry(u: TelemetryUpdate): void {
    // Power from both trainer sources (last writer wins); cadence only from the
    // crank-tracker path (trainer-power); speed only from FTMS (trainer-bike).
    if (u.powerW !== undefined) this.power = { value: u.powerW, atMs: u.ts };
    if (u.cadenceRpm !== undefined && u.source === 'trainer-power')
      this.cadence = { value: u.cadenceRpm, atMs: u.ts };
    if (u.speedKmh !== undefined && u.source === 'trainer-bike')
      this.speed = { value: u.speedKmh, atMs: u.ts };
    if (u.hrBpm !== undefined) this.hr = { value: u.hrBpm, atMs: u.ts };
    if (u.rrIntervalsS) {
      for (const rr of u.rrIntervalsS) {
        const ms = Math.round(rr * 1000);
        // Straps report 0 for a missed beat (2026-10-15 ride: two zeros at
        // 230 s). Not an interval, so not recorded.
        if (Number.isFinite(ms) && ms > 0) this.rrPending.push(ms);
      }
    }
  }

  private currentTargetW(): number | null {
    if (this.opts.kind === 'rampTest') {
      if (this.rampCooldownFromS !== null) return RAMP_V1.cooldownTargetW;
      return rampTargetAt(this.planElapsedS).targetW;
    }
    if (!this.opts.plan) return null;
    const step = targetAt(this.opts.plan, this.planElapsedS);
    return step ? interpolatedTargetW(step, this.planElapsedS) : null;
  }

  private async tick(): Promise<void> {
    if (this.phase === 'finished') return;
    const now = Date.now();
    const dt = (now - this.lastTickMs) / 1000;
    this.lastTickMs = now;
    this.rideElapsedS += dt;
    if (this.phase === 'riding') this.planElapsedS += dt;

    // Record one sample per tick regardless of pause/interruption — gaps and
    // zeros stay explicit, data is preserved.
    const freshOrNull = (f: Fresh | null) => (f && now - f.atMs <= FRESHNESS_MS ? f.value : null);
    this.samples.push({
      elapsedS: Math.round(this.rideElapsedS),
      ts: new Date(now).toISOString(),
      powerW: freshOrNull(this.power),
      cadenceRpm: freshOrNull(this.cadence),
      speedKmh: freshOrNull(this.speed),
      hrBpm: freshOrNull(this.hr),
      ...(this.rrPending.length ? { rrMs: this.rrPending } : {}),
    });
    this.rrPending = [];

    if (this.phase === 'riding') {
      // Workout completes when the plan runs out. Checked before the target
      // write so completion never waits on the trainer.
      if (this.opts.plan && this.planElapsedS >= this.opts.plan.totalS) {
        await this.finish('completed');
        return;
      }
      this.syncDesired();
    }

    if (now - this.lastAutosaveMs >= AUTOSAVE_MS) {
      this.lastAutosaveMs = now;
      await this.autosave();
    }
    this.emit();
  }

  // What the trainer should be doing right now, derived from the ride state.
  // ERG: the interpolated plan target (ramps re-send whenever it moves >= 1 W,
  // handled by the controller's tolerance). Shift: the current gear's grade.
  private desiredState(): DesiredTrainerState | null {
    if (this.opts.mode === 'erg') {
      const target = this.currentTargetW();
      return target === null ? null : { kind: 'erg', watts: target };
    }
    return { kind: 'sim', gradePct: gearToGradePct(this.gear) };
  }

  private syncDesired(): void {
    const state = this.desiredState();
    if (state) this.controller.setDesired(state);
  }

  shift(direction: 1 | -1): void {
    if (this.opts.mode !== 'shift') return;
    const next = clampGear(this.gear + direction);
    if (next === this.gear) return;
    this.gear = next;
    this.addEvent('gearChanged', { gear: next, gradePct: gearToGradePct(next) });
    if (this.phase === 'riding') this.syncDesired();
    this.emit();
  }

  pause(): void {
    if (this.phase !== 'riding') return;
    // Plan progression stops; sampling continues. The trainer keeps its last
    // confirmed target — sending anything else while paused is unverified
    // hardware behavior (provisional, see design doc §6).
    this.phase = 'paused';
    this.addEvent('pause');
    this.emit();
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    this.phase = 'riding';
    this.addEvent('resume');
    // Readiness is rechecked by re-applying the target even if it is believed
    // to be in place (design doc §6).
    this.syncDesired();
    this.controller.reapply();
    this.emit();
  }

  private async recoverFromInterruption(): Promise<void> {
    this.addEvent('deviceReconnected', { device: 'trainer' });
    this.phase = 'paused'; // readiness is rechecked by the rider pressing resume
    this.emit();
  }

  // Ramp test: rider taps "Finish test & cool down".
  startRampCooldown(): void {
    if (this.opts.kind !== 'rampTest' || this.rampCooldownFromS !== null) return;
    this.rampCooldownFromS = this.planElapsedS;
    this.addEvent('stageAdvanced', { cooldown: true });
    this.syncDesired();
    this.emit();
  }

  isInRampCooldown(): boolean {
    return this.rampCooldownFromS !== null;
  }

  get rampCooldownStartS(): number | null {
    return this.rampCooldownFromS;
  }

  // Idempotent: a second call (double tap, or the plan running out while the
  // rider is ending early) returns the same recording.
  async finish(state: 'completed' | 'ended-early'): Promise<RideRecording> {
    if (this.finishedRecording) return this.finishedRecording;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.phase = 'finished';
    this.addEvent('finish', { state });

    // Persist first: the recording must never depend on the trainer answering.
    const recording = this.buildRecording(state);
    this.finishedRecording = recording;
    try {
      await this.serializedSave(() => this.persist(recording));
      this.saveError = null;
    } catch (e) {
      this.saveError = e instanceof Error ? e.message : 'save failed';
    }

    // Hand the trainer back (FTMS reset ends ERG). Bounded and not awaited: a
    // wedged link must not keep the rider on the live screen.
    this.controller.release();

    this.emit();
    for (const cb of this.finishedListeners) cb(recording);
    return recording;
  }

  private buildRecording(state: RideRecording['state']): RideRecording {
    const powered = this.samples.filter((s) => s.powerW !== null) as (RideSample & { powerW: number })[];
    const hrs = this.samples.filter((s) => s.hrBpm !== null) as (RideSample & { hrBpm: number })[];
    const cads = this.samples.filter((s) => s.cadenceRpm !== null) as (RideSample & { cadenceRpm: number })[];
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const avgPower = avg(powered.map((s) => s.powerW));
    return {
      schemaVersion: 1,
      id: this.opts.recordingId,
      kind: this.opts.kind,
      recipeId: this.opts.recipeId,
      recipeRevision: this.opts.recipeRevision,
      name: this.opts.name,
      startedAt: new Date(this.startedAtMs).toISOString(),
      endedAt: new Date().toISOString(),
      ftpUsed: this.opts.ftpUsed,
      mode: this.opts.mode,
      resolvedPlan: this.opts.plan,
      state,
      ...(this.opts.intensityPct !== undefined ? { intensityPct: this.opts.intensityPct } : {}),
      events: [...this.events],
      summary: {
        durationS: Math.round(this.rideElapsedS),
        avgPowerW: avgPower === null ? null : Math.round(avgPower),
        maxPowerW: powered.length ? Math.max(...powered.map((s) => s.powerW)) : null,
        avgCadenceRpm: avg(cads.map((s) => s.cadenceRpm)) ?? null,
        avgHrBpm: avg(hrs.map((s) => s.hrBpm)) ?? null,
        energyKj: avgPower === null ? null : Math.round((avgPower * this.rideElapsedS) / 1000),
      },
    };
  }

  private serializedSave(fn: () => Promise<void>): Promise<void> {
    const next = this.saveChain.then(fn, fn);
    this.saveChain = next.catch(() => undefined);
    return next;
  }

  private async persistHeader(): Promise<void> {
    try {
      await this.serializedSave(() => saveRecording(this.buildRecording('in-progress')));
      this.saveError = null;
    } catch (e) {
      this.saveError = e instanceof Error ? e.message : 'save failed';
    }
  }

  // Samples and header are written independently: a chunk that cannot be
  // written must not cost the header, nor the other way round. The first
  // failure is rethrown once both have been attempted.
  private async persist(recording: RideRecording): Promise<void> {
    let failure: unknown = null;
    try {
      await this.flushSamples();
    } catch (e) {
      failure = e;
    }
    try {
      await saveRecording(recording);
    } catch (e) {
      failure ??= e;
    }
    if (failure) throw failure;
  }

  private async flushSamples(): Promise<void> {
    while (this.flushedSamples < this.samples.length) {
      const end = Math.min(this.flushedSamples + SAMPLES_PER_CHUNK, this.samples.length);
      for (let i = this.flushedSamples; i < end; i++) this.samples[i] = storable(this.samples[i]);
      const chunk = this.samples.slice(this.flushedSamples, end);
      await saveSampleChunk({
        schemaVersion: 1,
        recordingId: this.opts.recordingId,
        chunkIndex: this.nextChunkIndex,
        samples: chunk,
      });
      this.nextChunkIndex++;
      this.flushedSamples += chunk.length;
    }
  }

  private async autosave(): Promise<void> {
    try {
      await this.serializedSave(async () => {
        if (this.phase === 'finished') return; // finish() writes the final record
        await this.persist(this.buildRecording('in-progress'));
      });
      this.saveError = null;
    } catch (e) {
      // Surfaced in the UI as a banner with an immediate export escape hatch.
      this.saveError = e instanceof Error ? e.message : 'save failed';
    }
  }
}

// A sample the schema rejects is reduced to its valid parts rather than left
// in the unflushed tail, where it would fail every later save of the ride
// (the 2026-10-15 ride lost 55 minutes that way to a single zero RR interval).
function storable(s: RideSample): RideSample {
  if (RideSample.safeParse(s).success) return s;
  console.warn('bike-app: sample failed validation; storing its valid parts', s);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const rr = Array.isArray(s.rrMs) ? s.rrMs.filter((x) => Number.isInteger(x) && x > 0) : [];
  return {
    elapsedS: Math.max(0, num(s.elapsedS) ?? 0),
    ts: typeof s.ts === 'string' ? s.ts : new Date().toISOString(),
    powerW: num(s.powerW),
    cadenceRpm: num(s.cadenceRpm),
    speedKmh: num(s.speedKmh),
    hrBpm: num(s.hrBpm),
    ...(rr.length ? { rrMs: rr } : {}),
  };
}
