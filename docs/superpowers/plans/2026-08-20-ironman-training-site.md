# Ironman 70.3 Training Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static GitHub Pages site that shows today's prescribed training session in full, the current week, and the season arc — with completed sessions filled in nightly from Strava by a Claude scheduled task.

**Architecture:** No build step, no dependencies. `index.html` loads ES modules from `assets/`, which fetch two JSON files at runtime: `data/plan.json` (hand-authored, the source of truth for what you should do) and `data/log.json` (machine-written, what you did). All plan logic is pure functions in importable modules so `node --test` can exercise them directly. A nightly Claude scheduled task queries Strava MCP, merges results into `log.json`, and pushes — Pages redeploys automatically.

**Tech Stack:** Vanilla HTML/CSS/ES modules. Node 18+ built-in test runner (`node --test`). No npm dependencies. Git + GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-20-ironman-training-site-design.md`

## Global Constraints

- **No dependencies.** `package.json` exists only to set `"type": "module"` and a test script. `npm install` must never be required.
- **No build step.** The files committed to `main` are the files served by Pages.
- **All dates are `YYYY-MM-DD` strings** and compared as strings. `Date` arithmetic exists only inside `assets/date-utils.js`, anchored at UTC noon. No other module constructs a `Date`.
- **Week boundaries are Monday-start.** Day keys are `mon tue wed thu fri sat sun`.
- **Every week label carries its block name.** Render `Prep W3`, never a bare `W3` — Prep and Arc both number weeks 1–8.
- **Nothing unauthored renders as a prescription.** Bridge and Arc weeks have no session content yet; they must render as an explicit placeholder.
- **A broken sync must never look like a rest day.** Missing data and a missed workout are different states with different rendering.
- Race date `2027-06-05`. Blocks: `prep` starts `2026-08-24` (8 weeks), `bridge` starts `2026-10-19` (7 weeks), `arc` starts `2026-12-07` (26 weeks).
- Status thresholds: `done` ≥85% of prescribed, `partial` 40–85%, `missed` <40% or nothing found. Swims judged on **distance**, bike/run on **moving time**.
- Optional sessions are never `missed`.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | `{"type":"module"}` + test script. No deps. |
| `index.html` | Page shell: header, nav, banner slot, one `<main>` mount point. |
| `assets/app.css` | All styling. |
| `assets/date-utils.js` | The only module that touches `Date`. ISO string arithmetic. |
| `assets/plan-model.js` | `dayForDate()`, `resolveWeek()` — turns `plan.json` into concrete dated sessions. |
| `assets/log-model.js` | `statusFor()`, `matchDay()`, `mergeEntries()`, `weekCompletion()`. |
| `assets/render.js` | Pure `(data) => HTMLElement` renderers for the three views. |
| `assets/app.js` | Bootstrap: fetch data, hash routing, banners, mount. |
| `data/plan.json` | The plan. Hand-authored from the two `70.3-*.md` files. |
| `data/log.json` | Written by the nightly sync. |
| `data/sync-status.json` | Written by the nightly sync. |
| `scripts/sync-runbook.md` | Instructions the scheduled task follows. |
| `tests/*.test.js` | `node --test`. |

**Deviation from spec §4:** the spec listed a single `assets/app.js`. Splitting into four focused modules keeps each file small enough to hold in context and makes the pure logic directly testable. Same architecture, better boundaries.

---

### Task 1: Scaffold and date utilities

**Files:**
- Create: `package.json`
- Create: `assets/date-utils.js`
- Test: `tests/date-utils.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseISO(iso) -> Date`, `toISO(date) -> string`, `addDays(iso, n) -> string`, `daysBetween(a, b) -> number`, `weekdayKey(iso) -> string`, `mondayOf(iso) -> string`. All ISO arguments and returns are `YYYY-MM-DD` strings.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ironman-coach",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/date-utils.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysBetween, weekdayKey, mondayOf } from '../assets/date-utils.js';

test('addDays moves forward and backward', () => {
  assert.equal(addDays('2026-08-24', 6), '2026-08-30');
  assert.equal(addDays('2026-08-24', -1), '2026-08-23');
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-10-18', 1), '2026-10-19');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('daysBetween is unaffected by daylight saving', () => {
  // US DST ends 2026-11-01. A naive local-midnight implementation returns 2.04 here.
  assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2);
  assert.equal(daysBetween('2027-03-13', '2027-03-15'), 2);
});

test('daysBetween is signed', () => {
  assert.equal(daysBetween('2026-08-24', '2026-08-24'), 0);
  assert.equal(daysBetween('2026-08-25', '2026-08-24'), -1);
});

test('weekdayKey maps Monday-first', () => {
  assert.equal(weekdayKey('2026-08-24'), 'mon');
  assert.equal(weekdayKey('2026-08-30'), 'sun');
  assert.equal(weekdayKey('2027-06-05'), 'sat');
});

test('mondayOf returns the Monday of the containing week', () => {
  assert.equal(mondayOf('2026-08-24'), '2026-08-24');
  assert.equal(mondayOf('2026-08-30'), '2026-08-24');
  assert.equal(mondayOf('2026-08-27'), '2026-08-24');
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
node --test tests/date-utils.test.js
```

Expected: FAIL — `Cannot find module '../assets/date-utils.js'`.

- [ ] **Step 4: Write the implementation**

Create `assets/date-utils.js`:

```js
// The only module in this codebase that constructs a Date.
// Everything is anchored at UTC noon so daylight-saving transitions
// can never shift a date across a day boundary.

const DAY_MS = 86400000;
const KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function parseISO(iso) {
  return new Date(`${iso}T12:00:00Z`);
}

export function toISO(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  return toISO(new Date(parseISO(iso).getTime() + n * DAY_MS));
}

export function daysBetween(a, b) {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / DAY_MS);
}

export function weekdayKey(iso) {
  // getUTCDay(): 0 = Sunday. Shift so Monday is index 0.
  return KEYS[(parseISO(iso).getUTCDay() + 6) % 7];
}

export function mondayOf(iso) {
  return addDays(iso, -KEYS.indexOf(weekdayKey(iso)));
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
node --test tests/date-utils.test.js
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json assets/date-utils.js tests/date-utils.test.js
git commit -m "feat: add ISO date utilities anchored at UTC noon"
```

---

### Task 2: Author `data/plan.json`

**Files:**
- Create: `data/plan.json`
- Test: `tests/plan-json.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: the `plan` object shape consumed by every later task. Keys: `race`, `blocks[]`, `skeleton{}`, `progression{}`, `recovery{}`, `swimSets{}`, `nutrition{}`.

**Content source:** `70.3-base-phase-weeks-1-8.md` and `70.3-training-context-handoff.md`, already in the repo root.

**Two authoring decisions baked in below, both worth understanding:**

1. **Wednesday recovery is expressed only through the main set.** The `-500m` recovery rule applies to Monday and Friday swims. Week 4's Wednesday main set is already the reduced `5×100 easy`; subtracting another 500m would double-count the cut.
2. **Week 8's Wednesday overrides the whole structure.** The `1×1500` pacing test inside the normal warmup/cooldown scaffold totals 2,700m, well above the 2,000–2,400m band. Week 8 uses `300 warmup / 1500 test / 200 cooldown` = 2,000m.

- [ ] **Step 1: Write the failing test**

Create `tests/plan-json.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const plan = JSON.parse(readFileSync(new URL('../data/plan.json', import.meta.url)));

test('race date and blocks are anchored correctly', () => {
  assert.equal(plan.race.date, '2027-06-05');
  const ids = plan.blocks.map(b => b.id);
  assert.deepEqual(ids, ['prep', 'bridge', 'arc']);
  assert.deepEqual(
    plan.blocks.map(b => [b.start, b.weeks]),
    [['2026-08-24', 8], ['2026-10-19', 7], ['2026-12-07', 26]]
  );
});

test('blocks are contiguous with no gap or overlap', () => {
  for (let i = 1; i < plan.blocks.length; i++) {
    const prev = plan.blocks[i - 1];
    const prevEnd = new Date(`${prev.start}T12:00:00Z`).getTime() + prev.weeks * 7 * 86400000;
    assert.equal(new Date(prevEnd).toISOString().slice(0, 10), plan.blocks[i].start);
  }
});

test('only prep is authored', () => {
  assert.equal(plan.blocks.find(b => b.id === 'prep').authored, true);
  assert.equal(plan.blocks.find(b => b.id === 'bridge').authored, false);
  assert.equal(plan.blocks.find(b => b.id === 'arc').authored, false);
});

test('skeleton covers all seven days', () => {
  assert.deepEqual(Object.keys(plan.skeleton), ['mon','tue','wed','thu','fri','sat','sun']);
});

test('prep progression has 8 weeks with weeks 4 and 8 as recovery', () => {
  assert.equal(plan.progression.prep.length, 8);
  const types = plan.progression.prep.map(w => w.type);
  assert.deepEqual(types, ['build','build','build','recovery','build','build','build','recovery']);
});

test('weekend progression matches the written plan', () => {
  assert.deepEqual(plan.progression.prep.map(w => w.rideMin), [90,100,110,70,120,130,135,90]);
  assert.deepEqual(plan.progression.prep.map(w => w.runMin), [50,55,60,40,65,70,75,45]);
});

test('every wednesday swim lands in the 1700-2400m band', () => {
  for (const wk of plan.progression.prep) {
    assert.ok(wk.wedDistance >= 1700 && wk.wedDistance <= 2400,
      `week ${wk.week} wednesday swim is ${wk.wedDistance}m`);
  }
});

test('nutrition assigns a day type to all seven days', () => {
  assert.deepEqual(Object.keys(plan.nutrition.dayTypes), ['mon','tue','wed','thu','fri','sat','sun']);
  assert.equal(plan.nutrition.dayTypes.mon, 'low');
  assert.equal(plan.nutrition.dayTypes.sat, 'big');
  for (const t of Object.values(plan.nutrition.dayTypes)) {
    assert.ok(plan.nutrition.types[t], `missing definition for day type ${t}`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/plan-json.test.js
```

Expected: FAIL — `ENOENT: no such file or directory ... data/plan.json`.

- [ ] **Step 3: Write `data/plan.json`**

```json
{
  "race": { "name": "TBD 70.3", "date": "2027-06-05" },

  "blocks": [
    { "id": "prep", "label": "Prep", "start": "2026-08-24", "weeks": 8, "authored": true,
      "note": "The written base phase, weeks 1-8." },
    { "id": "bridge", "label": "Bridge", "start": "2026-10-19", "weeks": 7, "authored": false,
      "note": "Extended aerobic base. Not authored yet - written before 2026-10-19." },
    { "id": "arc", "label": "Arc", "start": "2026-12-07", "weeks": 26, "authored": false,
      "note": "The documented 26-week plan. Authored block by block as it approaches.",
      "phases": [
        { "label": "Base", "from": 1, "to": 8 },
        { "label": "Build", "from": 9, "to": 16 },
        { "label": "Race-specific", "from": 17, "to": 22 },
        { "label": "Taper", "from": 23, "to": 26 }
      ]
    }
  ],

  "skeleton": {
    "mon": [
      { "discipline": "swim", "title": "Technique swim", "optional": true,
        "prescribed": { "metric": "distance", "value": 1800, "unit": "m" },
        "effort": "Easy throughout. Technique is the point, not the distance.",
        "setRef": "monTechnique",
        "detail": ["Alternative: full rest, if last week was hard.",
                   "Pick ONE cue for the whole session."] }
    ],
    "tue": [
      { "discipline": "bike", "title": "Easy-steady bike",
        "prescribed": { "metric": "duration", "value": 60, "unit": "min" },
        "effort": "Zone 2 - 65-75% max HR - cadence 85-95",
        "detail": ["Conversational the whole way.",
                   "The most common way to ruin base is letting this drift into moderately hard."] }
    ],
    "wed": [
      { "discipline": "swim", "title": "Main swim",
        "prescribed": { "metric": "distance", "value": 2000, "unit": "m" },
        "effort": "Steady - repeatable. Same pace on the last rep as the first.",
        "setRef": "wedMain",
        "detail": ["Count strokes per length on the main set.",
                   "If the count climbs more than 3-4 from first rep to last, the stroke is falling apart - note when."] },
      { "discipline": "run", "title": "Brick run off the swim",
        "prescribed": { "metric": "duration", "value": 30, "unit": "min" },
        "effort": "Zone 2 - easy",
        "detail": ["Short on purpose. Do not extend it."] }
    ],
    "thu": [
      { "discipline": "run", "title": "Easy run + strides",
        "prescribed": { "metric": "duration", "value": 45, "unit": "min" },
        "effort": "Zone 2 - 65-75% max HR",
        "detail": ["Finish with 6 x 20s strides.",
                   "Strides are relaxed accelerations, not sprints. Smooth, controlled, no straining."] }
    ],
    "fri": [
      { "discipline": "swim", "title": "Mixed swim",
        "prescribed": { "metric": "distance", "value": 2000, "unit": "m" },
        "effort": "Alternating steady and easy",
        "setRef": "friMixed", "detail": [] },
      { "discipline": "strength", "title": "Strength", "optional": true,
        "prescribed": { "metric": "duration", "value": 30, "unit": "min" },
        "effort": "Light. Durability work, not a lifting program.",
        "setRef": "strength",
        "detail": ["Two rounds, minimal rest between exercises, 90s between rounds.",
                   "If it is making Saturday worse, cut it."] }
    ],
    "sat": [
      { "discipline": "bike", "title": "Long ride",
        "prescribed": { "metric": "duration", "value": null, "unit": "min", "fromProgression": "rideMin" },
        "effort": "Zone 2 - 65-75% max HR. Yes, even the long one.",
        "detail": ["The anchor session of the week.",
                   "Fuel: 60g carb/hr, starting at 30 min."] }
    ],
    "sun": [
      { "discipline": "run", "title": "Long run",
        "prescribed": { "metric": "duration", "value": null, "unit": "min", "fromProgression": "runMin" },
        "effort": "Zone 2. Slower than you think.",
        "detail": ["Water for the first hour, then 20-30g carb/hr."] }
    ]
  },

  "progression": {
    "prep": [
      { "week": 1, "type": "build",    "rideMin": 90,  "runMin": 50, "wedDistance": 2000, "wedMainSet": "8 x 100 steady, 20s rest" },
      { "week": 2, "type": "build",    "rideMin": 100, "runMin": 55, "wedDistance": 2000, "wedMainSet": "8 x 100 steady, 20s rest" },
      { "week": 3, "type": "build",    "rideMin": 110, "runMin": 60, "wedDistance": 2100, "wedMainSet": "6 x 150 steady, 20s rest" },
      { "week": 4, "type": "recovery", "rideMin": 70,  "runMin": 40, "wedDistance": 1700, "wedMainSet": "5 x 100 easy, 30s rest" },
      { "week": 5, "type": "build",    "rideMin": 120, "runMin": 65, "wedDistance": 2200, "wedMainSet": "5 x 200 steady, 20s rest" },
      { "week": 6, "type": "build",    "rideMin": 130, "runMin": 70, "wedDistance": 2200, "wedMainSet": "5 x 200 steady, 20s rest" },
      { "week": 7, "type": "build",    "rideMin": 135, "runMin": 75, "wedDistance": 2400, "wedMainSet": "4 x 300 steady, 15s rest" },
      { "week": 8, "type": "recovery", "rideMin": 90,  "runMin": 45, "wedDistance": 2000, "wedMainSet": "1 x 1500 continuous, steady - pacing test",
        "wedStructureOverride": ["300 easy free", "1500 continuous steady - this is the pacing test", "200 easy cooldown"] }
    ]
  },

  "recovery": {
    "note": "Applied when a week's type is 'recovery'. You should finish feeling slightly restless. That is the target.",
    "tue": { "durationMin": 40 },
    "thu": { "durationMin": 30, "dropStrides": true },
    "swimDeltaMetres": -500,
    "swimDeltaAppliesTo": ["mon", "fri"],
    "skipStrength": true
  },

  "swimSets": {
    "monTechnique": [
      "300 easy free",
      "8 x 50 drill - 20s rest (rotate: fingertip drag, catch-up, single-arm, 6-3-6)",
      "6 x 100 on ONE cue only - 20s rest",
      "200 easy cooldown"
    ],
    "wedMain": {
      "warmup": ["300 easy free", "4 x 50 build easy to moderate - 15s rest", "6 x 50 drill - 15s rest"],
      "cooldown": ["4 x 50 pull buoy, high elbow - 15s rest", "200 easy cooldown"]
    },
    "friMixed": [
      "400 easy free",
      "6 x 50 drill - 15s rest",
      "10 x 100 alternating: odd steady, even easy - 15s rest",
      "200 kick with board (easy)",
      "200 cooldown"
    ],
    "strength": [
      "Goblet squat x 10",
      "Single-leg Romanian deadlift x 8 each side",
      "Push-up x 10-15",
      "Split squat x 8 each side",
      "Plank 45s",
      "Side plank 30s each side",
      "Glute bridge x 15"
    ]
  },

  "cues": [
    { "name": "Exhale, don't hold", "detail": "Steady bubbles the whole time your face is in the water. Breath-holding is what causes the panic-breathing spiral." },
    { "name": "Look down", "detail": "Eyes at the bottom of the pool, slight pressure through the chest. Head lifts as you tire, hips sink, drag." },
    { "name": "Long in front", "detail": "Reach, brief glide, finish past the hip. Tired means shortening and spinning the arms." },
    { "name": "Quiet legs", "detail": "Small kick from the hip. The kick's job is body position, not propulsion." }
  ],

  "nutrition": {
    "dayTypes": { "mon": "low", "tue": "moderate", "wed": "moderate", "thu": "moderate", "fri": "moderate", "sat": "big", "sun": "big" },
    "types": {
      "big":      { "label": "Big day", "approach": "Maintenance or slightly above. Fuel during the session." },
      "moderate": { "label": "Moderate day", "approach": "~300-400 kcal deficit. Carbs concentrated around training." },
      "low":      { "label": "Low day", "approach": "~500 kcal deficit. Protein high, carbs lower." }
    },
    "nonNegotiables": [
      "Protein 1.6-2.0 g/kg bodyweight, in 3-4 feedings of 25-40g.",
      "Vegetables at two meals.",
      "Water throughout, plus replacing session losses.",
      "Cap alcohol, especially Friday and Saturday."
    ],
    "fuel": {
      "under75min": "Water only.",
      "longRide": "60g carb/hr, starting at 30 min.",
      "longRun": "Water for the first hour, then 20-30g carb/hr.",
      "post": "After the long ride, long run, or the Wednesday brick: ~1g carb/kg + 25-30g protein within an hour. After anything else, just the next normal meal - no extra recovery snack."
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/plan-json.test.js
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add data/plan.json tests/plan-json.test.js
git commit -m "feat: author plan.json for the 8-week prep block"
```

---

### Task 3: `dayForDate()` — locate any date in the plan

**Files:**
- Create: `assets/plan-model.js`
- Test: `tests/plan-model.test.js`

**Interfaces:**
- Consumes: `assets/date-utils.js` (`daysBetween`, `weekdayKey`, `addDays`).
- Produces: `dayForDate(plan, iso)` returning either
  `{ inPlan: false, reason: 'before-start'|'after-end' }` or
  `{ inPlan: true, blockId, blockLabel, week, weekType, dayKey, date, phaseLabel|null, authored }`.

`weekType` is `'build'`, `'recovery'`, or `'unauthored'`. `phaseLabel` is set only for the `arc` block (from `blocks[].phases`), `null` otherwise.

- [ ] **Step 1: Write the failing test**

Create `tests/plan-model.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dayForDate } from '../assets/plan-model.js';

const plan = JSON.parse(readFileSync(new URL('../data/plan.json', import.meta.url)));

test('a date before the plan starts is not in the plan', () => {
  assert.deepEqual(dayForDate(plan, '2026-08-23'), { inPlan: false, reason: 'before-start' });
});

test('a date after the plan ends is not in the plan', () => {
  assert.deepEqual(dayForDate(plan, '2027-06-07'), { inPlan: false, reason: 'after-end' });
});

test('first day of the plan is Prep week 1 Monday', () => {
  const d = dayForDate(plan, '2026-08-24');
  assert.equal(d.blockId, 'prep');
  assert.equal(d.week, 1);
  assert.equal(d.dayKey, 'mon');
  assert.equal(d.weekType, 'build');
  assert.equal(d.authored, true);
});

test('prep week 4 is a recovery week', () => {
  assert.equal(dayForDate(plan, '2026-09-16').week, 4);
  assert.equal(dayForDate(plan, '2026-09-16').weekType, 'recovery');
});

test('prep to bridge boundary', () => {
  const last = dayForDate(plan, '2026-10-18');
  assert.equal(last.blockId, 'prep');
  assert.equal(last.week, 8);
  assert.equal(last.dayKey, 'sun');

  const first = dayForDate(plan, '2026-10-19');
  assert.equal(first.blockId, 'bridge');
  assert.equal(first.week, 1);
  assert.equal(first.dayKey, 'mon');
  assert.equal(first.authored, false);
  assert.equal(first.weekType, 'unauthored');
});

test('bridge to arc boundary', () => {
  assert.equal(dayForDate(plan, '2026-12-06').blockId, 'bridge');
  assert.equal(dayForDate(plan, '2026-12-06').week, 7);
  assert.equal(dayForDate(plan, '2026-12-07').blockId, 'arc');
  assert.equal(dayForDate(plan, '2026-12-07').week, 1);
});

test('race day is Arc week 26 Saturday', () => {
  const d = dayForDate(plan, '2027-06-05');
  assert.equal(d.blockId, 'arc');
  assert.equal(d.week, 26);
  assert.equal(d.dayKey, 'sat');
});

test('arc weeks carry a phase label', () => {
  assert.equal(dayForDate(plan, '2026-12-07').phaseLabel, 'Base');
  assert.equal(dayForDate(plan, '2027-02-01').phaseLabel, 'Build');
  assert.equal(dayForDate(plan, '2027-03-29').phaseLabel, 'Race-specific');
  assert.equal(dayForDate(plan, '2027-05-10').phaseLabel, 'Taper');
  assert.equal(dayForDate(plan, '2026-08-24').phaseLabel, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/plan-model.test.js
```

Expected: FAIL — `Cannot find module '../assets/plan-model.js'`.

- [ ] **Step 3: Write the implementation**

Create `assets/plan-model.js`:

```js
import { daysBetween, weekdayKey } from './date-utils.js';

function phaseFor(block, week) {
  if (!block.phases) return null;
  const p = block.phases.find(p => week >= p.from && week <= p.to);
  return p ? p.label : null;
}

export function dayForDate(plan, iso) {
  const first = plan.blocks[0];
  if (daysBetween(first.start, iso) < 0) return { inPlan: false, reason: 'before-start' };

  for (const block of plan.blocks) {
    const offset = daysBetween(block.start, iso);
    if (offset < 0 || offset >= block.weeks * 7) continue;

    const week = Math.floor(offset / 7) + 1;
    const progression = (plan.progression[block.id] || []).find(w => w.week === week);

    return {
      inPlan: true,
      blockId: block.id,
      blockLabel: block.label,
      week,
      weekType: block.authored && progression ? progression.type : 'unauthored',
      dayKey: weekdayKey(iso),
      date: iso,
      phaseLabel: phaseFor(block, week),
      authored: Boolean(block.authored && progression)
    };
  }

  return { inPlan: false, reason: 'after-end' };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/plan-model.test.js
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add assets/plan-model.js tests/plan-model.test.js
git commit -m "feat: map calendar dates onto plan blocks and weeks"
```

---

### Task 4: `resolveWeek()` — expand a week into concrete sessions

**Files:**
- Modify: `assets/plan-model.js`
- Modify: `tests/plan-model.test.js`

**Interfaces:**
- Consumes: `dayForDate()` from Task 3, `addDays` from `date-utils.js`.
- Produces: `resolveWeek(plan, blockId, week)` returning
  `{ blockId, blockLabel, week, type, authored, startDate, days: [ { dayKey, date, nutrition, sessions: [...] } ] }`.

Each session is `{ key, discipline, title, optional, prescribed: {metric, value, unit}, effort, detail: [], setLines: [] }`.
`key` is `"<blockId>:<week>:<dayKey>:<discipline>"` — the stable identifier `log.json` references.
When `authored` is false, `days` is `[]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/plan-model.test.js`:

```js
import { resolveWeek } from '../assets/plan-model.js';

test('an unauthored block resolves to an explicit placeholder, not fake sessions', () => {
  const w = resolveWeek(plan, 'bridge', 1);
  assert.equal(w.authored, false);
  assert.deepEqual(w.days, []);
  assert.equal(w.startDate, '2026-10-19');
});

test('a build week has seven dated days starting Monday', () => {
  const w = resolveWeek(plan, 'prep', 1);
  assert.equal(w.days.length, 7);
  assert.deepEqual(w.days.map(d => d.dayKey), ['mon','tue','wed','thu','fri','sat','sun']);
  assert.equal(w.days[0].date, '2026-08-24');
  assert.equal(w.days[6].date, '2026-08-30');
});

test('weekend durations come from the progression table', () => {
  const w = resolveWeek(plan, 'prep', 7);
  const sat = w.days.find(d => d.dayKey === 'sat').sessions[0];
  const sun = w.days.find(d => d.dayKey === 'sun').sessions[0];
  assert.equal(sat.prescribed.value, 135);
  assert.equal(sun.prescribed.value, 75);
});

test('session keys are stable and block-qualified', () => {
  const w = resolveWeek(plan, 'prep', 3);
  const keys = w.days.find(d => d.dayKey === 'wed').sessions.map(s => s.key);
  assert.deepEqual(keys, ['prep:3:wed:swim', 'prep:3:wed:run']);
});

test('wednesday is a brick: swim then run', () => {
  const wed = resolveWeek(plan, 'prep', 1).days.find(d => d.dayKey === 'wed');
  assert.deepEqual(wed.sessions.map(s => s.discipline), ['swim', 'run']);
});

test('recovery week cuts the tuesday bike and thursday run', () => {
  const w = resolveWeek(plan, 'prep', 4);
  assert.equal(w.type, 'recovery');
  assert.equal(w.days.find(d => d.dayKey === 'tue').sessions[0].prescribed.value, 40);
  const thu = w.days.find(d => d.dayKey === 'thu').sessions[0];
  assert.equal(thu.prescribed.value, 30);
  assert.ok(!thu.detail.some(line => line.includes('strides')), 'strides should be dropped');
});

test('recovery week cuts mon and fri swims by 500m but not wednesday', () => {
  const w = resolveWeek(plan, 'prep', 4);
  assert.equal(w.days.find(d => d.dayKey === 'mon').sessions[0].prescribed.value, 1300);
  assert.equal(w.days.find(d => d.dayKey === 'fri').sessions[0].prescribed.value, 1500);
  // Wednesday's cut is already expressed in its main set.
  assert.equal(w.days.find(d => d.dayKey === 'wed').sessions[0].prescribed.value, 1700);
});

test('recovery week drops strength entirely', () => {
  const fri = resolveWeek(plan, 'prep', 4).days.find(d => d.dayKey === 'fri');
  assert.deepEqual(fri.sessions.map(s => s.discipline), ['swim']);
  const friBuild = resolveWeek(plan, 'prep', 5).days.find(d => d.dayKey === 'fri');
  assert.deepEqual(friBuild.sessions.map(s => s.discipline), ['swim', 'strength']);
});

test('the wednesday main set advances with the week', () => {
  const setOf = n => resolveWeek(plan, 'prep', n).days.find(d => d.dayKey === 'wed')
    .sessions[0].setLines.join(' | ');
  assert.ok(setOf(1).includes('8 x 100 steady'));
  assert.ok(setOf(5).includes('5 x 200 steady'));
  assert.ok(setOf(7).includes('4 x 300 steady'));
});

test('week 8 wednesday uses the pacing-test structure only', () => {
  const wed = resolveWeek(plan, 'prep', 8).days.find(d => d.dayKey === 'wed').sessions[0];
  assert.deepEqual(wed.setLines, [
    '300 easy free',
    '1500 continuous steady - this is the pacing test',
    '200 easy cooldown'
  ]);
  assert.equal(wed.prescribed.value, 2000);
});

test('each day carries its nutrition day type', () => {
  const w = resolveWeek(plan, 'prep', 1);
  assert.equal(w.days.find(d => d.dayKey === 'mon').nutrition.label, 'Low day');
  assert.equal(w.days.find(d => d.dayKey === 'sat').nutrition.label, 'Big day');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test tests/plan-model.test.js
```

Expected: FAIL — `resolveWeek is not a function` (11 new failures).

- [ ] **Step 3: Write the implementation**

First **replace** the existing import line at the top of `assets/plan-model.js` — do not add a second import statement for the same module:

```js
import { daysBetween, weekdayKey, addDays } from './date-utils.js';
```

Then append the rest to `assets/plan-model.js`:

```js
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function swimSetLines(plan, template, dayKey, progression) {
  if (dayKey === 'mon') return [...plan.swimSets.monTechnique];
  if (dayKey === 'fri') return [...plan.swimSets.friMixed];
  if (dayKey === 'wed') {
    if (progression.wedStructureOverride) return [...progression.wedStructureOverride];
    const { warmup, cooldown } = plan.swimSets.wedMain;
    return [...warmup, `MAIN SET: ${progression.wedMainSet}`, ...cooldown];
  }
  return [];
}

function buildSession(plan, template, ctx) {
  const { blockId, week, dayKey, progression, isRecovery } = ctx;
  const s = {
    key: `${blockId}:${week}:${dayKey}:${template.discipline}`,
    discipline: template.discipline,
    title: template.title,
    optional: Boolean(template.optional),
    effort: template.effort,
    detail: [...(template.detail || [])],
    setLines: [],
    prescribed: { ...template.prescribed }
  };

  // Weekend long sessions read their duration from the progression table.
  if (template.prescribed.fromProgression) {
    s.prescribed.value = progression[template.prescribed.fromProgression];
    delete s.prescribed.fromProgression;
  }

  if (template.discipline === 'swim') {
    if (dayKey === 'wed') s.prescribed.value = progression.wedDistance;
    else if (isRecovery && plan.recovery.swimDeltaAppliesTo.includes(dayKey)) {
      s.prescribed.value += plan.recovery.swimDeltaMetres;
    }
    s.setLines = swimSetLines(plan, template, dayKey, progression);
  }

  if (template.setRef === 'strength') s.setLines = [...plan.swimSets.strength];

  if (isRecovery) {
    if (dayKey === 'tue') s.prescribed.value = plan.recovery.tue.durationMin;
    if (dayKey === 'thu') {
      s.prescribed.value = plan.recovery.thu.durationMin;
      if (plan.recovery.thu.dropStrides) {
        s.detail = s.detail.filter(line => !line.toLowerCase().includes('stride'));
      }
    }
  }

  return s;
}

export function resolveWeek(plan, blockId, week) {
  const block = plan.blocks.find(b => b.id === blockId);
  const progression = (plan.progression[blockId] || []).find(w => w.week === week);
  const startDate = addDays(block.start, (week - 1) * 7);

  if (!block.authored || !progression) {
    return {
      blockId, blockLabel: block.label, week,
      type: 'unauthored', authored: false, startDate, days: [],
      note: block.note
    };
  }

  const isRecovery = progression.type === 'recovery';

  const days = DAY_KEYS.map((dayKey, i) => {
    let templates = plan.skeleton[dayKey];
    if (isRecovery && plan.recovery.skipStrength) {
      templates = templates.filter(t => t.discipline !== 'strength');
    }
    const typeKey = plan.nutrition.dayTypes[dayKey];
    return {
      dayKey,
      date: addDays(startDate, i),
      nutrition: plan.nutrition.types[typeKey],
      sessions: templates.map(t =>
        buildSession(plan, t, { blockId, week, dayKey, progression, isRecovery }))
    };
  });

  return {
    blockId, blockLabel: block.label, week,
    type: progression.type, authored: true, startDate, days
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/plan-model.test.js
```

Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add assets/plan-model.js tests/plan-model.test.js
git commit -m "feat: resolve plan weeks into dated sessions with recovery overrides"
```

---

### Task 5: `log-model.js` — matching, status, merging, completion

**Files:**
- Create: `assets/log-model.js`
- Test: `tests/log-model.test.js`

**Interfaces:**
- Consumes: nothing (pure; takes resolved days and raw activity objects).
- Produces:
  - `DISCIPLINE_BY_STRAVA_TYPE` — object map.
  - `statusFor(session, activity) -> 'done'|'partial'|'missed'`
  - `matchDay(resolvedDay, activities, opts) -> entry[]`
  - `mergeEntries(existing, incoming) -> entry[]`
  - `weekCompletion(resolvedWeek, entries) -> { done, planned, pct }` where `pct` is `null` for a week with no elapsed days.

A Strava activity is `{ id, type, moving_time (seconds), distance (metres), start_date_local, name }`.
An entry is `{ date, planKey, status, strava|null, note }`.

- [ ] **Step 1: Write the failing test**

Create `tests/log-model.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveWeek } from '../assets/plan-model.js';
import { statusFor, matchDay, mergeEntries, weekCompletion } from '../assets/log-model.js';

const plan = JSON.parse(readFileSync(new URL('../data/plan.json', import.meta.url)));
const week1 = resolveWeek(plan, 'prep', 1);
const dayOf = (w, k) => w.days.find(d => d.dayKey === k);

const ride = (secs, id = 1) => ({ id, type: 'Ride', moving_time: secs, distance: 30000, start_date_local: '2026-08-29T07:00:00Z', name: 'Long ride' });
const swim = (metres, id = 2) => ({ id, type: 'Swim', moving_time: 2400, distance: metres, start_date_local: '2026-08-26T06:00:00Z', name: 'Pool swim' });
const run  = (secs, id = 3) => ({ id, type: 'Run', moving_time: secs, distance: 5000, start_date_local: '2026-08-26T07:30:00Z', name: 'Brick run' });

test('bike and run are judged on moving time', () => {
  const sat = dayOf(week1, 'sat').sessions[0];        // 90 min prescribed
  assert.equal(statusFor(sat, ride(90 * 60)), 'done');
  assert.equal(statusFor(sat, ride(77 * 60)), 'done');      // 85.5%
  assert.equal(statusFor(sat, ride(60 * 60)), 'partial');   // 66.7%
  assert.equal(statusFor(sat, ride(20 * 60)), 'missed');    // 22.2%
});

test('swims are judged on distance, not time', () => {
  const wedSwim = dayOf(week1, 'wed').sessions[0];    // 2000 m prescribed
  assert.equal(statusFor(wedSwim, swim(2000)), 'done');
  assert.equal(statusFor(wedSwim, swim(1200)), 'partial');  // 60%
  assert.equal(statusFor(wedSwim, swim(600)), 'missed');    // 30%
});

test('thresholds are inclusive at the boundary', () => {
  const sat = dayOf(week1, 'sat').sessions[0];        // 90 min = 5400s
  assert.equal(statusFor(sat, ride(0.85 * 5400)), 'done');
  assert.equal(statusFor(sat, ride(0.40 * 5400)), 'partial');
});

test('no activity means missed', () => {
  assert.equal(statusFor(dayOf(week1, 'sat').sessions[0], null), 'missed');
});

test('a brick day matches two activities to two sessions', () => {
  const entries = matchDay(dayOf(week1, 'wed'), [swim(2000), run(30 * 60)], { elapsed: true });
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(e => e.planKey), ['prep:1:wed:swim', 'prep:1:wed:run']);
  assert.ok(entries.every(e => e.status === 'done'));
});

test('an unmatched activity becomes an extra entry, never dropped', () => {
  const yoga = { id: 99, type: 'Yoga', moving_time: 1800, distance: 0, start_date_local: '2026-08-25T18:00:00Z', name: 'Yoga' };
  const entries = matchDay(dayOf(week1, 'tue'), [ride(60 * 60), yoga], { elapsed: true });
  const extra = entries.find(e => e.status === 'extra');
  assert.ok(extra, 'yoga should be recorded as extra');
  assert.equal(extra.strava.id, 99);
  assert.equal(extra.planKey, null);
});

test('optional sessions are never marked missed', () => {
  const entries = matchDay(dayOf(week1, 'mon'), [], { elapsed: true });
  assert.deepEqual(entries, []);
});

test('a day that has not elapsed produces no missed entries', () => {
  const entries = matchDay(dayOf(week1, 'sat'), [], { elapsed: false });
  assert.deepEqual(entries, []);
});

test('two activities of one discipline match one session and one extra', () => {
  const entries = matchDay(dayOf(week1, 'tue'), [ride(60 * 60, 10), ride(20 * 60, 11)], { elapsed: true });
  assert.equal(entries.filter(e => e.status === 'done').length, 1);
  assert.equal(entries.filter(e => e.status === 'extra').length, 1);
});

test('merging is idempotent by strava id', () => {
  const a = [{ date: '2026-08-25', planKey: 'prep:1:tue:bike', status: 'done', strava: { id: 5 }, note: '' }];
  const b = [{ date: '2026-08-25', planKey: 'prep:1:tue:bike', status: 'done', strava: { id: 5 }, note: '' }];
  assert.equal(mergeEntries(a, b).length, 1);
});

test('merging replaces a missed entry when the activity later appears', () => {
  const existing = [{ date: '2026-08-25', planKey: 'prep:1:tue:bike', status: 'missed', strava: null, note: '' }];
  const incoming = [{ date: '2026-08-25', planKey: 'prep:1:tue:bike', status: 'done', strava: { id: 7 }, note: '' }];
  const merged = mergeEntries(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'done');
});

test('merging preserves hand-written notes on the existing entry', () => {
  const existing = [{ date: '2026-08-25', planKey: 'prep:1:tue:bike', status: 'missed', strava: null, note: 'legs were dead' }];
  const incoming = [{ date: '2026-08-25', planKey: 'prep:1:tue:bike', status: 'done', strava: { id: 7 }, note: '' }];
  assert.equal(mergeEntries(existing, incoming)[0].note, 'legs were dead');
});

test('completion counts done and partial over non-optional sessions', () => {
  // Week 1 non-optional sessions: tue bike, wed swim, wed run, thu run, fri swim, sat bike, sun run = 7
  const entries = [
    { date: '2026-08-25', planKey: 'prep:1:tue:bike', status: 'done', strava: { id: 1 }, note: '' },
    { date: '2026-08-26', planKey: 'prep:1:wed:swim', status: 'partial', strava: { id: 2 }, note: '' },
    { date: '2026-08-27', planKey: 'prep:1:thu:run',  status: 'missed', strava: null, note: '' }
  ];
  const c = weekCompletion(week1, entries);
  assert.equal(c.planned, 7);
  assert.equal(c.done, 2);
  assert.equal(c.pct, Math.round((2 / 7) * 100));
});

test('a week with no entries at all reports null, not zero', () => {
  assert.equal(weekCompletion(week1, []).pct, null);
});

test('an unauthored week reports null completion', () => {
  assert.equal(weekCompletion(resolveWeek(plan, 'bridge', 1), []).pct, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/log-model.test.js
```

Expected: FAIL — `Cannot find module '../assets/log-model.js'`.

- [ ] **Step 3: Write the implementation**

Create `assets/log-model.js`:

```js
export const DISCIPLINE_BY_STRAVA_TYPE = {
  Swim: 'swim',
  Ride: 'bike',
  VirtualRide: 'bike',
  GravelRide: 'bike',
  MountainBikeRide: 'bike',
  Run: 'run',
  TrailRun: 'run',
  VirtualRun: 'run',
  WeightTraining: 'strength',
  Workout: 'strength'
};

const DONE_AT = 0.85;
const PARTIAL_AT = 0.40;

function actualFor(session, activity) {
  return session.prescribed.metric === 'distance'
    ? activity.distance                       // metres
    : activity.moving_time / 60;              // minutes
}

export function statusFor(session, activity) {
  if (!activity) return 'missed';
  const ratio = actualFor(session, activity) / session.prescribed.value;
  if (ratio >= DONE_AT) return 'done';
  if (ratio >= PARTIAL_AT) return 'partial';
  return 'missed';
}

export function matchDay(resolvedDay, activities, opts = {}) {
  const elapsed = Boolean(opts.elapsed);
  const pool = activities.map(a => ({ activity: a, used: false }));
  const entries = [];

  for (const session of resolvedDay.sessions) {
    const slot = pool.find(p =>
      !p.used && DISCIPLINE_BY_STRAVA_TYPE[p.activity.type] === session.discipline);

    if (slot) {
      slot.used = true;
      entries.push({
        date: resolvedDay.date,
        planKey: session.key,
        status: statusFor(session, slot.activity),
        strava: summarise(slot.activity),
        note: ''
      });
    } else if (elapsed && !session.optional) {
      entries.push({
        date: resolvedDay.date,
        planKey: session.key,
        status: 'missed',
        strava: null,
        note: ''
      });
    }
  }

  for (const p of pool) {
    if (p.used) continue;
    entries.push({
      date: resolvedDay.date,
      planKey: null,
      status: 'extra',
      strava: summarise(p.activity),
      note: ''
    });
  }

  return entries;
}

function summarise(a) {
  return {
    id: a.id,
    type: a.type,
    name: a.name,
    movingTime: a.moving_time,
    distance: a.distance,
    avgHr: a.average_heartrate ?? null,
    url: `https://www.strava.com/activities/${a.id}`
  };
}

// Identity: a Strava id when there is one, otherwise date + planKey.
// This lets a 'missed' placeholder be replaced by the real activity later.
function identity(entry) {
  return entry.strava ? `strava:${entry.strava.id}` : `plan:${entry.date}:${entry.planKey}`;
}

export function mergeEntries(existing, incoming) {
  const out = [...existing];

  for (const entry of incoming) {
    const byId = entry.strava
      ? out.findIndex(e => e.strava && e.strava.id === entry.strava.id)
      : -1;
    const bySlot = entry.planKey
      ? out.findIndex(e => e.date === entry.date && e.planKey === entry.planKey)
      : -1;
    const at = byId !== -1 ? byId : bySlot;

    if (at === -1) {
      out.push(entry);
    } else {
      // Hand-written notes survive a resync.
      out[at] = { ...entry, note: out[at].note || entry.note };
    }
  }

  return out.sort((a, b) =>
    a.date === b.date ? identity(a).localeCompare(identity(b)) : a.date.localeCompare(b.date));
}

export function weekCompletion(resolvedWeek, entries) {
  if (!resolvedWeek.authored) return { done: 0, planned: 0, pct: null };

  const keys = new Set();
  for (const day of resolvedWeek.days) {
    for (const s of day.sessions) if (!s.optional) keys.add(s.key);
  }

  const relevant = entries.filter(e => keys.has(e.planKey));
  if (relevant.length === 0) return { done: 0, planned: keys.size, pct: null };

  const done = relevant.filter(e => e.status === 'done' || e.status === 'partial').length;
  return { done, planned: keys.size, pct: Math.round((done / keys.size) * 100) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/log-model.test.js
```

Expected: PASS, 15 tests.

- [ ] **Step 5: Run the whole suite**

```bash
npm test
```

Expected: PASS, 48 tests across four files.

- [ ] **Step 6: Commit**

```bash
git add assets/log-model.js tests/log-model.test.js
git commit -m "feat: match Strava activities to planned sessions and score them"
```

---

### Task 6: Page shell, styling, and the Today view

**Files:**
- Create: `index.html`
- Create: `assets/app.css`
- Create: `assets/render.js`
- Create: `data/log.json`
- Create: `data/sync-status.json`

**Interfaces:**
- Consumes: `resolveWeek`, `dayForDate` (Task 3/4); `weekCompletion` (Task 5).
- Produces: `renderToday(ctx) -> HTMLElement`, where
  `ctx = { plan, day, week, entriesByKey, extras, today }`.
  `entriesByKey` is a `Map<planKey, entry>`; `extras` is an array of `extra` entries for that date.

Rendering is verified by looking at it, not by tests.

- [ ] **Step 1: Create the empty data files**

`data/log.json`:

```json
{ "entries": [] }
```

`data/sync-status.json`:

```json
{
  "lastRun": null,
  "lastSuccess": null,
  "ok": false,
  "reason": "never-run",
  "activitiesFound": 0
}
```

- [ ] **Step 2: Create `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>70.3 Training</title>
  <link rel="stylesheet" href="assets/app.css">
</head>
<body>
  <header class="topbar">
    <div class="brand">70.3</div>
    <nav class="views">
      <a href="#/today" data-view="today">Today</a>
      <a href="#/week" data-view="week">Week</a>
      <a href="#/season" data-view="season">Season</a>
    </nav>
    <div class="countdown" id="countdown"></div>
  </header>

  <div id="banner" class="banner" hidden></div>
  <main id="main">Loading…</main>

  <script type="module" src="assets/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `assets/app.css`**

```css
:root {
  --bg: #12141a;
  --card: #1a1d25;
  --line: #2a2f3a;
  --text: #e6e8ee;
  --dim: #9aa1b1;
  --swim: #4aa3df;
  --bike: #e2a03f;
  --run: #6bbf59;
  --strength: #a97bd6;
  --done: #6bbf59;
  --partial: #e2a03f;
  --missed: #d1495b;
  --warn: #e2a03f;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}

.topbar {
  display: flex; align-items: center; gap: 1rem;
  padding: .75rem 1rem;
  border-bottom: 1px solid var(--line);
  position: sticky; top: 0; background: var(--bg); z-index: 2;
}
.brand { font-weight: 700; letter-spacing: .05em; }
.views { display: flex; gap: .25rem; margin-left: auto; }
.views a {
  color: var(--dim); text-decoration: none;
  padding: .35rem .7rem; border-radius: 999px; font-size: .9rem;
}
.views a.active { color: var(--text); background: var(--card); }
.countdown { color: var(--dim); font-size: .85rem; white-space: nowrap; }

.banner {
  margin: .75rem 1rem 0; padding: .6rem .8rem;
  border: 1px solid var(--warn); border-left-width: 4px;
  border-radius: 6px; color: var(--warn); font-size: .9rem;
}

main { padding: 1rem; max-width: 780px; margin: 0 auto; }

.daymeta { color: var(--dim); font-size: .9rem; }
h1 { font-size: 1.4rem; margin: .2rem 0 1rem; }

.card {
  background: var(--card); border: 1px solid var(--line);
  border-radius: 10px; padding: 1rem; margin-bottom: 1rem;
  border-left: 4px solid var(--line);
}
.card.swim { border-left-color: var(--swim); }
.card.bike { border-left-color: var(--bike); }
.card.run { border-left-color: var(--run); }
.card.strength { border-left-color: var(--strength); }

.card h2 { margin: 0; font-size: 1.05rem; display: flex; align-items: center; gap: .5rem; }
.prescribed { margin-left: auto; color: var(--dim); font-weight: 400; font-size: .9rem; }
.effort { color: var(--dim); font-size: .9rem; margin: .4rem 0 .6rem; }
.setlines { margin: .5rem 0; padding-left: 1.1rem; }
.setlines li { margin: .15rem 0; }
.detail { color: var(--dim); font-size: .9rem; margin: .5rem 0 0; padding-left: 1.1rem; }

.tag {
  font-size: .72rem; text-transform: uppercase; letter-spacing: .06em;
  padding: .15rem .45rem; border-radius: 4px; border: 1px solid currentColor;
}
.tag.done { color: var(--done); }
.tag.partial { color: var(--partial); }
.tag.missed { color: var(--missed); }
.tag.optional { color: var(--dim); }
.tag.recovery { color: var(--swim); }

.actual { margin-top: .6rem; padding-top: .6rem; border-top: 1px dashed var(--line); font-size: .9rem; }
.actual a { color: var(--swim); }

.placeholder { color: var(--dim); font-style: italic; }

.weekgrid { display: grid; grid-template-columns: repeat(7, 1fr); gap: .5rem; }
.weekgrid .cell {
  background: var(--card); border: 1px solid var(--line); border-radius: 8px;
  padding: .5rem; min-height: 88px; font-size: .8rem;
}
.weekgrid .cell.today { border-color: var(--text); }
.weekgrid .cell .dow { color: var(--dim); text-transform: uppercase; font-size: .7rem; }
.dot { display: inline-block; width: .5rem; height: .5rem; border-radius: 50%; }
.dot.done { background: var(--done); }
.dot.partial { background: var(--partial); }
.dot.missed { background: var(--missed); }

.season { display: flex; flex-direction: column; gap: .35rem; }
.seasonrow { display: flex; align-items: center; gap: .5rem; font-size: .85rem; }
.seasonrow .bar { height: .55rem; border-radius: 3px; background: var(--line); flex: 1; }
.seasonrow .bar > span { display: block; height: 100%; border-radius: 3px; background: var(--done); }
.seasonrow.recovery .label { color: var(--swim); }
.seasonrow.current { outline: 1px solid var(--text); outline-offset: 3px; border-radius: 4px; }
.blockhead { margin: 1rem 0 .35rem; color: var(--dim); font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; }

@media (max-width: 620px) {
  .weekgrid { grid-template-columns: repeat(2, 1fr); }
  .countdown { display: none; }
}
```

- [ ] **Step 4: Create `assets/render.js` with the Today view**

```js
const DOW = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
              fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function prescribedText(p) {
  return p.metric === 'distance' ? `${p.value.toLocaleString()} m` : `${p.value} min`;
}

function actualText(strava, metric) {
  const mins = Math.round(strava.movingTime / 60);
  const parts = metric === 'distance'
    ? [`${Math.round(strava.distance).toLocaleString()} m`, `${mins} min`]
    : [`${mins} min`, `${(strava.distance / 1000).toFixed(1)} km`];
  if (strava.avgHr) parts.push(`${Math.round(strava.avgHr)} bpm avg`);
  return parts.join(' · ');
}

function sessionCard(session, entry) {
  const status = entry ? entry.status : null;

  const head = el('h2', {}, [
    session.title,
    session.optional ? el('span', { class: 'tag optional' }, 'optional') : null,
    status ? el('span', { class: `tag ${status}` }, status) : null,
    el('span', { class: 'prescribed' }, prescribedText(session.prescribed))
  ]);

  const body = [head, el('p', { class: 'effort' }, session.effort)];

  if (session.setLines.length) {
    body.push(el('ol', { class: 'setlines' }, session.setLines.map(l => el('li', {}, l))));
  }
  if (session.detail.length) {
    body.push(el('ul', { class: 'detail' }, session.detail.map(d => el('li', {}, d))));
  }
  if (entry && entry.strava) {
    body.push(el('div', { class: 'actual' }, [
      'Recorded: ',
      actualText(entry.strava, session.prescribed.metric),
      ' — ',
      el('a', { href: entry.strava.url, target: '_blank', rel: 'noopener' }, 'Strava')
    ]));
  }

  return el('section', { class: `card ${session.discipline}` }, body);
}

export function renderToday(ctx) {
  const { plan, day, week, entriesByKey, extras } = ctx;
  const out = el('div');

  if (!day.inPlan) {
    const msg = day.reason === 'before-start'
      ? `Plan starts ${plan.blocks[0].start}.`
      : 'Past the end of the plan.';
    out.append(el('h1', {}, 'Not in the plan'), el('p', { class: 'placeholder' }, msg));
    return out;
  }

  const label = [
    `${day.blockLabel} W${day.week}`,
    day.phaseLabel,
    day.weekType === 'recovery' ? 'recovery week' : null,
    day.date
  ].filter(Boolean).join(' · ');

  out.append(el('p', { class: 'daymeta' }, label));
  out.append(el('h1', {}, DOW[day.dayKey]));

  if (!day.authored) {
    out.append(el('p', { class: 'placeholder' },
      'This block has not been written yet. Nothing prescribed for today.'));
    return out;
  }

  const resolved = week.days.find(d => d.dayKey === day.dayKey);

  for (const session of resolved.sessions) {
    out.append(sessionCard(session, entriesByKey.get(session.key)));
  }

  out.append(el('section', { class: 'card' }, [
    el('h2', {}, ['Nutrition', el('span', { class: 'prescribed' }, resolved.nutrition.label)]),
    el('p', { class: 'effort' }, resolved.nutrition.approach),
    el('ul', { class: 'detail' }, plan.nutrition.nonNegotiables.map(n => el('li', {}, n)))
  ]));

  if (extras.length) {
    out.append(el('section', { class: 'card' }, [
      el('h2', {}, 'Not on the plan'),
      el('ul', { class: 'detail' }, extras.map(e =>
        el('li', {}, `${e.strava.name} — ${Math.round(e.strava.movingTime / 60)} min`)))
    ]));
  }

  return out;
}
```

- [ ] **Step 5: Verify by eye**

```bash
python -m http.server 8000
```

Open `http://localhost:8000/#/today`. Nothing renders yet — `app.js` does not exist until Task 8. Confirm only that the page loads, the CSS applies, and the console shows a 404 for `assets/app.js` and nothing else.

- [ ] **Step 6: Commit**

```bash
git add index.html assets/app.css assets/render.js data/log.json data/sync-status.json
git commit -m "feat: add page shell, styles, and today view renderer"
```

---

### Task 7: Week and Season views

**Files:**
- Modify: `assets/render.js`

**Interfaces:**
- Consumes: `resolveWeek`, `weekCompletion`, `el()` and `prescribedText()` from Task 6.
- Produces: `renderWeek(ctx) -> HTMLElement` and `renderSeason(ctx) -> HTMLElement`.
  `renderWeek` takes `{ plan, week, entriesByKey, today, nav: { prev, next } }` where `prev`/`next` are `{ blockId, week }` or `null`.
  `renderSeason` takes `{ plan, entries, today, resolveWeek, weekCompletion }`.

- [ ] **Step 1: Append `renderWeek` to `assets/render.js`**

```js
const DOW_SHORT = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu',
                    fri: 'Fri', sat: 'Sat', sun: 'Sun' };

export function renderWeek(ctx) {
  const { week, entriesByKey, today, nav } = ctx;
  const out = el('div');

  const title = [
    `${week.blockLabel} W${week.week}`,
    week.type === 'recovery' ? 'recovery week' : null
  ].filter(Boolean).join(' · ');

  out.append(el('div', { class: 'daymeta' }, [
    nav.prev ? el('a', { href: `#/week/${nav.prev.blockId}/${nav.prev.week}` }, '← prev') : null,
    ' ',
    nav.next ? el('a', { href: `#/week/${nav.next.blockId}/${nav.next.week}` }, 'next →') : null
  ]));
  out.append(el('h1', {}, title));

  if (!week.authored) {
    out.append(el('p', { class: 'placeholder' },
      `Week of ${week.startDate}. Not written yet — ${week.note || ''}`));
    return out;
  }

  const grid = el('div', { class: 'weekgrid' });

  for (const day of week.days) {
    const cell = el('div', { class: `cell${day.date === today ? ' today' : ''}` }, [
      el('div', { class: 'dow' }, `${DOW_SHORT[day.dayKey]} ${day.date.slice(8)}`)
    ]);

    for (const s of day.sessions) {
      const entry = entriesByKey.get(s.key);
      cell.append(el('div', {}, [
        entry ? el('span', { class: `dot ${entry.status}` }) : el('span', { class: 'dot' }),
        ` ${s.discipline} ${prescribedText(s.prescribed)}`
      ]));
    }

    grid.append(cell);
  }

  out.append(grid);
  return out;
}
```

- [ ] **Step 2: Append `renderSeason` to `assets/render.js`**

```js
export function renderSeason(ctx) {
  const { plan, entries, today, resolveWeek, weekCompletion } = ctx;
  const out = el('div');
  out.append(el('h1', {}, 'Season'));

  const todayWeekStart = w => w.startDate <= today && today < addDaysLocal(w.startDate, 7);

  for (const block of plan.blocks) {
    out.append(el('div', { class: 'blockhead' },
      `${block.label} — ${block.weeks} weeks from ${block.start}`));

    const list = el('div', { class: 'season' });

    for (let n = 1; n <= block.weeks; n++) {
      const week = resolveWeek(plan, block.id, n);
      const c = weekCompletion(week, entries);
      const phase = block.phases
        ? (block.phases.find(p => n >= p.from && n <= p.to) || {}).label
        : null;

      const classes = ['seasonrow'];
      if (week.type === 'recovery') classes.push('recovery');
      if (todayWeekStart(week)) classes.push('current');

      list.append(el('div', { class: classes.join(' ') }, [
        el('span', { class: 'label' },
          `W${n}${week.type === 'recovery' ? ' ↓' : ''}`),
        el('span', { class: 'daymeta' }, week.startDate),
        phase ? el('span', { class: 'daymeta' }, phase) : null,
        el('span', { class: 'bar' }, el('span', { style: `width:${c.pct ?? 0}%` })),
        el('span', { class: 'daymeta' }, c.pct === null ? '—' : `${c.pct}%`)
      ]));
    }

    out.append(list);
  }

  return out;
}

// Local helper so render.js does not import date-utils just for one call.
function addDaysLocal(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);
}
```

- [ ] **Step 3: Commit**

```bash
git add assets/render.js
git commit -m "feat: add week grid and season overview renderers"
```

---

### Task 8: Bootstrap, routing, and staleness banners

**Files:**
- Create: `assets/app.js`

**Interfaces:**
- Consumes: everything from Tasks 1, 3, 4, 5, 6, 7.
- Produces: the running application. No exports.

Behaviour required by the spec:
- `plan.json` failing to load is fatal; anything else degrades.
- `log.json` failing to load renders the plan anyway with a banner.
- `sync-status.lastSuccess` older than 36 hours shows an amber staleness banner.
- `sync-status.ok === false` shows the failure reason.

- [ ] **Step 1: Create `assets/app.js`**

```js
import { dayForDate, resolveWeek } from './plan-model.js';
import { weekCompletion } from './log-model.js';
import { renderToday, renderWeek, renderSeason } from './render.js';
import { daysBetween } from './date-utils.js';

const STALE_HOURS = 36;

const main = document.getElementById('main');
const bannerEl = document.getElementById('banner');
const countdownEl = document.getElementById('countdown');

function todayISO() {
  // Local calendar date, formatted without touching UTC.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function loadJSON(path) {
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

function banner(messages) {
  if (!messages.length) { bannerEl.hidden = true; return; }
  bannerEl.hidden = false;
  bannerEl.textContent = messages.join('  ·  ');
}

function hoursSince(isoTimestamp) {
  return (Date.now() - new Date(isoTimestamp).getTime()) / 3600000;
}

function syncMessages(status, logFailed) {
  const msgs = [];
  if (logFailed) msgs.push('Training log unavailable — showing the plan only.');
  if (!status) return msgs;

  if (status.reason === 'never-run') {
    msgs.push('Nightly Strava sync has never run. Completed sessions will stay blank.');
  } else if (!status.ok) {
    msgs.push(`Last sync failed (${status.reason}). Data may be incomplete — this is not a rest day.`);
  } else if (status.lastSuccess && hoursSince(status.lastSuccess) > STALE_HOURS) {
    msgs.push(`Last successful sync ${Math.round(hoursSince(status.lastSuccess) / 24)} days ago. Data may be stale.`);
  }
  return msgs;
}

function indexEntries(entries, date) {
  const byKey = new Map();
  const extras = [];
  for (const e of entries) {
    if (e.status === 'extra') { if (e.date === date) extras.push(e); continue; }
    byKey.set(e.planKey, e);
  }
  return { byKey, extras };
}

function weekNav(plan, blockId, week) {
  const flat = [];
  for (const b of plan.blocks) {
    for (let n = 1; n <= b.weeks; n++) flat.push({ blockId: b.id, week: n });
  }
  const i = flat.findIndex(x => x.blockId === blockId && x.week === week);
  return { prev: flat[i - 1] || null, next: flat[i + 1] || null };
}

function route() {
  const hash = location.hash || '#/today';
  const parts = hash.replace(/^#\//, '').split('/');
  return { view: parts[0] || 'today', blockId: parts[1], week: Number(parts[2]) };
}

function setActiveNav(view) {
  for (const a of document.querySelectorAll('.views a')) {
    a.classList.toggle('active', a.dataset.view === view);
  }
}

async function start() {
  let plan;
  try {
    plan = await loadJSON('data/plan.json');
  } catch (err) {
    main.textContent = `Could not load the plan: ${err.message}`;
    return;
  }

  let log = { entries: [] };
  let logFailed = false;
  try { log = await loadJSON('data/log.json'); } catch { logFailed = true; }

  let status = null;
  try { status = await loadJSON('data/sync-status.json'); } catch { /* banner covers it */ }

  banner(syncMessages(status, logFailed));

  const today = todayISO();
  const daysToRace = daysBetween(today, plan.race.date);
  countdownEl.textContent = daysToRace >= 0
    ? `${daysToRace} days to ${plan.race.date}`
    : 'race day passed';

  function draw() {
    const r = route();
    setActiveNav(r.view);
    const day = dayForDate(plan, today);
    const { byKey, extras } = indexEntries(log.entries, today);

    main.replaceChildren();

    if (r.view === 'season') {
      main.append(renderSeason({ plan, entries: log.entries, today, resolveWeek, weekCompletion }));
      return;
    }

    if (r.view === 'week') {
      const blockId = r.blockId || (day.inPlan ? day.blockId : plan.blocks[0].id);
      const week = r.week || (day.inPlan ? day.week : 1);
      main.append(renderWeek({
        plan,
        week: resolveWeek(plan, blockId, week),
        entriesByKey: byKey,
        today,
        nav: weekNav(plan, blockId, week)
      }));
      return;
    }

    const week = day.inPlan && day.authored
      ? resolveWeek(plan, day.blockId, day.week)
      : { days: [] };
    main.append(renderToday({ plan, day, week, entriesByKey: byKey, extras, today }));
  }

  window.addEventListener('hashchange', draw);
  draw();
}

