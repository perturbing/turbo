import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { RideRecording, RideSample } from '../../data/schema';
import { getRecording, loadSamples } from '../../data/repositories/recordings';
import { downloadFile, exportRecording, recordingToCsv } from '../../data/exportImport';
import { formatDuration } from '../../engine/planResolve';
import { PowerProfileChart } from '../../components/PowerProfileChart';
import { TimeSeriesChart } from '../../components/TimeSeriesChart';
import { Pill } from '../../components/StatusPill';
import { saveRecording } from '../../data/repositories/recordings';
import { metricsFor } from '../../data/repositories/rideMetrics';
import type { RideMetrics } from '../../engine/metrics';
import { useSettingsStore } from '../../state/settingsStore';
import { EffortRating } from '../../components/EffortRating';
import { RideMetricsTiles } from '../../components/RideMetricsTiles';

export function RecordingDetailScreen() {
  const { recordingId } = useParams();
  const [recording, setRecording] = useState<RideRecording | null>(null);
  const [samples, setSamples] = useState<RideSample[]>([]);
  const [missing, setMissing] = useState(false);
  const [metrics, setMetrics] = useState<RideMetrics | null>(null);
  const ftp = useSettingsStore((s) => s.settings.currentFtpW);

  useEffect(() => {
    if (!recordingId) return;
    void (async () => {
      const rec = await getRecording(recordingId);
      if (!rec) {
        setMissing(true);
        return;
      }
      setRecording(rec);
      setSamples(await loadSamples(recordingId));
      if (rec.state !== 'in-progress') setMetrics(await metricsFor(rec, ftp));
    })();
  }, [recordingId, ftp]);

  const rate = async (effortRating: number) => {
    if (!recording) return;
    const next = { ...recording, effortRating };
    setRecording(next);
    await saveRecording(next);
  };

  if (missing)
    return (
      <main className="screen stack">
        <p>Recording not found.</p>
        <Link to="/data">Back to your data</Link>
      </main>
    );
  if (!recording) return <main className="screen">Loading…</main>;

  const gaps = samples.filter((s) => s.powerW === null).length;

  return (
    <main className="screen stack">
      <div className="row between">
        <h1>{recording.name}</h1>
        <div className="row">
          <button
            onClick={async () => {
              const env = await exportRecording(recording.id);
              if (env) downloadFile(`ride-${recording.startedAt.slice(0, 19)}.json`, JSON.stringify(env, null, 2));
            }}
          >
            Export JSON
          </button>
          <button onClick={() => downloadFile(`ride-${recording.startedAt.slice(0, 19)}.csv`, recordingToCsv(samples), 'text/csv')}>
            Export CSV
          </button>
          <Link to="/data">Back</Link>
        </div>
      </div>

      <div className="row">
        <Pill kind={recording.state === 'completed' ? 'ok' : 'warn'}>{recording.state}</Pill>
        <span className="muted small">
          {new Date(recording.startedAt).toLocaleString()} · {recording.mode.toUpperCase()} · FTP used:{' '}
          {recording.ftpUsed ? `${recording.ftpUsed} W` : '—'}
          {recording.intensityPct && recording.intensityPct !== 100 ? ` · intensity ${recording.intensityPct}%` : ''} ·{' '}
          {formatDuration(recording.summary?.durationS ?? 0)}
        </span>
      </div>

      {recording.resolvedPlan ? (
        <>
          <h2>Plan (as resolved at start)</h2>
          <PowerProfileChart plan={recording.resolvedPlan} ftpW={recording.ftpUsed} height={70} />
        </>
      ) : null}

      {recording.summary ? (
        <div className="row">
          <div className="metric-tile">
            <div className="label">Avg power</div>
            <div className="value">{recording.summary.avgPowerW ?? '—'} <span className="unit">W</span></div>
          </div>
          <div className="metric-tile">
            <div className="label">Max power</div>
            <div className="value">{recording.summary.maxPowerW ?? '—'} <span className="unit">W</span></div>
          </div>
          <div className="metric-tile">
            <div className="label">Avg heart rate</div>
            <div className="value">
              {recording.summary.avgHrBpm !== null ? Math.round(recording.summary.avgHrBpm) : '—'}{' '}
              <span className="unit">bpm</span>
            </div>
          </div>
          <div className="metric-tile">
            <div className="label">Avg cadence</div>
            <div className="value">
              {recording.summary.avgCadenceRpm !== null ? Math.round(recording.summary.avgCadenceRpm) : '—'}{' '}
              <span className="unit">rpm</span>
            </div>
          </div>
          <div className="metric-tile">
            <div className="label">Energy</div>
            <div className="value">{recording.summary.energyKj ?? '—'} <span className="unit">kJ</span></div>
          </div>
        </div>
      ) : null}

      {metrics ? (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Training load</h2>
          <RideMetricsTiles metrics={metrics} />
        </div>
      ) : null}
      {recording.kind === 'workout' ? (
        <div className="card">
          <EffortRating value={recording.effortRating} onChange={(v) => void rate(v)} />
        </div>
      ) : null}

      <div className="stack">
        <TimeSeriesChart samples={samples} value={(s) => s.powerW} title="Power" unit="W" color="var(--accent)" />
        <TimeSeriesChart samples={samples} value={(s) => s.hrBpm} title="Heart rate" unit="bpm" color="var(--zone-vo2)" height={150} />
        <TimeSeriesChart samples={samples} value={(s) => s.cadenceRpm} title="Cadence" unit="rpm" color="var(--zone-endurance)" height={150} />
      </div>
      <p className="muted small">
        {samples.length} samples · {gaps} with no power signal (gaps are preserved, not zero-filled)
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Events</h2>
        <table className="data">
          <tbody>
            {recording.events.map((e, i) => (
              <tr key={i}>
                <td className="num">{formatDuration(e.elapsedS)}</td>
                <td>{e.type}</td>
                <td className="muted small">{e.detail ? JSON.stringify(e.detail) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

