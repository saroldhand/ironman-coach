import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { historyStep, resolvePage, weekOf, focusFor, levelHrefs, crumbs, upHref, pager } from '../assets/nav-model.js';

const plan = JSON.parse(readFileSync(new URL('../data/plan.json', import.meta.url)));
const TODAY = '2026-10-06';          // Strength W4, Tuesday
const labels = trail => trail.map(c => c.label);
const hrefs = trail => trail.map(c => c.href);

test('a fresh page is numbered one past the page it was reached from', () => {
  assert.deepEqual(historyStep(null, null), { index: 0, fresh: true }, 'the page the app opened on');
  assert.deepEqual(historyStep(null, 0), { index: 1, fresh: true });
  assert.deepEqual(historyStep({}, 4), { index: 5, fresh: true }, 'state without a number is still fresh');
});

test('a numbered entry is the browser moving through history', () => {
  assert.deepEqual(historyStep({ navIndex: 1 }, 2), { index: 1, fresh: false }, 'back');
  assert.deepEqual(historyStep({ navIndex: 3 }, 2), { index: 3, fresh: false }, 'forward');
  assert.deepEqual(historyStep({ navIndex: 2 }, null), { index: 2, fresh: false },
    'a reload keeps its place, so Back still has somewhere to go');
});

test('a link to the page you were just on is a new page, not going back', () => {
  // Month -> Day tab returns to the day you came from. Comparing addresses
  // would call that "back" and lose the month from the trail; the browser
  // made a new entry, so this is a fresh page one further along.
  assert.deepEqual(historyStep(null, 3), { index: 4, fresh: true });
});

test('resolvePage fills defaults and never hands a renderer a page that does not exist', () => {
  assert.deepEqual(resolvePage(plan, { view: 'day', date: null }, TODAY), { view: 'day', date: TODAY });
  assert.deepEqual(resolvePage(plan, { view: 'week', blockId: 'arc', week: 21 }, TODAY),
    { view: 'week', blockId: 'arc', week: 21 });
  for (const bad of [{ blockId: 'nope', week: 2 }, { blockId: 'arc', week: 27 }, { blockId: 'arc', week: NaN }]) {
    assert.deepEqual(resolvePage(plan, { view: 'week', ...bad }, TODAY),
      { view: 'week', blockId: 'strength', week: 4 }, JSON.stringify(bad));
  }
  assert.deepEqual(resolvePage(plan, { view: 'month', ym: null }, TODAY), { view: 'month', ym: '2026-10' });
  assert.deepEqual(resolvePage(plan, { view: 'month', ym: null }, '2026-01-10'), { view: 'month', ym: '2026-08' },
    'before the plan, a bare month opens on the month it starts');
  assert.deepEqual(resolvePage(plan, { view: 'season', blockId: 'arc', week: 21 }, TODAY),
    { view: 'season', focusWeek: { blockId: 'arc', week: 21 } });
  assert.deepEqual(resolvePage(plan, { view: 'season' }, TODAY), { view: 'season', focusWeek: null });
  assert.deepEqual(resolvePage(plan, { view: 'nonsense' }, TODAY), { view: 'day', date: TODAY });
});

test('weekOf clamps dates outside the plan to its first or last week', () => {
  assert.deepEqual(weekOf(plan, '2027-05-01'), { blockId: 'arc', week: 21 });
  assert.deepEqual(weekOf(plan, '2026-08-01'), { blockId: 'prep', week: 1 });
  assert.deepEqual(weekOf(plan, '2027-07-01'), { blockId: 'arc', week: 26 });
});

test('zooming out keeps the day in focus, so zooming back in returns to it', () => {
  const day = { view: 'day', date: '2027-05-01' };
  let focus = focusFor(plan, day, TODAY, null);
  assert.equal(focus, '2027-05-01');

  focus = focusFor(plan, { view: 'week', blockId: 'arc', week: 21 }, TODAY, focus);
  assert.equal(focus, '2027-05-01', 'the week holds the day it was opened from');
  focus = focusFor(plan, { view: 'month', ym: '2027-05' }, TODAY, focus);
  assert.equal(focus, '2027-05-01', 'so does the month');
  focus = focusFor(plan, { view: 'season', focusWeek: { blockId: 'arc', week: 21 } }, TODAY, focus);
  assert.equal(focus, '2027-05-01', 'and the season');
});

test('a level opened from elsewhere focuses today if it holds today, else its first day', () => {
  const away = '2027-03-03';
  assert.equal(focusFor(plan, { view: 'week', blockId: 'strength', week: 4 }, TODAY, away), TODAY);
  assert.equal(focusFor(plan, { view: 'week', blockId: 'arc', week: 21 }, TODAY, away), '2027-04-26');
  assert.equal(focusFor(plan, { view: 'month', ym: '2026-10' }, TODAY, away), TODAY);
  assert.equal(focusFor(plan, { view: 'month', ym: '2027-05' }, TODAY, away), '2027-05-01');
  assert.equal(focusFor(plan, { view: 'season', focusWeek: null }, TODAY, null), TODAY);
});