start();
```

- [ ] **Step 2: Verify all three views by eye**

```bash
python -m http.server 8000
```

Check each of these:
- `#/today` — before 2026-08-24 it must say the plan has not started, naming the start date.
- `#/week` — Prep W1 grid, seven cells, correct durations (Sat 90 min, Sun 50 min).
- `#/week/prep/4` — recovery week: Tue 40 min, Thu 30 min, Mon swim 1,300 m, Fri swim 1,500 m, no strength.
- `#/week/bridge/1` — placeholder text, no fabricated sessions.
- `#/season` — 41 rows across three blocks, all completion figures `—`.
- The amber banner reads "Nightly Strava sync has never run."
- Console has no errors.

- [ ] **Step 3: Verify with fixture data**

Temporarily replace `data/log.json` with:

```json
{ "entries": [
  { "date": "2026-08-25", "planKey": "prep:1:tue:bike", "status": "done",
    "strava": { "id": 1, "type": "Ride", "name": "Evening ride", "movingTime": 3600, "distance": 28000, "avgHr": 138, "url": "https://www.strava.com/activities/1" }, "note": "" },
  { "date": "2026-08-26", "planKey": "prep:1:wed:swim", "status": "partial",
    "strava": { "id": 2, "type": "Swim", "name": "Pool", "movingTime": 2100, "distance": 1400, "avgHr": null, "url": "https://www.strava.com/activities/2" }, "note": "" },
  { "date": "2026-08-26", "planKey": null, "status": "extra",
    "strava": { "id": 3, "type": "Yoga", "name": "Yoga", "movingTime": 1800, "distance": 0, "avgHr": null, "url": "https://www.strava.com/activities/3" }, "note": "" }
] }
```

