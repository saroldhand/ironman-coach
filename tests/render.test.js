import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { prescribedText, distanceText, periodBars, summaryLine, fuelLines, whenText, weekHeadline, tonightFirst, durationText, disciplineBars } from '../assets/render.js';

test('prescribedText formats distances in metres with thousands separators', () => {
  assert.equal(prescribedText({ metric: 'distance', value: 2000, unit: 'm' }), '2,000 m');
  assert.equal(prescribedText({ metric: 'distance', value: 1300, unit: 'm' }), '1,300 m');
});

test('prescribedText formats durations in minutes', () => {
  assert.equal(prescribedText({ metric: 'duration', value: 45, unit: 'min' }), '45 min');
  assert.equal(prescribedText({ metric: 'duration', value: 135, unit: 'min' }), '135 min');
});

test('summaryLine gives a lift its main set, which is always the first line', () => {
  const lift = {
    discipline: 'strength',
    effort: '90 sec rest between sets. Same weight for all ten sets.',
    setLines: ['Deadlift 10×10', 'One Arm DB Row 4×8-10']
  };
  assert.equal(summaryLine(lift), 'Deadlift 10×10');
});

test('summaryLine gives a swim its effort, not its warmup', () => {
  // A swim's first set line is "400 easy free" - the warmup, which says nothing
  // about the session. The effort does.
  const swim = {
    discipline: 'swim',
    effort: 'Easy throughout. Technique is the point, not the distance.',
    setLines: ['400 easy free', '8 × 50 drill - 15s rest']
  };
  assert.equal(summaryLine(swim), 'Easy throughout');
});

test('summaryLine takes the first clause of an effort, whichever separator comes first', () => {
  assert.equal(
    summaryLine({ discipline: 'bike', effort: 'Zone 2 - 65-75% max HR. Conversational the whole way.', setLines: [] }),
    'Zone 2');
  assert.equal(
    summaryLine({ discipline: 'run', effort: 'Zone 2. Slower than you think.', setLines: [] }),
    'Zone 2');
  assert.equal(
    summaryLine({ discipline: 'swim', effort: 'Steady and repeatable. Same pace on the last rep as the first.', setLines: [] }),
    'Steady and repeatable');
});

test('summaryLine truncates a long set line rather than letting a cell grow', () => {
  // A superset line is far wider than a grid column.
  const long = 'SUPERSET 4×: Leg Extensions 10-12 + Leg Curls 10-12';
  const out = summaryLine({ discipline: 'strength', effort: 'Volume day.', setLines: [long] });
  assert.ok(out.length <= 38, `got ${out.length} chars: ${out}`);
  assert.ok(out.endsWith('…'), 'a truncated line ends in an ellipsis');
  assert.ok(long.startsWith(out.slice(0, -1)), 'the kept portion is a real prefix of the original');
});

test('summaryLine leaves a line that already fits untouched', () => {
  const fits = 'Barbell Squat 5×5 (75% 1RM)';
  assert.equal(summaryLine({ discipline: 'strength', effort: 'Heavy.', setLines: [fits] }), fits);
});

test('summaryLine returns empty string when there is nothing to summarise', () => {
  assert.equal(summaryLine({ discipline: 'strength', effort: '', setLines: [] }), '');
  assert.equal(summaryLine({ discipline: 'run', effort: '', setLines: [] }), '');
});

test('prescribedText switches to kilometres at race-length distances', () => {
  // Race day prescribes the bike and run by distance; "90,000 m" reads as a
  // typo. Pool distances stay in metres.
  assert.equal(prescribedText({ metric: 'distance', value: 90000, unit: 'm' }, 'bike'), '55.9 mi');
  assert.equal(prescribedText({ metric: 'distance', value: 21100, unit: 'm' }, 'run'), '13.1 mi');
  // Swims stay in metres, however long: the pool sets are written in metres.
  assert.equal(prescribedText({ metric: 'distance', value: 1900, unit: 'm' }, 'swim'), '1,900 m');
  assert.equal(distanceText(11700, 'swim'), '11,700 m');
  assert.equal(prescribedText({ metric: 'distance', value: 9999, unit: 'm' }), '9,999 m');
  assert.equal(prescribedText({ metric: 'distance', value: 1900, unit: 'm' }), '1,900 m');
});

