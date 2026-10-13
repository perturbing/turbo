import type { RideMetrics } from './metrics';
import type { PerformancePoint } from './performance';

// "Load, hold or rest?" — a small, named, versioned rule set. It combines the
// load picture (fitness / fatigue / form) with signs of whether the body is
// absorbing the load (efficiency factor on repeated workouts, effort ratings,
// completion of hard sessions). Every verdict lists its reasons in plain
// words; thresholds are Coggan/Friel conventions and are tunable here.

export const VERDICT_METHOD = 'form-v1';

export const RULES = {
  minRides: 6,
  minDays: 14,
  // Form bands (TSB).
  overreachedBelow: -30,
  productiveBelow: -10,
  freshAbove: 10,
  // Fitness rising faster than this per week is more than most riders absorb.
  maxFitnessRampPerWeek: 7,
  // Efficiency factor on the same workout dropping more than this vs the
  // previous rides of that workout = not absorbing.
  efDropPct: 5,
  // Effort rating jumping this much above the rider's average = struggling.
  rpeJump: 2,
  // A key session is one whose plan peaks at or above this fraction of FTP.
  keySessionIntensity: 0.85,
  compliancePoorBelow: 80,
  testReadyForm: [5, 20] as const,
} as const;

export type Verdict = 'load' | 'hold' | 'rest' | 'insufficient';

export interface RideForVerdict {
  metrics: RideMetrics;
  recipeId?: string;
  state: 'completed' | 'ended-early' | 'recovered' | 'in-progress';
  effortRating?: number;
  // True when the ride was cut short by a device problem, not the rider.
  deviceFailure: boolean;
}

export interface VerdictResult {
  method: typeof VERDICT_METHOD;
  verdict: Verdict;
  headline: string;
  reasons: string[];
  facts: {
    fitness: number;
    fatigue: number;
    form: number;
    fitnessRampPerWeek: number | null;
    rides: number;
    days: number;
  };
  testReady: boolean | null;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

// Absorption signal 1: efficiency factor on the same workout, latest vs the
// mean of the earlier completed rides of it (needs HR on all of them).
function efficiencyDrop(rides: RideForVerdict[]): { recipe: string; dropPct: number; latest: number; before: number } | null {
  const byRecipe = new Map<string, RideForVerdict[]>();
  for (const r of rides) {
    if (!r.recipeId || r.state !== 'completed' || r.metrics.efficiencyFactor === null) continue;
    byRecipe.set(r.recipeId, [...(byRecipe.get(r.recipeId) ?? []), r]);
  }
  let worst: { recipe: string; dropPct: number; latest: number; before: number } | null = null;
  for (const [recipe, list] of byRecipe) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => a.metrics.date.localeCompare(b.metrics.date));
    const latest = sorted[sorted.length - 1].metrics.efficiencyFactor!;
    const earlier = sorted.slice(0, -1).slice(-3).map((r) => r.metrics.efficiencyFactor!);
    const before = earlier.reduce((a, b) => a + b, 0) / earlier.length;
    const dropPct = ((before - latest) / before) * 100;
    if (!worst || dropPct > worst.dropPct) worst = { recipe, dropPct, latest, before };
  }
  return worst;
}

// Absorption signal 2: effort ratings climbing above the rider's own norm.
function effortJump(rides: RideForVerdict[]): { latest: number; usual: number } | null {
  const rated = rides.filter((r) => r.effortRating !== undefined).sort((a, b) => a.metrics.date.localeCompare(b.metrics.date));
  if (rated.length < 4) return null;
  const recent = rated.slice(-2);
  const earlier = rated.slice(0, -2);
  const usual = earlier.reduce((a, r) => a + r.effortRating!, 0) / earlier.length;
  const latest = recent.reduce((a, r) => a + r.effortRating!, 0) / recent.length;
  return latest - usual >= RULES.rpeJump ? { latest, usual } : null;
}

// Absorption signal 3: the last two key sessions were not completed or held.
function keySessionsFailing(rides: RideForVerdict[]): number {
  const key = rides
    .filter((r) => (r.metrics.plannedPeakIntensity ?? 0) >= RULES.keySessionIntensity && !r.deviceFailure)
    .sort((a, b) => a.metrics.date.localeCompare(b.metrics.date))
    .slice(-2);
  if (key.length < 2) return 0;
  return key.filter((r) => r.state !== 'completed' || (r.metrics.compliancePct ?? 100) < RULES.compliancePoorBelow).length;
}

