import { useEffect, useState } from 'react';
import { getPods } from '../../ble/deviceManager';
import { useDeviceStore } from '../../state/deviceStore';
import { RIDE_BUTTONS, type RideButton } from '../../ble/decoders/zwiftRide';
import { MockControlsPods } from '../../ble/mock/mockPods';

// Read-only button check: highlights detected inputs without sending any
// trainer-control commands (design doc §8).
export function ButtonCheckDrawer({ onClose }: { onClose: () => void }) {
  const [seen, setSeen] = useState<Set<RideButton>>(new Set());
  const [last, setLast] = useState<RideButton | null>(null);
  const pods = getPods();

  useEffect(() => {
    if (!pods) return;
    const unsub = pods.onButton((b) => {
      setLast(b);
      setSeen((prev) => new Set(prev).add(b));
    });
    return unsub;
  }, [pods]);

  return (
    // data-pod-capture: while this drawer is open, the native button mapping is
    // suspended so testing buttons has no navigation side effects.
    <div className="drawer-backdrop" data-pod-capture onClick={onClose}>
      <div className="drawer stack" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h1>Check buttons</h1>
          <button className="small" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted small">
          Press buttons on the pods — detected presses light up below. Nothing is sent to the trainer.
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {RIDE_BUTTONS.map((b) => (
            <span
              key={b}
              className={`pill ${seen.has(b) ? 'ok' : ''}`}
              style={last === b ? { outline: '2px solid var(--accent)' } : undefined}
            >
              {b}
            </span>
          ))}
        </div>
        <h2>Native button mapping</h2>
        <table className="data small">
          <tbody>
            <tr><td>D-pad</td><td>move focus between controls</td></tr>
            <tr><td>A</td><td>activate the focused control</td></tr>
            <tr><td>B</td><td>close dialog/drawer, otherwise back</td></tr>
            <tr><td>Y</td><td>cycle sections (Workouts → Training → Devices → Data)</td></tr>
            <tr><td>Z</td><td>pause / resume during a workout</td></tr>
            <tr><td>Shift paddles</td><td>virtual gears in Shift mode</td></tr>
          </tbody>
        </table>
        <p className="muted small">Mapping is paused while this drawer is open.</p>
        <h2>Analog levers</h2>
        <LeverBar label="Left lever" hintNeg="steer left" hintPos="brake" side="left" />
        <LeverBar label="Right lever" hintNeg="brake" hintPos="steer right" side="right" />
        <p className="muted small">Squeeze a lever — the bar follows it from −100 to +100.</p>
        {pods instanceof MockControlsPods ? (
          <div className="stack">
            <p className="muted small">Mock pods — simulate a press:</p>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {RIDE_BUTTONS.map((b) => (
                <button key={b} className="small" onClick={() => pods.simulatePress(b)}>
                  {b}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Live −100..+100 bar for one analog lever, filling from the centre.
function LeverBar({
  label,
  hintNeg,
  hintPos,
  side,
}: {
  label: string;
  hintNeg: string;
  hintPos: string;
  side: 'left' | 'right';
}) {
  const value = useDeviceStore((s) => s.levers[side]);
  const pct = Math.max(-100, Math.min(100, value));
  const fillLeft = pct < 0 ? 50 + pct / 2 : 50;
  const fillWidth = Math.abs(pct) / 2;
  return (
    <div className="stack" style={{ gap: '0.2rem' }}>
      <div className="row between small">
        <span>
          {label} <span className="muted">(−100 {hintNeg} · +100 {hintPos})</span>
        </span>
        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{pct}</strong>
      </div>
      <div
        style={{
          position: 'relative',
          height: 14,
          borderRadius: 7,
          background: 'var(--bg-sunken)',
          border: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: `${fillLeft}%`,
            width: `${fillWidth}%`,
            top: 1,
            bottom: 1,
            background: 'var(--accent)',
            borderRadius: 6,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            bottom: 0,
            width: 2,
            background: 'var(--border)',
          }}
        />
      </div>
    </div>
  );
}
