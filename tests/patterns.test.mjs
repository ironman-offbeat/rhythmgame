import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BEATS_PER_SECTION,
  EMPTY_DRAFT,
  MAX_NOTES,
  MAX_SECTIONS,
  PATTERNS_KEY,
  createPattern,
  fillAtInterval,
  normalizeBeats,
  persistPatterns,
  readPatterns,
  toggleBeat,
  validatePattern,
} from '../src/game/patterns.ts';

const timestamp = '2026-11-02T14:30:00.000Z';
const example = () => createPattern({
  name: 'Custom Neon Track',
  lengthBeats: 32,
  beats: [0, 4.25, 12, 20, 28.5],
  config: { bpm: 135, beatsPerNote: 3, durationMs: 1700, bandWidth: 26 },
}, 'pattern_testing_1', timestamp);

function memoryStorage(initial = '') {
  let data = initial;
  return {
    getItem(key) { assert.equal(key, PATTERNS_KEY); return data || null; },
    setItem(key, text) { assert.equal(key, PATTERNS_KEY); data = text; },
  };
}

test('custom pattern includes the user settings and preserves custom beat positions', () => {
  const pattern = example();
  assert.ok(pattern);
  assert.equal(pattern.version, 1);
  assert.deepEqual(pattern.beats, [0, 4.25, 12, 20, 28.5]);
  assert.deepEqual(pattern.config, { bpm: 135, beatsPerNote: 3, durationMs: 1700, bandWidth: 26 });
  assert.equal(pattern.lengthBeats, 32);
});

test('save then load round trips a custom chart without changing settings', () => {
  const storage = memoryStorage();
  const pattern = example();
  assert.equal(persistPatterns(storage, [pattern]), true);
  assert.deepEqual(readPatterns(storage), [pattern]);
});

test('storage exceptions and corrupt data do not crash the editor', () => {
  const brokenStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(readPatterns(brokenStorage), []);
  assert.equal(persistPatterns(brokenStorage, [example()]), false);
  assert.deepEqual(readPatterns(memoryStorage('{broken json')), []);
  assert.deepEqual(readPatterns(memoryStorage('{"a":1}')), []);
});

test('import rejects invalid metadata, unsafe configs, or out-of-range notes', () => {
  const original = example();
  assert.equal(validatePattern({ ...original, config: { ...original.config, bpm: 9999 } }), null);
  assert.equal(validatePattern({ ...original, lengthBeats: BEATS_PER_SECTION * MAX_SECTIONS + 16 }), null);
  assert.equal(validatePattern({ ...original, beats: [32] }), null);
  assert.equal(validatePattern({ ...original, beats: [1 / 3] }), null);
  assert.equal(validatePattern({ ...original, name: '<'.repeat(41) }), null);
  assert.equal(validatePattern({ ...original, version: 2 }), null);
  assert.deepEqual(normalizeBeats([1.25, 0, 1.25, 4], 16), [0, 1.25, 4]);
});

test('click toggles quarter notes and cannot add beyond bounds or the max', () => {
  assert.deepEqual(toggleBeat([], 2.25, 16), [2.25]);
  assert.deepEqual(toggleBeat([2.25], 2.25, 16), []);
  assert.deepEqual(toggleBeat([2], 16, 16), [2]);
  assert.deepEqual(toggleBeat([2], 1.111, 16), [2]);
  const full = Array.from({ length: MAX_NOTES }, (_, index) => index / 4);
  assert.equal(toggleBeat(full, 130, 256).length, MAX_NOTES);
});

test('auto fill respects saved beat interval and manual notes', () => {
  assert.deepEqual(fillAtInterval([3.25], 16, 4), [0, 3.25, 4, 8, 12]);
  assert.deepEqual(fillAtInterval([], 2, 0.25), [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75]);
  assert.deepEqual(fillAtInterval([0.5], 16, 16), [0, 0.5]);
  assert.equal(fillAtInterval([], 256, 0.25).length, MAX_NOTES);
});

test('save keeps the same record id and original created date when editing', () => {
  const first = example();
  const newer = createPattern({ ...EMPTY_DRAFT, name: 'Renamed', beats: [2] }, first.id, '2026-11-03T00:00:00.000Z', first);
  assert.equal(newer.id, first.id);
  assert.equal(newer.createdAt, first.createdAt);
  assert.equal(newer.name, 'Renamed');
  assert.equal(newer.updatedAt, '2026-11-03T00:00:00.000Z');
});
