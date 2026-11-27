import {
  type EditorLayer,
  type MelodyInstrument,
  type NoteEvent,
  type NoteOrigin,
  PRESETS,
  type SongProject,
  buildChordsFromProgression,
  buildDefaultModifiers,
  cloneProject,
  createDefaultProject,
} from './model';
import type { DegreeSymbol, ScaleMode } from './theory';

export interface SavedSongSlot {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  project: SongProject;
}

export interface SongLibraryState {
  version: number;
  activeSlotId: string;
  slots: SavedSongSlot[];
}

export interface BackupSlotPayload {
  name: string;
  project: SongProject;
}

export interface SingleSongBackupFile {
  format: 'motif-song';
  version: number;
  exportedAt: string;
  slot: BackupSlotPayload;
}

export interface LibraryBackupFile {
  format: 'motif-library';
  version: number;
  exportedAt: string;
  activeSlotIndex: number;
  slots: BackupSlotPayload[];
}

export type SanitizeProjectResult =
  | { ok: true; project: SongProject; warnings: string[] }
  | { ok: false; error: string };

export type LibraryMutationResult =
  | { ok: true; library: SongLibraryState; slot: SavedSongSlot }
  | { ok: false; error: string };

export type DeleteSlotResult =
  | { ok: true; library: SongLibraryState; deletedSlotId: string }
  | { ok: false; error: string };

export type ParsedBackupResult =
  | {
      ok: true;
      kind: 'motif-song' | 'motif-library' | 'raw-project';
      activeSlotIndex: number;
      slots: BackupSlotPayload[];
      warnings: string[];
    }
  | { ok: false; error: string };

export type ImportBackupResult =
  | {
      ok: true;
      library: SongLibraryState;
      importedCount: number;
      skippedCount: number;
      warnings: string[];
    }
  | { ok: false; error: string };

const VALID_MODES = new Set<ScaleMode>(['major', 'minor']);
const VALID_INSTRUMENTS = new Set<MelodyInstrument>(['piano', 'guitar']);
const VALID_LAYERS = new Set<EditorLayer>(['L1', 'L2', 'L3']);
const VALID_ORIGINS = new Set<NoteOrigin>(['base', 'modifier', 'user']);
const VALID_PROGRESSION_IDS = new Set(PRESETS.progressions.map((p) => p.id));
const VALID_GROOVE_IDS = new Set(PRESETS.grooves.map((g) => g.id));
const VALID_CONTOUR_IDS = new Set(PRESETS.contours.map((c) => c.id));
const VALID_DEGREES = new Set<DegreeSymbol>(PRESETS.availableDegrees);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveIsoTimestamp(raw: unknown, fallback: string): string {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed && !Number.isNaN(Date.parse(trimmed))) {
      return trimmed;
    }
  }
  return fallback;
}

function createUniqueSlotId(existingIds: Set<string>, preferredId?: unknown): string {
  if (typeof preferredId === 'string') {
    const cleaned = preferredId.trim();
    if (cleaned && !existingIds.has(cleaned)) {
      existingIds.add(cleaned);
      return cleaned;
    }
  }
  let idx = existingIds.size + 1;
  while (existingIds.has(`slot_${idx}`)) {
    idx += 1;
  }
  const id = `slot_${idx}_${Date.now().toString(36)}`;
  if (!existingIds.has(id)) {
    existingIds.add(id);
    return id;
  }
  let suffix = 1;
  while (existingIds.has(`${id}_${suffix}`)) {
    suffix += 1;
  }
  const unique = `${id}_${suffix}`;
  existingIds.add(unique);
  return unique;
}

function cloneSlot(slot: SavedSongSlot): SavedSongSlot {
  return {
    ...slot,
    project: cloneProject(slot.project),
  };
}

/** 슬롯 이름을 정리하고 최대 길이로 자른다. 비어 있으면 기본 이름을 반환한다. */
export function sanitizeSlotName(raw: unknown, fallback: string): string {
  const maxLen = PRESETS.library.maxNameLength;
  const fallbackClean = fallback.trim().replace(/\s+/g, ' ').slice(0, maxLen) || PRESETS.library.defaultSlotName;
  if (typeof raw !== 'string') return fallbackClean;
  const normalized = raw.trim().replace(/\s+/g, ' ');
  if (!normalized) return fallbackClean;
  return normalized.slice(0, maxLen);
}

