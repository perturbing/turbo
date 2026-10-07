import type { ControlsPods, HeartRateMonitor, Trainer } from './types';
import { BleTrainer, requestTrainerDevice } from './trainer';
import { BleControlsPods } from './ridePods';
import { BleHeartRateMonitor, requestHrmDevice } from './hrm';
import { MockTrainer } from './mock/mockTrainer';
import { MockControlsPods } from './mock/mockPods';
import { MockHeartRateMonitor } from './mock/mockHrm';
import { useDeviceStore } from '../state/deviceStore';
import * as U from './uuids';

// Singleton device manager: owns the live device objects (which must survive
// route changes) and mirrors their state into the zustand device store.

let mockMode = false;
let trainer: Trainer | null = null;
let pods: ControlsPods | null = null;
let hrm: HeartRateMonitor | null = null;

// device.id -> role, persisted so a page refresh can reattach granted devices
// without probing. device.id is stable per origin in Chromium.
type DeviceRole = 'trainer' | 'pod' | 'hrm';
const ROLES_KEY = 'bike-device-roles';

function loadRoles(): Record<string, DeviceRole> {
  try {
    return JSON.parse(localStorage.getItem(ROLES_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveRole(id: string, role: DeviceRole): void {
  try {
    const roles = loadRoles();
    roles[id] = role;
    localStorage.setItem(ROLES_KEY, JSON.stringify(roles));
  } catch {
    /* storage unavailable -> reattach falls back to probing */
  }
}

export function initDeviceManager(opts: { mock: boolean }): void {
  mockMode = opts.mock;
  useDeviceStore.getState().set({ mockMode });
}

export function isBluetoothSupported(): boolean {
  return mockMode || (typeof navigator !== 'undefined' && !!navigator.bluetooth);
}

export function getTrainer(): Trainer | null {
  return trainer;
}

export function getPods(): ControlsPods | null {
  return pods;
}

export function getHrm(): HeartRateMonitor | null {
  return hrm;
}

function wireTrainer(t: Trainer): void {
  const store = useDeviceStore.getState();
  store.set({ trainerName: t.name, trainerConnection: t.connection, trainerHasControl: t.hasControl });
  t.onConnectionChange((state) =>
    useDeviceStore.getState().set({
      trainerConnection: state,
      trainerPowerRange: t.capabilities.powerRange ?? null,
    }),
  );
  t.onControlChange((hasControl) => useDeviceStore.getState().set({ trainerHasControl: hasControl }));
  t.onTelemetry((u) => {
    const set = useDeviceStore.getState().set;
    const patch: Parameters<typeof set>[0] = {};
    if (u.powerW !== undefined) patch.power = { value: u.powerW, atMs: u.ts };
    if (u.cadenceRpm !== undefined && u.source === 'trainer-power')
      patch.cadence = { value: u.cadenceRpm, atMs: u.ts };
    if (u.speedKmh !== undefined && u.source === 'trainer-bike')
      patch.speed = { value: u.speedKmh, atMs: u.ts };
    set(patch);
  });
}

function wirePods(p: ControlsPods): void {
  p.onPodsChange((podStates) => useDeviceStore.getState().set({ pods: podStates }));
  p.onButton((button) => useDeviceStore.getState().set({ lastButton: { button, atMs: Date.now() } }));
  // A lever returning to centre is OMITTED from the notification, so missing
  // keys mean 0 (same normalization as the Python PoC).
  p.onAnalog((levers) =>
    useDeviceStore.getState().set({
      levers: { left: levers.Lever_L ?? 0, right: levers.Lever_R ?? 0 },
    }),
  );
}

function wireHrm(h: HeartRateMonitor): void {
  const store = useDeviceStore.getState();
  store.set({ hrmName: h.name, hrmConnection: h.connection, hrmBatteryPct: h.batteryPct });
  h.onConnectionChange((state) =>
    useDeviceStore.getState().set({ hrmConnection: state, hrmBatteryPct: h.batteryPct }),
  );
  h.onTelemetry((u) => {
    if (u.hrBpm !== undefined) useDeviceStore.getState().set({ hr: { value: u.hrBpm, atMs: u.ts } });
  });
}

// Each connect function requires a user gesture in real-Bluetooth mode (the
// browser shows a device chooser).
export async function connectTrainer(): Promise<void> {
  if (!trainer) {
    if (mockMode) {
      trainer = new MockTrainer();
    } else {
      const device = await requestTrainerDevice();
      saveRole(device.id, 'trainer');
      trainer = new BleTrainer(device);
    }
    wireTrainer(trainer);
  }
  await trainer.connect();
  useDeviceStore.getState().set({
    trainerName: trainer.name,
    trainerConnection: trainer.connection,
    trainerPowerRange: trainer.capabilities.powerRange ?? null,
  });
  // Take control right away (like the Python PoC): readiness shows it green,
  // and a refusal (e.g. another app holds control) surfaces before ride start.
  // Best-effort — the engine re-requests at start and after reconnects anyway.
  try {
    await trainer.requestControl();
  } catch {
    /* surfaced via the readiness checklist */
  }
  useDeviceStore.getState().set({ trainerHasControl: trainer.hasControl });
}

export async function connectPod(): Promise<void> {
  if (!pods) {
    pods = mockMode ? new MockControlsPods() : new BleControlsPods();
    wirePods(pods);
  }
  if (pods instanceof BleControlsPods) {
    // The chooser runs here (not inside the pods client) so the granted
    // device's role can be recorded for refresh-time reattachment.
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [U.SVC_ZWIFT_RIDE], name: 'Zwift Ride' }],
      optionalServices: [U.SVC_BATTERY, U.SVC_DEVICE_INFO],
    });
    saveRole(device.id, 'pod');
    await pods.attach(device);
  } else {
    await pods.connectPod();
  }
}

