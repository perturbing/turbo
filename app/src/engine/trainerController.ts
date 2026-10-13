import type { ConnectionState, Trainer, Unsubscribe } from '../ble/types';

// Desired-state reconciler for the trainer.
//
// The ride engine never sends commands. It declares what the trainer should be
// doing right now (`setDesired`) and this controller continuously drives the
// device toward it: it requests control when needed, sends the command, waits
// for the FTMS ack, retries with backoff when a command fails, forgets what it
// knew when the link drops (so a reconnect re-applies everything), and
// periodically re-asserts an unchanged target as insurance against the trainer
// silently dropping ERG. Changing the desired state ten times while a command
// is in flight collapses to one write of the latest value.

export type DesiredTrainerState =
  | { kind: 'erg'; watts: number }
  | { kind: 'sim'; gradePct: number }
  | { kind: 'released' };

// 'reassert' is the periodic re-send of an unchanged target; 'reapply' is an
// explicit request (e.g. resume) and is worth logging.
export type ApplyReason = 'change' | 'retry' | 'reconnect' | 'reapply' | 'reassert';

export type ControllerEvent =
  | { type: 'applied'; state: DesiredTrainerState; reason: ApplyReason }
  | { type: 'failed'; state: DesiredTrainerState; reason: string; attempt: number };

export interface ControllerStatus {
  link: ConnectionState | 'none';
  desired: DesiredTrainerState | null;
  // Last state the trainer acknowledged on the current link; null = unknown.
  confirmed: DesiredTrainerState | null;
  inSync: boolean;
  consecutiveFailures: number;
  lastError: string | null;
}

export interface ControllerOptions {
  // One command (control request + write + ack) as seen from here.
  commandDeadlineMs?: number;
  // Re-send an unchanged, confirmed target this often; 0 disables.
  reassertMs?: number;
  // Retry backoff after a failed command: base * 2^(n-1), capped.
  retryBaseMs?: number;
  retryMaxMs?: number;
  // How often the controller wakes up to check for retries/re-asserts.
  pollMs?: number;
}

const DEFAULTS: Required<ControllerOptions> = {
  commandDeadlineMs: 10_000,
  reassertMs: 30_000,
  retryBaseMs: 1000,
  retryMaxMs: 5000,
  pollMs: 1000,
};

export function sameState(a: DesiredTrainerState | null, b: DesiredTrainerState | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'erg' && b.kind === 'erg') return Math.abs(a.watts - b.watts) < 1;
  if (a.kind === 'sim' && b.kind === 'sim') return Math.abs(a.gradePct - b.gradePct) < 0.01;
  return true; // released
}

export class TrainerController {
  private readonly opts: Required<ControllerOptions>;
  private desired: DesiredTrainerState | null = null;
  private confirmed: DesiredTrainerState | null = null;
  private confirmedAtMs = 0;
  private consecutiveFailures = 0;
  private lastError: string | null = null;
  private nextAttemptAtMs = 0;
  private pendingReason: ApplyReason = 'change';
  private running = false;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  // Precise wake-up for the next retry or re-assert; the poll is a safety net.
  private wake: ReturnType<typeof setTimeout> | null = null;
  private unsubs: Unsubscribe[] = [];
  private listeners = new Set<(e: ControllerEvent) => void>();

