import * as U from './uuids';
import {
  decodeRideBattery,
  decodeRideNotification,
  isRideOnAck,
  mergeAnalog,
  RIDE_HANDSHAKE,
  RIDE_MSG,
  type RideButton,
} from './decoders/zwiftRide';
import type { ControlsPods, PodState, Unsubscribe } from './types';

interface Pod {
  device: BluetoothDevice;
  state: PodState;
  pressed: Set<RideButton>;
  // Latest lever readings from THIS pod, zeros made explicit (the wire format
  // omits zero-valued levers).
  analog: Record<string, number>;
  intentionalDisconnect: boolean;
}

// The Zwift Ride is two BLE peripherals (one per pod) and the left pod mirrors
// the right pod's buttons, so each right-side press can arrive twice. Presses
// are emitted from the MERGED state across pods: a button fires once, on
// whichever connection reports it first, and again only after every pod has
// seen it released. Pods sleep and disconnect on their own; reconnects are quiet.
export class BleControlsPods implements ControlsPods {
  readonly kind = 'controls' as const;
  private podList: Pod[] = [];
  private mergedPrev = new Set<RideButton>();

  private buttonCbs = new Set<(b: RideButton) => void>();
  private analogCbs = new Set<(levers: Record<string, number>) => void>();
  private podsCbs = new Set<(pods: PodState[]) => void>();

  get pods(): PodState[] {
    return this.podList.map((p) => ({ ...p.state }));
  }

  onButton(cb: (b: RideButton) => void): Unsubscribe {
    this.buttonCbs.add(cb);
    return () => this.buttonCbs.delete(cb);
  }

  onAnalog(cb: (levers: Record<string, number>) => void): Unsubscribe {
    this.analogCbs.add(cb);
    return () => this.analogCbs.delete(cb);
  }

  onPodsChange(cb: (pods: PodState[]) => void): Unsubscribe {
    this.podsCbs.add(cb);
    return () => this.podsCbs.delete(cb);
  }

  private emitPods(): void {
    const pods = this.pods;
    for (const cb of this.podsCbs) cb(pods);
  }

