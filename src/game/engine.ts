export type Phase = 'ready' | 'playing' | 'paused';
export type NoteStatus = 'pending' | 'holding' | 'good' | 'bad';
export type JudgeKind = 'GOOD' | 'BAD';
export type FailReason = 'EARLY' | 'MISSED' | 'HELD_TOO_LONG';

export interface GameConfig {
  bpm: number;
  beatsPerNote: number;
  durationMs: number;
  bandWidth: number;
}

export interface RhythmNote {
  id: number;
  spawnAt: number;
  status: NoteStatus;
  pressedAt?: number;
  judgedAt?: number;
}

export interface JudgeEvent {
  id: number;
  noteId: number;
  kind: JudgeKind;
  at: number;
  reason?: FailReason;
}

export interface GameSnapshot {
  phase: Phase;
  elapsed: number;
  notes: readonly RhythmNote[];
  nextNoteIn: number;
  score: number;
  good: number;
  bad: number;
  combo: number;
  bestCombo: number;
  pressing: boolean;
  holding: boolean;
}

// Keep the existing quarter-beat option while allowing every whole-beat spacing.
export const BEAT_INTERVAL_OPTIONS = [
  ...Array.from({ length: 16 }, (_, index) => ({
    value: index + 1,
    label: `${index + 1}박자${index === 15 ? ' (기본)' : ''}`,
  })),
  { value: 0.25, label: '16분음표 (0.25박)' },
];

export const DEFAULT_CONFIG: GameConfig = {
  bpm: 120,
  beatsPerNote: 16,
  durationMs: 1900,
  bandWidth: 30,
};

export const GEOMETRY = {
  startRadius: 248,
  endRadius: 92,
  targetRadius: 145,
  leadInMs: 420,
} as const;

export function noteIntervalMs(config: GameConfig): number {
  return (60_000 / config.bpm) * config.beatsPerNote;
}

export function judgeWindow(spawnAt: number, config: GameConfig) {
  const travel = GEOMETRY.startRadius - GEOMETRY.endRadius;
  const outer = GEOMETRY.targetRadius + config.bandWidth / 2;
  const inner = GEOMETRY.targetRadius - config.bandWidth / 2;
  return {
    start: spawnAt + ((GEOMETRY.startRadius - outer) / travel) * config.durationMs,
    end: spawnAt + ((GEOMETRY.startRadius - inner) / travel) * config.durationMs,
  };
}

export function noteProgress(note: RhythmNote, elapsed: number, config: GameConfig): number {
  return Math.max(0, Math.min(1, (elapsed - note.spawnAt) / config.durationMs));
}

export class RhythmEngine {
  private phase: Phase = 'ready';
  private config: GameConfig = { ...DEFAULT_CONFIG };
  private startedAt = 0;
  private pausedAt = 0;
  private pausedTotal = 0;
  private nextSpawnAt = GEOMETRY.leadInMs;
  private nextNoteId = 1;
  private nextEventId = 1;
  private notes: RhythmNote[] = [];
  private events: JudgeEvent[] = [];
  private physicalDown = false;
  private heldNoteId: number | null = null;
  private score = 0;
  private good = 0;
  private bad = 0;
  private combo = 0;
  private bestCombo = 0;

  getPhase(): Phase {
    return this.phase;
  }

  start(now: number, config: GameConfig = DEFAULT_CONFIG): void {
    this.reset();
    this.config = { ...config };
    this.startedAt = now;
    this.phase = 'playing';
  }

  reset(): void {
    this.phase = 'ready';
    this.startedAt = 0;
    this.pausedAt = 0;
    this.pausedTotal = 0;
    this.nextSpawnAt = GEOMETRY.leadInMs;
    this.nextNoteId = 1;
    this.nextEventId = 1;
    this.notes = [];
    this.events = [];
    this.physicalDown = false;
    this.heldNoteId = null;
    this.score = 0;
    this.good = 0;
    this.bad = 0;
    this.combo = 0;
    this.bestCombo = 0;
  }

  pause(now: number): void {
    if (this.phase !== 'playing') return;
    this.tick(now);
    this.pausedAt = now;
    this.phase = 'paused';
    // A held input must not carry through a pause.
    const held = this.notes.find((note) => note.id === this.heldNoteId);
    if (held?.status === 'holding') {
      held.status = 'pending';
      held.pressedAt = undefined;
    }
    this.physicalDown = false;
    this.heldNoteId = null;
  }

