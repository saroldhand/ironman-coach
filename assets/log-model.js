import { addDays } from './date-utils.js';
import { dayForDate, resolveWeek } from './plan-model.js';

export const DISCIPLINE_BY_STRAVA_TYPE = {
  Swim: 'swim',
  Ride: 'bike',
  VirtualRide: 'bike',
  GravelRide: 'bike',
  MountainBikeRide: 'bike',
  Run: 'run',
  TrailRun: 'run',
  VirtualRun: 'run',
  WeightTraining: 'strength',
  Workout: 'strength'
};

const DONE_AT = 0.85;
const PARTIAL_AT = 0.40;
const STATUS_RANK = { done: 3, partial: 2, missed: 1 };

function actualFor(session, activity) {
  return session.prescribed.metric === 'distance'
    ? activity.distance                       // metres
    : activity.moving_time / 60;              // minutes
}

export function statusFor(session, activity) {
  if (!activity) return 'missed';
  const ratio = actualFor(session, activity) / session.prescribed.value;
  if (ratio >= DONE_AT) return 'done';
  if (ratio >= PARTIAL_AT) return 'partial';
  return 'missed';
}

export function matchDay(resolvedDay, activities, opts = {}) {
  const elapsed = Boolean(opts.elapsed);
  const pool = activities.map(a => ({ activity: a, used: false }));
  const entries = [];

  for (const session of resolvedDay.sessions) {
    // Best fit, not first fit: among unused activities of the right discipline,
    // take the one that best satisfies THIS session. First-fit lets a 5-minute
    // ride consume the slot for a 60-minute session and pushes the real ride
    // out to `extra`, reporting a completed session as missed.
    let best = null;
    for (const p of pool) {
      if (p.used) continue;
      if (DISCIPLINE_BY_STRAVA_TYPE[p.activity.type] !== session.discipline) continue;

      const ratio = actualFor(session, p.activity) / session.prescribed.value;
      const rank = STATUS_RANK[statusFor(session, p.activity)];

      if (!best
        || rank > best.rank
        || (rank === best.rank && Math.abs(ratio - 1) < Math.abs(best.ratio - 1))) {
        best = { slot: p, rank, ratio };
      }
    }

    if (best) {
      best.slot.used = true;
      entries.push({
        date: resolvedDay.date,
        planKey: session.key,
        status: statusFor(session, best.slot.activity),
        strava: summarise(best.slot.activity),
        note: ''
      });
    } else if (elapsed && !session.optional) {
      entries.push({
        date: resolvedDay.date,
        planKey: session.key,
        status: 'missed',
        strava: null,
        note: ''
      });
    }
  }

  for (const p of pool) {
    if (p.used) continue;
    entries.push({
      date: resolvedDay.date,
      planKey: null,
      status: 'extra',
      strava: summarise(p.activity),
      note: ''
    });
  }

  return entries;
}

function summarise(a) {
  return {
    id: a.id,
    type: a.type,
    name: a.name,
    movingTime: a.moving_time,
    distance: a.distance,
    avgHr: a.average_heartrate ?? null,
    url: `https://www.strava.com/activities/${a.id}`
  };
}

// Identity: a Strava id when there is one, otherwise date + planKey.
// This lets a 'missed' placeholder be replaced by the real activity later.
function identity(entry) {
  return entry.strava ? `strava:${entry.strava.id}` : `plan:${entry.date}:${entry.planKey}`;
}

export function mergeEntries(existing, incoming) {
  let out = [...existing];

  for (const entry of incoming) {
    // Every record this entry supersedes: the one carrying the same Strava id,
    // and the one occupying the same plan slot. Usually the same record. When
    // they differ, keeping both would put two entries on one planKey, and
    // weekCompletion would count that session twice.
    const superseded = out.filter(e =>
      (entry.strava && e.strava && e.strava.id === entry.strava.id) ||
      (entry.planKey && e.date === entry.date && e.planKey === entry.planKey));

    // A hand-written note survives a resync, whichever record carried it.
    const note = superseded.map(e => e.note).find(n => n) || entry.note;

    out = out.filter(e => !superseded.includes(e));
    out.push({ ...entry, note });
  }

  return out.sort((a, b) =>
    a.date === b.date ? identity(a).localeCompare(identity(b)) : a.date.localeCompare(b.date));
}

