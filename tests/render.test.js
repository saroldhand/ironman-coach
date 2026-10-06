import test from 'node:test';
import assert from 'node:assert/strict';
import { prescribedText, summaryLine, fuelLines } from '../assets/render.js';

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
  // gvtA Thursday opens with a superset that is far wider than a grid column.
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
  assert.equal(prescribedText({ metric: 'distance', value: 90000, unit: 'm' }), '90 km');
  assert.equal(prescribedText({ metric: 'distance', value: 21100, unit: 'm' }), '21.1 km');
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
