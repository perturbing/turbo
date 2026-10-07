import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRideStore } from '../../state/rideStore';
import { useSettingsStore } from '../../state/settingsStore';
import { useLibraryStore } from '../../state/libraryStore';
import { loadSamples } from '../../data/repositories/recordings';
import { saveFtpObservation } from '../../data/repositories/ftpHistory';
import { bestRollingWindow, estimateFtp, RAMP_METHOD, type BestWindow } from '../../engine/rampTest';
import { formatDuration } from '../../engine/planResolve';

export function RampResultScreen() {
  const navigate = useNavigate();
  const recording = useRideStore((s) => s.lastFinished);
  const clearFinished = useRideStore((s) => s.clearFinished);
  const { settings, update } = useSettingsStore();
  const refreshLibrary = useLibraryStore((s) => s.refresh);
  const [best, setBest] = useState<BestWindow | null | 'loading'>('loading');
  const [decided, setDecided] = useState(false);

  useEffect(() => {
    if (!recording || recording.kind !== 'rampTest') {
      navigate('/training', { replace: true });
      return;
    }
    void (async () => {
      const samples = await loadSamples(recording.id);
      // Evaluation interval: start of the test until cooldown began (the best
      // window may cross stage boundaries and sit anywhere before cooldown).
      const cooldown = recording.events.find((e) => e.type === 'stageAdvanced' && e.detail?.cooldown);
      const evalSamples = cooldown ? samples.filter((s) => s.elapsedS <= cooldown.elapsedS) : samples;
      setBest(bestRollingWindow(evalSamples));
    })();
  }, [recording, navigate]);

  if (!recording) return null;
  if (best === 'loading') return <main className="screen">Calculating…</main>;

  const currentFtp = settings.currentFtpW;
  const candidate = best ? estimateFtp(best) : null;

  const decide = async (accept: boolean) => {
    if (candidate === null || !best) return;
    const obs = {
      schemaVersion: 1 as const,
      id: crypto.randomUUID(),
      method: RAMP_METHOD,
      recordingId: recording.id,
      candidateW: candidate,
      bestWindow: {
        startElapsedS: best.startElapsedS,
        endElapsedS: best.endElapsedS,
        avgPowerW: Math.round(best.avgPowerW * 10) / 10,
      },
      accepted: accept,
      date: new Date().toISOString(),
    };
    await saveFtpObservation(obs);
    if (accept) await update({ currentFtpW: candidate, ftpAcceptedObservationId: obs.id });
    await refreshLibrary();
    setDecided(true);
  };

  const done = () => {
    clearFinished();
    navigate('/training');
  };

  return (
    <main className="screen stack" style={{ maxWidth: 640 }}>
      <h1>Ramp test result</h1>

      {candidate === null ? (
        <div className="card stack">
          <p>
            <strong>No valid 60-second window was found</strong> — the test may have been too short or had
            gaps in the power data. The recording is saved; no FTP estimate is offered.
          </p>
          <button onClick={done}>Back to training level</button>
        </div>
      ) : (
        <div className="card stack">
          <div className="row">
            <div className="metric-tile">
              <div className="label">Estimated FTP</div>
              <div className="value big">{candidate} <span className="unit">W</span></div>
            </div>
            <div className="metric-tile">
              <div className="label">Best 60 s power</div>
              <div className="value">{Math.round(best!.avgPowerW)} <span className="unit">W</span></div>
              <div className="unit">
                at {formatDuration(best!.startElapsedS)}–{formatDuration(best!.endElapsedS)}
              </div>
            </div>
          </div>
          <p className="muted small">
            Method: {RAMP_METHOD} — 75% of the best rolling 60-second average of measured power.
          </p>
          <p className="small">
            Example: with FTP {currentFtp ?? candidate} → {candidate} W, a 60% target changes from{' '}
            {currentFtp ? Math.round(currentFtp * 0.6) : '—'} W to {Math.round(candidate * 0.6)} W. Accepting
            affects future workouts only; past recordings keep their original targets.
          </p>
          {decided ? (
            <div className="row between">
              <span className="pill ok">Saved</span>
              <button className="primary" onClick={done}>
                Back to training level
              </button>
            </div>
          ) : (
            <div className="row">
              <button className="primary" onClick={() => void decide(true)}>
                Use {candidate} W
              </button>
              <button onClick={() => void decide(false)}>
                Keep {currentFtp ? `${currentFtp} W` : 'FTP unset'}
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
