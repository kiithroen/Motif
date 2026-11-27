import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../src/core/model';
import {
  addPianoRollNote,
  clampGroupDelta,
  computeMaxResizeDuration,
  copyPianoRollNotes,
  deletePianoRollNote,
  deletePianoRollNotes,
  duplicatePianoRollNotes,
  movePianoRollNote,
  movePianoRollNotes,
  normalizeMelodyNotes,
  pastePianoRollNotes,
  resizePianoRollNote,
  selectNotesInMarquee,
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

  it('copies selected notes into relative offsets and returns null when empty', () => {
    expect(copyPianoRollNotes(sampleNotes(), new Set())).toBeNull();
    expect(copyPianoRollNotes(sampleNotes(), new Set(['missing']))).toBeNull();

    const clip = copyPianoRollNotes(sampleNotes(), new Set(['n3', 'n1']));
    expect(clip).toEqual({
      items: [
        { offsetStep: 0, midi: 64, duration: 4, velocity: 0.8 },
        { offsetStep: 16, midi: 72, duration: 4, velocity: 0.8 },
      ],
      spanSteps: 20,
      sourceStartStep: 0,
      sourceEndStep: 20,
    });
  });

  it('deletes multiple selected notes at once', () => {
    const remaining = deletePianoRollNotes(sampleNotes(), new Set(['n1', 'n3']));
    expect(remaining.map((n) => n.id)).toEqual(['n2']);

    const unchanged = deletePianoRollNotes(sampleNotes(), new Set());
    expect(unchanged).toEqual(sampleNotes());
  });

  it('clamps group delta and moves multiple notes while preserving relative intervals', () => {
    const notes = sampleNotes();
    // n1(step 0, midi 64), n3(step 16, midi 72)
    const clamped = clampGroupDelta(notes, new Set(['n1', 'n3']), 25, 20, 32, BOUNDS);
    // stepHi = 31 - 16 = 15, midiHi = 84 - 72 = 12
    expect(clamped).toEqual({ deltaStep: 15, deltaMidi: 12 });

    // n1(0->8) 과 n2(8) 충돌 시 비선택 n2 를 덮어쓴다.
    const moved = movePianoRollNotes(notes, new Set(['n1', 'n3']), 8, 2, 32, BOUNDS);
    expect(moved.some((n) => n.id === 'n2')).toBe(false);
    expect(moved.find((n) => n.id === 'n1')).toMatchObject({ step: 8, midi: 66, origin: 'user' });
    expect(moved.find((n) => n.id === 'n3')).toMatchObject({ step: 24, midi: 74, origin: 'user' });

    // 경계에서 더 이상 이동할 수 없으면 원본을 그대로 유지한다.
    const edgeNotes: NoteEvent[] = [{ id: 'edge', midi: 60, step: 0, duration: 4, velocity: 0.8, origin: 'base' }];
    const atEdge = movePianoRollNotes(edgeNotes, new Set(['edge']), -4, -10, 32, BOUNDS);
    expect(atEdge).toEqual(edgeNotes);
  });

  it('pastes and duplicates motifs within bounds and skips out-of-range items', () => {
    const notes = sampleNotes();
    const clip = copyPianoRollNotes(notes, new Set(['n1', 'n2']))!;

    const pasted = pastePianoRollNotes(notes, clip, 20, 32, BOUNDS, 'p', 12);
    expect(pasted.pastedIds).toEqual(['p_0', 'p_1']);
    expect(pasted.endStep).toBe(32);
    expect(pasted.notes.find((n) => n.id === 'p_0')).toMatchObject({ step: 20, midi: 76, origin: 'user' });
    expect(pasted.notes.find((n) => n.id === 'p_1')).toMatchObject({ step: 28, midi: 79, origin: 'user' });

    // 두 번째 음표(offsetStep 8 -> step 36)가 totalSteps 32 를 벗어나면 건너뛴다.
    const clipped = pastePianoRollNotes(notes, clip, 28, 32, BOUNDS, 'c');
    expect(clipped.pastedIds).toEqual(['c_0']);
    expect(clipped.notes.find((n) => n.id === 'c_0')).toMatchObject({ step: 28, duration: 4 });

    // duplicatePianoRollNotes 는 선택 구간 바로 뒤(sourceEndStep = 12)에 복제한다.
    const dup = duplicatePianoRollNotes(notes, new Set(['n1', 'n2']), 32, BOUNDS, 'd');
    expect(dup.pastedIds).toEqual(['d_0', 'd_1']);
    expect(dup.notes.find((n) => n.id === 'd_0')).toMatchObject({ step: 12, midi: 64 });
    expect(dup.notes.find((n) => n.id === 'd_1')).toMatchObject({ step: 20, midi: 67 });
    // step 16 에 있던 기존 n3 은 앞의 d_0(step 12, dur 4)과 겹치지 않지만 유지된다.
    expect(dup.notes.some((n) => n.id === 'n3')).toBe(true);
  });

  it('selects notes overlapping a marquee rectangle', () => {
    const notes = sampleNotes();
    // n1: step 0..3 midi 64, n2: step 8..11 midi 67, n3: step 16..19 midi 72
    expect(selectNotesInMarquee(notes, 3, 9, 64, 67)).toEqual(['n1', 'n2']);
    expect(selectNotesInMarquee(notes, 19, 17, 75, 70)).toEqual(['n3']);
    expect(selectNotesInMarquee(notes, 4, 7, 60, 84)).toEqual([]);
  });
});
