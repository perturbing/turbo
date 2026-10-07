import type {
  PowerTarget,
  ResolvedPlan,
  ResolvedStep,
  SimpleBlock,
  WorkoutRecipe,
} from '../data/schema';

export function resolveTarget(target: PowerTarget, ftpW: number | null): number {
  if (target.basis === 'watts') return Math.round(target.watts);
  if (ftpW === null) throw new FtpRequiredError();
  return Math.round((target.pct / 100) * ftpW);
}

export class FtpRequiredError extends Error {
  constructor() {
    super('This workout scales from FTP, but no FTP is set.');
  }
}

export function recipeNeedsFtp(recipe: WorkoutRecipe): boolean {
  const usesPct = (b: SimpleBlock): boolean =>
    b.kind === 'ramp'
      ? b.startTarget.basis === 'ftpPct' || b.endTarget.basis === 'ftpPct'
      : b.target.basis === 'ftpPct';
  return recipe.blocks.some((b) => (b.kind === 'repeat' ? b.blocks.some(usesPct) : usesPct(b)));
}

export function recipeTotalSeconds(recipe: WorkoutRecipe): number {
  return recipe.blocks.reduce((sum, b) => {
    if (b.kind === 'repeat') return sum + b.count * b.blocks.reduce((s, x) => s + x.durationS, 0);
    return sum + b.durationS;
  }, 0);
}

// Expands repeat groups (one level) and resolves every target to watts against
// the given FTP. The result is snapshotted into the ride recording at start so
// later FTP or recipe edits never alter what a past ride was meant to do.
export function resolvePlan(recipe: WorkoutRecipe, ftpW: number | null): ResolvedPlan {
  const steps: ResolvedStep[] = [];
  let t = 0;

  const pushSimple = (block: SimpleBlock, repeatTag?: string) => {
    const label = repeatTag && block.label ? `${block.label} ${repeatTag}` : block.label;
    if (block.kind === 'ramp') {
      steps.push({
        startS: t,
        endS: t + block.durationS,
        kind: 'ramp',
        targetW: resolveTarget(block.startTarget, ftpW),
        targetEndW: resolveTarget(block.endTarget, ftpW),
        cadence: block.cadence,
        label,
      });
    } else {
      steps.push({
        startS: t,
        endS: t + block.durationS,
        kind: block.kind,
        targetW: resolveTarget(block.target, ftpW),
        cadence: block.cadence,
        label,
      });
    }
    t += block.durationS;
  };

  for (const block of recipe.blocks) {
    if (block.kind === 'repeat') {
      for (let i = 1; i <= block.count; i++) {
        for (const inner of block.blocks) pushSimple(inner, `${i}/${block.count}`);
      }
    } else {
      pushSimple(block);
    }
  }

  return { totalS: t, steps };
}

// Target power at a moment within the plan (linear interpolation inside ramps).
export function targetAt(plan: ResolvedPlan, elapsedS: number): ResolvedStep | null {
  const step = plan.steps.find((s) => elapsedS >= s.startS && elapsedS < s.endS);
  return step ?? null;
}

export function interpolatedTargetW(step: ResolvedStep, elapsedS: number): number {
  if (step.targetEndW === undefined) return step.targetW;
  const frac = (elapsedS - step.startS) / (step.endS - step.startS);
  return Math.round(step.targetW + (step.targetEndW - step.targetW) * Math.min(1, Math.max(0, frac)));
}

export function formatDuration(totalS: number): string {
  const s = Math.round(totalS);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return sec ? `${h}h ${m}m ${sec}s` : `${h}h ${m}m`;
  if (m > 0) return sec ? `${m}m ${sec}s` : `${m} min`;
  return `${sec}s`;
}
