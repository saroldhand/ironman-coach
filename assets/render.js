import { planStart, blocksInOrder } from './plan-model.js';
import { addDays, addMonths, monthLabel, weekdayKey, dayLabel } from './date-utils.js';
import { clockText, morning, kitFor, fuelBefore, tonight, weekSummary, weekHours, hoursText,
         plannedBetween } from './schedule-model.js';
import { weekActuals, actualsBetween, typicalPeriod, usualSpeed, isTraining,
         DISCIPLINE_BY_STRAVA_TYPE, TRAINING_DISCIPLINES } from './log-model.js';
import { icon } from './icons.js';

// The page is built from plain DOM nodes. Everything a node shows is worked
// out in the model modules; this file only lays it out and words it.

const DOW = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
              fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const DOW_SHORT = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu',
                    fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const DOW_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of [children].flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  for (const c of children) node.append(c);
  return node;
}

// ---- words and numbers ----

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

// Durations as h:mm, so a 45-minute run and a 3-hour ride line up.
export function durationText(minutes) {
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

// "Nov 9 – 15", or "Nov 30 – Dec 6" when the week crosses a month.
export function weekRangeText(startDate) {
  const end = addDays(startDate, 6);
  const [, m1, d1] = startDate.split('-').map(Number);
  const [, m2, d2] = end.split('-').map(Number);
  return m1 === m2
    ? `${MONTHS_SHORT[m1 - 1]} ${d1} – ${d2}`
    : `${MONTHS_SHORT[m1 - 1]} ${d1} – ${MONTHS_SHORT[m2 - 1]} ${d2}`;
}

// "6:11", and its "am" apart, so the numeral can be set large.
function shortClock(min) {
  return clockText(min).replace(/ (am|pm)$/, '');
}
function meridiem(min) {
  return clockText(min).slice(-2);
}

const SUMMARY_MAX = 38;
const MAIN_SET = 'MAIN SET: ';

// The one line a week row shows under a session's title. A lift is named by
// its main set - always the first line. A swim's first line is the warmup,
// which says nothing about the session, so a swim is named by its MAIN SET
// line when it has one. Everything else is named by its effort.
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
  // A lift has no distance, and "0.0 mi" under one reads as a fault.
  const distance = strava.distance ? distanceText(strava.distance, session.discipline) : null;
  const parts = (session.prescribed.metric === 'distance'
    ? [distance, `${mins} min`]
    : [`${mins} min`, distance]).filter(Boolean);
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

const WHEN = { 'before-work': 'before work', lunch: 'lunch' };

export function whenText(when) {
  return WHEN[when] || null;
}

// "5.7 h planned · earliest start 6:15 am Monday": the week's cost, read on a
// Sunday night. The start leads, as the practice time; each day still shows
// its alarm.
export function weekHeadline(summary) {
  const parts = [];
  if (summary.hours !== null && summary.hours !== undefined) parts.push(`${hoursText(summary.hours)} planned`);
  if (summary.earliestStart) {
    parts.push(`earliest start ${clockText(summary.earliestStart.start)} ${DOW[weekdayKey(summary.earliestStart.date)]}`);
  }
  return parts.join(' · ');
}

// After midday the page is being read for tomorrow, so tonight's card comes
// first; in the morning it waits at the bottom, below the work of the day.
export function tonightFirst(hour) {
  return hour >= 12;
}

// ---- small pieces ----

const DISCIPLINE_LABEL = { swim: 'Swim', bike: 'Bike', run: 'Run', strength: 'Lift' };

// A discipline's icon on a tinted tile.
function chip(discipline, size = 'md') {
  return el('span', { class: `chip ${discipline} ${size}` },
    icon(discipline, { size: size === 'sm' ? 16 : 18 }));
}

// What the log says about one session, as a mark. A hollow ring is
// "prescribed, nothing recorded" — not the same claim as missed.
const STATUS = {
  done: { icon: 'check', label: 'done' },
  partial: { icon: 'half', label: 'partly done' },
  missed: { icon: 'cross', label: 'missed' }
};
function statusMark(entry) {
  const s = entry && STATUS[entry.status];
  if (!s) return el('span', { class: 'mark open', 'aria-label': 'not recorded yet', role: 'img' });
  return el('span', { class: `mark ${entry.status}`, role: 'img', 'aria-label': s.label },
    icon(s.icon, { size: 13, stroke: 3 }));
}

function tag(text, kind) {
  return el('span', { class: `tag ${kind}` }, text);
}

// One recorded activity: a dot, the name (to Strava), time and distance.
function activityItem(e) {
  const d = DISCIPLINE_BY_STRAVA_TYPE[e.strava.type];
  const parts = [durationText(e.strava.movingTime / 60)];
  if (d !== 'strength' && e.strava.distance) parts.push(distanceText(e.strava.distance, d));
  return el('li', {}, [
    chip(d, 'sm'),
    el('a', { href: e.strava.url, target: '_blank', rel: 'noopener' }, e.strava.name),
    el('span', { class: 'amount' }, parts.join(' · '))
  ]);
}

// Activities Strava recorded with no matching planned slot. Walks and hikes
// stay in the log but are not training: they are not listed.
function extrasSection(extras, title = 'Not on the plan') {
  const training = extras.filter(e => isTraining(e.strava.type));
  if (!training.length) return null;
  return el('section', { class: 'card' }, [
    el('h2', { class: 'cardtitle' }, title),
    el('ul', { class: 'activities' }, training.map(activityItem))
  ]);
}

// ---- page head and pager ----

// Every page opens the same way: a scarlet eyebrow, a large title, a muted
// line, and the neighbours at the same level as round buttons, with the way
// home (today, this week, this month) as a pill between them.
function pageHead({ eyebrow, title, badge, sub, pager }) {
  return el('div', { class: 'pagehead' }, [
    eyebrow ? el('p', { class: 'eyebrow' }, eyebrow) : null,
    el('div', { class: 'titlerow' }, [
      el('h1', {}, [title, badge ? el('span', { class: 'badge' }, badge) : null]),
      pagerNav(pager)
    ]),
    sub ? el('p', { class: 'sub' }, sub) : null
  ]);
}

function pagerNav(pager) {
  if (!pager) return null;
  const { prev, home, next } = pager;
  if (!prev && !home && !next) return null;
  return el('nav', { class: 'pager', 'aria-label': 'Neighbours' }, [
    prev ? el('a', { class: 'round', href: prev.href, 'aria-label': prev.label, title: prev.label },
      icon('left', { size: 18 })) : null,
    home ? el('a', { class: 'home', href: home.href }, home.label) : null,
    next ? el('a', { class: 'round', href: next.href, 'aria-label': next.label, title: next.label },
      icon('right', { size: 18 })) : null
  ]);
}

// Back and the path down to this page. They live in the sticky header, so
// the way out never scrolls away on a long page. Back is a real link to the
// level above, so it works on a page opened cold; app.js turns it into a step
// back through the app's own history when there is one. Rendered even for a
// date outside the plan, so a wrong turn is always one tap from being undone.
export function renderCrumbs(nav) {
  return [
    el('a', { class: 'back', href: nav.up || '#/today', 'data-back': '' },
      [icon('left', { size: 16, stroke: 2.5 }), 'Back']),
    el('ol', { class: 'crumbs' }, nav.crumbs.map(c => el('li', {},
      c.href ? el('a', { href: c.href }, c.label) : el('span', { 'aria-current': 'page' }, c.label))))
  ];
}

// ---- what was actually done: rings and bars ----

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
      bars.push(bar('distance', a.metres, distTarget, actuals.recorded, m => distanceText(m, d), period));
    }
    return { discipline: d, label: DISCIPLINE_LABEL[d], bars };
  });
}

