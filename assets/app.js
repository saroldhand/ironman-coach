import { dayForDate, resolveWeek, weekNav, blocksInOrder, monthRows, planStart } from './plan-model.js';
import { weekCompletion } from './log-model.js';
import { renderDay, renderWeek, renderMonth, renderSeason } from './render.js';
import { daysBetween, todayISO, ymOf } from './date-utils.js';
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
    const todayInPlan = dayForDate(plan, today);

    main.replaceChildren();

    if (r.view === 'season') {
      main.append(renderSeason({ plan, entries: log.entries, today, resolveWeek, weekCompletion }));
      return;
    }

    if (r.view === 'month') {
      // A bare #/month opens on the month being trained. Before the plan
      // starts that is not this month, so fall back to the month it begins.
      const ym = r.ym || (todayInPlan.inPlan ? ymOf(today) : ymOf(planStart(plan)));
      main.append(renderMonth({
        rows: monthRows(plan, ym),
        ym,
        entriesByKey: indexEntries(log.entries, today).byKey,
        today
      }));
      return;
    }

    if (r.view === 'week') {
      const blockId = r.blockId || (todayInPlan.inPlan ? todayInPlan.blockId : blocksInOrder(plan)[0].id);
      const week = r.week || (todayInPlan.inPlan ? todayInPlan.week : 1);
      main.append(renderWeek({
        plan,
        week: resolveWeek(plan, blockId, week),
        entriesByKey: indexEntries(log.entries, today).byKey,
        today,
        nav: weekNav(plan, blockId, week)
      }));
      return;
    }

    // The day view. `r.date` is null for #/today, and for a hash that named a
    // date the plan could not parse — both mean "the day being trained now".
    const date = r.date || today;
    const day = dayForDate(plan, date);
    // Extras are the activities with no planned slot ON THIS DATE, so they are
    // indexed against the day being viewed, not against today.
    const { byKey, extras } = indexEntries(log.entries, date);
    const week = day.inPlan && day.authored
      ? resolveWeek(plan, day.blockId, day.week)
      : { days: [] };
    main.append(renderDay({ plan, day, week, entriesByKey: byKey, extras, date, today }));
  }

  window.addEventListener('hashchange', draw);
  draw();
}

start();
