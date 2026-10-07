import { useDeviceStore, metricDisplay } from '../state/deviceStore';
import { useSettingsStore } from '../state/settingsStore';
import type { RideMode } from '../data/schema';
import { Link } from 'react-router-dom';

export interface Readiness {
  ready: boolean;
  // pending: not satisfied yet but handled automatically (doesn't gate Start,
  // shown neutrally instead of as "Missing").
  items: { label: string; ok: boolean; detail?: string; optional?: boolean; pending?: boolean }[];
}

// "Ready to ride" means the requirements of the selected mode are met, not
// simply that Bluetooth is connected: connection, receiving measurements and
// control readiness are separate states (design doc §8).
export function useReadiness(mode: RideMode, needsFtp: boolean): Readiness {
  const trainerConnection = useDeviceStore((s) => s.trainerConnection);
  const hasControl = useDeviceStore((s) => s.trainerHasControl);
  const power = useDeviceStore((s) => s.power);
  const pods = useDeviceStore((s) => s.pods);
  const hrmConnection = useDeviceStore((s) => s.hrmConnection);
  const ftp = useSettingsStore((s) => s.settings.currentFtpW);

  const now = Date.now();
  const powerState = metricDisplay(power, now);
  const items: Readiness['items'] = [
    { label: 'Trainer connected', ok: trainerConnection === 'connected' },
    {
      label: 'Receiving power data',
      ok: powerState.kind === 'value',
      detail: powerState.kind === 'stale' ? 'Signal lost' : powerState.kind === 'waiting' ? 'Waiting for data' : undefined,
    },
    {
      label: mode === 'erg' ? 'Trainer control (ERG)' : 'Trainer control (Shift)',
      ok: hasControl,
      pending: true,
      detail: hasControl ? undefined : 'Requested automatically on connect and at ride start',
    },
  ];
  if (needsFtp) items.push({ label: 'FTP set', ok: ftp !== null, detail: ftp ? `${ftp} W` : 'Needed to scale targets' });
  if (mode === 'shift')
    items.push({
      label: 'Shifters',
      ok: pods.some((p) => p.connection === 'connected'),
      optional: true,
      detail: 'On-screen shifting is available as fallback',
    });
  items.push({
    label: 'Heart rate',
    ok: hrmConnection === 'connected',
    optional: true,
    detail: 'Optional',
  });

  // Control is requested at ride start, so it does not gate Start; connection,
  // live data and FTP (when the plan scales) do.
  const ready =
    trainerConnection === 'connected' && powerState.kind === 'value' && (!needsFtp || ftp !== null);
  return { ready, items };
}

export function ReadinessChecklist({ readiness }: { readiness: Readiness }) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} className="stack">
      {readiness.items.map((item) => (
        <li key={item.label} className="row" style={{ gap: '0.5rem' }}>
          <span className={`pill ${item.ok ? 'ok' : item.optional || item.pending ? '' : 'warn'}`}>
            {item.ok ? 'Ready' : item.optional ? 'Optional' : item.pending ? 'At start' : 'Missing'}
          </span>
          <span>{item.label}</span>
          {item.detail ? <span className="muted small">{item.detail}</span> : null}
        </li>
      ))}
      <li className="small">
        <Link to="/devices">Open Devices</Link>
      </li>
    </ul>
  );
}
