import * as U from './uuids';
import { parseHeartRate } from './decoders/heartRate';
import type { ConnectionState, HeartRateMonitor, TelemetryUpdate, Unsubscribe } from './types';

export class BleHeartRateMonitor implements HeartRateMonitor {
  readonly kind = 'hrm' as const;
  connection: ConnectionState = 'disconnected';
  batteryPct: number | null = null;

  private intentionalDisconnect = false;
  private telemetryCbs = new Set<(u: TelemetryUpdate) => void>();
  private connectionCbs = new Set<(s: ConnectionState) => void>();

  constructor(private readonly device: BluetoothDevice) {
    device.addEventListener('gattserverdisconnected', () => this.onDisconnected());
  }

  get name(): string {
    return this.device.name ?? 'Heart rate';
  }

  onTelemetry(cb: (u: TelemetryUpdate) => void): Unsubscribe {
    this.telemetryCbs.add(cb);
    return () => this.telemetryCbs.delete(cb);
  }

  onConnectionChange(cb: (s: ConnectionState) => void): Unsubscribe {
    this.connectionCbs.add(cb);
    return () => this.connectionCbs.delete(cb);
  }

  private setConnection(s: ConnectionState): void {
    this.connection = s;
    for (const cb of this.connectionCbs) cb(s);
  }

  async connect(): Promise<void> {
    this.intentionalDisconnect = false;
    this.setConnection('connecting');
    try {
      await this.setup();
      this.setConnection('connected');
    } catch (e) {
      this.setConnection('disconnected');
      throw e;
    }
  }

  private async setup(): Promise<void> {
    const server = await this.device.gatt!.connect();
    const svc = await server.getPrimaryService(U.SVC_HEART_RATE);
    const hrm = await svc.getCharacteristic(U.CHR_HEART_RATE_MEASUREMENT);
    hrm.addEventListener('characteristicvaluechanged', (ev) => {
      const value = (ev.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;
      const s = parseHeartRate(value);
      for (const cb of this.telemetryCbs) cb({ source: 'hrm', ts: Date.now(), hrBpm: s.hrBpm });
    });
    await hrm.startNotifications();
    try {
      const battery = await server.getPrimaryService(U.SVC_BATTERY);
      const level = await battery.getCharacteristic(U.CHR_BATTERY_LEVEL);
      this.batteryPct = (await level.readValue()).getUint8(0);
    } catch {
      /* optional */
    }
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.device.gatt?.disconnect();
    this.setConnection('disconnected');
  }

  private onDisconnected(): void {
    if (this.intentionalDisconnect) {
      this.setConnection('disconnected');
      return;
    }
    this.setConnection('reconnecting');
    void this.reconnectLoop();
  }

  private async reconnectLoop(): Promise<void> {
    for (let attempt = 0; attempt < 24 && this.connection === 'reconnecting'; attempt++) {
      await new Promise((r) => setTimeout(r, 5000));
      if (this.connection !== 'reconnecting') return;
      try {
        await this.setup();
        this.setConnection('connected');
        return;
      } catch {
        // keep trying
      }
    }
    if (this.connection === 'reconnecting') this.setConnection('disconnected');
  }
}

export async function requestHrmDevice(): Promise<BluetoothDevice> {
  return navigator.bluetooth.requestDevice({
    filters: [{ services: [U.SVC_HEART_RATE] }],
    optionalServices: [U.SVC_BATTERY, U.SVC_DEVICE_INFO],
  });
}
