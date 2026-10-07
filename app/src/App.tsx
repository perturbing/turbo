import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useRideStore } from './state/rideStore';
import { useSettingsStore } from './state/settingsStore';
import { useDeviceStore } from './state/deviceStore';
import { findInProgressRecordings, saveRecording } from './data/repositories/recordings';
import type { RideRecording } from './data/schema';
import { Pill } from './components/StatusPill';

export function App() {
  const riding = useRideStore((s) => s.engine !== null);
  const ftp = useSettingsStore((s) => s.settings.currentFtpW);
  const mockMode = useDeviceStore((s) => s.mockMode);
  const [recoverable, setRecoverable] = useState<RideRecording[]>([]);

  // Crash recovery: a recording still marked in-progress at launch means the
  // app died mid-ride; the autosaved chunks are intact.
  useEffect(() => {
    void findInProgressRecordings().then(setRecoverable);
  }, []);

  const finalizeRecovered = async () => {
    for (const rec of recoverable) {
      await saveRecording({ ...rec, state: 'recovered', endedAt: rec.endedAt ?? new Date().toISOString() });
    }
    setRecoverable([]);
  };

  return (
    <>
      {!riding ? (
        <nav className="app-nav">
          <span className="brand">BIKE</span>
          <NavLink to="/workouts" className={({ isActive }) => (isActive ? 'active' : '')}>
            Workouts
          </NavLink>
          <NavLink to="/calendar" className={({ isActive }) => (isActive ? 'active' : '')}>
            Calendar
          </NavLink>
          <NavLink to="/training" className={({ isActive }) => (isActive ? 'active' : '')}>
            Training level
          </NavLink>
          <NavLink to="/devices" className={({ isActive }) => (isActive ? 'active' : '')}>
            Devices
          </NavLink>
          <NavLink to="/data" className={({ isActive }) => (isActive ? 'active' : '')}>
            Your data
          </NavLink>
          <span className="spacer" />
          {mockMode ? <Pill kind="warn">Mock</Pill> : null}
          <span className="ftp-chip">FTP {ftp ? `${ftp} W` : 'not set'}</span>
        </nav>
      ) : null}
      <Outlet />

      {recoverable.length > 0 && !riding ? (
        <div className="dialog-backdrop">
          <div className="dialog stack">
            <h1>Interrupted ride found</h1>
            <p className="muted">
              {recoverable.length === 1
                ? `"${recoverable[0].name}" was still in progress when the app last closed.`
                : `${recoverable.length} rides were still in progress when the app last closed.`}{' '}
              The autosaved data has been preserved and will be kept as a recovered ride.
            </p>
            <div className="row">
              <button className="primary" onClick={() => void finalizeRecovered()}>
                Keep recovered data
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
