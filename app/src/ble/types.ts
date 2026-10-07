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
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export type Unsubscribe = () => void;

export interface TrainerCapabilities {
  powerRange?: Range;
  // FTMS raw units: 0..100 raw = levels 0.0-10.0 (0.1 resolution). Provisional —
  // never exercised on hardware; we use SIM mode instead of resistance mode.
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