test('the level tabs keep the date in focus instead of jumping to today', () => {
  assert.deepEqual(levelHrefs(plan, '2027-05-01', TODAY), {
    day: '#/day/2027-05-01',
    week: '#/week/arc/21',
    month: '#/month/2027-05',
    season: '#/season/arc/21'
  });
  assert.equal(levelHrefs(plan, TODAY, TODAY).day, '#/today');
  assert.equal(levelHrefs(plan, '2026-08-01', TODAY).week, '#/week/prep/1',
    'a focus before the plan points the week tab at its first week');
});

test('a day in the plan sits under its season, month and week', () => {
  const trail = crumbs(plan, { view: 'day', date: '2027-05-01' }, '2027-05-01');
  assert.deepEqual(labels(trail), ['Season', 'May 2027', 'Arc W21', 'Sat 1 May']);
  assert.deepEqual(hrefs(trail), ['#/season/arc/21', '#/month/2027-05', '#/week/arc/21', null]);
});

test('a day outside the plan has no week to sit under', () => {
  const trail = crumbs(plan, { view: 'day', date: '2026-08-23' }, '2026-08-23');
  assert.deepEqual(labels(trail), ['Season', 'Aug 2026', 'Sun 23 Aug']);
});

test('the week, month and season pages close their own trails', () => {
  const week = crumbs(plan, { view: 'week', blockId: 'arc', week: 21 }, '2027-05-01');
  assert.deepEqual(labels(week), ['Season', 'May 2027', 'Arc W21'],
    'a week spanning two months sits under the month of the day in focus');
  assert.equal(week.at(-1).href, null);
  assert.deepEqual(labels(crumbs(plan, { view: 'week', blockId: 'arc', week: 21 }, '2027-04-26')),
    ['Season', 'Apr 2027', 'Arc W21']);

  const month = crumbs(plan, { view: 'month', ym: '2027-05' }, '2027-05-01');
  assert.deepEqual(labels(month), ['Season', 'May 2027']);
  assert.deepEqual(hrefs(month), ['#/season/arc/21', null]);

  assert.deepEqual(crumbs(plan, { view: 'season', focusWeek: null }, TODAY), [{ label: 'Season', href: null }]);
});

test('up is the nearest linked ancestor, and the season has none', () => {
  assert.equal(upHref(crumbs(plan, { view: 'day', date: '2027-05-01' }, '2027-05-01')), '#/week/arc/21');
  assert.equal(upHref(crumbs(plan, { view: 'week', blockId: 'arc', week: 21 }, '2027-05-01')), '#/month/2027-05');
  assert.equal(upHref(crumbs(plan, { view: 'month', ym: '2027-05' }, '2027-05-01')), '#/season/arc/21');
  assert.equal(upHref(crumbs(plan, { view: 'season', focusWeek: null }, TODAY)), null);
});

test('the day pager names its neighbours and offers today from anywhere else', () => {
  const p = pager(plan, { view: 'day', date: '2027-05-01' }, TODAY);
  assert.deepEqual(p.prev, { label: 'Fri 30 Apr', href: '#/day/2027-04-30' });
  assert.deepEqual(p.next, { label: 'Sun 2 May', href: '#/day/2027-05-02' });
  assert.deepEqual(p.home, { label: 'Today', href: '#/today' });
  assert.equal(pager(plan, { view: 'day', date: TODAY }, TODAY).home, null, 'no way home from home');
});

test('the week pager crosses block edges and stops at the ends of the plan', () => {
  const edge = pager(plan, { view: 'week', blockId: 'strength', week: 12 }, TODAY);
  assert.deepEqual(edge.next, { label: 'Arc W1', href: '#/week/arc/1' });
  assert.deepEqual(edge.home, { label: 'This week', href: '#/week/strength/4' });
  assert.equal(pager(plan, { view: 'week', blockId: 'prep', week: 1 }, TODAY).prev, null);
  assert.equal(pager(plan, { view: 'week', blockId: 'arc', week: 26 }, TODAY).next, null);
  assert.equal(pager(plan, { view: 'week', blockId: 'strength', week: 4 }, TODAY).home, null);
});

test('the month pager names months, adding the year only when it changes', () => {
  const p = pager(plan, { view: 'month', ym: '2027-01' }, TODAY);
  assert.deepEqual(p.prev, { label: 'December 2026', href: '#/month/2026-12' });
  assert.deepEqual(p.next, { label: 'February', href: '#/month/2027-02' });
  assert.deepEqual(p.home, { label: 'This month', href: '#/month/2026-10' });
  assert.equal(pager(plan, { view: 'month', ym: '2026-10' }, TODAY).home, null);
});

test('the season pager only offers the way back to today', () => {
  assert.deepEqual(pager(plan, { view: 'season', focusWeek: null }, TODAY),
    { prev: null, home: { label: 'Today', href: '#/today' }, next: null });
});
