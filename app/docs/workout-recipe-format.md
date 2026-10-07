# Workout recipe format (v1) — authoring spec

You are designing indoor-cycling workouts as JSON files for import into a training app.
Follow this spec exactly; files that violate it are rejected by the importer.

## Output: one JSON file (the import envelope)

```json
{
  "format": "bike-app-export",
  "envelopeVersion": 1,
  "exportedAt": "<ISO 8601 timestamp, e.g. 2026-10-07T09:00:00.000Z>",
  "records": {
    "recipes": [ <one or more WorkoutRecipe objects> ],
    "recordings": [],
    "ftpObservations": []
  }
}
```

To also schedule workouts on calendar dates (a full training plan), add the optional
`records.plans` array — see `training-plan-format.md`.

## WorkoutRecipe object

| Field | Type | Rules |
|---|---|---|
| `schemaVersion` | number | always `1` |
| `id` | string | unique per workout; use a UUID or a descriptive slug like `"ai-sst-3x12-v1"`. Re-importing the same id+revision is skipped as a duplicate; same id with a different revision imports as a copy |
| `revision` | integer | start at `1`; bump when you revise a workout under the same id |
| `name` | string | human-readable title |
| `category` | string | one of `"endurance"`, `"intervals"`, `"tempo"`, `"recovery"`, `"custom"` (`"test"` is reserved) |
| `defaultMode` | string | `"erg"` (trainer enforces target power) or `"shift"` (rider meets targets with virtual gears) — `"erg"` for most structured work |
| `blocks` | array | ≥ 1 block, see grammar below |
| `createdAt`, `updatedAt` | string | ISO 8601 timestamps |
| `source` | string | use `"imported"` |

## Block grammar

A workout is an ordered list of blocks. Four kinds:

**Steady** — hold one power target:
```json
{ "kind": "steady", "label": "Warm-up", "durationS": 600,
  "target": { "basis": "ftpPct", "pct": 50 },
  "cadence": { "minRpm": 85, "maxRpm": 95 } }
```

**Recovery** — identical shape to steady (`"kind": "recovery"`); marks easy spinning between efforts and is colored as rest in the UI.

**Ramp** — power moves linearly from a start to an end target:
```json
{ "kind": "ramp", "label": "Build", "durationS": 480,
  "startTarget": { "basis": "ftpPct", "pct": 84 },
  "endTarget":   { "basis": "ftpPct", "pct": 94 } }
```

**Repeat group** — a set of simple blocks executed `count` times (ONE level only — a repeat may contain steady/recovery/ramp blocks, never another repeat):
```json
{ "kind": "repeat", "label": "Main set", "count": 4, "blocks": [
  { "kind": "steady",   "label": "Effort",   "durationS": 120, "target": { "basis": "ftpPct", "pct": 110 } },
  { "kind": "recovery", "label": "Recovery", "durationS": 120, "target": { "basis": "ftpPct", "pct": 50 } }
] }
```

### Field rules

- `durationS`: seconds, must be > 0. Whole numbers preferred.
- Power targets: `{ "basis": "ftpPct", "pct": <number> }` scales with the rider's FTP
  (preferred — workouts stay valid as fitness changes), or `{ "basis": "watts", "watts": <number> }`
  for absolute power. `pct`/`watts` must be > 0. A ramp's `startTarget` and `endTarget`
  **must use the same basis**.
- `cadence` (optional, any simple block): `{ "minRpm": a, "maxRpm": b }` with `a < b`.
  A coaching range only — omit it for free cadence. It is never mechanically enforced.
- `label` (optional, any block): short name shown during the ride ("Warm-up", "Effort").
  Always label blocks; inside repeats the app appends "1/4", "2/4", ….
- Heart rate is recorded but is NOT a control target; there is no HR field.

## Semantics the designer should know

- `%FTP` resolves to watts against the rider's FTP **at ride start** and is snapshotted;
  later FTP changes never alter past rides.
- In ERG mode the trainer holds each target automatically (ramps re-send ~every 2 s);
  in Shift mode targets are on-screen guidance.
- Total duration = sum of all blocks (repeat groups count `count ×` their contents).

## Intensity guidance (conventional power zones, % of FTP)

| Zone | %FTP | Typical use |
|---|---|---|
| Recovery | ≤ 55 | warm-up/cooldown, recovery spins, between-effort rest |
| Endurance | 56–75 | long steady base work |
| Tempo | 76–90 | sustained moderately-hard blocks (10–30 min) |
| Sweet spot | 84–97 | 8–20 min blocks, high training value per fatigue |
| Threshold | 91–105 | 8–20 min blocks near FTP |
| VO2max | 106–130 | 2–5 min hard intervals |
| Anaerobic | 130+ | ≤ 2 min efforts |

Good structure: 5–15 min progressive warm-up (a ramp from ~45% to ~70% works well),
the main set, 5–10 min cooldown at ≤ 50%. Keep workouts honest about duration —
state the intended total time in the name or label if it matters.

## Complete example (valid, importable as-is)

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
        "id": "ai-vo2-5x3-v1",
        "revision": 1,
        "name": "VO2 5 x 3 min",
        "category": "intervals",
        "defaultMode": "erg",
        "createdAt": "2026-10-07T09:00:00.000Z",
        "updatedAt": "2026-10-07T09:00:00.000Z",
        "source": "imported",
        "blocks": [
          { "kind": "ramp", "label": "Warm-up", "durationS": 600,
            "startTarget": { "basis": "ftpPct", "pct": 45 },
            "endTarget": { "basis": "ftpPct", "pct": 70 } },
          { "kind": "repeat", "label": "VO2 set", "count": 5, "blocks": [
            { "kind": "steady", "label": "Effort", "durationS": 180,
              "target": { "basis": "ftpPct", "pct": 112 },
              "cadence": { "minRpm": 95, "maxRpm": 110 } },
            { "kind": "recovery", "label": "Recovery", "durationS": 180,
              "target": { "basis": "ftpPct", "pct": 45 } }
          ] },
          { "kind": "recovery", "label": "Cooldown", "durationS": 480,
            "target": { "basis": "ftpPct", "pct": 45 } }
        ]
      }
    ]
  }
}
```

## Checklist before emitting

1. Valid JSON, exactly one envelope object, recipes in `records.recipes`.
2. Every block duration > 0; repeat counts are positive integers; repeats contain no repeats.
3. Ramp start/end share one basis; cadence ranges have min < max.
4. Unique `id` per workout; `schemaVersion: 1`; `source: "imported"`.
5. Durations and intensities add up to the workout you intended.