function bar(kind, value, target, recorded, format, period) {
  const pct = !recorded || !value ? 0
    : target ? Math.min(100, Math.round((value / target.value) * 100)) : 100;
  let targetText = null;
  let shortTarget = null;
  if (target) {
    const amount = format(target.value);
    targetText = target.kind === 'plan' ? `${amount} planned`
      : target.kind === 'estimate' ? `≈${amount} planned`
      : `typical ${period} ${amount}`;
    // The same target, short enough to sit after a slash on a phone.
    shortTarget = target.kind === 'plan' ? amount
      : target.kind === 'estimate' ? `≈${amount}`
      : `typ. ${amount}`;
  }
  return {
    kind, pct,
    over: Boolean(recorded && target && value > target.value),
    text: recorded ? format(value) : '—',
    targetText,
    shortTarget
  };
}

// A ring's stroke-dasharray: the filled length, then the whole circumference.
export function ringDash(pct, r) {
  const c = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, pct)) / 100) * c;
  return `${filled.toFixed(1)} ${c.toFixed(1)}`;
}

const RING_RADII = { swim: 60, bike: 47, run: 34, strength: 21 };

// Four rings, one per discipline, outside in: time against its target.
function rings(rows) {
  const label = rows.map(r => {
    const t = r.bars[0];
    return `${r.label} ${t.text}${t.targetText ? ` of ${t.targetText}` : ''}`;
  }).join(', ');
  const g = svgEl('g', { transform: 'rotate(-90 70 70)' }, rows.flatMap(r => {
    const t = r.bars[0];
    const radius = RING_RADII[r.discipline];
    return [
      svgEl('circle', { class: 'track', cx: 70, cy: 70, r: radius }),
      svgEl('circle', { class: 'prog', cx: 70, cy: 70, r: radius,
                        'stroke-dasharray': ringDash(t.pct, radius),
                        // A ring at zero would still draw a dot from its round cap.
                        'stroke-opacity': t.pct ? 1 : 0 })
    ];
  }));
  const svg = svgEl('svg', { class: 'rings', viewBox: '0 0 140 140', role: 'img', 'aria-label': `Time: ${label}` }, [g]);
  // The ring colours come from each circle's discipline.
  [...g.children].forEach((c, i) => {
    const r = rows[Math.floor(i / 2)];
    c.classList.add(r.discipline);
    if (r.bars[0].over) c.classList.add('over');
  });
  return svg;
}