Confirm `#/week/prep/1` shows a green dot on Tuesday and an amber dot on Wednesday's swim, and `#/season` shows a non-zero Prep W1 bar. Then restore `data/log.json` to `{ "entries": [] }`.

- [ ] **Step 4: Commit**

```bash
git add assets/app.js
git commit -m "feat: wire data loading, routing, and staleness banners"
```

---

### Task 9: The sync runbook

**Files:**
- Create: `scripts/sync-runbook.md`

**Interfaces:**
- Consumes: `data/plan.json`, `data/log.json`, and the same matching rules implemented in `assets/log-model.js`.
- Produces: updated `data/log.json` and `data/sync-status.json`, committed and pushed.

This file is the instruction set the scheduled task follows. It is read by Claude, not executed.

- [ ] **Step 1: Create `scripts/sync-runbook.md`**

````markdown
# Strava sync runbook

Run by the nightly scheduled task, and manually on request ("sync last 7 days").
Working directory: the repo root.

## Inputs

- Default target: **yesterday**, local date.
- On request, an explicit date or inclusive date range.

## Steps

1. **Read `data/plan.json`.** For each target date, work out the block, week, day key,
   and prescribed sessions. The rules are implemented in `assets/plan-model.js` — if you
   are unsure, run `node -e` against `resolveWeek` rather than re-deriving them by hand.

