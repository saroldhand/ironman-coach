import { planStart } from './plan-model.js';
import { addDays } from './date-utils.js';

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

export function prescribedText(p) {
  return p.metric === 'distance' ? `${p.value.toLocaleString()} m` : `${p.value} min`;
}

function actualText(strava, metric) {
  const mins = Math.round(strava.movingTime / 60);
  const parts = metric === 'distance'
    ? [`${Math.round(strava.distance).toLocaleString()} m`, `${mins} min`]
    : [`${mins} min`, `${(strava.distance / 1000).toFixed(1)} km`];
  if (strava.avgHr) parts.push(`${Math.round(strava.avgHr)} bpm avg`);
  return parts.join(' · ');
}

function sessionCard(session, entry) {
  const status = entry ? entry.status : null;

  const head = el('h2', {}, [
    session.title,
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

export function renderToday(ctx) {
  const { plan, day, week, entriesByKey, extras } = ctx;
  const out = el('div');

  if (!day.inPlan) {
    const msg = day.reason === 'before-start'
      ? `Plan starts ${planStart(plan)}.`
      : 'Past the end of the plan.';
    out.append(el('h1', {}, 'Not in the plan'), el('p', { class: 'placeholder' }, msg));
    return out;
  }

  const label = [
    `${day.blockLabel} W${day.week}`,
    day.phaseLabel,
    day.weekType === 'recovery' ? 'recovery week' : null,
    day.date
  ].filter(Boolean).join(' · ');

  out.append(el('p', { class: 'daymeta' }, label));
  out.append(el('h1', {}, DOW[day.dayKey]));

  if (!day.authored) {
    out.append(el('p', { class: 'placeholder' },
      'This block has not been written yet. Nothing prescribed for today.'));
    return out;
  }

  const resolved = week.days.find(d => d.dayKey === day.dayKey);

  for (const session of resolved.sessions) {
    out.append(sessionCard(session, entriesByKey.get(session.key)));
  }

  out.append(el('section', { class: 'card' }, [
    el('h2', {}, ['Nutrition', el('span', { class: 'prescribed' }, resolved.nutrition.label)]),
    el('p', { class: 'effort' }, resolved.nutrition.approach),
    el('ul', { class: 'detail' }, plan.nutrition.nonNegotiables.map(n => el('li', {}, n)))
  ]));

  if (extras.length) {
    out.append(el('section', { class: 'card' }, [
      el('h2', {}, 'Not on the plan'),
      el('ul', { class: 'detail' }, extras.map(e =>
        el('li', {}, `${e.strava.name} — ${Math.round(e.strava.movingTime / 60)} min`)))
    ]));
  }

  return out;
}

const DOW_SHORT = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu',
                    fri: 'Fri', sat: 'Sat', sun: 'Sun' };

export function renderWeek(ctx) {
  const { week, entriesByKey, today, nav } = ctx;
  const out = el('div');

  const title = [
    `${week.blockLabel} W${week.week}`,
    week.type === 'recovery' ? 'recovery week' : null
  ].filter(Boolean).join(' · ');

  out.append(el('div', { class: 'daymeta' }, [
    nav.prev ? el('a', { href: `#/week/${nav.prev.blockId}/${nav.prev.week}` }, '← prev') : null,
    ' ',
    nav.next ? el('a', { href: `#/week/${nav.next.blockId}/${nav.next.week}` }, 'next →') : null
  ]));
  out.append(el('h1', {}, title));

  if (!week.authored) {
    out.append(el('p', { class: 'placeholder' },
      `Week of ${week.startDate}. Not written yet — ${week.note || ''}`));
    return out;
  }

  const grid = el('div', { class: 'weekgrid' });

  for (const day of week.days) {
    const cell = el('div', { class: `cell${day.date === today ? ' today' : ''}` }, [
      el('div', { class: 'dow' }, `${DOW_SHORT[day.dayKey]} ${day.date.slice(8)}`)
    ]);

    for (const s of day.sessions) {
      const entry = entriesByKey.get(s.key);
      cell.append(el('div', {}, [
        entry ? el('span', { class: `dot ${entry.status}` }) : el('span', { class: 'dot' }),
        ` ${s.discipline} ${prescribedText(s.prescribed)}`
      ]));
    }

    grid.append(cell);
  }

  out.append(grid);
  return out;
}

export function renderSeason(ctx) {
  const { plan, entries, today, resolveWeek, weekCompletion } = ctx;
  const out = el('div');
  out.append(el('h1', {}, 'Season'));

  const todayWeekStart = w => w.startDate <= today && today < addDays(w.startDate, 7);

  for (const block of plan.blocks) {
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

      list.append(el('div', { class: classes.join(' ') }, [
        el('span', { class: 'label' },
          `${block.label} W${n}${week.type === 'recovery' ? ' ↓' : ''}`),
        el('span', { class: 'daymeta' }, week.startDate),
        phase ? el('span', { class: 'daymeta' }, phase) : null,
        el('span', { class: 'bar' }, el('span', { style: `width:${c.pct ?? 0}%` })),
        el('span', { class: 'daymeta' }, c.pct === null ? '—' : `${c.pct}%`)
      ]));
    }

    out.append(list);
  }

  return out;
}
