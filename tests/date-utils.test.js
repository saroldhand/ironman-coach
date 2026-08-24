import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysBetween, weekdayKey, todayISO, hoursSince,
         ymOf, addMonths, monthLabel, monthGrid } from '../assets/date-utils.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const UTILS_PATH = fileURLToPath(new URL('../assets/date-utils.js', import.meta.url));
const UTILS_URL = pathToFileURL(UTILS_PATH).href;

// Evaluate an expression against date-utils in a child process with TZ forced.
function inTZ(tz, expr) {
  const src = `import { addDays, daysBetween, weekdayKey, todayISO, hoursSince } from ${JSON.stringify(UTILS_URL)};`
    + ` console.log(String(${expr}));`;
  return execFileSync(process.execPath, ['--input-type=module', '-e', src], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8'
  }).trim();
}

test('addDays moves forward and backward', () => {
  assert.equal(addDays('2026-08-24', 6), '2026-08-30');
  assert.equal(addDays('2026-08-24', -1), '2026-08-23');
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-10-18', 1), '2026-10-19');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('date arithmetic is anchored to UTC noon, not to local midnight', () => {
  // Asia/Tokyo is UTC+9, so local midnight falls on the PREVIOUS UTC date.
  // A local-midnight parseISO shifts every result back a day here; UTC-noon
  // anchoring does not. A negative-offset zone (e.g. America/Los_Angeles)
  // cannot detect this, and daysBetween cannot either — Math.round absorbs
  // any sub-half-day error. addDays and weekdayKey share parseISO, so these
  // assertions guard the anchor for the whole module.
  const exprs = [
    "addDays('2026-08-24', 0)",
    "addDays('2026-10-31', 2)",     // spans the 2026-11-01 US DST end
    "addDays('2027-03-13', 2)",     // spans the 2027-03-14 US DST start
    "weekdayKey('2026-08-24')",
    "weekdayKey('2026-11-01')"
  ];
  for (const expr of exprs) {
    assert.equal(inTZ('Asia/Tokyo', expr), inTZ('UTC', expr), expr);
    assert.equal(inTZ('Pacific/Kiritimati', expr), inTZ('UTC', expr), expr);
  }
});

test('daysBetween is signed', () => {
  assert.equal(daysBetween('2026-08-24', '2026-08-24'), 0);
  assert.equal(daysBetween('2026-08-25', '2026-08-24'), -1);
});

test('weekdayKey maps Monday-first', () => {
  assert.equal(weekdayKey('2026-08-24'), 'mon');
  assert.equal(weekdayKey('2026-08-30'), 'sun');
  assert.equal(weekdayKey('2027-06-05'), 'sat');
});

test('hoursSince measures elapsed hours against an explicit now', () => {
  const now = Date.parse('2026-08-26T12:00:00Z');
  assert.equal(hoursSince('2026-08-26T00:00:00Z', now), 12);
  assert.equal(hoursSince('2026-08-24T12:00:00Z', now), 48);
});

test('todayISO reports the local calendar date, not the UTC one', () => {
  // 2026-08-20 23:30 in Los Angeles is 2026-08-21 06:30 UTC.
  // A UTC-getter implementation returns 2026-08-21 here and fails.
  assert.equal(inTZ('America/Los_Angeles', 'todayISO(new Date(2026, 7, 20, 23, 30))'), '2026-08-20');
  assert.equal(inTZ('UTC', 'todayISO(new Date(2026, 7, 20, 23, 30))'), '2026-08-20');
});

test('ymOf takes the year-month prefix of an ISO date', () => {
  assert.equal(ymOf('2026-10-18'), '2026-10');
  assert.equal(ymOf('2027-01-01'), '2027-01');
});

test('addMonths rolls across year boundaries in both directions', () => {
  assert.equal(addMonths('2026-10', 1), '2026-11');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2027-01', -1), '2026-12');
  assert.equal(addMonths('2026-10', -10), '2025-12');
  assert.equal(addMonths('2026-10', 0), '2026-10');
});

test('monthLabel names the month and year', () => {
  assert.equal(monthLabel('2026-10'), 'October 2026');
  assert.equal(monthLabel('2027-06'), 'June 2027');
});

test('monthGrid lays a month out in Monday-first weeks of seven', () => {
  // 2026-10-01 is a Thursday, so Mon/Tue/Wed of the first row are blank.
  const rows = monthGrid('2026-10');
  assert.ok(rows.every(r => r.length === 7), 'every row holds exactly seven cells');
  assert.deepEqual(rows[0].slice(0, 3), [null, null, null]);
  assert.equal(rows[0][3], '2026-10-01');
  assert.equal(rows[0][6], '2026-10-04');
  assert.equal(rows.flat().filter(Boolean).length, 31);
  assert.equal(rows.flat().filter(Boolean).at(-1), '2026-10-31');
});

test('monthGrid gives a month starting on Sunday a full leading blank week', () => {
  // 2026-11-01 is a Sunday: it is the last cell of the first row.
  const rows = monthGrid('2026-11');
  assert.deepEqual(rows[0].slice(0, 6), [null, null, null, null, null, null]);
  assert.equal(rows[0][6], '2026-11-01');
  assert.equal(rows.flat().filter(Boolean).length, 30);
});

test('monthGrid counts the leap day', () => {
  const rows = monthGrid('2028-02');
  assert.equal(rows.flat().filter(Boolean).length, 29);
  assert.equal(rows.flat().filter(Boolean).at(-1), '2028-02-29');
  assert.equal(monthGrid('2026-02').flat().filter(Boolean).length, 28);
});

test('monthGrid pads only to the end of the last occupied week', () => {
  // 2027-02-01 is a Monday and February 2027 has 28 days: exactly four rows,
  // no trailing blanks at all.
  const rows = monthGrid('2027-02');
  assert.equal(rows.length, 4);
  assert.ok(rows.flat().every(Boolean), 'no padding cells in a month that fills its weeks');
});

test('monthGrid keeps dates contiguous across a DST transition', () => {
  // Europe/London springs forward on 2027-03-28; the grid must not skip or
  // repeat a day.
  const days = monthGrid('2027-03').flat().filter(Boolean);
  assert.equal(days.length, 31);
  for (let i = 1; i < days.length; i++) {
    assert.equal(addDays(days[i - 1], 1), days[i]);
  }
});
