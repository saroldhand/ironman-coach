import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveWeek } from '../assets/plan-model.js';
import { statusFor, matchDay, mergeEntries, weekCompletion, weekActuals, normaliseActivity, syncRange,
         actualsBetween, typicalPeriod, usualSpeed, mondayOf, isTraining } from '../assets/log-model.js';

const plan = JSON.parse(readFileSync(new URL('../data/plan.json', import.meta.url)));
// Bridge W2, Nov 16-22: a 60-minute Tuesday ride, a 2,000 m Wednesday swim,
// a 90-minute Saturday ride, and swim, strength and a lunch run on Monday.
const week = resolveWeek(plan, 'bridge', 2);
const dayOf = (w, k) => w.days.find(d => d.dayKey === k);

const ride = (secs, id = 1) => ({ id, type: 'Ride', moving_time: secs, distance: 30000, start_date_local: '2026-11-21T07:00:00Z', name: 'Long ride' });
const swim = (metres, id = 2) => ({ id, type: 'Swim', moving_time: 2400, distance: metres, start_date_local: '2026-11-18T06:00:00Z', name: 'Pool swim' });
const run  = (secs, id = 3) => ({ id, type: 'Run', moving_time: secs, distance: 3000, start_date_local: '2026-11-16T12:15:00Z', name: 'Lunch run' });

test('bike and run are judged on moving time', () => {
  const sat = dayOf(week, 'sat').sessions[0];        // 90 min prescribed
  assert.equal(statusFor(sat, ride(90 * 60)), 'done');
  assert.equal(statusFor(sat, ride(77 * 60)), 'done');      // 85.5%
  assert.equal(statusFor(sat, ride(60 * 60)), 'partial');   // 66.7%
  assert.equal(statusFor(sat, ride(20 * 60)), 'missed');    // 22.2%
});

test('swims are judged on distance, not time', () => {
  const wedSwim = dayOf(week, 'wed').sessions[0];    // 2000 m prescribed
  assert.equal(statusFor(wedSwim, swim(2000)), 'done');
  assert.equal(statusFor(wedSwim, swim(1200)), 'partial');  // 60%
  assert.equal(statusFor(wedSwim, swim(600)), 'missed');    // 30%
});

test('thresholds are inclusive at the boundary', () => {
  const sat = dayOf(week, 'sat').sessions[0];        // 90 min = 5400s
  assert.equal(statusFor(sat, ride(0.85 * 5400)), 'done');
  assert.equal(statusFor(sat, ride(0.40 * 5400)), 'partial');
});

test('no activity means missed', () => {
  assert.equal(statusFor(dayOf(week, 'sat').sessions[0], null), 'missed');
});

test('a day of three sessions matches each activity to its own, and misses the rest', () => {
  // Monday: technique swim and strength before work, a run at lunch. Strava
  // has the swim and the run; the lift was never recorded.
  const entries = matchDay(dayOf(week, 'mon'), [run(15 * 60), swim(1500)], { elapsed: true });
  assert.deepEqual(entries.map(e => [e.planKey, e.status]), [
    ['bridge:2:mon:swim', 'done'],
    ['bridge:2:mon:strength', 'missed'],
    ['bridge:2:mon:run', 'done']
  ]);
});

test('an unmatched activity becomes an extra entry, never dropped', () => {
  const yoga = { id: 99, type: 'Yoga', moving_time: 1800, distance: 0, start_date_local: '2026-11-17T18:00:00Z', name: 'Yoga' };
  const entries = matchDay(dayOf(week, 'tue'), [ride(60 * 60), yoga], { elapsed: true });
  const extra = entries.find(e => e.status === 'extra');
  assert.ok(extra, 'yoga should be recorded as extra');
  assert.equal(extra.strava.id, 99);
  assert.equal(extra.planKey, null);
});

test('optional sessions are never marked missed', () => {
  // Taper Monday: the technique swim is optional; strength and the run are not.
  const taperMon = dayOf(resolveWeek(plan, 'arc', 25), 'mon');
  const entries = matchDay(taperMon, [], { elapsed: true });
  assert.deepEqual(entries.map(e => e.planKey), ['arc:25:mon:strength', 'arc:25:mon:run']);
});

test('a day that has not elapsed produces no missed entries', () => {
  const entries = matchDay(dayOf(week, 'sat'), [], { elapsed: false });
  assert.deepEqual(entries, []);
});

