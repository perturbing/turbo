import { useEffect, useRef } from 'react';
import type { ResolvedPlan } from '../data/schema';
import type { RideSample } from '../data/schema';
import { zoneForPct } from '../ui/zones';

interface Props {
  plan: ResolvedPlan;
  ftpW: number | null;
  planElapsedS: number;
  samples: readonly RideSample[];
  reducedMotion: boolean;
}

// The "road": the rider moves along the plan according to workout time. A
// near-term window around the rider is drawn large; measured power is overlaid
// as a line. Canvas drawing on rAF keeps 1 Hz samples out of React state.
export function RoadView({ plan, ftpW, planElapsedS, samples, reducedMotion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ plan, ftpW, planElapsedS, samples, reducedMotion });
  stateRef.current = { plan, ftpW, planElapsedS, samples, reducedMotion };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let smoothedElapsed: number | null = null;

    const cssVar = (name: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

    const draw = () => {
      const { plan, ftpW, planElapsedS, samples, reducedMotion } = stateRef.current;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Smooth the 1 Hz elapsed updates unless reduced motion is on (app
      // setting or OS preference).
      const reduce = reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (smoothedElapsed === null || reduce) smoothedElapsed = planElapsedS;
      else smoothedElapsed += (planElapsedS - smoothedElapsed) * 0.12;
      const elapsed = smoothedElapsed;

      const windowS = 300; // 5-minute window around the rider
      const riderX = w * 0.3;
      const t0 = elapsed - (riderX / w) * windowS;
      const tx = (t: number) => riderX + ((t - elapsed) / windowS) * w;

      const maxW = Math.max(...plan.steps.map((s) => Math.max(s.targetW, s.targetEndW ?? 0)), 1) * 1.2;
      const ty = (watts: number) => h - (watts / maxW) * (h - 24);

      // Target road segments colored by zone.
      for (const s of plan.steps) {
        if (s.endS < t0 || s.startS > t0 + windowS) continue;
        const pct = ftpW ? (Math.max(s.targetW, s.targetEndW ?? 0) / ftpW) * 100 : 60;
        ctx.fillStyle = cssVar(zoneForPct(pct).cssVar);
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(tx(s.startS), h);
        ctx.lineTo(tx(s.startS), ty(s.targetW));
        ctx.lineTo(tx(s.endS), ty(s.targetEndW ?? s.targetW));
        ctx.lineTo(tx(s.endS), h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Measured power trace behind the rider.
      ctx.strokeStyle = cssVar('--text');
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      for (const s of samples) {
        if (s.powerW === null) {
          started = false;
          continue;
        }
        if (s.elapsedS < t0 || s.elapsedS > elapsed) continue;
        const px = tx(s.elapsedS);
        const py = ty(s.powerW);
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();

      // Rider marker.
      ctx.fillStyle = cssVar('--accent');
      ctx.beginPath();
      const lastPower = [...samples].reverse().find((s) => s.powerW !== null)?.powerW ?? 0;
      ctx.arc(riderX, ty(lastPower), 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = cssVar('--bg');
      ctx.lineWidth = 2;
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: '100%', height: 180, display: 'block', borderRadius: 10, background: 'var(--bg-sunken)' }} />;
}
