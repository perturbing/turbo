import { create } from 'zustand';
import type { EngineSnapshot } from '../engine/rideEngine';
import { RideEngine, type EngineOptions } from '../engine/rideEngine';
import type { ResolvedPlan, RideMode, RideRecording, WorkoutRecipe } from '../data/schema';
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
}

interface RideState {
  prepared: PreparedSession | null;
  engine: RideEngine | null;
  snapshot: EngineSnapshot | null;
  lastFinished: RideRecording | null;
  prepare: (session: PreparedSession) => void;
  startRide: () => Promise<void>;
  clearFinished: () => void;
}

let engineUnsubs: Unsubscribe[] = [];

export const useRideStore = create<RideState>((set, get) => ({
  prepared: null,
  engine: null,
  snapshot: null,
  lastFinished: null,

  // Clearing lastFinished here keeps the ride screens' state-driven navigation
  // from bouncing a fresh session straight to the completion screen.
  prepare: (session) => set({ prepared: session, lastFinished: null }),

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
      }),
    );
    engineUnsubs.push(engine.onSnapshot((snapshot) => set({ snapshot })));
    engineUnsubs.push(
      engine.onFinished((rec) => {
        for (const u of engineUnsubs) u();
        engineUnsubs = [];
        set({ engine: null, snapshot: null, prepared: null, lastFinished: rec });
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

    set({ engine, snapshot: engine.snapshot() });
    await engine.start();
  },

  clearFinished: () => set({ lastFinished: null }),
}));