2. **Query Strava MCP** for activities on the target date. Use the activity's
   `start_date_local` to decide which date it belongs to. Never use a UTC timestamp.

3. **Match** activities to sessions by discipline:
   `Swim → swim`, `Ride/VirtualRide/GravelRide/MountainBikeRide → bike`,
   `Run/TrailRun/VirtualRun → run`, `WeightTraining/Workout → strength`.
   Wednesday is a brick and expects two activities. Match in session order; the first
   unused activity of a matching discipline wins.

4. **Score** each matched session against its prescribed metric — swims on distance,
   bike and run on moving time:
   - `done` at ≥85%
   - `partial` at 40–85%
   - `missed` below 40%, or when a non-optional session has no activity
   Optional sessions (Monday swim, Friday strength) are never `missed`; if there is no
   activity, write no entry at all.

5. **Record leftovers.** Any activity that matched no session becomes an entry with
   `planKey: null` and `status: "extra"`. Never discard an activity.

6. **Merge into `data/log.json`.** Identity is the Strava activity id when present,
   otherwise `date` + `planKey`. Re-running a date must not duplicate entries, and must
   not overwrite a non-empty `note` on an existing entry.

7. **Write `data/sync-status.json`:**

   ```json
   { "lastRun": "<ISO timestamp>", "lastSuccess": "<ISO timestamp or previous value>",
     "ok": true, "reason": null, "activitiesFound": 2 }
   ```

