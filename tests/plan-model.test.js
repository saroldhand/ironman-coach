import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dayForDate, planStart, blocksInOrder, weekNav, monthRows } from '../assets/plan-model.js';

const plan = JSON.parse(readFileSync(new URL('../data/plan.json', import.meta.url)));

test('a date before the plan starts is not in the plan', () => {
  assert.deepEqual(dayForDate(plan, '2026-11-08'), { inPlan: false, reason: 'before-start' });
});

test('a date after the plan ends is not in the plan', () => {
  assert.deepEqual(dayForDate(plan, '2027-06-07'), { inPlan: false, reason: 'after-end' });
});

test('first day of the plan is Bridge week 1 Monday', () => {
  const d = dayForDate(plan, '2026-11-09');
  assert.equal(d.blockId, 'bridge');
  assert.equal(d.week, 1);
  assert.equal(d.dayKey, 'mon');
  assert.equal(d.weekType, 'build');
  assert.equal(d.authored, true);
});

test('bridge to arc boundary', () => {
  assert.equal(dayForDate(plan, '2026-12-06').blockId, 'bridge');
  assert.equal(dayForDate(plan, '2026-12-06').week, 4);
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
  // A two-week taper: race-specific work runs to May 23.
  assert.equal(dayForDate(plan, '2027-05-23').phaseLabel, 'Race-specific');
  assert.equal(dayForDate(plan, '2027-05-24').phaseLabel, 'Taper');
  assert.equal(dayForDate(plan, '2026-11-09').phaseLabel, null, 'the Bridge has no phases');
});

test('block order in plan.json does not affect the result', () => {
  const shuffled = { ...plan, blocks: [...plan.blocks].reverse() };

  // A Bridge date must still resolve, even with arc listed first.
  const d = dayForDate(shuffled, '2026-11-09');
  assert.equal(d.inPlan, true);
  assert.equal(d.blockId, 'bridge');
  assert.equal(d.week, 1);

  // And the out-of-plan reasons must still be the right way round.
  assert.deepEqual(dayForDate(shuffled, '2026-11-08'), { inPlan: false, reason: 'before-start' });
  assert.deepEqual(dayForDate(shuffled, '2027-06-07'), { inPlan: false, reason: 'after-end' });
});

test('planStart is the earliest block regardless of array order', () => {
  assert.equal(planStart(plan), '2026-11-09');
  assert.equal(planStart({ ...plan, blocks: [...plan.blocks].reverse() }), '2026-11-09');
});

import { resolveWeek } from '../assets/plan-model.js';

// Every live block is authored, so the unwritten-block path is exercised on a
// clone - it is what any future block shows before its weeks are written.
function withArcUnwritten() {
  const p = JSON.parse(JSON.stringify(plan));
  p.blocks.find(b => b.id === 'arc').authored = false;
  return p;
}

// A minimal plan, independent of data/plan.json.
function templatePlan() {
  return {
    race: { name: 'Test', date: '2027-06-05' },
    blocks: [
      { id: 'lift', label: 'Lift', start: '2026-09-14', weeks: 2, authored: true }
    ],
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
    nutrition: {
      types: { big: { label: 'Big day', approach: 'Eat.' },
               low: { label: 'Low day', approach: 'Less.' } }
    }
  };
}

