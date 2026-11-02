import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
