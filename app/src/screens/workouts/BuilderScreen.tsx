import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { RideMode, SimpleBlock, WorkoutBlock, WorkoutRecipe } from '../../data/schema';
import { useLibraryStore } from '../../state/libraryStore';
import { useSettingsStore } from '../../state/settingsStore';
import { saveRecipe } from '../../data/repositories/recipes';
import { resolvePlan, formatDuration, recipeTotalSeconds } from '../../engine/planResolve';
import { PowerProfileChart } from '../../components/PowerProfileChart';
import { exportRecipe, downloadFile } from '../../data/exportImport';

type Selection = { index: number; inner?: number } | null;

const PALETTE: { label: string; make: () => WorkoutBlock }[] = [
  { label: 'Steady', make: () => ({ kind: 'steady', label: 'Steady', durationS: 300, target: { basis: 'ftpPct', pct: 70 } }) },
  { label: 'Ramp', make: () => ({ kind: 'ramp', label: 'Ramp', durationS: 300, startTarget: { basis: 'ftpPct', pct: 50 }, endTarget: { basis: 'ftpPct', pct: 75 } }) },
  { label: 'Recovery', make: () => ({ kind: 'recovery', label: 'Recovery', durationS: 180, target: { basis: 'ftpPct', pct: 50 } }) },
  {
    label: 'Repeat group',
    make: () => ({
      kind: 'repeat',
      label: 'Intervals',
      count: 4,
      blocks: [
        { kind: 'steady', label: 'Effort', durationS: 120, target: { basis: 'ftpPct', pct: 110 } },
        { kind: 'recovery', label: 'Recovery', durationS: 120, target: { basis: 'ftpPct', pct: 50 } },
      ],
    }),
  },
];

