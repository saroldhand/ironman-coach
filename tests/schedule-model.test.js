import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  toMin, clockText, sessionMinutes, weekHours, morning, kitFor, fuelBefore,
  dayPlan, tonight, weekSummary, plannedByDiscipline
} from '../assets/schedule-model.js';
import { resolveWeek } from '../assets/plan-model.js';

const plan = JSON.parse(readFileSync(new URL('../data/plan.json', import.meta.url)));

// A schedule small enough to do the arithmetic by hand.
const schedule = {
  sleepHours: 8, wakeToDoorMin: 15, afterMin: 30, betweenSessionsMin: 5, swimSecPer100: 120,
  workdays: { mon: { readyBy: '08:00', label: 'At your desk' } },
  venues: {
    home: { label: 'Home', travelMin: 0, changeBeforeMin: 0, changeAfterMin: 0 },
    pool: { label: 'Pool', travelMin: 10, opens: '06:00', changeBeforeMin: 5, changeAfterMin: 10 }
  },
  daysOff: { '2026-12-25': 'Christmas Day' }
};
const tiny = {
  schedule,
  kit: { pool: { label: 'Pool bag', items: ['Goggles'] }, run: { label: 'Run', items: ['Shoes'] } },
  nutrition: {
    types: { key: { label: 'Quality day' }, easy: { label: 'Easy day' } },
    fuel: { beforeShort: 'short', beforeLong: 'long' }
  }
};
const swim = (m, extra = {}) => ({ discipline: 'swim', prescribed: { metric: 'distance', value: m },
                                   when: 'before-work', venue: 'pool', kit: ['pool'], ...extra });
const run = (min, extra = {}) => ({ discipline: 'run', prescribed: { metric: 'duration', value: min },
                                    when: 'before-work', venue: 'home', kit: ['run'], ...extra });
const day = (sessions, extra = {}) => ({ date: '2026-11-09', dayKey: 'mon', sessions,
                                         nutrition: tiny.nutrition.types.easy, ...extra });

test('clock arithmetic reads the way a phone alarm is set', () => {
  assert.equal(toMin('05:40'), 340);
  assert.equal(clockText(340), '5:40 am');
  assert.equal(clockText(21 * 60 + 40), '9:40 pm');
  assert.equal(clockText(0), '12:00 am');
  assert.equal(clockText(12 * 60), '12:00 pm');
  // Lights-out is the evening before the alarm: negative minutes wrap.
  assert.equal(clockText(340 - 8 * 60), '9:40 pm');
});

test('a swim is timed at the schedule pace, a duration is its own value', () => {
  assert.equal(sessionMinutes(swim(2000), schedule), 40);
  assert.equal(sessionMinutes(run(35), schedule), 35);
  // Race legs are prescribed by distance and have no clock time.
  assert.equal(sessionMinutes({ discipline: 'bike', prescribed: { metric: 'distance', value: 90000 } }, schedule), null);
});

test('the morning is worked back from the time you have to be ready', () => {
  // Ready 8:00 → home 7:30 → out of the pool 7:10 → start 6:30 (40 min swim)
  // → arrive 6:25 → leave 6:15 → alarm 6:00 → lights out 10:00 pm.
  const am = morning(tiny, day([swim(2000)]));
  assert.equal(am.status, 'work');
  assert.equal(am.trainMin, 40);
  assert.equal(clockText(am.alarm), '6:00 am');
  assert.equal(clockText(am.lightsOut), '10:00 pm');
  assert.equal(am.earlyBy, 0);
  assert.deepEqual(am.timeline.map(t => [t.label, clockText(t.at)]), [
    ['Leave', '6:15 am'],
    ['Start at the pool', '6:30 am'],
    ['Done', '7:10 am'],
    ['Home to shower and eat', '7:30 am'],
    ['At your desk', '8:00 am']
  ]);
});

test('two sessions in one trip add the changeover between them', () => {
  const am = morning(tiny, day([swim(1500), { ...run(30), discipline: 'strength', venue: 'pool' }]));
  assert.equal(am.trainMin, 30 + 5 + 30);
});

test('the alarm rounds down to five minutes, never up', () => {
  // 37 min of running from the door: start 6:53, alarm 6:38 → 6:35.
  const am = morning(tiny, day([run(37)]));
  assert.equal(clockText(am.alarm), '6:35 am');
  // From home there is no travel step in the timeline.
  assert.deepEqual(am.timeline.map(t => t.label), ['Start', 'Done', 'At your desk']);
});

test('a morning that needs the pool before it opens says by how much', () => {
  // 90 min of swimming: done 7:10, so started 5:40, so in the building at
  // 5:35 - 25 minutes before it opens.
  const am = morning(tiny, day([swim(4500)]));
  assert.equal(am.earlyBy, 25);
});