// The progress card for a week or a month: rings for time, bars for distance.
function progressCard(title, data) {
  const { actuals, planned, period } = data;
  const rows = disciplineBars(data);
  const hasPlan = Boolean(planned && planned.days);
  const plannedMin = hasPlan
    ? TRAINING_DISCIPLINES.reduce((t, d) => t + ((planned.byDiscipline[d] || {}).minutes || 0), 0)
    : 0;
  const doneH = (Math.round(actuals.total.minutes / 6) / 10).toFixed(1);

  const total = !actuals.recorded
    ? el('p', { class: 'total' }, [el('strong', {}, '—'), el('span', {}, ' nothing from Strava')])
    : el('p', { class: 'total' }, [el('strong', {}, doneH),
        el('span', {}, plannedMin ? ` / ${hoursText(Math.round(plannedMin / 6) / 10)}` : ' h')]);

  const legend = el('div', { class: 'legendgrid' }, rows.flatMap(r => {
    const t = r.bars[0];
    return [
      el('span', { class: `ldot ${r.discipline}` }),
      el('span', {}, r.label),
      el('span', { class: `lval${t.over ? ' over' : ''}` },
        [el('strong', {}, t.text), t.shortTarget ? el('span', { class: 'of' }, ` / ${t.shortTarget}`) : null])
    ];
  }));

  const distance = el('div', { class: 'distance' }, [
    el('p', { class: 'overline' }, 'Distance'),
    ...rows.filter(r => r.bars[1]).map(r => {
      const b = r.bars[1];
      return el('div', { class: `drow ${r.discipline}${b.over ? ' over' : ''}` }, [
        chip(r.discipline, 'sm'),
        el('span', { class: 'dlabel' }, [
          el('strong', {}, r.label),
          el('span', { class: 'dval' }, [el('strong', {}, b.text), b.shortTarget ? el('span', { class: 'of' }, ` / ${b.shortTarget}`) : null])
        ]),
        el('span', { class: 'track', role: 'img',
                     'aria-label': `${r.label} distance: ${b.text}${b.targetText ? ` of ${b.targetText}` : ''}` },
          el('span', { class: 'fill', style: `width:${b.pct}%` }))
      ]);
    })
  ]);

  const note = hasPlan
    ? 'Rings are time against the plan · ≈ is planned time at your usual speed'
    : `Rings are time against your typical ${period}`;

  return el('section', { class: 'card progress' }, [
    el('div', { class: 'ringrow' }, [
      rings(rows),
      el('div', { class: 'ringside' }, [el('p', { class: 'overline' }, title), total, legend])
    ]),
    distance,
    el('p', { class: 'footnote' }, note)
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

// ---- the clock: the practice start, and everything around it ----

const VENUE = venue => (venue.key === 'home' ? 'at home' : venue.label.toLowerCase());

function tileLabel(label) {
  if (label.startsWith('Home')) return 'Home';
  if (label === 'Leave for work') return 'To work';
  if (label === 'At your desk') return 'At desk';
  return label;
}

// The practice: when it starts, what it is, and the morning around it as
// tiles - lights out, the alarm, and every step from leaving to ready.
function practiceBlock(am, sessions, { bedLabel }) {
  const amSessions = sessions.filter(s => s.when === 'before-work');
  const lead = amSessions[0];
  const names = amSessions.map(s => s.title).join(' → ');
  const amounts = amSessions.map(s => prescribedText(s.prescribed, s.discipline)).join(' · ');

  const tiles = [
    { at: am.lightsOut, label: bedLabel },
    { at: am.alarm, label: 'Alarm', key: true },
    ...am.timeline.filter(t => !t.label.startsWith('Start')).map(t => ({ at: t.at, label: tileLabel(t.label) }))
  ];

  return [
    el('p', { class: 'practice-label' }, [el('span', { class: 'pulse' }), 'Practice starts']),
    el('p', { class: 'practice-time' }, [shortClock(am.start), el('span', { class: 'ampm' }, meridiem(am.start))]),
    lead ? el('p', { class: 'practice-what' }, [chip(lead.discipline, 'sm'),
      el('span', {}, [el('strong', {}, names), ` · ${amounts} · ${VENUE(am.venue)}`])]) : null,
    am.earlyBy ? el('p', { class: 'warnline' }, [icon('warn', { size: 16 }),
      `This doesn't fit: it needs you at the ${am.venue.label.toLowerCase()} ${am.earlyBy} min before it opens.`]) : null,
    // Four tiles in a row, or six as two rows of three, never four and two.
    el('div', { class: 'tiles', style: `grid-template-columns: repeat(${tiles.length <= 4 ? tiles.length : 3}, minmax(0, 1fr))` },
      tiles.map(t => el('span', { class: `tile${t.key ? ' key' : ''}` },
      [el('strong', {}, shortClock(t.at)), el('span', {}, t.label)])))
  ];
}

// The footer of a practice card: what to eat, and what to lay out.
function prepLines(fuel, kit) {
  const lines = [];
  if (fuel) lines.push(el('p', { class: 'prep' }, [icon('food', { size: 16 }), el('span', {}, [el('strong', {}, 'Eat first: '), fuel])]));
  for (const k of kit) {
    lines.push(el('p', { class: 'prep' }, [icon('bag', { size: 16 }),
      el('span', {}, [el('strong', {}, `${k.label}: `), k.items.join(' · ')])]));
  }
  return lines.length ? el('div', { class: 'preps' }, lines) : null;
}

function sessionLine(s) {
  return el('li', {}, [chip(s.discipline, 'sm'), el('span', {}, [
    el('strong', {}, s.title), ` · ${prescribedText(s.prescribed, s.discipline)}`,
    whenText(s.when) ? ` · ${whenText(s.when)}` : '',
    s.optional ? ' (optional)' : ''
  ])]);
}

// Tonight, for tomorrow: the dark card to read before bed.
function tonightCard(plan, today) {
  const t = tonight(plan, today);
  if (!t) return null;
  const { day, morning: am, kit, fuel } = t;
  const name = DOW[day.dayKey];
  const practice = am && am.status === 'work';

  // A work day whose sessions carry no place says nothing about the alarm
  // rather than claiming there is none.
  const workday = Boolean(plan.schedule && plan.schedule.workdays[day.dayKey]);
  const placed = day.sessions.every(s => s.when !== 'anytime');

  const body = [el('p', { class: 'eyebrow' }, [icon('moon', { size: 16 }),
    practice ? `Tonight · ${name}'s practice` : `Tonight · for ${name}`])];

  if (practice) body.push(...practiceBlock(am, day.sessions, { bedLabel: 'Lights out' }));
  else if (am && am.status === 'off') body.push(el('p', { class: 'note' }, `${name} is a day off work (${am.offLabel}). No alarm.`));
  else if (!workday) body.push(el('p', { class: 'note' }, 'No work tomorrow. No alarm.'));
  else if (placed) body.push(el('p', { class: 'note' }, 'Nothing before work tomorrow.'));

  const others = practice ? day.sessions.filter(s => s.when !== 'before-work') : day.sessions;
  if (others.length) body.push(el('ul', { class: 'sessionlist' }, others.map(sessionLine)));
  else if (!day.sessions.length) body.push(el('p', { class: 'note' }, 'Nothing prescribed tomorrow.'));

  body.push(prepLines(fuel, kit));
  body.push(el('a', { class: 'more', href: `#/day/${day.date}` }, [`${name} in full`, icon('right', { size: 16 })]));
  return el('section', { class: 'card night' }, body);
}

// The day's own morning, at the top of its page: the same practice, light.
function dayClockCard(plan, resolved) {
  const am = morning(plan, resolved);
  const kit = kitFor(plan, resolved);
  if (!am && !kit.length) return null;

  if (am && am.status === 'work') {
    return el('section', { class: 'card practice' }, [
      el('p', { class: 'eyebrow' }, [icon('alarm', { size: 16 }), `Before work · ${am.venue.label} · ${am.trainMin} min`]),
      ...practiceBlock(am, resolved.sessions, { bedLabel: 'Bed, night before' }),
      prepLines(fuelBefore(plan, resolved, am), kit)
    ]);
  }
  if (am && am.status === 'off') {
    return el('section', { class: 'card practice' }, [
      el('div', { class: 'cardhead' }, [el('h2', { class: 'cardtitle' }, 'Day off work'), tag(am.offLabel, 'soft')]),
      el('p', { class: 'note' }, 'No alarm. Train when it suits.'),
      prepLines(null, kit)
    ]);
  }
  return el('section', { class: 'card practice' }, [
    el('h2', { class: 'cardtitle' }, 'Kit'),
    prepLines(null, kit)
  ]);
}

// ---- the day page ----

function sessionCard(session, entry) {
  const status = entry ? entry.status : null;
  const tags = [
    whenText(session.when) ? tag(whenText(session.when), 'when') : null,
    session.optional ? tag('optional', 'optional') : null,
    status ? tag(status, status) : null
  ].filter(Boolean);

  const body = [
    el('div', { class: 'shead' }, [
      chip(session.discipline),
      el('div', { class: 'stitle' }, [
        el('h2', {}, session.title),
        tags.length ? el('div', { class: 'tags' }, tags) : null
      ]),
      el('span', { class: 'amount' }, prescribedText(session.prescribed, session.discipline))
    ])
  ];
  if (session.effort) body.push(el('p', { class: 'effort' }, session.effort));
  if (session.setLines.length) {
    body.push(el('ol', { class: 'setlines' }, session.setLines.map(l => el('li', {}, l))));
  }
  if (session.detail.length) {
    body.push(el('ul', { class: 'detail' }, session.detail.map(d => el('li', {}, d))));
  }
  if (entry && entry.strava) {
    body.push(el('p', { class: 'actual' }, [
      statusMark(entry),
      el('span', {}, ['Recorded ', el('strong', {}, actualText(entry.strava, session))]),
      el('a', { href: entry.strava.url, target: '_blank', rel: 'noopener' }, 'Strava')
    ]));
  }
  return el('section', { class: `card session ${session.discipline}` }, body);
}

function nutritionCard(plan, resolved) {
  // The weight target belongs on the days that do the work of reaching it.
  const types = plan.nutrition.types;
  const deficitDay = resolved.nutrition === types.low || resolved.nutrition === types.moderate;
  return el('section', { class: 'card' }, [
    el('div', { class: 'cardhead' }, [el('h2', { class: 'cardtitle' }, 'Nutrition'), tag(resolved.nutrition.label, 'soft')]),
    el('p', { class: 'effort' }, resolved.nutrition.approach),
    deficitDay && plan.nutrition.weight ? el('p', { class: 'effort' }, plan.nutrition.weight) : null,
    el('p', { class: 'overline' }, 'Fuelling'),
    el('ul', { class: 'detail' }, fuelLines(plan, resolved).map(l => el('li', {}, l))),
    el('ul', { class: 'detail' }, plan.nutrition.nonNegotiables.map(n => el('li', {}, n)))
  ]);
}

export function renderDay(ctx) {
  const { plan, day, date, today, nav, hour = 0 } = ctx;
  const out = el('div', { class: 'page dayview' });

  const tonightEl = date === today ? tonightCard(plan, today) : null;
  const first = Boolean(tonightEl) && tonightFirst(hour);

  if (!day.inPlan) {
    const msg = day.reason === 'before-start'
      ? `The plan starts ${dayLabel(planStart(plan))}.`
      : 'Past the end of the plan.';
    out.append(pageHead({ eyebrow: dayLabel(date), title: 'Not in the plan', sub: `${date} — ${msg}`, pager: nav.pager }));
    // The night before the plan starts is exactly when tonight's card matters.
    if (tonightEl) out.append(tonightEl);
    return out;
  }

  const eyebrow = [
    `${day.blockLabel} W${day.week}`,
    day.phaseLabel,
    day.weekType === 'recovery' ? 'recovery week' : null,
    dayLabel(date)
  ].filter(Boolean).join(' · ');
  out.append(pageHead({
    eyebrow, title: DOW[day.dayKey], badge: date === today ? 'Today' : null, pager: nav.pager
  }));

  if (first) out.append(tonightEl);
  dayBody(ctx, out);
  if (tonightEl && !first) out.append(tonightEl);
  return out;
}

// The day itself, under its heading.
function dayBody(ctx, out) {
  const { plan, day, week, entriesByKey, extras } = ctx;

  if (!day.authored) {
    out.append(el('p', { class: 'placeholder' }, day.history
      ? 'Before the plan: no sessions were set. This is what Strava recorded.'
      : 'This block has not been written yet. Nothing prescribed for today.'));
    const extrasEl = extrasSection(extras, day.history ? 'Recorded' : 'Not on the plan');
    if (extrasEl) out.append(extrasEl);
    return;
  }

  const resolved = week.days.find(d => d.dayKey === day.dayKey);
  const clock = dayClockCard(plan, resolved);
  if (clock) out.append(clock);

  for (const session of resolved.sessions) {
    out.append(sessionCard(session, entriesByKey.get(session.key)));
  }
  if (!resolved.sessions.length) out.append(el('p', { class: 'placeholder' }, 'Rest day. Nothing prescribed.'));

  out.append(nutritionCard(plan, resolved));

  const extrasEl = extrasSection(extras);
  if (extrasEl) out.append(extrasEl);
}

// ---- the week page ----

// A plan day's state for the week strip: done when every session it asks for
// has an activity, missed when one was missed, open otherwise.
function planDayState(day, entriesByKey) {
  const due = day.sessions.filter(s => !s.optional);
  if (!due.length) return 'rest';
  const entries = due.map(s => entriesByKey.get(s.key));
  if (entries.some(e => e && e.status === 'missed')) return 'missed';
  if (entries.every(e => e && (e.status === 'done' || e.status === 'partial'))) return 'done';
  return 'open';
}

function dayStrip(dates, stateOf, today) {
  return el('nav', { class: 'daystrip', 'aria-label': 'Days' }, dates.map((date, i) => {
    const state = stateOf(date, i);
    return el('a', { class: `daychip${date === today ? ' today' : ''}`, href: `#/day/${date}`,
                     'aria-label': `${DOW[DOW_KEYS[i]]} ${Number(date.slice(8))}${state === 'done' ? ', done' : ''}${date === today ? ', today' : ''}` }, [
      el('span', { class: 'dk' }, DOW_SHORT[DOW_KEYS[i]].toUpperCase()),
      el('span', { class: 'dn' }, String(Number(date.slice(8)))),
      el('span', { class: `sdot ${state}` })
    ]);
  }));
}

function dayBadge(date, today) {
  if (date === today) return el('span', { class: 'badge' }, 'Today');
  if (date === addDays(today, 1)) return el('span', { class: 'badge soft' }, 'Tomorrow');
  return null;
}

// A week with no plan, day by day: what Strava recorded each day.
function historyDays(week, entries, today) {
  return el('div', { class: 'daylist' }, DOW_KEYS.map((dayKey, i) => {
    const date = addDays(week.startDate, i);
    const done = entries.filter(e => e.date === date && e.strava && isTraining(e.strava.type));
    return el('a', { class: `daycard${date === today ? ' today' : ''}`, href: `#/day/${date}` }, [
      el('div', { class: 'dayhead' }, [
        el('span', { class: 'dname' }, `${DOW_SHORT[dayKey]} ${Number(date.slice(8))}`),
        dayBadge(date, today)
      ]),
      done.length
        ? el('ul', { class: 'activities' }, done.map(activityItem))
        : el('p', { class: 'rest' }, date > today ? '' : 'Nothing recorded')
    ]);
  }));
}

function planDays(plan, week, entriesByKey, clock, today) {
  const daysOff = (plan && plan.schedule && plan.schedule.daysOff) || {};
  return el('div', { class: 'daylist' }, week.days.map(day => {
    const start = clock && clock.starts.get(day.date);
    const alarm = clock && clock.alarms.get(day.date);
    const head = el('div', { class: 'dayhead' }, [
      el('span', { class: 'dname' }, `${DOW_SHORT[day.dayKey]} ${Number(day.date.slice(8))}`),
      start !== undefined && start !== null ? el('span', { class: 'start' }, `Starts ${shortClock(start)}`) : null,
      alarm !== undefined && alarm !== null ? el('span', { class: 'alarm' }, `up ${shortClock(alarm)}`)
        : (daysOff[day.date] ? el('span', { class: 'alarm off' }, 'off work') : null),
      dayBadge(day.date, today)
    ]);

    const rows = day.sessions.map(s => {
      const summary = summaryLine(s);
      return el('div', { class: `srow${s.optional ? ' optional' : ''}` }, [
        chip(s.discipline, 'sm'),
        el('span', { class: 'sname' }, s.title),
        el('span', { class: 'samount' }, prescribedText(s.prescribed, s.discipline)),
        statusMark(entriesByKey.get(s.key)),
        summary ? el('span', { class: 'ssum' }, summary) : null
      ]);
    });

    // The whole card is the link, not just the date - a card-shaped target
    // that does nothing when you tap the middle of it reads as broken.
    return el('a', { class: `daycard${day.date === today ? ' today' : ''}`, href: `#/day/${day.date}` }, [
      head,
      rows.length ? el('div', { class: 'srows' }, rows) : el('p', { class: 'rest' }, 'Rest')
    ]);
  }));
}

export function renderWeek(ctx) {
  const { plan, week, entriesByKey, entries = [], today, nav } = ctx;
  const out = el('div', { class: 'page' });
  const weekEnd = addDays(week.startDate, 7);
  const dates = DOW_KEYS.map((_, i) => addDays(week.startDate, i));

  const eyebrow = [`${week.blockLabel} · Week ${week.week}`, week.type === 'recovery' ? 'Recovery week' : null]
    .filter(Boolean).join(' · ');

  if (week.history) {
    out.append(pageHead({ eyebrow, title: weekRangeText(week.startDate),
                          sub: 'Before the plan: what Strava recorded.', pager: nav.pager }));
    out.append(dayStrip(dates, date => (entries.some(e => e.date === date && e.strava && isTraining(e.strava.type)) ? 'done' : 'open'), today));
    out.append(progressCard('This week', periodBars(plan, entries, week.startDate, weekEnd, 'week', today)));
    out.append(historyDays(week, entries, today));
    return out;
  }

  if (!week.authored) {
    out.append(pageHead({ eyebrow, title: weekRangeText(week.startDate),
                          sub: `Not written yet — ${week.note || ''}`, pager: nav.pager }));
    return out;
  }

  const clock = plan && plan.schedule ? weekSummary(plan, week) : null;
  out.append(pageHead({ eyebrow, title: weekRangeText(week.startDate),
                        sub: clock ? weekHeadline(clock) : null, pager: nav.pager }));
  out.append(dayStrip(dates, (date, i) => planDayState(week.days[i], entriesByKey), today));

  // The night before a day of this week, tonight's card sits here too.
  const tomorrow = addDays(today, 1);
  if (plan && plan.schedule && tomorrow >= week.startDate && tomorrow < weekEnd) {
    const night = tonightCard(plan, today);
    if (night) out.append(night);
  }

  // Every plan week shows its progress, filling toward the week's planned
  // totals: empty before it starts, and filling as the nightly sync records.
  if (plan && plan.schedule) {
    out.append(progressCard('This week', periodBars(plan, entries, week.startDate, weekEnd, 'week', today)));
  }

  out.append(planDays(plan, week, entriesByKey, clock, today));
  return out;
}

// ---- the season page ----

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
  const out = el('div', { class: 'page' });
  out.append(pageHead({ eyebrow: plan.race.name, title: 'Season',
                        sub: `Race day ${dayLabel(plan.race.date)} ${plan.race.date.slice(0, 4)}`, pager: nav.pager }));

  const todayWeekStart = w => w.startDate <= today && today < addDays(w.startDate, 7);

  for (const block of blocksInOrder(plan)) {
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
      // omitting it shifted every following column out of line.
      list.append(el('a', { class: classes.join(' '), href: `#/week/${block.id}/${n}` }, [
        el('span', { class: 'label' },
          `${block.label} W${n}${week.type === 'recovery' ? ' ↓' : ''}`),
        el('span', { class: 'date' }, week.startDate),
        el('span', { class: 'phase' }, phase || ''),
        el('span', { class: 'hrs' }, seasonHours(plan, week, entries)),
        el('span', { class: 'bar' }, el('span', { style: `width:${c.pct ?? 0}%` })),
        el('span', { class: 'pct' }, c.pct === null ? '—' : `${c.pct}%`)
      ]));
    }

    out.append(el('section', { class: 'card block' }, [
      el('div', { class: 'cardhead' }, [
        el('h2', { class: 'cardtitle' }, block.label),
        el('span', { class: 'cardmeta' }, `${block.weeks} weeks from ${block.start}`)
      ]),
      list
    ]));
  }

  return out;
}

// ---- the month page ----

const DOW_HEAD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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
  const out = el('div', { class: 'page' });
  const [year] = ym.split('-');
  out.append(pageHead({ eyebrow: year, title: monthLabel(ym).replace(` ${year}`, ''), pager: nav.pager }));

  // The month's totals, every week of it combined: shown once the month has
  // begun, or ahead of time when it holds plan days to fill toward.
  const from = `${ym}-01`;
  const to = `${addMonths(ym, 1)}-01`;
  if (plan) {
    const bars = periodBars(plan, entries, from, to, 'month', today);
    if (from <= today || (bars.planned && bars.planned.days)) out.append(progressCard('This month', bars));
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

  out.append(el('section', { class: 'card calendar' }, [grid,
    el('div', { class: 'legend' }, TRAINING_DISCIPLINES.map(d =>
      el('span', { class: 'legenditem' }, [el('span', { class: `mdot ${d} done` }), DISCIPLINE_LABEL[d]])))]));

  return out;
}
