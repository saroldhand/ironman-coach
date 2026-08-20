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
    const slot = pool.find(p =>
      !p.used && DISCIPLINE_BY_STRAVA_TYPE[p.activity.type] === session.discipline);

    if (slot) {
      slot.used = true;
      entries.push({
        date: resolvedDay.date,
        planKey: session.key,
        status: statusFor(session, slot.activity),
        strava: summarise(slot.activity),
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
  const out = [...existing];

  for (const entry of incoming) {
    const byId = entry.strava
      ? out.findIndex(e => e.strava && e.strava.id === entry.strava.id)
      : -1;
    const bySlot = entry.planKey
      ? out.findIndex(e => e.date === entry.date && e.planKey === entry.planKey)
      : -1;
    const at = byId !== -1 ? byId : bySlot;

    if (at === -1) {
      out.push(entry);
    } else {
      // Hand-written notes survive a resync.
      out[at] = { ...entry, note: out[at].note || entry.note };
    }
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
