// Pure state/logic used by app.js, kept separate so it can be imported and
// tested by `node --test` without touching `document` or the network.
// app.js is the only module allowed to dereference `document` or call fetch.

import { hoursSince } from './date-utils.js';

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

export function route(hash) {
  const h = hash || '#/today';
  const parts = h.replace(/^#\//, '').split('/');
  return { view: parts[0] || 'today', blockId: parts[1], week: Number(parts[2]) };
}
