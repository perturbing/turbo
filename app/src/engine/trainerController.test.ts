// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FtmsResult } from '../ble/decoders/ftmsControl';
import type { ConnectionState, Trainer, TelemetryUpdate, TrainerCapabilities, Unsubscribe } from '../ble/types';
import { TrainerController, type ControllerEvent } from './trainerController';

// Scripted trainer: each command takes `latencyMs`, and its outcome is taken
// from a per-command script ('ok' by default). Connection state is driven by
// the test.
type Outcome = 'ok' | 'fail' | 'hang' | 'nocontrol';

class ScriptedTrainer implements Trainer {
  readonly kind = 'trainer' as const;
  readonly name = 'Scripted';
  connection: ConnectionState = 'connected';
  hasControl = false;
  capabilities: TrainerCapabilities = {};
  latencyMs = 100;
  script: Outcome[] = [];
  calls: string[] = [];
  private connectionCbs = new Set<(s: ConnectionState) => void>();

  setConnection(s: ConnectionState): void {
    this.connection = s;
    if (s !== 'connected') this.hasControl = false;
    for (const cb of this.connectionCbs) cb(s);
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async requestControl(): Promise<boolean> {
    this.calls.push('control');
    await this.wait();
    this.hasControl = true;
    return true;
  }
  setTargetPower(watts: number): Promise<FtmsResult> {
    return this.command(`erg ${watts}`);
  }
  setSimulationGrade(gradePct: number): Promise<FtmsResult> {
    return this.command(`sim ${gradePct}`);
  }
  setTargetResistance(raw: number): Promise<FtmsResult> {
    return this.command(`resistance ${raw}`);
  }
  async release(): Promise<void> {
    this.calls.push('release');
    await this.wait();
    this.hasControl = false;
  }
  async readWeightKg(): Promise<number | null> {
    return null;
  }
  async writeWeightKg(): Promise<number | null> {
    return null;
  }
  onTelemetry(_cb: (u: TelemetryUpdate) => void): Unsubscribe {
    return () => {};
  }
  onConnectionChange(cb: (s: ConnectionState) => void): Unsubscribe {
    this.connectionCbs.add(cb);
    return () => this.connectionCbs.delete(cb);
  }
  onControlChange(): Unsubscribe {
    return () => {};
  }

  private async command(label: string): Promise<FtmsResult> {
    this.calls.push(label);
    const outcome = this.script.shift() ?? 'ok';
    if (outcome === 'hang') return new Promise(() => {});
    await this.wait();
    if (outcome === 'fail') return 'operation_failed';
    if (outcome === 'nocontrol') {
      this.hasControl = false;
      return 'control_not_permitted';
    }
    return 'success';
  }
  private wait(): Promise<void> {
    return new Promise((r) => setTimeout(r, this.latencyMs));
  }
}

function setup(opts = {}) {
  const trainer = new ScriptedTrainer();
  const controller = new TrainerController(trainer, opts);
  const events: ControllerEvent[] = [];
  controller.onEvent((e) => events.push(e));
  controller.start();
  return { trainer, controller, events };
}

describe('TrainerController', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies the desired state once control is held and reports it confirmed', async () => {
    const { trainer, controller, events } = setup();
    controller.setDesired({ kind: 'erg', watts: 150 });
    expect(controller.status.inSync).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    expect(trainer.calls).toEqual(['control', 'erg 150']);
    expect(controller.status.inSync).toBe(true);
    expect(events).toEqual([{ type: 'applied', state: { kind: 'erg', watts: 150 }, reason: 'change' }]);
  });

  it('brake sends the trainer\'s max resistance level and releasing re-sends the previous target', async () => {
    const { trainer, controller, events } = setup();
    trainer.hasControl = true;
    trainer.capabilities = { resistanceRange: { min: 0, max: 100, increment: 1 } };
    controller.setDesired({ kind: 'erg', watts: 150 });
    await vi.advanceTimersByTimeAsync(200);
    controller.setDesired({ kind: 'brake' });
    await vi.advanceTimersByTimeAsync(200);
    expect(trainer.calls).toEqual(['erg 150', 'resistance 100']);
    expect(controller.status.confirmed).toEqual({ kind: 'brake' });
    expect(events.at(-1)).toEqual({ type: 'applied', state: { kind: 'brake' }, reason: 'change' });
    controller.setDesired({ kind: 'erg', watts: 150 });
    await vi.advanceTimersByTimeAsync(200);
    expect(trainer.calls).toEqual(['erg 150', 'resistance 100', 'erg 150']);
    expect(controller.status.inSync).toBe(true);
  });

  it('brake falls back to level 100 when the resistance range was not readable', async () => {
    const { trainer, controller } = setup();
    trainer.hasControl = true;
    controller.setDesired({ kind: 'brake' });
    await vi.advanceTimersByTimeAsync(200);
    expect(trainer.calls).toEqual(['resistance 100']);
  });

  it('collapses changes made while a command is in flight into one write of the latest value', async () => {
    const { trainer, controller } = setup();
    trainer.hasControl = true;
    controller.setDesired({ kind: 'erg', watts: 100 });
    await vi.advanceTimersByTimeAsync(10);
    controller.setDesired({ kind: 'erg', watts: 110 });
    controller.setDesired({ kind: 'erg', watts: 120 });
    controller.setDesired({ kind: 'erg', watts: 130 });
    await vi.advanceTimersByTimeAsync(500);
    expect(trainer.calls).toEqual(['erg 100', 'erg 130']);
    expect(controller.status.confirmed).toEqual({ kind: 'erg', watts: 130 });
  });

  it('ignores sub-watt changes (ramp interpolation noise)', async () => {
    const { trainer, controller } = setup();
    trainer.hasControl = true;
    controller.setDesired({ kind: 'erg', watts: 150 });
    await vi.advanceTimersByTimeAsync(200);
    controller.setDesired({ kind: 'erg', watts: 150.6 });
    await vi.advanceTimersByTimeAsync(200);
    expect(trainer.calls).toEqual(['erg 150']);
  });

  it('retries a failed command with backoff and reports each attempt', async () => {
    const { trainer, controller, events } = setup();
    trainer.hasControl = true;
    trainer.script = ['fail', 'fail', 'ok'];
    controller.setDesired({ kind: 'erg', watts: 200 });
    await vi.advanceTimersByTimeAsync(150); // attempt 1 fails
    expect(events.at(-1)).toMatchObject({ type: 'failed', attempt: 1, reason: 'operation_failed' });
    expect(controller.status.consecutiveFailures).toBe(1);
    await vi.advanceTimersByTimeAsync(1200); // backoff 1 s, attempt 2 fails
    expect(events.at(-1)).toMatchObject({ type: 'failed', attempt: 2 });
    await vi.advanceTimersByTimeAsync(2200); // backoff 2 s, attempt 3 succeeds
    expect(events.at(-1)).toEqual({ type: 'applied', state: { kind: 'erg', watts: 200 }, reason: 'retry' });
    expect(trainer.calls).toEqual(['erg 200', 'erg 200', 'erg 200']);
    expect(controller.status.consecutiveFailures).toBe(0);
    expect(controller.status.lastError).toBeNull();
  });

  it('a new desired state is not held back by a previous failure backoff', async () => {
    const { trainer, controller } = setup();
    trainer.hasControl = true;
    trainer.script = ['fail'];
    controller.setDesired({ kind: 'erg', watts: 200 });
    await vi.advanceTimersByTimeAsync(150);
    controller.setDesired({ kind: 'erg', watts: 120 });
    await vi.advanceTimersByTimeAsync(150);
    expect(trainer.calls).toEqual(['erg 200', 'erg 120']);
  });

  it('a command that never settles fails at the deadline and is retried', async () => {
    const { trainer, controller, events } = setup({ commandDeadlineMs: 2000 });
    trainer.hasControl = true;
    trainer.script = ['hang'];
    controller.setDesired({ kind: 'erg', watts: 180 });
    await vi.advanceTimersByTimeAsync(1900);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(events.at(-1)).toMatchObject({ type: 'failed', reason: 'no response from trainer within 2 s' });
    await vi.advanceTimersByTimeAsync(1200);
    expect(events.at(-1)).toMatchObject({ type: 'applied', reason: 'retry' });
  });

  it('re-requests control when the trainer says control is not permitted', async () => {
    const { trainer, controller } = setup();
    trainer.hasControl = true;
    trainer.script = ['nocontrol', 'ok'];
    controller.setDesired({ kind: 'erg', watts: 160 });
    await vi.advanceTimersByTimeAsync(400);
    expect(trainer.calls).toEqual(['erg 160', 'control', 'erg 160']);
    expect(controller.status.inSync).toBe(true);
  });

  it('forgets the confirmed state when the link drops and re-applies it after reconnect', async () => {
    const { trainer, controller, events } = setup();
    controller.setDesired({ kind: 'erg', watts: 212 });
    await vi.advanceTimersByTimeAsync(250);
    trainer.calls = [];
    trainer.setConnection('reconnecting');
    expect(controller.status.confirmed).toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    expect(trainer.calls).toEqual([]); // nothing to send to a dead link
    trainer.setConnection('connected');
    await vi.advanceTimersByTimeAsync(250);
    expect(trainer.calls).toEqual(['control', 'erg 212']);
    expect(events.at(-1)).toEqual({ type: 'applied', state: { kind: 'erg', watts: 212 }, reason: 'reconnect' });
  });

  it('re-asserts an unchanged target periodically', async () => {
    const { trainer, controller, events } = setup({ reassertMs: 5000 });
    trainer.hasControl = true;
    controller.setDesired({ kind: 'erg', watts: 140 });
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(5200);
    expect(trainer.calls).toEqual(['erg 140', 'erg 140']);
    expect(events.at(-1)).toMatchObject({ type: 'applied', reason: 'reassert' });
    await vi.advanceTimersByTimeAsync(5200);
    expect(trainer.calls.length).toBe(3);
  });

  it('reapply() re-sends even a confirmed target', async () => {
    const { trainer, controller, events } = setup();
    trainer.hasControl = true;
    controller.setDesired({ kind: 'sim', gradePct: 2.5 });
    await vi.advanceTimersByTimeAsync(200);
    controller.reapply();
    await vi.advanceTimersByTimeAsync(200);
    expect(trainer.calls).toEqual(['sim 2.5', 'sim 2.5']);
    expect(events.at(-1)).toMatchObject({ type: 'applied', reason: 'reapply' });
  });

  it('release() hands the trainer back and ignores later desired states', async () => {
    const { trainer, controller } = setup();
    trainer.hasControl = true;
    controller.setDesired({ kind: 'erg', watts: 140 });
    await vi.advanceTimersByTimeAsync(200);
    controller.release();
    await vi.advanceTimersByTimeAsync(200);
    expect(trainer.calls).toEqual(['erg 140', 'release']);
    expect(trainer.hasControl).toBe(false);
    controller.setDesired({ kind: 'erg', watts: 200 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(trainer.calls).toEqual(['erg 140', 'release']);
  });

  it('does nothing without a trainer', async () => {
    const controller = new TrainerController(null);
    controller.start();
    controller.setDesired({ kind: 'erg', watts: 140 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(controller.status).toMatchObject({ link: 'none', inSync: false, confirmed: null });
    controller.release();
  });
});
