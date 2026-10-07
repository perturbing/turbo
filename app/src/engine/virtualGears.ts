// Shift mode (provisional — design doc §11.3 leaves the exact trainer command
// mapping open). Virtual gears are implemented with FTMS Indoor Bike Simulation
// (opcode 0x11, wind 0, defaults crr 0.004 / cw 0.51): each gear maps to a
// simulated grade, so the rider's gearing+cadence determine power like outdoors.
// Resistance mode (0x04) is avoided entirely because its scale was never
// verified on hardware. Confirm gear feel on the real trainer.

export const GEAR_COUNT = 24;
export const DEFAULT_GEAR = 12; // 1-based; gear 12 ~ flat road

export function gearToGradePct(gear: number): number {
  const clamped = clampGear(gear);
  return (clamped - DEFAULT_GEAR) * 0.5; // -5.5 % .. +6.0 %
}

export function clampGear(gear: number): number {
  return Math.max(1, Math.min(GEAR_COUNT, Math.round(gear)));
}
