import { useRef, useState } from 'react';
import type { RideSample } from '../data/schema';

// Single-series time chart with real axes: labeled y ticks on nice numbers,
// time ticks on the x axis, recessive gridlines, gaps breaking the line, and a
// crosshair + tooltip on hover. Measures of different scale get one panel each
// (stacked small multiples sharing the time axis) — never a dual-axis overlay.

const VBW = 720;
const M = { top: 10, right: 12, bottom: 24, left: 48 };

interface Props {
  samples: RideSample[];
  value: (s: RideSample) => number | null;
  title: string;
  unit: string;
  color: string; // CSS color for the line mark
  height?: number;
}

function niceStep(rough: number): number {
  const pow = 10 ** Math.floor(Math.log10(rough));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= rough) return m * pow;
  }
  return 10 * pow;
}

function formatTime(s: number, stepS: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (stepS < 60) return formatClock(s); // sub-minute ticks: m:ss
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}h`;
  return `${m}m`;
}

export function TimeSeriesChart({ samples, value, title, unit, color, height = 180 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);

  const points = samples.map((s) => ({ t: s.elapsedS, v: value(s) }));
  if (points.length < 2 || !points.some((p) => p.v !== null)) return null;

  const maxT = points[points.length - 1].t || 1;
  const maxV = Math.max(...points.map((p) => p.v ?? 0), 1);
  const yStep = niceStep(maxV / 4);
  const yMax = Math.ceil((maxV * 1.02) / yStep) * yStep;
  const yTicks = Array.from({ length: Math.round(yMax / yStep) + 1 }, (_, i) => i * yStep);
  // Nice tick step: whole minutes for longer rides, seconds for short ones.
  const xStepS = maxT >= 360 ? niceStep(maxT / 6 / 60) * 60 : niceStep(maxT / 6);
  const xTicks: number[] = [];
  for (let t = 0; t <= maxT; t += xStepS) xTicks.push(t);

  const plotW = VBW - M.left - M.right;
  const plotH = height - M.top - M.bottom;
  const x = (t: number) => M.left + (t / maxT) * plotW;
  const y = (v: number) => M.top + plotH - (v / yMax) * plotH;

  let path = '';
  let pen = false;
  for (const p of points) {
    if (p.v === null) {
      pen = false;
      continue;
    }
    path += `${pen ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
    pen = true;
  }

  const hover =
    hoverT === null
      ? null
      : points.reduce<{ t: number; v: number } | null>((best, p) => {
          if (p.v === null) return best;
          if (!best || Math.abs(p.t - hoverT) < Math.abs(best.t - hoverT)) return { t: p.t, v: p.v };
          return best;
        }, null);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vx = ((e.clientX - rect.left) / rect.width) * VBW;
    setHoverT(Math.max(0, Math.min(maxT, ((vx - M.left) / plotW) * maxT)));
  };

  return (
    <div>
      <div className="row between small" style={{ marginBottom: 2 }}>
        <span>
          <span style={{ color }}>■</span> {title} <span className="muted">({unit})</span>
        </span>
        {hover ? (
          <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatClock(hover.t)} · {Math.round(hover.v)} {unit}
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
        onMouseLeave={() => setHoverT(null)}
      >
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={M.left} x2={VBW - M.right} y1={y(tick)} y2={y(tick)} stroke="var(--border)" strokeWidth={tick === 0 ? 1.5 : 0.5} />
            <text x={M.left - 6} y={y(tick) + 3.5} textAnchor="end" fontSize={11} fill="var(--text-dim)">
              {tick}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <g key={tick}>
            <line x1={x(tick)} x2={x(tick)} y1={M.top + plotH} y2={M.top + plotH + 4} stroke="var(--border)" />
            <text x={x(tick)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--text-dim)">
              {formatTime(tick, xStepS)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        {hover ? (
          <g>
            <line x1={x(hover.t)} x2={x(hover.t)} y1={M.top} y2={M.top + plotH} stroke="var(--text-dim)" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={x(hover.t)} cy={y(hover.v)} r={4} fill={color} stroke="var(--bg-sunken)" strokeWidth={2} />
          </g>
        ) : null}
      </svg>
    </div>
  );
}

function formatClock(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}
