import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLibraryStore } from '../../state/libraryStore';
import { useSettingsStore } from '../../state/settingsStore';
import { useRideStore } from '../../state/rideStore';
import { PowerProfileChart } from '../../components/PowerProfileChart';
import { ReadinessChecklist, useReadiness } from '../../components/ReadinessChecklist';
import { formatDuration, recipeNeedsFtp, resolvePlan } from '../../engine/planResolve';
import type { RideMode } from '../../data/schema';
import { DevicesDrawer } from './DevicesDrawer';
import { exportRecipe, downloadFile } from '../../data/exportImport';
import { deleteRecipe } from '../../data/repositories/recipes';

export function WorkoutSetupScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { recipes, refresh, loaded } = useLibraryStore();
  const ftp = useSettingsStore((s) => s.settings.currentFtpW);
  const prepare = useRideStore((s) => s.prepare);
  const [mode, setMode] = useState<RideMode | null>(null);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);

  const recipe = recipes.find((r) => r.id === id);
  const effectiveMode: RideMode = mode ?? recipe?.defaultMode ?? 'erg';
  const needsFtp = recipe ? recipeNeedsFtp(recipe) : false;
  const readiness = useReadiness(effectiveMode, needsFtp);

  const plan = useMemo(() => {
    if (!recipe) return null;
    try {
      return resolvePlan(recipe, ftp);
    } catch {
      return null; // FTP missing
    }
  }, [recipe, ftp]);

  if (!loaded) return <main className="screen">Loading…</main>;
  if (!recipe)
    return (
      <main className="screen stack">
        <p>Workout not found.</p>
        <Link to="/workouts">Back to workouts</Link>
      </main>
    );

  const start = () => {
    if (!plan) return;
    // Snapshot FTP + fully resolved plan into the session now; later FTP or
    // recipe edits must not alter what this ride was meant to do.
    prepare({ kind: 'workout', recipe, plan, mode: effectiveMode, ftpUsed: ftp, name: recipe.name });
    navigate('/ride');
  };

  return (
    <main className="screen stack">
      <div className="row between">
        <h1>{recipe.name}</h1>
        <div className="row">
          <button className="small" onClick={() => downloadFile(`workout-${recipe.name}.json`, JSON.stringify(exportRecipe(recipe), null, 2))}>
            Export recipe
          </button>
          {recipe.source !== 'builtin' ? (
            <>
              <button className="small" onClick={() => navigate(`/builder/${recipe.id}`)}>
                Edit
              </button>
              <button className="small danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            </>
          ) : null}
          <Link to="/workouts">Back</Link>
        </div>
      </div>

      {plan ? (
        <PowerProfileChart plan={plan} ftpW={ftp} height={90} />
      ) : (
        <div className="banner">
          This workout scales from FTP, which is not set yet. <Link to="/training">Set your training level</Link>{' '}
          to see resolved watts and start it.
        </div>
      )}

      <div className="row">
        <div className="card" style={{ flex: 2, minWidth: 320 }}>
          <h2 style={{ marginTop: 0 }}>Segments {ftp ? <span className="muted small">at FTP {ftp} W</span> : null}</h2>
          <table className="data">
            <thead>
              <tr>
                <th>Segment</th>
                <th className="num">Duration</th>
                <th className="num">Target</th>
                <th className="num">Power</th>
                <th className="num">Cadence</th>
              </tr>
            </thead>
            <tbody>
              {(plan ?? resolvePlan(recipe, 100)).steps.map((s, i) => (
                <tr key={i}>
                  <td>{s.label ?? s.kind}</td>
                  <td className="num">{formatDuration(s.endS - s.startS)}</td>
                  <td className="num">
                    {ftp
                      ? `${Math.round((s.targetW / ftp) * 100)}%${s.targetEndW !== undefined ? `→${Math.round(((s.targetEndW ?? 0) / ftp) * 100)}%` : ''}`
                      : `${s.targetW}%${s.targetEndW !== undefined ? `→${s.targetEndW}%` : ''}`}
                  </td>
                  <td className="num">
                    {plan ? `${s.targetW}${s.targetEndW !== undefined ? `→${s.targetEndW}` : ''} W` : '—'}
                  </td>
                  <td className="num">{s.cadence ? `${s.cadence.minRpm}–${s.cadence.maxRpm}` : 'free'}</td>
                </tr>
              ))}
              <tr>
                <td><strong>Total</strong></td>
                <td className="num">
                  <strong>{formatDuration((plan ?? resolvePlan(recipe, 100)).totalS)}</strong>
                </td>
                <td colSpan={3} />
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card stack" style={{ flex: 1, minWidth: 260 }}>
          <h2 style={{ marginTop: 0 }}>Ride mode</h2>
          <div className="row">
            <button className={effectiveMode === 'erg' ? 'primary' : ''} onClick={() => setMode('erg')}>
              ERG
            </button>
            <button className={effectiveMode === 'shift' ? 'primary' : ''} onClick={() => setMode('shift')}>
              Shift
            </button>
          </div>
          <p className="muted small">
            {effectiveMode === 'erg'
              ? 'The trainer adjusts resistance to hold each target.'
              : 'You use virtual gears and cadence to meet the planned target.'}
          </p>
          <h2>Readiness</h2>
          <ReadinessChecklist readiness={readiness} />
          <button className="small" onClick={() => setDevicesOpen(true)}>
            Devices drawer
          </button>
          <button className="primary" disabled={!readiness.ready || !plan} onClick={start}>
            Start workout
          </button>
        </div>
      </div>
      {devicesOpen ? <DevicesDrawer onClose={() => setDevicesOpen(false)} /> : null}
      {confirmDelete ? (
        <div className="dialog-backdrop" onClick={() => setConfirmDelete(false)}>
          <div className="dialog stack" onClick={(e) => e.stopPropagation()}>
            <h1>Delete “{recipe.name}”?</h1>
            <p className="muted">
              The workout definition is removed from this device. Recordings of past rides keep their own
              snapshot of the plan and are not affected. Consider exporting the recipe first if you might
              want it back.
            </p>
            <div className="row">
              <button
                className="danger"
                onClick={async () => {
                  await deleteRecipe(recipe.id);
                  await refresh();
                  navigate('/workouts');
                }}
              >
                Delete workout
              </button>
              <button onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
