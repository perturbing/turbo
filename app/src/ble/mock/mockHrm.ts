import type { ConnectionState, HeartRateMonitor, TelemetryUpdate, Unsubscribe } from '../types';

// Simulated HRM: heart rate wanders around a baseline.
export class MockHeartRateMonitor implements HeartRateMonitor {
  readonly kind = 'hrm' as const;
  readonly name = 'Mock HRM';
  connection: ConnectionState = 'disconnected';
  batteryPct: number | null = 80;

  private hr = 95;
  private timer: ReturnType<typeof setInterval> | null = null;
  private telemetryCbs = new Set<(u: TelemetryUpdate) => void>();
  private connectionCbs = new Set<(s: ConnectionState) => void>();

  onTelemetry(cb: (u: TelemetryUpdate) => void): Unsubscribe {
    this.telemetryCbs.add(cb);
    return () => this.telemetryCbs.delete(cb);
  }

  onConnectionChange(cb: (s: ConnectionState) => void): Unsubscribe {
    this.connectionCbs.add(cb);
    return () => this.connectionCbs.delete(cb);
  }

  async connect(): Promise<void> {
    this.connection = 'connecting';
    this.emit();
    await new Promise((r) => setTimeout(r, 400));
    this.connection = 'connected';
    this.emit();
    this.timer = setInterval(() => {
      this.hr = Math.max(60, Math.min(185, this.hr + (Math.random() - 0.48) * 4));
      for (const cb of this.telemetryCbs) cb({ source: 'hrm', ts: Date.now(), hrBpm: Math.round(this.hr) });
    }, 1000);
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.connection = 'disconnected';
    this.emit();
  }

  private emit(): void {
    for (const cb of this.connectionCbs) cb(this.connection);
  }
}
