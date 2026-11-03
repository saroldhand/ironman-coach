// The nightly Strava sync's one moving part. scripts/sync-runbook.md says when
// to run it; the rules it applies live in assets/log-model.js and are tested.
//
//   node scripts/sync.mjs <from> <to> <activities.json>
//       Match the activities (as list_activities returned them) to the plan
//       for every date from..to inclusive, merge them into data/log.json, and
//       record a successful run in data/sync-status.json.
//
//   node scripts/sync.mjs --failed <reason>
//       Record a failed run. Writes no log entries: a gap in data must never
//       read as a missed workout. lastSuccess keeps its previous value.
//
// DATA_DIR overrides the data directory, for a dry run against a copy.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { todayISO } from '../assets/date-utils.js';
import { syncRange } from '../assets/log-model.js';

const dir = process.env.DATA_DIR || 'data';
const read = name => JSON.parse(readFileSync(join(dir, name)));
const write = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + '\n');
const now = new Date().toISOString();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const previous = (() => { try { return read('sync-status.json'); } catch { return {}; } })();
const args = process.argv.slice(2);

if (args[0] === '--failed') {
  const reason = args[1] || 'unknown';
  write('sync-status.json', { lastRun: now, lastSuccess: previous.lastSuccess ?? null,
                              ok: false, reason, activitiesFound: 0 });
  console.log(JSON.stringify({ ok: false, reason }));
  process.exit(0);
}

const [from, to, activitiesPath] = args;
if (!ISO_DATE.test(from || '') || !ISO_DATE.test(to || '') || !activitiesPath || from > to) {
  console.error('usage: node scripts/sync.mjs <from YYYY-MM-DD> <to YYYY-MM-DD> <activities.json>');
  process.exit(2);
}

const plan = JSON.parse(readFileSync('data/plan.json'));
const log = read('log.json');
const raw = JSON.parse(readFileSync(activitiesPath));
// Accept the connector's whole response as well as its activities array.
const activities = Array.isArray(raw) ? raw : raw.activities || [];

const { entries, days } = syncRange(plan, log.entries, activities, from, to, todayISO());
write('log.json', { ...log, entries });

// A range wholly outside the plan still succeeded: there was nothing to
// record. Leaving lastSuccess stale would raise a "data may be stale" banner
// every night after the race.
const skipped = days.every(d => d.skipped);
write('sync-status.json', { lastRun: now, lastSuccess: now, ok: true,
                            reason: skipped ? days[0].skipped : null,
                            activitiesFound: days.reduce((t, d) => t + d.activities, 0) });
console.log(JSON.stringify({ ok: true, days }));
