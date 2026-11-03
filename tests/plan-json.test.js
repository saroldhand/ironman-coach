import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blocksInOrder, resolveWeek } from '../assets/plan-model.js';
import { addDays, weekdayKey } from '../assets/date-utils.js';
import { morning, toMin, clockText } from '../assets/schedule-model.js';

const plan = JSON.parse(readFileSync(new URL('../data/plan.json', import.meta.url)));

test('race date and blocks are anchored correctly', () => {
  assert.equal(plan.race.date, '2027-06-05');
  const ids = plan.blocks.map(b => b.id);
  // The plan starts at the Bridge: Prep and the lifting block were cut on
  // 2026-11-02. The weeks before it are history: what Strava recorded, from
  // the first recorded activity (Mon 2026-08-03) up to the Bridge.
  assert.deepEqual(ids, ['history', 'bridge', 'arc']);
  assert.deepEqual(
    plan.blocks.map(b => [b.start, b.weeks]),
    [['2026-08-03', 14], ['2026-11-09', 4], ['2026-12-07', 26]]
  );
});

test('blocks are contiguous with no gap or overlap', () => {
  const ordered = blocksInOrder(plan);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    assert.equal(addDays(prev.start, prev.weeks * 7), ordered[i].start);
  }
});

test('every block is authored, through race day', () => {
  for (const id of ['bridge', 'arc']) {
    assert.equal(plan.blocks.find(b => b.id === id).authored, true, id);
  }
});

test('the history block prescribes nothing', () => {
  const history = plan.blocks.find(b => b.id === 'history');
  assert.equal(history.history, true);
  assert.ok(!history.authored, 'no sessions, by design');
  assert.ok(!plan.progression.history, 'and no progression rows');
});

test('nothing from before the Bridge is left in the plan', () => {
  // Every week is a template now; the old skeleton week, its recovery rules
  // and shared swim sets, and the lifting templates went with their blocks.
  for (const key of ['skeleton', 'recovery', 'sets']) assert.ok(!(key in plan), key);
  for (const name of ['gvtA', 'gvtB', 'ppl']) assert.ok(!plan.weekTemplates[name], name);
  assert.deepEqual(Object.keys(plan.progression), ['bridge', 'arc']);
  assert.ok(!plan.nutrition.types.lift, 'the lifting-day type went with the lifting block');
});

test('every week template covers all seven days', () => {
  // Iterating the templates rather than naming them keeps a template added
  // later inside the guard. A day missing from dayTypes resolves to
  // nutrition: undefined, which throws in render.js.
  for (const name of Object.keys(plan.weekTemplates)) {
    assert.deepEqual(Object.keys(plan.weekTemplates[name].days),
      ['mon','tue','wed','thu','fri','sat','sun'], name);
    assert.deepEqual(Object.keys(plan.weekTemplates[name].dayTypes),
      ['mon','tue','wed','thu','fri','sat','sun'], name);
  }
});

test('every nutrition day type named by a template is defined', () => {
  for (const [name, tpl] of Object.entries(plan.weekTemplates)) {
    for (const t of Object.values(tpl.dayTypes)) {
      assert.ok(plan.nutrition.types[t], `${name} names missing day type ${t}`);
    }
  }
});

