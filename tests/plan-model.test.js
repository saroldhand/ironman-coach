import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dayForDate, planStart } from '../assets/plan-model.js';

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

test('block order in plan.json does not affect the result', () => {
  const shuffled = { ...plan, blocks: [...plan.blocks].reverse() };

  // A prep date must still resolve, even with arc listed first.
  const d = dayForDate(shuffled, '2026-08-24');
  assert.equal(d.inPlan, true);
  assert.equal(d.blockId, 'prep');
  assert.equal(d.week, 1);

  // And the out-of-plan reasons must still be the right way round.
  assert.deepEqual(dayForDate(shuffled, '2026-08-23'), { inPlan: false, reason: 'before-start' });
  assert.deepEqual(dayForDate(shuffled, '2027-06-07'), { inPlan: false, reason: 'after-end' });
});

test('planStart is the earliest block regardless of array order', () => {
  assert.equal(planStart(plan), '2026-08-24');
  assert.equal(planStart({ ...plan, blocks: [...plan.blocks].reverse() }), '2026-08-24');
});

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