test('summaryLine names a swim by its main set when it has one', () => {
  // The effort says how a swim should feel; the main set says what it is.
  // The day cell has room for one, and the main set is the one that changes.
  const swim = {
    discipline: 'swim',
    effort: 'Steady sets hold the same pace on the last rep as the first.',
    setLines: ['300 easy free', 'MAIN SET: 8 × 100 @ CSS+8 - 20s rest', '200 easy cooldown']
  };
  assert.equal(summaryLine(swim), '8 × 100 @ CSS+8');
});

const FUEL = { under75min: 'G water', longRide: 'G ride', longRun: 'G run', post: 'G post' };
const fuelPlan = { nutrition: { fuel: FUEL } };
const session = (discipline, metric, value) => ({ discipline, prescribed: { metric, value } });

test('fuelLines keeps short days on water and adds recovery after a long one', () => {
  assert.deepEqual(fuelLines(fuelPlan, { dayKey: 'tue', sessions: [session('bike', 'duration', 60)] }),
    ['G water']);
  assert.deepEqual(fuelLines(fuelPlan, { dayKey: 'sat', sessions: [session('bike', 'duration', 180)] }),
    ['G ride', 'G post']);
});

test("fuelLines prefers the day's own fuelling rules over the global ones", () => {
  const day = { dayKey: 'sat', fuel: { ...FUEL, longRide: 'T ride' },
                sessions: [session('bike', 'duration', 180)] };
  assert.deepEqual(fuelLines(fuelPlan, day), ['T ride', 'G post']);
});

test('fuelLines treats a bike or run prescribed by distance as long', () => {
  // Race day: the legs are prescribed by distance, and judging them by a
  // duration threshold would tell the athlete to drink water only.
  const raceDay = { dayKey: 'sat', sessions: [
    session('swim', 'distance', 1900),
    session('bike', 'distance', 90000),
    session('run', 'distance', 21100)
  ] };
  assert.deepEqual(fuelLines(fuelPlan, raceDay), ['G ride', 'G run', 'G post']);
});

test('a session names its slot in words, and an unplaced one names none', () => {
  assert.equal(whenText('before-work'), 'before work');
  assert.equal(whenText('lunch'), 'lunch');
  assert.equal(whenText('anytime'), null);
  assert.equal(whenText(undefined), null);
});

test('the week headline gives the hours and the earliest alarm by day', () => {
  assert.equal(weekHeadline({ hours: 7.5, earliest: { date: '2026-12-08', alarm: 6 * 60 } }),
    '7.5 h of training · earliest alarm 6:00 am Tuesday');
  assert.equal(weekHeadline({ hours: 8, earliest: null }), '8.0 h of training', 'one decimal always');
  // A week with no work mornings (race week) still gives its hours.
  assert.equal(weekHeadline({ hours: 3.2, earliest: null }), '3.2 h of training');
});

test("tonight's card leads the page from midday", () => {
  assert.equal(tonightFirst(7), false);
  assert.equal(tonightFirst(11), false);
  assert.equal(tonightFirst(12), true);
  assert.equal(tonightFirst(21), true);
});

test('durations read as h:mm so a column of them lines up', () => {
  assert.equal(durationText(45), '0:45');
  assert.equal(durationText(106), '1:46');
  assert.equal(durationText(179.6), '3:00', 'rounded to the minute first');
});

const actuals = (recorded, values = {}) => ({
  recorded,
  byDiscipline: Object.fromEntries(['swim', 'bike', 'run', 'strength'].map(d =>
    [d, { minutes: 0, metres: 0, count: 0, ...(values[d] || {}) }])),
  total: { minutes: 0, metres: 0, count: 0 }
});
const typical = { swim: { minutes: 50, metres: 1000 }, bike: { minutes: 100, metres: 37000 },
                  run: { minutes: 80, metres: 10000 }, strength: { minutes: 75, metres: 0 } };
const speed = { swim: 0.4, bike: 6, run: 2.3, strength: null };
const pick = rows => Object.fromEntries(rows.map(r => [r.label, r.bars.map(b => [b.text, b.targetText, b.pct, b.over])]));

