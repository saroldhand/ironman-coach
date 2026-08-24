import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blocksInOrder } from '../assets/plan-model.js';
import { addDays } from '../assets/date-utils.js';

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
  const ordered = blocksInOrder(plan);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    assert.equal(addDays(prev.start, prev.weeks * 7), ordered[i].start);
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
