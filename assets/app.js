import { dayForDate, resolveWeek, monthRows } from './plan-model.js';
import { weekCompletion } from './log-model.js';
import { renderDay, renderWeek, renderMonth, renderSeason, renderCrumbs, el } from './render.js';
import { icon } from './icons.js';
import { daysBetween, todayISO, localHour } from './date-utils.js';
import {
  syncMessages, indexEntries, route, dispatchRequest, runsRequest, dispatchFailure, workflowVerdict,
  syncLanded, syncResultText, SYNC_POLL_MS, SYNC_GIVE_UP_MS
} from './app-state.js';
import { historyStep, resolvePage, focusFor, levelHrefs, crumbs, upHref, pager } from './nav-model.js';

const main = document.getElementById('main');
const bannerEl = document.getElementById('banner');
const countdownEl = document.getElementById('countdown');
const crumbbarEl = document.getElementById('crumbbar');
const syncBtn = document.getElementById('syncbtn');
const syncNoteEl = document.getElementById('syncnote');
const setupEl = document.getElementById('syncsetup');
const setupTokenEl = document.getElementById('syncsetup-token');
const setupErrorEl = document.getElementById('syncsetup-error');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

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
    countdownEl.textContent = daysToRace > 0 ? `${daysToRace} days to go`
      : daysToRace === 0 ? 'Race day' : 'Race day passed';
    countdownEl.title = `${plan.race.name}, ${plan.race.date}`;

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
        plan,
        entries: log.entries,
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
        entries: log.entries,
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
    // The hour decides whether tonight's card leads the page or closes it.
    return renderDay({ plan, day, week, entriesByKey: byKey, extras, date, today, nav,
                       hour: localHour() });
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

  // ---- Sync now
  // The header button asks GitHub to run the sync workflow, which fires the
  // Strava sync task; the page then watches sync-status.json until the run
  // lands and redraws with the new log. Each step's rules are in app-state.js.

  // The GitHub token lives in this browser only. Storage can be missing (a
  // private window); then it lasts as long as the tab.
  const TOKEN_KEY = 'ironman-coach.githubToken';
  let tabToken = '';
  const readToken = () => { try { return localStorage.getItem(TOKEN_KEY) || tabToken; } catch { return tabToken; } };
  const keepToken = token => { tabToken = token; try { localStorage.setItem(TOKEN_KEY, token); } catch { /* tab only */ } };
  const dropToken = () => { tabToken = ''; try { localStorage.removeItem(TOKEN_KEY); } catch { /* nothing kept */ } };

  let noteTimer = null;
  function syncNote(kind, text, link = null) {
    clearTimeout(noteTimer);
    if (!kind) { syncNoteEl.hidden = true; return; }
    syncNoteEl.hidden = false;
    syncNoteEl.dataset.kind = kind;
    syncNoteEl.replaceChildren(...[
      kind === 'busy' ? el('span', { class: 'spinner', 'aria-hidden': 'true' })
                      : icon(kind === 'done' ? 'check' : 'warn', { size: 16 }),
      el('span', { class: 'syncnote-text' }, text),
      link && el('a', { href: link, target: '_blank', rel: 'noopener' }, 'Details'),
      kind !== 'busy' && el('button', { type: 'button', class: 'syncnote-close', 'aria-label': 'Dismiss' },
                            icon('cross', { size: 14 }))
    ].filter(Boolean));
    if (kind === 'done') noteTimer = setTimeout(() => syncNote(null), 10000);
  }
  syncNoteEl.addEventListener('click', e => { if (e.target.closest('.syncnote-close')) syncNote(null); });

  let syncing = false;
  function busy(on) {
    syncing = on;
    syncBtn.disabled = on;
    syncBtn.setAttribute('aria-busy', String(on));
  }

  async function syncNow(token) {
    if (syncing) return;
    busy(true);
    const tappedAt = new Date().toISOString();
    syncNote('busy', 'Starting the Strava sync…');

    let before = status;
    try { before = await loadJSON('data/sync-status.json'); } catch { /* keep the one loaded */ }
    const beforeEntries = log.entries;

    let res;
    try {
      const { url, init } = dispatchRequest(token);
      res = await fetch(url, init);
    } catch {
      res = { ok: false, status: 0 };
    }
    if (!res.ok) {
      const failure = dispatchFailure(res.status);
      busy(false);
      if (failure.tokenProblem) {
        dropToken();
        syncNote(null);
        openSetup(failure.text);
      } else {
        syncNote('fail', failure.text);
      }
      return;
    }

    syncNote('busy', 'Syncing from Strava. This usually takes a minute or two.');
    let fired = false;
    for (const deadline = Date.now() + SYNC_GIVE_UP_MS; Date.now() < deadline;) {
      await wait(SYNC_POLL_MS);

      // Until GitHub has fired the task, a failed workflow run is the only way
      // to learn early that nothing is coming.
      if (!fired) {
        try {
          const { url, init } = runsRequest(token);
          const runs = await fetch(url, init);
          if (runs.ok) {
            const verdict = workflowVerdict((await runs.json()).workflow_runs, tappedAt);
            if (verdict.state === 'failed') {
              syncNote('fail', 'The sync workflow failed on GitHub, so nothing was synced.', verdict.url);
              busy(false);
              return;
            }
            fired = verdict.state === 'fired';
          }
        } catch { /* ask again next time round */ }
      }

      let after = null;
      try { after = await loadJSON('data/sync-status.json'); } catch { /* not yet */ }
      if (!syncLanded(before, after)) continue;

      status = after;
      statusFailed = false;
      try {
        log = await loadJSON('data/log.json');
        logFailed = false;
        syncNote(after.ok ? 'done' : 'fail', syncResultText(beforeEntries, log.entries, after));
      } catch {
        syncNote('fail', 'The sync finished, but the training log did not reload. Reload the page.');
      }
      banner(syncMessages(status, logFailed, statusFailed));
      draw();
      busy(false);
      return;
    }

    syncNote('fail', 'The sync started but has not shown up after six minutes. It may still be running: reload in a few minutes.');
    busy(false);
  }

  function openSetup(error = null) {
    setupErrorEl.hidden = !error;
    setupErrorEl.textContent = error || '';
    setupEl.returnValue = '';
    setupEl.showModal();
  }
  document.getElementById('syncsetup-cancel').addEventListener('click', () => setupEl.close(''));
  setupEl.addEventListener('close', () => {
    const token = setupTokenEl.value.trim();
    setupTokenEl.value = '';
    if (setupEl.returnValue !== 'save' || !token) return;
    keepToken(token);
    syncNow(token);
  });
  syncBtn.addEventListener('click', () => {
    const token = readToken();
    if (token) syncNow(token);
    else openSetup();
  });

  window.addEventListener('hashchange', draw);
  draw();
}

start();
