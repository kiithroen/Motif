import type { CompiledSong } from './compiler';
import type { DrumEvent, NoteEvent } from './model';
import { noteName } from './theory';

export interface ChordBarChange {
  bar: number;
  beforeSymbol: string;
  afterSymbol: string;
}

export interface SongVisualDiff {
  label?: string;
  mode: 'applied' | 'preview';
  addedMelodyIds: Set<string>;
  changedMelodyIds: Set<string>;
  removedMelodyNotes: NoteEvent[];
  chordChanges: ChordBarChange[];
  changedChordBars: Set<number>;
  changedAccompBars: Set<number>;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  velocityChangedCount: number;
  summaryText: string;
  hasAnyChange: boolean;
}

function getBarChordLabel(compiled: CompiledSong, bar: number): string {
  const main = compiled.resolvedChords[bar]?.symbol ?? '';
  const half = compiled.resolvedHalfChords?.[bar]?.symbol ?? '';
  return half ? `${main} → ${half}` : main;
}

function noteSignature(n: NoteEvent): string {
  return `${n.step}:${n.midi}:${n.duration}`;
}

function barNotesSignature(notes: readonly NoteEvent[], bar: number): string {
  const start = bar * 16;
  const end = start + 16;
  return notes
    .filter((n) => n.step >= start && n.step < end)
    .map((n) => `${n.step}:${n.midi}:${n.duration}:${Math.round(n.velocity * 100)}`)
    .sort()
    .join('|');
}

function barDrumsSignature(drums: readonly DrumEvent[], bar: number): string {
  const start = bar * 16;
  const end = start + 16;
  return drums
    .filter((d) => d.step >= start && d.step < end)
    .map((d) => `${d.step}:${d.kind}:${Math.round(d.velocity * 100)}`)
    .sort()
    .join('|');
}

/**
 * Compares two compiled songs and produces note-level and bar-level diff metadata
 * for visual highlighting in the mini piano roll and L3 editor.
 */
