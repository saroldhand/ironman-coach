import { planStart, blocksInOrder } from './plan-model.js';
import { addDays, monthLabel, weekdayKey, dayLabel } from './date-utils.js';
import { clockText, morning, kitFor, fuelBefore, tonight, weekSummary, weekHours, hoursText } from './schedule-model.js';

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

// Race-length distances read in kilometres - "90,000 m" looks like a typo -
// while pool distances stay in metres.
function distanceText(metres) {
  return metres >= 10000
    ? `${Number((metres / 1000).toFixed(1))} km`
    : `${Math.round(metres).toLocaleString()} m`;
}

export function prescribedText(p) {
  return p.metric === 'distance' ? distanceText(p.value) : `${p.value} min`;
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

function actualText(strava, metric) {
  const mins = Math.round(strava.movingTime / 60);
  const parts = metric === 'distance'
    ? [distanceText(strava.distance), `${mins} min`]
    : [`${mins} min`, `${(strava.distance / 1000).toFixed(1)} km`];
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
function extrasSection(extras) {
  if (!extras.length) return null;
  return el('section', { class: 'card' }, [
    el('h2', {}, 'Not on the plan'),
    el('ul', { class: 'detail' }, extras.map(e =>
      el('li', {}, `${e.strava.name} — ${Math.round(e.strava.movingTime / 60)} min`)))
  ]);
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
        `${s.title} · ${prescribedText(s.prescribed)}`,
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
    el('span', { class: 'prescribed' }, prescribedText(session.prescribed))
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
      actualText(entry.strava, session.prescribed.metric),
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
    out.append(el('p', { class: 'placeholder' },
      'This block has not been written yet. Nothing prescribed for today.'));
    if (lead) out.append(lead);
    const extrasEl = extrasSection(extras);
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

export function renderWeek(ctx) {
  const { plan, week, entriesByKey, today, nav } = ctx;
  const out = el('div');

  const title = [
    `${week.blockLabel} W${week.week}`,
    week.type === 'recovery' ? 'recovery week' : null
  ].filter(Boolean).join(' · ');

  out.append(...pageNav(nav));
  out.append(el('h1', {}, title));

  if (!week.authored) {
    out.append(el('p', { class: 'placeholder' },
      `Week of ${week.startDate}. Not written yet — ${week.note || ''}`));
    return out;
  }

  // The week's cost, read on a Sunday night: hours, and the earliest alarm.
  const clock = plan && plan.schedule ? weekSummary(plan, week) : null;
  const headline = clock ? weekHeadline(clock) : '';
  if (headline) out.append(el('p', { class: 'daymeta weekhead' }, headline));
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
        el('span', { class: 'wamount' }, prescribedText(s.prescribed)),
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
        el('span', { class: 'daymeta hrs' },
          week.authored && plan.schedule ? hoursText(weekHours(week, plan.schedule)) : ''),
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

function monthCell(cell, entriesByKey, today) {
  if (!cell) return el('div', { class: 'mcell blank' });

  const classes = ['mcell'];
  if (!cell.inPlan) classes.push('out');
  else if (!cell.authored) classes.push('unauthored');
  if (cell.date === today) classes.push('today');
  if (cell.weekType === 'recovery') classes.push('recovery');

  // The visible cell is a number and some dots; the label is what a screen
  // reader gets instead, since neither conveys a date or a discipline aloud.
  const label = [
    cell.date,
    cell.inPlan ? `${cell.blockLabel} W${cell.week}` : 'not in the plan',
    cell.sessions.length
      ? cell.sessions.map(s => s.discipline).join(', ')
      : (cell.inPlan && !cell.authored ? 'not written yet' : 'nothing prescribed'),
    cell.date === today ? 'today' : null
  ].filter(Boolean).join(' — ');

  return el('a', { class: classes.join(' '), href: `#/day/${cell.date}`, 'aria-label': label }, [
    el('span', { class: 'dnum' }, String(Number(cell.date.slice(8)))),
    el('span', { class: 'mdots', 'aria-hidden': 'true' },
      cell.sessions.map(s => monthDot(s, entriesByKey.get(s.key))))
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
  const { rows, ym, entriesByKey, today, nav } = ctx;
  const out = el('div');

  out.append(...pageNav(nav));
  out.append(el('h1', {}, monthLabel(ym)));

  const grid = el('div', { class: 'monthgrid' });
  grid.append(el('div', { class: 'mhead' }));
  for (const d of DOW_HEAD) grid.append(el('div', { class: 'mhead' }, d));

  for (const row of rows) {
    grid.append(weekGutter(row.week));
    for (const cell of row.cells) grid.append(monthCell(cell, entriesByKey, today));
  }

  out.append(grid);
  out.append(el('div', { class: 'legend' }, DISCIPLINES.map(d =>
    el('span', { class: 'legenditem' }, [el('span', { class: `mdot ${d}` }), d]))));

  return out;
}
