// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fromHex } from './bytes';
import { BleControlsPods, RIDE_INPUT_STALE_MS } from './ridePods';
import type { PodState } from './types';
import type { RideButton } from './decoders/zwiftRide';

interface TestPod {
  device: BluetoothDevice;
  state: PodState;
  pressed: Set<RideButton>;
  analog: Record<string, number>;
  inputTimer: ReturnType<typeof setTimeout> | null;
  intentionalDisconnect: boolean;
}

interface RidePodsInternals {
  podList: TestPod[];
  onPodMessage(pod: TestPod, data: Uint8Array): void;
}

function harness() {
  const controls = new BleControlsPods();
  const internals = controls as unknown as RidePodsInternals;
  const pod: TestPod = {
    device: {} as BluetoothDevice,
    state: {
      id: 'left',
      name: 'Zwift Ride',
      connection: 'connected',
      controlState: 'unknown',
      batteryPct: 84,
    },
    pressed: new Set(),
    analog: {},
    inputTimer: null,
    intentionalDisconnect: false,
  };
  internals.podList.push(pod);
  return { controls, internals, pod };
}

afterEach(() => vi.useRealTimers());

describe('BleControlsPods lock safety', () => {
  it('releases a cached full brake as soon as the firmware lock arrives', () => {
    const { controls, internals, pod } = harness();
    const analog: Record<string, number>[] = [];
    controls.onAnalog((value) => analog.push(value));

    internals.onPodMessage(
      pod,
      fromHex('2308ffffffff0f1a05080010c8011a04080110001a04080210001a0408031000'),
    );
    expect(analog.at(-1)).toEqual({ Lever_L: 100, Lever_R: 0 });

    internals.onPodMessage(
      pod,
      fromHex('ff0500ea051f100118840720082809302a4212080110081a0c324343313138314338343639'),
    );
    expect(analog.at(-1)).toEqual({});
    expect(controls.pods[0].controlState).toBe('locked');
  });

  it('fails safe if held-input updates disappear before a lock packet is seen', () => {
    vi.useFakeTimers();
    const { controls, internals, pod } = harness();
    const analog: Record<string, number>[] = [];
    controls.onAnalog((value) => analog.push(value));

    internals.onPodMessage(
      pod,
      fromHex('2308ffffffff0f1a05080010c8011a04080110001a04080210001a0408031000'),
    );
    vi.advanceTimersByTime(RIDE_INPUT_STALE_MS);

    expect(analog.at(-1)).toEqual({});
    expect(controls.pods[0].controlState).toBe('stale');
  });
});
