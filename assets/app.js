import { dayForDate, resolveWeek } from './plan-model.js';
import { weekCompletion } from './log-model.js';
import { renderToday, renderWeek, renderSeason } from './render.js';
import { daysBetween, todayISO, hoursSince } from './date-utils.js';

const STALE_HOURS = 36;

const main = document.getElementById('main');
const bannerEl = document.getElementById('banner');
const countdownEl = document.getElementById('countdown');

async function loadJSON(path) {
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

function banner(messages) {
  if (!messages.length) { bannerEl.hidden = true; return; }
  bannerEl.hidden = false;
  bannerEl.textContent = messages.join('  ·  ');
}

function syncMessages(status, logFailed) {
  const msgs = [];
  if (logFailed) msgs.push('Training log unavailable — showing the plan only.');
  if (!status) return msgs;

  if (status.reason === 'never-run') {
    msgs.push('Nightly Strava sync has never run. Completed sessions will stay blank.');
  } else if (!status.ok) {
    msgs.push(`Last sync failed (${status.reason}). Data may be incomplete — this is not a rest day.`);
  } else if (status.lastSuccess && hoursSince(status.lastSuccess) > STALE_HOURS) {
    msgs.push(`Last successful sync ${Math.round(hoursSince(status.lastSuccess) / 24)} days ago. Data may be stale.`);
  }
  return msgs;
}

function indexEntries(entries, date) {
  const byKey = new Map();
  const extras = [];
  for (const e of entries) {
    if (e.status === 'extra') { if (e.date === date) extras.push(e); continue; }
    byKey.set(e.planKey, e);
  }
  return { byKey, extras };
}

function weekNav(plan, blockId, week) {
  const flat = [];
  for (const b of plan.blocks) {
    for (let n = 1; n <= b.weeks; n++) flat.push({ blockId: b.id, week: n });
  }
  const i = flat.findIndex(x => x.blockId === blockId && x.week === week);
  return { prev: flat[i - 1] || null, next: flat[i + 1] || null };
}

function route() {
  const hash = location.hash || '#/today';
  const parts = hash.replace(/^#\//, '').split('/');
  return { view: parts[0] || 'today', blockId: parts[1], week: Number(parts[2]) };
}

function setActiveNav(view) {
  for (const a of document.querySelectorAll('.views a')) {
    a.classList.toggle('active', a.dataset.view === view);
  }
}

async function start() {
  let plan;
  try {
    plan = await loadJSON('data/plan.json');
  } catch (err) {
    main.textContent = `Could not load the plan: ${err.message}`;
    return;
  }

  let log = { entries: [] };
  let logFailed = false;
  try { log = await loadJSON('data/log.json'); } catch { logFailed = true; }

  let status = null;
  try { status = await loadJSON('data/sync-status.json'); } catch { /* banner covers it */ }

  banner(syncMessages(status, logFailed));

  const today = todayISO();
  const daysToRace = daysBetween(today, plan.race.date);
  countdownEl.textContent = daysToRace >= 0
    ? `${daysToRace} days to ${plan.race.date}`
    : 'race day passed';

  function draw() {
    const r = route();
    setActiveNav(r.view);
    const day = dayForDate(plan, today);
    const { byKey, extras } = indexEntries(log.entries, today);

    main.replaceChildren();

    if (r.view === 'season') {
      main.append(renderSeason({ plan, entries: log.entries, today, resolveWeek, weekCompletion }));
      return;
    }

    if (r.view === 'week') {
      const blockId = r.blockId || (day.inPlan ? day.blockId : plan.blocks[0].id);
      const week = r.week || (day.inPlan ? day.week : 1);
      main.append(renderWeek({
        plan,
        week: resolveWeek(plan, blockId, week),
        entriesByKey: byKey,
        today,
        nav: weekNav(plan, blockId, week)
      }));
      return;
    }

    const week = day.inPlan && day.authored
      ? resolveWeek(plan, day.blockId, day.week)
      : { days: [] };
    main.append(renderToday({ plan, day, week, entriesByKey: byKey, extras, today }));
  }

  window.addEventListener('hashchange', draw);
  draw();
}

start();
