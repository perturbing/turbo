// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { leversBrake } from './rideStore';

describe('leversBrake', () => {
  it('either lever pulled to its brake side engages the brake', () => {
    expect(leversBrake({ Lever_L: 100 }, false)).toBe(true);
    expect(leversBrake({ Lever_R: -100 }, false)).toBe(true);
    // Steering directions are not braking.
    expect(leversBrake({ Lever_L: -100 }, false)).toBe(false);
    expect(leversBrake({ Lever_R: 100 }, false)).toBe(false);
  });

  it('a centred lever (omitted from the notification) releases', () => {
    expect(leversBrake({}, true)).toBe(false);
  });

  it('has hysteresis between engaging and releasing', () => {
    expect(leversBrake({ Lever_L: 30 }, false)).toBe(false);
    expect(leversBrake({ Lever_L: 30 }, true)).toBe(true);
    expect(leversBrake({ Lever_L: 15 }, true)).toBe(false);
  });
});
