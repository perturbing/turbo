import { create } from 'zustand';
import type { ConnectionState, PodState } from '../ble/types';
import type { Range } from '../ble/decoders/ftmsControl';
import type { RideButton } from '../ble/decoders/zwiftRide';

export interface LiveMetric {
  value: number;
  atMs: number;
}

interface DeviceState {
  bluetoothSupported: boolean;
  mockMode: boolean;
  // True while startup reattachment of previously granted devices is running.
  reattaching: boolean;

  trainerName: string | null;
  trainerConnection: ConnectionState;
  trainerHasControl: boolean;
  trainerPowerRange: Range | null;

  pods: PodState[];
  lastButton: { button: RideButton; atMs: number } | null;
  // Analog lever positions, -100..+100 (0 = centred). The pods omit
  // zero-valued levers on the wire; the device manager normalizes that.
  levers: { left: number; right: number };

  hrmName: string | null;
  hrmConnection: ConnectionState;
  hrmBatteryPct: number | null;

  // Latest instantaneous values with receive time; consumers decide freshness.
  power: LiveMetric | null;
  cadence: LiveMetric | null;
  speed: LiveMetric | null;
  hr: LiveMetric | null;

  set: (partial: Partial<DeviceState>) => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  bluetoothSupported: typeof navigator !== 'undefined' && !!navigator.bluetooth,
  mockMode: false,
  reattaching: false,
  trainerName: null,
  trainerConnection: 'disconnected',
  trainerHasControl: false,
  trainerPowerRange: null,
  pods: [],
  lastButton: null,
  levers: { left: 0, right: 0 },
  hrmName: null,
  hrmConnection: 'disconnected',
  hrmBatteryPct: null,
  power: null,
  cadence: null,
  speed: null,
  hr: null,
  set: (partial) => set(partial),
}));

export const FRESHNESS_MS = 3000;

// Distinguishes "Waiting for data" (never received), "Signal lost" (stale) and
// a real value — a true 0 W is a value, not a gap.
export function metricDisplay(m: LiveMetric | null, nowMs: number): { kind: 'waiting' | 'stale' | 'value'; value?: number } {
  if (!m) return { kind: 'waiting' };
  if (nowMs - m.atMs > FRESHNESS_MS) return { kind: 'stale' };
  return { kind: 'value', value: m.value };
}
