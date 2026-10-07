import { useEffect, useState } from 'react';
import { useDeviceStore, metricDisplay } from '../../state/deviceStore';
import { canReattach, getTrainer } from '../../ble/deviceManager';
import {
  connectHrm,
  connectPod,
  connectTrainer,
  disconnectHrm,
  disconnectPods,
  disconnectTrainer,
  isBluetoothSupported,
  reattachGrantedDevices,
} from '../../ble/deviceManager';
import { ConnectionPill, Pill } from '../../components/StatusPill';
import { MetricTile } from '../../components/MetricTile';
import { ButtonCheckDrawer } from './ButtonCheckDrawer';

export function DevicesScreen() {
  const store = useDeviceStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buttonCheck, setButtonCheck] = useState(false);
  const [ergTest, setErgTest] = useState(false);

  if (!isBluetoothSupported()) return <UnsupportedBrowser />;

  const run = (label: string, fn: () => Promise<unknown>) => async () => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      // NotFoundError = user dismissed the chooser; not an error worth shouting about.
      if (!(e instanceof DOMException && e.name === 'NotFoundError'))
        setError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setBusy(null);
    }
  };

  const now = Date.now();
  const power = metricDisplay(store.power, now);
  const cadence = metricDisplay(store.cadence, now);
  const hr = metricDisplay(store.hr, now);

  return (
    <main className="screen stack">
      <div className="row between">
        <h1>Devices</h1>
        <div className="row">
          {store.mockMode ? <Pill kind="warn">Mock devices</Pill> : null}
          {store.reattaching ? <Pill>Looking for previous devices…</Pill> : null}
          {canReattach() ? (
            <button className="small" onClick={run('reattach', reattachGrantedDevices)} disabled={busy !== null}>
              Reconnect granted devices
            </button>
          ) : null}
        </div>
      </div>
      {error ? <div className="banner danger">{error}</div> : null}
      {!store.mockMode && store.bluetoothSupported && !canReattach() ? (
        <p className="muted small" style={{ margin: 0 }}>
          To reconnect automatically after a page refresh (no chooser), enable{' '}
          <code>chrome://flags/#enable-web-bluetooth-new-permissions-backend</code> and relaunch the browser.
        </p>
      ) : null}

      <section className="card stack">
        <div className="row between">
          <div className="row">
            <strong>Trainer</strong>
            {store.trainerName ? <span className="muted">{store.trainerName}</span> : null}
            <ConnectionPill state={store.trainerConnection} />
            {store.trainerConnection === 'connected' ? (
              <Pill kind={store.trainerHasControl ? 'ok' : undefined}>
                {store.trainerHasControl ? 'Control granted' : 'Control not requested'}
              </Pill>
            ) : null}
          </div>
          <div className="row">
            {store.trainerConnection === 'connected' ? (
              <>
                <button className="small" onClick={() => setErgTest((v) => !v)}>
                  {ergTest ? 'Hide ERG test' : 'Test ERG'}
                </button>
                <button className="small" onClick={run('trainer', disconnectTrainer)}>
                  Disconnect
                </button>
              </>
            ) : (
              <button className="primary" onClick={run('trainer', connectTrainer)} disabled={busy !== null}>
                {store.trainerName ? 'Reconnect' : 'Connect trainer'}
              </button>
            )}
          </div>
        </div>
        {store.trainerConnection === 'connected' ? (
          <div className="row">
            <MetricTile label="Power" value={power.value ?? null} unit="W" state={power.kind === 'value' ? 'value' : power.kind} />
            <MetricTile label="Cadence" value={cadence.value ?? null} unit="rpm" state={cadence.kind === 'value' ? 'value' : cadence.kind} />
            {store.trainerPowerRange ? (
              <span className="muted small">
                Supported power {store.trainerPowerRange.min}–{store.trainerPowerRange.max} W · ERG & SIM
              </span>
            ) : null}
          </div>
        ) : null}
        {store.trainerConnection === 'connected' ? <RiderWeightRow /> : null}
        {ergTest && store.trainerConnection === 'connected' ? <ErgTestPanel /> : null}
      </section>

      <section className="card stack">
        <div className="row between">
          <div className="row">
            <strong>Controls</strong>
            <span className="muted small">Zwift Ride — each pod connects separately</span>
          </div>
          <div className="row">
            <button className="small" onClick={() => setButtonCheck(true)} disabled={store.pods.length === 0}>
              Check buttons
            </button>
            {store.pods.length > 0 ? (
              <button className="small" onClick={run('pods', disconnectPods)}>
                Disconnect all
              </button>
            ) : null}
            <button className="primary" onClick={run('pod', connectPod)} disabled={busy !== null}>
              Connect pod
            </button>
          </div>
        </div>
        {store.pods.length === 0 ? (
          <p className="muted small">
            No pods connected. The Zwift Ride is two Bluetooth devices (left and right); connect each one.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="stack">
            {store.pods.map((pod) => (
              <li key={pod.id} className="row">
                <span>{pod.name}</span>
                <ConnectionPill state={pod.connection} />
                {pod.batteryPct !== null ? <span className="muted small">Battery {pod.batteryPct}%</span> : null}
              </li>
            ))}
          </ul>
        )}
        {store.lastButton ? (
          <p className="small muted">Last detected button: <strong>{store.lastButton.button}</strong></p>
        ) : null}
      </section>

      <section className="card stack">
        <div className="row between">
          <div className="row">
            <strong>Heart rate</strong>
            <span className="muted small">optional</span>
            {store.hrmName ? <span className="muted">{store.hrmName}</span> : null}
            <ConnectionPill state={store.hrmConnection} />
            {store.hrmBatteryPct !== null ? <span className="muted small">Battery {store.hrmBatteryPct}%</span> : null}
          </div>
          <div className="row">
            {store.hrmConnection === 'connected' ? (
              <button className="small" onClick={run('hrm', disconnectHrm)}>
                Disconnect
              </button>
            ) : (
              <button onClick={run('hrm', connectHrm)} disabled={busy !== null}>
                {store.hrmName ? 'Reconnect' : 'Connect heart rate'}
              </button>
            )}
          </div>
        </div>
        {store.hrmConnection === 'connected' ? (
          <div className="row">
            <MetricTile label="Heart rate" value={hr.value ?? null} unit="bpm" state={hr.kind === 'value' ? 'value' : hr.kind} />
          </div>
        ) : null}
      </section>

      {buttonCheck ? <ButtonCheckDrawer onClose={() => setButtonCheck(false)} /> : null}
    </main>
  );
}

