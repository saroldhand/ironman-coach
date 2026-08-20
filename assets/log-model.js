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
