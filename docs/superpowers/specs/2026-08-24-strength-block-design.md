# Strength Block — Design

**Date:** 2026-08-24
**Status:** Approved (brainstorming complete, pre-implementation)
**Supersedes:** the block calendar in `2026-08-20-ironman-training-site-design.md` §3

---

## 1. Purpose

Insert a 12-week lifting cycle into the training calendar, starting **2026-09-14**, run every morning before work. Cardio continues at reduced volume around it.

The source is `ETS_The_Build_Paper_Chain.docx` — 60 sessions, Monday to Friday, 2026-09-14 through 2026-12-04. The document's weekday labels match 2026 exactly (Sep 14 is a Monday, Dec 4 a Friday), so the dates are taken as authoritative.

The goal, in the athlete's words: ramp strength back up, then continue training cardiovascular. The race is 2027-06-05 — 26 weeks after this block ends, which is enough time to build tri-specific fitness from a maintained base.

## 2. Calendar changes

| Block | Before | After |
|---|---|---|
| **Prep** | 2026-08-24, 8 weeks → 2026-10-18 | 2026-08-24, **3 weeks** → **2026-09-13** |
| **Bridge** | 2026-10-19, 7 weeks → 2026-12-06 | **removed** — absorbed by Strength |
| **Strength** | — | **2026-09-14, 12 weeks → 2026-12-06** |
| **Arc** | 2026-12-07, 26 weeks → 2027-06-06 | unchanged |

Sep 14 + 12 weeks lands exactly on Dec 6, so Arc's start date does not move and the 26-week arc into the race is untouched.

Prep truncates at week 3, immediately before its scheduled recovery week — a natural seam rather than an abrupt cut. Prep progression rows for weeks 4–8 are deleted; that material remains in the athlete's personal notes.

Strength block phases:

| Phase | Weeks | Dates |
|---|---|---|
| GVT | 1–8 | 2026-09-14 → 2026-11-08 |
| Powerbuilding | 9–12 | 2026-11-09 → 2026-12-06 |

## 3. The schedule

### Weeks 1–8 — lift as written, cardio on life support

All five lifting days run unchanged from the document.

| | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
|---|---|---|---|---|---|---|---|
| **AM** | Lift | Lift | Lift | Lift | Lift | — | — |
| **PM** | — | Swim 2,000m | — | Swim 2,000m | — | Ride 60 min Z2 | Run 30 min easy *(optional)* |

Swims sit on Tuesday and Thursday because those are lower-body lifting days — the upper body is freshest for the pool on exactly the evenings the legs are useless. Swim frequency holds at 2×/week, which maintains technique in the athlete's weakest and newest discipline.

Saturday's ride is fixed at 60 minutes and does not progress. The Saturday long ride and Sunday long run of the Prep block are suspended for these eight weeks; weeks 1–8 put heavy lower body on Tuesday *and* Thursday, with GVT deadlift on Wednesday, and progressive weekend endurance on top of that does not recover.

Total: ~3.5 hours of cardio per week.

### Weeks 9–12 — three lifting days, cardio ramps back

The document's five days collapse into a Push/Pull/Legs split on Monday, Wednesday and Friday.

| | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
|---|---|---|---|---|---|---|---|
| **AM** | **Legs** | — | **Pull** | — | **Push** | — | — |
| **PM** | — | Swim 2,000m | — | Run 40 min | — | Long ride | Long run |

**Ordering is Legs / Pull / Push, not Push / Pull / Legs.** Squats land on Monday, five clear days before Saturday's long ride, and Friday's chest-shoulders-triceps work barely involves the legs. The reverse order would put a squat session the day before the longest ride of the week, which defeats the purpose of ramping cardio at all.

Weekend progression:

| Week | Long ride | Long run | Main lift | Power sets |
|---|---|---|---|---|
| 9 | 75 min | 40 min | 4×6 | 5×3 @ 85% 1RM |
| 10 | 90 min | 45 min | 5×5 | 6×2 @ 90% 1RM |
| 11 | 105 min | 50 min | 6×3 | 4×6 @ 70% 1RM |
| 12 | 120 min | 55 min | 4×10 | 5×5 @ 75% 1RM |

Week 11 is the lifting deload (70%); cardio keeps ramping through it, since the reduced barbell load is what makes room for the volume. Ending at 120 min / 55 min hands off cleanly to Arc week 1.

### How the five days become three

Thursday's Upper Body day and Friday's Strength/Power day are absorbed rather than dropped:

- Overhead press, weighted dips → **Push**
- DB shrugs, weighted pull-ups → **Pull**
- The Strength/Power percentages become a **second top-set block on each day's main lift**, kept as a separate prescription rather than merged into the main scheme. The document treats these as distinct progressions (4×6 main alongside 5×3 @ 85% power in week 9), and collapsing them into "4×6 @ 85%" would misstate the load badly.

This is the same shape the document already uses in week 2's Tuesday: `Barbell Squat 3×8-10` followed by `Barbell Squat 3×3 (heavier)`.

## 4. Data model

### 4.1 The problem

`plan.skeleton` is a **single** weekly template shared by every block. `plan.progression` supplies per-block numbers only. Sixty lifting sessions across alternating week shapes cannot be expressed this way.

### 4.2 The change

Three additions, no removals.

**Blocks declare their week source.**

```json
{ "id": "strength", "label": "Strength", "start": "2026-09-14", "weeks": 12,
  "authored": true, "weekSource": "weekTemplates",
  "phases": [ { "label": "GVT", "from": 1, "to": 8 },
              { "label": "Powerbuilding", "from": 9, "to": 12 } ] }
```

`weekSource` defaults to `"skeleton"` when absent, so Prep and Arc need no change.

**`plan.weekTemplates` holds three named weeks** — `gvtA`, `gvtB`, `ppl` — each shaped exactly like `plan.skeleton`: day keys mapping to arrays of session templates. Weeks 1–8 alternate `gvtA` (odd) and `gvtB` (even); weeks 9–12 all use `ppl`.

Three templates rather than sixty explicit sessions, because the material genuinely is two alternating weeks plus a progression. Weeks 1, 3, 5 and 7 are identical except for the GVT rep scheme; weeks 2, 4, 6 and 8 are identical except for the Wednesday deadlift and Friday bench schemes.

**Progression rows name their template and carry the moving values.**

```json
{ "week": 1,  "type": "build", "template": "gvtA", "gvt": "10×10" },
{ "week": 2,  "type": "build", "template": "gvtB",
  "deadlift": "5×5 (80% 1RM)", "bench": "5×5 (75% 1RM)" },
{ "week": 9,  "type": "build", "template": "ppl",
  "main": "4×6", "power": "5×3 @ 85% 1RM",
  "longRideMin": 75, "longRunMin": 40 }
```

Set lines interpolate these by name: `"Bench Press {gvt} — 90 sec rest, same weight all 10 sets"`.

Weekend durations reuse the **existing** `prescribed.fromProgression` mechanism, which already drives the long ride and long run in the tri blocks. No new concept.

### 4.3 Progression values

| Week | Template | Values |
|---|---|---|
| 1 | gvtA | `gvt` 10×10 |
| 2 | gvtB | `deadlift` 5×5 (80% 1RM), `bench` 5×5 (75% 1RM) |
| 3 | gvtA | `gvt` 10×6 |
| 4 | gvtB | `deadlift` 6×3 (80% 1RM), `bench` 6×3 (75% 1RM) |
| 5 | gvtA | `gvt` 10×4 |
| 6 | gvtB | `deadlift` 6×2 (80% 1RM), `bench` 6×2 (75% 1RM) |
| 7 | gvtA | `gvt` 10×3 |
| 8 | gvtB | `deadlift` 4×8 (80% 1RM), `bench` 4×8 (75% 1RM) |
| 9–12 | ppl | `main` / `power` / `longRideMin` / `longRunMin` per §3 table |

