// Moving between the four zoom levels - season, month, week, day - kept pure
// so node --test can check it. Every page offers three ways out: back to where
// you were, up to what contains it, and sideways to its neighbours. The level
// tabs keep the date in focus rather than jumping to today, so zooming out and
// back in lands where you started instead of somewhere you have to find again.

import { addDays, addMonths, daysBetween, dayLabel, monthLabel, shortMonthLabel, ymOf } from './date-utils.js';
import { blocksInOrder, dayForDate, planStart, weekNav } from './plan-model.js';

// Each history entry the app creates is numbered one past the entry it was
// reached from, and the number travels with the entry in history.state.
// Arriving on a numbered entry is the browser moving through history - back,
// forward or a reload - and an unnumbered one is a fresh page. Comparing
// addresses instead would mistake a link that happens to point at the
// previous page for going back. Back has somewhere to go when index > 0.
export function historyStep(state, lastIndex) {
  if (state && Number.isInteger(state.navIndex)) return { index: state.navIndex, fresh: false };
  return { index: lastIndex === null ? 0 : lastIndex + 1, fresh: true };
}

const blockById = (plan, id) => plan.blocks.find(b => b.id === id);
const weekStart = (plan, blockId, week) => addDays(blockById(plan, blockId).start, (week - 1) * 7);
const weekLabel = (plan, blockId, week) => `${blockById(plan, blockId).label} W${week}`;

function isWeek(plan, blockId, week) {
  const block = blockById(plan, blockId);
  return Boolean(block) && Number.isInteger(week) && week >= 1 && week <= block.weeks;
}

// The plan week a date falls in. A date outside the plan clamps to its first
// or last week, so nothing ever links to a week that does not exist.
export function weekOf(plan, iso) {
  const day = dayForDate(plan, iso);
  if (day.inPlan) return { blockId: day.blockId, week: day.week };
  const blocks = blocksInOrder(plan);
  if (day.reason === 'before-start') return { blockId: blocks[0].id, week: 1 };
  const last = blocks.at(-1);
  return { blockId: last.id, week: last.weeks };
}

// A parsed route with its defaults filled in and its ids checked, so every
// renderer is handed a page that exists. Anything unreadable shows today.
export function resolvePage(plan, r, today) {
  if (r.view === 'day') return { view: 'day', date: r.date || today };
  if (r.view === 'month') {
    // Before the plan starts, "this month" has nothing in it; open on the
    // month the plan begins instead.
    const fallback = dayForDate(plan, today).inPlan ? ymOf(today) : ymOf(planStart(plan));
    return { view: 'month', ym: r.ym || fallback };
  }
  if (r.view === 'season') {
    return { view: 'season',
             focusWeek: isWeek(plan, r.blockId, r.week) ? { blockId: r.blockId, week: r.week } : null };
  }
  if (r.view === 'week') {
    return isWeek(plan, r.blockId, r.week)
      ? { view: 'week', blockId: r.blockId, week: r.week }
      : { view: 'week', ...weekOf(plan, today) };
  }
  return { view: 'day', date: today };
}

// The date the athlete is looking at. A week or month that contains the
// previous focus keeps it, so a day opened, zoomed out of and zoomed back into
// is the same day - not the first of the month.
export function focusFor(plan, page, today, prev) {
  if (page.view === 'day') return page.date;
  if (page.view === 'month') {
    if (prev && ymOf(prev) === page.ym) return prev;
    return ymOf(today) === page.ym ? today : `${page.ym}-01`;
  }

  const week = page.view === 'week' ? page : page.focusWeek;
  if (!week) return prev || today;
  const start = weekStart(plan, week.blockId, week.week);
  const inWeek = iso => Boolean(iso) && daysBetween(start, iso) >= 0 && daysBetween(start, iso) < 7;
  if (inWeek(prev)) return prev;
  return inWeek(today) ? today : start;
}

// Where each level tab goes from here: the same date, at another zoom level.
export function levelHrefs(plan, focus, today) {
  const { blockId, week } = weekOf(plan, focus);
  return {
    day: focus === today ? '#/today' : `#/day/${focus}`,
    week: `#/week/${blockId}/${week}`,
    month: `#/month/${ymOf(focus)}`,
    season: `#/season/${blockId}/${week}`
  };
}

// The path from the whole season down to this page. Each ancestor links back
// up without losing the place - the month holding this day, the season
// scrolled to this week - and the current page closes the trail, unlinked.
export function crumbs(plan, page, focus) {
  if (page.view === 'season') return [{ label: 'Season', href: null }];

  const ym = page.view === 'month' ? page.ym : ymOf(focus);
  const trail = [
    { label: 'Season', href: levelHrefs(plan, focus, null).season },
    { label: shortMonthLabel(ym), href: page.view === 'month' ? null : `#/month/${ym}` }
  ];
  if (page.view === 'month') return trail;

  if (page.view === 'week') {
    trail.push({ label: weekLabel(plan, page.blockId, page.week), href: null });
    return trail;
  }

  const day = dayForDate(plan, page.date);
  if (day.inPlan) {
    trail.push({ label: weekLabel(plan, day.blockId, day.week), href: `#/week/${day.blockId}/${day.week}` });
  }
  trail.push({ label: dayLabel(page.date), href: null });
  return trail;
}

// One level up: the nearest linked ancestor. Back falls back to it when there
// is no earlier page in the app - a page opened cold from a bookmark - so it
// never dead-ends and never leaves the site.
export function upHref(trail) {
  const parent = [...trail].reverse().find(c => c.href);
  return parent ? parent.href : null;
}

// Neighbours at the same level, plus the way home to now when the page is
// somewhere else. Labels name the destination: "Fri 30 Apr" says where a link
// goes, where "prev day" made you work it out.
export function pager(plan, page, today) {
  if (page.view === 'day') {
    const [prev, next] = [addDays(page.date, -1), addDays(page.date, 1)];
    return {
      prev: { label: dayLabel(prev), href: `#/day/${prev}` },
      home: page.date === today ? null : { label: 'Today', href: '#/today' },
      next: { label: dayLabel(next), href: `#/day/${next}` }
    };
  }

  if (page.view === 'week') {
    const { prev, next } = weekNav(plan, page.blockId, page.week);
    const link = w => w && { label: weekLabel(plan, w.blockId, w.week), href: `#/week/${w.blockId}/${w.week}` };
    const now = dayForDate(plan, today);
    const here = now.inPlan && now.blockId === page.blockId && now.week === page.week;
    return {
      prev: link(prev),
      home: now.inPlan && !here ? { label: 'This week', href: `#/week/${now.blockId}/${now.week}` } : null,
      next: link(next)
    };
  }

  if (page.view === 'month') {
    const [prev, next] = [addMonths(page.ym, -1), addMonths(page.ym, 1)];
    // "April", or "December 2026" once the year changes underneath you.
    const name = ym => {
      const [month, year] = monthLabel(ym).split(' ');
      return year === page.ym.slice(0, 4) ? month : `${month} ${year}`;
    };
    return {
      prev: { label: name(prev), href: `#/month/${prev}` },
      home: ymOf(today) === page.ym ? null : { label: 'This month', href: `#/month/${ymOf(today)}` },
      next: { label: name(next), href: `#/month/${next}` }
    };
  }

  return { prev: null, home: { label: 'Today', href: '#/today' }, next: null };
}