  constructor(
    private readonly trainer: Trainer | null,
    opts: ControllerOptions = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  onEvent(cb: (e: ControllerEvent) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  get status(): ControllerStatus {
    return {
      link: this.trainer ? this.trainer.connection : 'none',
      desired: this.desired,
      confirmed: this.confirmed,
      inSync: this.desired !== null && sameState(this.desired, this.confirmed),
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError,
    };
  }

  start(): void {
    if (this.stopped || this.timer) return;
    if (this.trainer) {
      this.unsubs.push(
        this.trainer.onConnectionChange((state) => {
          // Whatever the trainer held is gone with the link; a fresh link
          // starts from "unknown" so the desired state is applied in full.
          this.confirmed = null;
          this.nextAttemptAtMs = 0;
          if (state === 'connected') {
            this.pendingReason = 'reconnect';
            this.kick();
          }
        }),
      );
    }
    this.timer = setInterval(() => this.kick(), this.opts.pollMs);
    this.kick();
  }

  // Stops reconciling. An in-flight command still settles on its own.
  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.wake) clearTimeout(this.wake);
    this.wake = null;
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  setDesired(state: DesiredTrainerState): void {
    if (this.stopped || sameState(this.desired, state)) return;
    this.desired = state;
    this.nextAttemptAtMs = 0; // a new target is never held back by an old failure's backoff
    this.pendingReason = 'change';
    this.kick();
  }

  // Re-apply the desired state even if it is believed confirmed (e.g. resume
  // after a pause: the design requires the target to be reapplied).
  reapply(): void {
    if (this.stopped) return;
    this.confirmed = null;
    this.nextAttemptAtMs = 0;
    this.pendingReason = 'reapply';
    this.kick();
  }

  // Hand the trainer back and stop. The release command is bounded by the
  // deadline and never awaited by callers.
  release(): void {
    if (this.stopped) return;
    this.setDesired({ kind: 'released' });
    this.stop();
  }

  private kick(): void {
    if (!this.running) void this.reconcile();
  }

  private scheduleWake(atMs: number): void {
    if (this.stopped) return;
    if (this.wake) clearTimeout(this.wake);
    this.wake = setTimeout(
      () => {
        this.wake = null;
        this.kick();
      },
      Math.max(0, atMs - Date.now()) + 1,
    );
  }

  private async reconcile(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const target = this.desired;
        const trainer = this.trainer;
        if (!target || !trainer || trainer.connection !== 'connected') return;
        const now = Date.now();
        const stale =
          this.opts.reassertMs > 0 && target.kind !== 'released' && now - this.confirmedAtMs >= this.opts.reassertMs;
        if (sameState(target, this.confirmed) && !stale) {
          if (this.opts.reassertMs > 0 && target.kind !== 'released') this.scheduleWake(this.confirmedAtMs + this.opts.reassertMs);
          return;
        }
        if (now < this.nextAttemptAtMs) {
          this.scheduleWake(this.nextAttemptAtMs); // backoff
          return;
        }
        const reason: ApplyReason = sameState(target, this.confirmed) ? 'reassert' : this.pendingReason;

        let result: string;
        try {
          result = await withDeadline(this.apply(trainer, target), this.opts.commandDeadlineMs);
        } catch (e) {
          result = e instanceof Error ? e.message : 'write failed';
        }

        if (result === 'success') {
          this.confirmed = target;
          this.confirmedAtMs = Date.now();
          this.consecutiveFailures = 0;
          this.lastError = null;
          this.pendingReason = 'change';
          this.emit({ type: 'applied', state: target, reason });
          if (target.kind === 'released') return;
          // Desired may have moved on while the command was in flight: loop.
        } else {
          this.consecutiveFailures++;
          this.lastError = result;
          this.pendingReason = 'retry';
          const backoff = Math.min(
            this.opts.retryMaxMs,
            this.opts.retryBaseMs * 2 ** Math.max(0, this.consecutiveFailures - 1),
          );
          this.nextAttemptAtMs = Date.now() + backoff;
          this.emit({ type: 'failed', state: target, reason: result, attempt: this.consecutiveFailures });
          return;
        }
        if (this.stopped && sameState(this.desired, this.confirmed)) return;
      }
    } finally {
      this.running = false;
    }
  }

  private async apply(trainer: Trainer, state: DesiredTrainerState): Promise<string> {
    if (state.kind === 'released') {
      await trainer.release();
      return 'success';
    }
    if (!trainer.hasControl && !(await trainer.requestControl())) return 'control not granted';
    const send = () =>
      state.kind === 'erg' ? trainer.setTargetPower(state.watts) : trainer.setSimulationGrade(state.gradePct);
    let result = await send();
    if (result === 'control_not_permitted' && (await trainer.requestControl())) result = await send();
    return result;
  }

  private emit(e: ControllerEvent): void {
    for (const cb of this.listeners) cb(e);
  }
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no response from trainer within ${ms / 1000} s`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