test('resolveWeek reads a week from the template its row names', () => {
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

test('an unauthored block resolves to a stub with no days', () => {
  const w = resolveWeek(withArcUnwritten(), 'arc', 1);
  assert.equal(w.authored, false);
  assert.deepEqual(w.days, []);
  assert.equal(w.startDate, '2026-12-07');
});

test('a build week has seven dated days starting Monday', () => {
  const w = resolveWeek(plan, 'bridge', 1);
  assert.equal(w.days.length, 7);
  assert.deepEqual(w.days.map(d => d.dayKey), ['mon','tue','wed','thu','fri','sat','sun']);
  assert.equal(w.days[0].date, '2026-11-09');
  assert.equal(w.days[6].date, '2026-11-15');
});

test('amounts that change week to week come from the progression row', () => {
  // The fromProgression marker must resolve to that week's number and must
  // not leak into the resolved object.
  for (const [blockId, week] of [['bridge', 2], ['arc', 14]]) {
    const row = plan.progression[blockId].find(w => w.week === week);
    const days = resolveWeek(plan, blockId, week).days;
    const on = (k, d) => days.find(x => x.dayKey === k).sessions.find(s => s.discipline === d);
    for (const [s, key] of [[on('sat', 'bike'), 'rideMin'], [on('sun', 'run'), 'runMin'],
                            [on('wed', 'swim'), 'wedSwimM'], [on('mon', 'run'), 'monRunMin']]) {
      assert.equal(s.prescribed.value, row[key], `${blockId} W${week} ${key}`);
      assert.equal(typeof s.prescribed.value, 'number');
      assert.ok(!('fromProgression' in s.prescribed));
    }
  }
});

test('session keys are stable and block-qualified', () => {
  const w = resolveWeek(plan, 'bridge', 1);
  const keys = w.days.find(d => d.dayKey === 'mon').sessions.map(s => s.key);
  assert.deepEqual(keys, ['bridge:1:mon:swim', 'bridge:1:mon:strength', 'bridge:1:mon:run']);
});

test('monday is the swim, then strength in the same trip, then the lunch run', () => {
  const mon = resolveWeek(plan, 'arc', 5).days.find(d => d.dayKey === 'mon');
  assert.deepEqual(mon.sessions.map(s => [s.discipline, s.when]),
    [['swim', 'before-work'], ['strength', 'before-work'], ['run', 'lunch']]);
});

test('a recovery week is lighter only because its row says so', () => {
  // No rule cuts sessions from a recovery week: its lighter numbers live in
  // its progression row, and the type is only the label.
  const p = templatePlan();
  p.progression.lift[0].type = 'recovery';

  const w = resolveWeek(p, 'lift', 1);
  const mon = w.days.find(d => d.dayKey === 'mon');
  assert.equal(mon.sessions.length, 1, 'the session survives the recovery week');
  assert.equal(mon.sessions[0].prescribed.value, 60);
  assert.equal(w.type, 'recovery', 'and the week is labelled recovery');
});

test('each day carries the nutrition day type its template names', () => {
  const w = resolveWeek(plan, 'bridge', 1);
  assert.equal(w.days.find(d => d.dayKey === 'mon').nutrition.label, 'Moderate day');
  assert.equal(w.days.find(d => d.dayKey === 'wed').nutrition.label, 'Low day');
  assert.equal(w.days.find(d => d.dayKey === 'sat').nutrition.label, 'Big day');
});

test('blocksInOrder sorts chronologically regardless of array order', () => {
  assert.deepEqual(blocksInOrder(plan).map(b => b.id), ['bridge', 'arc']);
  const shuffled = { ...plan, blocks: [...plan.blocks].reverse() };
  assert.deepEqual(blocksInOrder(shuffled).map(b => b.id), ['bridge', 'arc']);
});

test('weekNav walks across block boundaries', () => {
  // Last week of the Bridge -> first week of the Arc, and back.
  assert.deepEqual(weekNav(plan, 'bridge', 1).next, { blockId: 'bridge', week: 2 });
  assert.deepEqual(weekNav(plan, 'bridge', 4).next, { blockId: 'arc', week: 1 });
  assert.deepEqual(weekNav(plan, 'arc', 1).prev, { blockId: 'bridge', week: 4 });
});

test('weekNav returns null at both ends of the plan', () => {
  assert.equal(weekNav(plan, 'bridge', 1).prev, null);
  assert.equal(weekNav(plan, 'arc', 26).next, null);
});

test('weekNav does not depend on the order blocks appear in plan.json', () => {
  const shuffled = { ...plan, blocks: [...plan.blocks].reverse() };
  assert.deepEqual(weekNav(shuffled, 'bridge', 4).next, { blockId: 'arc', week: 1 });
  assert.equal(weekNav(shuffled, 'bridge', 1).prev, null);
  assert.equal(weekNav(shuffled, 'arc', 26).next, null);
});

test('monthRows returns Monday-first rows of seven cells', () => {
  // 2027-01-01 is a Friday.
  const rows = monthRows(plan, '2027-01');
  assert.ok(rows.every(r => r.cells.length === 7));
  assert.deepEqual(rows[0].cells.slice(0, 4), [null, null, null, null]);
  assert.equal(rows[0].cells[4].date, '2027-01-01');
});

test('monthRows labels each row with the plan week it covers', () => {
  const rows = monthRows(plan, '2027-01');
  // The Arc starts Mon 2026-12-07, so the week containing 2027-01-01 is W4.
  assert.equal(rows[0].week.blockId, 'arc');
  assert.equal(rows[0].week.week, 4);
  assert.equal(rows[0].week.blockLabel, 'Arc');
});

test('monthRows crosses a block boundary inside one month', () => {
  const cells = monthRows(plan, '2026-12').flatMap(r => r.cells).filter(Boolean);
  const byDate = Object.fromEntries(cells.map(c => [c.date, c]));

  // The Bridge runs through Sun 2026-12-06; the Arc starts Mon 2026-12-07.
  assert.equal(byDate['2026-12-06'].blockId, 'bridge');
  assert.equal(byDate['2026-12-06'].authored, true);
  assert.equal(byDate['2026-12-07'].blockId, 'arc');
  assert.equal(byDate['2026-12-07'].week, 1);
  assert.equal(byDate['2026-12-07'].authored, true);
});

test('monthRows gives an unauthored block no sessions rather than guessing', () => {
  const cell = monthRows(withArcUnwritten(), '2026-12')
    .flatMap(r => r.cells).find(c => c && c.date === '2026-12-08');
  assert.equal(cell.blockLabel, 'Arc');
  assert.equal(cell.authored, false);
  assert.deepEqual(cell.sessions, []);
});

test('monthRows resolves sessions for an authored day with the same keys as the week view', () => {
  const cell = monthRows(plan, '2026-11')
    .flatMap(r => r.cells).find(c => c && c.date === '2026-11-10');  // a Tuesday
  const ride = cell.sessions.find(s => s.discipline === 'bike');
  assert.ok(ride, 'Tuesday in the Bridge prescribes a ride');
  assert.equal(ride.key, `${cell.blockId}:${cell.week}:tue:bike`);
});

test('monthRows marks dates outside every block as not in the plan', () => {
  const rows = monthRows(plan, '2026-11');
  const cells = rows.flatMap(r => r.cells).filter(Boolean);
  const before = cells.find(c => c.date === '2026-11-08');
  assert.equal(before.inPlan, false);
  assert.deepEqual(before.sessions, []);
  assert.equal(cells.find(c => c.date === '2026-11-09').inPlan, true);
});

test('monthRows leaves a row with no plan days unlabelled', () => {
  // The first two rows of November 2026 are entirely before the plan starts.
  const rows = monthRows(plan, '2026-11');
  assert.equal(rows[0].week, null);
  assert.equal(rows[1].week, null);
  assert.deepEqual(rows[2].week && [rows[2].week.blockId, rows[2].week.week], ['bridge', 1]);
});

test('monthRows flags recovery weeks so the calendar can mark them', () => {
  // Bridge week 3 is the light Thanksgiving week: Mon 2026-11-23.
  const rows = monthRows(plan, '2026-11').filter(r => r.week);
  assert.ok(rows.some(r => r.week.type === 'recovery' && r.week.blockId === 'bridge'),
    'the Bridge eases off over Thanksgiving');
});

test('set lines interpolate values from the progression row', () => {
  const p = templatePlan();
  p.weekTemplates.alpha.days.mon[0].setLines = ['Squat {reps}', 'Pull Ups 3×6'];
  p.progression.lift[0].reps = '3×5';

  const mon = resolveWeek(p, 'lift', 1).days.find(d => d.dayKey === 'mon');
  assert.deepEqual(mon.sessions[0].setLines, ['Squat 3×5', 'Pull Ups 3×6']);
});

test('an unmatched placeholder survives verbatim rather than becoming undefined', () => {
  // It must stay visible: "Squat {reps}" on screen is a bug you can see,
  // "Squat undefined" is one you might not, and a silently dropped token is
  // one you certainly would not.
  const p = templatePlan();
  p.weekTemplates.alpha.days.mon[0].setLines = ['Squat {missing}'];

  const mon = resolveWeek(p, 'lift', 1).days.find(d => d.dayKey === 'mon');
  assert.deepEqual(mon.sessions[0].setLines, ['Squat {missing}']);
});

test('the wednesday main set advances with the week', () => {
  // Every Bridge and Arc row up to the taper names its Wednesday main set, and
  // the template splices it into the swim's set lines. Reading the row straight
  // into the expectation would agree with a row that lost the key, so its
  // presence is asserted separately.
  const distinct = new Set();
  for (const blockId of ['bridge', 'arc']) {
    for (const row of plan.progression[blockId].filter(r => r.wedMain !== undefined)) {
      assert.ok(typeof row.wedMain === 'string' && row.wedMain.length > 0, `${blockId} W${row.week}`);
      distinct.add(row.wedMain);
      const wed = resolveWeek(plan, blockId, row.week).days.find(d => d.dayKey === 'wed');
      const swim = wed.sessions.find(s => s.discipline === 'swim');
      assert.ok(swim.setLines.includes(`MAIN SET: ${row.wedMain}`), `${blockId} W${row.week}`);
    }
  }
  assert.ok(distinct.size > 10, 'the weeks should not all prescribe the same main set');
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

test('a template with no fuelling rules of its own carries the global ones', () => {
  const tue = resolveWeek(plan, 'bridge', 1).days.find(d => d.dayKey === 'tue');
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

test('a routine template places its sessions; a session can say otherwise', () => {
  const p = templatePlan();
  p.schedule = { routine: { mon: {
    strength: { when: 'before-work', venue: 'pool', kit: ['gym'] },
    run: { when: 'lunch', venue: 'home', kit: ['run'] }
  } } };
  const mon = p.weekTemplates.alpha.days.mon;
  mon.push({ discipline: 'run', title: 'Away run', when: 'anytime', kit: [],
             prescribed: { metric: 'duration', value: 20, unit: 'min' }, effort: 'Easy.' });

  // Without the opt-in the routine is ignored, as in race week in Hawaii.
  let sessions = resolveWeek(p, 'lift', 1).days[0].sessions;
  assert.deepEqual(sessions.map(s => [s.when, s.venue, s.kit]),
    [['anytime', null, []], ['anytime', null, []]]);

  p.weekTemplates.alpha.routine = true;
  sessions = resolveWeek(p, 'lift', 1).days[0].sessions;
  assert.deepEqual(sessions[0], { ...sessions[0], when: 'before-work', venue: 'pool', kit: ['gym'] });
  // The session's own when and its explicitly empty kit beat the routine's run.
  assert.equal(sessions[1].when, 'anytime');
  assert.deepEqual(sessions[1].kit, []);
  assert.equal(sessions[1].venue, 'home', 'what the session does not say still comes from the routine');
});