8. **Commit and push:**

   ```bash
   git add data/log.json data/sync-status.json
   git commit -m "chore: sync Strava activities for <date>"
   git push
   ```

## If Strava is unreachable

The connector is interactively authenticated and may be absent in a headless run.
If the Strava MCP tools are not available, or a call fails:

- **Write no log entries.** A gap in data must never be recorded as a missed workout.
- Write `data/sync-status.json` with `"ok": false` and `"reason": "strava-unreachable"`,
  leaving `lastSuccess` at its previous value.
- Commit and push that status file anyway, so the site can show the staleness banner.
- Report the failure in the task output.

## If git push fails

Nothing is lost. Report it and stop — the next successful run recommits.
````

- [ ] **Step 2: Commit**

```bash
git add scripts/sync-runbook.md
git commit -m "docs: add Strava sync runbook for the nightly task"
```

---

### Task 10: Publish to GitHub Pages and schedule the sync

**Files:**
- Create: `README.md`
- Create: `.gitignore`

**Interfaces:**
- Consumes: the complete working site from Tasks 1–9.
- Produces: a live Pages URL and a scheduled task.

**Gate — resolve before creating the repo.** `70.3-training-context-handoff.md` is committed and contains weight-loss targets, calorie deficits, and health guardrails. On a public repo that is world-readable and indexable. Ask which the user wants:
- public repo, personal `.md` files removed from git (the site does not read them — only `data/plan.json`);
- public repo, everything as-is;
- private repo (Pages from private repos needs a paid GitHub plan).

