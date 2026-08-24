import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dayForDate, planStart, blocksInOrder, weekNav, monthRows } from '../assets/plan-model.js';

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

// A minimal plan exercising weekTemplates, independent of data/plan.json.
function templatePlan() {
  return {
    race: { name: 'Test', date: '2027-06-05' },
    blocks: [
      { id: 'lift', label: 'Lift', start: '2026-09-14', weeks: 2,
        authored: true, weekSource: 'weekTemplates' }
    ],
    skeleton: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [{ discipline: 'bike', title: 'Skeleton bike', prescribed: { metric: 'duration', value: 90, unit: 'min' }, effort: 'Easy.' }], sun: [] },
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

test('blocksInOrder sorts chronologically regardless of array order', () => {
  assert.deepEqual(blocksInOrder(plan).map(b => b.id), ['prep', 'bridge', 'arc']);
  const shuffled = { ...plan, blocks: [...plan.blocks].reverse() };
  assert.deepEqual(blocksInOrder(shuffled).map(b => b.id), ['prep', 'bridge', 'arc']);
});

test('weekNav walks across block boundaries', () => {
  // Last week of prep -> first week of bridge, and back.
  assert.deepEqual(weekNav(plan, 'prep', 8).next, { blockId: 'bridge', week: 1 });
  assert.deepEqual(weekNav(plan, 'bridge', 1).prev, { blockId: 'prep', week: 8 });
  assert.deepEqual(weekNav(plan, 'bridge', 7).next, { blockId: 'arc', week: 1 });
});

test('weekNav returns null at both ends of the plan', () => {
  assert.equal(weekNav(plan, 'prep', 1).prev, null);
  assert.equal(weekNav(plan, 'arc', 26).next, null);
});

test('weekNav does not depend on the order blocks appear in plan.json', () => {
  const shuffled = { ...plan, blocks: [...plan.blocks].reverse() };
  assert.deepEqual(weekNav(shuffled, 'prep', 8).next, { blockId: 'bridge', week: 1 });
  assert.equal(weekNav(shuffled, 'prep', 1).prev, null);
  assert.equal(weekNav(shuffled, 'arc', 26).next, null);
});

test('monthRows returns Monday-first rows of seven cells', () => {
  const rows = monthRows(plan, '2026-10');
  assert.ok(rows.every(r => r.cells.length === 7));
  assert.deepEqual(rows[0].cells.slice(0, 3), [null, null, null]);
  assert.equal(rows[0].cells[3].date, '2026-10-01');
});

test('monthRows labels each row with the plan week it covers', () => {
  const rows = monthRows(plan, '2026-10');
  // Prep starts Mon 2026-08-24, so the week containing 2026-10-01 is Prep W6.
  assert.equal(rows[0].week.blockId, 'prep');
  assert.equal(rows[0].week.week, 6);
  assert.equal(rows[0].week.blockLabel, 'Prep');
});

test('monthRows crosses a block boundary inside one month', () => {
  const rows = monthRows(plan, '2026-10');
  const cells = rows.flatMap(r => r.cells).filter(Boolean);
  const byDate = Object.fromEntries(cells.map(c => [c.date, c]));

  // Prep runs through Sun 2026-10-18; Bridge starts Mon 2026-10-19.
  assert.equal(byDate['2026-10-18'].blockId, 'prep');
  assert.equal(byDate['2026-10-18'].authored, true);
  assert.equal(byDate['2026-10-19'].blockId, 'bridge');
  assert.equal(byDate['2026-10-19'].week, 1);
  assert.equal(byDate['2026-10-19'].authored, false);
});

test('monthRows gives an unauthored block no sessions rather than guessing', () => {
  const cell = monthRows(plan, '2026-10')
    .flatMap(r => r.cells).find(c => c && c.date === '2026-10-20');
  assert.equal(cell.blockLabel, 'Bridge');
  assert.deepEqual(cell.sessions, []);
});

test('monthRows resolves sessions for an authored day with the same keys as the week view', () => {
  const cell = monthRows(plan, '2026-10')
    .flatMap(r => r.cells).find(c => c && c.date === '2026-10-06');  // a Tuesday inside the authored Prep block
  const bike = cell.sessions.find(s => s.discipline === 'bike');
  assert.ok(bike, 'Tuesday prescribes a bike session');
  assert.equal(bike.key, `${cell.blockId}:${cell.week}:tue:bike`);
});

test('monthRows marks dates outside every block as not in the plan', () => {
  const rows = monthRows(plan, '2026-08');
  const cells = rows.flatMap(r => r.cells).filter(Boolean);
  const before = cells.find(c => c.date === '2026-08-23');
  assert.equal(before.inPlan, false);
  assert.deepEqual(before.sessions, []);
  assert.equal(cells.find(c => c.date === '2026-08-24').inPlan, true);
});

test('monthRows leaves a row with no plan days unlabelled', () => {
  // The first week of August 2026 is entirely before the plan starts.
  assert.equal(monthRows(plan, '2026-08')[0].week, null);
});

test('monthRows flags recovery weeks so the calendar can mark them', () => {
  const rows = monthRows(plan, '2026-09').filter(r => r.week);
  assert.ok(rows.some(r => r.week.type === 'recovery'),
    'the prep block has at least one recovery week in September');
});
