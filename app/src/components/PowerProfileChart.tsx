import type { ResolvedPlan } from '../data/schema';
import { zoneColor } from '../ui/zones';

interface Props {
  plan: ResolvedPlan;
  // FTP used to resolve the plan; drives zone coloring. null -> neutral color.
  ftpW: number | null;
  height?: number;
  // Rider progress marker (plan seconds); omit for a static preview.
  progressS?: number;
}

// Time-proportional power profile as SVG. Steady blocks are flat, ramps slope.
export function PowerProfileChart({ plan, ftpW, height = 80, progressS }: Props) {
  const width = 600;
  const maxW = Math.max(...plan.steps.map((s) => Math.max(s.targetW, s.targetEndW ?? 0)), 1);
  const x = (t: number) => (t / plan.totalS) * width;
  const y = (w: number) => height - (w / (maxW * 1.15)) * height;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height, display: 'block', borderRadius: 6, background: 'var(--bg-sunken)' }}
      role="img"
      aria-label="Workout power profile"
    >
      {plan.steps.map((s, i) => {
        const x0 = x(s.startS);
        const x1 = x(s.endS);
        const w0 = s.targetW;
        const w1 = s.targetEndW ?? s.targetW;
        const color = zoneColor(Math.max(w0, w1), ftpW);
        return (
          <polygon
            key={i}
            points={`${x0},${height} ${x0},${y(w0)} ${x1},${y(w1)} ${x1},${height}`}
            fill={color}
            opacity={0.85}
          />
        );
      })}
      {progressS !== undefined ? (
        <line x1={x(progressS)} y1={0} x2={x(progressS)} y2={height} stroke="var(--text)" strokeWidth={2} />
      ) : null}
    </svg>
  );
}
