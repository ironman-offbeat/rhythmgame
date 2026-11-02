import {
  BEAT_INTERVAL_OPTIONS,
  DEFAULT_CONFIG,
  type GameConfig,
} from './engine.ts';

export const PATTERNS_KEY = 'neon-pulse/custom-patterns/v1';
export const PATTERN_VERSION = 1;
export const BEATS_PER_SECTION = 16;
export const MAX_SECTIONS = 16;
export const MAX_NOTES = 512;
export const MAX_SAVED_PATTERNS = 40;

export interface CustomPattern {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  config: GameConfig;
  lengthBeats: number;
  beats: number[];
}

export interface PatternDraft {
  name: string;
  config: GameConfig;
  lengthBeats: number;
  beats: number[];
}

export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const validSpacing = new Set(BEAT_INTERVAL_OPTIONS.map((item) => item.value));
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function validateGameConfig(value: unknown): GameConfig | null {
  if (!isObject(value)) return null;
  const { bpm, beatsPerNote, durationMs, bandWidth } = value;
  if (
    typeof bpm !== 'number' || !Number.isInteger(bpm) || bpm < 60 || bpm > 180 ||
    typeof beatsPerNote !== 'number' || !validSpacing.has(beatsPerNote) ||
    typeof durationMs !== 'number' || !Number.isInteger(durationMs) || durationMs < 1200 || durationMs > 2200 ||
    typeof bandWidth !== 'number' || !Number.isInteger(bandWidth) || bandWidth < 20 || bandWidth > 36
  ) return null;
  return { bpm, beatsPerNote, durationMs, bandWidth };
}

export function normalizeBeats(value: unknown, lengthBeats: number): number[] | null {
  if (!Array.isArray(value) || value.length > MAX_NOTES) return null;
  const beats = new Set<number>();
  for (const beat of value) {
    if (
      typeof beat !== 'number' || !Number.isFinite(beat) ||
      beat < 0 || beat >= lengthBeats ||
      !Number.isInteger(beat * 4)
    ) return null;
    beats.add(beat);
  }
  return Array.from(beats).sort((a, b) => a - b);
}

export function validatePattern(value: unknown): CustomPattern | null {
  if (!isObject(value) || value.version !== PATTERN_VERSION) return null;
  const { id, name, createdAt, updatedAt, config, lengthBeats, beats } = value;
  if (
    typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) ||
    typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 40 ||
    typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt)) ||
    typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt)) ||
    typeof lengthBeats !== 'number' || !Number.isInteger(lengthBeats) ||
    lengthBeats % BEATS_PER_SECTION !== 0 ||
    lengthBeats < BEATS_PER_SECTION || lengthBeats > BEATS_PER_SECTION * MAX_SECTIONS
  ) return null;
  const cleanConfig = validateGameConfig(config);
  const cleanBeats = normalizeBeats(beats, lengthBeats);
  if (!cleanConfig || !cleanBeats) return null;
  return {
    version: PATTERN_VERSION,
    id,
    name: name.trim(),
    createdAt,
    updatedAt,
    config: cleanConfig,
    lengthBeats,
    beats: cleanBeats,
  };
}

export function readPatterns(storage: StoragePort): CustomPattern[] {
  try {
    const value = storage.getItem(PATTERNS_KEY);
    if (!value || value.length > 2_000_000) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_SAVED_PATTERNS).map(validatePattern).filter((pattern): pattern is CustomPattern => pattern !== null);
  } catch {
    return [];
  }
}

export function persistPatterns(storage: StoragePort, patterns: readonly CustomPattern[]): boolean {
  try {
    storage.setItem(PATTERNS_KEY, JSON.stringify(patterns));
    return true;
  } catch {
    return false;
  }
}

export function toggleBeat(beats: readonly number[], beat: number, lengthBeats: number): number[] {
  if (beat < 0 || beat >= lengthBeats || !Number.isInteger(beat * 4)) return [...beats];
  if (beats.includes(beat)) return beats.filter((value) => value !== beat);
  if (beats.length >= MAX_NOTES) return [...beats];
  return [...beats, beat].sort((a, b) => a - b);
}

export function fillAtInterval(beats: readonly number[], lengthBeats: number, interval: number): number[] {
  if (!validSpacing.has(interval)) return [...beats];
  const result = new Set(beats);
  for (let index = 0; index * interval < lengthBeats && result.size < MAX_NOTES; index += 1) {
    result.add(Number((index * interval).toFixed(2)));
  }
  return [...result].sort((a, b) => a - b);
}

export function createPattern(draft: PatternDraft, id: string, now: string, original?: CustomPattern): CustomPattern | null {
  return validatePattern({
    version: PATTERN_VERSION,
    id,
    name: draft.name,
    createdAt: original?.createdAt ?? now,
    updatedAt: now,
    config: draft.config,
    lengthBeats: draft.lengthBeats,
    beats: draft.beats,
  });
}

export const EMPTY_DRAFT: PatternDraft = {
  name: '새 패턴',
  config: { ...DEFAULT_CONFIG },
  lengthBeats: BEATS_PER_SECTION * 2,
  beats: [],
};
