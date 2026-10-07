import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLibraryStore } from '../../state/libraryStore';
import { useSettingsStore } from '../../state/settingsStore';
import { useDeviceStore } from '../../state/deviceStore';
import { PowerProfileChart } from '../../components/PowerProfileChart';
import { formatDuration, recipeNeedsFtp, recipeTotalSeconds, resolvePlan } from '../../engine/planResolve';
import { Pill } from '../../components/StatusPill';
import type { WorkoutRecipe } from '../../data/schema';
import { previewImport, type ImportPreview, commitImport, ImportFormatError } from '../../data/exportImport';
import { ImportDialog } from '../data/ImportDialog';

const CATEGORIES = ['all', 'endurance', 'intervals', 'tempo', 'recovery', 'custom'] as const;

export function CatalogueScreen() {
  const { recipes, loaded, refresh } = useLibraryStore();
  const ftp = useSettingsStore((s) => s.settings.currentFtpW);
  const trainerConnection = useDeviceStore((s) => s.trainerConnection);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('all');
  const [sort, setSort] = useState<'name' | 'durationAsc' | 'durationDesc'>('name');
  const [maxMinutes, setMaxMinutes] = useState('');
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const maxS = Number(maxMinutes) > 0 ? Number(maxMinutes) * 60 : Infinity;
  const visible = recipes
    .filter((r) => (category === 'all' || r.category === category) && recipeTotalSeconds(r) <= maxS)
    .sort((a, b) => {
      if (sort === 'durationAsc') return recipeTotalSeconds(a) - recipeTotalSeconds(b);
      if (sort === 'durationDesc') return recipeTotalSeconds(b) - recipeTotalSeconds(a);
      return a.name.localeCompare(b.name);
    });

  const onImportFile = async (file: File) => {
    setImportError(null);
    try {
      setImportPreview(await previewImport(await file.text()));
    } catch (e) {
      console.error('bike-app: import failed', e);
      setImportError(
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
        <h1>Workouts</h1>
        <div className="row">
          <span className="muted small">
            FTP: {ftp ? `${ftp} W` : 'not set'} · <Link to="/training">Training level</Link>
          </span>
          <Pill kind={trainerConnection === 'connected' ? 'ok' : undefined}>
            {trainerConnection === 'connected' ? 'Trainer ready' : 'Trainer not connected'}
          </Pill>
        </div>
      </div>

      <div className="row between">
        <div className="row">
          {CATEGORIES.map((c) => (
            <button key={c} className={`small${category === c ? ' primary' : ''}`} onClick={() => setCategory(c)}>
              {c === 'all' ? 'All' : c[0].toUpperCase() + c.slice(1)}
            </button>
          ))}
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort workouts">
            <option value="name">Sort: name</option>
            <option value="durationAsc">Sort: shortest first</option>
            <option value="durationDesc">Sort: longest first</option>
          </select>
          <label className="row small muted" style={{ gap: '0.3rem' }}>
            fits in
            <input
              type="number"
              min={10}
              step={5}
              placeholder="any"
              style={{ width: 70 }}
              value={maxMinutes}
              onChange={(e) => setMaxMinutes(e.target.value)}
              aria-label="Maximum duration in minutes"
            />
            min
          </label>
        </div>
        <div className="row">
          <button onClick={() => fileRef.current?.click()}>Import workout</button>
          <button className="primary" onClick={() => navigate('/builder')}>
            Create workout
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
      {importError ? <div className="banner danger">{importError}</div> : null}

      {loaded && visible.length === 0 ? (
        recipes.length > 0 ? (
          <div className="card stack" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <p className="muted">
              No workouts match these filters
              {Number(maxMinutes) > 0 ? ` (fits in ${maxMinutes} min)` : ''}.
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button
                onClick={() => {
                  setCategory('all');
                  setMaxMinutes('');
                }}
              >
                Clear filters
              </button>
            </div>
          </div>
        ) : (
          <div className="card stack" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <p className="muted">No workouts here yet.</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="primary" onClick={() => navigate('/builder')}>
                Create workout
              </button>
              <button onClick={() => fileRef.current?.click()}>Import workout</button>
            </div>
          </div>
        )
      ) : (
        <div className="card-grid">
          {visible.map((r) => (
            <WorkoutCard key={r.id} recipe={r} ftp={ftp} onOpen={() => navigate(`/workouts/${r.id}/setup`)} />
          ))}
        </div>
      )}

      {importPreview ? (
        <ImportDialog
          preview={importPreview}
          onClose={() => setImportPreview(null)}
          onCommit={async () => {
            await commitImport(importPreview);
            setImportPreview(null);
            await refresh();
            await useSettingsStore.getState().load(); // import may restore FTP
          }}
        />
      ) : null}
    </main>
  );
}

function WorkoutCard({ recipe, ftp, onOpen }: { recipe: WorkoutRecipe; ftp: number | null; onOpen: () => void }) {
  // Preview chart: resolve against the rider FTP when set; otherwise against
  // 100 so %FTP renders proportionally (watts shown only when FTP is known).
  const plan = resolvePlan(recipe, ftp ?? 100);
  const needsFtp = recipeNeedsFtp(recipe);
  return (
    <div className="card workout-card" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="row between">
        <strong>{recipe.name}</strong>
        <span className="pill">{recipe.category}</span>
      </div>
      <PowerProfileChart plan={plan} ftpW={ftp ?? 100} height={56} />
      <div className="meta">
        <span>{formatDuration(recipeTotalSeconds(recipe))}</span>
        <span>{recipe.defaultMode.toUpperCase()}</span>
        {needsFtp && !ftp ? <span style={{ color: 'var(--warn)' }}>needs FTP</span> : null}
      </div>
    </div>
  );
}
