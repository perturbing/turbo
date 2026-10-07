import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLibraryStore } from '../../state/libraryStore';
import {
  commitImport,
  downloadFile,
  exportAll,
  exportRecipe,
  exportRecording,
  ImportFormatError,
  previewImport,
  type ImportPreview,
} from '../../data/exportImport';
import { deleteRecording } from '../../data/repositories/recordings';
import { deleteRecipe } from '../../data/repositories/recipes';
import { useSettingsStore } from '../../state/settingsStore';
import { formatDuration } from '../../engine/planResolve';
import { ImportDialog } from './ImportDialog';
import { Pill } from '../../components/StatusPill';

export function YourDataScreen() {
  const { recipes, recordings, ftpHistory, refresh } = useLibraryStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmDeleteRecipe, setConfirmDeleteRecipe] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const doExportAll = async () => {
    const envelope = await exportAll();
    downloadFile(`bike-data-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(envelope, null, 2));
  };

  const onImportFile = async (file: File) => {
    setError(null);
    try {
      setPreview(await previewImport(await file.text()));
    } catch (e) {
      console.error('bike-app: import failed', e);
      setError(
        e instanceof ImportFormatError
          ? e.message
          : e instanceof Error
            ? `Import failed: ${e.message}`
            : 'Could not read this file.',
      );
    }
  };

  return (
    <main className="screen stack">
      <div className="row between">
        <h1>Your data</h1>
        <div className="row">
          <button onClick={() => fileRef.current?.click()}>Import data</button>
          <button className="primary" onClick={() => void doExportAll()}>
            Export all
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <p className="muted small">
        Everything lives in this browser — there is no server. Export regularly, and use Export all + Import
        to move to a new device. Browser storage can be cleared by the system.
      </p>
      {error ? <div className="banner danger">{error}</div> : null}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Ride recordings ({recordings.length})</h2>
        {recordings.length === 0 ? (
          <p className="muted small">No recordings yet — finish a workout and it appears here.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Name</th>
                <th>Kind</th>
                <th className="num">Duration</th>
                <th className="num">Avg W</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recordings.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.startedAt).toLocaleString()}</td>
                  <td>
                    <Link to={`/data/${r.id}`}>{r.name}</Link>
                  </td>
                  <td>{r.kind === 'rampTest' ? 'ramp test' : 'workout'}</td>
                  <td className="num">{formatDuration(r.summary?.durationS ?? 0)}</td>
                  <td className="num">{r.summary?.avgPowerW ?? '—'}</td>
                  <td>
                    <Pill kind={r.state === 'completed' ? 'ok' : r.state === 'in-progress' ? 'danger' : 'warn'}>{r.state}</Pill>
                  </td>
                  <td className="num">
                    <button
                      className="small"
                      onClick={async () => {
                        const env = await exportRecording(r.id);
                        if (env) downloadFile(`ride-${r.startedAt.slice(0, 19)}.json`, JSON.stringify(env, null, 2));
                      }}
                    >
                      Export
                    </button>{' '}
                    <button className="small danger" onClick={() => setConfirmDelete(r.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Saved workouts ({recipes.length})</h2>
        <table className="data">
          <tbody>
            {recipes.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/workouts/${r.id}/setup`}>{r.name}</Link>
                </td>
                <td>{r.source}</td>
                <td className="num">rev {r.revision}</td>
                <td className="num">
                  <button
                    className="small"
                    onClick={() => downloadFile(`workout-${r.name}.json`, JSON.stringify(exportRecipe(r), null, 2))}
                  >
                    Export recipe
                  </button>{' '}
                  {r.source !== 'builtin' ? (
                    <button className="small danger" onClick={() => setConfirmDeleteRecipe({ id: r.id, name: r.name })}>
                      Delete
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>FTP history ({ftpHistory.length})</h2>
        {ftpHistory.length === 0 ? (
          <p className="muted small">
            No FTP observations yet — <Link to="/training">run a ramp test</Link>.
          </p>
        ) : (
          <table className="data">
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

      <PreferencesCard />

      {preview ? (
        <ImportDialog
          preview={preview}
          onClose={() => setPreview(null)}
          onCommit={async () => {
            await commitImport(preview);
            setPreview(null);
            await refresh();
            await useSettingsStore.getState().load(); // import may restore FTP
          }}
        />
      ) : null}

      {confirmDeleteRecipe ? (
        <div className="dialog-backdrop" onClick={() => setConfirmDeleteRecipe(null)}>
          <div className="dialog stack" onClick={(e) => e.stopPropagation()}>
            <h1>Delete “{confirmDeleteRecipe.name}”?</h1>
            <p className="muted">
              The workout definition is removed from this device. Recordings of past rides keep their own
              snapshot of the plan and are not affected.
            </p>
            <div className="row">
              <button
                className="danger"
                onClick={async () => {
                  await deleteRecipe(confirmDeleteRecipe.id);
                  setConfirmDeleteRecipe(null);
                  await refresh();
                }}
              >
                Delete workout
              </button>
              <button onClick={() => setConfirmDeleteRecipe(null)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="dialog-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="dialog stack" onClick={(e) => e.stopPropagation()}>
            <h1>Delete this recording?</h1>
            <p className="muted">This permanently removes the recording and its samples from this device.</p>
            <div className="row">
              <button
                className="danger"
                onClick={async () => {
                  await deleteRecording(confirmDelete);
                  setConfirmDelete(null);
                  await refresh();
                }}
              >
                Delete
              </button>
              <button onClick={() => setConfirmDelete(null)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function PreferencesCard() {
  const { settings, update } = useSettingsStore();
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Preferences</h2>
      <label className="row" style={{ cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={settings.reducedMotion}
          onChange={(e) => void update({ reducedMotion: e.target.checked })}
        />
        Reduced motion (the live road stops animating; your OS preference is also respected)
      </label>
    </div>
  );
}
