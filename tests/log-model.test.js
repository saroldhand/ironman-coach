import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveWeek } from '../assets/plan-model.js';
import { statusFor, matchDay, mergeEntries, weekCompletion } from '../assets/log-model.js';

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