// Rider weight stored on the trainer (User Data 0x2A98). It drives SIM-mode
// physics (our Shift virtual gears), so it should match the actual rider.
function RiderWeightRow() {
  const trainerConnection = useDeviceStore((s) => s.trainerConnection);
  const [weight, setWeight] = useState<number | null | 'loading'>('loading');
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setWeight('loading');
    void getTrainer()
      ?.readWeightKg()
      .then((kg) => {
        if (!cancelled) setWeight(kg);
      });
    return () => {
      cancelled = true;
    };
  }, [trainerConnection]);

  const save = async () => {
    const kg = Number(input);
    if (!kg || kg < 30 || kg > 200) return;
    setStatus(null);
    const confirmed = await getTrainer()?.writeWeightKg(kg);
    if (confirmed == null) {
      setStatus('The trainer did not accept the weight.');
    } else {
      setWeight(confirmed);
      setStatus(`Trainer confirmed ${confirmed.toFixed(1)} kg`);
      setEditing(false);
    }
  };

  if (weight === 'loading') return null;
  return (
    <div className="row" style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
      <strong>Rider weight</strong>
      {weight === null ? (
        <span className="muted small">
          Not readable — if this trainer was paired before weight support, disconnect and pair it again.
        </span>
      ) : editing ? (
        <>
          <input
            type="number"
            min={30}
            max={200}
            step={0.5}
            style={{ width: 90 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
          />
          <span className="muted small">kg</span>
          <button className="small primary" onClick={() => void save()}>
            Save to trainer
          </button>
          <button className="small" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <span>{weight.toFixed(1)} kg</span>
          <button
            className="small"
            onClick={() => {
              setInput(weight.toFixed(1));
              setEditing(true);
              setStatus(null);
            }}
          >
            Change
          </button>
          <span className="muted small">used by the trainer's slope simulation (Shift mode)</span>
        </>
      )}
      {status ? <span className="pill ok">{status}</span> : null}
    </div>
  );
}

// Manual ERG test: send a target power and show the trainer's actual FTMS
// acknowledgement — never claims a target applied without one. "Release" sends
// Reset so the trainer goes back to passive resistance.
function ErgTestPanel() {
  const powerRange = useDeviceStore((s) => s.trainerPowerRange);
  const hasControl = useDeviceStore((s) => s.trainerHasControl);
  const [target, setTarget] = useState(100);
  const [status, setStatus] = useState<{ kind: 'ok' | 'warn' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const min = powerRange?.min ?? 0;
  const max = powerRange?.max ?? 2000;
  const clamp = (w: number) => Math.max(min, Math.min(max, Math.round(w)));

  const send = async (watts: number) => {
    const trainer = getTrainer();
    if (!trainer) return;
    const w = clamp(watts);
    setTarget(w);
    setBusy(true);
    try {
      if (!trainer.hasControl && !(await trainer.requestControl())) {
        setStatus({ kind: 'danger', text: 'Trainer refused control (is another app connected?)' });
        return;
      }
      const result = await trainer.setTargetPower(w);
      setStatus(
        result === 'success'
          ? { kind: 'ok', text: `Target ${w} W confirmed by the trainer` }
          : { kind: 'danger', text: `Trainer rejected target ${w} W: ${result}` },
      );
    } catch (e) {
      setStatus({ kind: 'danger', text: e instanceof Error ? e.message : 'Write failed' });
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    const trainer = getTrainer();
    if (!trainer) return;
    setBusy(true);
    try {
      await trainer.release();
      setStatus({ kind: 'warn', text: 'Control released — trainer is back to passive resistance' });
    } catch (e) {
      setStatus({ kind: 'danger', text: e instanceof Error ? e.message : 'Release failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
      <div className="row">
        <strong>ERG test</strong>
        <span className="muted small">
          sets a target the trainer holds while you pedal · range {min}–{max} W
        </span>
      </div>
      <div className="row">
        <button className="small" disabled={busy} onClick={() => void send(target - 10)}>
          −10
        </button>
        <input
          type="number"
          min={min}
          max={max}
          step={5}
          style={{ width: 90 }}
          value={target}
          onChange={(e) => setTarget(Number(e.target.value) || 0)}
        />
        <span className="muted small">W</span>
        <button className="small" disabled={busy} onClick={() => void send(target + 10)}>
          +10
        </button>
        <button className="primary small" disabled={busy} onClick={() => void send(target)}>
          Set target
        </button>
        <button className="small" disabled={busy || !hasControl} onClick={() => void release()}>
          Release control
        </button>
      </div>
      {status ? <span className={`pill ${status.kind}`}>{status.text}</span> : null}
      <p className="muted small" style={{ margin: 0 }}>
        Watch the live power tile above while pedalling — it should settle near the target.
      </p>
    </div>
  );
}

function UnsupportedBrowser() {
  const secure = window.isSecureContext;
  const origin = window.location.origin;
  return (
    <main className="screen stack">
      <h1>Devices</h1>
      <div className="banner danger stack">
        <strong>Web Bluetooth is not available on this page.</strong>
        {!secure ? (
          <>
            <p>
              <strong>Cause: this page is not a secure context.</strong> You opened it from{' '}
              <code>{origin}</code>. Browsers only expose Web Bluetooth on <code>http://localhost</code> /{' '}
              <code>http://127.0.0.1</code> or over <code>https://</code> — a LAN IP over plain{' '}
              <code>http://</code> or a <code>file://</code> page will never work, in any browser.
            </p>
            <p className="small">
              Fix: run <code>npm run dev</code> and open <code>http://localhost:5173</code> on the same
              machine, or serve <code>dist/</code> over HTTPS. To use another device on your network, either
              set up HTTPS or use a port forward so it is localhost there (e.g.{' '}
              <code>ssh -L 5173:localhost:5173 &lt;this machine&gt;</code>).
            </p>
          </>
        ) : (
          <>
            <p>
              <strong>Cause: this browser build has Web Bluetooth switched off.</strong> The page is a secure
              context (<code>{origin}</code>), but <code>navigator.bluetooth</code> is missing.
            </p>
            <ul className="small">
              <li>
                <strong>Linux (Chrome, Chromium, Brave):</strong> Web Bluetooth is off by default on Linux.
                Enable <code>chrome://flags/#enable-web-bluetooth</code> and relaunch — or start the browser
                with <code>--enable-features=WebBluetooth</code>. (<code>chrome://bluetooth-internals</code>{' '}
                working does not imply the web API is on.)
              </li>
              <li>
                <strong>Brave (all platforms):</strong> additionally enable{' '}
                <code>brave://flags/#brave-web-bluetooth-api</code> — on Linux you need both flags.
              </li>
              <li>
                <strong>ungoogled-chromium</strong> strips Web Bluetooth entirely; use regular Chromium,
                Chrome, or Brave.
              </li>
              <li>Firefox and Safari don’t implement Web Bluetooth at all.</li>
            </ul>
          </>
        )}
        <p className="small muted">
          Tip for development without hardware: open the app with <code>?mock=1</code> to use simulated
          devices.
        </p>
      </div>
    </main>
  );
}
