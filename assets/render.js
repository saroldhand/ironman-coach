const DOW = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
              fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
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
      ? `Plan starts ${plan.blocks[0].start}.`
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