export async function connectHrm(): Promise<void> {
  if (!hrm) {
    if (mockMode) {
      hrm = new MockHeartRateMonitor();
    } else {
      const device = await requestHrmDevice();
      saveRole(device.id, 'hrm');
      hrm = new BleHeartRateMonitor(device);
    }
    wireHrm(hrm);
  }
  await hrm.connect();
  useDeviceStore.getState().set({
    hrmName: hrm.name,
    hrmConnection: hrm.connection,
    hrmBatteryPct: hrm.batteryPct,
  });
}

export async function disconnectTrainer(): Promise<void> {
  await trainer?.disconnect();
}

export async function disconnectHrm(): Promise<void> {
  await hrm?.disconnect();
}

export async function disconnectPods(): Promise<void> {
  await pods?.disconnectAll();
}

export function canReattach(): boolean {
  return !mockMode && typeof navigator !== 'undefined' && !!navigator.bluetooth?.getDevices;
}

// Re-attach previously granted devices without the chooser, e.g. after a page
// refresh. gatt.connect() on an already-granted device needs no user gesture,
// so this runs automatically at startup (and from the Devices screen button).
// Devices that are awake connect right away; sleeping ones (pods, HRM) are
// watched via their advertisements and attach the moment they wake up.
// Requires navigator.bluetooth.getDevices() (the "new permissions backend").
export async function reattachGrantedDevices(): Promise<void> {
  if (!canReattach()) return;
  useDeviceStore.getState().set({ reattaching: true });
  try {
    const devices = await navigator.bluetooth.getDevices();
    const roles = loadRoles();
    await Promise.all(
      devices.map(async (device) => {
        try {
          const role = roles[device.id] ?? (await probeRole(device));
          if (!role) return;
          const ok = await attachByRole(device, role);
          if (!ok) watchAndAttach(device, role);
        } catch {
          // Out of range or asleep without advertisement support; the rider
          // can retry from the Devices screen.
        }
      }),
    );
  } finally {
    useDeviceStore.getState().set({ reattaching: false });
  }
}

const CONNECT_TIMEOUT_MS = 15_000;

async function attachByRole(device: BluetoothDevice, role: DeviceRole): Promise<boolean> {
  try {
    if (role === 'trainer') {
      if (trainer && trainer.connection !== 'disconnected') return true;
      if (!trainer) {
        trainer = new BleTrainer(device);
        wireTrainer(trainer);
      }
      const t = trainer;
      await withTimeout(t.connect(), CONNECT_TIMEOUT_MS, () => device.gatt?.disconnect());
      useDeviceStore.getState().set({
        trainerName: t.name,
        trainerConnection: t.connection,
        trainerPowerRange: t.capabilities.powerRange ?? null,
      });
      try {
        await t.requestControl();
      } catch {
        /* readiness shows it */
      }
      useDeviceStore.getState().set({ trainerHasControl: t.hasControl });
      return true;
    }
    if (role === 'pod') {
      if (!pods) {
        pods = new BleControlsPods();
        wirePods(pods);
      }
      if (!(pods instanceof BleControlsPods)) return true;
      const p = pods;
      await withTimeout(p.attach(device), CONNECT_TIMEOUT_MS, () => device.gatt?.disconnect());
      return true;
    }
    // hrm
    if (hrm && hrm.connection !== 'disconnected') return true;
    if (!hrm) {
      hrm = new BleHeartRateMonitor(device);
      wireHrm(hrm);
    }
    const h = hrm;
    await withTimeout(h.connect(), CONNECT_TIMEOUT_MS, () => device.gatt?.disconnect());
    useDeviceStore.getState().set({ hrmName: h.name, hrmConnection: h.connection, hrmBatteryPct: h.batteryPct });
    return true;
  } catch {
    return false;
  }
}

// For a device that is currently asleep/out of range: attach as soon as it
// advertises (pods start advertising on a button press, an HRM when worn).
function watchAndAttach(device: BluetoothDevice, role: DeviceRole): void {
  if (typeof device.watchAdvertisements !== 'function') return;
  const controller = new AbortController();
  const onAd = () => {
    controller.abort();
    void attachByRole(device, role).then((ok) => {
      // Still unreachable (e.g. it went back to sleep): resume watching.
      if (!ok) watchAndAttach(device, role);
    });
  };
  device.addEventListener('advertisementreceived', onAd, { once: true });
  device.watchAdvertisements({ signal: controller.signal }).catch(() => {
    device.removeEventListener('advertisementreceived', onAd);
  });
}

// Fallback classification for granted devices from before roles were recorded:
// connect and look at the GATT table.
async function probeRole(device: BluetoothDevice): Promise<DeviceRole | null> {
  if (!device.gatt) return null;
  const server = await withTimeout(device.gatt.connect(), CONNECT_TIMEOUT_MS, () =>
    device.gatt?.disconnect(),
  );
  const services = await server.getPrimaryServices();
  const has = (short: number) => services.some((s) => s.uuid === numToUuid(short));
  const role: DeviceRole | null = has(U.SVC_FTMS)
    ? 'trainer'
    : has(U.SVC_ZWIFT_RIDE)
      ? 'pod'
      : has(U.SVC_HEART_RATE)
        ? 'hrm'
        : null;
  if (role) saveRole(device.id, role);
  return role;
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
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

function numToUuid(short: number): string {
  return `${short.toString(16).padStart(8, '0')}-0000-1000-8000-00805f9b34fb`;
}