Do not create the repo before this is answered.

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
.DS_Store
```

- [ ] **Step 2: Create `README.md`**

```markdown
# 70.3 Training Tracker

Static training site for an Ironman 70.3 on 2027-06-05. No build step, no dependencies.

## What is here

- `data/plan.json` — the plan. The only file to edit when training changes.
- `data/log.json` — what actually happened. Written by the nightly Strava sync.
- `assets/` — ES modules, loaded directly by the browser and importable by `node --test`.
- `scripts/sync-runbook.md` — what the nightly sync does.

## Calendar

| Block | Weeks | Start | End |
|---|---|---|---|
| Prep | 8 | 2026-08-24 | 2026-10-18 |
| Bridge | 7 | 2026-10-19 | 2026-12-06 |
| Arc | 26 | 2026-12-07 | 2027-06-06 |

Prep and Arc both number weeks 1–8, so week labels always name their block.

## Local development

```bash
python -m http.server 8000   # then open http://localhost:8000
npm test                     # node --test, no install needed
```

## Syncing

The nightly Claude scheduled task follows `scripts/sync-runbook.md`. To sync manually,
ask Claude in this repo: "sync the last 7 days from Strava".
```

- [ ] **Step 3: Run the full test suite before publishing**

```bash
npm test
```

Expected: PASS, 48 tests. Do not publish on a red suite.

- [ ] **Step 4: Commit**

```bash
git add README.md .gitignore
git commit -m "docs: add README and gitignore"
```

- [ ] **Step 5: Create the repo and push**

Only after the privacy gate is answered. If personal files are to be excluded:

```bash
git rm --cached 70.3-training-context-handoff.md 70.3-base-phase-weeks-1-8.md
printf '70.3-*.md\n' >> .gitignore
git commit -m "chore: keep personal training notes out of version control"
```

Then:

```bash
gh repo create ironman-coach --public --source=. --remote=origin --push
```

- [ ] **Step 6: Enable Pages**

```bash
gh api -X POST repos/:owner/ironman-coach/pages -f source[branch]=main -f source[path]=/
```

Wait about a minute, then confirm the site is live:

```bash
gh api repos/:owner/ironman-coach/pages --jq .html_url
```

- [ ] **Step 7: Confirm unattended git push works**

```bash
git commit --allow-empty -m "chore: verify unattended push"
git push
```

If this prompts for credentials, the nightly task will hang. Fix it with `gh auth setup-git` before scheduling.

- [ ] **Step 8: Create the scheduled task**

Use the `schedule` skill to create a daily task at 05:00 local with this prompt:

```
Working directory: C:\Users\Claw\ironman-coach
Follow scripts/sync-runbook.md to sync yesterday's Strava activities into data/log.json,
then commit and push. If the Strava MCP connector is unavailable, write
data/sync-status.json with ok=false and reason "strava-unreachable", commit that, and
report the failure — do not write any log entries.
```

- [ ] **Step 9: Verify the sync end to end**

Run the runbook manually for a date with a known activity. Confirm `data/log.json` gained
an entry, `data/sync-status.json` shows `ok: true`, the push landed, and the live Pages URL
shows the status dot within a couple of minutes.

- [ ] **Step 10: Commit any fixes**

```bash
git add -A
git commit -m "fix: corrections found during first live sync"
git push
```

---

## Notes for whoever executes this

- **Strava MCP is not connected yet.** Tasks 1–8 do not need it. Task 10 step 9 does. If it
  is still unconnected, complete everything else and leave step 9 open.
- **The 48-test count** assumes 6 + 8 + 19 + 15. If your counts differ, something was skipped.
- **Bridge weeks must be authored before 2026-10-19**, or the site correctly shows seven weeks
  of "not written yet".
