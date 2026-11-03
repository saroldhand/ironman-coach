// What a training day costs in clock time: when the alarm goes, when the
// lights go out the night before, what to lay out, and how many hours a week
// adds up to. Pure — no Date, no document — so node --test can check every
// morning in the plan against the hours the athlete actually has.
//
// Times are minutes after midnight. Nothing here crosses midnight except
// lights-out, which is the evening before the alarm and is wrapped for display.

import { dayForDate, resolveWeek } from './plan-model.js';
import { addDays } from './date-utils.js';

const DAY_MIN = 24 * 60;
const ALARM_STEP = 5;

export function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// "5:40 am", "9:40 pm" - how the times will be set on a phone.
export function clockText(min) {
  const t = ((min % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const h = Math.floor(t / 60);
  const m = t % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

// Minutes a session takes. Swims are prescribed in metres, so they are timed
// at the pace in the schedule, rest included. Race-day legs prescribed by
// distance have no fixed time and return null.
export function sessionMinutes(session, schedule) {
  const p = session.prescribed;
  if (p.metric === 'duration') return p.value;
  if (session.discipline === 'swim') return Math.round((p.value / 100) * schedule.swimSecPer100 / 60);
  return null;
}

// The week's plan by discipline: minutes for everything, and metres where the
// plan prescribes a distance (the swims, and race day). Optional sessions are
// left out, as the design's weekly hours always have been.
export function plannedByDiscipline(week, schedule) {
  const out = {};
  for (const day of week.days) {
    for (const s of day.sessions) {
      if (s.optional) continue;
      const d = out[s.discipline] || (out[s.discipline] = { minutes: 0, metres: 0 });
      d.minutes += sessionMinutes(s, schedule) || 0;
      if (s.prescribed.metric === 'distance') d.metres += s.prescribed.value;
    }
  }
  return out;
}

// Training time in a week, in hours to one decimal.
export function weekHours(week, schedule) {
  const total = Object.values(plannedByDiscipline(week, schedule))
    .reduce((t, d) => t + d.minutes, 0);
  return Math.round(total / 6) / 10;
}

// "8.0 h": one decimal always, so a column of weeks lines up.
export function hoursText(hours) {
  return `${hours.toFixed(1)} h`;
}

// The morning before work, worked backwards from the time the athlete has to
// be ready: home again with time to shower and eat, so out of the venue
// before that, so started before that, so up before that.
//
// Returns null when the day has no before-work session, or when it is not a
// work day at all (weekends). A date in schedule.daysOff returns
// { status: 'off' } so the page can say why there is no alarm.
export function morning(plan, day) {
  const sch = plan.schedule;
  if (!sch) return null;

  const am = day.sessions.filter(s => s.when === 'before-work');
  const offLabel = sch.daysOff ? sch.daysOff[day.date] : undefined;
  if (offLabel !== undefined) return { status: 'off', offLabel };

  const work = sch.workdays[day.dayKey];
  if (!work || !am.length) return null;

  const venueKey = am[0].venue || 'home';
  const venue = sch.venues[venueKey];
  const ready = toMin(work.readyBy);
  const trainMin = am.reduce((t, s) => t + (sessionMinutes(s, sch) || 0), 0)
    + sch.betweenSessionsMin * (am.length - 1);

  const home = ready - sch.afterMin;
  const finish = home - venue.travelMin - venue.changeAfterMin;
  const start = finish - trainMin;
  const arrive = start - venue.changeBeforeMin;
  const leave = arrive - venue.travelMin;
  const alarm = Math.floor((leave - sch.wakeToDoorMin) / ALARM_STEP) * ALARM_STEP;
  const lightsOut = alarm - sch.sleepHours * 60;

  // A pool that opens after the plan would have you in it means the morning
  // does not fit. The page says so rather than printing an alarm that cannot
  // work; the data tests keep the plan from ever asking it.
  const opens = venue.opens ? toMin(venue.opens) : null;
  const earlyBy = opens !== null && arrive < opens ? opens - arrive : 0;

  // The alarm leads the card in large type, so the timeline starts at the door.
  const timeline = [];
  if (venue.travelMin) timeline.push({ at: leave, label: 'Leave' });
  timeline.push({ at: start, label: venue.travelMin ? `Start at the ${venue.label.toLowerCase()}` : 'Start' });
  timeline.push({ at: finish, label: 'Done' });
  if (venue.travelMin) timeline.push({ at: home, label: 'Home to shower and eat' });
  timeline.push({ at: ready, label: work.label });

  return {
    status: 'work',
    venue: { key: venueKey, label: venue.label },
    sessions: am,
    trainMin,
    alarm,
    lightsOut,
    readyBy: ready,
    readyLabel: work.label,
    timeline,
    earlyBy
  };
}

// What to lay out the night before, in the order the day uses it. Each kit is
// named once however many sessions need it.
export function kitFor(plan, day) {
  const seen = new Set();
  const out = [];
  for (const s of day.sessions) {
    for (const key of s.kit || []) {
      if (seen.has(key) || !plan.kit || !plan.kit[key]) continue;
      seen.add(key);
      out.push({ key, ...plan.kit[key] });
    }
  }
  return out;
}

// Whether to eat before leaving. An hour or more, or a quality day, runs on
// carbs; anything shorter and easy does not need them.
export function fuelBefore(plan, day, am) {
  if (!am || am.status !== 'work') return null;
  const fuel = plan.nutrition.fuel;
  const quality = day.nutrition === plan.nutrition.types.key;
  return am.trainMin >= 60 || quality ? fuel.beforeLong : fuel.beforeShort;
}

// The whole day as the night before needs it.
export function dayPlan(plan, iso) {
  const where = dayForDate(plan, iso);
  if (!where.inPlan || !where.authored) return null;
  const week = resolveWeek(plan, where.blockId, where.week);
  const day = week.days.find(d => d.dayKey === where.dayKey);
  const am = morning(plan, day);
  return { where, day, morning: am, kit: kitFor(plan, day), fuel: fuelBefore(plan, day, am) };
}

// Tonight, for tomorrow. Null past the end of the plan.
export function tonight(plan, todayIso) {
  return dayPlan(plan, addDays(todayIso, 1));
}

// A week at a glance: its hours and every work-morning alarm.
export function weekSummary(plan, week) {
  const alarms = new Map();
  let earliest = null;
  for (const day of week.days) {
    const am = morning(plan, day);
    if (!am || am.status !== 'work') continue;
    alarms.set(day.date, am.alarm);
    if (!earliest || am.alarm < earliest.alarm) earliest = { date: day.date, alarm: am.alarm };
  }
  return { hours: plan.schedule ? weekHours(week, plan.schedule) : null, alarms, earliest };
}
