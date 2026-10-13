import { useRef, useState } from 'react';

// Dated small-multiple: one or more series of (date, value) points on ONE
// axis, lines with visible markers (values are sparse: one per ride), an
// optional reference line, legend for >= 2 series plus direct labels at the
// line ends, and a nearest-point hover tooltip. Colors come validated from
// the caller (see PerformanceChart.SERIES and the fourth slot below).

export const TREND_COLORS = ['#2f85dc', '#c9761f', '#22a56b', '#a56bd6'] as const;
export const OTHER_COLOR = 'var(--text-dim)';

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  value: number;
  note?: string;
}

export interface TrendSeries {
  label: string;
  color: string;
  points: TrendPoint[];
  // Step series (e.g. accepted FTP): hold each value until the next point.
  step?: boolean;
}

const VBW = 720;
const M = { top: 12, right: 70, bottom: 26, left: 48 };

function niceStep(rough: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(rough, 1e-9)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= rough) return m * pow;
  return 10 * pow;
}

function dayNum(date: string): number {
  return Math.round(Date.parse(`${date}T12:00:00`) / 86_400_000);
}

function shortDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function TrendChart({
  title,
  unit,
  series,
  decimals = 1,
  reference,
  zeroBased = false,
  height = 180,
}: {
  title: string;
  unit: string;
  series: TrendSeries[];
  decimals?: number;
  reference?: { value: number; label: string };
  zeroBased?: boolean;
  height?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ s: number; i: number } | null>(null);
  const live = series.filter((s) => s.points.length > 0);
  const all = live.flatMap((s) => s.points);
  if (all.length === 0) return null;

  const days = all.map((p) => dayNum(p.date));
  const d0 = Math.min(...days);
  const d1 = Math.max(Math.max(...days), d0 + 7);
  const vals = all.map((p) => p.value).concat(reference ? [reference.value] : []);
  const rawMax = Math.max(...vals);
  const rawMin = zeroBased ? Math.min(0, ...vals) : Math.min(...vals);
  const span = Math.max(rawMax - rawMin, Math.abs(rawMax) * 0.1, 1e-6);
  const step = niceStep(span / 4);
  const yMax = Math.ceil((rawMax + span * 0.1) / step) * step;
  const yMin = zeroBased ? Math.min(0, Math.floor(rawMin / step) * step) : Math.floor((rawMin - span * 0.1) / step) * step;
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) yTicks.push(Math.round(v * 1000) / 1000);

  const plotW = VBW - M.left - M.right;
  const plotH = height - M.top - M.bottom;
  const x = (date: string) => M.left + ((dayNum(date) - d0) / (d1 - d0)) * plotW;
  const y = (v: number) => M.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const everyDays = Math.max(7, Math.ceil((d1 - d0) / 6 / 7) * 7);
  const xTicks: string[] = [];
  for (let d = d1; d >= d0; d -= everyDays) xTicks.unshift(new Date(d * 86_400_000).toISOString().slice(0, 10));

  const pathOf = (s: TrendSeries) => {
    const pts = [...s.points].sort((a, b) => a.date.localeCompare(b.date));
    let d = '';
    pts.forEach((p, i) => {
      const px = x(p.date).toFixed(1);
      const py = y(p.value).toFixed(1);
      if (i === 0) d += `M${px},${py}`;
      else if (s.step) d += `H${px}V${py}`;
      else d += `L${px},${py}`;
    });
    if (s.step && pts.length) d += `H${(M.left + plotW).toFixed(1)}`;
    return d;
  };

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vx = ((e.clientX - rect.left) / rect.width) * VBW;
    const vy = ((e.clientY - rect.top) / rect.height) * height;
    let best: { s: number; i: number; d: number } | null = null;
    for (let si = 0; si < live.length; si++) {
      for (let pi = 0; pi < live[si].points.length; pi++) {
        const p = live[si].points[pi];
        const d = Math.hypot(x(p.date) - vx, y(p.value) - vy);
        if (best === null || d < best.d) best = { s: si, i: pi, d };
      }
    }
    setHover(best !== null && best.d < 40 ? { s: best.s, i: best.i } : null);
  };
  const hp = hover ? live[hover.s].points[hover.i] : null;

  return (
    <div>
      <div className="row between small" style={{ marginBottom: 2, flexWrap: 'wrap' }}>
        <span className="row" style={{ gap: 12 }}>
          <strong>{title}</strong>
          <span className="muted">({unit})</span>
          {live.length >= 2
            ? live.map((s) => (
                <span key={s.label}>
                  <span style={{ color: s.color }}>●</span> {s.label}
                </span>
              ))
            : null}
          {reference ? <span className="muted">— — {reference.label}</span> : null}
        </span>
        {hp && hover ? (
          <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {shortDate(hp.date)} · {live[hover.s].label} {hp.value.toFixed(decimals)} {unit}
            {hp.note ? ` · ${hp.note}` : ''}
          </span>
        ) : null}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VBW} ${height}`}
        style={{ width: '100%', display: 'block', background: 'var(--bg-sunken)', borderRadius: 6 }}
        role="img"
        aria-label={`${title} over time`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={VBW - M.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={t === 0 ? 1.5 : 0.5} />
            <text x={M.left - 6} y={y(t) + 3.5} textAnchor="end" fontSize={11} fill="var(--text-dim)">
              {Number.isInteger(t) ? t : t.toFixed(decimals)}
            </text>
          </g>
        ))}
        {xTicks.map((d) => (
          <g key={d}>
            <line x1={x(d)} x2={x(d)} y1={M.top + plotH} y2={M.top + plotH + 4} stroke="var(--border)" />
            <text x={x(d)} y={height - 9} textAnchor="middle" fontSize={11} fill="var(--text-dim)">
              {shortDate(d)}
            </text>
          </g>
        ))}
        {reference ? (
          <line x1={M.left} x2={VBW - M.right} y1={y(reference.value)} y2={y(reference.value)} stroke="var(--text-dim)" strokeWidth={1} strokeDasharray="5 4" />
        ) : null}
        {live.map((s, si) => {
          const last = [...s.points].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!;
          return (
            <g key={s.label}>
              {s.points.length > 1 ? <path d={pathOf(s)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" /> : null}
              {s.points.map((p, pi) => (
                <circle
                  key={pi}
                  cx={x(p.date)}
                  cy={y(p.value)}
                  r={hover && hover.s === si && hover.i === pi ? 6 : 4}
                  fill={s.color}
                  stroke="var(--bg-sunken)"
                  strokeWidth={1.5}
                />
              ))}
              {live.length <= 4 ? (
                <text x={VBW - M.right + 6} y={y(last.value) + 3.5} fontSize={11} fill="var(--text-dim)">
                  {s.label.length > 12 ? `${s.label.slice(0, 11)}…` : s.label} {last.value.toFixed(decimals)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
