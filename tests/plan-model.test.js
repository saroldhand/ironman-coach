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
  // A two-week taper: race-specific work runs to May 23.
  assert.equal(dayForDate(plan, '2027-05-23').phaseLabel, 'Race-specific');
  assert.equal(dayForDate(plan, '2027-05-24').phaseLabel, 'Taper');
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

// Every live block is authored, so the unwritten-block path is exercised on a
// clone - it is what any future block shows before its weeks are written.
function withArcUnwritten() {
  const p = JSON.parse(JSON.stringify(plan));
  p.blocks.find(b => b.id === 'arc').authored = false;
  return p;
}

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

test('an unauthored block resolves to a stub with no days', () => {
  const w = resolveWeek(withArcUnwritten(), 'arc', 1);
  assert.equal(w.authored, false);
  assert.deepEqual(w.days, []);
  assert.equal(w.startDate, '2026-12-07');
});

test('a build week has seven dated days starting Monday', () => {
  const w = resolveWeek(plan, 'prep', 1);
  assert.equal(w.days.length, 7);
  assert.deepEqual(w.days.map(d => d.dayKey), ['mon','tue','wed','thu','fri','sat','sun']);
  assert.equal(w.days[0].date, '2026-08-24');
  assert.equal(w.days[6].date, '2026-08-30');
});

test('weekend durations come from the progression table', () => {
  // Two consumers of fromProgression: the skeleton path (prep, a plain
  // block) and the template path (strength, a weekTemplates block). Both
  // must resolve their sat/sun duration from that week's progression row,
  // and the fromProgression marker must not leak into the resolved object.
  const prepRow = plan.progression.prep.find(w => w.week === 1);
  const prepWeek = resolveWeek(plan, 'prep', 1);
  const prepSat = prepWeek.days.find(d => d.dayKey === 'sat').sessions.find(s => s.discipline === 'bike');
  const prepSun = prepWeek.days.find(d => d.dayKey === 'sun').sessions.find(s => s.discipline === 'run');
  assert.equal(prepSat.prescribed.value, prepRow.rideMin);
  assert.equal(typeof prepSat.prescribed.value, 'number');
  assert.ok(!('fromProgression' in prepSat.prescribed));
  assert.equal(prepSun.prescribed.value, prepRow.runMin);
  assert.equal(typeof prepSun.prescribed.value, 'number');
  assert.ok(!('fromProgression' in prepSun.prescribed));

  const strengthRow = plan.progression.strength.find(w => w.week === 12);
  const strengthWeek = resolveWeek(plan, 'strength', 12);
  const liftSat = strengthWeek.days.find(d => d.dayKey === 'sat').sessions.find(s => s.discipline === 'bike');
  const liftSun = strengthWeek.days.find(d => d.dayKey === 'sun').sessions.find(s => s.discipline === 'run');
  assert.equal(liftSat.prescribed.value, strengthRow.rideMin);
  assert.equal(typeof liftSat.prescribed.value, 'number');
  assert.ok(!('fromProgression' in liftSat.prescribed));
  assert.equal(liftSun.prescribed.value, strengthRow.runMin);
  assert.equal(typeof liftSun.prescribed.value, 'number');
  assert.ok(!('fromProgression' in liftSun.prescribed));
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

  const week4 = resolveWeek(p, 'prep', 4);
  const dayOf = k => week4.days.find(d => d.dayKey === k);

  const fri = dayOf('fri');
  assert.equal(fri.sessions.filter(s => s.discipline === 'strength').length, 0,
    'recovery drops the optional strength circuit');
  assert.equal(dayOf('tue').sessions[0].prescribed.value, 40,
    'recovery shortens the tuesday bike');

  const thu = dayOf('thu').sessions[0];
  assert.equal(thu.prescribed.value, 30, 'recovery shortens the thursday run');
  assert.ok(!thu.detail.some(line => line.toLowerCase().includes('stride')),
    'strides are dropped from the thursday detail');

  assert.equal(dayOf('mon').sessions.find(s => s.discipline === 'swim').prescribed.value, 1300,
    'recovery cuts the monday swim by 500m');
  assert.equal(fri.sessions.find(s => s.discipline === 'swim').prescribed.value, 1500,
    'recovery cuts the friday swim by 500m');
  assert.equal(dayOf('wed').sessions.find(s => s.discipline === 'swim').prescribed.value, 1700,
    "wednesday's swim is immune to the recovery delta - its cut is already in wedDistance");
});

