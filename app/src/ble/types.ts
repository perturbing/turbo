import type { RideButton } from './decoders/zwiftRide';
import type { FtmsResult, Range } from './decoders/ftmsControl';

// One decoded telemetry update from any source. Values are instantaneous.
export interface TelemetryUpdate {
  source: 'trainer-power' | 'trainer-bike' | 'hrm';
  ts: number; // epoch ms
  powerW?: number;
  cadenceRpm?: number;
  speedKmh?: number;
  hrBpm?: number;
  // Beat-to-beat intervals since the previous notification (chest straps
  // only). Feeds the DFA alpha-1 threshold analysis; never shown live.
  rrIntervalsS?: number[];
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

// A Ride pod can remain connected at the BLE/GATT layer while firmware 1.3+
// locks its controls and suppresses controller-state notifications.
export type PodControlState = 'unknown' | 'active' | 'locked' | 'stale';

export type Unsubscribe = () => void;

export interface TrainerCapabilities {
  powerRange?: Range;
  // FTMS raw units: 0..100 raw = levels 0.0-10.0 (0.1 resolution). Only its
  // `max` is used, as the brake level (see setTargetResistance).
  resistanceRange?: Range;
}

export interface Trainer {
  readonly kind: 'trainer';
  readonly name: string;
  readonly connection: ConnectionState;
  readonly hasControl: boolean;
  readonly capabilities: TrainerCapabilities;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  // Resolves true only after the FTMS success ack — the UI must never claim a
  // target was applied without acknowledgement.
  requestControl(): Promise<boolean>;
  setTargetPower(watts: number): Promise<FtmsResult>;
  setSimulationGrade(gradePct: number): Promise<FtmsResult>;
  // FTMS resistance level in raw wire units; replaces ERG/SIM until the next
  // target is sent. The brake sends `capabilities.resistanceRange.max`.
  setTargetResistance(raw: number): Promise<FtmsResult>;
  release(): Promise<void>;
  // Rider weight stored ON the trainer (User Data 0x2A98); drives SIM-mode
  // physics. null = not readable (service absent, or not in the Bluetooth
  // grant — re-pair the trainer to include it).
  readWeightKg(): Promise<number | null>;
  // Resolves to the read-back value so the UI never claims an unconfirmed write.
  writeWeightKg(kg: number): Promise<number | null>;
  onTelemetry(cb: (u: TelemetryUpdate) => void): Unsubscribe;
  onConnectionChange(cb: (state: ConnectionState) => void): Unsubscribe;
  onControlChange(cb: (hasControl: boolean) => void): Unsubscribe;
}

export interface PodState {
  id: string;
  name: string;
  connection: ConnectionState;
  controlState: PodControlState;
  batteryPct: number | null;
}

export interface ControlsPods {
  readonly kind: 'controls';
  readonly pods: PodState[];
  connectPod(): Promise<void>; // one user gesture per pod
  disconnectAll(): Promise<void>;
  // Merged across pods: fires once per press (first pod to report), re-arms
  // only after every pod reports release.
  onButton(cb: (button: RideButton) => void): Unsubscribe;
  onAnalog(cb: (levers: Record<string, number>) => void): Unsubscribe;
  onPodsChange(cb: (pods: PodState[]) => void): Unsubscribe;
}

export interface HeartRateMonitor {
  readonly kind: 'hrm';
  readonly name: string;
  readonly connection: ConnectionState;
  readonly batteryPct: number | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onTelemetry(cb: (u: TelemetryUpdate) => void): Unsubscribe;
  onConnectionChange(cb: (state: ConnectionState) => void): Unsubscribe;
}
