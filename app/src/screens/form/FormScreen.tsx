import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLibraryStore } from '../../state/libraryStore';
import { useSettingsStore } from '../../state/settingsStore';
import { metricsForAll } from '../../data/repositories/rideMetrics';
import { RAMP_TEST_RECIPE_ID, type RideRecording } from '../../data/schema';
import { CP_TEST_RECIPE_ID } from '../../data/builtinWorkouts';
import type { RideMetrics } from '../../engine/metrics';
import { plannedTss } from '../../engine/metrics';
import { resolvePlan } from '../../engine/planResolve';
import { addDays, daysBetween, performanceSeries, type DailyLoad } from '../../engine/performance';
import { assessForm, RULES, VERDICT_METHOD, type RideForVerdict, type VerdictResult } from '../../engine/verdict';
import { PerformanceChart } from '../../components/PerformanceChart';
import { Explain, ExplainedTile, Glossary } from '../../components/Explain';
import { localDateString } from '../calendar/CalendarScreen';
import { ProgressSection } from './ProgressSection';

// A ramp test is open-ended; this is the load a typical one produces.
const RAMP_TEST_TSS = 30;
const HISTORY_DAYS = 90;
const PROJECTION_DAYS = 28;

// A ride cut short by the equipment, not the rider.
export function endedByDevice(r: RideRecording): boolean {
  if (r.state === 'completed') return false;
  if (r.state === 'recovered') return true;
  return r.events.some((e) => e.type === 'deviceDisconnected' || e.type === 'targetFailed');
}

function weekStart(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  const back = (d.getDay() + 6) % 7; // Monday = 0
  return addDays(date, -back);
}

