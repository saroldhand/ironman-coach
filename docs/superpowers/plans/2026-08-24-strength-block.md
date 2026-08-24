# Strength Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a 12-week lifting cycle into the training plan starting 2026-09-14, with cardio scaled around it, by teaching `plan.json` to express per-week explicit training templates.

**Architecture:** `plan.skeleton` is one weekly template shared by every block, so it cannot express sixty distinct lifting sessions. Blocks gain a `weekSource` field; when it is `"weekTemplates"`, `resolveWeek` reads the week from `plan.weekTemplates[progression.template]` instead of the global skeleton, and interpolates `{placeholder}` tokens in set lines from the progression row. Everything downstream — render, log matching, season completion — consumes `resolveWeek`'s existing return shape and needs no change.

**Tech Stack:** Vanilla ES modules, no build step, no dependencies. `node --test` for tests. Data lives in `data/plan.json`.

**Spec:** `docs/superpowers/specs/2026-08-24-strength-block-design.md`

## Global Constraints

- **No build step.** Files pushed to `main` are the files served. No new dependencies, no transpilation.
- **`assets/date-utils.js` is the only module allowed to construct a `Date`.** No task may add `new Date(...)` anywhere else.
- **`assets/render.js` is the only module allowed to touch `document`.** Tests must never need a DOM.
- **Session keys are `${blockId}:${week}:${dayKey}:${discipline}`.** Two sessions on the same day with the same discipline would collide silently. No template may do this.
- **Progression key names follow existing convention:** `rideMin` and `runMin`, not `longRideMin`/`longRunMin`.
- **The `×` character is used in set lines** (U+00D7), not the letter `x`. `data/plan.json` is UTF-8.
- **Run `npm test` before every commit.** It is `node --test`, needs no install, and takes under two seconds.
- **Do not merge to `main` or push.** Work stays on branch `feature/strength-block`.

---

### Task 1: Teach `resolveWeek` to read a week from a template

**Files:**
- Modify: `assets/plan-model.js:116-150` (`resolveWeek`)
- Test: `tests/plan-model.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `resolveWeek(plan, blockId, week)` gains support for `block.weekSource === 'weekTemplates'`. When set, the week's days come from `plan.weekTemplates[progression.template].days` instead of `plan.skeleton`. A template that omits a day key yields a day with `sessions: []`. Return shape is otherwise unchanged: `{ blockId, blockLabel, week, type, authored, startDate, days }` where each day is `{ dayKey, date, nutrition, sessions }`.

- [ ] **Step 1: Write the failing test**

Add to `tests/plan-model.test.js`. This builds a synthetic plan rather than using `data/plan.json`, because the real plan has no template block yet — and because a unit test of the engine should not depend on production data.

```js
// A minimal plan exercising weekTemplates, independent of data/plan.json.
function templatePlan() {
  return {
    race: { name: 'Test', date: '2027-06-05' },
    blocks: [
      { id: 'lift', label: 'Lift', start: '2026-09-14', weeks: 2,
        authored: true, weekSource: 'weekTemplates' }
    ],
    skeleton: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
    weekTemplates: {
      alpha: {
        dayTypes: { mon: 'low', tue: 'low', wed: 'low', thu: 'low',
                    fri: 'low', sat: 'low', sun: 'low' },
        days: {
          mon: [{ discipline: 'strength', title: 'Alpha lift',
                  prescribed: { metric: 'duration', value: 60, unit: 'min' },
                  effort: 'Hard.', setLines: ['Squat 5×5'] }]
        }
      }
    },
    progression: { lift: [{ week: 1, type: 'build', template: 'alpha' }] },
    recovery: { swimDeltaAppliesTo: [], swimDeltaMetres: 0, skipStrength: true,
                tue: { durationMin: 40 }, thu: { durationMin: 30 } },
    sets: {},
    nutrition: {
      dayTypes: { mon: 'big', tue: 'big', wed: 'big', thu: 'big',
                  fri: 'big', sat: 'big', sun: 'big' },
      types: { big: { label: 'Big day', approach: 'Eat.' },
               low: { label: 'Low day', approach: 'Less.' } }
    }
  };
}

test('resolveWeek reads a weekTemplates block from its named template', () => {
  const w = resolveWeek(templatePlan(), 'lift', 1);
  assert.equal(w.authored, true);
  assert.equal(w.startDate, '2026-09-14');
  const mon = w.days.find(d => d.dayKey === 'mon');
  assert.equal(mon.sessions.length, 1);
  assert.equal(mon.sessions[0].title, 'Alpha lift');
  assert.equal(mon.sessions[0].key, 'lift:1:mon:strength');
});

test('resolveWeek gives a template day with no entry an empty session list', () => {
  const w = resolveWeek(templatePlan(), 'lift', 1);
  assert.equal(w.days.length, 7, 'all seven days are still present');
  assert.deepEqual(w.days.find(d => d.dayKey === 'sat').sessions, []);
});