test('the skeleton swim rules do not reach a template block', () => {
  // Deriving a swim from the weekday is a tri-skeleton rule: Wednesday's
  // metres come from progression.wedDistance, Monday and Friday inherit
  // plan.sets. A lifting week supplies neither, so ungated a template
  // Wednesday swim resolves to prescribed.value === undefined - which throws
  // in render.js at p.value.toLocaleString() - and a template Monday or
  // Friday swim silently inherits a triathlon set.
  const p = templatePlan();
  p.sets = {
    monTechnique: ['TRI monday technique set'],
    friMixed: ['TRI friday mixed set'],
    wedMain: { warmup: ['TRI wednesday warmup'], cooldown: ['TRI wednesday cooldown'] }
  };
  p.weekTemplates.alpha.days.wed = [{
    discipline: 'swim', title: 'Alpha wednesday swim',
    prescribed: { metric: 'distance', value: 1200, unit: 'm' },
    effort: 'Easy.', setLines: ['Alpha wednesday set']
  }];
  p.weekTemplates.alpha.days.fri = [{
    discipline: 'swim', title: 'Alpha friday swim',
    prescribed: { metric: 'distance', value: 1100, unit: 'm' },
    effort: 'Easy.'
  }];
  // A strength progression row carries no wedDistance, and never would.
  assert.equal(p.progression.lift[0].wedDistance, undefined);

  const w = resolveWeek(p, 'lift', 1);
  const swimOn = k =>
    w.days.find(d => d.dayKey === k).sessions.find(s => s.discipline === 'swim');

  const wed = swimOn('wed');
  assert.equal(wed.prescribed.value, 1200, 'the template swim keeps its own distance');
  assert.deepEqual(wed.setLines, ['Alpha wednesday set']);

  const fri = swimOn('fri');
  assert.equal(fri.prescribed.value, 1100);
  assert.deepEqual(fri.setLines, [],
    'a template swim with no set lines gets none, not the triathlon set');
});

test('each day carries its nutrition day type', () => {
  const w = resolveWeek(plan, 'prep', 1);
  assert.equal(w.days.find(d => d.dayKey === 'mon').nutrition.label, 'Low day');
  assert.equal(w.days.find(d => d.dayKey === 'sat').nutrition.label, 'Big day');
});