/** 기존 이름 목록과 겹치지 않는 고유한 슬롯 이름을 만든다. */
export function generateUniqueSlotName(baseName: string, existingNames: string[]): string {
  const maxLen = PRESETS.library.maxNameLength;
  const used = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const cleanBase = sanitizeSlotName(baseName, PRESETS.library.defaultSlotName);
  if (!used.has(cleanBase.toLowerCase())) {
    return cleanBase;
  }

  for (let i = 2; i < 1000; i++) {
    const suffix = ` (${i})`;
    const head = cleanBase.slice(0, Math.max(1, maxLen - suffix.length)).trimEnd();
    const candidate = `${head}${suffix}`;
    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return cleanBase;
}

/** 기존 슬롯 목록을 기준으로 다음 '스케치 N' 이름을 생성한다. */
export function generateNextUntitledName(existingNames: string[]): string {
  const prefix = PRESETS.library.untitledPrefix;
  const used = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  for (let n = 1; n < 1000; n++) {
    const candidate = `${prefix} ${n}`.slice(0, PRESETS.library.maxNameLength);
    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return generateUniqueSlotName(prefix, existingNames);
}

/** 임의의 JSON 입력을 검증·정규화해 안전한 SongProject로 변환한다. */
export function sanitizeSongProject(input: unknown): SanitizeProjectResult {
  if (!isPlainObject(input)) {
    return { ok: false, error: '프로젝트 객체 형식이 올바르지 않다.' };
  }
  if (!isPlainObject(input.blocks) || !isPlainObject(input.chain)) {
    return { ok: false, error: '곡 데이터에 blocks 또는 chain 항목이 없다.' };
  }

  const defaults = PRESETS.defaults;
  const libCfg = PRESETS.library;
  const warnings: string[] = [];

  let keyRoot = defaults.keyRoot;
  if (typeof input.keyRoot === 'number' && Number.isFinite(input.keyRoot)) {
    const rounded = Math.round(input.keyRoot);
    keyRoot = clampNumber(rounded, 0, 11);
    if (keyRoot !== rounded) warnings.push('keyRoot 범위를 0~11로 보정했다.');
  } else {
    warnings.push('keyRoot 값이 유효하지 않아 기본값으로 대체했다.');
  }

  const mode: ScaleMode =
    typeof input.mode === 'string' && VALID_MODES.has(input.mode as ScaleMode)
      ? (input.mode as ScaleMode)
      : defaults.mode;
  if (input.mode !== mode) warnings.push('mode 값을 기본값으로 보정했다.');

  const bars: 4 | 8 = input.bars === 4 || input.bars === 8 ? input.bars : defaults.bars;
  if (input.bars !== bars) warnings.push('마디 수를 4 또는 8로 보정했다.');

  let bpm = defaults.bpm;
  if (typeof input.bpm === 'number' && Number.isFinite(input.bpm)) {
    const rounded = Math.round(input.bpm);
    bpm = clampNumber(rounded, libCfg.bpmMin, libCfg.bpmMax);
    if (bpm !== rounded) warnings.push(`BPM을 ${libCfg.bpmMin}~${libCfg.bpmMax} 범위로 보정했다.`);
  } else {
    warnings.push('BPM 값을 기본값으로 대체했다.');
  }

  let seed = defaults.seed;
  if (typeof input.seed === 'number' && Number.isFinite(input.seed)) {
    seed = Math.max(1, Math.round(input.seed));
  } else {
    warnings.push('seed 값을 기본값으로 대체했다.');
  }

  const melodyInstrument: MelodyInstrument =
    typeof input.melodyInstrument === 'string' && VALID_INSTRUMENTS.has(input.melodyInstrument as MelodyInstrument)
      ? (input.melodyInstrument as MelodyInstrument)
      : defaults.melodyInstrument;

  const activeLayer: EditorLayer =
    typeof input.activeLayer === 'string' && VALID_LAYERS.has(input.activeLayer as EditorLayer)
      ? (input.activeLayer as EditorLayer)
      : 'L1';

  const rawBlocks = input.blocks;
  const progressionId =
    typeof rawBlocks.progressionId === 'string' && VALID_PROGRESSION_IDS.has(rawBlocks.progressionId)
      ? rawBlocks.progressionId
      : defaults.progressionId;
  if (rawBlocks.progressionId !== progressionId) warnings.push('알 수 없는 코드 진행 프리셋을 기본값으로 바꿨다.');

  const grooveId =
    typeof rawBlocks.grooveId === 'string' && VALID_GROOVE_IDS.has(rawBlocks.grooveId)
      ? rawBlocks.grooveId
      : defaults.grooveId;
  if (rawBlocks.grooveId !== grooveId) warnings.push('알 수 없는 그루브 프리셋을 기본값으로 바꿨다.');

  const contourId =
    typeof rawBlocks.contourId === 'string' && VALID_CONTOUR_IDS.has(rawBlocks.contourId)
      ? rawBlocks.contourId
      : defaults.contourId;
  if (rawBlocks.contourId !== contourId) warnings.push('알 수 없는 선율 윤곽 프리셋을 기본값으로 바꿨다.');

  const energy =
    typeof rawBlocks.energy === 'number' && Number.isFinite(rawBlocks.energy)
      ? clampNumber(rawBlocks.energy, 0, 1)
      : defaults.energy;
  const density =
    typeof rawBlocks.density === 'number' && Number.isFinite(rawBlocks.density)
      ? clampNumber(rawBlocks.density, 0, 1)
      : defaults.density;

  const fallbackChords = buildChordsFromProgression(progressionId, bars);
  const rawChords = Array.isArray(input.chain.chords) ? input.chain.chords : [];
  if (!Array.isArray(input.chain.chords) || rawChords.length !== bars) {
    warnings.push('마디 코드 슬롯 길이를 곡 마디 수에 맞춰 보정했다.');
  }
  const chords = fallbackChords.map((fallbackSlot, barIdx) => {
    const byBar = rawChords.find((c) => isPlainObject(c) && c.bar === barIdx);
    const candidate = isPlainObject(byBar) ? byBar : rawChords[barIdx];
    if (isPlainObject(candidate) && typeof candidate.degree === 'string' && VALID_DEGREES.has(candidate.degree as DegreeSymbol)) {
      return { bar: barIdx, degree: candidate.degree as DegreeSymbol };
    }
    if (candidate !== undefined) {
      warnings.push(`${barIdx + 1}마디 코드 도수가 유효하지 않아 기본 도수로 보정했다.`);
    }
    return fallbackSlot;
  });

  const rawModifiers = Array.isArray(input.chain.modifiers) ? input.chain.modifiers : [];
  const modifierMap = new Map<string, { enabled: boolean; amount: number }>();
  for (const item of rawModifiers) {
    if (!isPlainObject(item) || typeof item.id !== 'string') continue;
    const defaultMeta = PRESETS.modifiers.find((m) => m.id === item.id);
    if (!defaultMeta) continue;
    const enabled = typeof item.enabled === 'boolean' ? item.enabled : defaultMeta.defaultEnabled;
    const amount =
      typeof item.amount === 'number' && Number.isFinite(item.amount)
        ? clampNumber(item.amount, 0, 1)
        : defaultMeta.defaultAmount;
    modifierMap.set(item.id, { enabled, amount });
  }
  const modifiers = buildDefaultModifiers().map((base) => {
    const saved = modifierMap.get(base.id);
    return saved ? { id: base.id, enabled: saved.enabled, amount: saved.amount } : base;
  });

  const baked = typeof input.baked === 'boolean' ? input.baked : false;
  const totalSteps = bars * 16;
  const usedNoteIds = new Set<string>();
  const rawMelody = Array.isArray(input.bakedMelody) ? input.bakedMelody : [];
  const sanitizedNotes: NoteEvent[] = [];

  for (let i = 0; i < rawMelody.length; i++) {
    const rawNote = rawMelody[i];
    if (
      !isPlainObject(rawNote) ||
      typeof rawNote.midi !== 'number' ||
      !Number.isFinite(rawNote.midi) ||
      typeof rawNote.step !== 'number' ||
      !Number.isFinite(rawNote.step)
    ) {
      warnings.push('손상된 음표 데이터를 제외했다.');
      continue;
    }

    const step = clampNumber(Math.round(rawNote.step), 0, totalSteps - 1);
    const midi = clampNumber(Math.round(rawNote.midi), libCfg.midiMin, libCfg.midiMax);
    const rawDuration =
      typeof rawNote.duration === 'number' && Number.isFinite(rawNote.duration) ? Math.round(rawNote.duration) : 2;
    const duration = clampNumber(rawDuration, 1, totalSteps - step);
    const velocity =
      typeof rawNote.velocity === 'number' && Number.isFinite(rawNote.velocity)
        ? clampNumber(rawNote.velocity, 0.05, 1)
        : 0.82;

    if (step !== Math.round(rawNote.step) || midi !== Math.round(rawNote.midi) || duration !== rawDuration) {
      warnings.push('범위를 벗어난 음표 위치·음높이·길이를 보정했다.');
    }

    let noteId = typeof rawNote.id === 'string' && rawNote.id.trim() ? rawNote.id.trim() : `note_${i + 1}`;
    if (usedNoteIds.has(noteId)) {
      let suffix = 2;
      while (usedNoteIds.has(`${noteId}_${suffix}`)) suffix += 1;
      noteId = `${noteId}_${suffix}`;
    }
    usedNoteIds.add(noteId);

    const note: NoteEvent = {
      id: noteId,
      midi,
      step,
      duration,
      velocity,
    };
    if (typeof rawNote.origin === 'string' && VALID_ORIGINS.has(rawNote.origin as NoteOrigin)) {
      note.origin = rawNote.origin as NoteOrigin;
    }
    sanitizedNotes.push(note);
  }

  sanitizedNotes.sort((a, b) => a.step - b.step || a.midi - b.midi);

  return {
    ok: true,
    project: {
      keyRoot,
      mode,
      bars,
      bpm,
      seed,
      melodyInstrument,
      activeLayer,
      blocks: {
        progressionId,
        grooveId,
        contourId,
        energy,
        density,
      },
      chain: {
        chords,
        modifiers,
      },
      baked,
      bakedMelody: sanitizedNotes,
    },
    warnings: Array.from(new Set(warnings)),
  };
}

/** 기본 라이브러리 상태를 생성한다. 기존 단일 프로젝트가 있으면 첫 슬롯으로 마이그레이션한다. */
export function createInitialLibrary(
  legacyProject?: SongProject | null,
  nowIso = new Date().toISOString()
): SongLibraryState {
  const project = legacyProject ? cloneProject(legacyProject) : createDefaultProject();
  const slot: SavedSongSlot = {
    id: 'slot_1',
    name: PRESETS.library.defaultSlotName,
    createdAt: nowIso,
    updatedAt: nowIso,
    project,
  };
  return {
    version: PRESETS.library.schemaVersion,
    activeSlotId: slot.id,
    slots: [slot],
  };
}

/** 저장소에서 읽은 라이브러리 JSON과 레거시 단일 프로젝트를 안전한 라이브러리 상태로 복원한다. */
export function sanitizeLibraryState(
  raw: unknown,
  legacyProject?: unknown,
  nowIso = new Date().toISOString()
): SongLibraryState {
  const maxSlots = PRESETS.library.maxSlots;
  const usedIds = new Set<string>();
  const slots: SavedSongSlot[] = [];

  if (isPlainObject(raw) && Array.isArray(raw.slots)) {
    for (let i = 0; i < raw.slots.length && slots.length < maxSlots; i++) {
      const item = raw.slots[i];
      if (!isPlainObject(item)) continue;
      const sanitizedProj = sanitizeSongProject(item.project);
      if (!sanitizedProj.ok) continue;

      const id = createUniqueSlotId(usedIds, item.id);
      const fallbackName =
        slots.length === 0 ? PRESETS.library.defaultSlotName : `${PRESETS.library.untitledPrefix} ${slots.length + 1}`;
      const name = sanitizeSlotName(item.name, fallbackName);
      const createdAt = resolveIsoTimestamp(item.createdAt, nowIso);
      const updatedAt = resolveIsoTimestamp(item.updatedAt, createdAt);

      slots.push({
        id,
        name,
        createdAt,
        updatedAt,
        project: sanitizedProj.project,
      });
    }
  }

  if (slots.length === 0) {
    if (legacyProject !== undefined && legacyProject !== null) {
      const migrated = sanitizeSongProject(legacyProject);
      if (migrated.ok) {
        return createInitialLibrary(migrated.project, nowIso);
      }
    }
    return createInitialLibrary(null, nowIso);
  }

  const rawActiveId = isPlainObject(raw) && typeof raw.activeSlotId === 'string' ? raw.activeSlotId : '';
  const activeExists = slots.some((s) => s.id === rawActiveId);
  return {
    version: PRESETS.library.schemaVersion,
    activeSlotId: activeExists ? rawActiveId : slots[0].id,
    slots,
  };
}

/** 현재 활성 슬롯을 반환한다. */
export function getActiveSlot(library: SongLibraryState): SavedSongSlot {
  return library.slots.find((s) => s.id === library.activeSlotId) ?? library.slots[0];
}

/** 지정한 ID의 슬롯을 활성 슬롯으로 선택한다. */
export function selectSongSlot(library: SongLibraryState, slotId: string): SongLibraryState {
  if (!library.slots.some((s) => s.id === slotId)) return library;
  return {
    ...library,
    activeSlotId: slotId,
    slots: library.slots.map(cloneSlot),
  };
}

/** 활성 슬롯의 프로젝트 내용을 갱신한다. */
export function updateActiveSlotProject(
  library: SongLibraryState,
  project: SongProject,
  nowIso = new Date().toISOString()
): SongLibraryState {
  const active = getActiveSlot(library);
  return {
    ...library,
    activeSlotId: active.id,
    slots: library.slots.map((slot) =>
      slot.id === active.id
        ? {
            ...slot,
            updatedAt: nowIso,
            project: cloneProject(project),
          }
        : cloneSlot(slot)
    ),
  };
}

/** 새 곡 슬롯을 생성하고 활성화한다. 최대 슬롯 수를 초과하면 실패한다. */
export function createSongSlot(
  library: SongLibraryState,
  options: { name?: string; project?: SongProject; nowIso?: string } = {}
): LibraryMutationResult {
  const maxSlots = PRESETS.library.maxSlots;
  if (library.slots.length >= maxSlots) {
    return {
      ok: false,
      error: `곡 슬롯은 최대 ${maxSlots}개까지 저장할 수 있다. 기존 슬롯을 삭제하거나 백업 후 정리해 주세요.`,
    };
  }

  const nowIso = options.nowIso ?? new Date().toISOString();
  const existingIds = new Set(library.slots.map((s) => s.id));
  const existingNames = library.slots.map((s) => s.name);
  const id = createUniqueSlotId(existingIds);
  const name = options.name
    ? generateUniqueSlotName(options.name, existingNames)
    : generateNextUntitledName(existingNames);
  const project = options.project ? cloneProject(options.project) : createDefaultProject();

  const newSlot: SavedSongSlot = {
    id,
    name,
    createdAt: nowIso,
    updatedAt: nowIso,
    project,
  };

  return {
    ok: true,
    library: {
      ...library,
      activeSlotId: newSlot.id,
      slots: [...library.slots.map(cloneSlot), newSlot],
    },
    slot: cloneSlot(newSlot),
  };
}

/** 지정한 슬롯을 복제해 바로 뒤에 삽입하고 활성화한다. */
export function duplicateSongSlot(
  library: SongLibraryState,
  slotId: string,
  nowIso = new Date().toISOString()
): LibraryMutationResult {
  const maxSlots = PRESETS.library.maxSlots;
  if (library.slots.length >= maxSlots) {
    return {
      ok: false,
      error: `곡 슬롯은 최대 ${maxSlots}개까지 저장할 수 있다.`,
    };
  }

  const targetIndex = library.slots.findIndex((s) => s.id === slotId);
  if (targetIndex < 0) {
    return { ok: false, error: '복제할 슬롯을 찾을 수 없다.' };
  }

  const target = library.slots[targetIndex];
  const existingIds = new Set(library.slots.map((s) => s.id));
  const existingNames = library.slots.map((s) => s.name);
  const id = createUniqueSlotId(existingIds);
  const name = generateUniqueSlotName(`${target.name} ${PRESETS.library.duplicateSuffix}`, existingNames);

  const duplicated: SavedSongSlot = {
    id,
    name,
    createdAt: nowIso,
    updatedAt: nowIso,
    project: cloneProject(target.project),
  };

  const nextSlots = library.slots.map(cloneSlot);
  nextSlots.splice(targetIndex + 1, 0, duplicated);

  return {
    ok: true,
    library: {
      ...library,
      activeSlotId: duplicated.id,
      slots: nextSlots,
    },
    slot: cloneSlot(duplicated),
  };
}

/** 지정한 슬롯의 이름을 변경한다. */
export function renameSongSlot(
  library: SongLibraryState,
  slotId: string,
  rawName: string,
  nowIso = new Date().toISOString()
): SongLibraryState {
  const target = library.slots.find((s) => s.id === slotId);
  if (!target) return library;

  const nextName = sanitizeSlotName(rawName, target.name);
  return {
    ...library,
    slots: library.slots.map((slot) =>
      slot.id === slotId
        ? {
            ...slot,
            name: nextName,
            updatedAt: nowIso,
            project: cloneProject(slot.project),
          }
        : cloneSlot(slot)
    ),
  };
}

/** 지정한 슬롯을 삭제한다. 마지막 1개 슬롯은 삭제할 수 없다. */
export function deleteSongSlot(library: SongLibraryState, slotId: string): DeleteSlotResult {
  if (library.slots.length <= 1) {
    return { ok: false, error: '마지막 1개의 곡 슬롯은 삭제할 수 없다.' };
  }

  const idx = library.slots.findIndex((s) => s.id === slotId);
  if (idx < 0) {
    return { ok: false, error: '삭제할 슬롯을 찾을 수 없다.' };
  }

  const remaining = library.slots.filter((s) => s.id !== slotId).map(cloneSlot);
  let nextActiveId = library.activeSlotId;
  if (library.activeSlotId === slotId) {
    const neighbor = remaining[Math.min(idx, remaining.length - 1)] ?? remaining[0];
    nextActiveId = neighbor.id;
  }

  return {
    ok: true,
    library: {
      ...library,
      activeSlotId: nextActiveId,
      slots: remaining,
    },
    deletedSlotId: slotId,
  };
}

/** 단일 곡 슬롯을 백업 JSON 문자열로 직렬화한다. */
export function serializeSongBackup(slot: SavedSongSlot, nowIso = new Date().toISOString()): string {
  const payload: SingleSongBackupFile = {
    format: 'motif-song',
    version: PRESETS.library.schemaVersion,
    exportedAt: nowIso,
    slot: {
      name: slot.name,
      project: cloneProject(slot.project),
    },
  };
  return JSON.stringify(payload, null, 2);
}

/** 전체 곡 라이브러리를 백업 JSON 문자열로 직렬화한다. */
export function serializeLibraryBackup(
  library: SongLibraryState,
  nowIso = new Date().toISOString()
): string {
  const activeIdx = Math.max(
    0,
    library.slots.findIndex((s) => s.id === library.activeSlotId)
  );
  const payload: LibraryBackupFile = {
    format: 'motif-library',
    version: PRESETS.library.schemaVersion,
    exportedAt: nowIso,
    activeSlotIndex: activeIdx,
    slots: library.slots.map((s) => ({
      name: s.name,
      project: cloneProject(s.project),
    })),
  };
  return JSON.stringify(payload, null, 2);
}

/** 백업 JSON 문자열(단일 곡·전체 라이브러리·순수 SongProject)을 파싱하고 검증한다. */
export function parseBackupJson(jsonText: string): ParsedBackupResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: 'JSON 파일 형식이 올바르지 않다.' };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: '백업 파일 최상위 구조가 JSON 객체가 아니다.' };
  }

  if (parsed.format === 'motif-song') {
    if (!isPlainObject(parsed.slot)) {
      return { ok: false, error: '단일 곡 백업 파일에 slot 정보가 없다.' };
    }
    const projResult = sanitizeSongProject(parsed.slot.project);
    if (!projResult.ok) {
      return { ok: false, error: projResult.error };
    }
    return {
      ok: true,
      kind: 'motif-song',
      activeSlotIndex: 0,
      slots: [
        {
          name: sanitizeSlotName(parsed.slot.name, PRESETS.library.importedDefaultName),
          project: projResult.project,
        },
      ],
      warnings: projResult.warnings,
    };
  }

  if (parsed.format === 'motif-library') {
    if (!Array.isArray(parsed.slots) || parsed.slots.length === 0) {
      return { ok: false, error: '라이브러리 백업 파일에 유효한 곡 목록이 없다.' };
    }
    const validSlots: BackupSlotPayload[] = [];
    const warnings: string[] = [];

    for (let i = 0; i < parsed.slots.length; i++) {
      const entry = parsed.slots[i];
      if (!isPlainObject(entry)) {
        warnings.push(`${i + 1}번째 슬롯 형식이 잘못되어 건너뛰었다.`);
        continue;
      }
      const projResult = sanitizeSongProject(entry.project);
      if (!projResult.ok) {
        warnings.push(`${i + 1}번째 슬롯 곡 데이터를 읽을 수 없어 건너뛰었다.`);
        continue;
      }
      validSlots.push({
        name: sanitizeSlotName(entry.name, `${PRESETS.library.importedDefaultName} ${validSlots.length + 1}`),
        project: projResult.project,
      });
      warnings.push(...projResult.warnings);
    }

    if (validSlots.length === 0) {
      return { ok: false, error: '라이브러리 백업에서 복원 가능한 곡이 없다.' };
    }

    const rawIdx =
      typeof parsed.activeSlotIndex === 'number' && Number.isFinite(parsed.activeSlotIndex)
        ? Math.round(parsed.activeSlotIndex)
        : 0;
    const activeSlotIndex = clampNumber(rawIdx, 0, validSlots.length - 1);

    return {
      ok: true,
      kind: 'motif-library',
      activeSlotIndex,
      slots: validSlots,
      warnings: Array.from(new Set(warnings)),
    };
  }

  if (isPlainObject(parsed.blocks) && isPlainObject(parsed.chain)) {
    const projResult = sanitizeSongProject(parsed);
    if (!projResult.ok) {
      return { ok: false, error: projResult.error };
    }
    return {
      ok: true,
      kind: 'raw-project',
      activeSlotIndex: 0,
      slots: [
        {
          name: PRESETS.library.importedDefaultName,
          project: projResult.project,
        },
      ],
      warnings: projResult.warnings,
    };
  }

  return { ok: false, error: '지원하지 않는 Motif 백업 형식이다.' };
}

