import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLibraryStore } from '../../state/libraryStore';
import { useSettingsStore } from '../../state/settingsStore';
import { getTrainer } from '../../ble/deviceManager';
import { useDeviceStore } from '../../state/deviceStore';
import { CP_TEST_RECIPE_ID } from '../../data/builtinWorkouts';
import { loadSamples } from '../../data/repositories/recordings';
import { metricsForAll } from '../../data/repositories/rideMetrics';
import type { RideMetrics } from '../../engine/metrics';
import {
  CP_TEST_PROBLEM_TEXT,
  freshness,
  hrMaxProfile,
  PHYSIOLOGY,
  rampHrMarkers,
  thresholdProfile,
  timeToExhaustionS,
  vo2maxFromMap,
  type CpTestResult,
  type RampHrMarkers,
  type ThresholdProfile,
  type Vo2maxEstimate,
} from '../../engine/physiology';
import { DFA } from '../../engine/dfa';
import { Explain } from '../../components/Explain';
import { localDateString } from '../calendar/CalendarScreen';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

// Estimates with a date and a freshness rule. Nothing stale or missing is ever
// shown as a current number: the tile says what is missing and what to do.
export function PhysiologyPanel() {
  const navigate = useNavigate();
  const { recordings, ftpHistory, loaded, refresh } = useLibraryStore();
  const { settings, update } = useSettingsStore();
  const trainerConnected = useDeviceStore((s) => s.trainerConnection === 'connected');
  const [metrics, setMetrics] = useState<Map<string, RideMetrics> | null>(null);
  const [rampHr, setRampHr] = useState<RampHrMarkers | null>(null);
  const [weightInput, setWeightInput] = useState('');
  const today = localDateString(new Date());

  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);

  useEffect(() => {
    if (!loaded) return;
    void metricsForAll(recordings, settings.currentFtpW).then(setMetrics);
  }, [loaded, recordings, settings.currentFtpW]);

  // Latest ramp test with a usable best window.
  const ramp = useMemo(() => ftpHistory.find((o) => o.method === 'ramp-v1' && o.bestWindow), [ftpHistory]);
  const rampFresh = ramp ? freshness(ramp.date, PHYSIOLOGY.vo2maxMaxAgeDays, today) : null;

  useEffect(() => {
    if (!ramp?.recordingId) {
      setRampHr(null);
      return;
    }
    const id = ramp.recordingId;
    const ftpW = ramp.candidateW;
    void loadSamples(id).then((s) => setRampHr(rampHrMarkers(s, ftpW)));
  }, [ramp]);

  const vo2: Vo2maxEstimate | null = ramp ? vo2maxFromMap(ramp.bestWindow!.avgPowerW, settings.weightKg ?? null) : null;

  const thresholds: ThresholdProfile | null = useMemo(() => {
    if (!metrics) return null;
    return thresholdProfile(
      [...metrics.values()].map((m) => ({ date: m.date, thresholds: m.thresholds })),
      today,
    );
  }, [metrics, today]);

  // Latest all-out test, usable or not: a rejected test is shown with its
  // reason rather than silently falling back to an older one.
  const cp = useMemo(() => {
    if (!metrics) return null;
    const tests = recordings
      .filter((r) => r.recipeId === CP_TEST_RECIPE_ID && metrics.get(r.id)?.cpTest)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const latest = tests[0];
    if (!latest) return null;
    return { result: metrics.get(latest.id)!.cpTest as CpTestResult, date: latest.startedAt, recordingId: latest.id, fresh: freshness(latest.startedAt, PHYSIOLOGY.cpMaxAgeDays, today) };
  }, [metrics, recordings, today]);
  const cpUsable = cp && cp.fresh === 'fresh' && cp.result.problem === null ? cp : null;

  // HR max is the highest peak of any ride with a strap, not just the ramp.
  const hrMax = useMemo(() => {
    if (!metrics) return null;
    const byId = new Map(recordings.map((r) => [r.id, r]));
    return hrMaxProfile(
      [...metrics.values()].map((m) => ({ date: byId.get(m.recordingId)?.startedAt ?? m.date, recordingId: m.recordingId, maxHrBpm: m.maxHrBpm })),
      today,
    );
  }, [metrics, recordings, today]);

  const ridesWithRr = metrics ? [...metrics.values()].filter((m) => m.thresholds).length : 0;

  const saveWeight = async (kg: number) => {
    if (!kg || kg < 30 || kg > 200) return;
    await update({ weightKg: Math.round(kg * 10) / 10 });
    setWeightInput('');
  };
  const weightFromTrainer = async () => {
    const kg = await getTrainer()?.readWeightKg();
    if (kg) await saveWeight(kg);
  };

  const ftp = settings.currentFtpW;
  const lt2 = thresholds?.lt2W?.median ?? null;
  const cpW = cpUsable ? cpUsable.result.cpW : null;
  const agreement = [ftp, lt2, cpW].filter((v): v is number => v !== null);
  const spreadPct = agreement.length >= 2 ? ((Math.max(...agreement) - Math.min(...agreement)) / Math.min(...agreement)) * 100 : null;

  return (
    <div className="card stack">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Physiology (estimates)</h2>
        <span className="muted small">nothing here is measured; each value names its method and date</span>
      </div>

      <div className="row">
        {/* VO2max */}
        <div className="metric-tile explained" style={{ minWidth: 200 }}>
          <div className="label">
            VO2max <Explain term="vo2max" />
          </div>
          {ramp && rampFresh === 'fresh' && vo2 ? (
            <>
              <div className="value">
                {vo2.mlPerKgMin !== null ? vo2.mlPerKgMin.toFixed(0) : vo2.litresPerMin.toFixed(2)}
                <span className="unit"> {vo2.mlPerKgMin !== null ? 'ml/kg/min' : 'L/min'}</span>
              </div>
              <div className="unit">
                {vo2.mlPerKgMin !== null ? `likely ${vo2.low!.toFixed(0)} to ${vo2.high!.toFixed(0)} · ` : 'add weight for ml/kg/min · '}
                MAP {Math.round(vo2.mapW)} W · ramp {fmtDate(ramp.date)}
              </div>
            </>
          ) : (
            <>
              <div className="value placeholder">No recent measurement</div>
              <div className="unit">
                {ramp ? `last ramp test ${fmtDate(ramp.date)} is older than ${PHYSIOLOGY.vo2maxMaxAgeDays} days` : 'needs a ramp test'}
              </div>
            </>
          )}
        </div>

        {/* HR markers */}
        <div className="metric-tile explained" style={{ minWidth: 170 }}>
          <div className="label">
            HR max <Explain term="hrmax" />
          </div>
          {hrMax ? (
            <>
              <div className="value">
                {hrMax.bpm} <span className="unit">bpm</span>
              </div>
              <div className="unit">
                {fmtDate(hrMax.date)} · <Link to={`/data/${hrMax.recordingId}`}>ride</Link>
              </div>
            </>
          ) : (
            <>
              <div className="value placeholder">No measurement</div>
              <div className="unit">needs a hard ride with a strap in the last year</div>
            </>
          )}
        </div>
        <div className="metric-tile explained" style={{ minWidth: 170 }}>
          <div className="label">
            Threshold HR <Explain term="lthr" />
          </div>
          {thresholds?.lt2Hr ? (
            <>
              <div className="value">
                {Math.round(thresholds.lt2Hr.median)} <span className="unit">bpm</span>
              </div>
              <div className="unit">
                DFA, {thresholds.lt2Hr.rides} rides, {Math.round(thresholds.lt2Hr.low)} to {Math.round(thresholds.lt2Hr.high)}
              </div>
            </>
          ) : ramp && rampFresh === 'fresh' && rampHr?.lthrBpm ? (
            <>
              <div className="value">
                ~{Math.round(rampHr.lthrBpm)} <span className="unit">bpm</span>
              </div>
              <div className="unit">approximate, from the ramp {fmtDate(ramp.date)}</div>
            </>
          ) : (
            <>
              <div className="value placeholder">No recent measurement</div>
              <div className="unit">needs a ramp test with a strap</div>
            </>
          )}
        </div>
      </div>

      <div className="row">
        {/* LT1 / LT2 from DFA */}
        <ThresholdTile term="lt1" label="First threshold (LT1)" w={thresholds?.lt1W ?? null} hr={thresholds?.lt1Hr ?? null} ridesWithRr={ridesWithRr} recentRides={thresholds?.rides ?? 0} />
        <ThresholdTile term="lt2" label="Second threshold (LT2)" w={thresholds?.lt2W ?? null} hr={thresholds?.lt2Hr ?? null} ridesWithRr={ridesWithRr} recentRides={thresholds?.rides ?? 0} />

        {/* CP / W' */}
        <div className="metric-tile explained" style={{ minWidth: 220 }}>
          <div className="label">
            Critical power <Explain term="cp" /> and W′ <Explain term="wprime" />
          </div>
          {cpUsable ? (
            <>
              <div className="value">
                {Math.round(cpUsable.result.cpW)} <span className="unit">W</span>
                <span className="unit"> · </span>
                {(cpUsable.result.wPrimeJ / 1000).toFixed(1)} <span className="unit">kJ</span>
              </div>
              <div className="unit">
                test {fmtDate(cpUsable.date)} · <Link to={`/data/${cpUsable.recordingId}`}>recording</Link>
              </div>
            </>
          ) : cp && cp.fresh === 'fresh' && cp.result.problem ? (
            <>
              <div className="value placeholder">Test not usable</div>
              <div className="unit">
                {fmtDate(cp.date)}: {CP_TEST_PROBLEM_TEXT[cp.result.problem]}. Repeat the test. <Link to={`/data/${cp.recordingId}`}>recording</Link>
              </div>
            </>
          ) : (
            <>
              <div className="value placeholder">No recent measurement</div>
              <div className="unit">{cp ? `last test ${fmtDate(cp.date)} is older than ${PHYSIOLOGY.cpMaxAgeDays} days` : 'needs the 3-minute all-out test'}</div>
            </>
          )}
        </div>
      </div>

      {cpUsable ? (
        <p className="muted small">
          Above critical power your time is W′ divided by the surplus:{' '}
          {[25, 50, 100]
            .map((d) => {
              const { cpW: c, wPrimeJ } = cpUsable.result;
              const t = timeToExhaustionS(c + d, c, wPrimeJ)!;
              return `${Math.round(c + d)} W for ${t >= 60 ? `${Math.floor(t / 60)} min ${Math.round(t % 60)} s` : `${Math.round(t)} s`}`;
            })
            .join(' · ')}
          . Below it you can, in principle, keep going.
        </p>
      ) : null}

      {spreadPct !== null ? (
        <p className="muted small">
          Cross-check: FTP {ftp ?? '—'} W{lt2 !== null ? `, LT2 ${Math.round(lt2)} W` : ''}
          {cpW !== null ? `, CP ${Math.round(cpW)} W` : ''}. They estimate the same boundary by different routes;{' '}
          {spreadPct <= 5 ? `they agree within ${spreadPct.toFixed(0)}%, which is a good sign.` : `they differ by ${spreadPct.toFixed(0)}%, so one of the tests was probably not maximal or your FTP is due for a test.`}
        </p>
      ) : null}

      <div className="row between" style={{ flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="muted small">
            Weight {settings.weightKg ? `${settings.weightKg} kg` : 'not set'} (for ml/kg/min)
          </span>
          <input
            type="number"
            min={30}
            max={200}
            step={0.1}
            placeholder="kg"
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
            style={{ width: 80 }}
          />
          <button className="small" disabled={!Number(weightInput)} onClick={() => void saveWeight(Number(weightInput))}>
            Save
          </button>
          {trainerConnected ? (
            <button className="small" onClick={() => void weightFromTrainer()}>
              Use trainer's weight
            </button>
          ) : null}
        </div>
        <button className="primary" onClick={() => navigate(`/workouts/${CP_TEST_RECIPE_ID}/setup`)}>
          Start 3-minute all-out test
        </button>
      </div>
      <p className="muted small">
        Thresholds come from heart-rate variability during ordinary rides (any ride with a chest strap counts; {ridesWithRr} so
        far, pooled over the last {PHYSIOLOGY.thresholdWindowDays} days, at least {PHYSIOLOGY.thresholdMinRides} needed). The
        all-out test is ridden in Shift mode. During the three minutes the screen shows no target: sprint from the first
        pedal stroke as if the effort were ten seconds long, then keep fighting to turn the pedals as the power falls. A
        correct trace starts well above 500 W and settles near your FTP; what is left in the final 30 seconds is your
        critical power. Holding a number, starting steady or easing off before the clock stops all make the app reject the test.
      </p>
    </div>
  );
}

function ThresholdTile({
  term,
  label,
  w,
  hr,
  ridesWithRr,
  recentRides,
}: {
  term: 'lt1' | 'lt2';
  label: string;
  w: { median: number; low: number; high: number; rides: number } | null;
  hr: { median: number } | null;
  ridesWithRr: number;
  recentRides: number;
}) {
  return (
    <div className="metric-tile explained" style={{ minWidth: 220 }}>
      <div className="label">
        {label} <Explain term={term} />
      </div>
      {w ? (
        <>
          <div className="value">
            {Math.round(w.median)} <span className="unit">W</span>
            {hr ? (
              <>
                <span className="unit"> · </span>
                {Math.round(hr.median)} <span className="unit">bpm</span>
              </>
            ) : null}
          </div>
          <div className="unit">
            {w.rides} rides, {Math.round(w.low)} to {Math.round(w.high)} W · DFA α1 = {term === 'lt1' ? DFA.lt1Alpha : DFA.lt2Alpha}
          </div>
        </>
      ) : (
        <>
          <div className="value placeholder">No recent measurement</div>
          <div className="unit">
            {ridesWithRr === 0
              ? 'needs rides with a chest strap (beat data)'
              : recentRides < PHYSIOLOGY.thresholdMinRides
                ? `${recentRides} of ${PHYSIOLOGY.thresholdMinRides} recent rides with beat data`
                : term === 'lt2'
                  ? 'recent rides did not reach this intensity'
                  : 'recent rides did not cross this intensity'}
          </div>
        </>
      )}
    </div>
  );
}
