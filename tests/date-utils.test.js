import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysBetween, weekdayKey, todayISO, hoursSince } from '../assets/date-utils.js';

test('addDays moves forward and backward', () => {
  assert.equal(addDays('2026-08-24', 6), '2026-08-30');
  assert.equal(addDays('2026-08-24', -1), '2026-08-23');
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-10-18', 1), '2026-10-19');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('daysBetween is unaffected by daylight saving', () => {
  // US DST ends 2026-11-01. A naive local-midnight implementation returns 2.04 here.
  assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2);
  assert.equal(daysBetween('2027-03-13', '2027-03-15'), 2);
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

test('todayISO returns a well-formed local calendar date', () => {
  const iso = todayISO();
  assert.match(iso, /^\d{4}-\d{2}-\d{2}$/);
  // Must agree with the local clock, not UTC — a UTC-derived date is off by one
  // for several hours a day in US timezones.
  const now = new Date();
  const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  assert.equal(iso, expected);
});