### 4.4 `resolveWeek` changes

One branch to pick the template source:

```js
const source = block.weekSource === 'weekTemplates'
  ? plan.weekTemplates[progression.template]
  : plan.skeleton;
```

Plus placeholder interpolation in `setLines`, reading named values off the progression row.

The recovery-week deltas (`recovery.skipStrength`, swim reductions, Tuesday/Thursday duration overrides) are **guarded to skeleton blocks only**. The Strength block manages its own load through the week 11 deload; applying tri recovery rules to it would silently delete lifting sessions.

Session keys keep the `blockId:week:dayKey:discipline` format. No day in any template carries two sessions of the same discipline, so no key collides. This must be asserted in tests, not assumed.

### 4.5 Nutrition

`plan.nutrition.dayTypes` is keyed globally by weekday, which is wrong during this block — Saturday is tagged `big` but is a 60-minute spin in weeks 1–8.

Templates gain an optional `dayTypes` map that overrides the global one when present.

A new nutrition type is added:

```json
"lift": {
  "label": "Lifting day",
  "approach": "Maintenance calories. Protein 1.8-2.2 g/kg. Do not run a deficit while ramping strength."
}
```

This is a deliberate reversal of the athlete's stated intent to lose weight during this period. A calorie deficit directly blunts the strength and hypertrophy adaptation the block exists to produce; the two goals cannot both be served. The recommendation is to eat at maintenance from September to December and reinstate the deficit during Arc's aerobic base weeks, where it costs far less.

Template day types:

| Template | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
|---|---|---|---|---|---|---|---|
| gvtA / gvtB | lift | lift | lift | lift | lift | moderate | low |
| ppl | lift | moderate | lift | moderate | lift | big | big |

## 5. Site

Most of the site needs nothing:

- **Day view** already renders `setLines` as an ordered list; exercise lists work unchanged.
- **Season view** picks up the new block and its phases automatically.
- **Log matching** already maps Strava `WeightTraining` and `Workout` to `strength`.
- **Month view** fills September–December weekdays with strength dots.

Two changes are needed:

- Lifting sessions are **not** `optional`, so their month-view dots render at full opacity rather than the 50% `.mdot.optional` dimming used for the old Friday accessory circuit.
- `README.md`'s calendar table lists the old block dates and must be rewritten.

## 6. Testing

Following the repo's existing pattern — pure functions, `node --test`, no DOM.

**`plan-json.test.js`** (data integrity, runs against the real `plan.json`):
- Every progression row names a template that exists in `weekTemplates`.
- Every `{placeholder}` appearing in any template's set lines is supplied by every progression row that uses that template. This is the failure mode most likely to ship silently — a set line reading `Bench Press {gvt}` on screen.
- No day in any template carries two sessions of the same discipline (key collision).
- Block dates are contiguous: each block starts the day after the previous one ends.
- Strength block weeks 1–8 alternate `gvtA`/`gvtB` by parity.

**`plan-model.test.js`**:
- `resolveWeek` on a `weekTemplates` block returns interpolated set lines with no `{` remaining.
- `resolveWeek` on a skeleton block is unchanged (regression).
- Recovery deltas do not apply to a `weekTemplates` block even if its progression row said `recovery`.
- Weekend durations resolve from progression in weeks 9–12.
- `dayForDate` returns the Strength block for 2026-09-14 and Prep for 2026-09-13.

**`monthRows`** across the new Prep → Strength boundary in September 2026.

## 7. Out of scope

- Authoring the Arc block. It stays unauthored and is written closer to December.
- Tracking lifting load, 1RM, or per-exercise progression. The site prescribes; Strava records. Barbell numbers live in the athlete's own log.
- Changing how Strava activities match to sessions. Best-fit by discipline and duration is adequate for one lift per day.
- A dark theme, or any change to the pastel palette shipped in #1.
