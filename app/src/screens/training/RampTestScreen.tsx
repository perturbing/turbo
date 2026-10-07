import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRideStore } from '../../state/rideStore';
import { MetricTile } from '../../components/MetricTile';
import { formatDuration } from '../../engine/planResolve';
import { RAMP_V1 } from '../../engine/rampTest';
import { Pill } from '../../components/StatusPill';

export function RampTestScreen() {
  const navigate = useNavigate();
  const { prepared, engine, snapshot, startRide, lastFinished } = useRideStore();
  const [confirmEnd, setConfirmEnd] = useState(false);

  // Store-state-driven navigation; see LiveRideScreen for why engine callbacks
  // are not used here.
  useEffect(() => {
    if (lastFinished && !engine) {
      navigate(lastFinished.kind === 'rampTest' ? '/training/result' : '/complete', { replace: true });
    } else if (prepared?.kind === 'rampTest' && !engine) {
      void startRide();
    } else if (!prepared && !engine) {
      navigate('/training', { replace: true });
    }
  }, [prepared, engine, lastFinished, startRide, navigate]);

  if (!engine || !snapshot) return <main className="screen">Preparing test…</main>;
  const s = snapshot;
  const inCooldown = engine.isInRampCooldown();
  const inWarmup = !inCooldown && s.rampStage === 0;
  const stageRemaining = s.rampStageEndsS !== null ? Math.max(0, s.rampStageEndsS - s.planElapsedS) : null;

  return (
    <div className="ride-screen">
      {s.phase === 'interrupted' ? (
        <div className="banner danger">
          <strong>Trainer connection lost.</strong> Recorded data is safe; reconnecting…
        </div>
      ) : null}

      <div className="row" style={{ justifyContent: 'center' }}>
        <Pill kind={inCooldown ? 'ok' : inWarmup ? undefined : 'warn'}>
          {inCooldown ? 'Cooling down' : inWarmup ? 'Warm-up' : `Stage ${s.rampStage}`}
        </Pill>
        <span className="muted small">
          This test is open-ended — ride until you can't hold the target, then finish.
        </span>
      </div>

      <div className="ride-metrics">
        <MetricTile label="Power" value={s.live.powerW} unit="W" big state={s.live.powerW === null ? 'waiting' : 'value'} />
        <MetricTile label="Target" value={s.targetW} unit="W" big />
        <MetricTile label="Cadence" value={s.live.cadenceRpm} unit="rpm" state={s.live.cadenceRpm === null ? 'waiting' : 'value'} />
        <MetricTile label="Heart rate" value={s.live.hrBpm} unit="bpm" state={s.live.hrBpm === null ? 'waiting' : 'value'} />
      </div>

      <div className="row" style={{ justifyContent: 'center' }}>
        <MetricTile label="Elapsed" text={formatDuration(s.rideElapsedS)} />
        {!inCooldown && stageRemaining !== null ? (
          <MetricTile
            label={inWarmup ? 'Ramp starts in' : 'Next stage in'}
            text={formatDuration(stageRemaining)}
            sub={`next target ${s.targetW! + (inWarmup ? RAMP_V1.stageStartW - RAMP_V1.warmupTargetW : RAMP_V1.stageStepW)} W`}
          />
        ) : null}
      </div>

      <div className="row" style={{ justifyContent: 'center' }}>
        {!inCooldown ? (
          <button className="primary" onClick={() => engine.startRampCooldown()}>
            Finish test &amp; cool down
          </button>
        ) : (
          <button className="primary" onClick={() => void engine.finish('completed')}>
            End cooldown &amp; see result
          </button>
        )}
        <button className="danger" onClick={() => setConfirmEnd(true)}>
          Abandon test
        </button>
      </div>

      {confirmEnd ? (
        <div className="dialog-backdrop" onClick={() => setConfirmEnd(false)}>
          <div className="dialog stack" onClick={(e) => e.stopPropagation()}>
            <h1>Abandon the test?</h1>
            <p className="muted">The recording is saved either way; a result is only offered if a valid 60-second window exists.</p>
            <div className="row">
              <button className="danger" onClick={() => void engine.finish('ended-early')}>
                Abandon
              </button>
              <button onClick={() => setConfirmEnd(false)}>Continue</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
