import type { NoteEvent } from './model';

export interface PitchBounds {
  minMidi: number;
  maxMidi: number;
}

export interface NoteClipboardItem {
  offsetStep: number;
  midi: number;
  duration: number;
  velocity: number;
}

export interface NoteClipboard {
  items: NoteClipboardItem[];
  spanSteps: number;
  sourceStartStep: number;
  sourceEndStep: number;
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

/** 선택된 음표들을 상대 스텝 오프셋 기준 클립보드 데이터로 복사한다. */
export function copyPianoRollNotes(
  notes: NoteEvent[],
  selectedIds: ReadonlySet<string>
): NoteClipboard | null {
  if (selectedIds.size === 0) return null;
  const selected = notes
    .filter((n) => selectedIds.has(n.id))
    .sort((a, b) => a.step - b.step || a.midi - b.midi);
  if (selected.length === 0) return null;

  const sourceStartStep = selected.reduce((min, n) => Math.min(min, n.step), selected[0].step);
  const sourceEndStep = selected.reduce(
    (max, n) => Math.max(max, n.step + Math.max(1, n.duration)),
    selected[0].step + Math.max(1, selected[0].duration)
  );

  return {
    items: selected.map((n) => ({
      offsetStep: n.step - sourceStartStep,
      midi: n.midi,
      duration: Math.max(1, n.duration),
      velocity: n.velocity,
    })),
    spanSteps: Math.max(1, sourceEndStep - sourceStartStep),
    sourceStartStep,
    sourceEndStep,
  };
}

/** 선택된 ID 집합에 해당하는 음표를 모두 삭제한다. */
export function deletePianoRollNotes(
  notes: NoteEvent[],
  selectedIds: ReadonlySet<string>
): NoteEvent[] {
  if (selectedIds.size === 0) return notes.map((n) => ({ ...n }));
  return notes.filter((n) => !selectedIds.has(n.id)).map((n) => ({ ...n }));
}

/** 선택된 음표 그룹 전체가 스텝/음높이 경계를 넘지 않도록 이동 델타를 제한한다. */
export function clampGroupDelta(
  notes: NoteEvent[],
  selectedIds: ReadonlySet<string>,
  deltaStep: number,
  deltaMidi: number,
  totalSteps: number,
  bounds: PitchBounds
): { deltaStep: number; deltaMidi: number } {
  if (totalSteps <= 0 || selectedIds.size === 0) {
    return { deltaStep: 0, deltaMidi: 0 };
  }
  const selected = notes.filter((n) => selectedIds.has(n.id));
  if (selected.length === 0) {
    return { deltaStep: 0, deltaMidi: 0 };
  }

  let minStep = selected[0].step;
  let maxStep = selected[0].step;
  let minMidi = selected[0].midi;
  let maxMidi = selected[0].midi;
  for (const n of selected) {
    if (n.step < minStep) minStep = n.step;
    if (n.step > maxStep) maxStep = n.step;
    if (n.midi < minMidi) minMidi = n.midi;
    if (n.midi > maxMidi) maxMidi = n.midi;
  }

  const stepLo = -minStep;
  const stepHi = totalSteps - 1 - maxStep;
  const midiLo = bounds.minMidi - minMidi;
  const midiHi = bounds.maxMidi - maxMidi;

  const clampedStep =
    stepLo <= stepHi ? clamp(Math.round(deltaStep), stepLo, stepHi) : 0;
  const clampedMidi =
    midiLo <= midiHi ? clamp(Math.round(deltaMidi), midiLo, midiHi) : 0;

  return { deltaStep: clampedStep, deltaMidi: clampedMidi };
}

/** 선택된 음표들을 상대 간격을 유지한 채 일괄 이동한다. */
export function movePianoRollNotes(
  notes: NoteEvent[],
  selectedIds: ReadonlySet<string>,
  deltaStep: number,
  deltaMidi: number,
  totalSteps: number,
  bounds: PitchBounds
): NoteEvent[] {
  if (totalSteps <= 0) return [];
  const selected = notes.filter((n) => selectedIds.has(n.id));
  if (selected.length === 0) return notes.map((n) => ({ ...n }));

  const clamped = clampGroupDelta(notes, selectedIds, deltaStep, deltaMidi, totalSteps, bounds);
  if (clamped.deltaStep === 0 && clamped.deltaMidi === 0) {
    return notes.map((n) => ({ ...n }));
  }

  const movedSelected: NoteEvent[] = selected.map((n) => {
    const step = n.step + clamped.deltaStep;
    const midi = n.midi + clamped.deltaMidi;
    const duration = Math.max(1, Math.min(n.duration, totalSteps - step));
    return {
      ...n,
      step,
      midi,
      duration,
      origin: 'user' as const,
    };
  });

  const occupiedSteps = new Set(movedSelected.map((n) => n.step));
  const others = notes
    .filter((n) => !selectedIds.has(n.id) && !occupiedSteps.has(n.step))
    .map((n) => ({ ...n }));

  return normalizeMelodyNotes([...others, ...movedSelected], totalSteps);
}

/** 클립보드 음표를 지정한 시작 스텝에 붙여넣고 새 음표 ID 목록과 끝 스텝을 반환한다. */
export function pastePianoRollNotes(
  notes: NoteEvent[],
  clipboard: NoteClipboard,
  targetStep: number,
  totalSteps: number,
  bounds: PitchBounds,
  idPrefix = 'm_paste',
  midiOffset = 0
): { notes: NoteEvent[]; pastedIds: string[]; endStep: number } {
  if (totalSteps <= 0) {
    return { notes: [], pastedIds: [], endStep: 0 };
  }

  const baseStep = Math.round(targetStep);
  const roundedMidiOffset = Math.round(midiOffset);
  const placed: NoteEvent[] = [];
  const pastedIds: string[] = [];

  clipboard.items.forEach((item, idx) => {
    const step = baseStep + item.offsetStep;
    if (step < 0 || step >= totalSteps) return;
    const midi = clamp(Math.round(item.midi + roundedMidiOffset), bounds.minMidi, bounds.maxMidi);
    const duration = clamp(Math.round(item.duration), 1, totalSteps - step);
    const id = `${idPrefix}_${idx}`;
    pastedIds.push(id);
    placed.push({
      id,
      midi,
      step,
      duration,
      velocity: item.velocity,
      origin: 'user',
    });
  });

  if (placed.length === 0) {
    return {
      notes: notes.map((n) => ({ ...n })),
      pastedIds: [],
      endStep: Math.max(0, baseStep),
    };
  }

  const occupiedSteps = new Set(placed.map((n) => n.step));
  const kept = notes.filter((n) => !occupiedSteps.has(n.step)).map((n) => ({ ...n }));
  const normalized = normalizeMelodyNotes([...kept, ...placed], totalSteps);
  const pastedIdSet = new Set(pastedIds);
  const endStep = normalized.reduce(
    (max, n) => (pastedIdSet.has(n.id) ? Math.max(max, n.step + n.duration) : max),
    baseStep
  );

  return { notes: normalized, pastedIds, endStep };
}

/** 선택된 음표 구간의 바로 뒤에 동일 모티프를 복제한다. */
export function duplicatePianoRollNotes(
  notes: NoteEvent[],
  selectedIds: ReadonlySet<string>,
  totalSteps: number,
  bounds: PitchBounds,
  idPrefix = 'm_dup'
): { notes: NoteEvent[]; pastedIds: string[]; endStep: number } {
  const clipboard = copyPianoRollNotes(notes, selectedIds);
  if (!clipboard) {
    return { notes: notes.map((n) => ({ ...n })), pastedIds: [], endStep: 0 };
  }
  return pastePianoRollNotes(notes, clipboard, clipboard.sourceEndStep, totalSteps, bounds, idPrefix);
}

/** 선택된 음표들의 지속 길이를 상대 스텝만큼 증감하되 최소 1 및 다음 음표 경계 내로 제한한다. */
export function adjustPianoRollNotesDuration(
  notes: NoteEvent[],
  selectedIds: ReadonlySet<string>,
  deltaSteps: number,
  totalSteps: number
): NoteEvent[] {
  const stepDelta = Math.round(deltaSteps);
  if (totalSteps <= 0) return [];
  if (selectedIds.size === 0 || stepDelta === 0) {
    return notes.map((n) => ({ ...n }));
  }

  let changed = false;
  const updated = notes.map((n) => {
    if (!selectedIds.has(n.id)) return { ...n };
    const maxDur = computeMaxResizeDuration(notes, n.id, totalSteps);
    const nextDuration = clamp(Math.round(n.duration + stepDelta), 1, maxDur);
    if (nextDuration !== n.duration) {
      changed = true;
      return { ...n, duration: nextDuration, origin: 'user' as const };
    }
    return { ...n };
  });

  if (!changed) return notes.map((n) => ({ ...n }));
  return normalizeMelodyNotes(updated, totalSteps);
}

/** 마키 드래그 영역(스텝/음높이 범위)과 겹치는 음표 ID 목록을 반환한다. */
export function selectNotesInMarquee(
  notes: NoteEvent[],
  minStep: number,
  maxStep: number,
  minMidi: number,
  maxMidi: number
): string[] {
  const loStep = Math.min(minStep, maxStep);
  const hiStep = Math.max(minStep, maxStep);
  const loMidi = Math.min(minMidi, maxMidi);
  const hiMidi = Math.max(minMidi, maxMidi);

  return notes
    .filter((n) => {
      const noteEnd = n.step + Math.max(1, n.duration) - 1;
      return n.step <= hiStep && noteEnd >= loStep && n.midi >= loMidi && n.midi <= hiMidi;
    })
    .map((n) => n.id);
}
