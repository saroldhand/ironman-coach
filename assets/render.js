import { planStart, blocksInOrder } from './plan-model.js';
import { addDays, addMonths, monthLabel, weekdayKey, dayLabel } from './date-utils.js';
import { clockText, morning, kitFor, fuelBefore, tonight, weekSummary, weekHours, hoursText,
         plannedBetween } from './schedule-model.js';
import { weekActuals, actualsBetween, typicalPeriod, usualSpeed, isTraining,
         DISCIPLINE_BY_STRAVA_TYPE, TRAINING_DISCIPLINES } from './log-model.js';

const DOW = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
              fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of [children].flat(Infinity)) {
    if (c === null || c === undefined) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

const METRES_PER_MILE = 1609.344;

// Rides and runs read in miles, the athlete's units. Swims stay in metres:
// the pool sets are written in metres, and a swim in miles reads as a typo.
// Everything underneath is metres; only the words change.
export function distanceText(metres, discipline = 'swim') {
  if (discipline === 'swim') return `${Math.round(metres).toLocaleString()} m`;
  return `${(metres / METRES_PER_MILE).toFixed(1)} mi`;
}

export function prescribedText(p, discipline = 'swim') {
  return p.metric === 'distance' ? distanceText(p.value, discipline) : `${p.value} min`;
}

const SUMMARY_MAX = 38;

const MAIN_SET = 'MAIN SET: ';

// The one line a day cell shows under a session's title. A lift is named by its
// main set - always the first line. A swim's first line is the warmup, which
// says nothing about the session, so a swim is named by its MAIN SET line when
// it has one. Everything else is named by its effort.
export function summaryLine(session) {
  if (session.discipline === 'strength' && session.setLines.length) {
    return truncate(session.setLines[0], SUMMARY_MAX);
  }
  const main = session.setLines.find(l => l.startsWith(MAIN_SET));
  const source = main ? firstClause(main.slice(MAIN_SET.length)) : firstClause(session.effort);
  return truncate(source, SUMMARY_MAX);
}

// Effort strings run "Zone 2 - 65-75% max HR. Conversational the whole way."
// Either separator can come first, so split on whichever does.
function firstClause(effort) {
  return (effort || '').split(/\.\s|\s[-–]\s/)[0].replace(/\.$/, '');
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function actualText(strava, session) {
  const mins = Math.round(strava.movingTime / 60);
  const distance = distanceText(strava.distance, session.discipline);
  const parts = session.prescribed.metric === 'distance'
    ? [distance, `${mins} min`]
    : [`${mins} min`, distance];
  if (strava.avgHr) parts.push(`${Math.round(strava.avgHr)} bpm avg`);
  return parts.join(' · ');
}

// Which fuelling rules apply today, chosen by the day's actual sessions rather
// than hardcoded into them — a 70-minute recovery ride and a 135-minute long
// ride must not get the same advice.
//
// A week template can carry its own rules - race-specific long rides fuel at a
// higher carb rate than base ones - so the day's merged map wins when present.
export function fuelLines(plan, resolved) {
  const f = resolved.fuel || plan.nutrition.fuel;
  const lines = [];
  // Race-day legs are prescribed by distance, and any bike or run worth
  // prescribing by distance is long enough to fuel.
  const isLong = s => (s.prescribed.metric === 'duration'
    ? s.prescribed.value >= 75
    : s.discipline === 'bike' || s.discipline === 'run');
  const long = resolved.sessions.filter(isLong);

  for (const s of long) {
    if (s.discipline === 'bike') lines.push(f.longRide);
    if (s.discipline === 'run') lines.push(f.longRun);
  }
  if (!lines.length) lines.push(f.under75min);

  if (long.length) lines.push(f.post);

  return lines;
}

// Activities Strava recorded with no matching planned slot. Shared between the
// unauthored-block early return and the normal path so an unauthored day's
// extras are never dropped from the view — see log-model's `extra` status.
function extrasSection(extras, title = 'Not on the plan') {
  // Walks and hikes stay in the log but are not training: they are not listed.
  const training = extras.filter(e => isTraining(e.strava.type));
  if (!training.length) return null;
  return el('section', { class: 'card' }, [
    el('h2', {}, title),
    el('ul', { class: 'activities' }, training.map(activityItem))
  ]);
}

// ---- what was actually done ----
// The plan says how long; Strava says how long and how far. Durations read as
// h:mm, so a 45-minute run and a 3-hour ride line up.

export function durationText(minutes) {
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

function doneDistance(discipline, metres) {
  return distanceText(metres, discipline);
}

const DISCIPLINE_LABEL = { swim: 'Swim', bike: 'Bike', run: 'Run', strength: 'Lift' };

// One recorded activity, as a list item: name, then time and distance.
function activityItem(e) {
  const d = DISCIPLINE_BY_STRAVA_TYPE[e.strava.type];
  const parts = [durationText(e.strava.movingTime / 60)];
  if (d !== 'strength' && e.strava.distance) parts.push(doneDistance(d, e.strava.distance));
  return el('li', {}, [
    el('span', { class: `dot ${d}` }),
    el('a', { href: e.strava.url, target: '_blank', rel: 'noopener' }, e.strava.name),
    el('span', { class: 'amount' }, parts.join(' · '))
  ]);
}

// A bar fills toward a target, and says which:
//   - the plan, where the period has one (planned time; planned swim metres);
//   - for ride and run distance in a planned period, the planned time at the
//     athlete's usual speed - an estimate, marked ≈;
//   - with no plan, the athlete's typical week or month (the median), so one
//     huge touring week does not make every other week look empty.
// Lifting has a time bar only. Nothing recorded is unknown, not zero: the
// value reads "—" and the bar stays empty.
export function disciplineBars({ actuals, planned, typical, speed, period = 'week' }) {
  const plannedFor = d => (planned && planned.days ? planned.byDiscipline[d] : null);
  return TRAINING_DISCIPLINES.map(d => {
    const a = actuals.byDiscipline[d];
    const p = plannedFor(d);
    const t = typical[d] || { minutes: 0, metres: 0 };

    const timeTarget = p && p.minutes ? { value: p.minutes, kind: 'plan' }
      : t.minutes ? { value: t.minutes, kind: 'typical' } : null;
    const bars = [bar('time', a.minutes, timeTarget, actuals.recorded, durationText, period)];

    if (d !== 'strength') {
      let distTarget = null;
      if (d === 'swim' && p && p.metres) distTarget = { value: p.metres, kind: 'plan' };
      else if (d !== 'swim' && p && p.minutes && speed[d]) distTarget = { value: p.minutes * 60 * speed[d], kind: 'estimate' };
      else if (t.metres) distTarget = { value: t.metres, kind: 'typical' };
      bars.push(bar('distance', a.metres, distTarget, actuals.recorded, m => doneDistance(d, m), period));
    }
    return { discipline: d, label: DISCIPLINE_LABEL[d], bars };
  });
}

function bar(kind, value, target, recorded, format, period) {
  const pct = !recorded || !value ? 0
    : target ? Math.min(100, Math.round((value / target.value) * 100)) : 100;
  let targetText = null;
  if (target) {
    const amount = format(target.value);
    targetText = target.kind === 'plan' ? `${amount} planned`
      : target.kind === 'estimate' ? `≈${amount} planned`
      : `typical ${period} ${amount}`;
  }
  return {
    kind, pct,
    over: Boolean(recorded && target && value > target.value),
    text: recorded ? format(value) : '—',
    targetText
  };
}

// The bars for a period - a week or a month - as a card.
function barsCard(title, { actuals, planned, typical, speed, period }) {
  const rows = disciplineBars({ actuals, planned, typical, speed, period });
  const plannedMin = planned && planned.days
    ? TRAINING_DISCIPLINES.reduce((t, d) => t + ((planned.byDiscipline[d] || {}).minutes || 0), 0)
    : 0;
  const doneH = hoursText(Math.round(actuals.total.minutes / 6) / 10);
  const summary = !actuals.recorded ? 'nothing from Strava yet'
    : plannedMin ? `${doneH.replace(' h', '')} of ${hoursText(Math.round(plannedMin / 6) / 10)}`
    : doneH;

  return el('section', { class: 'card bars' }, [
    el('h2', {}, [title, el('span', { class: 'prescribed' }, summary)]),
    ...rows.map(r => el('div', { class: `dgroup ${r.discipline}` }, [
      el('div', { class: 'dname' }, r.label),
      ...r.bars.map(b => el('div', { class: `brow${b.over ? ' over' : ''}` }, [
        el('span', { class: 'bk' }, b.kind === 'time' ? 'Time' : 'Distance'),
        el('span', { class: 'track', role: 'img',
                     'aria-label': `${r.label} ${b.kind}: ${b.text}${b.targetText ? ` of ${b.targetText}` : ''}` },
          el('span', { class: 'fill', style: `width:${b.pct}%` })),
        el('span', { class: 'bval' }, [b.text, b.targetText ? el('span', { class: 'btarget' }, ` / ${b.targetText}`) : null])
      ]))
    ]))
  ]);
}

// Everything a period's bars need. A period that has not finished yet - the
// current week, or a plan week still to come - is progress so far: nothing
// recorded reads as zero, so its bars start empty and fill as the nightly sync
// brings workouts in. Only a period that is over and recorded nothing is
// unknown, shown as dashes: the sync may not have run, and that is not rest.
export function periodBars(plan, entries, from, to, period, today) {
  const actuals = actualsBetween(entries, from, to);
  if (!actuals.recorded && today < to) actuals.recorded = true;
  return {
    actuals,
    planned: plan.schedule ? plannedBetween(plan, from, to) : null,
    typical: typicalPeriod(entries, period),
    speed: usualSpeed(entries),
    period
  };
}

// ---- the clock ----
// What a day costs before it starts: when to be up, when to be in bed the
// night before, and what to lay out. The arithmetic is schedule-model's; this
// only words it.

const WHEN = { 'before-work': 'before work', lunch: 'lunch' };

export function whenText(when) {
  return WHEN[when] || null;
}

// "7.5 h of training · earliest alarm 5:30 am Tuesday"
export function weekHeadline(summary) {
  const parts = [];
  if (summary.hours !== null && summary.hours !== undefined) parts.push(`${hoursText(summary.hours)} of training`);
  if (summary.earliest) {
    parts.push(`earliest alarm ${clockText(summary.earliest.alarm)} ${DOW[weekdayKey(summary.earliest.date)]}`);
  }
  return parts.join(' · ');
}

// "6:11" - the timeline already says morning; am/pm on every line is noise.
function shortClock(min) {
  return clockText(min).replace(/ (am|pm)$/, '');
}

function morningLines(am, when) {
  const out = [el('p', { class: 'alarmline' }, [
    el('span', { class: 'big' }, `Alarm ${clockText(am.alarm)}`),
    el('span', { class: 'sub' }, `Lights out ${clockText(am.lightsOut)} ${when}`)
  ])];
  if (am.earlyBy) {
    out.push(el('p', { class: 'warnline' },
      `This doesn't fit: it needs you at the ${am.venue.label.toLowerCase()} ${am.earlyBy} min before it opens.`));
  }
  out.push(el('ol', { class: 'timeline' }, am.timeline.map(t =>
    el('li', {}, [el('span', { class: 't' }, shortClock(t.at)), el('span', {}, t.label)]))));
  return out;
}

function fuelLine(fuel) {
  return fuel ? el('p', { class: 'effort' }, [el('strong', {}, 'Eat first? '), fuel]) : null;
}

function kitBlock(kit) {
  if (!kit.length) return null;
  return el('div', { class: 'kit' }, kit.map(k => el('div', { class: 'kitgroup' }, [
    el('h3', {}, k.label),
    el('ul', {}, k.items.map(i => el('li', {}, i)))
  ])));
}

// The day's own clock card, at the top of its page.
function dayClockCard(plan, resolved) {
  const am = morning(plan, resolved);
  const kit = kitFor(plan, resolved);
  if (!am && !kit.length) return null;

  const body = [];
  if (am && am.status === 'work') {
    body.push(el('h2', {}, ['Before work',
      el('span', { class: 'prescribed' }, `${am.venue.label} · ${am.trainMin} min`)]));
    body.push(...morningLines(am, 'the night before'));
    body.push(fuelLine(fuelBefore(plan, resolved, am)));
  } else if (am && am.status === 'off') {
    body.push(el('h2', {}, ['Day off work', el('span', { class: 'prescribed' }, am.offLabel)]));
    body.push(el('p', { class: 'effort' }, 'No alarm. Train when it suits.'));
  } else {
    body.push(el('h2', {}, 'Kit'));
  }
  if (kit.length && body.length > 1) body.push(el('p', { class: 'daymeta' }, 'Lay out the night before'));
  body.push(kitBlock(kit));
  return el('section', { class: 'card clock' }, body);
}

// Tonight, for tomorrow: the card to read before bed.
function tonightCard(plan, today) {
  const t = tonight(plan, today);
  if (!t) return null;
  const { day, morning: am, kit, fuel } = t;
  const name = DOW[day.dayKey];

  // A work day whose sessions carry no place (the lifting block predates the
  // routine) says nothing about the alarm rather than claiming there is none.
  const workday = Boolean(plan.schedule && plan.schedule.workdays[day.dayKey]);
  const placed = day.sessions.every(s => s.when !== 'anytime');

  const body = [el('h2', {}, ['Tonight', el('span', { class: 'prescribed' }, `for ${name}`)])];
  if (am && am.status === 'work') body.push(...morningLines(am, 'tonight'));
  else if (am && am.status === 'off') body.push(el('p', { class: 'effort' }, `${name} is a day off work (${am.offLabel}). No alarm.`));
  else if (!workday) body.push(el('p', { class: 'effort' }, 'No work tomorrow. No alarm.'));
  else if (placed) body.push(el('p', { class: 'effort' }, 'Nothing before work tomorrow.'));

  body.push(day.sessions.length
    ? el('ul', { class: 'tsessions' }, day.sessions.map(s => el('li', {}, [
        el('span', { class: `dot ${s.discipline}` }),
        `${s.title} · ${prescribedText(s.prescribed, s.discipline)}`,
        whenText(s.when) ? ` · ${whenText(s.when)}` : '',
        s.optional ? ' (optional)' : ''
      ])))
    : el('p', { class: 'effort' }, 'Nothing prescribed tomorrow.'));
  body.push(fuelLine(fuel));
  body.push(kitBlock(kit));
  body.push(el('a', { class: 'more', href: `#/day/${day.date}` }, `${name} in full ›`));
  return el('section', { class: 'card tonight' }, body);
}

function sessionCard(session, entry) {
  const status = entry ? entry.status : null;

  const head = el('h2', {}, [
    session.title,
    whenText(session.when) ? el('span', { class: 'tag when' }, whenText(session.when)) : null,
    session.optional ? el('span', { class: 'tag optional' }, 'optional') : null,
    status ? el('span', { class: `tag ${status}` }, status) : null,
    el('span', { class: 'prescribed' }, prescribedText(session.prescribed, session.discipline))
  ]);

  const body = [head, el('p', { class: 'effort' }, session.effort)];

  if (session.setLines.length) {
    body.push(el('ol', { class: 'setlines' }, session.setLines.map(l => el('li', {}, l))));
  }
  if (session.detail.length) {
    body.push(el('ul', { class: 'detail' }, session.detail.map(d => el('li', {}, d))));
  }
  if (entry && entry.strava) {
    body.push(el('div', { class: 'actual' }, [
      'Recorded: ',
      actualText(entry.strava, session),
      ' — ',
      el('a', { href: entry.strava.url, target: '_blank', rel: 'noopener' }, 'Strava')
    ]));
  }

  return el('section', { class: `card ${session.discipline}` }, body);
}

// Back and the path down to this page. They live in the sticky header, so
// the way out never scrolls away on a long page. Back is a real link to the
// level above, so it works on a page opened cold; app.js turns it into a step
// back through the app's own history when there is one. Rendered even for a
// date outside the plan, so a wrong turn is always one tap from being undone.
export function renderCrumbs(nav) {
  return [
    el('a', { class: 'back', href: nav.up || '#/today', 'data-back': '' }, '‹ Back'),
    el('ol', { class: 'crumbs' }, nav.crumbs.map(c => el('li', {},
      c.href ? el('a', { href: c.href }, c.label) : el('span', { 'aria-current': 'page' }, c.label))))
  ];
}

// Every page opens with its neighbours at the same level.

function pagerBar({ prev, home, next }) {
  return el('nav', { class: 'pager' }, [
    prev ? el('a', { href: prev.href }, `‹ ${prev.label}`) : null,
    home ? el('a', { class: 'home', href: home.href }, home.label) : null,
    next ? el('a', { href: next.href }, `${next.label} ›`) : null
  ]);
}

function pageNav(nav) {
  return [pagerBar(nav.pager)];
}

// After midday the page is being read for tomorrow, so tonight's card comes
// first; in the morning it waits at the bottom, below the work of the day.
export function tonightFirst(hour) {
  return hour >= 12;
}

export function renderDay(ctx) {
  const { plan, date, today, nav, hour = 0 } = ctx;
  const out = el('div', { class: 'dayview' });

  out.append(...pageNav(nav));

  const tonightEl = date === today ? tonightCard(plan, today) : null;
  const first = Boolean(tonightEl) && tonightFirst(hour);
  dayBody(ctx, out, first ? tonightEl : null);
  if (tonightEl && !first) out.append(tonightEl);
  return out;
}

// The day itself. `lead` goes straight under the heading, ahead of the day's
// own sessions.
function dayBody(ctx, out, lead) {
  const { plan, day, week, entriesByKey, extras, date, today } = ctx;

  if (!day.inPlan) {
    const msg = day.reason === 'before-start'
      ? `The plan starts ${dayLabel(planStart(plan))}.`
      : 'Past the end of the plan.';
    out.append(el('h1', {}, 'Not in the plan'),
               el('p', { class: 'placeholder' }, `${date} — ${msg}`));
    // The night before the plan starts is exactly when tonight's card matters.
    if (lead) out.append(lead);
    return out;
  }

  const label = [
    `${day.blockLabel} W${day.week}`,
    day.phaseLabel,
    day.weekType === 'recovery' ? 'recovery week' : null,
    day.date
  ].filter(Boolean).join(' · ');

  out.append(el('p', { class: 'daymeta' }, label));
  out.append(el('h1', {}, [
    DOW[day.dayKey],
    date === today ? el('span', { class: 'tag today' }, 'today') : null
  ]));

  if (!day.authored) {
    out.append(el('p', { class: 'placeholder' }, day.history
      ? 'Before the plan: no sessions were set. This is what Strava recorded.'
      : 'This block has not been written yet. Nothing prescribed for today.'));
    if (lead) out.append(lead);
    const extrasEl = extrasSection(extras, day.history ? 'Recorded' : 'Not on the plan');
    if (extrasEl) out.append(extrasEl);
    return out;
  }

  if (lead) out.append(lead);

  const resolved = week.days.find(d => d.dayKey === day.dayKey);

  const clock = dayClockCard(plan, resolved);
  if (clock) out.append(clock);

  for (const session of resolved.sessions) {
    out.append(sessionCard(session, entriesByKey.get(session.key)));
  }

  // The weight target belongs on the days that do the work of reaching it.
  const types = plan.nutrition.types;
  const deficitDay = resolved.nutrition === types.low || resolved.nutrition === types.moderate;

  out.append(el('section', { class: 'card' }, [
    el('h2', {}, ['Nutrition', el('span', { class: 'prescribed' }, resolved.nutrition.label)]),
    el('p', { class: 'effort' }, resolved.nutrition.approach),
    deficitDay && plan.nutrition.weight ? el('p', { class: 'effort' }, plan.nutrition.weight) : null,
    el('p', { class: 'daymeta' }, 'Fuelling'),
    el('ul', { class: 'detail' }, fuelLines(plan, resolved).map(l => el('li', {}, l))),
    el('ul', { class: 'detail' }, plan.nutrition.nonNegotiables.map(n => el('li', {}, n)))
  ]));

  const extrasEl = extrasSection(extras);
  if (extrasEl) out.append(extrasEl);

  return out;
}

const DOW_SHORT = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu',
                    fri: 'Fri', sat: 'Sat', sun: 'Sun' };

// A week with no plan, day by day: what Strava recorded each day.
function historyDays(week, entries, today) {
  const list = el('div', { class: 'weeklist' });
  const DOW_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  DOW_KEYS.forEach((dayKey, i) => {
    const date = addDays(week.startDate, i);
    const done = entries.filter(e => e.date === date && e.strava && isTraining(e.strava.type));
    list.append(el('a', { class: `dayrow${date === today ? ' today' : ''}`, href: `#/day/${date}` }, [
      el('span', { class: 'dow' }, `${DOW_SHORT[dayKey]} ${date.slice(8)}`),
      done.length
        ? el('ul', { class: 'activities' }, done.map(activityItem))
        : el('div', { class: 'wrest' }, date > today ? '' : 'Nothing recorded')
    ]));
  });
  return list;
}

export function renderWeek(ctx) {
  const { plan, week, entriesByKey, entries = [], today, nav } = ctx;
  const out = el('div');

  const title = [
    `${week.blockLabel} W${week.week}`,
    week.type === 'recovery' ? 'recovery week' : null
  ].filter(Boolean).join(' · ');

  out.append(...pageNav(nav));
  out.append(el('h1', {}, title));

  const weekEnd = addDays(week.startDate, 7);

  if (week.history) {
    out.append(el('p', { class: 'daymeta weekhead' }, 'Before the plan: what Strava recorded.'));
    out.append(barsCard('Done this week', periodBars(plan, entries, week.startDate, weekEnd, 'week', today)));
    out.append(historyDays(week, entries, today));
    return out;
  }

  if (!week.authored) {
    out.append(el('p', { class: 'placeholder' },
      `Week of ${week.startDate}. Not written yet — ${week.note || ''}`));
    return out;
  }

  // The week's cost, read on a Sunday night: hours, and the earliest alarm.
  const clock = plan && plan.schedule ? weekSummary(plan, week) : null;
  const headline = clock ? weekHeadline(clock) : '';
  if (headline) out.append(el('p', { class: 'daymeta weekhead' }, headline));
  // Every plan week shows its bars, filling toward the week's planned totals:
  // empty before it starts, and filling as the nightly sync records workouts.
  if (plan && plan.schedule) {
    out.append(barsCard('Done this week', periodBars(plan, entries, week.startDate, weekEnd, 'week', today)));
  }
  const daysOff = (plan && plan.schedule && plan.schedule.daysOff) || {};

  const list = el('div', { class: 'weeklist' });

  for (const day of week.days) {
    // The whole row is the link, not just the date - a card-shaped target that
    // does nothing when you click the middle of it reads as broken.
    const sessions = el('div', { class: 'daysessions' });

    for (const s of day.sessions) {
      const entry = entriesByKey.get(s.key);
      const summary = summaryLine(s);
      // Dot, name and amount are siblings in one grid rather than a nested
      // row, so the summary beneath them shares the name's left edge.
      sessions.append(el('div', { class: `wsession${s.optional ? ' optional' : ''}` }, [
        entry ? el('span', { class: `dot ${entry.status}` }) : el('span', { class: 'dot' }),
        el('span', { class: 'wname' }, s.title),
        el('span', { class: 'wamount' }, prescribedText(s.prescribed, s.discipline)),
        summary ? el('span', { class: 'wsummary' }, summary) : null
      ]));
    }

    if (!day.sessions.length) sessions.append(el('div', { class: 'wrest' }, 'Rest'));

    list.append(el('a', {
      class: `dayrow${day.date === today ? ' today' : ''}`,
      href: `#/day/${day.date}`
    }, [
      el('span', { class: 'dow' }, [
        `${DOW_SHORT[day.dayKey]} ${day.date.slice(8)}`,
        clock && clock.alarms.has(day.date)
          ? el('span', { class: 'alarm' }, `up ${shortClock(clock.alarms.get(day.date))}`)
          : (daysOff[day.date] ? el('span', { class: 'alarm off' }, 'off work') : null)
      ]),
      sessions
    ]));
  }

  out.append(list);
  return out;
}

// "4.9/5.9 h" once anything is recorded for the week: done, then planned.
function seasonHours(plan, week, entries) {
  if (week.history) {
    const done = weekActuals(week, entries);
    return done.recorded ? hoursText(Math.round(done.total.minutes / 6) / 10) : '';
  }
  if (!week.authored || !plan.schedule) return '';
  const planned = weekHours(week, plan.schedule);
  const done = weekActuals(week, entries);
  if (!done.recorded) return hoursText(planned);
  return `${(Math.round(done.total.minutes / 6) / 10).toFixed(1)}/${hoursText(planned)}`;
}

export function renderSeason(ctx) {
  const { plan, entries, today, resolveWeek, weekCompletion, nav, focusWeek } = ctx;
  const out = el('div');
  out.append(...pageNav(nav));
  out.append(el('h1', {}, 'Season'));

  const todayWeekStart = w => w.startDate <= today && today < addDays(w.startDate, 7);

  for (const block of blocksInOrder(plan)) {
    out.append(el('div', { class: 'blockhead' },
      `${block.label} — ${block.weeks} weeks from ${block.start}`));

    const list = el('div', { class: 'season' });

    for (let n = 1; n <= block.weeks; n++) {
      const week = resolveWeek(plan, block.id, n);
      const c = weekCompletion(week, entries);
      const phase = block.phases
        ? (block.phases.find(p => n >= p.from && n <= p.to) || {}).label
        : null;

      const classes = ['seasonrow'];
      if (week.type === 'recovery') classes.push('recovery');
      if (todayWeekStart(week)) classes.push('current');
      // The week the season was opened from, so zooming out keeps your place.
      if (focusWeek && focusWeek.blockId === block.id && focusWeek.week === n) classes.push('focus');

      // The phase cell is always emitted, empty when the block has no phases:
      // omitting it shifted every following column out of line with the rows
      // above, which is what made this list look ragged.
      list.append(el('a', { class: classes.join(' '), href: `#/week/${block.id}/${n}` }, [
        el('span', { class: 'label' },
          `${block.label} W${n}${week.type === 'recovery' ? ' ↓' : ''}`),
        el('span', { class: 'daymeta date' }, week.startDate),
        el('span', { class: 'daymeta phase' }, phase || ''),
        el('span', { class: 'daymeta hrs' }, seasonHours(plan, week, entries)),
        el('span', { class: 'bar' }, el('span', { style: `width:${c.pct ?? 0}%` })),
        el('span', { class: 'pct' }, c.pct === null ? '—' : `${c.pct}%`)
      ]));
    }

    out.append(list);
  }

  return out;
}

const DOW_HEAD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DISCIPLINES = ['swim', 'bike', 'run', 'strength'];

// One dot per prescribed session, coloured by discipline and filled in by what
// the log says happened. A hollow dot is "prescribed, nothing recorded" — which
// is not the same claim as "missed", and must not look like one.
function monthDot(session, entry) {
  const classes = ['mdot', session.discipline];
  if (entry) classes.push(entry.status);
  if (session.optional) classes.push('optional');
  const title = `${session.discipline}${entry ? ` — ${entry.status}` : ''}`;
  return el('span', { class: classes.join(' '), title });
}

function monthCell(cell, entriesByKey, today, recordedOn) {
  if (!cell) return el('div', { class: 'mcell blank' });

  const classes = ['mcell'];
  if (!cell.inPlan) classes.push('out');
  else if (cell.history) classes.push('history');
  else if (!cell.authored) classes.push('unauthored');
  const recorded = cell.history ? (recordedOn.get(cell.date) || []) : [];
  if (cell.date === today) classes.push('today');
  if (cell.weekType === 'recovery') classes.push('recovery');

  // The visible cell is a number and some dots; the label is what a screen
  // reader gets instead, since neither conveys a date or a discipline aloud.
  const label = [
    cell.date,
    cell.inPlan ? `${cell.blockLabel} W${cell.week}` : 'not in the plan',
    cell.history
      ? (recorded.length ? `recorded: ${recorded.join(', ')}` : 'nothing recorded')
      : cell.sessions.length
        ? cell.sessions.map(s => s.discipline).join(', ')
        : (cell.inPlan && !cell.authored ? 'not written yet' : 'nothing prescribed'),
    cell.date === today ? 'today' : null
  ].filter(Boolean).join(' — ');

  return el('a', { class: classes.join(' '), href: `#/day/${cell.date}`, 'aria-label': label }, [
    el('span', { class: 'dnum' }, String(Number(cell.date.slice(8)))),
    el('span', { class: 'mdots', 'aria-hidden': 'true' }, cell.history
      ? recorded.map(d => el('span', { class: `mdot ${d} done`, title: d }))
      : cell.sessions.map(s => monthDot(s, entriesByKey.get(s.key))))
  ]);
}

// The gutter cell that opens each calendar row. It is the handle for zooming
// out one level: click the week, get the week.
function weekGutter(week) {
  if (!week) return el('div', { class: 'wk empty' });
  return el('a', { class: `wk${week.type === 'recovery' ? ' recovery' : ''}`,
                   href: `#/week/${week.blockId}/${week.week}` }, [
    el('span', { class: 'wkblock' }, week.blockLabel),
    el('span', { class: 'wknum' }, `W${week.week}${week.type === 'recovery' ? ' ↓' : ''}`)
  ]);
}

export function renderMonth(ctx) {
  const { plan, rows, ym, entriesByKey, entries = [], today, nav } = ctx;
  const out = el('div');

  out.append(...pageNav(nav));
  out.append(el('h1', {}, monthLabel(ym)));

  // The month's totals, every week of it combined: shown once the month has
  // begun, or ahead of time when it holds plan days to fill toward.
  const from = `${ym}-01`;
  const to = `${addMonths(ym, 1)}-01`;
  if (plan) {
    const bars = periodBars(plan, entries, from, to, 'month', today);
    if (from <= today || (bars.planned && bars.planned.days)) out.append(barsCard('This month', bars));
  }

  // Days before the plan carry a dot per recorded training activity.
  const recordedOn = new Map();
  for (const e of entries) {
    if (!e.strava || !isTraining(e.strava.type)) continue;
    if (!recordedOn.has(e.date)) recordedOn.set(e.date, []);
    recordedOn.get(e.date).push(DISCIPLINE_BY_STRAVA_TYPE[e.strava.type]);
  }

  const grid = el('div', { class: 'monthgrid' });
  grid.append(el('div', { class: 'mhead' }));
  for (const d of DOW_HEAD) grid.append(el('div', { class: 'mhead' }, d));

  for (const row of rows) {
    grid.append(weekGutter(row.week));
    for (const cell of row.cells) grid.append(monthCell(cell, entriesByKey, today, recordedOn));
  }

  out.append(grid);
  out.append(el('div', { class: 'legend' }, DISCIPLINES.map(d =>
    el('span', { class: 'legenditem' }, [el('span', { class: `mdot ${d}` }), DISCIPLINE_LABEL[d]]))));

  return out;
}
