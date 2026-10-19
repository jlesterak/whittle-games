// frameStats is what both the phone overlay (?fps) and smoke --perf report, so its maths must be right.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameStats } from '../core/fps.js';

test('steady 60 Hz frames read 60 fps at the median and the slow end', () => {
  const s = frameStats(Array(100).fill(1000 / 60));
  assert.equal(Math.round(s.median), 60);
  assert.equal(Math.round(s.p95), 60);
});

test('the slow end comes from the 95th percentile interval, the median from the middle one', () => {
  // 90 frames at 60 Hz, 10 frames at 20 Hz: the median stays 60, the slowest 5 % are 20
  const s = frameStats([...Array(90).fill(1000 / 60), ...Array(10).fill(50)]);
  assert.equal(Math.round(s.median), 60);
  assert.equal(Math.round(s.p95), 20);
});

test('no frames gives zeros, not NaN', () => {
  assert.deepEqual(frameStats([]), { median: 0, p95: 0 });
});
