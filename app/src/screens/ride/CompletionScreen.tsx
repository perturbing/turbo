import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRideStore } from '../../state/rideStore';
import { exportRecording, exportUnsavedRecording, downloadFile } from '../../data/exportImport';
import { formatDuration } from '../../engine/planResolve';
import { Pill } from '../../components/StatusPill';
import { useSettingsStore } from '../../state/settingsStore';
import { saveRecording } from '../../data/repositories/recordings';
import { metricsFor } from '../../data/repositories/rideMetrics';
import type { RideMetrics } from '../../engine/metrics';
import { EffortRating } from '../../components/EffortRating';
import { RideMetricsTiles } from '../../components/RideMetricsTiles';

export function CompletionScreen() {
  const navigate = useNavigate();
  const recording = useRideStore((s) => s.lastFinished);
  const saveFailure = useRideStore((s) => s.saveFailure);
  const clearFinished = useRideStore((s) => s.clearFinished);
  const updateFinished = useRideStore((s) => s.updateFinished);
  const ftp = useSettingsStore((s) => s.settings.currentFtpW);
  const [exported, setExported] = useState(false);
  const [metrics, setMetrics] = useState<RideMetrics | null>(null);

  useEffect(() => {
    if (!recording) navigate('/workouts', { replace: true });
  }, [recording, navigate]);

  const recordingId = recording?.id;
  useEffect(() => {
    if (!recording || !recordingId) return;
    void metricsFor(recording, ftp).then(setMetrics).catch(() => setMetrics(null));
    // Only recompute when a different ride finishes, not on every field change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingId, ftp]);

  if (!recording) return null;

  const rate = async (effortRating: number) => {
    updateFinished({ effortRating });
    await saveRecording({ ...recording, effortRating });
  };

  const doExport = async () => {
    // After a failed save the database is missing part of the ride; the
    // engine's own samples are the complete record.
    const envelope = saveFailure
      ? exportUnsavedRecording(recording, saveFailure.samples, saveFailure.error)
      : await exportRecording(recording.id);
    if (envelope) {
      downloadFile(`ride-${recording.startedAt.slice(0, 19)}.json`, JSON.stringify(envelope, null, 2));
      setExported(true);
    }
  };

  return (
    <main className="screen stack" style={{ maxWidth: 640 }}>
      <h1>{recording.state === 'completed' ? 'Workout complete' : 'Ride ended early'}</h1>
      {saveFailure ? (
        <div className="banner danger stack">
          <span>
            <strong>Saving failed:</strong> {saveFailure.error}
          </span>
          <span>
            The app holds only what was autosaved before the failure. Export now to keep the full ride; it can
            be imported from Your data later.
          </span>
          <button onClick={() => void doExport()}>Export full ride</button>
        </div>
      ) : null}
      <div className="card stack">
        <div className="row between">
          <strong>{recording.name}</strong>
          <Pill kind={recording.state === 'completed' ? 'ok' : 'warn'}>{recording.state}</Pill>
        </div>
        <div className="row">
          <div className="metric-tile">
            <div className="label">Duration</div>
            <div className="value">{formatDuration(recording.summary?.durationS ?? 0)}</div>
          </div>
          <div className="metric-tile">
            <div className="label">Avg power</div>
            <div className="value">{recording.summary?.avgPowerW ?? '—'} <span className="unit">W</span></div>
          </div>
          <div className="metric-tile">
            <div className="label">Max power</div>
            <div className="value">{recording.summary?.maxPowerW ?? '—'} <span className="unit">W</span></div>
          </div>
          <div className="metric-tile">
            <div className="label">Avg heart rate</div>
            <div className="value">
              {recording.summary?.avgHrBpm != null ? Math.round(recording.summary.avgHrBpm) : '—'}{' '}
              <span className="unit">bpm</span>
            </div>
          </div>
          <div className="metric-tile">
            <div className="label">Energy</div>
            <div className="value">{recording.summary?.energyKj ?? '—'} <span className="unit">kJ</span></div>
          </div>
        </div>
        <p className="muted small">
          {saveFailure ? 'Recording NOT fully saved' : 'Recording saved locally'}{recording.ftpUsed ? ` · FTP used: ${recording.ftpUsed} W` : ''}
          {recording.intensityPct && recording.intensityPct !== 100 ? ` · intensity ${recording.intensityPct}%` : ''} · mode{' '}
          {recording.mode.toUpperCase()}
        </p>
      </div>
      <div className="card stack">
        <EffortRating value={recording.effortRating} onChange={(v) => void rate(v)} />
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Training load</h2>
        {metrics ? <RideMetricsTiles metrics={metrics} /> : <p className="muted small">Computing…</p>}
        <p className="muted small">
          Tap any <span className="explain-toggle" aria-hidden="true">?</span> for what the number means. These feed the{' '}
          <Link to="/form">Form</Link> screen, which tells you whether to load, hold or rest.
        </p>
      </div>
      <div className="row">
        <button className="primary" onClick={() => void doExport()}>
          {exported ? 'Exported ✓' : 'Export ride'}
        </button>
        <button
          onClick={() => {
            clearFinished();
            navigate('/workouts');
          }}
        >
          Back to workouts
        </button>
        <Link to={`/data/${recording.id}`} className="small" style={{ alignSelf: 'center' }}>
          View details
        </Link>
      </div>
    </main>
  );
}