export function computeSongDiff(
  before: CompiledSong,
  after: CompiledSong,
  options: { label?: string; mode?: 'applied' | 'preview' } = {}
): SongVisualDiff {
  const mode = options.mode ?? 'applied';
  const addedMelodyIds = new Set<string>();
  const changedMelodyIds = new Set<string>();
  const removedMelodyNotes: NoteEvent[] = [];

  const beforeById = new Map<string, NoteEvent>();
  for (const n of before.melody) beforeById.set(n.id, n);

  const matchedBeforeIndices = new Set<number>();
  const matchedAfterIndices = new Set<number>();
  let changedCount = 0;
  let velocityChangedCount = 0;

  // 1. Match notes that preserve the same ID across edits (e.g. L3 or coach fix).
  for (let ai = 0; ai < after.melody.length; ai++) {
    const a = after.melody[ai];
    const bi = before.melody.findIndex((b, idx) => !matchedBeforeIndices.has(idx) && b.id === a.id);
    if (bi < 0) continue;
    const b = before.melody[bi];
    matchedBeforeIndices.add(bi);
    matchedAfterIndices.add(ai);

    if (b.step !== a.step || b.midi !== a.midi || b.duration !== a.duration) {
      changedMelodyIds.add(a.id);
      removedMelodyNotes.push(b);
      changedCount++;
    } else if (Math.abs(b.velocity - a.velocity) >= 0.03) {
      velocityChangedCount++;
    }
  }

  // 2. Match remaining notes by exact (step, midi, durationSteps) for regenerated IDs.
  const remainingBeforeBySig = new Map<string, number[]>();
  for (let bi = 0; bi < before.melody.length; bi++) {
    if (matchedBeforeIndices.has(bi)) continue;
    const sig = noteSignature(before.melody[bi]);
    const list = remainingBeforeBySig.get(sig) ?? [];
    list.push(bi);
    remainingBeforeBySig.set(sig, list);
  }

  for (let ai = 0; ai < after.melody.length; ai++) {
    if (matchedAfterIndices.has(ai)) continue;
    const a = after.melody[ai];
    const sig = noteSignature(a);
    const candidates = remainingBeforeBySig.get(sig);
    if (candidates && candidates.length > 0) {
      const bi = candidates.shift()!;
      matchedBeforeIndices.add(bi);
      matchedAfterIndices.add(ai);
      if (Math.abs(before.melody[bi].velocity - a.velocity) >= 0.03) {
        velocityChangedCount++;
      }
    }
  }

  // 3. Match remaining notes at the same step (pitch or duration changed).
  const remainingBeforeByStep = new Map<number, number[]>();
  for (let bi = 0; bi < before.melody.length; bi++) {
    if (matchedBeforeIndices.has(bi)) continue;
    const step = before.melody[bi].step;
    const list = remainingBeforeByStep.get(step) ?? [];
    list.push(bi);
    remainingBeforeByStep.set(step, list);
  }

  for (let ai = 0; ai < after.melody.length; ai++) {
    if (matchedAfterIndices.has(ai)) continue;
    const a = after.melody[ai];
    const candidates = remainingBeforeByStep.get(a.step);
    if (candidates && candidates.length > 0) {
      const bi = candidates.shift()!;
      matchedBeforeIndices.add(bi);
      matchedAfterIndices.add(ai);
      changedMelodyIds.add(a.id);
      removedMelodyNotes.push(before.melody[bi]);
      changedCount++;
    }
  }

  // 4. Leftovers are added or removed notes.
  let addedCount = 0;
  let removedCount = 0;
  for (let ai = 0; ai < after.melody.length; ai++) {
    if (matchedAfterIndices.has(ai)) continue;
    addedMelodyIds.add(after.melody[ai].id);
    addedCount++;
  }
  for (let bi = 0; bi < before.melody.length; bi++) {
    if (matchedBeforeIndices.has(bi)) continue;
    removedMelodyNotes.push(before.melody[bi]);
    removedCount++;
  }

  // 5. Chord and accompaniment bar diffs.
  const maxBars = Math.max(before.bars, after.bars);
  const chordChanges: ChordBarChange[] = [];
  const changedChordBars = new Set<number>();
  const changedAccompBars = new Set<number>();

  for (let bar = 0; bar < maxBars; bar++) {
    const beforeChord = getBarChordLabel(before, bar);
    const afterChord = getBarChordLabel(after, bar);
    if (beforeChord !== afterChord) {
      chordChanges.push({ bar, beforeSymbol: beforeChord || '—', afterSymbol: afterChord || '—' });
      changedChordBars.add(bar);
    }

    const accompChanged =
      barNotesSignature(before.chords, bar) !== barNotesSignature(after.chords, bar) ||
      barNotesSignature(before.bass, bar) !== barNotesSignature(after.bass, bar) ||
      barNotesSignature(before.pad, bar) !== barNotesSignature(after.pad, bar) ||
      barDrumsSignature(before.drums, bar) !== barDrumsSignature(after.drums, bar);

    if (accompChanged) {
      changedAccompBars.add(bar);
    }
  }

  const summaryParts: string[] = [];
  if (chordChanges.length > 0) {
    if (chordChanges.length <= 2) {
      summaryParts.push(
        chordChanges
          .map((c) => `${c.bar + 1}마디 ${c.beforeSymbol}→${c.afterSymbol}`)
          .join(', ')
      );
    } else {
      summaryParts.push(`코드 ${chordChanges.length}마디 변경`);
    }
  }

  const melodyParts: string[] = [];
  if (changedCount === 1 && addedCount === 0 && removedCount === 0) {
    const afterNote = after.melody.find((n) => changedMelodyIds.has(n.id));
    const beforeNote = removedMelodyNotes[0];
    if (afterNote && beforeNote && beforeNote.midi !== afterNote.midi) {
      melodyParts.push(`${noteName(beforeNote.midi)}→${noteName(afterNote.midi)}`);
    } else {
      melodyParts.push('1음 변경');
    }
  } else {
    if (changedCount > 0) melodyParts.push(`${changedCount}음 변경`);
    if (addedCount > 0) melodyParts.push(`+${addedCount}음 추가`);
    if (removedCount > 0) melodyParts.push(`-${removedCount}음 삭제`);
  }
  if (melodyParts.length > 0) {
    summaryParts.push(`멜로디 ${melodyParts.join(' · ')}`);
  }

  if (changedAccompBars.size > 0 && chordChanges.length === 0) {
    summaryParts.push(`반주·리듬 ${changedAccompBars.size}마디 변경`);
  }

  if (summaryParts.length === 0 && velocityChangedCount > 0) {
    summaryParts.push(`음표 세기 ${velocityChangedCount}곳 변경`);
  }

  const hasAnyChange =
    addedCount > 0 ||
    removedCount > 0 ||
    changedCount > 0 ||
    chordChanges.length > 0 ||
    changedAccompBars.size > 0 ||
    velocityChangedCount > 0;

  return {
    label: options.label,
    mode,
    addedMelodyIds,
    changedMelodyIds,
    removedMelodyNotes,
    chordChanges,
    changedChordBars,
    changedAccompBars,
    addedCount,
    removedCount,
    changedCount,
    velocityChangedCount,
    summaryText: hasAnyChange ? summaryParts.join(' · ') : '음표 변화 없음',
    hasAnyChange,
  };
}
