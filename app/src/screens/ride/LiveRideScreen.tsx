import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRideStore } from '../../state/rideStore';
import { useSettingsStore } from '../../state/settingsStore';
import { MetricTile } from '../../components/MetricTile';
import { RoadView } from '../../components/RoadView';
import { PowerProfileChart } from '../../components/PowerProfileChart';
import { formatDuration } from '../../engine/planResolve';
import { downloadFile } from '../../data/exportImport';
import { Pill } from '../../components/StatusPill';
import { useWakeLock } from '../../hooks/useWakeLock';

export function LiveRideScreen() {
  const navigate = useNavigate();
  const { prepared, engine, snapshot, startRide, lastFinished } = useRideStore();
  const reducedMotion = useSettingsStore((s) => s.settings.reducedMotion);
  const [confirmEnd, setConfirmEnd] = useState(false);

  // Keep the phone screen on for as long as a ride engine is running.
  useWakeLock(!!engine);

  // Navigation is driven by store state, not engine callbacks: when the engine
  // finishes it resets the store, which re-renders this screen before any
  // engine listener owned by it would run.
  useEffect(() => {
    if (lastFinished && !engine) {
      navigate(lastFinished.kind === 'rampTest' ? '/training/result' : '/complete', { replace: true });
    } else if (prepared && !engine) {
      void startRide();
    } else if (!prepared && !engine) {
      navigate('/workouts', { replace: true });
    }
  }, [prepared, engine, lastFinished, startRide, navigate]);

  if (!engine || !snapshot) return <main className="screen">Preparing ride…</main>;

  const s = snapshot;
  const plan = prepared?.plan ?? null;
  const remaining = plan ? Math.max(0, plan.totalS - s.planElapsedS) : null;
  const isShift = prepared?.mode === 'shift';

  return (
    <div className="ride-screen">
      {s.phase === 'interrupted' ? (
        <div className="banner danger row between">
          <strong>Trainer connection lost.</strong>
          <span>Recorded data is safe. Reconnecting automatically…</span>
        </div>
      ) : null}
      {s.saveError ? (
        <div className="banner danger row between">
          <span>
            <strong>Saving failed:</strong> {s.saveError}
          </span>
          <button
            onClick={() =>
              downloadFile(
                `ride-emergency-${new Date().toISOString()}.json`,
                JSON.stringify({ samples: engine.getSamples(), events: engine.getEvents() }, null, 2),
              )
            }
          >
            Export now
          </button>
        </div>
      ) : null}
      {!s.targetConfirmed && s.phase === 'riding' ? (
        <div className="banner">Target not confirmed by the trainer yet — retrying.</div>
      ) : null}

      <div className="ride-metrics">
        <MetricTile label="Power" value={s.live.powerW} unit="W" big state={s.live.powerW === null ? 'waiting' : 'value'} />
        <MetricTile
          label="Target"
          value={s.targetW}
          unit="W"
          big
          sub={s.currentStep?.label ?? (s.rampStage !== null ? (s.rampStage === 0 ? 'Warm-up' : `Stage ${s.rampStage}`) : undefined)}
        />
        <MetricTile
          label="Cadence"
          value={s.live.cadenceRpm}
          unit="rpm"
          state={s.live.cadenceRpm === null ? 'waiting' : 'value'}
          sub={s.currentStep?.cadence ? `target ${s.currentStep.cadence.minRpm}–${s.currentStep.cadence.maxRpm}` : undefined}
        />
        <MetricTile label="Heart rate" value={s.live.hrBpm} unit="bpm" state={s.live.hrBpm === null ? 'waiting' : 'value'} />
        {isShift ? <MetricTile label="Gear" value={s.gear} unit={`${s.gradePct >= 0 ? '+' : ''}${s.gradePct.toFixed(1)}%`} /> : null}
      </div>

      {plan ? (
        <>
          <RoadView plan={plan} ftpW={prepared?.ftpUsed ?? null} planElapsedS={s.planElapsedS} samples={engine.getSamples()} reducedMotion={reducedMotion} />
          <PowerProfileChart plan={plan} ftpW={prepared?.ftpUsed ?? null} height={46} progressS={s.planElapsedS} />
        </>
      ) : null}

      <div className="row between">
        <div className="row">
          <MetricTile label="Elapsed" text={formatDuration(s.rideElapsedS)} />
          {remaining !== null ? <MetricTile label="Remaining" text={formatDuration(remaining)} /> : null}
          {s.nextStep ? (
            <span className="muted small">
              Next: {s.nextStep.label ?? s.nextStep.kind} · {s.nextStep.targetW}
              {s.nextStep.targetEndW !== undefined ? `→${s.nextStep.targetEndW}` : ''} W in{' '}
              {formatDuration(Math.max(0, (s.currentStep?.endS ?? 0) - s.planElapsedS))}
            </span>
          ) : null}
          {s.phase === 'paused' ? <Pill kind="warn">Paused</Pill> : null}
        </div>
        <div className="row">
          {isShift ? (
            <>
              <button onClick={() => engine.shift(-1)}>Gear −</button>
              <button onClick={() => engine.shift(1)}>Gear +</button>
            </>
          ) : null}
          {s.phase === 'riding' ? (
            <button onClick={() => engine.pause()}>Pause</button>
          ) : s.phase === 'paused' ? (
            <button className="primary" onClick={() => engine.resume()}>
              Resume
            </button>
          ) : null}
          <button className="danger" onClick={() => setConfirmEnd(true)}>
            End ride
          </button>
        </div>
      </div>

      {confirmEnd ? (
        <div className="dialog-backdrop" onClick={() => setConfirmEnd(false)}>
          <div className="dialog stack" onClick={(e) => e.stopPropagation()}>
            <h1>End this ride?</h1>
            <p className="muted">The partial ride is saved and marked as ended early.</p>
            <div className="row">
              <button className="danger" onClick={() => void engine.finish('ended-early')}>
                End ride
              </button>
              <button onClick={() => setConfirmEnd(false)}>Keep riding</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
