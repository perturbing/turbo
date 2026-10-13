// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BleTrainer } from './trainer';
import * as U from './uuids';

// Minimal fake of the Web Bluetooth surface the trainer touches. The control
// point's write behaviour is scriptable per call so the failure modes seen on
// the phone (a write that never settles, a write that is rejected) can be
// reproduced deterministically.
type WriteBehaviour = 'ok' | 'hang' | 'reject' | 'ok-no-ack';

class FakeCharacteristic extends EventTarget {
  value: DataView | undefined;
  writes: Uint8Array[] = [];
  behaviours: WriteBehaviour[] = [];
  constructor(readonly uuid: number | string) {
    super();
  }
  async startNotifications(): Promise<this> {
    return this;
  }
  async readValue(): Promise<DataView> {
    throw new Error('not readable');
  }
  writeValueWithResponse(buf: ArrayBuffer): Promise<void> {
    const payload = new Uint8Array(buf.slice(0));
    this.writes.push(payload);
    const behaviour = this.behaviours.shift() ?? 'ok';
    if (behaviour === 'hang') return new Promise(() => {});
    if (behaviour === 'reject') return Promise.reject(new Error('GATT operation already in progress.'));
    if (behaviour === 'ok') {
      // Ack indication arrives shortly after the write response.
      setTimeout(() => this.indicate(Uint8Array.of(0x80, payload[0], 0x01)), 20);
    }
    return Promise.resolve();
  }
  indicate(bytes: Uint8Array): void {
    this.value = new DataView(bytes.buffer);
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}

class FakeService {
  readonly chars = new Map<number | string, FakeCharacteristic>();
  constructor(readonly uuid: number | string, charUuids: (number | string)[]) {
    for (const c of charUuids) this.chars.set(c, new FakeCharacteristic(c));
  }
  async getCharacteristic(uuid: number | string): Promise<FakeCharacteristic> {
    const c = this.chars.get(uuid);
    if (!c) throw new Error(`no characteristic ${uuid}`);
    return c;
  }
}

class FakeGatt {
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  readonly ftms = new FakeService(U.SVC_FTMS, [U.CHR_INDOOR_BIKE_DATA, U.CHR_FTMS_CONTROL_POINT]);
  constructor(private readonly device: FakeDevice) {}
  async connect(): Promise<this> {
    this.connectCalls++;
    this.connected = true;
    return this;
  }
  disconnect(): void {
    this.disconnectCalls++;
    if (!this.connected) return;
    this.connected = false;
    // Chromium queues the event rather than firing it synchronously.
    setTimeout(() => this.device.dispatchEvent(new Event('gattserverdisconnected')), 0);
  }
  async getPrimaryService(uuid: number | string): Promise<FakeService> {
    if (uuid === U.SVC_FTMS) return this.ftms;
    throw new Error(`no service ${uuid}`);
  }
}

class FakeDevice extends EventTarget {
  readonly id = 'fake-kickr';
  readonly name = 'Fake KICKR';
  readonly gatt = new FakeGatt(this);
}

// Awaits a command whose ack the fake delivers on a (fake) timer.
async function settle<T>(p: Promise<T>, ms = 50): Promise<T> {
  await vi.advanceTimersByTimeAsync(ms);
  return p;
}

function controlPoint(device: FakeDevice): FakeCharacteristic {
  return device.gatt.ftms.chars.get(U.CHR_FTMS_CONTROL_POINT)!;
}

async function connectedTrainer(): Promise<{ trainer: BleTrainer; device: FakeDevice; cp: FakeCharacteristic }> {
  const device = new FakeDevice();
  const trainer = new BleTrainer(device as unknown as BluetoothDevice);
  await trainer.connect();
  expect(trainer.connection).toBe('connected');
  return { trainer, device, cp: controlPoint(device) };
}

describe('BleTrainer control-point commands', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('acks a target-power write and takes control first', async () => {
    const { trainer, cp } = await connectedTrainer();
    expect(await settle(trainer.requestControl())).toBe(true);
    const p = trainer.setTargetPower(212);
    await vi.advanceTimersByTimeAsync(50);
    expect(await p).toBe('success');
    expect([...cp.writes[1]]).toEqual([0x05, 212, 0]);
  });

  it('a write that never settles fails after the deadline and does not block the next command', async () => {
    const { trainer, cp } = await connectedTrainer();
    await settle(trainer.requestControl());
    cp.behaviours = ['hang', 'ok'];

    const first = trainer.setTargetPower(212);
    const second = trainer.setTargetPower(118);
    let secondSettled = false;
    void second.then(() => (secondSettled = true));

    await vi.advanceTimersByTimeAsync(5000);
    expect(secondSettled).toBe(false); // still waiting behind the first
    await vi.advanceTimersByTimeAsync(1100);
    expect(await first).toBe('operation_failed');
    await vi.advanceTimersByTimeAsync(100);
    expect(secondSettled).toBe(true);
    expect(await second).toBe('success');
    expect(cp.writes.map((w) => w[0])).toEqual([0x00, 0x05, 0x05]);
    expect(trainer.connection).toBe('connected'); // one isolated failure: no link reset
  });

  it('an ack that never arrives after a successful write also times out', async () => {
    const { trainer, cp } = await connectedTrainer();
    await settle(trainer.requestControl());
    cp.behaviours = ['ok-no-ack'];
    const p = trainer.setTargetPower(150);
    await vi.advanceTimersByTimeAsync(6100);
    expect(await p).toBe('operation_failed');
  });

  it('resets the GATT link after two consecutive failures and reconnects', async () => {
    const { trainer, device, cp } = await connectedTrainer();
    await settle(trainer.requestControl());
    const states: string[] = [];
    trainer.onConnectionChange((s) => states.push(s));
    cp.behaviours = ['hang', 'reject'];

    const a = trainer.setTargetPower(212);
    const b = trainer.setTargetPower(118);
    await vi.advanceTimersByTimeAsync(6100);
    expect(await a).toBe('operation_failed');
    await vi.advanceTimersByTimeAsync(10);
    expect(await b).toBe('operation_failed');

    // Second failure: the trainer drops the link on purpose…
    expect(device.gatt.disconnectCalls).toBe(1);
    expect(trainer.connection).toBe('reconnecting');
    expect(trainer.hasControl).toBe(false);
    // …and comes back after the first (fast) retry.
    await vi.advanceTimersByTimeAsync(1100);
    expect(trainer.connection).toBe('connected');
    expect(device.gatt.connectCalls).toBe(2);
    expect(states).toEqual(['reconnecting', 'connected']);

    // The fresh link works again: control is re-requested, command acked.
    cp.behaviours = ['ok', 'ok'];
    expect(await settle(trainer.requestControl())).toBe(true);
    const c = trainer.setTargetPower(118);
    await vi.advanceTimersByTimeAsync(50);
    expect(await c).toBe('success');
  });

  it('a non-success ack counts as a live link, not a failure', async () => {
    const { trainer, device, cp } = await connectedTrainer();
    await settle(trainer.requestControl());
    cp.behaviours = ['hang', 'ok-no-ack'];
    const a = trainer.setTargetPower(212);
    await vi.advanceTimersByTimeAsync(6100);
    expect(await a).toBe('operation_failed');
    const b = trainer.setTargetPower(118);
    await vi.advanceTimersByTimeAsync(10);
    cp.indicate(Uint8Array.of(0x80, 0x05, 0x03)); // invalid_parameter
    expect(await b).toBe('invalid_parameter');
    expect(device.gatt.disconnectCalls).toBe(0);
    expect(trainer.connection).toBe('connected');
  });

  it('a pending command settles immediately when the link drops', async () => {
    const { trainer, device, cp } = await connectedTrainer();
    await settle(trainer.requestControl());
    cp.behaviours = ['ok-no-ack'];
    const p = trainer.setTargetPower(150);
    await vi.advanceTimersByTimeAsync(10);
    device.gatt.disconnect();
    await vi.advanceTimersByTimeAsync(10);
    expect(await p).toBe('operation_failed');
    expect(trainer.connection).toBe('reconnecting');
  });
});
