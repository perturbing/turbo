import * as U from './uuids';
import {
  decodeRideBattery,
  decodeRideLockState,
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
  inputTimer: ReturnType<typeof setTimeout> | null;
  intentionalDisconnect: boolean;
}

// A held button/lever is normally repeated every ~60-120 ms. If that stream
// stops, retaining the last value is unsafe (most notably for the brake).
export const RIDE_INPUT_STALE_MS = 750;

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
        state: {
          id: device.id,
          name: device.name ?? 'Zwift Ride',
          connection: 'connecting',
          controlState: 'unknown',
          batteryPct: null,
        },
        pressed: new Set(),
        analog: {},
        inputTimer: null,
        intentionalDisconnect: false,
      };
      this.podList.push(pod);
      device.addEventListener('gattserverdisconnected', () => this.onPodDisconnected(pod!));
    }
    pod.intentionalDisconnect = false;
    this.clearPodInput(pod, true);
    pod.state.connection = 'connecting';
    pod.state.controlState = 'unknown';
    this.emitPods();
    try {
      await this.setupPod(pod);
      pod.state.connection = 'connected';
    } catch (e) {
      this.clearPodInput(pod, true);
      pod.state.connection = 'disconnected';
      pod.state.controlState = 'unknown';
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
      this.setControlState(pod, 'active');
      pod.pressed = new Set(state.pressed);
      this.mergeAndEmit();
      // Zero-valued levers are omitted on the wire; make them explicit, then
      // merge across pods (the left pod mirrors the right pod's state but not
      // vice versa, so single-pod frames would flicker the merged value).
      pod.analog = { Lever_L: 0, Lever_R: 0, ...state.analog };
      const merged = mergeAnalog(this.podList.map((p) => p.analog));
      for (const cb of this.analogCbs) cb(merged);
      this.armInputWatchdog(pod);
    } else if (type === RIDE_MSG.battery) {
      const pct = decodeRideBattery(data);
      if (pct !== null && pct !== pod.state.batteryPct) {
        pod.state.batteryPct = pct;
        this.emitPods();
      }
    } else if (type === RIDE_MSG.deviceInfo) {
      const lockState = decodeRideLockState(data);
      if (lockState === 'locked') {
        // GATT remains connected after the firmware locks, so explicitly
        // release any cached button/lever state. This prevents a brake value
        // from surviving indefinitely while only 0x15 heartbeats continue.
        this.clearPodInput(pod, true);
        this.setControlState(pod, 'locked');
      } else if (lockState === 'unlocked') {
        this.setControlState(pod, 'active');
      }
    }
    // 0x15 idle ticks and 0x2a handshake info are intentionally ignored.
  }

  private setControlState(pod: Pod, state: PodState['controlState']): void {
    if (pod.state.controlState === state) return;
    pod.state.controlState = state;
    this.emitPods();
  }

  private armInputWatchdog(pod: Pod): void {
    if (pod.inputTimer !== null) clearTimeout(pod.inputTimer);
    pod.inputTimer = null;
    const held =
      pod.pressed.size > 0 || Object.values(pod.analog).some((value) => value !== 0);
    if (!held) return;
    pod.inputTimer = setTimeout(() => {
      pod.inputTimer = null;
      if (pod.state.controlState !== 'active') return;
      this.clearPodInput(pod, true);
      this.setControlState(pod, 'stale');
    }, RIDE_INPUT_STALE_MS);
  }

  private clearPodInput(pod: Pod, forceAnalogEmit = false): void {
    if (pod.inputTimer !== null) clearTimeout(pod.inputTimer);
    pod.inputTimer = null;
    const hadInput =
      pod.pressed.size > 0 || Object.values(pod.analog).some((value) => value !== 0);
    pod.pressed = new Set();
    pod.analog = {};
    this.mergeAndEmit();
    if (hadInput || forceAnalogEmit) {
      const merged = mergeAnalog(this.podList.map((p) => p.analog));
      for (const cb of this.analogCbs) cb(merged);
    }
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
    this.clearPodInput(pod, true);
    pod.state.controlState = 'unknown';
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
      this.clearPodInput(pod, true);
      pod.device.gatt?.disconnect();
      pod.state.connection = 'disconnected';
      pod.state.controlState = 'unknown';
    }
    this.emitPods();
  }
}
