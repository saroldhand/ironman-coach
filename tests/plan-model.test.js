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