test('two activities of one discipline match one session and one extra', () => {
  const entries = matchDay(dayOf(week, 'tue'), [ride(60 * 60, 10), ride(20 * 60, 11)], { elapsed: true });
  assert.equal(entries.filter(e => e.status === 'done').length, 1);
  assert.equal(entries.filter(e => e.status === 'extra').length, 1);
});

test('merging is idempotent by strava id', () => {
  const a = [{ date: '2026-11-17', planKey: 'bridge:2:tue:bike', status: 'done', strava: { id: 5 }, note: '' }];
  const b = [{ date: '2026-11-17', planKey: 'bridge:2:tue:bike', status: 'done', strava: { id: 5 }, note: '' }];
  assert.equal(mergeEntries(a, b).length, 1);
});

test('merging replaces a missed entry when the activity later appears', () => {
  const existing = [{ date: '2026-11-17', planKey: 'bridge:2:tue:bike', status: 'missed', strava: null, note: '' }];
  const incoming = [{ date: '2026-11-17', planKey: 'bridge:2:tue:bike', status: 'done', strava: { id: 7 }, note: '' }];
  const merged = mergeEntries(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'done');
});

test('merging preserves hand-written notes on the existing entry', () => {
  const existing = [{ date: '2026-11-17', planKey: 'bridge:2:tue:bike', status: 'missed', strava: null, note: 'legs were dead' }];
  const incoming = [{ date: '2026-11-17', planKey: 'bridge:2:tue:bike', status: 'done', strava: { id: 7 }, note: '' }];
  assert.equal(mergeEntries(existing, incoming)[0].note, 'legs were dead');
});

test('completion counts done and partial over non-optional sessions', () => {
  // Bridge W2 non-optional sessions: mon swim, strength and run, tue bike,
  // wed swim, thu run, fri swim, sat bike, sun run = 9
  const entries = [
    { date: '2026-11-17', planKey: 'bridge:2:tue:bike', status: 'done', strava: { id: 1 }, note: '' },
    { date: '2026-11-18', planKey: 'bridge:2:wed:swim', status: 'partial', strava: { id: 2 }, note: '' },
    { date: '2026-11-19', planKey: 'bridge:2:thu:run',  status: 'missed', strava: null, note: '' }
  ];
  const c = weekCompletion(week, entries);
  assert.equal(c.planned, 9);
  assert.equal(c.done, 2);
  assert.equal(c.pct, Math.round((2 / 9) * 100));
});

test('a week with no entries at all reports null, not zero', () => {
  assert.equal(weekCompletion(week, []).pct, null);
});

test('an unauthored week reports null completion', () => {
  // Arc is authored now; a clone with it unwritten keeps this path covered.
  const p = JSON.parse(JSON.stringify(plan));
  p.blocks.find(b => b.id === 'arc').authored = false;
  assert.equal(weekCompletion(resolveWeek(p, 'arc', 1), []).pct, null);
});

test('matching picks the activity that fits the session, not the first one', () => {
  const short = { id: 1, type: 'Ride', moving_time: 5 * 60, distance: 2000, start_date_local: '2026-11-17T06:00:00Z', name: 'Spin to work' };
  const real  = { id: 2, type: 'Ride', moving_time: 60 * 60, distance: 28000, start_date_local: '2026-11-17T18:00:00Z', name: 'Evening ride' };

  for (const order of [[short, real], [real, short]]) {
    const entries = matchDay(dayOf(week, 'tue'), order, { elapsed: true });
    const planned = entries.find(e => e.planKey === 'bridge:2:tue:bike');
    assert.equal(planned.status, 'done');
    assert.equal(planned.strava.id, 2, 'the 60-minute ride must claim the 60-minute session');
    assert.equal(entries.find(e => e.status === 'extra').strava.id, 1);
  }
});

test('merging never leaves two entries on one planKey', () => {
  const existing = [
    { date: '2026-11-17', planKey: 'bridge:2:tue:bike', status: 'missed', strava: { id: 8 }, note: '' },
    { date: '2026-11-17', planKey: null, status: 'extra', strava: { id: 9 }, note: '' }
  ];
  const incoming = [{ date: '2026-11-17', planKey: 'bridge:2:tue:bike', status: 'done', strava: { id: 9 }, note: '' }];

  const merged = mergeEntries(existing, incoming);
  const onSlot = merged.filter(e => e.planKey === 'bridge:2:tue:bike');
  assert.equal(onSlot.length, 1);
  assert.equal(onSlot[0].status, 'done');
  assert.equal(onSlot[0].strava.id, 9);
});

