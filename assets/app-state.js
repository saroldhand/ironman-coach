// Pure state/logic used by app.js, kept separate so it can be imported and
// tested by `node --test` without touching `document` or the network.
// app.js is the only module allowed to dereference `document` or call fetch.

import { hoursSince } from './date-utils.js';
import { isTraining } from './log-model.js';

const STALE_HOURS = 36;

export function syncMessages(status, logFailed, statusFailed) {
  const msgs = [];
  if (logFailed) msgs.push('Training log unavailable — showing the plan only.');
  if (statusFailed) {
    // Without this file we cannot tell whether the log is fresh. Say so:
    // a silent page here would be indistinguishable from a healthy sync.
    msgs.push('Sync status unavailable — cannot tell when training data was last updated. Blanks below mean unknown, not rest.');
  }
  if (!status) return msgs;

  if (status.reason === 'never-run') {
    msgs.push('Nightly Strava sync has never run. Completed sessions will stay blank.');
  } else if (!status.ok) {
    msgs.push(`Last sync failed (${status.reason}). Data may be incomplete — this is not a rest day.`);
  } else if (status.lastSuccess && hoursSince(status.lastSuccess) > STALE_HOURS) {
    msgs.push(`Last successful sync ${Math.round(hoursSince(status.lastSuccess) / 24)} days ago. Data may be stale.`);
  }
  return msgs;
}

export function indexEntries(entries, date) {
  const byKey = new Map();
  const extras = [];
  for (const e of entries) {
    if (e.status === 'extra') { if (e.date === date) extras.push(e); continue; }
    byKey.set(e.planKey, e);
  }
  return { byKey, extras };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// Every level of the plan is addressable, so a link can move between them:
//   #/day/2026-11-17  #/week/bridge/2  #/month/2026-11  #/season
// A malformed date or month is not an error page — it degrades to "now",
// because a mistyped URL should still show the athlete something useful.
export function route(hash) {
  const h = hash || '#/today';
  const parts = h.replace(/^#\//, '').split('/');
  const view = parts[0] || 'today';

  if (view === 'month') {
    return { view: 'month', ym: ISO_MONTH.test(parts[1]) ? parts[1] : null };
  }
  if (view === 'day' || view === 'today') {
    return { view: 'day', date: ISO_DATE.test(parts[1]) ? parts[1] : null };
  }
  return { view, blockId: parts[1], week: Number(parts[2]) };
}

// ---- Sync now: the button in the header ----
//
// A static page cannot start the Claude scheduled task itself: the task's fire
// endpoint answers no calls from a browser. GitHub's API does, so the button
// starts a workflow (.github/workflows/sync-now.yml) that fires the task, and
// the task syncs and pushes to main exactly as it does every night. The page
// then watches data/sync-status.json for a run it has not seen.

export const SYNC_REPO = 'saroldhand/ironman-coach';
export const SYNC_WORKFLOW = 'sync-now.yml';
export const SYNC_POLL_MS = 8000;
export const SYNC_GIVE_UP_MS = 6 * 60 * 1000;

const workflowURL = `https://api.github.com/repos/${SYNC_REPO}/actions/workflows/${SYNC_WORKFLOW}`;
const githubHeaders = token => ({ Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` });

export function dispatchRequest(token) {
  return {
    url: `${workflowURL}/dispatches`,
    init: {
      method: 'POST',
      headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' })
    }
  };
}

export function runsRequest(token) {
  return {
    url: `${workflowURL}/runs?event=workflow_dispatch&per_page=5`,
    init: { headers: githubHeaders(token), cache: 'no-store' }
  };
}

// What a refused dispatch means, and whether the token on this device is the
// thing to fix. Status 0 is a request that never got an answer.
export function dispatchFailure(status) {
  if (status === 401) return { tokenProblem: true, text: 'GitHub did not accept the token on this device. It may have expired or been revoked.' };
  if (status === 403) return { tokenProblem: true, text: 'This token cannot start workflows. It needs Actions: Read and write on ironman-coach.' };
  if (status === 404) return { tokenProblem: true, text: 'GitHub cannot find the sync workflow with this token. Check that it has access to ironman-coach.' };
  if (status === 422) return { tokenProblem: false, text: 'GitHub would not start the sync workflow. It may be turned off in the repo\'s Actions tab.' };
  if (status === 0) return { tokenProblem: false, text: 'Could not reach GitHub. Check the connection and try again.' };
  return { tokenProblem: false, text: `GitHub answered ${status}. Try again in a minute.` };
}

// The workflow run this tap started: the newest one created since the tap,
// allowing for a phone clock that runs a little ahead of GitHub's.
const CLOCK_SLACK_MS = 2 * 60 * 1000;

export function workflowVerdict(runs, tappedAt) {
  const since = new Date(tappedAt).getTime() - CLOCK_SLACK_MS;
  const run = (runs || [])
    .filter(r => new Date(r.created_at).getTime() >= since)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!run || run.status !== 'completed') return { state: 'starting' };
  if (run.conclusion === 'success') return { state: 'fired' };
  return { state: 'failed', url: run.html_url };
}

// The sync has landed once sync-status.json carries a run the page had not seen.
export function syncLanded(before, after) {
  return Boolean(after && after.lastRun && after.lastRun !== (before && before.lastRun));
}

// One line for the header once the new data is on the page. Walks and hikes
// are in the log but are not training, so they are not news either.
export function syncResultText(beforeEntries, afterEntries, status) {
  if (status && !status.ok) {
    return `The sync ran but could not read Strava (${status.reason}). Nothing was changed.`;
  }
  const seen = new Set(beforeEntries.filter(e => e.strava).map(e => e.strava.id));
  const fresh = afterEntries.filter(e => e.strava && !seen.has(e.strava.id) && isTraining(e.strava.type)).length;
  if (!fresh) return 'Synced from Strava. Nothing new since the last sync.';
  return `Synced from Strava: ${fresh} new workout${fresh === 1 ? '' : 's'}.`;
}
