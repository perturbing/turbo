import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRideStore } from '../../state/rideStore';
import { exportRecording, downloadFile } from '../../data/exportImport';
import { formatDuration } from '../../engine/planResolve';
import { Pill } from '../../components/StatusPill';

export function CompletionScreen() {
  const navigate = useNavigate();
  const recording = useRideStore((s) => s.lastFinished);
  const clearFinished = useRideStore((s) => s.clearFinished);
  const [exported, setExported] = useState(false);

  useEffect(() => {
    if (!recording) navigate('/workouts', { replace: true });
  }, [recording, navigate]);

  if (!recording) return null;

  const doExport = async () => {
    const envelope = await exportRecording(recording.id);
    if (envelope) {
      downloadFile(`ride-${recording.startedAt.slice(0, 19)}.json`, JSON.stringify(envelope, null, 2));
      setExported(true);
    }
  };

  return (
    <main className="screen stack" style={{ maxWidth: 640 }}>
      <h1>{recording.state === 'completed' ? 'Workout complete' : 'Ride ended early'}</h1>
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
          Recording saved locally{recording.ftpUsed ? ` · FTP used: ${recording.ftpUsed} W` : ''} · mode{' '}
          {recording.mode.toUpperCase()}
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
