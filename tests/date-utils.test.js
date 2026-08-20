import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysBetween, weekdayKey, todayISO, hoursSince } from '../assets/date-utils.js';
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
