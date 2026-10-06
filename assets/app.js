import { dayForDate, resolveWeek, monthRows } from './plan-model.js';
import { weekCompletion } from './log-model.js';
import { renderDay, renderWeek, renderMonth, renderSeason, renderCrumbs } from './render.js';
import { daysBetween, todayISO } from './date-utils.js';
import { syncMessages, indexEntries, route } from './app-state.js';
import { historyStep, resolvePage, focusFor, levelHrefs, crumbs, upHref, pager } from './nav-model.js';

const main = document.getElementById('main');
const bannerEl = document.getElementById('banner');
const countdownEl = document.getElementById('countdown');
const crumbbarEl = document.getElementById('crumbbar');

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

// The level tabs move between zoom levels on the date in focus, so they are
// re-pointed on every draw rather than fixed in index.html.
function setLevelTabs(view, hrefs) {
  for (const a of document.querySelectorAll('.views a')) {
    a.setAttribute('href', hrefs[a.dataset.view]);
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

  // Navigation state for this tab: the number of the history entry on screen,
  // where each entry was scrolled, and the date in focus across zoom levels.
  // The app restores scroll itself, because it redraws the page after the
  // browser would have.
  let index = null;
  let focus = null;
  const scrolledTo = new Map();
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  function draw() {
    // Recomputed on every draw, not once at load — a tab left open overnight
    // must not keep rendering yesterday as "today".
    const today = todayISO();
    const daysToRace = daysBetween(today, plan.race.date);
    countdownEl.textContent = daysToRace >= 0
      ? `${daysToRace} days to ${plan.race.date}`
      : 'race day passed';

    const hash = location.hash || '#/today';
    if (index !== null) scrolledTo.set(index, window.scrollY);
    const step = historyStep(history.state, index);
    index = step.index;
    if (step.fresh) {
      history.replaceState({ ...(history.state || {}), navIndex: index }, '');
      scrolledTo.delete(index);  // left by an entry the browser has since replaced
    }

    const page = resolvePage(plan, route(hash), today);
    focus = focusFor(plan, page, today, focus);
    const path = crumbs(plan, page, focus);
    const nav = { crumbs: path, up: upHref(path), pager: pager(plan, page, today) };
    setLevelTabs(page.view, levelHrefs(plan, focus, today));
    crumbbarEl.replaceChildren(...renderCrumbs(nav));

    main.replaceChildren(renderPage(page, today, nav));

    // Back lands where that page was left; anything new opens at the top, or
    // on the week the season was opened for.
    const focusRow = main.querySelector('.seasonrow.focus');
    if (!step.fresh && scrolledTo.has(index)) window.scrollTo(0, scrolledTo.get(index));
    else if (focusRow) focusRow.scrollIntoView({ block: 'center' });
    else window.scrollTo(0, 0);
  }

  function renderPage(page, today, nav) {
    if (page.view === 'season') {
      return renderSeason({ plan, entries: log.entries, today, resolveWeek, weekCompletion,
                            nav, focusWeek: page.focusWeek });
    }

    if (page.view === 'month') {
      return renderMonth({
        rows: monthRows(plan, page.ym),
        ym: page.ym,
        entriesByKey: indexEntries(log.entries, today).byKey,
        today,
        nav
      });
    }

    if (page.view === 'week') {
      return renderWeek({
        plan,
        week: resolveWeek(plan, page.blockId, page.week),
        entriesByKey: indexEntries(log.entries, today).byKey,
        today,
        nav
      });
    }

    const date = page.date;
    const day = dayForDate(plan, date);
    // Extras are the activities with no planned slot ON THIS DATE, so they are
    // indexed against the day being viewed, not against today.
    const { byKey, extras } = indexEntries(log.entries, date);
    const week = day.inPlan && day.authored
      ? resolveWeek(plan, day.blockId, day.week)
      : { days: [] };
    return renderDay({ plan, day, week, entriesByKey: byKey, extras, date, today, nav });
  }

  // Back steps back through the app's own history when there is some. On a
  // page opened cold there is none, and the link's own href takes it up a
  // level instead - it never leaves the site and never dead-ends.
  document.addEventListener('click', e => {
    const back = e.target.closest('a[data-back]');
    if (!back || !(index > 0)) return;
    e.preventDefault();
    history.back();
  });

  window.addEventListener('hashchange', draw);
  draw();
}

start();
