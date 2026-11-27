import type { NoteEvent } from './model';

export interface PitchBounds {
  minMidi: number;
  maxMidi: number;
}

export interface AddNoteParams {
  id: string;
  midi: number;
  step: number;
  duration: number;
  totalSteps: number;
  bounds: PitchBounds;
  velocity?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** 단선율 멜로디 음표를 시작 스텝 순으로 정렬하고 인접 음표와 겹치지 않게 길이를 보정한다. */
export function normalizeMelodyNotes(notes: NoteEvent[], totalSteps: number): NoteEvent[] {
  if (totalSteps <= 0) return [];
  const sorted = notes
    .map((n) => ({ ...n }))
    .filter((n) => n.step >= 0 && n.step < totalSteps)
    .sort((a, b) => a.step - b.step || a.midi - b.midi);

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    const limit = next && next.step > cur.step ? next.step : totalSteps;
    cur.duration = Math.max(1, Math.min(cur.duration, limit - cur.step));
  }
  return sorted;
}

/** 대상 음표가 다음 음표를 침범하지 않고 늘릴 수 있는 최대 스텝 길이를 계산한다. */
export function computeMaxResizeDuration(notes: NoteEvent[], noteId: string, totalSteps: number): number {
  const target = notes.find((n) => n.id === noteId);
  if (!target) return 1;

  let limitStep = totalSteps;
  for (const other of notes) {
    if (other.id !== noteId && other.step > target.step && other.step < limitStep) {
      limitStep = other.step;
    }
  }
  return Math.max(1, limitStep - target.step);
}

/** 빈 칸 클릭 위치에 새 음표를 추가한다. 같은 스텝에 음표가 있으면 교체한다. */
export function addPianoRollNote(notes: NoteEvent[], params: AddNoteParams): NoteEvent[] {
  if (params.totalSteps <= 0) return [];
  const step = clamp(Math.round(params.step), 0, params.totalSteps - 1);
  const midi = clamp(Math.round(params.midi), params.bounds.minMidi, params.bounds.maxMidi);
  const duration = clamp(Math.round(params.duration), 1, params.totalSteps - step);

  const kept = notes.filter((n) => n.step !== step).map((n) => ({ ...n }));
  kept.push({
    id: params.id,
    midi,
    step,
    duration,
    velocity: params.velocity ?? 0.82,
    origin: 'user',
  });
  return normalizeMelodyNotes(kept, params.totalSteps);
}

/** 지정한 ID의 음표를 삭제한다. */
export function deletePianoRollNote(notes: NoteEvent[], noteId: string): NoteEvent[] {
  return notes.filter((n) => n.id !== noteId).map((n) => ({ ...n }));
}

/** 기존 음표를 새 시작 스텝과 음높이로 이동한다. */
export function movePianoRollNote(
  notes: NoteEvent[],
  noteId: string,
  targetStep: number,
  targetMidi: number,
  totalSteps: number,
  bounds: PitchBounds
): NoteEvent[] {
  const target = notes.find((n) => n.id === noteId);
  if (!target) return notes.map((n) => ({ ...n }));
  if (totalSteps <= 0) return [];

  const clampedStep = clamp(Math.round(targetStep), 0, totalSteps - 1);
  const clampedMidi = clamp(Math.round(targetMidi), bounds.minMidi, bounds.maxMidi);
  const duration = Math.max(1, Math.min(target.duration, totalSteps - clampedStep));

  const others = notes
    .filter((n) => n.id !== noteId && n.step !== clampedStep)
    .map((n) => ({ ...n }));

  others.push({
    ...target,
    step: clampedStep,
    midi: clampedMidi,
    duration,
    origin: 'user',
  });
  return normalizeMelodyNotes(others, totalSteps);
}

/** 기존 음표의 지속 길이(스텝)를 최소 1 이상, 다음 음표 시작 전까지로 조절한다. */
export function resizePianoRollNote(
  notes: NoteEvent[],
  noteId: string,
  targetDuration: number,
  totalSteps: number
): NoteEvent[] {
  const target = notes.find((n) => n.id === noteId);
  if (!target) return notes.map((n) => ({ ...n }));
  if (totalSteps <= 0) return [];

  const maxDur = computeMaxResizeDuration(notes, noteId, totalSteps);
  const clampedDur = clamp(Math.round(targetDuration), 1, maxDur);

  const updated = notes.map((n) =>
    n.id === noteId ? { ...n, duration: clampedDur, origin: 'user' as const } : { ...n }
  );
  return normalizeMelodyNotes(updated, totalSteps);
}