test('merging the same batch repeatedly is stable', () => {
  const incoming = matchDay(dayOf(week, 'mon'), [swim(1500), run(15 * 60)], { elapsed: true });
  const once = mergeEntries([], incoming);
  const twice = mergeEntries(once, incoming);
  const thrice = mergeEntries(twice, incoming);
  assert.equal(twice.length, once.length);
  assert.deepEqual(thrice, once);
});

// ---- what was actually done in a week

const act = (date, type, secs, metres, id) =>
  ({ date, planKey: null, status: 'extra', note: '',
     strava: { id, type, name: type, movingTime: secs, distance: metres, avgHr: null, url: '' } });

test('weekly actuals add up every recorded activity in the week, by discipline', () => {
  // Bridge W2 runs Mon 2026-11-16 to Sun 2026-11-22.
  const entries = [
    { ...act('2026-11-16', 'Swim', 35 * 60, 1500, 1), planKey: 'bridge:2:mon:swim', status: 'done' },
    act('2026-11-16', 'Run', 16 * 60, 2900, 2),
    act('2026-11-18', 'Swim', 44 * 60, 2000, 3),
    act('2026-11-21', 'VirtualRide', 90 * 60, 45000, 4),
    act('2026-11-21', 'Run', 10 * 60, 2000, 5),
    act('2026-11-22', 'Walk', 40 * 60, 3500, 6),
    // A missed session has no activity, and days outside the week do not count.
    { date: '2026-11-19', planKey: 'bridge:2:thu:run', status: 'missed', strava: null, note: '' },
    act('2026-11-15', 'Run', 35 * 60, 6000, 7),
    act('2026-11-23', 'Swim', 34 * 60, 1500, 8)
  ];
  const a = weekActuals(week, entries);
  assert.equal(a.recorded, true);
  assert.deepEqual(a.byDiscipline.swim, { minutes: 79, metres: 3500, count: 2 });
  assert.deepEqual(a.byDiscipline.run, { minutes: 26, metres: 4900, count: 2 });
  assert.deepEqual(a.byDiscipline.bike, { minutes: 90, metres: 45000, count: 1 });
  assert.deepEqual(a.byDiscipline.strength, { minutes: 0, metres: 0, count: 0 });
  // A walk is recorded but is not training: it counts nowhere.
  assert.deepEqual(Object.keys(a.byDiscipline), ['swim', 'bike', 'run', 'strength']);
  assert.equal(a.total.minutes, 79 + 26 + 90);
  assert.equal(a.total.count, 5);
});

test('a week with nothing recorded is unknown, not zero', () => {
  const missedOnly = [{ date: '2026-11-17', planKey: 'bridge:2:tue:bike', status: 'missed', strava: null, note: '' }];
  assert.equal(weekActuals(week, []).recorded, false);
  assert.equal(weekActuals(week, missedOnly).recorded, false);
});

// ---- the sync: the connector's activities in, log entries out

// The shape list_activities returns from the Strava connector.
const fromConnector = (id, sport_type, start_local, moving_time, distance) =>
  ({ id: String(id), name: `${sport_type} ${id}`, sport_type, start_local,
     summary: { distance, moving_time, elapsed_time: moving_time, elevation_gain: 0 } });

test("the connector's activity shape becomes the one matching reads", () => {
  assert.deepEqual(normaliseActivity(fromConnector(42, 'VirtualRide', '2026-11-10T06:31:00', 2700, 18000)), {
    id: '42', type: 'VirtualRide', name: 'VirtualRide 42', moving_time: 2700, distance: 18000,
    average_heartrate: null, start_date_local: '2026-11-10T06:31:00'
  });
  // The Strava API's own shape passes through unchanged.
  const api = { id: 7, type: 'Run', name: 'Run', moving_time: 1800, distance: 5000,
                average_heartrate: 141, start_date_local: '2026-11-12T06:40:00Z' };
  assert.deepEqual(normaliseActivity(api), { ...api, id: '7' });
});

