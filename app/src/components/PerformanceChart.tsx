import { useRef, useState } from 'react';
import type { PerformancePoint } from '../engine/performance';

// Performance management chart: daily load as faint bars, fitness / fatigue /
// form as lines on ONE axis (all in TSS units; form can be negative). Days
// after today come from the calendar and are drawn dashed. Hover gives a
// crosshair with the day's values. Series colors validated for the dark
// surface (lightness band, CVD separation, contrast) — see dataviz notes.

export const SERIES = {
  fitness: { label: 'Fitness', color: '#2f85dc' },
  fatigue: { label: 'Fatigue', color: '#c9761f' },
  form: { label: 'Form', color: '#22a56b' },
} as const;

const VBW = 720;
const M = { top: 12, right: 56, bottom: 26, left: 44 };

function niceStep(rough: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(rough, 1e-9)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= rough) return m * pow;
  return 10 * pow;
}

function shortDate(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function PerformanceChart({ series, today, height = 240 }: { series: PerformancePoint[]; today: string; height?: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverI, setHoverI] = useState<number | null>(null);
  if (series.length < 2) return null;

  const n = series.length;
  const values = series.flatMap((p) => [p.fitness, p.fatigue, p.form, p.tss]);
  const rawMax = Math.max(...values, 10);
  const rawMin = Math.min(...values, 0);
  const step = niceStep((rawMax - rawMin) / 5);
  const yMax = Math.ceil((rawMax * 1.05) / step) * step;
  const yMin = Math.floor(rawMin / step) * step;
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) yTicks.push(Math.round(v * 100) / 100);

  const plotW = VBW - M.left - M.right;
  const plotH = height - M.top - M.bottom;
  const x = (i: number) => M.left + (i / (n - 1)) * plotW;
  const y = (v: number) => M.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const todayI = Math.max(
    0,
    series.findIndex((p) => p.date >= today),
  );

  // Week ticks on the x axis, at most ~8.
  const everyDays = Math.max(7, Math.ceil(n / 8 / 7) * 7);
  const xTicks = series.map((_, i) => i).filter((i) => (n - 1 - i) % everyDays === 0);

  const path = (key: 'fitness' | 'fatigue' | 'form', from: number, to: number) =>
    series
      .slice(from, to + 1)
      .map((p, j) => `${j === 0 ? 'M' : 'L'}${x(from + j).toFixed(1)},${y(p[key]).toFixed(1)}`)
      .join('');

  const barW = Math.max(1, (plotW / n) * 0.7);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vx = ((e.clientX - rect.left) / rect.width) * VBW;
    setHoverI(Math.round(Math.max(0, Math.min(n - 1, ((vx - M.left) / plotW) * (n - 1)))));
  };
  const hover = hoverI === null ? null : series[hoverI];
  const last = series[n - 1];

  return (
    <div>
      <div className="row between small" style={{ marginBottom: 2, flexWrap: 'wrap' }}>
        <span className="row" style={{ gap: 12 }}>
          {(Object.keys(SERIES) as (keyof typeof SERIES)[]).map((k) => (
            <span key={k}>
              <span style={{ color: SERIES[k].color }}>■</span> {SERIES[k].label}
            </span>
          ))}
          <span>
            <span className="muted">▮</span> Daily load (TSS)
          </span>
          <span className="muted">dashed = planned</span>
        </span>
        {hover ? (
          <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {shortDate(hover.date)}
            {hover.projected ? ' (planned)' : ''} · load {Math.round(hover.tss)} · fitness {hover.fitness.toFixed(1)} · fatigue{' '}
            {hover.fatigue.toFixed(1)} · form {hover.form >= 0 ? '+' : ''}
            {hover.form.toFixed(1)}
          </span>
        ) : null}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VBW} ${height}`}
        style={{ width: '100%', display: 'block', background: 'var(--bg-sunken)', borderRadius: 6 }}
        role="img"
        aria-label="Fitness, fatigue and form over time"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverI(null)}
      >
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={M.left} x2={VBW - M.right} y1={y(tick)} y2={y(tick)} stroke="var(--border)" strokeWidth={tick === 0 ? 1.5 : 0.5} />
            <text x={M.left - 6} y={y(tick) + 3.5} textAnchor="end" fontSize={11} fill="var(--text-dim)">
              {tick}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={M.top + plotH} y2={M.top + plotH + 4} stroke="var(--border)" />
            <text x={x(i)} y={height - 9} textAnchor="middle" fontSize={11} fill="var(--text-dim)">
              {shortDate(series[i].date)}
            </text>
          </g>
        ))}
        {/* Daily load bars, anchored at zero */}
        {series.map((p, i) =>
          p.tss > 0 ? (
            <rect
              key={p.date}
              x={x(i) - barW / 2}
              y={y(p.tss)}
              width={barW}
              height={Math.max(0, y(0) - y(p.tss))}
              fill="var(--text-dim)"
              opacity={p.projected ? 0.25 : 0.45}
            />
          ) : null,
        )}
        {/* Today marker */}
        <line x1={x(todayI)} x2={x(todayI)} y1={M.top} y2={M.top + plotH} stroke="var(--text-dim)" strokeWidth={1} strokeDasharray="2 4" />
        <text x={x(todayI) + 4} y={M.top + 10} fontSize={10} fill="var(--text-dim)">
          today
        </text>
        {(['fitness', 'fatigue', 'form'] as const).map((k) => (
          <g key={k}>
            <path d={path(k, 0, todayI)} fill="none" stroke={SERIES[k].color} strokeWidth={2} strokeLinejoin="round" />
            {todayI < n - 1 ? (
              <path d={path(k, todayI, n - 1)} fill="none" stroke={SERIES[k].color} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />
            ) : null}
            <text x={VBW - M.right + 6} y={y(last[k]) + 3.5} fontSize={11} fill="var(--text-dim)">
              {SERIES[k].label} {Math.round(last[k])}
            </text>
          </g>
        ))}
        {hover && hoverI !== null ? (
          <g>
            <line x1={x(hoverI)} x2={x(hoverI)} y1={M.top} y2={M.top + plotH} stroke="var(--text-dim)" strokeWidth={1} strokeDasharray="3 3" />
            {(['fitness', 'fatigue', 'form'] as const).map((k) => (
              <circle key={k} cx={x(hoverI)} cy={y(hover[k])} r={4} fill={SERIES[k].color} stroke="var(--bg-sunken)" strokeWidth={2} />
            ))}
          </g>
        ) : null}
      </svg>
    </div>
  );
}