test('resolveWeek still reads skeleton blocks from the global skeleton', () => {
  // Regression: the real plan's prep block must be untouched by this change.
  const w = resolveWeek(plan, 'prep', 1);
  assert.equal(w.authored, true);
  assert.ok(w.days.find(d => d.dayKey === 'tue').sessions.length > 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL. The two `weekTemplates` tests throw — `resolveWeek` reads `plan.skeleton[dayKey]`, which is `[]` for every day in the synthetic plan, so `mon.sessions.length` is `0`, not `1`.

- [ ] **Step 3: Implement the template source branch**

In `assets/plan-model.js`, replace the body of `resolveWeek` from `const isRecovery` through the end of the `days` assignment (currently lines 129–144) with:

```js
  const isRecovery = progression.type === 'recovery';

  // A block either draws its week from the one global skeleton (the tri
  // blocks, whose shape never changes) or from a named template chosen by
  // the progression row (the strength block, whose shape alternates).
  const template = block.weekSource === 'weekTemplates'
    ? plan.weekTemplates[progression.template]
    : null;
  const source = template ? template.days : plan.skeleton;
  const dayTypes = (template && template.dayTypes) || plan.nutrition.dayTypes;

  const days = DAY_KEYS.map((dayKey, i) => {
    // A template need not fill all seven days; the calendar still shows them.
    let templates = source[dayKey] || [];
    if (isRecovery && plan.recovery.skipStrength) {
      templates = templates.filter(t => t.discipline !== 'strength');
    }
    const typeKey = dayTypes[dayKey];
    return {
      dayKey,
      date: addDays(startDate, i),
      nutrition: plan.nutrition.types[typeKey],
      sessions: templates.map(t =>
        buildSession(plan, t, { blockId, week, dayKey, progression, isRecovery }))
    };
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add assets/plan-model.js tests/plan-model.test.js
git commit -m "feat: let a block draw its week from a named template"
```

---

### Task 2: Interpolate progression values into set lines

**Files:**
- Modify: `assets/plan-model.js:74-114` (`buildSession`)
- Test: `tests/plan-model.test.js`

**Interfaces:**
- Consumes: `templatePlan()` from Task 1.
- Produces: session templates may carry a literal `setLines` array whose entries contain `{name}` tokens. `buildSession` replaces each token with `progression[name]`. An unmatched token is **left verbatim** so it is visible on screen and catchable by a data-integrity test, rather than becoming the string `"undefined"`.

- [ ] **Step 1: Write the failing test**

Add to `tests/plan-model.test.js`:

```js
test('set lines interpolate values from the progression row', () => {
  const p = templatePlan();
  p.weekTemplates.alpha.days.mon[0].setLines = ['Bench Press {gvt}', 'Fly 4×12'];
  p.progression.lift[0].gvt = '10×10';

  const mon = resolveWeek(p, 'lift', 1).days.find(d => d.dayKey === 'mon');
  assert.deepEqual(mon.sessions[0].setLines, ['Bench Press 10×10', 'Fly 4×12']);
});

test('an unmatched placeholder survives verbatim rather than becoming undefined', () => {
  // It must stay visible: "Bench Press {gvt}" on screen is a bug you can see,
  // "Bench Press undefined" is one you might not, and a silently dropped
  // token is one you certainly would not.
  const p = templatePlan();
  p.weekTemplates.alpha.days.mon[0].setLines = ['Bench Press {missing}'];

  const mon = resolveWeek(p, 'lift', 1).days.find(d => d.dayKey === 'mon');
  assert.deepEqual(mon.sessions[0].setLines, ['Bench Press {missing}']);
});

test('interpolation does not disturb a skeleton block swim set', () => {
  const wed = resolveWeek(plan, 'prep', 1).days.find(d => d.dayKey === 'wed');
  const swim = wed.sessions.find(s => s.discipline === 'swim');
  assert.ok(swim.setLines.length > 0);
  assert.ok(swim.setLines.every(l => !l.includes('{')));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL on the first two — `setLines` comes back `[]`, because `buildSession` only populates it for swims and for `setRef === 'strength'`.

- [ ] **Step 3: Implement interpolation**

In `assets/plan-model.js`, add above `buildSession`:

```js
const PLACEHOLDER = /\{(\w+)\}/g;

// Set lines in a week template carry {name} tokens filled from that week's
// progression row, which is what lets four GVT weeks share one template.
// An unknown token is left as written: a visible "{gvt}" on the page is a
// bug that reports itself, where "undefined" reads like prescribed text.
function fillPlaceholders(line, progression) {
  return line.replace(PLACEHOLDER, (token, name) =>
    progression[name] === undefined ? token : String(progression[name]));
}
```

Then inside `buildSession`, immediately after the `if (template.setRef === 'strength')` line (currently line 101), add:

```js
  // Templates carry their set lines literally; the skeleton derives swim sets
  // from the weekday instead, so this must not clobber that.
  if (template.setLines) {
    s.setLines = template.setLines.map(l => fillPlaceholders(l, progression));
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add assets/plan-model.js tests/plan-model.test.js
git commit -m "feat: interpolate progression values into template set lines"
```

---

### Task 3: Stop template blocks inheriting the tri block's recovery rules

**Files:**
- Modify: `assets/plan-model.js` (`resolveWeek`, the `isRecovery` assignment from Task 1)
- Test: `tests/plan-model.test.js`

**Interfaces:**
- Consumes: `templatePlan()` from Task 1.
- Produces: for a `weekTemplates` block, `plan.recovery` deltas never apply, but the returned week's `type` still reports `'recovery'` so the UI can label it. For skeleton blocks nothing changes.

**Why:** `recovery.skipStrength` filters out every session whose discipline is `strength`. On a lifting block that silently deletes the entire week. The strength block manages its own load through its week 11 deload.

- [ ] **Step 1: Write the failing test**

Add to `tests/plan-model.test.js`:

```js
test('a recovery week in a template block keeps its lifting sessions', () => {
  // recovery.skipStrength drops every strength session. On a lifting block
  // that would silently empty the week, so the tri recovery rules must not
  // reach a template block at all.
  const p = templatePlan();
  p.progression.lift[0].type = 'recovery';

  const w = resolveWeek(p, 'lift', 1);
  const mon = w.days.find(d => d.dayKey === 'mon');
  assert.equal(mon.sessions.length, 1, 'the lift survives the recovery week');
  assert.equal(w.type, 'recovery', 'but the week is still labelled recovery');
});

test('skeleton blocks still honour recovery rules', () => {
  // Regression guard, on a clone rather than the real plan: after the
  // calendar re-cut no live block has a recovery week, and this machinery
  // still has to work when Arc is authored.
  const p = JSON.parse(JSON.stringify(plan));
  const prep = p.blocks.find(b => b.id === 'prep');
  prep.weeks = 4;
  p.progression.prep = [
    ...p.progression.prep.slice(0, 3),
    { week: 4, type: 'recovery', rideMin: 70, runMin: 40,
      wedDistance: 1700, wedMainSet: '6 x 100 easy, 20s rest' }
  ];

  const fri = resolveWeek(p, 'prep', 4).days.find(d => d.dayKey === 'fri');
  assert.equal(fri.sessions.filter(s => s.discipline === 'strength').length, 0,
    'recovery drops the optional strength circuit');
  assert.equal(resolveWeek(p, 'prep', 4).days
    .find(d => d.dayKey === 'tue').sessions[0].prescribed.value, 40,
    'recovery shortens the tuesday bike');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL on the first test — `mon.sessions.length` is `0`, because `skipStrength` filtered the lift out.

- [ ] **Step 3: Guard the recovery rules to skeleton blocks**

In `assets/plan-model.js`, in `resolveWeek`, move the `template` and `source` declarations above `isRecovery` and make `isRecovery` depend on the template:

```js
  // A block either draws its week from the one global skeleton (the tri
  // blocks, whose shape never changes) or from a named template chosen by
  // the progression row (the strength block, whose shape alternates).
  const template = block.weekSource === 'weekTemplates'
    ? plan.weekTemplates[progression.template]
    : null;
  const source = template ? template.days : plan.skeleton;
  const dayTypes = (template && template.dayTypes) || plan.nutrition.dayTypes;

  // The recovery deltas describe the tri week specifically — skipStrength
  // would delete a whole lifting week. A template block carries its own
  // deload, so it opts out of the rules while keeping the label.
  const isRecovery = !template && progression.type === 'recovery';
```

The rest of the function is unchanged. Note `type: progression.type` in the return value already reports `'recovery'` independently of `isRecovery`, so the label survives.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add assets/plan-model.js tests/plan-model.test.js
git commit -m "fix: keep tri recovery rules out of template blocks"
```

---

### Task 4: Author the GVT templates and weeks 1–8

**Files:**
- Modify: `data/plan.json`
- Test: `tests/plan-json.test.js`

**Interfaces:**
- Consumes: `weekSource`, `weekTemplates`, `{placeholder}` interpolation from Tasks 1–3.
- Produces: `plan.weekTemplates.gvtA` and `plan.weekTemplates.gvtB`, each `{ dayTypes, days }`. `plan.progression.strength` weeks 1–8. `plan.nutrition.types.lift`. These are inert until Task 6 adds the block that references them.

- [ ] **Step 1: Add the `lift` nutrition type**

In `data/plan.json`, inside `nutrition.types`, add alongside `big`, `moderate` and `low`:

```json
"lift": {
  "label": "Lifting day",
  "approach": "Maintenance calories. Protein 1.8-2.2 g/kg. Do not run a deficit while ramping strength."
}
```

- [ ] **Step 2: Add the `weekTemplates` object with `gvtA`**

Add a new top-level `weekTemplates` key to `data/plan.json`, between `skeleton` and `progression`:

```json
"weekTemplates": {
  "gvtA": {
    "dayTypes": { "mon": "lift", "tue": "lift", "wed": "lift", "thu": "lift",
                  "fri": "lift", "sat": "moderate", "sun": "low" },
    "days": {
      "mon": [
        { "discipline": "strength", "title": "GVT - Chest",
          "prescribed": { "metric": "duration", "value": 60, "unit": "min" },
          "effort": "90 sec rest between sets. Same weight for all ten sets - pick something you could do 20 reps with.",
          "setLines": [
            "Bench Press {gvt}",
            "Incline Fly 4×12-15",
            "Weighted Dips 4×15-20",
            "Floor Press 3×8-10",
            "Rope Cable Pushdowns 4×12-15",
            "Push Ups - 15 every minute on the minute for 10 min (150 total)",
            "Hanging Leg Raises 4×15-20"
          ],
          "detail": ["Before work."] }
      ],
      "tue": [
        { "discipline": "strength", "title": "Lower Body",
          "prescribed": { "metric": "duration", "value": 60, "unit": "min" },
          "effort": "Heavy. Squats at 75% 1RM.",
          "setLines": [
            "Barbell Squat 5×5 (75% 1RM)",
            "Hip Thrusters 6×10 (barbell)",
            "Leg Extension Tri-Set - 4 rounds of 12 / 8 / AMRAP (15 sec between, stay in the chair; 90 sec between rounds)",
            "Stiff Leg Deadlifts 5×10",
            "SUPERSET 4×: Barbell Walking Lunges 15 + Barbell Squats AMRAP"
          ],
          "detail": ["Before work."] },
        { "discipline": "swim", "title": "Technique swim",
          "prescribed": { "metric": "distance", "value": 2000, "unit": "m" },
          "effort": "Easy throughout. Technique is the point, not the distance.",
          "setLines": [
            "400 easy free",
            "8 × 50 drill - 15s rest",
            "8 × 100 steady - 20s rest",
            "200 easy cooldown"
          ],
          "detail": [
            "Evening. Your legs are wrecked from this morning - that is the point of swimming today.",
            "Pick ONE cue for the whole session."
          ] }
      ],
      "wed": [
        { "discipline": "strength", "title": "GVT - Back",
          "prescribed": { "metric": "duration", "value": 60, "unit": "min" },
          "effort": "90 sec rest between sets. Same weight for all ten sets.",
          "setLines": [
            "Deadlift {gvt}",
            "SUPERSET 4×: Pull Ups AMRAP + Lat Pulldowns 10-12",
            "One Arm DB Row 4×8-10",
            "Low Cable Row 3×12-15",
            "SUPERSET 4×: DB Curl 6-8 + Hammer Curl AMRAP (same weight)",
            "Hanging Leg Raises 4×15-20"
          ],
          "detail": ["Before work."] }
      ],
      "thu": [
        { "discipline": "strength", "title": "Lower Body",
          "prescribed": { "metric": "duration", "value": 60, "unit": "min" },
          "effort": "Volume day. Nothing here should be a grinder.",
          "setLines": [
            "SUPERSET 4×: Leg Extensions 10-12 + Leg Curls 10-12",
            "Goblet Squats 4×10-12",
            "Bulgarian Split Squats 6×10 each leg",
            "Calf Raises 4×15-20",
            "Sissy Squats 4×AMRAP",
            "Overhead Walking Lunges 4×15 (25 or 45 lb plate overhead)"
          ],
          "detail": ["Before work."] },
        { "discipline": "swim", "title": "Aerobic swim",
          "prescribed": { "metric": "distance", "value": 2000, "unit": "m" },
          "effort": "Steady and repeatable. Same pace on the last rep as the first.",
          "setLines": [
            "300 easy free",
            "6 × 50 drill - 15s rest",
            "10 × 100 alternating: odd steady, even easy - 15s rest",
            "200 easy cooldown"
          ],
          "detail": ["Evening."] }
      ],
      "fri": [
        { "discipline": "strength", "title": "Shoulders / Arms",
          "prescribed": { "metric": "duration", "value": 60, "unit": "min" },
          "effort": "Moderate. Nothing to failure except where it says AMRAP.",
          "setLines": [
            "Overhead Barbell Press 4×8",
            "SUPERSET 4×: Arnold Press 8 + DB Shoulder Press AMRAP",
            "Side Lateral Raises 3×15-20",
            "SUPERSET 4×: DB Shrugs 10-12 + Facepulls 12-15",
            "Straight Barbell Curls 6×10-12",
            "Close Grip Bench Press 6×10-12"
          ],
          "detail": ["Before work."] }
      ],
      "sat": [
        { "discipline": "bike", "title": "Easy ride",
          "prescribed": { "metric": "duration", "value": 60, "unit": "min" },
          "effort": "Zone 2 - 65-75% max HR. Conversational the whole way.",
          "detail": [
            "Maintenance only. This does not progress during the GVT block.",
            "If your legs are still wrecked from Thursday, ride it easier - do not skip it."
          ] }
      ],
      "sun": [
        { "discipline": "run", "title": "Easy run", "optional": true,
          "prescribed": { "metric": "duration", "value": 30, "unit": "min" },
          "effort": "Zone 2. Slower than you think.",
          "detail": ["Optional. Full rest is the right call if the week beat you up."] }
      ]
    }
  }
}
```

- [ ] **Step 3: Add `gvtB` alongside `gvtA`**

Inside the same `weekTemplates` object, after `gvtA`:

```json
"gvtB": {
  "dayTypes": { "mon": "lift", "tue": "lift", "wed": "lift", "thu": "lift",
                "fri": "lift", "sat": "moderate", "sun": "low" },
  "days": {
    "mon": [
      { "discipline": "strength", "title": "Chest, Shoulders & Triceps",
        "prescribed": { "metric": "duration", "value": 60, "unit": "min" },
        "effort": "Moderate volume. Leave one rep in the tank on the pressing.",
        "setLines": [
          "DB Chest Press 5×8-10",
          "Incline Barbell Press 4×8-10",
          "Chest Flys 4×12-15",
          "Barbell Overhead Press 4×8-10",
          "TRI-SET 3 rounds: Upright BB Rows 15-20 + Side Laterals 12-15 + DB Shrugs 15-20",
          "Bodyweight Dips 4×AMRAP",
          "Hanging Leg Raises 4×15-20"
        ],
        "detail": ["Before work."] }
    ],
    "tue": [
      { "discipline": "strength", "title": "Lower Body",
        "prescribed": { "metric": "duration", "value": 60, "unit": "min" },
        "effort": "Work up to the heavy triple, then back off.",
        "setLines": [
          "Barbell Squat 3×8-10",
          "Barbell Squat 3×3 (heavier)",
          "Leg Extensions 6×15",
          "Goblet Squats 4×10-12",
          "Walking Barbell Lunges 4×15",
          "Calf Raises 4×15-20",
          "Sissy Squats 4×AMRAP"
        ],
        "detail": ["Before work."] },
      { "discipline": "swim", "title": "Technique swim",
        "prescribed": { "metric": "distance", "value": 2000, "unit": "m" },
        "effort": "Easy throughout. Technique is the point, not the distance.",
        "setLines": [
          "400 easy free",
          "8 × 50 drill - 15s rest",
          "8 × 100 steady - 20s rest",
          "200 easy cooldown"
        ],
        "detail": [
          "Evening. Your legs are wrecked from this morning - that is the point of swimming today.",
          "Pick ONE cue for the whole session."
        ] }
    ],
    "wed": [
      { "discipline": "strength", "title": "Back & Biceps",
        "prescribed": { "metric": "duration", "value": 60, "unit": "min" },
        "effort": "Deadlifts at 80% 1RM. Everything after is accessory.",
        "setLines": [
          "Deadlifts {deadlift}",
          "Back Extensions 4×15-20",
          "SUPERSET 3×: Pendlay Rows 8-10 + DB Row 10-12 (two hands at once)",
          "Pull Ups 4×AMRAP",
          "Cable Pull Over 4×15-20",
          "SUPERSET 4×: Preacher Curl 10-12 + Rope Concentration Curl 12-15",
          "Hanging Leg Raises 4×15-20"
        ],
        "detail": ["Before work."] }
    ],
    "thu": [
      { "discipline": "strength", "title": "Lower Body",
        "prescribed": { "metric": "duration", "value": 60, "unit": "min" },
        "effort": "Posterior chain focus. Hinge, do not squat, the hip thrusts.",
        "setLines": [
          "Hip Thrusters 2×10 then 5×5 (barbell)",
          "Leg Curl 6×12-15",
          "Stiff Legged Deadlift 4×8-10",
          "Goblet Squats 4×10-12",
          "Jefferson Squats 4×20",
          "Walking Barbell Lunges 3×15",
          "Calf Raises 4×15-20"
        ],
        "detail": ["Before work."] },
      { "discipline": "swim", "title": "Aerobic swim",
        "prescribed": { "metric": "distance", "value": 2000, "unit": "m" },
        "effort": "Steady and repeatable. Same pace on the last rep as the first.",
        "setLines": [
          "300 easy free",
          "6 × 50 drill - 15s rest",
          "10 × 100 alternating: odd steady, even easy - 15s rest",
          "200 easy cooldown"
        ],
        "detail": ["Evening."] }
    ],
    "fri": [
      { "discipline": "strength", "title": "Chest / Back",
        "prescribed": { "metric": "duration", "value": 60, "unit": "min" },
        "effort": "Bench at 75% 1RM. Alternate push and pull throughout.",
        "setLines": [
          "Bench Press {bench}",
          "Pendlay Rows 4×8-10",
          "Floor Press 4×8-10",
          "Lat Pulldown 5×12-15",
          "Incline DB Press 4×6-8",
          "Pull Ups 4×AMRAP",
          "Push Ups - 15 every minute on the minute for 10 min",
          "Hanging Leg Raises 4×15-20"
        ],
        "detail": ["Before work."] }
    ],
    "sat": [
      { "discipline": "bike", "title": "Easy ride",
        "prescribed": { "metric": "duration", "value": 60, "unit": "min" },
        "effort": "Zone 2 - 65-75% max HR. Conversational the whole way.",
        "detail": [
          "Maintenance only. This does not progress during the GVT block.",
          "If your legs are still wrecked from Thursday, ride it easier - do not skip it."
        ] }
    ],
    "sun": [
      { "discipline": "run", "title": "Easy run", "optional": true,
        "prescribed": { "metric": "duration", "value": 30, "unit": "min" },
        "effort": "Zone 2. Slower than you think.",
        "detail": ["Optional. Full rest is the right call if the week beat you up."] }
    ]
  }
}
```

- [ ] **Step 4: Add `progression.strength` weeks 1–8**

Inside `plan.progression`, add a `strength` key alongside `prep`:

```json
"strength": [
  { "week": 1, "type": "build", "template": "gvtA", "gvt": "10×10" },
  { "week": 2, "type": "build", "template": "gvtB",
    "deadlift": "5×5 (80% 1RM)", "bench": "5×5 (75% 1RM)" },
  { "week": 3, "type": "build", "template": "gvtA", "gvt": "10×6" },
  { "week": 4, "type": "build", "template": "gvtB",
    "deadlift": "6×3 (80% 1RM)", "bench": "6×3 (75% 1RM)" },
  { "week": 5, "type": "build", "template": "gvtA", "gvt": "10×4" },
  { "week": 6, "type": "build", "template": "gvtB",
    "deadlift": "6×2 (80% 1RM)", "bench": "6×2 (75% 1RM)" },
  { "week": 7, "type": "build", "template": "gvtA", "gvt": "10×3" },
  { "week": 8, "type": "build", "template": "gvtB",
    "deadlift": "4×8 (80% 1RM)", "bench": "4×8 (75% 1RM)" }
]
```

- [ ] **Step 5: Write the test**

Add to `tests/plan-json.test.js`:

```js
test('the GVT templates cover all seven days', () => {
  for (const name of ['gvtA', 'gvtB']) {
    assert.deepEqual(Object.keys(plan.weekTemplates[name].days),
      ['mon','tue','wed','thu','fri','sat','sun'], name);
    assert.deepEqual(Object.keys(plan.weekTemplates[name].dayTypes),
      ['mon','tue','wed','thu','fri','sat','sun'], name);
  }
});

test('the GVT block alternates its two templates by week parity', () => {
  const first8 = plan.progression.strength.slice(0, 8);
  assert.deepEqual(first8.map(w => w.template),
    ['gvtA','gvtB','gvtA','gvtB','gvtA','gvtB','gvtA','gvtB']);
});

test('the GVT rep scheme descends across the block', () => {
  const gvt = plan.progression.strength.filter(w => w.gvt).map(w => w.gvt);
  assert.deepEqual(gvt, ['10×10', '10×6', '10×4', '10×3']);
});

test('every nutrition day type named by a template is defined', () => {
  for (const [name, tpl] of Object.entries(plan.weekTemplates)) {
    for (const t of Object.values(tpl.dayTypes)) {
      assert.ok(plan.nutrition.types[t], `${name} names missing day type ${t}`);
    }
  }
});
```

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS. If `plan.json` fails to parse, the error names the line — check for a trailing comma after `sun` or a missing comma between `gvtA` and `gvtB`.

- [ ] **Step 7: Commit**

```bash
git add data/plan.json tests/plan-json.test.js
git commit -m "feat: add the GVT week templates and weeks 1-8"
```

---

### Task 5: Author the PPL template and weeks 9–12

**Files:**
- Modify: `data/plan.json`
- Test: `tests/plan-json.test.js`

**Interfaces:**
- Consumes: `weekTemplates` and `progression.strength` from Task 4.
- Produces: `plan.weekTemplates.ppl` and `progression.strength` weeks 9–12, carrying `main`, `power`, `rideMin`, `runMin`.

**Note on ordering:** the split runs **Legs (Mon) / Pull (Wed) / Push (Fri)**, not Push/Pull/Legs. Squats need five clear days before Saturday's long ride. Do not "fix" this to match the source document's day order.

- [ ] **Step 1: Add the `ppl` template**

Inside `weekTemplates`, after `gvtB`:

```json
"ppl": {
  "dayTypes": { "mon": "lift", "tue": "moderate", "wed": "lift", "thu": "moderate",
                "fri": "lift", "sat": "big", "sun": "big" },
  "days": {
    "mon": [
      { "discipline": "strength", "title": "Legs",
        "prescribed": { "metric": "duration", "value": 70, "unit": "min" },
        "effort": "Main sets first, then the power sets. Bar speed is the intent, not grinding.",
        "setLines": [
          "Barbell Squat {main}",
          "Barbell Squat {power} - bar speed on every rep",
          "SUPERSET 4×: Leg Curls 12-15 + Stiff Legged Deadlifts 10-12",
          "Overhead Walking Lunges 3×15 (25 or 45 lb plate)",
          "Leg Extension Tri-Set - 4 rounds of 12 / 8 / AMRAP",
          "Calf Raises 4×15-20",
          "Goblet Squat 3×10-12"
        ],
        "detail": [
          "Before work.",
          "Legs go on Monday so they have five days to clear before Saturday's long ride."
        ] }
    ],
    "tue": [
      { "discipline": "swim", "title": "Aerobic swim",
        "prescribed": { "metric": "distance", "value": 2000, "unit": "m" },
        "effort": "Steady and repeatable. Same pace on the last rep as the first.",
        "setLines": [
          "300 easy free",
          "6 × 50 drill - 15s rest",
          "10 × 100 alternating: odd steady, even easy - 15s rest",
          "200 easy cooldown"
        ],
        "detail": ["Evening."] }
    ],
    "wed": [
      { "discipline": "strength", "title": "Pull",
        "prescribed": { "metric": "duration", "value": 70, "unit": "min" },
        "effort": "Main sets first, then the power sets. Bar speed is the intent.",
        "setLines": [
          "Deadlift {main}",
          "Deadlift {power} - bar speed on every rep",
          "SUPERSET 4×: Weighted Pull Ups AMRAP + Lat Pulldown 10-12",
          "Pendlay Row 4×8-10",
          "SUPERSET 4×: Cable Pullover 10-12 + Cable Row 10-12",
          "DB Shrugs 4×15-20",
          "Preacher Curl 3×12-15",
          "Cable Concentration Curl 4×10-12",
          "Hanging Leg Raises 4×15-20"
        ],
        "detail": ["Before work."] }
    ],
    "thu": [
      { "discipline": "run", "title": "Easy run",
        "prescribed": { "metric": "duration", "value": 40, "unit": "min" },
        "effort": "Zone 2 - conversational. No strides, no pickups.",
        "detail": [
          "Evening.",
          "The first running in eight weeks - expect it to feel worse than your fitness suggests. That is normal and it passes in a fortnight."
        ] }
    ],
    "fri": [
      { "discipline": "strength", "title": "Push",
        "prescribed": { "metric": "duration", "value": 70, "unit": "min" },
        "effort": "Main sets first, then the power sets. Bar speed is the intent.",
        "setLines": [
          "Bench Press {main}",
          "Bench Press {power} - bar speed on every rep",
          "Barbell Overhead Press 5×5, then 2×10",
          "DB Chest Press 4×8-10",
          "SUPERSET 3×: Skull Crushers 12-15 + Overhead Tricep Ext 10-12",
          "Cable Flys 4×12-15",
          "Landmine Press 4×12-15",
          "Weighted Dips 4×15-20",
          "Push Ups - 100 total as fast as possible",
          "Hanging Leg Raises 4×15-20"
        ],
        "detail": [
          "Before work.",
          "Push goes on Friday because it barely touches the legs before Saturday."
        ] }
    ],
    "sat": [
      { "discipline": "bike", "title": "Long ride",
        "prescribed": { "metric": "duration", "value": null, "unit": "min",
                        "fromProgression": "rideMin" },
        "effort": "Zone 2 - 65-75% max HR. Yes, even the long one.",
        "detail": ["The anchor session of the week. This is where the aerobic base comes back."] }
    ],
    "sun": [
      { "discipline": "run", "title": "Long run",
        "prescribed": { "metric": "duration", "value": null, "unit": "min",
                        "fromProgression": "runMin" },
        "effort": "Zone 2. Slower than you think.",
        "detail": ["Off the back of the ride. Run it by effort, not pace."] }
    ]
  }
}
```

- [ ] **Step 2: Add progression weeks 9–12**

Append to the `progression.strength` array from Task 4:

```json
{ "week": 9, "type": "build", "template": "ppl",
  "main": "4×6", "power": "5×3 @ 85% 1RM", "rideMin": 75, "runMin": 40 },
{ "week": 10, "type": "build", "template": "ppl",
  "main": "5×5", "power": "6×2 @ 90% 1RM", "rideMin": 90, "runMin": 45 },
{ "week": 11, "type": "recovery", "template": "ppl",
  "main": "6×3", "power": "4×6 @ 70% 1RM", "rideMin": 105, "runMin": 50 },
{ "week": 12, "type": "build", "template": "ppl",
  "main": "4×10", "power": "5×5 @ 75% 1RM", "rideMin": 120, "runMin": 55 }
```

Week 11 is typed `recovery` so the UI labels the barbell deload. Task 3 guarantees this does not delete the lifting sessions.

- [ ] **Step 3: Write the test**

Add to `tests/plan-json.test.js`:

```js
test('the strength block runs twelve weeks, PPL for the last four', () => {
  assert.equal(plan.progression.strength.length, 12);
  assert.deepEqual(plan.progression.strength.slice(8).map(w => w.template),
    ['ppl', 'ppl', 'ppl', 'ppl']);
});

test('the weekend ramps monotonically through the PPL weeks', () => {
  const ppl = plan.progression.strength.slice(8);
  assert.deepEqual(ppl.map(w => w.rideMin), [75, 90, 105, 120]);
  assert.deepEqual(ppl.map(w => w.runMin), [40, 45, 50, 55]);
});

test('the PPL split is legs, pull, push - in that order', () => {
  // Squats need five clear days before the Saturday long ride, and Friday's
  // pressing barely touches the legs. Reversing this breaks the cardio ramp.
  const days = plan.weekTemplates.ppl.days;
  assert.equal(days.mon[0].title, 'Legs');
  assert.equal(days.wed[0].title, 'Pull');
  assert.equal(days.fri[0].title, 'Push');
});

test('week 11 is the barbell deload', () => {
  const w11 = plan.progression.strength.find(w => w.week === 11);
  assert.equal(w11.type, 'recovery');
  assert.match(w11.power, /70%/);
});
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add data/plan.json tests/plan-json.test.js
git commit -m "feat: add the powerbuilding template and weeks 9-12"
```

---

### Task 6: Re-cut the block calendar

**Files:**
- Modify: `data/plan.json` (`blocks`, `progression.prep`)
- Test: `tests/plan-json.test.js`, `tests/plan-model.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: `plan.blocks` becomes `[prep (3 weeks), strength (12 weeks), arc (26 weeks)]`. `bridge` is gone. This is the switch that makes the strength block live.

**This task turns several existing tests red.** They assert the old calendar and must be updated in the same commit — every one is listed below. Do not skip any; a red suite at the end of this task means one was missed.

- [ ] **Step 1: Re-cut `blocks` in `data/plan.json`**

Replace the whole `blocks` array with:

```json
"blocks": [
  { "id": "prep", "label": "Prep", "start": "2026-08-24", "weeks": 3, "authored": true,
    "note": "The opening three weeks of the written base phase, before the strength block." },
  { "id": "strength", "label": "Strength", "start": "2026-09-14", "weeks": 12,
    "authored": true, "weekSource": "weekTemplates",
    "note": "The ETS lifting cycle. Five mornings a week for eight weeks, then three.",
    "phases": [
      { "label": "GVT", "from": 1, "to": 8 },
      { "label": "Powerbuilding", "from": 9, "to": 12 }
    ] },
  { "id": "arc", "label": "Arc", "start": "2026-12-07", "weeks": 26, "authored": false,
    "note": "The documented 26-week plan. Authored block by block as it approaches.",
    "phases": [
      { "label": "Base", "from": 1, "to": 8 },
      { "label": "Build", "from": 9, "to": 16 },
      { "label": "Race-specific", "from": 17, "to": 22 },
      { "label": "Taper", "from": 23, "to": 26 }
    ] }
]
```

- [ ] **Step 2: Trim `progression.prep` to three weeks**

Delete the objects for weeks 4 through 8, leaving only weeks 1, 2 and 3. Weeks 1–3 are all `"type": "build"`.

- [ ] **Step 3: Update `tests/plan-json.test.js`**

Replace the three tests that assert the old calendar:

```js
test('race date and blocks are anchored correctly', () => {
  assert.equal(plan.race.date, '2027-06-05');
  const ids = plan.blocks.map(b => b.id);
  assert.deepEqual(ids, ['prep', 'strength', 'arc']);
  assert.deepEqual(
    plan.blocks.map(b => [b.start, b.weeks]),
    [['2026-08-24', 3], ['2026-09-14', 12], ['2026-12-07', 26]]
  );
});

test('prep and strength are authored, arc is not', () => {
  assert.equal(plan.blocks.find(b => b.id === 'prep').authored, true);
  assert.equal(plan.blocks.find(b => b.id === 'strength').authored, true);
  assert.equal(plan.blocks.find(b => b.id === 'arc').authored, false);
});

test('prep progression is three build weeks', () => {
  assert.equal(plan.progression.prep.length, 3);
  assert.deepEqual(plan.progression.prep.map(w => w.type),
    ['build', 'build', 'build']);
});

test('weekend progression matches the written plan', () => {
  assert.deepEqual(plan.progression.prep.map(w => w.rideMin), [90, 100, 110]);
  assert.deepEqual(plan.progression.prep.map(w => w.runMin), [50, 55, 60]);
});
```

The `blocks are contiguous with no gap or overlap` test needs no change — it derives from the data and will now prove Prep → Strength → Arc line up.

- [ ] **Step 4: Update `tests/plan-model.test.js`**

Five existing tests reference the old calendar. Replace each:

```js
test('prep to strength boundary', () => {
  const last = dayForDate(plan, '2026-09-13');
  assert.equal(last.blockId, 'prep');
  assert.equal(last.week, 3);

  const first = dayForDate(plan, '2026-09-14');
  assert.equal(first.blockId, 'strength');
  assert.equal(first.week, 1);
  assert.equal(first.dayKey, 'mon');
});

test('strength to arc boundary', () => {
  assert.equal(dayForDate(plan, '2026-12-06').blockId, 'strength');
  assert.equal(dayForDate(plan, '2026-12-06').week, 12);
  assert.equal(dayForDate(plan, '2026-12-07').blockId, 'arc');
});

test('an unauthored block resolves to a stub with no days', () => {
  const w = resolveWeek(plan, 'arc', 1);
  assert.equal(w.authored, false);
  assert.deepEqual(w.days, []);
  assert.equal(w.startDate, '2026-12-07');
});

test('blocksInOrder sorts chronologically regardless of array order', () => {
  assert.deepEqual(blocksInOrder(plan).map(b => b.id), ['prep', 'strength', 'arc']);
  const shuffled = { ...plan, blocks: [...plan.blocks].reverse() };
  assert.deepEqual(blocksInOrder(shuffled).map(b => b.id), ['prep', 'strength', 'arc']);
});

test('weekNav walks across block boundaries', () => {
  // Last week of prep -> first week of strength, and back.
  assert.deepEqual(weekNav(plan, 'prep', 3).next, { blockId: 'strength', week: 1 });
  assert.deepEqual(weekNav(plan, 'strength', 1).prev, { blockId: 'prep', week: 3 });
  assert.deepEqual(weekNav(plan, 'strength', 12).next, { blockId: 'arc', week: 1 });
});
```

Delete outright — these assert Prep weeks that no longer exist, and the behaviour they cover is now tested on clones in Task 3:
- `prep week 4 is a recovery week`
- `recovery week cuts the tuesday bike and thursday run`
- `recovery week cuts mon and fri swims by 500m but not wednesday`
- `recovery week drops strength entirely`
- `week 8 wednesday uses the pacing-test structure only`
- any test calling `resolveWeek(plan, 'prep', N)` for N greater than 3, and any calling `weekNav(shuffled, 'prep', 8)`

For the shuffled-order `weekNav` test, change `'prep', 8` to `'prep', 3` and the expected `next` to `{ blockId: 'strength', week: 1 }`.

- [ ] **Step 5: Update the month-view tests in `tests/plan-model.test.js`**

Four `monthRows` tests assert October 2026 is Prep/Bridge. October is now entirely the Strength block. Replace them:

```js
test('monthRows returns Monday-first rows of seven cells', () => {
  const rows = monthRows(plan, '2026-10');
  assert.ok(rows.every(r => r.cells.length === 7));
  assert.deepEqual(rows[0].cells.slice(0, 3), [null, null, null]);
  assert.equal(rows[0].cells[3].date, '2026-10-01');
});

test('monthRows labels each row with the plan week it covers', () => {
  const rows = monthRows(plan, '2026-10');
  // Strength starts Mon 2026-09-14, so the week containing 2026-10-01 is W3.
  assert.equal(rows[0].week.blockId, 'strength');
  assert.equal(rows[0].week.week, 3);
  assert.equal(rows[0].week.blockLabel, 'Strength');
});

test('monthRows crosses a block boundary inside one month', () => {
  const cells = monthRows(plan, '2026-09').flatMap(r => r.cells).filter(Boolean);
  const byDate = Object.fromEntries(cells.map(c => [c.date, c]));

  // Prep runs through Sun 2026-09-13; Strength starts Mon 2026-09-14.
  assert.equal(byDate['2026-09-13'].blockId, 'prep');
  assert.equal(byDate['2026-09-13'].authored, true);
  assert.equal(byDate['2026-09-14'].blockId, 'strength');
  assert.equal(byDate['2026-09-14'].week, 1);
  assert.equal(byDate['2026-09-14'].authored, true);
});

test('monthRows gives an unauthored block no sessions rather than guessing', () => {
  const cell = monthRows(plan, '2026-12')
    .flatMap(r => r.cells).find(c => c && c.date === '2026-12-08');
  assert.equal(cell.blockLabel, 'Arc');
  assert.deepEqual(cell.sessions, []);
});

test('monthRows resolves sessions for an authored day with the same keys as the week view', () => {
  const cell = monthRows(plan, '2026-10')
    .flatMap(r => r.cells).find(c => c && c.date === '2026-10-06');  // a Tuesday
  const lift = cell.sessions.find(s => s.discipline === 'strength');
  assert.ok(lift, 'Tuesday in the GVT block prescribes a lift');
  assert.equal(lift.key, `${cell.blockId}:${cell.week}:tue:strength`);
});

test('monthRows flags recovery weeks so the calendar can mark them', () => {
  // Strength week 11 is the barbell deload: Mon 2026-11-23.
  const rows = monthRows(plan, '2026-11').filter(r => r.week);
  assert.ok(rows.some(r => r.week.type === 'recovery'),
    'the strength block deloads in November');
});
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS, every test. If anything is red, it is an old-calendar assertion missed in Steps 3–5 — the failure message names the file and line.

- [ ] **Step 7: Commit**

```bash
git add data/plan.json tests/plan-json.test.js tests/plan-model.test.js
git commit -m "feat: re-cut the calendar around the strength block"
```

---

### Task 7: Guard the data against silent breakage

**Files:**
- Test: `tests/plan-json.test.js`

**Interfaces:**
- Consumes: the finished `data/plan.json` from Task 6.
- Produces: no production code. These tests catch the failure modes that would otherwise ship looking fine.

**Why this is its own task:** the two bugs most likely to reach the page are a set line rendering as literal `{gvt}`, and two sessions on one day colliding on their key so one silently disappears. Neither throws. Both are invisible until someone reads a workout and finds it wrong.

- [ ] **Step 1: Write the tests**

Add to `tests/plan-json.test.js`:

```js
test('every placeholder in a template is supplied by every week that uses it', () => {
  // A set line reading "Bench Press {gvt}" renders that literally on the page.
  // Nothing throws, so only this test catches it.
  const PLACEHOLDER = /\{(\w+)\}/g;

  for (const [name, tpl] of Object.entries(plan.weekTemplates)) {
    const needed = new Set();
    for (const sessions of Object.values(tpl.days)) {
      for (const s of sessions) {
        for (const line of s.setLines || []) {
          for (const [, key] of line.matchAll(PLACEHOLDER)) needed.add(key);
        }
      }
    }

    const users = Object.values(plan.progression)
      .flat()
      .filter(w => w.template === name);
    assert.ok(users.length > 0, `template ${name} is never used`);

    for (const week of users) {
      for (const key of needed) {
        assert.ok(week[key] !== undefined,
          `${name} week ${week.week} does not supply {${key}}`);
      }
    }
  }
});

test('every template names a progression that exists, and vice versa', () => {
  for (const rows of Object.values(plan.progression)) {
    for (const w of rows) {
      if (!w.template) continue;
      assert.ok(plan.weekTemplates[w.template],
        `week ${w.week} names missing template ${w.template}`);
    }
  }
});

test('no day prescribes two sessions of the same discipline', () => {
  // Session keys are blockId:week:day:discipline. A duplicate discipline on
  // one day collides, and the second session vanishes from the log silently.
  const sources = [
    ['skeleton', plan.skeleton],
    ...Object.entries(plan.weekTemplates).map(([n, t]) => [n, t.days])
  ];

  for (const [name, days] of sources) {
    for (const [dayKey, sessions] of Object.entries(days)) {
      const seen = sessions.map(s => s.discipline);
      assert.equal(new Set(seen).size, seen.length,
        `${name}.${dayKey} has two sessions of one discipline: ${seen.join(', ')}`);
    }
  }
});

test('every prescribed session carries a usable metric', () => {
  const sources = [plan.skeleton, ...Object.values(plan.weekTemplates).map(t => t.days)];
  for (const days of sources) {
    for (const sessions of Object.values(days)) {
      for (const s of sessions) {
        assert.ok(['distance', 'duration'].includes(s.prescribed.metric),
          `${s.title} has metric ${s.prescribed.metric}`);
        const resolvable = s.prescribed.value !== null || s.prescribed.fromProgression;
        assert.ok(resolvable, `${s.title} has neither a value nor a progression key`);
      }
    }
  }
});
```

- [ ] **Step 2: Run the tests**

Run: `npm test`
Expected: PASS. A failure here is a real data bug from Tasks 4–6, not a bad test — read the message and fix `data/plan.json`.

- [ ] **Step 3: Prove the placeholder test actually catches something**

Temporarily break the data to confirm the guard works, then undo it:

```bash
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('data/plan.json','utf8'));p.weekTemplates.gvtA.days.mon[0].setLines[0]='Bench Press {nonesuch}';fs.writeFileSync('data/plan.json',JSON.stringify(p,null,2))"
npm test
git checkout data/plan.json
```

Expected: the middle command FAILS with `gvtA week 1 does not supply {nonesuch}`. The `git checkout` restores the file. Run `npm test` once more to confirm it is green again.

- [ ] **Step 4: Commit**

```bash
git add tests/plan-json.test.js
git commit -m "test: guard against unfilled placeholders and key collisions"
```

---

### Task 8: Update the README and verify end to end

**Files:**
- Modify: `README.md`
- Test: manual browser check

**Interfaces:**
- Consumes: the finished plan from Tasks 1–7.
- Produces: documentation matching the shipped data. No code change.

- [ ] **Step 1: Rewrite the calendar table in `README.md`**

Replace the existing Calendar section table and the sentence beneath it with:

```markdown
| Block | Weeks | Start | End |
|---|---|---|---|
| Prep | 3 | 2026-08-24 | 2026-09-13 |
| Strength | 12 | 2026-09-14 | 2026-12-06 |
| Arc | 26 | 2026-12-07 | 2027-06-06 |

Prep and Arc both number weeks from 1, so week labels always name their block.

The Strength block is a lifting cycle: five mornings a week for weeks 1–8 (GVT),
then three for weeks 9–12 (powerbuilding) as cardio ramps back up. Its weeks come
from `weekTemplates` in `plan.json` rather than the global `skeleton`, because its
shape alternates week to week.
```

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: PASS, every test.

- [ ] **Step 3: Check it in a browser**

```bash
python -m http.server 8000
```

Open `http://localhost:8000/#/month/2026-10` and confirm:
- The gutter reads `Strength W3` through `Strength W7`.
- Weekday cells carry lilac strength dots at **full** opacity, not the 50% dimming that marks optional sessions.
- Clicking 2026-10-06 opens a Tuesday with a `Lower Body` lift and a `Technique swim`.
- The lift's set list shows `Barbell Squat 3×8-10` — 2026-10-06 falls in week 4, which is a `gvtB` week. (`5×5 (75% 1RM)` is the `gvtA` Tuesday; you would see that on 2026-10-13.) No literal `{` anywhere on the page.

Then `http://localhost:8000/#/day/2026-09-16` (a GVT-A Wednesday) and confirm the deadlift line reads `Deadlift 10×10`, not `Deadlift {gvt}`.

Then `http://localhost:8000/#/week/strength/11` and confirm the heading says `Strength W11 · recovery week` and the lifting sessions are still present.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: describe the strength block in the calendar table"
```

- [ ] **Step 5: Report completion**

Do not merge or push. Report which tasks completed, the final `npm test` count, and anything that did not match the expectations in Step 3.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §2 Calendar changes | Task 6 |
| §3 Weeks 1–8 schedule | Task 4 |
| §3 Weeks 9–12 schedule, PPL ordering | Task 5 |
| §4.2 `weekSource` + `weekTemplates` | Tasks 1, 4 |
| §4.2 Placeholder interpolation | Task 2 |
| §4.2 `fromProgression` reuse | Task 5 (sat/sun in `ppl`) |
| §4.3 Progression values | Tasks 4, 5 |
| §4.4 `resolveWeek` branch | Task 1 |
| §4.4 Recovery guard | Task 3 |
| §4.4 Key collision assertion | Task 7 |
| §4.5 Nutrition `lift` type + template day types | Tasks 1 (engine), 4 (data) |
| §5 Full-opacity dots | Task 8 Step 3 (verification only — no code change needed, since the templates simply omit `optional`) |
| §5 README | Task 8 |
| §6 Testing | Tasks 1–7 |

No gaps.

**Type consistency:** `weekSource` (string, `"weekTemplates"`), `weekTemplates[name].days` (day key → array), `weekTemplates[name].dayTypes` (day key → nutrition type key), `progression[block][n].template` (string) and `fillPlaceholders(line, progression)` are used identically in every task that references them.

**Known cost:** Task 6 deletes five recovery-behaviour tests from `plan-model.test.js`. Task 3 replaces their coverage with a clone-based test that does not depend on production data containing a recovery week — which is why Task 3 comes first.