  // One user gesture per pod: Web Bluetooth shows one chooser per call.
  // The KICKR also ADVERTISES 0xfc82 (verified via chrome://bluetooth-internals),
  // but its GATT table keeps the Zwift characteristics under a different
  // service — so the name filter keeps the trainer out of the pod chooser.
  async connectPod(): Promise<void> {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [U.SVC_ZWIFT_RIDE], name: 'Zwift Ride' }],
      optionalServices: [U.SVC_BATTERY, U.SVC_DEVICE_INFO],
    });
    await this.attach(device);
  }

  async attach(device: BluetoothDevice): Promise<void> {
    let pod = this.podList.find((p) => p.device.id === device.id);
    if (!pod) {
      pod = {
        device,
        state: { id: device.id, name: device.name ?? 'Zwift Ride', connection: 'connecting', batteryPct: null },
        pressed: new Set(),
        analog: {},
        intentionalDisconnect: false,
      };
      this.podList.push(pod);
      device.addEventListener('gattserverdisconnected', () => this.onPodDisconnected(pod!));
    }
    pod.intentionalDisconnect = false;
    pod.state.connection = 'connecting';
    this.emitPods();
    try {
      await this.setupPod(pod);
      pod.state.connection = 'connected';
    } catch (e) {
      pod.state.connection = 'disconnected';
      this.emitPods();
      throw e;
    }
    this.emitPods();
  }

  private async setupPod(pod: Pod): Promise<void> {
    const server = await pod.device.gatt!.connect();
    const svc = await server.getPrimaryService(U.SVC_ZWIFT_RIDE);

    const asyncChar = await svc.getCharacteristic(U.CHR_ZWIFT_ASYNC);
    asyncChar.addEventListener('characteristicvaluechanged', (ev) => {
      const value = (ev.target as BluetoothRemoteGATTCharacteristic).value;
      if (value) this.onPodMessage(pod, new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    });
    await asyncChar.startNotifications();

    const syncTx = await svc.getCharacteristic(U.CHR_ZWIFT_SYNC_TX);
    const ack = new Promise<void>((resolve) => {
      const handler = (ev: Event) => {
        const value = (ev.target as BluetoothRemoteGATTCharacteristic).value;
        if (value && isRideOnAck(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))) {
          syncTx.removeEventListener('characteristicvaluechanged', handler);
          resolve();
        }
      };
      syncTx.addEventListener('characteristicvaluechanged', handler);
      // The bare handshake worked on every observed firmware; don't block
      // forever if the ack is missed.
      setTimeout(resolve, 3000);
    });
    await syncTx.startNotifications();

    const syncRx = await svc.getCharacteristic(U.CHR_ZWIFT_SYNC_RX);
    await syncRx.writeValueWithResponse(RIDE_HANDSHAKE.buffer as ArrayBuffer);
    await ack;

    try {
      const battery = await server.getPrimaryService(U.SVC_BATTERY);
      const level = await battery.getCharacteristic(U.CHR_BATTERY_LEVEL);
      const value = await level.readValue();
      pod.state.batteryPct = value.getUint8(0);
    } catch {
      /* optional */
    }
  }

  private onPodMessage(pod: Pod, data: Uint8Array): void {
    if (data.byteLength === 0) return;
    const type = data[0];
    if (type === RIDE_MSG.controllerState) {
      const state = decodeRideNotification(data);
      pod.pressed = new Set(state.pressed);
      this.mergeAndEmit();
      // Zero-valued levers are omitted on the wire; make them explicit, then
      // merge across pods (the left pod mirrors the right pod's state but not
      // vice versa, so single-pod frames would flicker the merged value).
      pod.analog = { Lever_L: 0, Lever_R: 0, ...state.analog };
      const merged = mergeAnalog(this.podList.map((p) => p.analog));
      for (const cb of this.analogCbs) cb(merged);
    } else if (type === RIDE_MSG.battery) {
      const pct = decodeRideBattery(data);
      if (pct !== null && pct !== pod.state.batteryPct) {
        pod.state.batteryPct = pct;
        this.emitPods();
      }
    }
    // 0x15 idle ticks, 0x2a handshake info and 0xff device info are ignored.
  }

  private mergeAndEmit(): void {
    const merged = new Set<RideButton>();
    for (const pod of this.podList) for (const b of pod.pressed) merged.add(b);
    for (const b of merged) {
      if (!this.mergedPrev.has(b)) {
        for (const cb of this.buttonCbs) cb(b);
      }
    }
    this.mergedPrev = merged;
  }

  private onPodDisconnected(pod: Pod): void {
    pod.pressed = new Set();
    pod.analog = {};
    this.mergeAndEmit();
    for (const cb of this.analogCbs) cb(mergeAnalog(this.podList.map((p) => p.analog)));
    if (pod.intentionalDisconnect) {
      pod.state.connection = 'disconnected';
      this.emitPods();
      return;
    }
    pod.state.connection = 'reconnecting';
    this.emitPods();
    void this.reconnectLoop(pod);
  }

  // The left pod commonly times out on first connect and simply needs a retry;
  // pods also sleep on their own. Generous retries with 5 s backoff.
  private async reconnectLoop(pod: Pod): Promise<void> {
    for (let attempt = 0; attempt < 60 && pod.state.connection === 'reconnecting'; attempt++) {
      await new Promise((r) => setTimeout(r, 5000));
      if (pod.state.connection !== 'reconnecting') return;
      try {
        await this.setupPod(pod);
        pod.state.connection = 'connected';
        this.emitPods();
        return;
      } catch {
        // pod likely still asleep; keep trying
      }
    }
    if (pod.state.connection === 'reconnecting') {
      pod.state.connection = 'disconnected';
      this.emitPods();
    }
  }

  async disconnectAll(): Promise<void> {
    for (const pod of this.podList) {
      pod.intentionalDisconnect = true;
      pod.device.gatt?.disconnect();
      pod.state.connection = 'disconnected';
    }
    this.emitPods();
  }
}