export function BuilderScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { recipes, refresh, loaded } = useLibraryStore();
  const riderFtp = useSettingsStore((s) => s.settings.currentFtpW);

  const existing = id ? recipes.find((r) => r.id === id) : undefined;
  const [name, setName] = useState('New workout');
  const [mode, setMode] = useState<RideMode>('erg');
  const [blocks, setBlocks] = useState<WorkoutBlock[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  // Preview FTP rescales the preview only; it never updates the rider's FTP.
  const [previewFtp, setPreviewFtp] = useState(riderFtp ?? 200);
  const undoStack = useRef<WorkoutBlock[][]>([]);
  const loadedExisting = useRef(false);

  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);

  useEffect(() => {
    if (existing && !loadedExisting.current) {
      loadedExisting.current = true;
      setName(existing.name);
      setMode(existing.defaultMode);
      setBlocks(structuredClone(existing.blocks));
    }
  }, [existing]);

  const mutate = (fn: (next: WorkoutBlock[]) => void) => {
    undoStack.current.push(structuredClone(blocks));
    if (undoStack.current.length > 50) undoStack.current.shift();
    const next = structuredClone(blocks);
    fn(next);
    setBlocks(next);
  };

  const undo = () => {
    const prev = undoStack.current.pop();
    if (prev) setBlocks(prev);
  };

  const selected: WorkoutBlock | SimpleBlock | null = useMemo(() => {
    if (!selection) return null;
    const top = blocks[selection.index];
    if (!top) return null;
    if (selection.inner !== undefined && top.kind === 'repeat') return top.blocks[selection.inner] ?? null;
    return top;
  }, [blocks, selection]);

  const errors = validate(blocks);
  const previewRecipe: WorkoutRecipe | null = blocks.length
    ? {
        schemaVersion: 1,
        id: 'preview',
        revision: 1,
        name,
        category: 'custom',
        defaultMode: mode,
        blocks,
        createdAt: '',
        updatedAt: '',
        source: 'user',
      }
    : null;
  const previewPlan = useMemo(() => {
    if (!previewRecipe || errors.length) return null;
    try {
      return resolvePlan(previewRecipe, previewFtp);
    } catch {
      return null;
    }
  }, [previewRecipe, previewFtp, errors.length]);

  const save = async () => {
    const now = new Date().toISOString();
    const recipe: WorkoutRecipe = existing
      ? { ...existing, name, defaultMode: mode, blocks, revision: existing.revision + 1, updatedAt: now }
      : {
          schemaVersion: 1,
          id: crypto.randomUUID(),
          revision: 1,
          name,
          category: 'custom',
          defaultMode: mode,
          blocks,
          createdAt: now,
          updatedAt: now,
          source: 'user',
        };
    await saveRecipe(recipe);
    await refresh();
    navigate(`/workouts/${recipe.id}/setup`);
  };

  const moveTop = (index: number, dir: -1 | 1) =>
    mutate((next) => {
      const j = index + dir;
      if (j < 0 || j >= next.length) return;
      [next[index], next[j]] = [next[j], next[index]];
      setSelection({ index: j });
    });

  return (
    <main className="screen stack">
      <div className="row between">
        <h1>Workout builder</h1>
        <div className="row">
          <button className="small" onClick={undo} disabled={undoStack.current.length === 0}>
            Undo
          </button>
          {previewRecipe ? (
            <button
              className="small"
              onClick={() => downloadFile(`workout-${name}.json`, JSON.stringify(exportRecipe({ ...previewRecipe, id: existing?.id ?? crypto.randomUUID() }), null, 2))}
            >
              Export recipe
            </button>
          ) : null}
          <button className="primary" onClick={() => void save()} disabled={errors.length > 0 || blocks.length === 0}>
            Save workout
          </button>
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>Workout name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Default ride mode</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as RideMode)}>
            <option value="erg">ERG</option>
            <option value="shift">Shift</option>
          </select>
        </div>
        <div className="field">
          <label>Preview FTP (W) — preview only</label>
          <input
            type="number"
            min={50}
            max={600}
            value={previewFtp}
            onChange={(e) => setPreviewFtp(Number(e.target.value) || 200)}
          />
        </div>
      </div>

      {previewPlan ? (
        <>
          <PowerProfileChart plan={previewPlan} ftpW={previewFtp} height={70} />
          <p className="muted small">
            Total {formatDuration(previewPlan.totalS)} · {previewPlan.steps.length} steps expanded
          </p>
        </>
      ) : blocks.length ? (
        <p className="muted small">Total {formatDuration(recipeTotalSeconds({ blocks } as WorkoutRecipe))}</p>
      ) : null}

      {errors.length > 0 ? (
        <div className="banner">
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      ) : null}

      <div className="builder-grid">
        <div className="card stack">
          <h2 style={{ marginTop: 0 }}>Blocks</h2>
          {PALETTE.map((p) => (
            <button
              key={p.label}
              onClick={() =>
                mutate((next) => {
                  next.push(p.make());
                  setSelection({ index: next.length - 1 });
                })
              }
            >
              + {p.label}
            </button>
          ))}
        </div>

        <div className="card stack">
          <h2 style={{ marginTop: 0 }}>Sequence</h2>
          {blocks.length === 0 ? <p className="muted">Add blocks from the palette.</p> : null}
          {blocks.map((b, i) => (
            <div key={i} className="stack" style={{ gap: '0.3rem' }}>
              <BlockRow
                block={b}
                selected={selection?.index === i && selection.inner === undefined}
                onSelect={() => setSelection({ index: i })}
                onMoveUp={() => moveTop(i, -1)}
                onMoveDown={() => moveTop(i, 1)}
                onDuplicate={() =>
                  mutate((next) => {
                    next.splice(i + 1, 0, structuredClone(next[i]));
                  })
                }
                onRemove={() =>
                  mutate((next) => {
                    next.splice(i, 1);
                    setSelection(null);
                  })
                }
              />
              {b.kind === 'repeat'
                ? b.blocks.map((inner, j) => (
                    <div key={j} style={{ marginLeft: '1.5rem' }}>
                      <BlockRow
                        block={inner}
                        selected={selection?.index === i && selection.inner === j}
                        onSelect={() => setSelection({ index: i, inner: j })}
                        onMoveUp={() =>
                          mutate((next) => {
                            const grp = next[i];
                            if (grp.kind !== 'repeat' || j === 0) return;
                            [grp.blocks[j - 1], grp.blocks[j]] = [grp.blocks[j], grp.blocks[j - 1]];
                            setSelection({ index: i, inner: j - 1 });
                          })
                        }
                        onMoveDown={() =>
                          mutate((next) => {
                            const grp = next[i];
                            if (grp.kind !== 'repeat' || j >= grp.blocks.length - 1) return;
                            [grp.blocks[j + 1], grp.blocks[j]] = [grp.blocks[j], grp.blocks[j + 1]];
                            setSelection({ index: i, inner: j + 1 });
                          })
                        }
                        onDuplicate={() =>
                          mutate((next) => {
                            const grp = next[i];
                            if (grp.kind === 'repeat') grp.blocks.splice(j + 1, 0, structuredClone(grp.blocks[j]));
                          })
                        }
                        onRemove={() =>
                          mutate((next) => {
                            const grp = next[i];
                            if (grp.kind === 'repeat') grp.blocks.splice(j, 1);
                            setSelection(null);
                          })
                        }
                      />
                    </div>
                  ))
                : null}
            </div>
          ))}
        </div>

        <div className="card stack">
          <h2 style={{ marginTop: 0 }}>Inspector</h2>
          {!selected || !selection ? (
            <p className="muted">Select a block to edit it.</p>
          ) : (
            <BlockInspector
              block={selected}
              onChange={(updated) =>
                mutate((next) => {
                  const top = next[selection.index];
                  if (selection.inner !== undefined && top.kind === 'repeat') {
                    top.blocks[selection.inner] = updated as SimpleBlock;
                  } else {
                    next[selection.index] = updated;
                  }
                })
              }
            />
          )}
        </div>
      </div>
    </main>
  );
}

