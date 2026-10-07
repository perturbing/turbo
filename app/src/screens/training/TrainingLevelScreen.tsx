import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSettingsStore } from '../../state/settingsStore';
import { useLibraryStore } from '../../state/libraryStore';
import { useRideStore } from '../../state/rideStore';
import { useReadiness, ReadinessChecklist } from '../../components/ReadinessChecklist';
import { saveFtpObservation } from '../../data/repositories/ftpHistory';
import { RAMP_METHOD, RAMP_V1 } from '../../engine/rampTest';

export function TrainingLevelScreen() {
  const navigate = useNavigate();
  const { settings, update } = useSettingsStore();
  const { ftpHistory, recordings, refresh } = useLibraryStore();
  const prepare = useRideStore((s) => s.prepare);
  const readiness = useReadiness('erg', false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualW, setManualW] = useState('');

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ftp = settings.currentFtpW;
  const accepted = ftpHistory.find((o) => o.id === settings.ftpAcceptedObservationId);
  const lastTest = ftpHistory.find((o) => o.method === 'ramp-v1');
  const lastTestRecording = lastTest?.recordingId
    ? recordings.find((r) => r.id === lastTest.recordingId)
    : undefined;

  const startRamp = () => {
    prepare({ kind: 'rampTest', plan: null, mode: 'erg', ftpUsed: ftp, name: 'Ramp test' });
    navigate('/training/ramp');
  };

  const saveManual = async () => {
    const watts = Math.round(Number(manualW));
    if (!watts || watts < 30 || watts > 600) return;
    const obs = {
      schemaVersion: 1 as const,
      id: crypto.randomUUID(),
      method: 'manual' as const,
      candidateW: watts,
      accepted: true,
      date: new Date().toISOString(),
    };
    await saveFtpObservation(obs);
    await update({ currentFtpW: watts, ftpAcceptedObservationId: obs.id });
    await refresh();
    setManualOpen(false);
    setManualW('');
  };

  return (
    <main className="screen stack">
      <h1>Training level</h1>

      <div className="row">
        <div className="card stack" style={{ flex: 1, minWidth: 280 }}>
          <div className="metric-tile" style={{ alignSelf: 'flex-start' }}>
            <div className="label">Current FTP</div>
            <div className="value big">{ftp ?? '—'} {ftp ? <span className="unit">W</span> : null}</div>
          </div>
          {accepted ? (
            <p className="muted small">
              Accepted {new Date(accepted.date).toLocaleDateString()} ·{' '}
              {accepted.method === 'manual' ? 'entered manually' : `from ${RAMP_METHOD} test`}
              {accepted.recordingId ? (
                <>
                  {' · '}
                  <Link to={`/data/${accepted.recordingId}`}>view recording</Link>
                </>
              ) : null}
            </p>
          ) : (
            <p className="muted small">No FTP yet. Run a ramp test or enter a value you already know.</p>
          )}
          {ftp ? (
            <>
              <h2>What your targets resolve to</h2>
              <table className="data" style={{ maxWidth: 320 }}>
                <tbody>
                  {[50, 60, 75, 90, 110].map((pct) => (
                    <tr key={pct}>
                      <td>{pct}% FTP</td>
                      <td className="num">{Math.round((pct / 100) * ftp)} W</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          <div className="row">
            <button onClick={() => setManualOpen(true)}>Set FTP manually</button>
          </div>
        </div>

        <div className="card stack" style={{ flex: 1, minWidth: 280 }}>
          <h2 style={{ marginTop: 0 }}>Ramp test</h2>
          <p className="muted small">
            {RAMP_V1.warmupS / 60} min warm-up at {RAMP_V1.warmupTargetW} W, then +{RAMP_V1.stageStepW} W every{' '}
            {RAMP_V1.stageDurationS} s until you can't continue. Your FTP estimate is{' '}
            {RAMP_V1.estimateMultiplier * 100}% of your best 60-second power ({RAMP_METHOD}).
          </p>
          {lastTest ? (
            <p className="muted small">
              Last test: {new Date(lastTest.date).toLocaleDateString()} → {lastTest.candidateW} W (
              {lastTest.accepted ? 'accepted' : 'declined'})
              {lastTestRecording ? (
                <>
                  {' · '}
                  <Link to={`/data/${lastTestRecording.id}`}>recording</Link>
                </>
              ) : null}
            </p>
          ) : null}
          <ReadinessChecklist readiness={readiness} />
          <button className="primary" disabled={!readiness.ready} onClick={startRamp}>
            {lastTest ? 'Repeat ramp test' : 'Start ramp test'}
          </button>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>FTP history</h2>
        {ftpHistory.length === 0 ? (
          <p className="muted small">No observations yet.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Method</th>
                <th className="num">Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {ftpHistory.map((o) => (
                <tr key={o.id}>
                  <td>{new Date(o.date).toLocaleString()}</td>
                  <td>{o.method}</td>
                  <td className="num">{o.candidateW} W</td>
                  <td>{o.accepted ? 'accepted' : 'declined'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {manualOpen ? (
        <div className="dialog-backdrop" onClick={() => setManualOpen(false)}>
          <div className="dialog stack" onClick={(e) => e.stopPropagation()}>
            <h1>Set FTP manually</h1>
            <p className="muted small">
              Saved to your FTP history as a manual entry, distinguishable from test results.
            </p>
            <div className="field">
              <label>FTP (watts)</label>
              <input type="number" min={30} max={600} value={manualW} onChange={(e) => setManualW(e.target.value)} autoFocus />
            </div>
            <div className="row">
              <button className="primary" onClick={() => void saveManual()} disabled={!Number(manualW)}>
                Save
              </button>
              <button onClick={() => setManualOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
