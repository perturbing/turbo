import * as U from './uuids';
import { CrankTracker, parseCyclingPower } from './decoders/cyclingPower';
import { parseIndoorBikeData } from './decoders/indoorBikeData';
import {
  buildRequestControl,
  buildReset,
  buildSetSimulation,
  buildSetTargetPower,
  parseFtmsAck,
  parseRange,
  type FtmsAck,
  type FtmsResult,
} from './decoders/ftmsControl';
import type { ConnectionState, Trainer, TrainerCapabilities, TelemetryUpdate, Unsubscribe } from './types';

// A control-point command is the write (with response) followed by the
// `80 <opcode> <result>` indication. Either half can silently never settle on
// some platforms (observed on Android: the write promise never resolved even
// though the trainer applied the target), so the WHOLE command runs against one
// deadline. A command that times out is reported as failed and the queue moves
// on — the engine retries on its next tick.
const COMMAND_TIMEOUT_MS = 6000;
// After this many consecutive failed commands the GATT link is assumed wedged
// and is dropped on purpose so the normal reconnect path re-establishes it.
const MAX_CONSECUTIVE_FAILURES = 2;
const RECONNECT_FIRST_DELAY_MS = 1000;
const RECONNECT_RETRY_DELAY_MS = 5000;
const SETUP_TIMEOUT_MS = 15_000;

export class BleTrainer implements Trainer {
  readonly kind = 'trainer' as const;
  connection: ConnectionState = 'disconnected';
  hasControl = false;
  capabilities: TrainerCapabilities = {};

  private server: BluetoothRemoteGATTServer | null = null;
  private controlPoint: BluetoothRemoteGATTCharacteristic | null = null;
  private crank = new CrankTracker();
  private pendingAck: { opcode: number; resolve: (ack: FtmsAck | null) => void } | null = null;
  // Serialize control-point commands: one in flight at a time.
  private commandQueue: Promise<unknown> = Promise.resolve();
  private intentionalDisconnect = false;
  private consecutiveFailures = 0;
  private recovering = false;

  private telemetryCbs = new Set<(u: TelemetryUpdate) => void>();
  private connectionCbs = new Set<(s: ConnectionState) => void>();
  private controlCbs = new Set<(c: boolean) => void>();

  constructor(private readonly device: BluetoothDevice) {
    device.addEventListener('gattserverdisconnected', () => this.onDisconnected());
  }

  get name(): string {
    return this.device.name ?? 'Trainer';
  }

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

  private setConnection(s: ConnectionState): void {
    this.connection = s;
    for (const cb of this.connectionCbs) cb(s);
  }

  private setControl(c: boolean): void {
    if (this.hasControl === c) return;
    this.hasControl = c;
    for (const cb of this.controlCbs) cb(c);
  }

  private emitTelemetry(u: TelemetryUpdate): void {
    for (const cb of this.telemetryCbs) cb(u);
  }

  async connect(): Promise<void> {
    if (!this.device.gatt) throw new Error('Device has no GATT server.');
    this.intentionalDisconnect = false;
    this.setConnection('connecting');
    try {
      this.server = await this.device.gatt.connect();
      await this.setup();
      this.setConnection('connected');
    } catch (e) {
      this.setConnection('disconnected');
      throw e;
    }
  }

  // Startup order ported from the Python PoC (kickr.py): read capabilities
  // (best-effort) -> subscribe power, bike data, control-point indications,
  // machine status (best-effort; never observed firing). Control is requested
  // on demand, not here.
  private async setup(): Promise<void> {
    const ftms = await this.server!.getPrimaryService(U.SVC_FTMS);

    try {
      const powerRange = await ftms.getCharacteristic(U.CHR_SUPPORTED_POWER_RANGE);
      this.capabilities.powerRange = parseRange(await powerRange.readValue());
    } catch {
      /* optional */
    }
    try {
      const resRange = await ftms.getCharacteristic(U.CHR_SUPPORTED_RESISTANCE_RANGE);
      this.capabilities.resistanceRange = parseRange(await resRange.readValue());
    } catch {
      /* optional */
    }

    try {
      const cps = await this.server!.getPrimaryService(U.SVC_CYCLING_POWER);
      const cpm = await cps.getCharacteristic(U.CHR_CYCLING_POWER_MEASUREMENT);
      cpm.addEventListener('characteristicvaluechanged', (ev) => {
        const value = (ev.target as BluetoothRemoteGATTCharacteristic).value;
        if (value) this.onCyclingPower(value);
      });
      await cpm.startNotifications();
    } catch {
      // Cycling Power is the preferred cadence source but FTMS alone still works.
    }

    const bike = await ftms.getCharacteristic(U.CHR_INDOOR_BIKE_DATA);
    bike.addEventListener('characteristicvaluechanged', (ev) => {
      const value = (ev.target as BluetoothRemoteGATTCharacteristic).value;
      if (value) this.onIndoorBikeData(value);
    });
    await bike.startNotifications();

    this.controlPoint = await ftms.getCharacteristic(U.CHR_FTMS_CONTROL_POINT);
    this.controlPoint.addEventListener('characteristicvaluechanged', (ev) => {
      const value = (ev.target as BluetoothRemoteGATTCharacteristic).value;
      if (value) this.onControlIndication(value);
    });
    await this.controlPoint.startNotifications();

    try {
      const status = await ftms.getCharacteristic(U.CHR_FTMS_STATUS);
      await status.startNotifications();
    } catch {
      /* best-effort; the KICKR never emitted anything here */
    }
  }