export function FormScreen() {
  const { recipes, recordings, plans, ftpHistory, loaded, refresh } = useLibraryStore();
  const ftp = useSettingsStore((s) => s.settings.currentFtpW);
  const weightKg = useSettingsStore((s) => s.settings.weightKg ?? null);
  const [metrics, setMetrics] = useState<Map<string, RideMetrics> | null>(null);
  const today = localDateString(new Date());

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!loaded) return;
    void metricsForAll(recordings, ftp).then(setMetrics);
  }, [loaded, recordings, ftp]);

  const model = useMemo(() => {
    if (!metrics) return null;
    const actual: DailyLoad[] = [];
    const rides: RideForVerdict[] = [];
    for (const r of recordings) {
      const m = metrics.get(r.id);
      if (!m) continue;
      if (m.tss !== null) actual.push({ date: m.date, tss: m.tss });
      rides.push({ metrics: m, recipeId: r.recipeId, state: r.state, effortRating: r.effortRating, deviceFailure: endedByDevice(r) });
    }
    const plannedLoad = (recipeId: string): number | null => {
      if (recipeId === RAMP_TEST_RECIPE_ID) return RAMP_TEST_TSS;
      const recipe = recipes.find((x) => x.id === recipeId);
      if (!recipe) return null;
      try {
        return plannedTss(resolvePlan(recipe, ftp), ftp ?? 1);
      } catch {
        return null; // needs FTP
      }
    };
    const planned: DailyLoad[] = plans
      .map((p) => ({ date: p.date, tss: plannedLoad(p.recipeId) }))
      .filter((p): p is DailyLoad => p.tss !== null);

    const series = performanceSeries(actual, planned, today, addDays(today, PROJECTION_DAYS), addDays(today, -HISTORY_DAYS));
    // Both tests are maximal efforts: readiness applies to either.
    const nextTest = plans
      .filter((p) => (p.recipeId === RAMP_TEST_RECIPE_ID || p.recipeId === CP_TEST_RECIPE_ID) && p.date >= today)
      .map((p) => daysBetween(today, p.date))
      .sort((a, b) => a - b)[0];
    const verdict = assessForm(series, today, rides, nextTest !== undefined && nextTest <= 14 ? nextTest : null);

    // Weekly planned vs actual: four weeks back, two ahead.
    const thisWeek = weekStart(today);
    const weeks = Array.from({ length: 7 }, (_, i) => addDays(thisWeek, (i - 4) * 7)).map((start) => {
      const end = addDays(start, 6);
      const inWeek = (d: string) => d >= start && d <= end;
      return {
        start,
        end,
        planned: planned.filter((p) => inWeek(p.date)).reduce((a, p) => a + p.tss, 0),
        actual: actual.filter((p) => inWeek(p.date)).reduce((a, p) => a + p.tss, 0),
        rides: actual.filter((p) => inWeek(p.date)).length,
        current: inWeek(today),
      };
    });
    const testDay = plans.filter((p) => p.recipeId === RAMP_TEST_RECIPE_ID && p.date > today).sort((a, b) => a.date.localeCompare(b.date))[0];
    const projectedTestForm = testDay ? series.find((p) => p.date === testDay.date)?.form ?? null : null;
    return { series, verdict, weeks, rides: rides.length, testDay: testDay?.date ?? null, projectedTestForm };
  }, [metrics, recordings, recipes, plans, ftp, today]);

  if (!loaded || !model) return <main className="screen">Computing…</main>;
  const { series, verdict, weeks } = model;

  return (
    <main className="screen stack">
      <div className="row between">
        <h1>Form</h1>
        <span className="muted small">
          rules {VERDICT_METHOD} · {model.rides} ride{model.rides === 1 ? '' : 's'}
        </span>
      </div>

      {!ftp ? (
        <div className="banner">
          Training load is measured against your FTP, which is not set. <Link to="/training">Set your training level</Link> first;
          rides recorded without an FTP are scored with the current one once it exists.
        </div>
      ) : null}

      <VerdictCard verdict={verdict} />

      <div className="row">
        <ExplainedTile term="fitness" label="Fitness" value={verdict.facts.fitness} decimals={0} />
        <ExplainedTile term="fatigue" label="Fatigue" value={verdict.facts.fatigue} decimals={0} />
        <ExplainedTile
          term="form"
          label="Form"
          value={verdict.facts.form}
          decimals={0}
          sub={verdict.facts.form < RULES.overreachedBelow ? 'overreached' : verdict.facts.form < RULES.productiveBelow ? 'productive' : verdict.facts.form > RULES.freshAbove ? 'fresh' : 'neutral'}
        />
        {verdict.facts.fitnessRampPerWeek !== null ? (
          <div className="metric-tile">
            <div className="label">Fitness this week</div>
            <div className="value">
              {verdict.facts.fitnessRampPerWeek >= 0 ? '+' : ''}
              {verdict.facts.fitnessRampPerWeek.toFixed(1)}
            </div>
            <div className="unit">sustainable: +3 to +{RULES.maxFitnessRampPerWeek}</div>
          </div>
        ) : null}
      </div>

      <div className="card stack">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Fitness, fatigue and form</h2>
          <span className="muted small">
            last {HISTORY_DAYS} days and the next {PROJECTION_DAYS} from your calendar
          </span>
        </div>
        <PerformanceChart series={series} today={today} />
        <p className="muted small">
          Fitness is a 42-day average of daily load, fatigue a 7-day average, form is the gap between them. Every ride pushes
          fatigue up fast and fitness up slowly; rest lets fatigue fall first. The dashed part shows where your planned
          workouts would take you.
          {model.testDay && model.projectedTestForm !== null ? (
            <>
              {' '}
              On your planned ramp test ({model.testDay}) form is projected at {model.projectedTestForm >= 0 ? '+' : ''}
              {Math.round(model.projectedTestForm)}; the test window is +{RULES.testReadyForm[0]} to +{RULES.testReadyForm[1]}.
            </>
          ) : null}
        </p>
      </div>

      <ProgressSection recordings={recordings} recipes={recipes} metrics={metrics!} ftpHistory={ftpHistory} weightKg={weightKg} />

      <div className="card">
        <h2 style={{ marginTop: 0 }}>
          Weekly load <Explain term="tss" />
        </h2>
        <table className="data">
          <thead>
            <tr>
              <th>Week of</th>
              <th className="num">Rides</th>
              <th className="num">Planned TSS</th>
              <th className="num">Actual TSS</th>
              <th className="num">Difference</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.start} style={w.current ? { fontWeight: 600 } : undefined}>
                <td>
                  {new Date(`${w.start}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                  {w.current ? ' (this week)' : w.start > today ? ' (ahead)' : ''}
                </td>
                <td className="num">{w.start > today ? '' : w.rides}</td>
                <td className="num">{w.planned ? Math.round(w.planned) : '—'}</td>
                <td className="num">{w.start > today ? '' : Math.round(w.actual)}</td>
                <td className="num">{w.planned && w.start <= today ? `${w.actual - w.planned >= 0 ? '+' : ''}${Math.round(w.actual - w.planned)}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Planned load comes from the workouts on your calendar, scored as if ridden exactly at your current FTP. A ramp test
          is counted as {RAMP_TEST_TSS}.
        </p>
      </div>

      <details className="card">
        <summary>
          <strong>Understanding these numbers</strong> <span className="muted">— every metric, in plain words</span>
        </summary>
        <div style={{ marginTop: 12 }}>
          <Glossary terms={['verdict', 'tss', 'np', 'if', 'fitness', 'fatigue', 'form', 'ef', 'decoupling', 'rpe', 'compliance', 'intensity']} />
        </div>
      </details>
    </main>
  );
}

function VerdictCard({ verdict }: { verdict: VerdictResult }) {
  const tone = verdict.verdict === 'load' ? 'ok' : verdict.verdict === 'hold' ? 'warn' : verdict.verdict === 'rest' ? 'danger' : 'muted';
  return (
    <div className={`card stack verdict verdict-${tone}`}>
      <div className="row between">
        <div className="row" style={{ gap: 8 }}>
          <span className={`pill ${tone === 'muted' ? '' : tone}`}>{verdict.verdict === 'insufficient' ? 'not yet' : verdict.verdict}</span>
          <h2 style={{ margin: 0 }}>{verdict.headline}</h2>
        </div>
        <Explain term="verdict" />
      </div>
      <ul className="reasons">
        {verdict.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      {verdict.verdict === 'load' ? (
        <p className="muted small">
          To add load: ride the next sessions at 103 to 105% intensity (set it on the workout setup screen), or add an endurance
          ride to the week. Keep FTP as it is until your next test.
        </p>
      ) : verdict.verdict === 'hold' ? (
        <p className="muted small">
          To hold: ride the plan as written at 100%, no extra sessions. If the next verdict is still hold, drop the key sessions to
          95% for a week.
        </p>
      ) : verdict.verdict === 'rest' ? (
        <p className="muted small">
          To rest: swap the next hard session for an easy spin or a day off and check again in two or three days. Form recovers
          within about a week of easing off.
        </p>
      ) : null}
    </div>
  );
}
