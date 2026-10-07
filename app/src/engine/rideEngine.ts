import type { Trainer, HeartRateMonitor, TelemetryUpdate, Unsubscribe } from '../ble/types';
import type { ResolvedPlan, ResolvedStep, RideEvent, RideMode, RideRecording, RideSample } from '../data/schema';
import { saveRecording, saveSampleChunk } from '../data/repositories/recordings';
import { interpolatedTargetW, targetAt } from './planResolve';
import { clampGear, DEFAULT_GEAR, gearToGradePct } from './virtualGears';
import { rampTargetAt, RAMP_V1 } from './rampTest';

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

  private samples: RideSample[] = [];
  private flushedSamples = 0;
  private nextChunkIndex = 0;
  private lastAutosaveMs = 0;
  private saveError: string | null = null;

  private events: RideEvent[] = [];
  private lastSentTargetW: number | null = null;
  private targetConfirmed = false;
  private gear = DEFAULT_GEAR;
  private rampCooldownFromS: number | null = null;

  private unsubs: Unsubscribe[] = [];
  private listeners = new Set<(s: EngineSnapshot) => void>();
  private finishedListeners = new Set<(rec: RideRecording) => void>();

  constructor(private readonly opts: EngineOptions) {}

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
      targetConfirmed: this.targetConfirmed,
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
    await this.applyModeTarget(true);
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
    });

    if (this.phase === 'riding') {
      await this.applyModeTarget(false);
      // Workout completes when the plan runs out.
      if (this.opts.plan && this.planElapsedS >= this.opts.plan.totalS) {
        await this.finish('completed');
        return;
      }
    }

    if (now - this.lastAutosaveMs >= AUTOSAVE_MS) {
      this.lastAutosaveMs = now;
      await this.autosave();
    }
    this.emit();
  }

  // In ERG, send the target when it changes by >= 1 W (covers step entries and
  // ramp interpolation). In Shift, apply the current gear's simulated grade once
  // and again on every gear change. Never claims success without the FTMS ack.
  private async applyModeTarget(force: boolean): Promise<void> {
    const trainer = this.opts.trainer;
    if (!trainer || trainer.connection !== 'connected') return;

    if (this.opts.mode === 'erg') {
      const target = this.currentTargetW();
      if (target === null) return;
      if (!force && this.lastSentTargetW !== null && Math.abs(target - this.lastSentTargetW) < 1) return;
      await this.sendTargetPower(trainer, target);
    } else if (force) {
      await this.sendGrade(trainer, gearToGradePct(this.gear));
    }
  }

  private async sendTargetPower(trainer: Trainer, watts: number): Promise<void> {
    try {
      if (!trainer.hasControl && !(await trainer.requestControl())) {
        this.noteTargetFailure(watts, 'control not granted');
        return;
      }
      let result = await trainer.setTargetPower(watts);
      if (result === 'control_not_permitted' && (await trainer.requestControl())) {
        result = await trainer.setTargetPower(watts);
      }
      if (result === 'success') {
        this.lastSentTargetW = watts;
        this.targetConfirmed = true;
        this.addEvent('targetSet', { targetW: watts });
      } else {
        this.noteTargetFailure(watts, result);
      }
    } catch (e) {
      this.noteTargetFailure(watts, e instanceof Error ? e.message : 'write failed');
    }
  }

  private async sendGrade(trainer: Trainer, gradePct: number): Promise<void> {
    try {
      if (!trainer.hasControl && !(await trainer.requestControl())) {
        this.noteTargetFailure(gradePct, 'control not granted');
        return;
      }
      const result = await trainer.setSimulationGrade(gradePct);
      if (result === 'success') {
        this.targetConfirmed = true;
        this.addEvent('targetSet', { gradePct });
      } else {
        this.noteTargetFailure(gradePct, result);
      }
    } catch (e) {
      this.noteTargetFailure(gradePct, e instanceof Error ? e.message : 'write failed');
    }
  }

  private noteTargetFailure(value: number, reason: string): void {
    this.targetConfirmed = false;
    this.addEvent('targetFailed', { value, reason });
  }

  shift(direction: 1 | -1): void {
    if (this.opts.mode !== 'shift') return;
    const next = clampGear(this.gear + direction);
    if (next === this.gear) return;
    this.gear = next;
    this.addEvent('gearChanged', { gear: next, gradePct: gearToGradePct(next) });
    const trainer = this.opts.trainer;
    if (trainer && trainer.connection === 'connected' && this.phase === 'riding') {
      void this.sendGrade(trainer, gearToGradePct(next));
    }
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
    void this.applyModeTarget(true);
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
    void this.applyModeTarget(true);
    this.emit();
  }

  isInRampCooldown(): boolean {
    return this.rampCooldownFromS !== null;
  }

  get rampCooldownStartS(): number | null {
    return this.rampCooldownFromS;
  }

  async finish(state: 'completed' | 'ended-early'): Promise<RideRecording> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.phase = 'finished';
    this.addEvent('finish', { state });

    const trainer = this.opts.trainer;
    if (trainer && trainer.connection === 'connected' && trainer.hasControl) {
      try {
        await trainer.release();
      } catch {
        // Releasing control is best-effort; the recording is already safe.
      }
    }

    const recording = this.buildRecording(state);
    try {
      await this.flushSamples();
      await saveRecording(recording);
      this.saveError = null;
    } catch (e) {
      this.saveError = e instanceof Error ? e.message : 'save failed';
    }
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

  private async persistHeader(): Promise<void> {
    try {
      await saveRecording(this.buildRecording('in-progress'));
      this.saveError = null;
    } catch (e) {
      this.saveError = e instanceof Error ? e.message : 'save failed';
    }
  }

  private async flushSamples(): Promise<void> {
    while (this.flushedSamples < this.samples.length) {
      const chunk = this.samples.slice(this.flushedSamples, this.flushedSamples + SAMPLES_PER_CHUNK);
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
      await this.flushSamples();
      await saveRecording(this.buildRecording(this.phase === 'finished' ? 'completed' : 'in-progress'));
      this.saveError = null;
    } catch (e) {
      // Surfaced in the UI as a banner with an immediate export escape hatch.
      this.saveError = e instanceof Error ? e.message : 'save failed';
    }
  }
}