test('a template block reads its nutrition from the template, not the global map', () => {
  // Strength week 1 runs gvtA: five lifting mornings, so Monday is a lifting
  // day and Sunday is the light one. The global map says the opposite on both
  // - 'low' on Monday, 'big' on Sunday - so dropping the template's dayTypes
  // override would show Monday as "Low day / ~500 kcal deficit" in a week
  // that is meant to hold maintenance calories.
  assert.equal(plan.nutrition.dayTypes.mon, 'low');
  assert.equal(plan.nutrition.dayTypes.sun, 'big');

  const w = resolveWeek(plan, 'strength', 1);
  assert.equal(w.days.find(d => d.dayKey === 'mon').nutrition.label, 'Lifting day');
  assert.equal(w.days.find(d => d.dayKey === 'sun').nutrition.label, 'Low day');
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

test('weekNav returns null at both ends of the plan', () => {
  assert.equal(weekNav(plan, 'prep', 1).prev, null);
  assert.equal(weekNav(plan, 'arc', 26).next, null);
});

test('weekNav does not depend on the order blocks appear in plan.json', () => {
  const shuffled = { ...plan, blocks: [...plan.blocks].reverse() };
  assert.deepEqual(weekNav(shuffled, 'prep', 3).next, { blockId: 'strength', week: 1 });
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
  const cell = monthRows(withArcUnwritten(), '2026-12')
    .flatMap(r => r.cells).find(c => c && c.date === '2026-12-08');
  assert.equal(cell.blockLabel, 'Arc');
  assert.equal(cell.authored, false);
  assert.deepEqual(cell.sessions, []);
});

test('monthRows resolves sessions for an authored day with the same keys as the week view', () => {
  const cell = monthRows(plan, '2026-10')
    .flatMap(r => r.cells).find(c => c && c.date === '2026-10-06');  // a Tuesday
  const lift = cell.sessions.find(s => s.discipline === 'strength');
  assert.ok(lift, 'Tuesday in the GVT block prescribes a lift');
  assert.equal(lift.key, `${cell.blockId}:${cell.week}:tue:strength`);
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
  // Strength week 11 is the barbell deload: Mon 2026-11-23.
  const rows = monthRows(plan, '2026-11').filter(r => r.week);
  assert.ok(rows.some(r => r.week.type === 'recovery'),
    'the strength block deloads in November');
});

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

test('the wednesday main set advances with the week', () => {
  // Every prep week carries wedMainSet, and swimSetLines() splices it between
  // the shared wedMain warmup and cooldown. Two ways that breaks. The line
  // stops tracking the row - which every prep week must be checked against,
  // since they do not all prescribe the same set and one hardcoded line
  // cannot satisfy all three. Or the row loses the key, and the page reads
  // "MAIN SET: undefined" - reading the row straight into the expectation
  // would happily agree, so its presence is asserted separately.
  const { warmup, cooldown } = plan.sets.wedMain;
  const distinct = new Set();

  for (const row of plan.progression.prep) {
    assert.equal(typeof row.wedMainSet, 'string', `week ${row.week} names a main set`);
    assert.ok(row.wedMainSet.length > 0, `week ${row.week} names a main set`);
    distinct.add(row.wedMainSet);

    const wed = resolveWeek(plan, 'prep', row.week).days.find(d => d.dayKey === 'wed');
    const swim = wed.sessions.find(s => s.discipline === 'swim');
    assert.deepEqual(swim.setLines,
      [...warmup, `MAIN SET: ${row.wedMainSet}`, ...cooldown], `week ${row.week}`);
  }

  assert.ok(distinct.size > 1,
    'the prep weeks all prescribe the same main set - this test no longer discriminates');
});

test('interpolation does not disturb a skeleton block swim set', () => {
  const wed = resolveWeek(plan, 'prep', 1).days.find(d => d.dayKey === 'wed');
  const swim = wed.sessions.find(s => s.discipline === 'swim');
  assert.ok(swim.setLines.length > 0);
  assert.ok(swim.setLines.every(l => !l.includes('{')));
});

test('literal template setLines win over the weekday-derived swim set', () => {
  // A session carrying both discipline: 'swim' and its own setLines only
  // occurs in weekTemplates, not in skeleton blocks. Its literal lines are
  // what must reach the page: the swim branch must neither clobber them nor
  // run at all here.
  const p = templatePlan();
  // Tuesday is chosen because swimSetLines() returns [] for tue (unlike
  // wed/mon/fri), so the template's lines are visibly distinct from what the
  // swim branch would produce.
  p.weekTemplates.alpha.days.tue = [{
    discipline: 'swim',
    title: 'Swim {main}',
    prescribed: { metric: 'distance', value: 1500, unit: 'm' },
    effort: 'Steady.',
    setLines: ['{main} × 100 steady']
  }];
  p.progression.lift[0].main = 'technique';

  const tue = resolveWeek(p, 'lift', 1).days.find(d => d.dayKey === 'tue');
  const swim = tue.sessions.find(s => s.discipline === 'swim');
  // The interpolated template.setLines survive intact.
  assert.deepEqual(swim.setLines, ['technique × 100 steady']);
});

test('placeholders fill titles, efforts and detail lines, not only set lines', () => {
  // One Arc template serves easy, test and interval weeks alike, so the words
  // that name a session have to change with the row - not just its set lines.
  const p = templatePlan();
  Object.assign(p.weekTemplates.alpha.days.mon[0], {
    title: '{liftTitle}',
    effort: '{liftEffort} - then rest.',
    detail: ['Note: {liftNote}']
  });
  Object.assign(p.progression.lift[0],
    { liftTitle: 'Light lift', liftEffort: 'One fewer set', liftNote: 'easy week' });

  const s = resolveWeek(p, 'lift', 1).days.find(d => d.dayKey === 'mon').sessions[0];
  assert.equal(s.title, 'Light lift');
  assert.equal(s.effort, 'One fewer set - then rest.');
  assert.deepEqual(s.detail, ['Note: easy week']);
});

test('a session with no effort or detail still resolves', () => {
  const p = templatePlan();
  delete p.weekTemplates.alpha.days.mon[0].effort;

  const s = resolveWeek(p, 'lift', 1).days.find(d => d.dayKey === 'mon').sessions[0];
  assert.equal(s.effort, undefined);
  assert.deepEqual(s.detail, []);
});

test('a week template overrides fuelling rules one by one, like day types', () => {
  // Race-specific long rides train the gut at 75-90 g/hr; base ones fuel at
  // 60. A template that changes only the long-ride rule must still inherit
  // the global short-session and recovery rules, so the maps merge.
  const p = templatePlan();
  p.nutrition.fuel = { under75min: 'Water.', longRide: 'Global ride.',
                       longRun: 'Global run.', post: 'Global post.' };
  p.weekTemplates.alpha.fuel = { longRide: 'Template ride.' };

  const mon = resolveWeek(p, 'lift', 1).days.find(d => d.dayKey === 'mon');
  assert.deepEqual(mon.fuel, { under75min: 'Water.', longRide: 'Template ride.',
                               longRun: 'Global run.', post: 'Global post.' });
});

test('a skeleton block day carries the global fuelling rules', () => {
  const tue = resolveWeek(plan, 'prep', 1).days.find(d => d.dayKey === 'tue');
  assert.deepEqual(tue.fuel, plan.nutrition.fuel);
});

test('race day resolves to the three legs at full 70.3 distance', () => {
  const sat = resolveWeek(plan, 'arc', 26).days.find(d => d.dayKey === 'sat');
  assert.equal(sat.date, plan.race.date);
  assert.deepEqual(sat.sessions.map(s => [s.discipline, s.prescribed.metric, s.prescribed.value]),
    [['swim', 'distance', 1900], ['bike', 'distance', 90000], ['run', 'distance', 21100]]);
  assert.equal(sat.nutrition.label, 'Race day');
});

test('no arc week leaves a placeholder unfilled or an amount missing', () => {
  // The guard in plan-json checks the rows supply each key; this checks what
  // actually reaches the page, through the real resolver, for all 26 weeks.
  for (let week = 1; week <= 26; week++) {
    for (const day of resolveWeek(plan, 'arc', week).days) {
      for (const s of day.sessions) {
        for (const text of [s.title, s.effort, ...s.setLines, ...s.detail]) {
          assert.ok(!/\{\w+\}/.test(text), `arc W${week} ${day.dayKey} ${s.title}: ${text}`);
        }
        assert.equal(typeof s.prescribed.value, 'number', `arc W${week} ${day.dayKey} ${s.title}`);
      }
    }
  }
});

test('race-specific weeks fuel the long ride at race rates, base weeks do not', () => {
  const satFuel = week => resolveWeek(plan, 'arc', week).days.find(d => d.dayKey === 'sat').fuel;
  assert.equal(satFuel(1).longRide, plan.nutrition.fuel.longRide);
  assert.match(satFuel(21).longRide, /75-90g/);
  assert.equal(satFuel(21).under75min, plan.nutrition.fuel.under75min,
    'a template that overrides one rule keeps the rest');
});
