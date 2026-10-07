import type { ConnectionState } from '../ble/types';

export function ConnectionPill({ state }: { state: ConnectionState }) {
  const cls = state === 'connected' ? 'ok' : state === 'disconnected' ? '' : 'warn';
  const label =
    state === 'connected'
      ? 'Connected'
      : state === 'connecting'
        ? 'Connecting…'
        : state === 'reconnecting'
          ? 'Reconnecting…'
          : 'Not connected';
  return <span className={`pill ${cls}`}>{label}</span>;
}

export function Pill({ kind, children }: { kind?: 'ok' | 'warn' | 'danger'; children: React.ReactNode }) {
  return <span className={`pill ${kind ?? ''}`}>{children}</span>;
}