test('in a planned week each bar fills toward the plan, and ride and run distance toward an estimate', () => {
  const planned = { days: 7, byDiscipline: { swim: { minutes: 108, metres: 4300 }, bike: { minutes: 120, metres: 0 },
                                            run: { minutes: 80, metres: 0 }, strength: { minutes: 35, metres: 0 } } };
  const done = actuals(true, { swim: { minutes: 54, metres: 2150, count: 2 }, bike: { minutes: 150, metres: 50000, count: 2 },
                               run: { minutes: 40, metres: 5520, count: 1 } });
  assert.deepEqual(pick(disciplineBars({ actuals: done, planned, typical, speed })), {
    Swim: [['0:54', '1:48 planned', 50, false], ['2,150 m', '4,300 m planned', 50, false]],
    // 2:00 at 6 m/s is 43.2 km, 26.8 mi - an estimate, so marked ≈. Past it, the bar
    // stops at full and says so.
    Bike: [['2:30', '2:00 planned', 100, true], ['31.1 mi', '≈26.8 mi planned', 100, true]],
    Run: [['0:40', '1:20 planned', 50, false], ['3.4 mi', '≈6.9 mi planned', 50, false]],
    // Lifting has a time bar only.
    Lift: [['0:00', '0:35 planned', 0, false]]
  });
});

test('with no plan, bars fill toward the typical week or month', () => {
  const done = actuals(true, { bike: { minutes: 1600, metres: 570800, count: 6 } });
  const rows = pick(disciplineBars({ actuals: done, planned: { days: 0, byDiscipline: {} }, typical, speed, period: 'month' }));
  assert.deepEqual(rows.Bike, [['26:40', 'typical month 1:40', 100, true], ['354.7 mi', 'typical month 23.0 mi', 100, true]]);
  assert.deepEqual(rows.Swim, [['0:00', 'typical month 0:50', 0, false], ['0 m', 'typical month 1,000 m', 0, false]]);
});

test('a period with nothing recorded shows dashes and empty bars, not zeros', () => {
  const rows = disciplineBars({ actuals: actuals(false), planned: null, typical, speed });
  assert.ok(rows.every(r => r.bars.every(b => b.text === '—' && b.pct === 0)));
});

// ---- progress so far

const realPlan = JSON.parse(readFileSync(new URL('../data/plan.json', import.meta.url)));

test('a plan week still to come starts at zero against its planned totals', () => {
  // Bridge W1, seen the week before: nothing recorded yet, and none expected.
  const bars = periodBars(realPlan, [], '2026-11-09', '2026-11-16', 'week', '2026-11-03');
  assert.equal(bars.actuals.recorded, true, 'progress so far, not unknown');
  const rows = disciplineBars(bars);
  assert.deepEqual(rows.map(r => [r.label, r.bars[0].text, r.bars[0].targetText, r.bars[0].pct]), [
    ['Swim', '0:00', '1:48 planned', 0],
    ['Bike', '0:00', '2:00 planned', 0],
    ['Run', '0:00', '1:20 planned', 0],
    ['Lift', '0:00', '0:35 planned', 0]
  ]);
});

test('as workouts are recorded, the week fills toward its plan', () => {
  const ride = { date: '2026-11-10', planKey: 'bridge:1:tue:bike', status: 'done', note: '',
                 strava: { id: '1', type: 'VirtualRide', name: 'Ride', movingTime: 45 * 60, distance: 20000 } };
  const rows = disciplineBars(periodBars(realPlan, [ride], '2026-11-09', '2026-11-16', 'week', '2026-11-11'));
  const bike = rows.find(r => r.label === 'Bike').bars[0];
  assert.deepEqual([bike.text, bike.targetText, bike.pct], ['0:45', '2:00 planned', 38]);
});

test('a week that is over and recorded nothing stays unknown', () => {
  const bars = periodBars(realPlan, [], '2026-11-09', '2026-11-16', 'week', '2026-11-20');
  assert.equal(bars.actuals.recorded, false);
  assert.ok(disciplineBars(bars).every(r => r.bars.every(b => b.text === '—')));
});
