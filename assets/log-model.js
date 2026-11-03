import { addDays, weekdayKey } from './date-utils.js';
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
  Workout: 'strength',
  HighIntensityIntervalTraining: 'strength',
  Crossfit: 'strength'
};

// Walks, hikes and anything else Strava types outside the four disciplines are
// kept in the log, so nothing is lost, but they are not training: no total,
// bar or list on the site counts them.
export function isTraining(type) {
  return Boolean(DISCIPLINE_BY_STRAVA_TYPE[type]);
}

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

const blankTotals = () => Object.fromEntries(
  TRAINING_DISCIPLINES.map(d => [d, { minutes: 0, metres: 0, count: 0 }]));

// What was actually done between two dates (`to` exclusive), by discipline.
// Every recorded training activity in the range counts - one matched to a
// session and one that was not on the plan alike - because the question is
// how much training happened, not how much of the plan. Walks and hikes do
// not count. A 'missed' entry has no activity and adds nothing.
//
// `recorded` says whether anything at all came back for the range. A range
// with nothing recorded is unknown - the sync may not have run - not rest.
export function actualsBetween(entries, from, to) {
  const byDiscipline = blankTotals();
  let recorded = false;
  for (const e of entries) {
    if (!e.strava || e.date < from || e.date >= to) continue;
    recorded = true;
    const d = DISCIPLINE_BY_STRAVA_TYPE[e.strava.type];
    if (!d) continue;
    byDiscipline[d].minutes += (e.strava.movingTime || 0) / 60;
    byDiscipline[d].metres += e.strava.distance || 0;
    byDiscipline[d].count += 1;
  }
  const total = { minutes: 0, metres: 0, count: 0 };
  for (const d of TRAINING_DISCIPLINES) {
    total.minutes += byDiscipline[d].minutes;
    total.metres += byDiscipline[d].metres;
    total.count += byDiscipline[d].count;
  }
  return { recorded, byDiscipline, total };
}

export function weekActuals(week, entries) {
  return actualsBetween(entries, week.startDate, addDays(week.startDate, 7));
}

// The Monday of the week a date falls in, and the month it falls in: the two
// ways the site groups training.
const DAY_INDEX = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
export function mondayOf(date) {
  return addDays(date, -DAY_INDEX[weekdayKey(date)]);
}
const PERIOD_KEY = { week: mondayOf, month: date => date.slice(0, 7) };

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// A typical week (or month) per discipline: the median over the periods in
// which that discipline was done at all. The median, not the biggest: one
// 570 km touring week would otherwise make every other week look empty.
export function typicalPeriod(entries, period) {
  const key = PERIOD_KEY[period];
  const totals = new Map();
  for (const e of entries) {
    if (!e.strava) continue;
    const d = DISCIPLINE_BY_STRAVA_TYPE[e.strava.type];
    if (!d) continue;
    const k = key(e.date);
    if (!totals.has(k)) totals.set(k, blankTotals());
    const t = totals.get(k)[d];
    t.minutes += (e.strava.movingTime || 0) / 60;
    t.metres += e.strava.distance || 0;
    t.count += 1;
  }
  const out = {};
  for (const d of TRAINING_DISCIPLINES) {
    const done = [...totals.values()].map(t => t[d]).filter(t => t.count);
    out[d] = { minutes: median(done.map(t => t.minutes)), metres: median(done.map(t => t.metres)) };
  }
  return out;
}

// The athlete's usual speed per discipline, in metres per second: all the
// distance recorded over all the moving time. Used to turn a planned ride or
// run time into an approximate distance - an estimate, and labelled as one.
export function usualSpeed(entries) {
  const sums = blankTotals();
  for (const e of entries) {
    if (!e.strava) continue;
    const d = DISCIPLINE_BY_STRAVA_TYPE[e.strava.type];
    if (!d || !e.strava.distance || !e.strava.movingTime) continue;
    sums[d].metres += e.strava.distance;
    sums[d].minutes += e.strava.movingTime / 60;
  }
  const out = {};
  for (const d of TRAINING_DISCIPLINES) {
    out[d] = sums[d].minutes ? sums[d].metres / (sums[d].minutes * 60) : null;
  }
  return out;
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
