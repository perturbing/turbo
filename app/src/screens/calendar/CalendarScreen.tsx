import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLibraryStore } from '../../state/libraryStore';
import { savePlan, deletePlan } from '../../data/repositories/plans';
import { RAMP_TEST_RECIPE_ID, type PlannedWorkout, type RideRecording } from '../../data/schema';
import { formatDuration, recipeTotalSeconds } from '../../engine/planResolve';

// Local calendar date (YYYY-MM-DD) for a Date or ISO timestamp — plans and
// completion matching both live in the rider's local time.
export function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type PlanStatus = 'planned' | 'done' | 'partial' | 'missed';

// A plan is done when a matching recording exists on the same local date —
// derived, never stored, so it can't disagree with what happened. A ramp-test
// plan (reserved id) matches any ramp-test recording that day.
export function planMatchesRecording(plan: PlannedWorkout, r: RideRecording): boolean {
  if (plan.recipeId === RAMP_TEST_RECIPE_ID) return r.kind === 'rampTest';
  return r.recipeId === plan.recipeId;
}

export function planStatus(plan: PlannedWorkout, recordings: RideRecording[], today: string): PlanStatus {
  const onDay = recordings.filter(
    (r) => planMatchesRecording(plan, r) && localDateString(new Date(r.startedAt)) === plan.date,
  );
  if (onDay.some((r) => r.state === 'completed')) return 'done';
  if (onDay.length > 0) return 'partial';
  return plan.date < today ? 'missed' : 'planned';
}

interface DayCell {
  date: string;
  dayOfMonth: number;
  inMonth: boolean;
}

function monthGrid(year: number, month: number): DayCell[] {
  // Weeks start on Monday.
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - lead + i);
    cells.push({ date: localDateString(d), dayOfMonth: d.getDate(), inMonth: d.getMonth() === month });
  }
  // Drop a trailing all-out-of-month week.
  return cells.slice(35).every((c) => !c.inMonth) ? cells.slice(0, 35) : cells;
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDateString(d);
}

export function CalendarScreen() {
  const navigate = useNavigate();
  const { recipes, recordings, plans, refresh } = useLibraryStore();
  const now = new Date();
  const [view, setView] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [dayDialog, setDayDialog] = useState<string | null>(null);
  const [dragPlanId, setDragPlanId] = useState<string | null>(null);
  const [dropDate, setDropDate] = useState<string | null>(null);

  const movePlan = async (planId: string, toDate: string) => {
    const plan = plans.find((p) => p.id === planId);
    if (!plan || plan.date === toDate) return;
    await savePlan({ ...plan, date: toDate });
    await refresh();
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const today = localDateString(new Date());
  const cells = useMemo(() => monthGrid(view.year, view.month), [view]);
  const monthName = new Date(view.year, view.month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const plansByDate = useMemo(() => {
    const map = new Map<string, PlannedWorkout[]>();
    for (const p of plans) {
      map.set(p.date, [...(map.get(p.date) ?? []), p]);
    }
    return map;
  }, [plans]);

  const recordingsByDate = useMemo(() => {
    const map = new Map<string, RideRecording[]>();
    for (const r of recordings) {
      const d = localDateString(new Date(r.startedAt));
      map.set(d, [...(map.get(d) ?? []), r]);
    }
    return map;
  }, [recordings]);

  const move = (delta: number) => {
    const d = new Date(view.year, view.month + delta, 1);
    setView({ year: d.getFullYear(), month: d.getMonth() });
  };

  return (
    <main className="screen stack">
      <div className="row between">
        <h1>Calendar</h1>
        <div className="row">
          <button className="small" onClick={() => move(-1)} aria-label="Previous month">
            ←
          </button>
          <strong style={{ minWidth: 150, textAlign: 'center' }}>{monthName}</strong>
          <button className="small" onClick={() => move(1)} aria-label="Next month">
            →
          </button>
          <button
            className="small"
            onClick={() => setView({ year: now.getFullYear(), month: now.getMonth() })}
          >
            Today
          </button>
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Click a day to plan a workout. Completion is derived from your recordings: a planned workout turns
        green when you ride it that day.
      </p>

      <div className="cal-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="cal-head">
            {d}
          </div>
        ))}
        {cells.map((cell) => {
          const dayPlans = plansByDate.get(cell.date) ?? [];
          const unplannedRides = (recordingsByDate.get(cell.date) ?? []).filter(
            (r) => !dayPlans.some((p) => planMatchesRecording(p, r)),
          );
          return (
            <div
              key={cell.date}
              className={`cal-cell${cell.inMonth ? '' : ' out'}${cell.date === today ? ' today' : ''}${
                dragPlanId && dropDate === cell.date ? ' drop' : ''
              }`}
              onClick={() => setDayDialog(cell.date)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setDayDialog(cell.date)}
              onDragOver={(e) => {
                if (!dragPlanId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dropDate !== cell.date) setDropDate(cell.date);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain') || dragPlanId;
                setDragPlanId(null);
                setDropDate(null);
                if (id) void movePlan(id, cell.date);
              }}
            >
              <div className="cal-day">{cell.dayOfMonth}</div>
              {dayPlans.map((p) => {
                const status = planStatus(p, recordings, today);
                const isRamp = p.recipeId === RAMP_TEST_RECIPE_ID;
                const recipe = recipes.find((r) => r.id === p.recipeId);
                const name = isRamp ? 'Ramp test (FTP)' : (recipe?.name ?? 'Deleted workout');
                return (
                  <span
                    key={p.id}
                    className={`cal-chip ${status}`}
                    title={p.note ? `${p.note} — drag to another day` : 'Drag to another day'}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', p.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragPlanId(p.id);
                    }}
                    onDragEnd={() => {
                      setDragPlanId(null);
                      setDropDate(null);
                    }}
                  >
                    {status === 'done' ? '✓ ' : status === 'partial' ? '◐ ' : status === 'missed' ? '✕ ' : ''}
                    {name}
                  </span>
                );
              })}
              {unplannedRides.map((r) => (
                <span key={r.id} className="cal-chip done" title="Unplanned ride">
                  ✓ {r.name}
                </span>
              ))}
            </div>
          );
        })}
      </div>

      {dayDialog ? (
        <DayDialog
          date={dayDialog}
          today={today}
          onClose={() => setDayDialog(null)}
          onChanged={() => void refresh()}
          onMove={movePlan}
          onStart={(recipeId) =>
            navigate(recipeId === RAMP_TEST_RECIPE_ID ? '/training' : `/workouts/${recipeId}/setup`)
          }
          onOpenRecording={(id) => navigate(`/data/${id}`)}
        />
      ) : null}
    </main>
  );
}