test('every placeholder in a template is supplied by every week that uses it', () => {
  // A set line reading "MAIN SET: {wedMain}" renders that literally on the page.
  // Nothing throws, so only this test catches it.
  const PLACEHOLDER = /\{(\w+)\}/g;

  for (const [name, tpl] of Object.entries(plan.weekTemplates)) {
    const needed = new Set();
    // Titles, efforts and detail lines carry tokens too, not only set lines.
    for (const sessions of Object.values(tpl.days)) {
      for (const s of sessions) {
        for (const line of [s.title, s.effort, ...(s.setLines || []), ...(s.detail || [])]) {
          if (typeof line !== 'string') continue;
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

test('every progression row names a template that exists', () => {
  // resolveWeek reads plan.weekTemplates[row.template]; a row with no
  // template, or a misspelt one, has no week to show.
  for (const [blockId, rows] of Object.entries(plan.progression)) {
    for (const w of rows) {
      assert.ok(plan.weekTemplates[w.template],
        `${blockId} week ${w.week} names missing template ${w.template}`);
    }
  }
});

test('no day prescribes two sessions of the same discipline', () => {
  // Session keys are blockId:week:day:discipline. A duplicate discipline on
  // one day collides, and the second session vanishes from the log silently.
  const sources = Object.entries(plan.weekTemplates).map(([n, t]) => [n, t.days]);

  for (const [name, days] of sources) {
    for (const [dayKey, sessions] of Object.entries(days)) {
      const seen = sessions.map(s => s.discipline);
      assert.equal(new Set(seen).size, seen.length,
        `${name}.${dayKey} has two sessions of one discipline: ${seen.join(', ')}`);
    }
  }
});

test('every prescribed session carries a usable metric', () => {
  const sources = Object.values(plan.weekTemplates).map(t => t.days);
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

test('every amount a template reads from the progression is supplied by every week that uses it', () => {
  // resolveWeek copies progression[key] straight into prescribed.value. A row
  // missing the key renders "undefined min" and scores the session missed
  // however much was done.
  for (const [name, tpl] of Object.entries(plan.weekTemplates)) {
    const needed = new Set();
    for (const sessions of Object.values(tpl.days)) {
      for (const s of sessions) {
        if (s.prescribed.fromProgression) needed.add(s.prescribed.fromProgression);
      }
    }

    const users = Object.values(plan.progression).flat().filter(w => w.template === name);
    for (const week of users) {
      for (const key of needed) {
        assert.equal(typeof week[key], 'number', `${name} week ${week.week} does not supply ${key}`);
      }
    }
  }
});

test('the arc phase labels match the template each week runs', () => {
  // Same trap as the strength block: phase labels live on the block and
  // templates on the rows, and nothing links them. A race-specific week
  // labelled "Build" reads fine and is wrong.
  const arc = plan.blocks.find(b => b.id === 'arc');
  assert.deepEqual(arc.phases.map(p => [p.label, p.from, p.to]),
    [['Base', 1, 8], ['Build', 9, 16], ['Race-specific', 17, 24], ['Taper', 25, 26]]);
  assert.deepEqual(plan.progression.arc.map(w => w.week), Array.from({ length: 26 }, (_, i) => i + 1));

  const labelFor = week => (arc.phases.find(p => week >= p.from && week <= p.to) || {}).label;
  const phaseOfTemplate = { arcBase: 'Base', arcBuild: 'Build', arcRace: 'Race-specific',
                            arcTaper: 'Taper', arcRaceWeek: 'Taper' };
  for (const w of plan.progression.arc) {
    assert.equal(labelFor(w.week), phaseOfTemplate[w.template],
      `week ${w.week} runs ${w.template} but is labelled ${labelFor(w.week)}`);
  }
  assert.equal(plan.progression.arc[25].template, 'arcRaceWeek', 'the last week is race week');
});

test('arc recovery weeks land every fourth week and back the load off', () => {
  const rows = plan.progression.arc;
  const recovery = rows.filter(w => w.type === 'recovery');
  assert.deepEqual(recovery.map(w => w.week), [4, 8, 12, 16, 20]);

  for (const r of recovery) {
    const prev = rows.find(w => w.week === r.week - 1);
    for (const key of ['tueMin', 'thuMin', 'rideMin', 'runMin']) {
      assert.ok(r[key] < prev[key],
        `week ${r.week} ${key} is ${r[key]}, not below week ${prev.week}'s ${prev[key]}`);
    }
  }
});

test('arc running never ramps more than 15% from one loading week to the next', () => {
  // Running is where a triathlon build gets injured. Recovery weeks dip on
  // purpose; what matters is each loading week against the last one.
  const runOf = w => (w.monRunMin || 0) + (w.thuMin || 0) + (w.brickMin || 0) + (w.runMin || 0);
  const loading = plan.progression.arc.filter(w => w.type === 'build');
  for (let i = 1; i < loading.length; i++) {
    const [a, b] = [loading[i - 1], loading[i]];
    assert.ok(runOf(b) <= runOf(a) * 1.15,
      `week ${b.week} runs ${runOf(b)} min after ${runOf(a)} in week ${a.week}`);
  }
});

// ---- the Bridge, and the clock the athlete trains to (2026-11-02)

// Every week trained around a work day: the Bridge and the Arc up to the
// taper. Race week is in Hawaii, off work, and sets no alarms.
function clockWeeks() {
  const weeks = [];
  for (let n = 1; n <= 4; n++) weeks.push(resolveWeek(plan, 'bridge', n));
  for (let n = 1; n <= 25; n++) weeks.push(resolveWeek(plan, 'arc', n));
  return weeks;
}
const label = (week, day) => `${week.blockLabel} W${week.week} ${day.dayKey} ${day.date}`;

test('the bridge runs Nov 9 to Dec 6 and eases off over Thanksgiving', () => {
  const rows = plan.progression.bridge;
  assert.deepEqual(rows.map(w => w.template), ['bridge', 'bridge', 'bridgeAway', 'bridgeBack']);
  assert.deepEqual(rows.map(w => w.type), ['build', 'build', 'recovery', 'build']);
  // The weekend builds toward Arc W1 without reaching it.
  const arc1 = plan.progression.arc[0];
  assert.ok(rows[3].rideMin < arc1.rideMin && rows[3].runMin < arc1.runMin);
});

test('bridge running builds to the Arc without a jump', () => {
  const runMin = week => week.days.flatMap(d => d.sessions)
    .filter(s => s.discipline === 'run').reduce((t, s) => t + s.prescribed.value, 0);
  const bridge = [1, 2, 3, 4].map(n => runMin(resolveWeek(plan, 'bridge', n)));
  assert.deepEqual(bridge, [80, 95, 85, 110], 'the minutes agreed on 2026-11-02');
  const arc1 = runMin(resolveWeek(plan, 'arc', 1));
  assert.ok(arc1 <= bridge[3] * 1.15, `Arc W1 runs ${arc1} min after ${bridge[3]}`);
});

test('every work morning fits before work, and no alarm is set before 5:30', () => {
  // The athlete's hours: pool opens at 6, leave at 7:45 on office days, at
  // the desk by 8:15 at home. The plan must fit them, not the other way round.
  const EARLIEST = toMin('05:30');
  for (const week of clockWeeks()) {
    for (const day of week.days) {
      const am = morning(plan, day);
      if (!am || am.status !== 'work') continue;
      assert.equal(am.earlyBy, 0, `${label(week, day)} needs the pool ${am.earlyBy} min before it opens`);
      assert.ok(am.alarm >= EARLIEST, `${label(week, day)} sets an alarm for ${clockText(am.alarm)}`);
    }
  }
});

test('a work morning happens in one place', () => {
  for (const week of clockWeeks()) {
    for (const day of week.days) {
      const venues = new Set(day.sessions.filter(s => s.when === 'before-work').map(s => s.venue));
      assert.ok(venues.size <= 1, `${label(week, day)} goes to ${[...venues].join(' and ')}`);
    }
  }
});

test('the Wednesday swim never outgrows its 45 minutes', () => {
  // Pool at 6, out the door to work at 7:45. The long swims live on Friday.
  for (const week of clockWeeks()) {
    const wed = week.days.find(d => d.dayKey === 'wed');
    for (const s of wed.sessions.filter(s => s.discipline === 'swim')) {
      assert.ok(s.prescribed.value <= 2000, `${label(week, wed)} swims ${s.prescribed.value} m`);
    }
  }
});

test('every session on a work day is placed before work or at lunch', () => {
  // A session with no slot sets no alarm, so it would quietly drop out of the
  // night-before plan. Only a day off may leave a session unplaced.
  for (const week of clockWeeks()) {
    for (const day of week.days) {
      if (!plan.schedule.workdays[day.dayKey] || plan.schedule.daysOff[day.date]) continue;
      for (const s of day.sessions) {
        assert.ok(['before-work', 'lunch'].includes(s.when), `${label(week, day)} ${s.title} is ${s.when}`);
      }
    }
  }
});

test('the third run is Monday lunch, and the low day is Wednesday', () => {
  for (const name of ['bridge', 'arcBase', 'arcBuild', 'arcRace', 'arcTaper']) {
    const tpl = plan.weekTemplates[name];
    assert.ok(tpl.days.mon.some(s => s.discipline === 'run'), `${name} has no Monday run`);
    assert.ok(!tpl.days.wed.some(s => s.discipline === 'run'), `${name} still runs on Wednesday`);
    assert.notEqual(tpl.dayTypes.mon, 'low', `${name} puts the deficit on a three-session day`);
  }
  for (const name of ['bridge', 'arcBase', 'arcBuild']) {
    assert.equal(plan.weekTemplates[name].dayTypes.wed, 'low', name);
  }
});

test('every kit and venue the plan names exists', () => {
  const { routine, venues } = plan.schedule;
  const named = [];
  for (const day of Object.values(routine)) for (const r of Object.values(day)) named.push(r);
  for (const tpl of Object.values(plan.weekTemplates)) {
    for (const sessions of Object.values(tpl.days)) named.push(...sessions);
  }
  for (const r of named) {
    for (const k of r.kit || []) assert.ok(plan.kit[k], `kit ${k} is not defined`);
    if (r.venue) assert.ok(venues[r.venue], `venue ${r.venue} is not defined`);
  }
});

test('every day off is a weekday inside the plan', () => {
  const ordered = blocksInOrder(plan);
  const first = ordered[0].start;
  const last = addDays(ordered.at(-1).start, ordered.at(-1).weeks * 7 - 1);
  for (const date of Object.keys(plan.schedule.daysOff)) {
    assert.ok(date >= first && date <= last, `${date} is outside the plan`);
    assert.ok(!['sat', 'sun'].includes(weekdayKey(date)), `${date} is a weekend`);
  }
});
