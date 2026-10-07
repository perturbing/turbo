# Training plan format (v1) — calendar authoring spec

Companion to `workout-recipe-format.md` (read that first: it defines the import envelope
and the WorkoutRecipe object). This file adds the **planned workout** record, which places
workouts on calendar dates. Together they let you emit a complete training plan — the
workouts AND the schedule — as one importable JSON file.

## Where plans live in the envelope

The envelope gains one (optional) array, `records.plans`:

```json
{
  "format": "bike-app-export",
  "envelopeVersion": 1,
  "exportedAt": "<ISO 8601 timestamp>",
  "records": {
    "recipes": [ <WorkoutRecipe objects — the workouts the plan uses> ],
    "plans":   [ <PlannedWorkout objects — who rides what on which day> ],
    "recordings": [],
    "ftpObservations": []
  }
}
```

## PlannedWorkout object

| Field | Type | Rules |
|---|---|---|
| `schemaVersion` | number | always `1` |
| `id` | string | unique per plan entry (UUID or slug like `"plan-w1-tue-sst"`). Re-importing the same id is skipped as a duplicate — so the same file can be imported twice safely |
| `recipeId` | string | the `id` of the workout to ride that day — either a recipe in the SAME file's `records.recipes`, or one already in the rider's library. Prefer shipping the recipes in the same file so the plan is self-contained. **Reserved value** `"ramp-test"`: schedules the FTP ramp test (an open-ended protocol, not a recipe — do NOT ship a recipe for it) |
| `date` | string | local calendar date, `"YYYY-MM-DD"`. A plan belongs to a day, not a time |
| `note` | string | optional free text shown on hover (e.g. "key session — don't skip") |
| `createdAt` | string | ISO 8601 timestamp |

## Semantics

- One plan entry = one planned ride. Two workouts on one day = two entries with that date.
- **Completion is derived, never stored**: the calendar marks a plan done when a completed
  recording of that `recipeId` exists on that local date (partial if the ride ended early,
  missed once the date passes without a ride). Do not emit any completion field.
- The same `recipeId` may appear on many dates — define a workout once in `records.recipes`
  and schedule it repeatedly. Do NOT duplicate the recipe per day.
- Deleting a recipe later leaves its plans showing "Deleted workout"; keep recipe ids stable.

## Plan-design guidance

- Anchor hard sessions (VO2, threshold) with at least one easy/recovery or rest day between
  them; rest days are simply dates with no entry.
- Multi-week plans that scale from FTP benefit from a scheduled test: put a
  `"recipeId": "ramp-test"` entry at the start of the plan (and optionally at the start of a
  later block), on a fresh day. It is matched done by any completed ramp-test ride that day.
- A common weekly shape: 2–3 quality sessions + 1–2 endurance rides; every 3rd or 4th week
  lighter (fewer/shorter sessions) for recovery.
- Use `note` for intent ("key session", "skip if tired"), not for structure.
- Keep ids readable and systematic (`plan-w2-thu-vo2`) so a revised plan can be re-imported:
  unchanged ids are skipped, new ids are added.

## Complete example (valid, importable as-is): one workout scheduled twice

```json
{
  "format": "bike-app-export",
  "envelopeVersion": 1,
  "exportedAt": "2026-10-07T09:00:00.000Z",
  "records": {
    "recordings": [],
    "ftpObservations": [],
    "recipes": [
      {
        "schemaVersion": 1,
        "id": "ai-plan-sst-3x12-v1",
        "revision": 1,
        "name": "Sweet Spot 3 x 12 min",
        "category": "tempo",
        "defaultMode": "erg",
        "createdAt": "2026-10-07T09:00:00.000Z",
        "updatedAt": "2026-10-07T09:00:00.000Z",
        "source": "imported",
        "blocks": [
          { "kind": "ramp", "label": "Warm-up", "durationS": 600,
            "startTarget": { "basis": "ftpPct", "pct": 45 },
            "endTarget": { "basis": "ftpPct", "pct": 70 } },
          { "kind": "repeat", "label": "Sweet spot", "count": 3, "blocks": [
            { "kind": "steady", "label": "SST", "durationS": 720,
              "target": { "basis": "ftpPct", "pct": 90 } },
            { "kind": "recovery", "label": "Float", "durationS": 240,
              "target": { "basis": "ftpPct", "pct": 50 } }
          ] },
          { "kind": "recovery", "label": "Cooldown", "durationS": 420,
            "target": { "basis": "ftpPct", "pct": 45 } }
        ]
      }
    ],
    "plans": [
      {
        "schemaVersion": 1,
        "id": "plan-w1-tue-sst",
        "recipeId": "ai-plan-sst-3x12-v1",
        "date": "2026-10-13",
        "note": "Week 1 key session",
        "createdAt": "2026-10-07T09:00:00.000Z"
      },
      {
        "schemaVersion": 1,
        "id": "plan-w1-fri-sst",
        "recipeId": "ai-plan-sst-3x12-v1",
        "date": "2026-10-16",
        "createdAt": "2026-10-07T09:00:00.000Z"
      }
    ]
  }
}
```

## Checklist before emitting

1. Every `plans[].recipeId` matches a recipe in this file (or a known existing library id).
2. Dates are `YYYY-MM-DD`, in the rider's local sense; no times, no timezones.
3. Unique `id` per plan entry AND per recipe; `schemaVersion: 1` everywhere.
4. No completion/status fields on plans — the app derives them from rides.
5. Everything from the `workout-recipe-format.md` checklist holds for the recipes.
