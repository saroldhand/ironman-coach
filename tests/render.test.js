import test from 'node:test';
import assert from 'node:assert/strict';
import { prescribedText } from '../assets/render.js';

test('prescribedText formats distances in metres with thousands separators', () => {
  assert.equal(prescribedText({ metric: 'distance', value: 2000, unit: 'm' }), '2,000 m');
  assert.equal(prescribedText({ metric: 'distance', value: 1300, unit: 'm' }), '1,300 m');
});

test('prescribedText formats durations in minutes', () => {
  assert.equal(prescribedText({ metric: 'duration', value: 45, unit: 'min' }), '45 min');
  assert.equal(prescribedText({ metric: 'duration', value: 135, unit: 'min' }), '135 min');
});