test('a sync matches each date in the range to its own sessions', () => {
  const activities = [
    fromConnector(1, 'Swim', '2026-11-09T06:08:00', 2100, 1500),
    fromConnector(2, 'WeightTraining', '2026-11-09T06:50:00', 2100, 0),
    fromConnector(3, 'Run', '2026-11-09T12:20:00', 900, 2500),
    fromConnector(4, 'Ride', '2026-11-10T06:30:00', 2700, 20000),
    fromConnector(5, 'Walk', '2026-11-10T18:00:00', 1800, 2400)
  ];
  const { entries, days } = syncRange(plan, [], activities, '2026-11-08', '2026-11-11', '2026-11-11');

  assert.deepEqual(days, [
    // Before the plan (a history week) nothing is prescribed, so nothing is due.
    { date: '2026-11-08', activities: 0, entries: 0 },
    { date: '2026-11-09', activities: 3, entries: 3 },
    { date: '2026-11-10', activities: 2, entries: 2 },
    // Today: the swim not done yet stays blank rather than missed.
    { date: '2026-11-11', activities: 0, entries: 0 }
  ]);
  // Within a day the log is ordered by Strava id.
  assert.deepEqual(entries.map(e => [e.date, e.planKey, e.status]), [
    ['2026-11-09', 'bridge:1:mon:swim', 'done'],
    ['2026-11-09', 'bridge:1:mon:strength', 'done'],
    ['2026-11-09', 'bridge:1:mon:run', 'done'],
    ['2026-11-10', 'bridge:1:tue:bike', 'done'],
    ['2026-11-10', null, 'extra']
  ]);
});

test('a sync the day after marks what was not done as missed', () => {
  const { entries } = syncRange(plan, [], [], '2026-11-11', '2026-11-11', '2026-11-12');
  assert.deepEqual(entries.map(e => [e.planKey, e.status]), [['bridge:1:wed:swim', 'missed']]);
});

test('re-syncing a range changes nothing', () => {
  const activities = [fromConnector(4, 'Ride', '2026-11-10T06:30:00', 2700, 20000)];
  const once = syncRange(plan, [], activities, '2026-11-10', '2026-11-10', '2026-11-12').entries;
  const twice = syncRange(plan, once, activities, '2026-11-10', '2026-11-10', '2026-11-12').entries;
  assert.deepEqual(twice, once);
});

test('walks and hikes are not training; HIIT counts as lifting', () => {
  assert.equal(isTraining('Walk'), false);
  assert.equal(isTraining('Hike'), false);
  assert.equal(isTraining('Run'), true);
  const hiit = act('2026-10-01', 'HighIntensityIntervalTraining', 42 * 60, 0, 1);
  const a = actualsBetween([hiit], '2026-09-28', '2026-10-05');
  assert.equal(a.byDiscipline.strength.minutes, 42);
});

test('actuals cover any range, end exclusive', () => {
  const entries = [act('2026-09-30', 'Run', 30 * 60, 5000, 1), act('2026-10-01', 'Run', 20 * 60, 3000, 2)];
  assert.equal(actualsBetween(entries, '2026-09-01', '2026-10-01').byDiscipline.run.metres, 5000);
  assert.equal(actualsBetween(entries, '2026-10-01', '2026-11-01').byDiscipline.run.metres, 3000);
});

test('weeks start on Monday', () => {
  assert.equal(mondayOf('2026-09-13'), '2026-09-07', 'a Sunday belongs to the week before');
  assert.equal(mondayOf('2026-09-14'), '2026-09-14');
});

test('a typical week is the median of the weeks that had the discipline, so one huge week does not set it', () => {
  const entries = [
    act('2026-08-10', 'Ride', 60 * 60, 20000, 1),
    act('2026-08-17', 'Ride', 90 * 60, 30000, 2),
    act('2026-09-07', 'Ride', 1600 * 60, 570000, 3),   // the touring week
    act('2026-08-10', 'Swim', 40 * 60, 1000, 4)
  ];
  const t = typicalPeriod(entries, 'week');
  assert.deepEqual(t.bike, { minutes: 90, metres: 30000 });
  assert.deepEqual(t.swim, { minutes: 40, metres: 1000 }, 'weeks without a swim are not zeros in the median');
  assert.deepEqual(t.strength, { minutes: 0, metres: 0 });
  // By month: August (150 min) and September (1,600): the median of two is their mean.
  assert.deepEqual(typicalPeriod(entries, 'month').bike, { minutes: 875, metres: 310000 });
});

test('usual speed is all the distance over all the moving time', () => {
  const s = usualSpeed([act('2026-08-10', 'Run', 1000, 2500, 1), act('2026-08-12', 'Run', 1000, 2000, 2)]);
  assert.ok(Math.abs(s.run - 4500 / 2000) < 1e-9, `run speed ${s.run}`);
  assert.equal(s.bike, null, 'no rides, no speed');
});

test('the back-filled history keeps every activity, walks included, as extras', () => {
  // The log is real data: whatever it holds, nothing before the Bridge can be
  // matched to a session, because no session was set.
  for (const e of JSON.parse(readFileSync(new URL('../data/log.json', import.meta.url))).entries) {
    if (e.date < '2026-11-09') assert.equal(e.status, 'extra', `${e.date} ${e.planKey}`);
  }
});