  private onCyclingPower(value: DataView): void {
    const s = parseCyclingPower(value);
    const u: TelemetryUpdate = { source: 'trainer-power', ts: Date.now(), powerW: s.powerW };
    if (s.crankRevs !== undefined && s.crankEventTime1024 !== undefined) {
      u.cadenceRpm = this.crank.update(s.crankRevs, s.crankEventTime1024);
    }
    this.emitTelemetry(u);
  }

  private onIndoorBikeData(value: DataView): void {
    const s = parseIndoorBikeData(value);
    this.emitTelemetry({
      source: 'trainer-bike',
      ts: Date.now(),
      powerW: s.powerW,
      cadenceRpm: s.cadenceRpm,
      speedKmh: s.speedKmh,
    });
  }

  private onControlIndication(value: DataView): void {
    const ack = parseFtmsAck(value);
    if (ack && this.pendingAck && ack.requestOpcode === this.pendingAck.opcode) {
      const pending = this.pendingAck;
      this.pendingAck = null;
      pending.resolve(ack);
    }
    // Acks for opcodes we are not waiting on are stale; dropping them is the
    // TS equivalent of the Python queue-drain before each write.
  }

  // Write with response, then await the matching `80 <opcode> <result>`
  // indication, the whole exchange under one deadline. Commands are strictly
  // serialized; a timed-out command never blocks the next one.
  private sendCommand(payload: Uint8Array): Promise<FtmsResult> {
    const run = () => this.execute(payload);
    const next = this.commandQueue.then(run, run);
    this.commandQueue = next.catch(() => undefined);
    return next;
  }