  resume(now: number): void {
    if (this.phase !== 'paused') return;
    this.pausedTotal += now - this.pausedAt;
    this.pausedAt = 0;
    this.phase = 'playing';
  }

  getElapsed(now: number): number {
    if (this.phase === 'ready') return 0;
    const time = this.phase === 'paused' ? this.pausedAt : now;
    return Math.max(0, time - this.startedAt - this.pausedTotal);
  }

  private finish(note: RhythmNote, kind: JudgeKind, at: number, reason?: FailReason): void {
    if (note.status === 'good' || note.status === 'bad') return;
    note.status = kind === 'GOOD' ? 'good' : 'bad';
    note.judgedAt = at;
    if (this.heldNoteId === note.id) this.heldNoteId = null;
    if (kind === 'GOOD') {
      this.score += 1;
      this.good += 1;
      this.combo += 1;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
    } else {
      this.bad += 1;
      this.combo = 0;
    }
    this.events.push({ id: this.nextEventId++, noteId: note.id, kind, at, reason });
  }

  tick(now: number): void {
    if (this.phase !== 'playing') return;
    const elapsed = this.getElapsed(now);
    const spacing = noteIntervalMs(this.config);
    // A guard prevents runaway catch-up work after a severely suspended tab.
    let spawned = 0;
    while (elapsed >= this.nextSpawnAt && spawned < 256) {
      this.notes.push({ id: this.nextNoteId++, spawnAt: this.nextSpawnAt, status: 'pending' });
      this.nextSpawnAt += spacing;
      spawned += 1;
    }
    if (spawned === 256 && elapsed >= this.nextSpawnAt) {
      this.nextSpawnAt += Math.ceil((elapsed - this.nextSpawnAt) / spacing + 1) * spacing;
    }
    for (const note of this.notes) {
      if (note.status !== 'pending' && note.status !== 'holding') continue;
      const window = judgeWindow(note.spawnAt, this.config);
      if (elapsed >= window.end) {
        this.finish(note, 'BAD', window.end, note.status === 'holding' ? 'HELD_TOO_LONG' : 'MISSED');
      }
    }
    this.notes = this.notes.filter((note) => elapsed <= note.spawnAt + this.config.durationMs + 140);
  }

  press(now: number): void {
    if (this.phase !== 'playing' || this.physicalDown) return;
    this.tick(now);
    this.physicalDown = true;
    const elapsed = this.getElapsed(now);
    const available = this.notes
      .filter((note) => note.status === 'pending')
      .map((note) => ({ note, window: judgeWindow(note.spawnAt, this.config) }));
    const valid = available
      .filter(({ window }) => elapsed >= window.start && elapsed < window.end)
      .sort((a, b) => a.window.end - b.window.end)[0];
    if (valid) {
      valid.note.status = 'holding';
      valid.note.pressedAt = elapsed;
      this.heldNoteId = valid.note.id;
      return;
    }
    // An early press invalidates the closest upcoming unjudged note.
    const early = available
      .filter(({ window }) => elapsed < window.start)
      .sort((a, b) => a.window.start - b.window.start)[0];
    if (early) this.finish(early.note, 'BAD', elapsed, 'EARLY');
  }

  release(now: number): void {
    if (!this.physicalDown) return;
    this.physicalDown = false;
    if (this.phase !== 'playing') {
      this.heldNoteId = null;
      return;
    }
    this.tick(now);
    const elapsed = this.getElapsed(now);
    const held = this.notes.find((note) => note.id === this.heldNoteId);
    this.heldNoteId = null;
    if (!held || held.status !== 'holding') return;
    const window = judgeWindow(held.spawnAt, this.config);
    if (elapsed >= window.start && elapsed < window.end) {
      this.finish(held, 'GOOD', elapsed);
    } else {
      this.finish(held, 'BAD', elapsed, 'HELD_TOO_LONG');
    }
  }

  drainEvents(): JudgeEvent[] {
    const result = this.events;
    this.events = [];
    return result;
  }

  snapshot(now: number): GameSnapshot {
    const elapsed = this.getElapsed(now);
    return {
      phase: this.phase,
      elapsed,
      notes: this.notes,
      nextNoteIn: Math.max(0, this.nextSpawnAt - elapsed),
      score: this.score,
      good: this.good,
      bad: this.bad,
      combo: this.combo,
      bestCombo: this.bestCombo,
      pressing: this.physicalDown,
      holding: this.heldNoteId !== null,
    };
  }
}
