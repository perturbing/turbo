import type { RideButton } from '../decoders/zwiftRide';
import type { ControlsPods, PodState, Unsubscribe } from '../types';

// Simulated Zwift Ride pods. The Devices screen (and the on-screen shifter)
// call simulatePress() to inject button events.
export class MockControlsPods implements ControlsPods {
  readonly kind = 'controls' as const;
  private podList: PodState[] = [];

  private buttonCbs = new Set<(b: RideButton) => void>();
  private analogCbs = new Set<(levers: Record<string, number>) => void>();
  private podsCbs = new Set<(pods: PodState[]) => void>();

  get pods(): PodState[] {
    return this.podList.map((p) => ({ ...p }));
  }

  async connectPod(): Promise<void> {
    if (this.podList.length >= 2) return;
    const side = this.podList.length === 0 ? 'right' : 'left';
    this.podList.push({
      id: `mock-pod-${side}`,
      name: `Mock Zwift Ride (${side})`,
      connection: 'connecting',
      batteryPct: null,
    });
    this.emitPods();
    await new Promise((r) => setTimeout(r, 400));
    const pod = this.podList[this.podList.length - 1];
    pod.connection = 'connected';
    pod.batteryPct = side === 'right' ? 95 : 88;
    this.emitPods();
  }

  async disconnectAll(): Promise<void> {
    for (const pod of this.podList) pod.connection = 'disconnected';
    this.emitPods();
  }

  simulatePress(button: RideButton): void {
    for (const cb of this.buttonCbs) cb(button);
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
}
