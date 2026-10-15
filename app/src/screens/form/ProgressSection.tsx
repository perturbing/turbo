import { useMemo } from 'react';
import type { FtpObservation, RideRecording, WorkoutRecipe } from '../../data/schema';
import { CP_TEST_RECIPE_ID } from '../../data/builtinWorkouts';
import type { RideMetrics } from '../../engine/metrics';
import { localDate } from '../../engine/metrics';
import { vo2maxFromMap } from '../../engine/physiology';
import { Explain } from '../../components/Explain';
import { OTHER_COLOR, TREND_COLORS, TrendChart, type TrendSeries } from '../../components/TrendChart';

// Progress over time: the outcome signals (not the load). Each chart says
// what it needs when there is not enough data yet rather than showing nothing.
export function ProgressSection({
  recordings,
  recipes,
  metrics,
  ftpHistory,
  weightKg,
}: {
  recordings: RideRecording[];
  recipes: WorkoutRecipe[];
  metrics: Map<string, RideMetrics>;
  ftpHistory: FtpObservation[];
  weightKg: number | null;
}) {
  const model = useMemo(() => {
    const completed = recordings.filter((r) => r.state === 'completed' && metrics.has(r.id));
    const name = (id: string | undefined) => recipes.find((r) => r.id === id)?.name ?? 'Unknown workout';

    // Efficiency factor, grouped by workout: only like-for-like comparisons
    // mean anything. The four most-ridden workouts get a color; the rest are
    // folded into "Other".
    const byRecipe = new Map<string, { date: string; value: number }[]>();
    for (const r of completed) {
      const m = metrics.get(r.id)!;
      if (m.efficiencyFactor === null || r.kind !== 'workout' || !r.recipeId) continue;
      byRecipe.set(r.recipeId, [...(byRecipe.get(r.recipeId) ?? []), { date: m.date, value: m.efficiencyFactor }]);
    }
    const ranked = [...byRecipe.entries()].filter(([, pts]) => pts.length >= 2).sort((a, b) => b[1].length - a[1].length);
    const efSeries: TrendSeries[] = ranked.slice(0, 4).map(([id, pts], i) => ({ label: name(id), color: TREND_COLORS[i], points: pts }));
    const other = ranked.slice(4).flatMap(([, pts]) => pts);
    if (other.length) efSeries.push({ label: 'Other', color: OTHER_COLOR, points: other });
    const efSingles = [...byRecipe.values()].filter((pts) => pts.length < 2).length;

    const decoupling: TrendSeries = {
      label: 'Decoupling',
      color: TREND_COLORS[0],
      points: completed
        .map((r) => ({ r, m: metrics.get(r.id)! }))
        .filter(({ m }) => m.decouplingPct !== null)
        .map(({ r, m }) => ({ date: m.date, value: m.decouplingPct!, note: r.name })),
    };

    const ftpSeries: TrendSeries = {
      label: 'FTP (accepted)',
      color: TREND_COLORS[0],
      step: true,
      points: ftpHistory
        .filter((o) => o.accepted)
        .map((o) => ({ date: localDate(o.date), value: o.candidateW, note: o.method })),
    };
    const lt2: TrendSeries = {
      label: 'LT2 (DFA)',
      color: TREND_COLORS[1],
      points: completed
        .map((r) => metrics.get(r.id)!)
        .filter((m) => m.thresholds?.lt2W != null)
        .map((m) => ({ date: m.date, value: m.thresholds!.lt2W! })),
    };
    const lt1: TrendSeries = {
      label: 'LT1 (DFA)',
      color: TREND_COLORS[2],
      points: completed
        .map((r) => metrics.get(r.id)!)
        .filter((m) => m.thresholds?.lt1W != null)
        .map((m) => ({ date: m.date, value: m.thresholds!.lt1W! })),
    };
    const cp: TrendSeries = {
      label: 'CP (3-min test)',
      color: TREND_COLORS[3],
      points: completed
        .filter((r) => r.recipeId === CP_TEST_RECIPE_ID && metrics.get(r.id)!.cpTest && metrics.get(r.id)!.cpTest!.problem === null)
        .map((r) => ({ date: metrics.get(r.id)!.date, value: metrics.get(r.id)!.cpTest!.cpW })),
    };

    const vo2: TrendSeries = {
      label: 'VO2max',
      color: TREND_COLORS[0],
      points: ftpHistory
        .filter((o) => o.method === 'ramp-v1' && o.bestWindow)
        .map((o) => {
          const v = vo2maxFromMap(o.bestWindow!.avgPowerW, weightKg);
          return { date: localDate(o.date), value: v.mlPerKgMin ?? v.litresPerMin, note: `MAP ${Math.round(o.bestWindow!.avgPowerW)} W` };
        }),
    };

    return { efSeries, efSingles, decoupling, thresholds: [ftpSeries, lt2, lt1, cp], vo2, relative: weightKg !== null };
  }, [recordings, recipes, metrics, ftpHistory, weightKg]);

  const efPoints = model.efSeries.reduce((a, s) => a + s.points.length, 0);
  const thrPoints = model.thresholds.reduce((a, s) => a + s.points.length, 0);

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Progress</h2>
      <p className="muted small">
        Load (the chart above) is what you put in. These are what comes out: the same work at a lower heart rate, less drift
        on long rides, thresholds and FTP moving up. Each point is one ride or one test; trends need weeks.
      </p>

      <div className="stack" style={{ gap: 4 }}>
        <div className="row" style={{ gap: 6 }}>
          <strong className="small">Efficiency on repeated workouts</strong> <Explain term="ef" />
        </div>
        {efPoints >= 2 ? (
          <TrendChart title="Efficiency factor" unit="W/bpm" series={model.efSeries} decimals={2} />
        ) : (
          <p className="muted small">
            Needs the same workout ridden at least twice with heart rate
            {model.efSingles ? ` (${model.efSingles} workout${model.efSingles === 1 ? ' has' : 's have'} one ride so far)` : ''}. Repeating an
            endurance ride every week or two is the cleanest fitness signal you can record.
          </p>
        )}
      </div>

      <div className="stack" style={{ gap: 4 }}>
        <div className="row" style={{ gap: 6 }}>
          <strong className="small">Aerobic decoupling on long steady rides</strong> <Explain term="decoupling" />
        </div>
        {model.decoupling.points.length >= 2 ? (
          <TrendChart title="Decoupling" unit="%" series={[model.decoupling]} reference={{ value: 5, label: '5% guide' }} zeroBased />
        ) : (
          <p className="muted small">Needs two or more rides with a steady block of 20 minutes or more and heart rate throughout.</p>
        )}
      </div>

      <div className="stack" style={{ gap: 4 }}>
        <div className="row" style={{ gap: 6 }}>
          <strong className="small">Thresholds and FTP</strong> <Explain term="lt2" />
        </div>
        {thrPoints >= 2 ? (
          <TrendChart title="Power at threshold" unit="W" series={model.thresholds} decimals={0} />
        ) : (
          <p className="muted small">Shows accepted FTP values, DFA thresholds from rides with a chest strap, and critical power from the 3-minute test, as they accumulate.</p>
        )}
      </div>

      <div className="stack" style={{ gap: 4 }}>
        <div className="row" style={{ gap: 6 }}>
          <strong className="small">VO2max from ramp tests</strong> <Explain term="vo2max" />
        </div>
        {model.vo2.points.length >= 2 ? (
          <TrendChart title="VO2max" unit={model.relative ? 'ml/kg/min' : 'L/min'} series={[model.vo2]} decimals={model.relative ? 0 : 2} />
        ) : (
          <p className="muted small">
            One point per ramp test{model.vo2.points.length === 1 ? ` (one so far: ${model.vo2.points[0].value.toFixed(model.relative ? 0 : 2)} ${model.relative ? 'ml/kg/min' : 'L/min'})` : ''}. It moves slowly; expect a point every six to eight weeks.
          </p>
        )}
      </div>
    </div>
  );
}