  private async execute(payload: Uint8Array): Promise<FtmsResult> {
    const controlPoint = this.controlPoint;
    if (!controlPoint || this.connection !== 'connected') return 'operation_failed';
    const opcode = payload[0];
    const pending: { opcode: number; resolve: (ack: FtmsAck | null) => void } = { opcode, resolve: () => {} };
    const ackPromise = new Promise<FtmsAck | null>((resolve) => {
      pending.resolve = resolve;
    });
    this.pendingAck = pending;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), COMMAND_TIMEOUT_MS);
    });
    const exchange = async (): Promise<FtmsAck | null> => {
      await controlPoint.writeValueWithResponse(payload.buffer as ArrayBuffer);
      return ackPromise;
    };

    let outcome: FtmsResult = 'operation_failed';
    let acked = false;
    try {
      const raced = await Promise.race([exchange(), deadline]);
      // 'timeout': write or ack never came back; null: link dropped mid-command.
      if (raced !== 'timeout' && raced !== null) {
        acked = true;
        outcome = raced.result;
      }
    } catch {
      // writeValueWithResponse rejected (e.g. "GATT operation already in
      // progress" after a previous write wedged, or a NetworkError).
    } finally {
      if (timer) clearTimeout(timer);
      // A late ack for this command must not be matched to a later one.
      if (this.pendingAck === pending) this.pendingAck = null;
    }

    if (outcome === 'control_not_permitted') this.setControl(false);
    // Any ack — even a non-success result — proves the link is alive; only
    // commands that never came back count towards a link reset.
    if (acked) this.consecutiveFailures = 0;
    else this.noteCommandFailure();
    return outcome;
  }

  private noteCommandFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) this.recoverLink();
  }

  // Drop a wedged GATT link on purpose. `gattserverdisconnected` then fires and
  // the normal reconnect loop re-establishes the session; the engine sees the
  // usual interrupted -> reconnected flow and re-applies its target on resume.
  private recoverLink(): void {
    if (this.recovering || this.connection !== 'connected') return;
    this.recovering = true;
    this.consecutiveFailures = 0;
    this.intentionalDisconnect = false;
    try {
      this.device.gatt?.disconnect();
    } catch {
      /* the disconnect event (or its absence) decides what happens next */
    }
    // Some stacks do not fire the disconnect event for a locally initiated
    // disconnect; treat the link as gone regardless so a reconnect runs.
    if (this.connection === 'connected') this.onDisconnected();
  }

  async requestControl(): Promise<boolean> {
    if (this.hasControl) return true;
    const result = await this.sendCommand(buildRequestControl());
    this.setControl(result === 'success');
    return this.hasControl;
  }

  async setTargetPower(watts: number): Promise<FtmsResult> {
    return this.sendCommand(buildSetTargetPower(watts));
  }

  async setSimulationGrade(gradePct: number): Promise<FtmsResult> {
    return this.sendCommand(buildSetSimulation({ gradePct }));
  }

  async release(): Promise<void> {
    if (this.hasControl) {
      await this.sendCommand(buildReset());
      this.setControl(false);
    }
  }

  private async weightCharacteristic(): Promise<BluetoothRemoteGATTCharacteristic | null> {
    try {
      const svc = await this.server!.getPrimaryService(U.SVC_USER_DATA);
      return await svc.getCharacteristic(U.CHR_WEIGHT);
    } catch {
      // Service absent, or not covered by the Bluetooth grant (trainer paired
      // before weight support was added) — re-pairing includes it.
      return null;
    }
  }

  async readWeightKg(): Promise<number | null> {
    if (this.connection !== 'connected') return null;
    const chr = await this.weightCharacteristic();
    if (!chr) return null;
    try {
      const value = await chr.readValue();
      return value.getUint16(0, true) * 0.005;
    } catch {
      return null;
    }
  }

  async writeWeightKg(kg: number): Promise<number | null> {
    if (this.connection !== 'connected') return null;
    const chr = await this.weightCharacteristic();
    if (!chr) return null;
    const raw = Math.round(kg / 0.005);
    const buf = new Uint8Array(2);
    new DataView(buf.buffer).setUint16(0, raw, true);
    await chr.writeValueWithResponse(buf.buffer as ArrayBuffer);
    // Read back: the trainer is the source of truth for what was accepted.
    return this.readWeightKg();
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.device.gatt?.disconnect();
    this.setControl(false);
    this.controlPoint = null;
    const pending = this.pendingAck;
    this.pendingAck = null;
    pending?.resolve(null);
    this.setConnection('disconnected');
  }

  private onDisconnected(): void {
    if (this.connection === 'disconnected' || this.connection === 'reconnecting') return;
    this.setControl(false);
    this.crank.reset();
    this.controlPoint = null;
    this.consecutiveFailures = 0;
    // Settle whatever command is waiting for an ack so the queue moves on.
    const pending = this.pendingAck;
    this.pendingAck = null;
    pending?.resolve(null);
    if (this.intentionalDisconnect) {
      this.recovering = false;
      this.setConnection('disconnected');
      return;
    }
    this.setConnection('reconnecting');
    void this.reconnectLoop();
  }

  // First retry after 1 s (a deliberate link reset should heal fast), then a
  // 5 s backoff like the PoC's keep() wrapper. Each attempt is bounded so a
  // hung GATT connect/setup cannot stall the loop. Gives up after ~2 min; the
  // Devices screen offers a manual reconnect.
  private async reconnectLoop(): Promise<void> {
    for (let attempt = 0; attempt < 24 && this.connection === 'reconnecting'; attempt++) {
      await new Promise((r) => setTimeout(r, attempt === 0 ? RECONNECT_FIRST_DELAY_MS : RECONNECT_RETRY_DELAY_MS));
      if (this.connection !== 'reconnecting') return;
      try {
        await withTimeout(
          (async () => {
            this.server = await this.device.gatt!.connect();
            await this.setup();
          })(),
          SETUP_TIMEOUT_MS,
          () => this.device.gatt?.disconnect(),
        );
        this.recovering = false;
        this.setConnection('connected');
        return;
      } catch {
        // keep trying
      }
    }
    this.recovering = false;
    if (this.connection === 'reconnecting') this.setConnection('disconnected');
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        onTimeout();
      } catch {
        /* best-effort */
      }
      reject(new Error('timeout'));
    }, ms);
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

export async function requestTrainerDevice(): Promise<BluetoothDevice> {
  return navigator.bluetooth.requestDevice({
    filters: [{ services: [U.SVC_FTMS] }],
    optionalServices: [U.SVC_CYCLING_POWER, U.SVC_DEVICE_INFO, U.SVC_USER_DATA],
  });
}