function describeBlock(b: WorkoutBlock | SimpleBlock): string {
  if (b.kind === 'repeat') return `${b.count} × [${b.blocks.length} blocks]`;
  const dur = formatDuration(b.durationS);
  if (b.kind === 'ramp') {
    const f = (t: SimpleBlock extends never ? never : { basis: string; pct?: number; watts?: number }) =>
      t.basis === 'ftpPct' ? `${t.pct}%` : `${t.watts}W`;
    return `${dur} · ${f(b.startTarget as never)}→${f(b.endTarget as never)}`;
  }
  const t = b.target;
  return `${dur} · ${t.basis === 'ftpPct' ? `${t.pct}% FTP` : `${t.watts} W`}`;
}

function BlockRow(props: {
  block: WorkoutBlock | SimpleBlock;
  selected: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const { block } = props;
  return (
    <div className={`block-item${props.selected ? ' selected' : ''}`} onClick={props.onSelect}>
      <span className="grow">
        <strong>{block.label ?? block.kind}</strong> <span className="muted small">{describeBlock(block)}</span>
      </span>
      <button className="small" aria-label="Move earlier" onClick={(e) => (e.stopPropagation(), props.onMoveUp())}>
        ↑
      </button>
      <button className="small" aria-label="Move later" onClick={(e) => (e.stopPropagation(), props.onMoveDown())}>
        ↓
      </button>
      <button className="small" aria-label="Duplicate" onClick={(e) => (e.stopPropagation(), props.onDuplicate())}>
        ⧉
      </button>
      <button className="small" aria-label="Remove" onClick={(e) => (e.stopPropagation(), props.onRemove())}>
        ✕
      </button>
    </div>
  );
}

function BlockInspector({
  block,
  onChange,
}: {
  block: WorkoutBlock | SimpleBlock;
  onChange: (b: WorkoutBlock) => void;
}) {
  if (block.kind === 'repeat') {
    return (
      <div className="stack">
        <div className="field">
          <label>Label</label>
          <input value={block.label ?? ''} onChange={(e) => onChange({ ...block, label: e.target.value })} />
        </div>
        <div className="field">
          <label>Repeat count</label>
          <input
            type="number"
            min={1}
            value={block.count}
            onChange={(e) => onChange({ ...block, count: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
          />
        </div>
        <p className="muted small">Select blocks inside the group to edit them.</p>
      </div>
    );
  }

  const minutes = Math.floor(block.durationS / 60);
  const seconds = block.durationS % 60;
  const setDuration = (m: number, s: number) => onChange({ ...block, durationS: Math.max(1, m * 60 + s) });

  const targetEditor = (
    label: string,
    target: { basis: 'ftpPct'; pct: number } | { basis: 'watts'; watts: number },
    apply: (t: { basis: 'ftpPct'; pct: number } | { basis: 'watts'; watts: number }) => void,
  ) => (
    <div className="field">
      <label>{label}</label>
      <div className="row">
        <select
          value={target.basis}
          onChange={(e) =>
            apply(
              e.target.value === 'ftpPct'
                ? { basis: 'ftpPct', pct: target.basis === 'watts' ? 70 : target.pct }
                : { basis: 'watts', watts: target.basis === 'ftpPct' ? 150 : target.watts },
            )
          }
        >
          <option value="ftpPct">% FTP</option>
          <option value="watts">Watts</option>
        </select>
        <input
          type="number"
          min={1}
          style={{ width: 90 }}
          value={target.basis === 'ftpPct' ? target.pct : target.watts}
          onChange={(e) => {
            const v = Math.max(1, Number(e.target.value) || 1);
            apply(target.basis === 'ftpPct' ? { basis: 'ftpPct', pct: v } : { basis: 'watts', watts: v });
          }}
        />
      </div>
    </div>
  );

  return (
    <div className="stack">
      <div className="field">
        <label>Label</label>
        <input value={block.label ?? ''} onChange={(e) => onChange({ ...block, label: e.target.value })} />
      </div>
      <div className="field">
        <label>Duration</label>
        <div className="row">
          <input type="number" min={0} style={{ width: 70 }} value={minutes} onChange={(e) => setDuration(Number(e.target.value) || 0, seconds)} />
          <span className="muted small">min</span>
          <input type="number" min={0} max={59} style={{ width: 70 }} value={seconds} onChange={(e) => setDuration(minutes, Number(e.target.value) || 0)} />
          <span className="muted small">sec</span>
        </div>
      </div>
      {block.kind === 'ramp' ? (
        <>
          {targetEditor('Ramp start', block.startTarget, (t) => onChange({ ...block, startTarget: t }))}
          {targetEditor('Ramp end', block.endTarget, (t) => onChange({ ...block, endTarget: t }))}
          <p className="muted small">Start and end must use the same unit.</p>
        </>
      ) : (
        targetEditor('Power target', block.target, (t) => onChange({ ...block, target: t }))
      )}
      <div className="field">
        <label>Cadence range (rpm, optional)</label>
        <div className="row">
          <input
            type="number"
            placeholder="min"
            style={{ width: 80 }}
            value={block.cadence?.minRpm ?? ''}
            onChange={(e) => {
              const v = Number(e.target.value);
              onChange({ ...block, cadence: v ? { minRpm: v, maxRpm: block.cadence?.maxRpm ?? v + 10 } : undefined });
            }}
          />
          <input
            type="number"
            placeholder="max"
            style={{ width: 80 }}
            value={block.cadence?.maxRpm ?? ''}
            onChange={(e) => {
              const v = Number(e.target.value);
              onChange({ ...block, cadence: v && block.cadence ? { ...block.cadence, maxRpm: v } : block.cadence });
            }}
          />
        </div>
      </div>
    </div>
  );
}

function validate(blocks: WorkoutBlock[]): string[] {
  const errors: string[] = [];
  if (blocks.length === 0) return errors;
  const checkSimple = (b: SimpleBlock, where: string) => {
    if (b.durationS <= 0) errors.push(`${where}: duration must be greater than zero.`);
    if (b.cadence && b.cadence.minRpm >= b.cadence.maxRpm)
      errors.push(`${where}: cadence range is inverted.`);
    if (b.kind === 'ramp' && b.startTarget.basis !== b.endTarget.basis)
      errors.push(`${where}: ramp start and end must use the same unit.`);
  };
  blocks.forEach((b, i) => {
    const where = b.label || `Block ${i + 1}`;
    if (b.kind === 'repeat') {
      if (b.count < 1 || !Number.isInteger(b.count)) errors.push(`${where}: repeat count must be a positive whole number.`);
      if (b.blocks.length === 0) errors.push(`${where}: repeat group is empty.`);
      b.blocks.forEach((inner, j) => checkSimple(inner, inner.label || `${where} · block ${j + 1}`));
    } else {
      checkSimple(b, where);
    }
  });
  return errors;
}
