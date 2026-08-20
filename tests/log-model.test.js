import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveWeek } from '../assets/plan-model.js';
import { statusFor, matchDay, mergeEntries, weekCompletion } from '../assets/log-model.js';

const plan = JSON.parse(readFileSync(new URL('../data/plan.json', import.meta.url)));
const week1 = resolveWeek(plan, 'prep', 1);
const dayOf = (w, k) => w.days.find(d => d.dayKey === k);

const ride = (secs, id = 1) => ({ id, type: 'Ride', moving_time: secs, distance: 30000, start_date_local: '2026-08-29T07:00:00Z', name: 'Long ride' });
const swim = (metres, id = 2) => ({ id, type: 'Swim', moving_time: 2400, distance: metres, start_date_local: '2026-08-26T06:00:00Z', name: 'Pool swim' });
const run  = (secs, id = 3) => ({ id, type: 'Run', moving_time: secs, distance: 5000, start_date_local: '2026-08-26T07:30:00Z', name: 'Brick run' });

test('bike and run are judged on moving time', () => {
  const sat = dayOf(week1, 'sat').sessions[0];        // 90 min prescribed
  assert.equal(statusFor(sat, ride(90 * 60)), 'done');
  assert.equal(statusFor(sat, ride(77 * 60)), 'done');      // 85.5%
  assert.equal(statusFor(sat, ride(60 * 60)), 'partial');   // 66.7%
  assert.equal(statusFor(sat, ride(20 * 60)), 'missed');    // 22.2%
});

test('swims are judged on distance, not time', () => {
  const wedSwim = dayOf(week1, 'wed').sessions[0];    // 2000 m prescribed
  assert.equal(statusFor(wedSwim, swim(2000)), 'done');
  assert.equal(statusFor(wedSwim, swim(1200)), 'partial');  // 60%
  assert.equal(statusFor(wedSwim, swim(600)), 'missed');    // 30%
});

test('thresholds are inclusive at the boundary', () => {
  const sat = dayOf(week1, 'sat').sessions[0];        // 90 min = 5400s
  assert.equal(statusFor(sat, ride(0.85 * 5400)), 'done');
  assert.equal(statusFor(sat, ride(0.40 * 5400)), 'partial');
});

test('no activity means missed', () => {
  assert.equal(statusFor(dayOf(week1, 'sat').sessions[0], null), 'missed');
});

test('a brick day matches two activities to two sessions', () => {
  const entries = matchDay(dayOf(week1, 'wed'), [swim(2000), run(30 * 60)], { elapsed: true });
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(e => e.planKey), ['prep:1:wed:swim', 'prep:1:wed:run']);
  assert.ok(entries.every(e => e.status === 'done'));
});

test('an unmatched activity becomes an extra entry, never dropped', () => {
  const yoga = { id: 99, type: 'Yoga', moving_time: 1800, distance: 0, start_date_local: '2026-08-25T18:00:00Z', name: 'Yoga' };
  const entries = matchDay(dayOf(week1, 'tue'), [ride(60 * 60), yoga], { elapsed: true });
  const extra = entries.find(e => e.status === 'extra');
  assert.ok(extra, 'yoga should be recorded as extra');
  assert.equal(extra.strava.id, 99);
  assert.equal(extra.planKey, null);
});

test('optional sessions are never marked missed', () => {
  const entries = matchDay(dayOf(week1, 'mon'), [], { elapsed: true });
  assert.deepEqual(entries, []);
});

test('a day that has not elapsed produces no missed entries', () => {
  const entries = matchDay(dayOf(week1, 'sat'), [], { elapsed: false });
  assert.deepEqual(entries, []);
});

test('two activities of one discipline match one session and one extra', () => {
  const entries = matchDay(dayOf(week1, 'tue'), [ride(60 * 60, 10), ride(20 * 60, 11)], { elapsed: true });
  assert.equal(entries.filter(e => e.status === 'done').length, 1);
  assert.equal(entries.filter(e => e.status === 'extra').length, 1);
});

test('merging is idempotent by strava id', () => {
  const a = [{ date: '2026-08-25', planKey: 'prep:1:tue:bike', status: 'done', strava: { id: 5 }, note: '' }];
  const b = [{ date: '2026-08-25', planKey: 'prep:1:tue:bike', status: 'done', strava: { id: 5 }, note: '' }];
  assert.equal(mergeEntries(a, b).length, 1);
});

test('merging replaces a missed entry when the activity later appears', () => {
  const existing = [{ date: '2026-08-25', planKey: 'prep:1:tue:bike', status: 'missed', strava: null, note: '' }];
  const incoming = [{ date: '2026-08-25', planKey: 'prep:1:tue:bike', status: 'done', strava: { id: 7 }, note: '' }];
  const merged = mergeEntries(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'done');
});

test('merging preserves hand-written notes on the existing entry', () => {
  const existing = [{ date: '2026-08-25', planKey: 'prep:1:tue:bike', status: 'missed', strava: null, note: 'legs were dead' }];
  const incoming = [{ date: '2026-08-25', planKey: 'prep:1:tue:bike', status: 'done', strava: { id: 7 }, note: '' }];
  assert.equal(mergeEntries(existing, incoming)[0].note, 'legs were dead');
});

test('completion counts done and partial over non-optional sessions', () => {
  // Week 1 non-optional sessions: tue bike, wed swim, wed run, thu run, fri swim, sat bike, sun run = 7
  const entries = [
    { date: '2026-08-25', planKey: 'prep:1:tue:bike', status: 'done', strava: { id: 1 }, note: '' },
    { date: '2026-08-26', planKey: 'prep:1:wed:swim', status: 'partial', strava: { id: 2 }, note: '' },
    { date: '2026-08-27', planKey: 'prep:1:thu:run',  status: 'missed', strava: null, note: '' }
  ];
  const c = weekCompletion(week1, entries);
  assert.equal(c.planned, 7);
  assert.equal(c.done, 2);
  assert.equal(c.pct, Math.round((2 / 7) * 100));
});

test('a week with no entries at all reports null, not zero', () => {
  assert.equal(weekCompletion(week1, []).pct, null);
});

test('an unauthored week reports null completion', () => {
  assert.equal(weekCompletion(resolveWeek(plan, 'bridge', 1), []).pct, null);
});