/** 파싱된 백업을 기존 라이브러리에 최대 슬롯 수 한도 내에서 추가한다. */
export function importBackupIntoLibrary(
  library: SongLibraryState,
  jsonText: string,
  nowIso = new Date().toISOString()
): ImportBackupResult {
  const maxSlots = PRESETS.library.maxSlots;
  const remainingCapacity = maxSlots - library.slots.length;
  if (remainingCapacity <= 0) {
    return {
      ok: false,
      error: `곡 슬롯이 가득 차서(${maxSlots}/${maxSlots}) 더 이상 불러올 수 없다.`,
    };
  }

  const parsed = parseBackupJson(jsonText);
  if (!parsed.ok) return parsed;

  const existingIds = new Set(library.slots.map((s) => s.id));
  const existingNames = library.slots.map((s) => s.name);
  const nextSlots = library.slots.map(cloneSlot);
  const addedSlots: SavedSongSlot[] = [];
  const warnings = [...parsed.warnings];

  const toImport = parsed.slots.slice(0, remainingCapacity);
  const skippedCount = parsed.slots.length - toImport.length;
  if (skippedCount > 0) {
    warnings.push(`최대 슬롯 수(${maxSlots}개) 제한으로 ${skippedCount}곡은 제외되었다.`);
  }

  for (const item of toImport) {
    const id = createUniqueSlotId(existingIds);
    const name = generateUniqueSlotName(item.name, existingNames);
    existingNames.push(name);
    const slot: SavedSongSlot = {
      id,
      name,
      createdAt: nowIso,
      updatedAt: nowIso,
      project: cloneProject(item.project),
    };
    nextSlots.push(slot);
    addedSlots.push(slot);
  }

  const targetAdded = addedSlots[Math.min(parsed.activeSlotIndex, addedSlots.length - 1)] ?? addedSlots[0];

  return {
    ok: true,
    library: {
      ...library,
      activeSlotId: targetAdded.id,
      slots: nextSlots,
    },
    importedCount: addedSlots.length,
    skippedCount,
    warnings: Array.from(new Set(warnings)),
  };
}

/** 파일 다운로드에 안전한 JSON 파일명을 만든다. */
export function buildBackupFilename(baseName: string, kind: 'song' | 'library'): string {
  const cleaned = baseName
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (kind === 'library') {
    return `${cleaned || 'motif_library_backup'}.json`;
  }
  return `${cleaned || 'motif_sketch'}.motif.json`;
}