test('lunch and weekend sessions set no alarm', () => {
  assert.equal(morning(tiny, day([run(20, { when: 'lunch' })])), null);
  assert.equal(morning(tiny, day([run(90, { when: 'anytime' })], { dayKey: 'sat' })), null);
});

test('a day off work says so instead of setting an alarm', () => {
  assert.deepEqual(morning(tiny, day([swim(2000)], { date: '2026-12-25' })),
    { status: 'off', offLabel: 'Christmas Day' });
});

test('kit is listed once per kind, in the order the day uses it', () => {
  const kit = kitFor(tiny, day([swim(1500), run(20, { when: 'lunch' }), swim(500)]));
  assert.deepEqual(kit.map(k => k.label), ['Pool bag', 'Run']);
});

test('an hour or more, or a quality day, gets carbs before leaving', () => {
  const short = day([run(40)]);
  assert.equal(fuelBefore(tiny, short, morning(tiny, short)), 'short');
  const long = day([run(60)]);
  assert.equal(fuelBefore(tiny, long, morning(tiny, long)), 'long');
  const quality = day([run(40)], { nutrition: tiny.nutrition.types.key });
  assert.equal(fuelBefore(tiny, quality, morning(tiny, quality)), 'long');
  assert.equal(fuelBefore(tiny, short, null), null);
});

// ---- against the real plan

test('Bridge W1 Monday: pool at 6, desk at 8:15, alarm 5:45', () => {
  const p = dayPlan(plan, '2026-11-09');
  assert.equal(p.where.blockId, 'bridge');
  assert.equal(p.morning.venue.key, 'pool');
  assert.deepEqual(p.morning.sessions.map(s => s.discipline), ['swim', 'strength']);
  // 1,200 m at 2:30 per 100 m (30 min), changeover, 35 min of strength: in
  // the building at 6:10, so up at 5:45.
  assert.equal(clockText(p.morning.alarm), '5:45 am');
  assert.equal(clockText(p.morning.lightsOut), '9:45 pm');
  assert.deepEqual(p.kit.map(k => k.key), ['pool', 'gym', 'run']);
  // Seventy minutes of swim and lifting: eat first.
  assert.equal(p.fuel, plan.nutrition.fuel.beforeLong);
});

test('the lunch run is on the page but not in the alarm', () => {
  const p = dayPlan(plan, '2026-11-09');
  const lunch = p.day.sessions.find(s => s.discipline === 'run');
  assert.equal(lunch.when, 'lunch');
  assert.ok(!p.morning.sessions.includes(lunch));
});

test('Tuesday rides at home: no travel, out the door at 7:45', () => {
  const p = dayPlan(plan, '2026-11-10');
  assert.equal(p.morning.venue.key, 'home');
  assert.equal(p.morning.readyLabel, 'Leave for work');
  assert.equal(clockText(p.morning.alarm), '6:15 am');
});

test('tonight looks one day ahead', () => {
  assert.equal(tonight(plan, '2026-11-08').day.date, '2026-11-09');
  assert.equal(tonight(plan, '2027-06-06'), null, 'nothing after the plan ends');
});

test('Thanksgiving away days set no alarm', () => {
  for (const date of ['2026-11-26', '2026-11-27', '2026-11-30', '2026-12-01']) {
    const p = dayPlan(plan, date);
    assert.ok(!p.morning || p.morning.status === 'off', date);
  }
});

test('the week summary counts hours and finds the earliest alarm', () => {
  const week = resolveWeek(plan, 'bridge', 1);
  const s = weekSummary(plan, week);
  assert.equal(s.hours, weekHours(week, plan.schedule));
  assert.ok(s.hours > 5 && s.hours < 6.5, `bridge W1 is ${s.hours} h`);
  assert.equal(s.alarms.size, 5);
  assert.equal(clockText(s.earliest.alarm), '5:45 am');
});

test('the plan by discipline gives minutes for all and metres for the swims', () => {
  const week = resolveWeek(plan, 'bridge', 1);
  const p = plannedByDiscipline(week, plan.schedule);
  // Swims 1,200 + 1,500 + 1,600 m at 2:30 per 100 m: 30 + 38 + 40 min.
  assert.deepEqual(p.swim, { minutes: 108, metres: 4300 });
  assert.deepEqual(p.bike, { minutes: 45 + 75, metres: 0 });
  assert.deepEqual(p.run, { minutes: 15 + 30 + 35, metres: 0 });
  assert.deepEqual(p.strength, { minutes: 35, metres: 0 });
  const total = Object.values(p).reduce((t, d) => t + d.minutes, 0);
  assert.equal(weekHours(week, plan.schedule), Math.round(total / 6) / 10);
});
