import type { FtmsResult } from '../decoders/ftmsControl';
import type { ConnectionState, Trainer, TrainerCapabilities, TelemetryUpdate, Unsubscribe } from '../types';

// Simulated KICKR: a virtual rider pedals at ~90 rpm; in ERG the trainer pulls
// power toward the target with a first-order lag and some noise; in SIM mode
// power follows the grade. Emits telemetry at 1 Hz on both source channels,
// like the real device.
export class MockTrainer implements Trainer {
  readonly kind = 'trainer' as const;
  readonly name = 'Mock KICKR CORE';
  connection: ConnectionState = 'disconnected';
  hasControl = false;
  capabilities: TrainerCapabilities = {
    powerRange: { min: 0, max: 2000, increment: 1 },
    resistanceRange: { min: 0, max: 100, increment: 1 },
  };

  private targetW = 120;
  private simGradePct: number | null = null;
  private currentW = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  private telemetryCbs = new Set<(u: TelemetryUpdate) => void>();
  private connectionCbs = new Set<(s: ConnectionState) => void>();
  private controlCbs = new Set<(c: boolean) => void>();

  onTelemetry(cb: (u: TelemetryUpdate) => void): Unsubscribe {
    this.telemetryCbs.add(cb);
    return () => this.telemetryCbs.delete(cb);
  }

  onConnectionChange(cb: (s: ConnectionState) => void): Unsubscribe {
    this.connectionCbs.add(cb);
    return () => this.connectionCbs.delete(cb);
  }

  onControlChange(cb: (c: boolean) => void): Unsubscribe {
    this.controlCbs.add(cb);
    return () => this.controlCbs.delete(cb);
  }

  async connect(): Promise<void> {
    this.connection = 'connecting';
    this.emitConnection();
    await new Promise((r) => setTimeout(r, 600));
    this.connection = 'connected';
    this.emitConnection();
    this.timer = setInterval(() => this.tick(), 1000);
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.connection = 'disconnected';
    this.hasControl = false;
    this.emitConnection();
    for (const cb of this.controlCbs) cb(false);
  }

  async requestControl(): Promise<boolean> {
    if (this.connection !== 'connected') return false;
    this.hasControl = true;
    for (const cb of this.controlCbs) cb(true);
    return true;
  }

  async setTargetPower(watts: number): Promise<FtmsResult> {
    if (!this.hasControl) return 'control_not_permitted';
    this.targetW = watts;
    this.simGradePct = null;
    return 'success';
  }

  async setSimulationGrade(gradePct: number): Promise<FtmsResult> {
    if (!this.hasControl) return 'control_not_permitted';
    this.simGradePct = gradePct;
    return 'success';
  }

  async release(): Promise<void> {
    this.hasControl = false;
    for (const cb of this.controlCbs) cb(false);
  }

  private weightKg = 79;

  async readWeightKg(): Promise<number | null> {
    return this.connection === 'connected' ? this.weightKg : null;
  }

  async writeWeightKg(kg: number): Promise<number | null> {
    if (this.connection !== 'connected') return null;
    this.weightKg = Math.round(kg / 0.005) * 0.005; // same 0.005 kg quantization
    return this.weightKg;
  }

  private tick(): void {
    const goal =
      this.simGradePct !== null
        ? Math.max(60, 160 + this.simGradePct * 28) // riding a grade at steady cadence
        : this.targetW;
    // First-order lag + noise.
    this.currentW += (goal - this.currentW) * 0.4;
    const noisyW = Math.max(0, Math.round(this.currentW + (Math.random() - 0.5) * 8));
    const cadence = 88 + Math.random() * 5;
    const speed = 20 + noisyW / 12 + (Math.random() - 0.5);
    const ts = Date.now();
    for (const cb of this.telemetryCbs) {
      cb({ source: 'trainer-power', ts, powerW: noisyW, cadenceRpm: Math.round(cadence * 10) / 10 });
      cb({ source: 'trainer-bike', ts, powerW: noisyW, speedKmh: Math.round(speed * 100) / 100 });
    }
  }

  private emitConnection(): void {
    for (const cb of this.connectionCbs) cb(this.connection);
  }
}
