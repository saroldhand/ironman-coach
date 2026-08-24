import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blocksInOrder } from '../assets/plan-model.js';
import { addDays } from '../assets/date-utils.js';

const plan = JSON.parse(readFileSync(new URL('../data/plan.json', import.meta.url)));

test('race date and blocks are anchored correctly', () => {
  assert.equal(plan.race.date, '2027-06-05');
  const ids = plan.blocks.map(b => b.id);
  assert.deepEqual(ids, ['prep', 'strength', 'arc']);
  assert.deepEqual(
    plan.blocks.map(b => [b.start, b.weeks]),
    [['2026-08-24', 3], ['2026-09-14', 12], ['2026-12-07', 26]]
  );
});

test('blocks are contiguous with no gap or overlap', () => {
  const ordered = blocksInOrder(plan);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    assert.equal(addDays(prev.start, prev.weeks * 7), ordered[i].start);
  }
});

test('prep and strength are authored, arc is not', () => {
  assert.equal(plan.blocks.find(b => b.id === 'prep').authored, true);
  assert.equal(plan.blocks.find(b => b.id === 'strength').authored, true);
  assert.equal(plan.blocks.find(b => b.id === 'arc').authored, false);
});

test('skeleton covers all seven days', () => {
  assert.deepEqual(Object.keys(plan.skeleton), ['mon','tue','wed','thu','fri','sat','sun']);
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

  // A block whose weekSource is 'weekTemplates' resolves through
  // plan.weekTemplates[progression.template] in resolveWeek. If a row in
  // such a block loses its template key, resolveWeek does not throw - it
  // silently falls back to the tri-discipline skeleton for what should be
  // a lifting week. The loop above only catches a *named* missing template;
  // this catches a row that should have named one and didn't.
  for (const [blockId, rows] of Object.entries(plan.progression)) {
    const block = plan.blocks.find(b => b.id === blockId);
    if (!block || block.weekSource !== 'weekTemplates') continue;
    for (const w of rows) {
      assert.ok(w.template, `${blockId} week ${w.week} is missing its template`);
      assert.ok(plan.weekTemplates[w.template],
        `${blockId} week ${w.week} names missing template ${w.template}`);
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
        const resolvable = s.prescribed.value != null || s.prescribed.fromProgression;
        assert.ok(resolvable, `${s.title} has neither a value nor a progression key`);
      }
    }
  }
});
