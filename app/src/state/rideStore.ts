import { create } from 'zustand';
import type { EngineSnapshot } from '../engine/rideEngine';
import { RideEngine, type EngineOptions } from '../engine/rideEngine';
import type { ResolvedPlan, RideMode, RideRecording, RideSample, WorkoutRecipe } from '../data/schema';
import { getPods, getTrainer } from '../ble/deviceManager';
import { useDeviceStore } from './deviceStore';
import type { Unsubscribe } from '../ble/types';

// A session prepared on the setup screen, consumed by the live ride screen.
export interface PreparedSession {
  kind: 'workout' | 'rampTest';
  recipe?: WorkoutRecipe;
  plan: ResolvedPlan | null;
  mode: RideMode;
  ftpUsed: number | null;
  name: string;
  intensityPct?: number;
}

interface RideState {
  prepared: PreparedSession | null;
  engine: RideEngine | null;
  snapshot: EngineSnapshot | null;
  lastFinished: RideRecording | null;
  // Set when the finished ride could not be (fully) written: the error and the
  // engine's samples, so the completion screen can still export the whole ride.
  saveFailure: { error: string; samples: readonly RideSample[] } | null;
  prepare: (session: PreparedSession) => void;
  startRide: () => Promise<void>;
  clearFinished: () => void;
  updateFinished: (patch: Partial<RideRecording>) => void;
}

let engineUnsubs: Unsubscribe[] = [];

// Lever pull toward the brake side: left lever +100, right lever -100 (see
// zwiftRide.ts). A lever back at centre is omitted from the notification, so a
// missing key is 0. Hysteresis keeps a lever resting near the threshold from
// chattering the brake on and off.
const BRAKE_ON_PCT = 40;
const BRAKE_OFF_PCT = 20;
export function leversBrake(levers: Record<string, number>, braking: boolean): boolean {
  const pull = Math.max(levers.Lever_L ?? 0, -(levers.Lever_R ?? 0));
  return braking ? pull > BRAKE_OFF_PCT : pull >= BRAKE_ON_PCT;
}

export const useRideStore = create<RideState>((set, get) => ({
  prepared: null,
  engine: null,
  snapshot: null,
  lastFinished: null,
  saveFailure: null,

  // Clearing lastFinished here keeps the ride screens' state-driven navigation
  // from bouncing a fresh session straight to the completion screen.
  prepare: (session) => set({ prepared: session, lastFinished: null, saveFailure: null }),

  startRide: async () => {
    const prepared = get().prepared;
    if (!prepared || get().engine) return;

    const opts: EngineOptions = {
      kind: prepared.kind,
      recordingId: crypto.randomUUID(),
      name: prepared.name,
      mode: prepared.mode,
      ftpUsed: prepared.ftpUsed,
      plan: prepared.plan,
      recipeId: prepared.recipe?.id,
      recipeRevision: prepared.recipe?.revision,
      intensityPct: prepared.intensityPct,
      trainer: getTrainer(),
      // HR is piped from the device store below instead of binding an HRM
      // instance at start — a strap that connects mid-ride is then recorded too.
      hrm: null,
    };
    const engine = new RideEngine(opts);
    engineUnsubs.push(
      useDeviceStore.subscribe((state, prevState) => {
        if (state.hr && state.hr !== prevState.hr) {
          engine.pushTelemetry({ source: 'hrm', ts: state.hr.atMs, hrBpm: state.hr.value });
        }
        if (state.rr && state.rr !== prevState.rr) {
          engine.pushTelemetry({ source: 'hrm', ts: state.rr.atMs, rrIntervalsS: state.rr.intervalsS });
        }
      }),
    );
    engineUnsubs.push(engine.onSnapshot((snapshot) => set({ snapshot })));
    engineUnsubs.push(
      engine.onFinished((rec) => {
        for (const u of engineUnsubs) u();
        engineUnsubs = [];
        const error = engine.snapshot().saveError;
        set({
          engine: null,
          snapshot: null,
          prepared: null,
          lastFinished: rec,
          saveFailure: error ? { error, samples: engine.getSamples() } : null,
        });
      }),
    );

    // Hardware shifters drive Shift mode; in ERG they are ignored by design
    // until a button mapping is defined (design doc §8).
    const pods = getPods();
    if (pods && prepared.mode === 'shift') {
      engineUnsubs.push(
        pods.onButton((button) => {
          if (button === 'Shift_R_Top' || button === 'Shift_R_Extra') engine.shift(1);
          else if (button === 'Shift_R_Bottom' || button === 'Shift_L_Extra') engine.shift(-1);
        }),
      );
    }
    // The Zwift Ride brake levers hold the flywheel brake in every mode.
    if (pods) {
      engineUnsubs.push(pods.onAnalog((levers) => engine.setBrake(leversBrake(levers, engine.snapshot().braking))));
    }

    set({ engine, snapshot: engine.snapshot() });
    await engine.start();
  },

  clearFinished: () => set({ lastFinished: null, saveFailure: null }),
  updateFinished: (patch) => set((s) => (s.lastFinished ? { lastFinished: { ...s.lastFinished, ...patch } } : {})),
}));
