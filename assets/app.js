import { dayForDate, resolveWeek, weekNav, blocksInOrder } from './plan-model.js';
import { weekCompletion } from './log-model.js';
import { renderToday, renderWeek, renderSeason } from './render.js';
import { daysBetween, todayISO } from './date-utils.js';
import { syncMessages, indexEntries, route } from './app-state.js';

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
  let statusFailed = false;
  try { status = await loadJSON('data/sync-status.json'); } catch { statusFailed = true; }

  banner(syncMessages(status, logFailed, statusFailed));

  function draw() {
    // Recomputed on every draw, not once at load — a tab left open overnight
    // must not keep rendering yesterday as "today".
    const today = todayISO();
    const daysToRace = daysBetween(today, plan.race.date);
    countdownEl.textContent = daysToRace >= 0
      ? `${daysToRace} days to ${plan.race.date}`
      : 'race day passed';

    const r = route(location.hash);
    setActiveNav(r.view);
    const day = dayForDate(plan, today);
    const { byKey, extras } = indexEntries(log.entries, today);

    main.replaceChildren();

    if (r.view === 'season') {
      main.append(renderSeason({ plan, entries: log.entries, today, resolveWeek, weekCompletion }));
      return;
    }

    if (r.view === 'week') {
      const blockId = r.blockId || (day.inPlan ? day.blockId : blocksInOrder(plan)[0].id);
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
