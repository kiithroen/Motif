import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../src/core/model';
import {
  addPianoRollNote,
  computeMaxResizeDuration,
  deletePianoRollNote,
  movePianoRollNote,
  normalizeMelodyNotes,
  resizePianoRollNote,
} from '../src/core/pianoRollOps';

const BOUNDS = { minMidi: 60, maxMidi: 84 };

function sampleNotes(): NoteEvent[] {
  return [
    { id: 'n1', midi: 64, step: 0, duration: 4, velocity: 0.8, origin: 'base' },
    { id: 'n2', midi: 67, step: 8, duration: 4, velocity: 0.8, origin: 'base' },
    { id: 'n3', midi: 72, step: 16, duration: 4, velocity: 0.8, origin: 'base' },
  ];
}

describe('pianoRollOps', () => {
  it('adds notes, clamps bounds, replaces same-step notes, and trims overlaps', () => {
    const base = sampleNotes();
    const added = addPianoRollNote(base, {
      id: 'u1',
      midi: 90,
      step: 6,
      duration: 6,
      totalSteps: 32,
      bounds: BOUNDS,
    });
    const inserted = added.find((n) => n.id === 'u1');
    expect(inserted).toBeDefined();
    expect(inserted?.midi).toBe(84);
    expect(inserted?.duration).toBe(2); // step 8 의 n2 직전까지 트리밍
    expect(inserted?.origin).toBe('user');

    const replaced = addPianoRollNote(base, {
      id: 'u2',
      midi: 60,
      step: 8,
      duration: 2,
      totalSteps: 32,
      bounds: BOUNDS,
    });
    expect(replaced.some((n) => n.id === 'n2')).toBe(false);
    expect(replaced.find((n) => n.id === 'u2')?.step).toBe(8);
  });

  it('deletes only the targeted note by id', () => {
    const after = deletePianoRollNote(sampleNotes(), 'n2');
    expect(after.map((n) => n.id)).toEqual(['n1', 'n3']);
  });

  it('moves a note in time and pitch, marks user origin, clamps, and resolves collisions', () => {
    const moved = movePianoRollNote(sampleNotes(), 'n1', 10, 69, 32, BOUNDS);
    const n1 = moved.find((n) => n.id === 'n1');
    const n2 = moved.find((n) => n.id === 'n2');
    expect(n1).toMatchObject({ step: 10, midi: 69, duration: 4, origin: 'user' });
    expect(n2?.duration).toBe(2); // step 8 -> step 10 직전까지 트리밍

    // 목적지 스텝에 이미 있는 음표를 덮어쓴다.
    const overwritten = movePianoRollNote(sampleNotes(), 'n1', 8, 65, 32, BOUNDS);
    expect(overwritten.some((n) => n.id === 'n2')).toBe(false);
    expect(overwritten.find((n) => n.id === 'n1')).toMatchObject({ step: 8, midi: 65 });

    // 범위를 벗어나면 클램핑한다.
    const clamped = movePianoRollNote(sampleNotes(), 'n3', 40, 50, 32, BOUNDS);
    expect(clamped.find((n) => n.id === 'n3')).toMatchObject({ step: 31, midi: 60, duration: 1 });

    // 없는 ID 는 원본 구조를 그대로 유지한다.
    const unchanged = movePianoRollNote(sampleNotes(), 'missing', 4, 70, 32, BOUNDS);
    expect(unchanged).toEqual(sampleNotes());
  });

  it('resizes note duration within [1, nextNoteStep - step] and totalSteps bounds', () => {
    const notes = sampleNotes();
    expect(computeMaxResizeDuration(notes, 'n1', 32)).toBe(8);
    expect(computeMaxResizeDuration(notes, 'n3', 32)).toBe(16);

    const lengthened = resizePianoRollNote(notes, 'n1', 12, 32);
    expect(lengthened.find((n) => n.id === 'n1')).toMatchObject({ duration: 8, origin: 'user' });
    expect(lengthened.find((n) => n.id === 'n2')?.step).toBe(8);

    const shortened = resizePianoRollNote(notes, 'n2', 0, 32);
    expect(shortened.find((n) => n.id === 'n2')?.duration).toBe(1);

    const endExtended = resizePianoRollNote(notes, 'n3', 99, 32);
    expect(endExtended.find((n) => n.id === 'n3')?.duration).toBe(16);
  });

  it('normalizes unsorted notes and prevents overlap', () => {
    const raw: NoteEvent[] = [
      { id: 'b', midi: 67, step: 6, duration: 4, velocity: 0.8 },
      { id: 'a', midi: 64, step: 2, duration: 8, velocity: 0.8 },
    ];
    const norm = normalizeMelodyNotes(raw, 16);
    expect(norm.map((n) => n.id)).toEqual(['a', 'b']);
    expect(norm[0].duration).toBe(4);
    expect(norm[1].duration).toBe(4);
  });
});