function DayDialog({
  date,
  today,
  onClose,
  onChanged,
  onMove,
  onStart,
  onOpenRecording,
}: {
  date: string;
  today: string;
  onClose: () => void;
  onChanged: () => void;
  onMove: (planId: string, toDate: string) => Promise<void>;
  onStart: (recipeId: string) => void;
  onOpenRecording: (id: string) => void;
}) {
  const { recipes, recordings, plans } = useLibraryStore();
  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? '');
  const dayPlans = plans.filter((p) => p.date === date);
  const dayRecordings = recordings.filter((r) => localDateString(new Date(r.startedAt)) === date);
  const pretty = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const addPlan = async () => {
    if (!recipeId) return;
    await savePlan({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      recipeId,
      date,
      createdAt: new Date().toISOString(),
    });
    onChanged();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog stack" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h1>{pretty}</h1>
          <button className="small" onClick={onClose}>
            Close
          </button>
        </div>

        {dayPlans.length > 0 ? (
          <div className="stack" style={{ gap: '0.4rem' }}>
            <h2 style={{ margin: 0 }}>Planned</h2>
            {dayPlans.map((p) => {
              const isRamp = p.recipeId === RAMP_TEST_RECIPE_ID;
              const recipe = recipes.find((r) => r.id === p.recipeId);
              const status = planStatus(p, recordings, today);
              const name = isRamp ? 'Ramp test (FTP)' : (recipe?.name ?? 'Deleted workout');
              return (
                <div key={p.id} className="row between">
                  <span>
                    <span className={`cal-chip ${status}`}>{status}</span> {name}
                    {recipe ? (
                      <span className="muted small"> · {formatDuration(recipeTotalSeconds(recipe))}</span>
                    ) : isRamp ? (
                      <span className="muted small"> · open-ended</span>
                    ) : null}
                  </span>
  <span className="row">
                    {(recipe || isRamp) && date >= today && status !== 'done' ? (
                      <button className="small primary" onClick={() => onStart(p.recipeId)}>
                        {isRamp ? 'Go to training level' : 'Go to setup'}
                      </button>
                    ) : null}
                    <button
                      className="small"
                      aria-label="Move one day earlier"
                      onClick={async () => {
                        await onMove(p.id, shiftDate(p.date, -1));
                        onClose();
                      }}
                    >
                      ◀ day
                    </button>
                    <button
                      className="small"
                      aria-label="Move one day later"
                      onClick={async () => {
                        await onMove(p.id, shiftDate(p.date, 1));
                        onClose();
                      }}
                    >
                      day ▶
                    </button>
                    <input
                      type="date"
                      value={p.date}
                      aria-label="Move to date"
                      onChange={async (e) => {
                        if (e.target.value) {
                          await onMove(p.id, e.target.value);
                          onClose();
                        }
                      }}
                    />
                    <button
                      className="small danger"
                      onClick={async () => {
                        await deletePlan(p.id);
                        onChanged();
                      }}
                    >
                      Remove
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}

        {dayRecordings.length > 0 ? (
          <div className="stack" style={{ gap: '0.4rem' }}>
            <h2 style={{ margin: 0 }}>Ridden</h2>
            {dayRecordings.map((r) => (
              <div key={r.id} className="row between">
                <span>
                  {r.name} <span className="muted small">{r.state} · {formatDuration(r.summary?.durationS ?? 0)}</span>
                </span>
                <button className="small" onClick={() => onOpenRecording(r.id)}>
                  View
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <h2 style={{ margin: 0 }}>Plan a workout</h2>
        <div className="row">
          <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)} style={{ flex: 1 }}>
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({formatDuration(recipeTotalSeconds(r))})
              </option>
            ))}
            <option value={RAMP_TEST_RECIPE_ID}>Ramp test (FTP) — open-ended</option>
          </select>
          <button className="primary" onClick={() => void addPlan()} disabled={!recipeId}>
            Add to this day
          </button>
        </div>
      </div>
    </div>
  );
}
