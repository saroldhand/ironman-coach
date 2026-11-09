import test from 'node:test';
import assert from 'node:assert/strict';
import {
  syncMessages, indexEntries, route,
  dispatchRequest, runsRequest, dispatchFailure, workflowVerdict, syncLanded, syncResultText
} from '../assets/app-state.js';

test('never-run reports that the sync has never run', () => {
  const msgs = syncMessages({ ok: false, reason: 'never-run', lastSuccess: null }, false, false);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /never run/i);
});

test('a failed sync names the reason and denies it was a rest day', () => {
  const msgs = syncMessages({ ok: false, reason: 'strava-unreachable', lastSuccess: '2026-08-19T05:00:00Z' }, false, false);
  assert.match(msgs[0], /strava-unreachable/);
  assert.match(msgs[0], /not a rest day/i);
});

test('a stale but successful sync reports staleness', () => {
  const old = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
  const msgs = syncMessages({ ok: true, reason: null, lastSuccess: old }, false, false);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /stale/i);
});

test('a fresh successful sync says nothing', () => {
  const now = new Date().toISOString();
  assert.deepEqual(syncMessages({ ok: true, reason: null, lastSuccess: now }, false, false), []);
});

test('an unreadable sync-status file still produces a banner', () => {
  // This is the defect that shipped: a null status must not render silently,
  // because a silent page is indistinguishable from a healthy sync.
  const msgs = syncMessages(null, false, true);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /unknown, not rest/i);
});

test('an unreadable log is reported alongside a status failure', () => {
  assert.equal(syncMessages(null, true, true).length, 2);
});

test('indexEntries keys planned entries and filters extras to the given date', () => {
  const entries = [
    { date: '2026-08-25', planKey: 'bridge:1:tue:bike', status: 'done', strava: { id: 1 }, note: '' },
    { date: '2026-08-25', planKey: null, status: 'extra', strava: { id: 2 }, note: '' },
    { date: '2026-08-26', planKey: null, status: 'extra', strava: { id: 3 }, note: '' }
  ];
  const { byKey, extras } = indexEntries(entries, '2026-08-25');
  assert.equal(byKey.get('bridge:1:tue:bike').strava.id, 1);
  assert.equal(extras.length, 1);
  assert.equal(extras[0].strava.id, 2);
});

test('route parses each view and defaults to today', () => {
  assert.deepEqual(route('#/season').view, 'season');
  assert.equal(route('').view, 'day');
  assert.equal(route('').date, null, 'no date means the caller substitutes today');
  assert.equal(route('#/today').view, 'day');
  assert.equal(route('#/today').date, null);
  assert.equal(route('#/week/bridge/4').blockId, 'bridge');
  assert.equal(route('#/week/bridge/4').week, 4);
  assert.ok(Number.isNaN(route('#/week/bridge/abc').week), 'a malformed week must be NaN so the caller falls back');
});

test('route reads a specific day', () => {
  assert.equal(route('#/day/2026-10-06').view, 'day');
  assert.equal(route('#/day/2026-10-06').date, '2026-10-06');
});

test('route falls back to today rather than rendering a malformed day', () => {
  for (const bad of ['#/day/tomorrow', '#/day/2026-10', '#/day/2026-1-6', '#/day/']) {
    const r = route(bad);
    assert.equal(r.view, 'day', bad);
    assert.equal(r.date, null, bad);
  }
});

test('route reads a specific month', () => {
  assert.equal(route('#/month/2026-10').view, 'month');
  assert.equal(route('#/month/2026-10').ym, '2026-10');
  assert.equal(route('#/month').ym, null, 'a bare month view starts at the current month');
});

test('route rejects an out-of-range or malformed month', () => {
  for (const bad of ['#/month/2026-13', '#/month/2026-00', '#/month/october', '#/month/2026']) {
    assert.equal(route(bad).ym, null, bad);
  }
});

// ---- Sync now

test('the button asks GitHub to run the sync workflow on main', () => {
  const { url, init } = dispatchRequest('tok');
  assert.equal(url, 'https://api.github.com/repos/saroldhand/ironman-coach/actions/workflows/sync-now.yml/dispatches');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(init.body), { ref: 'main' });
  // Only headers GitHub's CORS policy allows from a browser.
  assert.deepEqual(Object.keys(init.headers).sort(), ['Accept', 'Authorization', 'Content-Type']);
  assert.match(runsRequest('tok').url, /sync-now\.yml\/runs\?event=workflow_dispatch/);
});

test('a refused token is told apart from GitHub being unavailable', () => {
  for (const status of [401, 403, 404]) assert.equal(dispatchFailure(status).tokenProblem, true, status);
  for (const status of [0, 422, 500]) assert.equal(dispatchFailure(status).tokenProblem, false, status);
  assert.match(dispatchFailure(403).text, /Actions: Read and write/);
  assert.match(dispatchFailure(500).text, /500/);
});

test('the workflow run is the newest one since the tap', () => {
  const tap = '2026-11-09T12:00:00Z';
  const run = (created_at, status, conclusion) => ({ created_at, status, conclusion, html_url: `u/${created_at}` });
  assert.deepEqual(workflowVerdict([], tap), { state: 'starting' });
  // An old failure from an earlier tap is not this tap's.
  assert.deepEqual(workflowVerdict([run('2026-11-09T11:00:00Z', 'completed', 'failure')], tap), { state: 'starting' });
  assert.deepEqual(workflowVerdict([run('2026-11-09T12:00:05Z', 'in_progress', null)], tap), { state: 'starting' });
  assert.deepEqual(workflowVerdict([run('2026-11-09T12:00:05Z', 'completed', 'success')], tap), { state: 'fired' });
  // A phone clock a minute fast still finds the run.
  assert.deepEqual(workflowVerdict([run('2026-11-09T11:59:00Z', 'completed', 'failure')], tap),
    { state: 'failed', url: 'u/2026-11-09T11:59:00Z' });
  assert.deepEqual(workflowVerdict([
    run('2026-11-09T12:00:05Z', 'completed', 'failure'),
    run('2026-11-09T12:01:00Z', 'completed', 'success')
  ], tap), { state: 'fired' }, 'the newest run decides');
});

test('the sync has landed when the status file shows a new run', () => {
  const before = { lastRun: '2026-11-09T09:52:00Z', ok: true };
  assert.equal(syncLanded(before, before), false);
  assert.equal(syncLanded(before, { ...before, lastRun: '2026-11-09T12:01:00Z' }), true);
  assert.equal(syncLanded(before, null), false, 'an unreadable status is not news');
  assert.equal(syncLanded(null, { lastRun: '2026-11-09T12:01:00Z' }), true);
});

test('the result line counts new workouts, not walks or resyncs', () => {
  const act = (id, type) => ({ date: '2026-11-09', status: 'extra', strava: { id, type } });
  const before = [act('1', 'Swim')];
  assert.equal(syncResultText(before, before, { ok: true }), 'Synced from Strava. Nothing new since the last sync.');
  assert.equal(syncResultText(before, [...before, act('2', 'Run')], { ok: true }), 'Synced from Strava: 1 new workout.');
  assert.equal(syncResultText(before, [...before, act('2', 'Run'), act('3', 'Ride'), act('4', 'Walk')], { ok: true }),
    'Synced from Strava: 2 new workouts.');
  assert.match(syncResultText(before, before, { ok: false, reason: 'strava-unreachable' }), /strava-unreachable/);
});
