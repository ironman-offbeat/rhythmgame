import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BEAT_INTERVAL_OPTIONS,
  DEFAULT_CONFIG,
  GEOMETRY,
  RhythmEngine,
  judgeWindow,
  noteIntervalMs,
} from '../src/game/engine.ts';

const config = { ...DEFAULT_CONFIG };
const window = judgeWindow(GEOMETRY.leadInMs, config);
const createGame = () => {
  const game = new RhythmEngine();
  game.start(0, config);
  game.tick(GEOMETRY.leadInMs);
  return game;
};

test('default note spacing is exactly 16 beats', () => {
  assert.equal(noteIntervalMs(config), 8000);
  assert.equal(noteIntervalMs({ ...config, beatsPerNote: 0.25 }), 125);
});

test('setting provides each whole-beat spacing from 1 through 16', () => {
  const expected = Array.from({ length: 16 }, (_, index) => index + 1);
  assert.deepEqual(BEAT_INTERVAL_OPTIONS.slice(0, 16).map((entry) => entry.value), expected);
  assert.equal(BEAT_INTERVAL_OPTIONS.at(-1)?.value, 0.25);
  for (const beats of expected) {
    assert.equal(noteIntervalMs({ ...config, beatsPerNote: beats }), 500 * beats);
  }
});

test('note crosses the full judgement band and fades away within one second', () => {
  assert.ok(window.start < window.end);
  assert.ok(GEOMETRY.leadInMs + config.durationMs - window.start <= 1000);
});

test('press and release inside the band awards exactly 1 point', () => {
  const game = createGame();
  game.press(window.start + 12);
  game.release(window.end - 12);
  assert.deepEqual([game.snapshot(window.end).score, game.snapshot(window.end).good], [1, 1]);
  assert.equal(game.drainEvents()[0].kind, 'GOOD');
  game.press(window.end + 5);
  game.release(window.end + 8);
  assert.equal(game.snapshot(window.end + 8).score, 1);
});

test('early press is BAD even if release occurs during the band', () => {
  const game = createGame();
  game.press(window.start - 10);
  game.release(window.start + 10);
  assert.equal(game.snapshot(window.start + 10).bad, 1);
  assert.equal(game.snapshot(window.start + 10).score, 0);
  assert.equal(game.drainEvents()[0].reason, 'EARLY');
});

test('holding beyond the inner boundary is BAD', () => {
  const game = createGame();
  game.press(window.start + 10);
  game.tick(window.end + 5);
  game.release(window.end + 7);
  assert.equal(game.snapshot(window.end + 7).bad, 1);
  assert.equal(game.snapshot(window.end + 7).score, 0);
  assert.equal(game.drainEvents()[0].reason, 'HELD_TOO_LONG');
});

test('not pressing before the judgement window ends is BAD', () => {
  const game = createGame();
  game.tick(window.end + 1);
  assert.equal(game.snapshot(window.end + 1).bad, 1);
  assert.equal(game.drainEvents()[0].reason, 'MISSED');
});

test('double press while held cannot award multiple points', () => {
  const game = createGame();
  game.press(window.start + 10);
  game.press(window.start + 30);
  game.release(window.end - 10);
  assert.equal(game.snapshot(window.end - 10).score, 1);
  assert.equal(game.drainEvents().length, 1);
});

test('pause freezes timing and clears any held state', () => {
  const game = createGame();
  game.pause(window.start - 20);
  assert.equal(game.snapshot(90_000).elapsed, window.start - 20);
  game.resume(90_000);
  game.press(90_000 + 30);
  game.release(90_000 + 60);
  assert.equal(game.snapshot(90_000 + 60).score, 1);
});

test('notes are scheduled against absolute beats and never score when unplayed', () => {
  const game = createGame();
  const nextSpawn = GEOMETRY.leadInMs + noteIntervalMs(config);
  game.tick(nextSpawn);
  assert.equal(game.snapshot(nextSpawn).notes.at(-1)?.spawnAt, nextSpawn);
  game.tick(nextSpawn + config.durationMs + 1);
  assert.equal(game.snapshot(nextSpawn + config.durationMs + 1).bad, 2);
});

test('custom schedule spawns circles only at user-selected beats', () => {
  const game = new RhythmEngine();
  const configCustom = { ...config, bpm: 120, beatsPerNote: 16 };
  game.start(0, configCustom, [0, 2, 7]);
  assert.deepEqual([game.snapshot(0).mode, game.snapshot(0).totalNotes], ['custom', 3]);
  const start = GEOMETRY.leadInMs;
  game.tick(start);
  assert.deepEqual(game.snapshot(start).notes.map((note) => note.spawnAt), [start]);
  game.tick(start + 1000);
  assert.deepEqual(game.snapshot(start + 1000).notes.map((note) => note.spawnAt), [start, start + 1000]);
  game.tick(start + 3500);
  assert.equal(game.snapshot(start + 3500).notes.at(-1)?.spawnAt, start + 3500);
  assert.equal(game.snapshot(start + 3500).hasNextNote, false);
});

test('custom chart finishes after its final circle, with no endlessly repeating notes', () => {
  const game = new RhythmEngine();
  game.start(0, config, [0, 4]);
  const lastSpawn = GEOMETRY.leadInMs + 2000;
  game.tick(lastSpawn + config.durationMs + 241);
  const result = game.snapshot(lastSpawn + config.durationMs + 5000);
  assert.equal(result.phase, 'finished');
  assert.equal(result.totalNotes, 2);
  assert.equal(result.bad, 2);
  assert.equal(result.good, 0);
  assert.equal(result.score, 0);
  assert.equal(result.elapsed, lastSpawn + config.durationMs + 240);
  game.tick(lastSpawn + 99999);
  assert.equal(game.snapshot(lastSpawn + 99999).bad, 2);
  game.start(lastSpawn + 100000, config, [1]);
  assert.equal(game.snapshot(lastSpawn + 100000).phase, 'playing');
  assert.equal(game.snapshot(lastSpawn + 100000).totalNotes, 1);
  assert.equal(game.snapshot(lastSpawn + 100000).bad, 0);
});

test('custom chart supports quarter beat timings and pause/resume', () => {
  const game = new RhythmEngine();
  game.start(0, config, [0.25, 1.75]);
  game.tick(GEOMETRY.leadInMs + 125);
  assert.equal(game.snapshot(550).notes[0].spawnAt, GEOMETRY.leadInMs + 125);
  game.pause(600);
  assert.equal(game.snapshot(99999).elapsed, 600);
  game.resume(2000);
  game.tick(2000 + 745);
  assert.equal(game.snapshot(2745).notes[1].spawnAt, GEOMETRY.leadInMs + 875);
});

test('custom chart GOOD judgement matches existing endless rules', () => {
  const game = new RhythmEngine();
  game.start(0, config, [2]);
  const check = judgeWindow(GEOMETRY.leadInMs + 1000, config);
  game.press(check.start + 5);
  game.release(check.end - 5);
  assert.deepEqual([game.snapshot(check.end).score, game.snapshot(check.end).good], [1, 1]);
});