export function assessForm(
  series: PerformancePoint[],
  today: string,
  rides: RideForVerdict[],
  rampTestPlannedWithinDays: number | null = null,
): VerdictResult {
  const todayPoint = series.find((p) => p.date === today) ?? series[series.length - 1];
  const fitness = todayPoint?.fitness ?? 0;
  const fatigue = todayPoint?.fatigue ?? 0;
  const form = todayPoint?.form ?? 0;
  const weekAgo = series.find((p) => p.date === addDaysLocal(today, -7));
  const ramp = weekAgo ? fitness - weekAgo.fitness : null;
  const dates = rides.map((r) => r.metrics.date).sort();
  const days = dates.length ? daysBetweenLocal(dates[0], today) + 1 : 0;
  const facts = { fitness: round1(fitness), fatigue: round1(fatigue), form: round1(form), fitnessRampPerWeek: ramp === null ? null : round1(ramp), rides: rides.length, days };

  if (rides.length < RULES.minRides || days < RULES.minDays) {
    const need = [
      rides.length < RULES.minRides ? `${RULES.minRides - rides.length} more ride${RULES.minRides - rides.length === 1 ? '' : 's'}` : null,
      days < RULES.minDays ? `${RULES.minDays - days} more day${RULES.minDays - days === 1 ? '' : 's'} of history` : null,
    ].filter(Boolean);
    return {
      method: VERDICT_METHOD,
      verdict: 'insufficient',
      headline: 'Not enough history yet',
      reasons: [
        `A verdict needs at least ${RULES.minRides} rides over ${RULES.minDays} days; you need ${need.join(' and ')}.`,
        'Fitness and fatigue are already accumulating from every ride you record.',
      ],
      facts,
      testReady: null,
    };
  }

  const reasons: string[] = [];
  const flags: string[] = [];

  if (form < RULES.overreachedBelow) {
    reasons.push(`Form is ${round1(form)}: fatigue is far ahead of fitness. Below ${RULES.overreachedBelow} the usual advice is to rest.`);
  } else if (form < RULES.productiveBelow) {
    reasons.push(`Form is ${round1(form)}: you are carrying fatigue in the productive band (${RULES.overreachedBelow} to ${RULES.productiveBelow}).`);
  } else if (form > RULES.freshAbove) {
    reasons.push(`Form is +${round1(form)}: you are fresh. Fitness fades if this lasts, so this is a good moment to add load or test.`);
  } else {
    reasons.push(`Form is ${form >= 0 ? '+' : ''}${round1(form)}: neutral, neither fresh nor tired.`);
  }

  if (ramp !== null && ramp > RULES.maxFitnessRampPerWeek) {
    flags.push('ramp');
    reasons.push(`Fitness rose ${round1(ramp)} points this week, more than the ${RULES.maxFitnessRampPerWeek} most riders absorb. Let it settle.`);
  }

  const ef = efficiencyDrop(rides);
  if (ef && ef.dropPct > RULES.efDropPct) {
    flags.push('ef');
    reasons.push(`Efficiency on your repeated workout fell ${round1(ef.dropPct)}% (${ef.before.toFixed(2)} to ${ef.latest.toFixed(2)} W per bpm): heart rate is higher for the same power. That is a sign the load is not being absorbed.`);
  } else if (ef) {
    reasons.push(`Efficiency on your repeated workout is ${ef.dropPct <= 0 ? 'up' : 'steady'} (${ef.before.toFixed(2)} to ${ef.latest.toFixed(2)} W per bpm): the load is being absorbed.`);
  } else {
    reasons.push('No workout has been ridden three times with heart rate yet, so efficiency cannot be compared. Repeating an endurance ride every week or two gives the clearest fitness signal.');
  }

  const rpe = effortJump(rides);
  if (rpe) {
    flags.push('rpe');
    reasons.push(`Your last rides felt harder than usual (effort ${round1(rpe.latest)} against your average of ${round1(rpe.usual)}).`);
  }

  const failing = keySessionsFailing(rides);
  if (failing >= 2) {
    flags.push('key');
    reasons.push('The last two hard sessions were cut short or not held. Hard work that cannot be completed is not training the right thing.');
  } else if (failing === 1) {
    reasons.push('One of the last two hard sessions was cut short or not held.');
  }

  let verdict: Verdict;
  let headline: string;
  if (form < RULES.overreachedBelow || flags.filter((f) => f !== 'ramp').length >= 2) {
    verdict = 'rest';
    headline = 'Rest: the load is ahead of what you are absorbing';
  } else if (flags.length >= 1) {
    verdict = 'hold';
    headline = 'Hold: keep the load where it is';
  } else {
    verdict = 'load';
    headline = form > RULES.freshAbove ? 'Load: you are fresh and absorbing well' : 'Load: the body is keeping up, you can add';
  }

  const [lo, hi] = RULES.testReadyForm;
  const testReady = form >= lo && form <= hi;
  if (rampTestPlannedWithinDays !== null) {
    reasons.push(
      testReady
        ? `A maximal test is planned within ${rampTestPlannedWithinDays} day${rampTestPlannedWithinDays === 1 ? '' : 's'} and your form is in the test window (+${lo} to +${hi}).`
        : `A maximal test is planned within ${rampTestPlannedWithinDays} day${rampTestPlannedWithinDays === 1 ? '' : 's'} but your form is outside the test window (+${lo} to +${hi}); ease off beforehand or the result will understate you.`,
    );
  }

  return { method: VERDICT_METHOD, verdict, headline, reasons, facts, testReady };
}

function addDaysLocal(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetweenLocal(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000);
}