export function weekCompletion(resolvedWeek, entries) {
  if (!resolvedWeek.authored) return { done: 0, planned: 0, pct: null };

  const keys = new Set();
  for (const day of resolvedWeek.days) {
    for (const s of day.sessions) if (!s.optional) keys.add(s.key);
  }

  const relevant = entries.filter(e => keys.has(e.planKey));
  if (relevant.length === 0) return { done: 0, planned: keys.size, pct: null };

  const done = relevant.filter(e => e.status === 'done' || e.status === 'partial').length;
  return { done, planned: keys.size, pct: Math.round((done / keys.size) * 100) };
}

export const TRAINING_DISCIPLINES = ['swim', 'bike', 'run', 'strength'];

// What was actually done in a week, by discipline. Every recorded activity
// dated inside the week counts - one matched to a session and one that was not
// on the plan alike - because the question is how much training happened, not
// how much of the plan. A 'missed' entry has no activity and adds nothing.
//
// Activities Strava types as something else (a walk, a hike) go in `other`,
// outside the total, so the total compares like with like against the plan.
//
// `recorded` says whether anything at all came back for the week. A week with
// nothing recorded is unknown - the sync may not have run - not a week of rest.
export function weekActuals(week, entries) {
  const end = addDays(week.startDate, 7);
  const blank = () => ({ minutes: 0, metres: 0, count: 0 });
  const byDiscipline = Object.fromEntries([...TRAINING_DISCIPLINES, 'other'].map(d => [d, blank()]));

  let recorded = false;
  for (const e of entries) {
    if (!e.strava || e.date < week.startDate || e.date >= end) continue;
    recorded = true;
    const d = DISCIPLINE_BY_STRAVA_TYPE[e.strava.type] || 'other';
    byDiscipline[d].minutes += (e.strava.movingTime || 0) / 60;
    byDiscipline[d].metres += e.strava.distance || 0;
    byDiscipline[d].count += 1;
  }

  const total = blank();
  for (const d of TRAINING_DISCIPLINES) {
    total.minutes += byDiscipline[d].minutes;
    total.metres += byDiscipline[d].metres;
    total.count += byDiscipline[d].count;
  }
  return { recorded, byDiscipline, total };
}

// The Strava connector and the Strava API name the same things differently:
// the API has type, start_date_local, moving_time and distance at the top
// level; the connector has sport_type, start_local, and the numbers inside a
// summary object. Matching reads the API's shape, and this turns either into
// it, so the nightly sync can pass the connector's activities through as-is.
export function normaliseActivity(a) {
  const s = a.summary || {};
  return {
    id: String(a.id),
    type: a.type || a.sport_type,
    name: a.name,
    moving_time: a.moving_time ?? s.moving_time ?? 0,
    distance: a.distance ?? s.distance ?? 0,
    average_heartrate: a.average_heartrate ?? s.average_heartrate ?? null,
    start_date_local: a.start_date_local || a.start_local
  };
}

// One sync over an inclusive range of dates: each date's activities matched
// against that date's sessions and merged into the log. Pure - the script in
// scripts/sync.mjs does the reading and writing.
//
// A date outside the plan records nothing. Only a date before today can mark
// a session missed; today's unperformed sessions stay blank, because unknown
// is not the same as skipped. An in-plan date with no written week matches
// against no sessions, so its activities are kept as extras, never dropped.
export function syncRange(plan, existing, rawActivities, from, to, today) {
  const activities = rawActivities.map(normaliseActivity);
  let entries = existing;
  const days = [];

  for (let date = from; date <= to; date = addDays(date, 1)) {
    const onDate = activities.filter(a => (a.start_date_local || '').slice(0, 10) === date);
    const where = dayForDate(plan, date);
    if (!where.inPlan) {
      days.push({ date, activities: onDate.length, skipped: where.reason });
      continue;
    }
    const resolvedDay = where.authored
      ? resolveWeek(plan, where.blockId, where.week).days.find(d => d.dayKey === where.dayKey)
      : { date, dayKey: where.dayKey, sessions: [] };
    const matched = matchDay(resolvedDay, onDate, { elapsed: date < today });
    entries = mergeEntries(entries, matched);
    days.push({ date, activities: onDate.length, entries: matched.length });
  }

  return { entries, days };
}
