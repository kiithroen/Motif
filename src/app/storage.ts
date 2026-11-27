import type { CompiledSong } from '../core/compiler';
import { exportToMidi } from '../core/midi';
import type { ChordInstrument, SongProject, TrackKey, TrackVolumes } from '../core/model';
import { createDefaultTrackVolumes, sanitizeTrackVolumes } from '../core/playbackControl';
import {
  type SongLibraryState,
  getActiveSlot,
  sanitizeLibraryState,
} from '../core/projectLibrary';
import { NOTE_NAMES_SHARP } from '../core/theory';

export const STORAGE_KEY = 'motif_project_v1';
export const LIBRARY_STORAGE_KEY = 'motif_library_v1';
export const LESSON_STORAGE_KEY = 'motif_lessons_v1';
export const BASICS_STORAGE_KEY = 'motif_basics_v1';
export const MODE_STORAGE_KEY = 'motif_mode_v1';
export const CHORD_VIEW_STORAGE_KEY = 'motif_chord_view_v1';
export const MIXER_VOLUMES_STORAGE_KEY = 'motif_mixer_volumes_v1';

export type AppMode = 'basics' | 'lesson' | 'free';

export interface ProgressStore {
  completedIds: string[];
  activeLessonId: string;
}

function getStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

export function loadInitialMode(storage?: Storage): AppMode {
  try {
    const raw = getStorage(storage)?.getItem(MODE_STORAGE_KEY);
    if (raw === 'basics' || raw === 'lesson' || raw === 'free') return raw;
  } catch {
    // 저장 불가 환경은 기본 모드로 시작한다.
  }
  return 'basics';
}

export function saveMode(mode: AppMode, storage?: Storage): void {
  try {
    getStorage(storage)?.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // 저장 불가 환경은 건너뛴다.
  }
}

export function loadInitialChordView(storage?: Storage): ChordInstrument {
  try {
    const raw = getStorage(storage)?.getItem(CHORD_VIEW_STORAGE_KEY);
    if (raw === 'piano' || raw === 'guitar') return raw;
  } catch {
    // 저장 불가 환경은 건반 기본값으로 시작한다.
  }
  return 'piano';
}

export function saveChordView(view: ChordInstrument, storage?: Storage): void {
  try {
    getStorage(storage)?.setItem(CHORD_VIEW_STORAGE_KEY, view);
  } catch {
    // 저장 불가 환경은 건너뛴다.
  }
}

export function loadTrackVolumes(storage?: Storage): TrackVolumes {
  try {
    const raw = getStorage(storage)?.getItem(MIXER_VOLUMES_STORAGE_KEY);
    if (raw) {
      return sanitizeTrackVolumes(JSON.parse(raw) as Partial<Record<TrackKey, unknown>>);
    }
  } catch {
    // 저장 데이터 파싱 실패 시 기본 볼륨으로 시작한다.
  }
  return createDefaultTrackVolumes();
}

export function saveTrackVolumes(volumes: TrackVolumes, storage?: Storage): void {
  try {
    getStorage(storage)?.setItem(MIXER_VOLUMES_STORAGE_KEY, JSON.stringify(volumes));
  } catch {
    // 저장 불가 환경은 건너뛴다.
  }
}

export function loadInitialLibrary(storage?: Storage): SongLibraryState {
  const store = getStorage(storage);
  let rawLibrary: unknown = null;
  let legacyProject: unknown = null;
  try {
    const raw = store?.getItem(LIBRARY_STORAGE_KEY);
    if (raw) rawLibrary = JSON.parse(raw);
  } catch {
    // 저장 데이터 파싱 실패 시 레거시 또는 기본 라이브러리로 복구한다.
  }
  if (!rawLibrary) {
    try {
      const legacyRaw = store?.getItem(STORAGE_KEY);
      if (legacyRaw) legacyProject = JSON.parse(legacyRaw);
    } catch {
      // 레거시 파싱 실패는 무시한다.
    }
  }
  return sanitizeLibraryState(rawLibrary, legacyProject);
}

export function saveLibrary(library: SongLibraryState, storage?: Storage): void {
  const store = getStorage(storage);
  try {
    store?.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(library));
    store?.setItem(STORAGE_KEY, JSON.stringify(getActiveSlot(library).project));
  } catch {
    // 프라이빗 모드 등 저장 불가 환경은 조용히 건너뛴다.
  }
}

export function loadProgress(
  key: string,
  validList: Array<{ id: string }>,
  storage?: Storage
): ProgressStore {
  const validIds = new Set(validList.map((l) => l.id));
  const fallbackId = validList[0].id;
  try {
    const raw = getStorage(storage)?.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ProgressStore>;
      const completedIds = Array.isArray(parsed.completedIds)
        ? parsed.completedIds.filter((id): id is string => typeof id === 'string' && validIds.has(id))
        : [];
      const activeLessonId =
        typeof parsed.activeLessonId === 'string' && validIds.has(parsed.activeLessonId)
          ? parsed.activeLessonId
          : fallbackId;
      return { completedIds, activeLessonId };
    }
  } catch {
    // 저장 데이터 파싱 실패 시 기본 진행도로 시작한다.
  }
  return { completedIds: [], activeLessonId: fallbackId };
}

export function saveProgress(key: string, progress: ProgressStore, storage?: Storage): void {
  try {
    getStorage(storage)?.setItem(key, JSON.stringify(progress));
  } catch {
    // 저장 불가 환경은 조용히 건너뛴다.
  }
}

export function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadMidi(
  compiled: CompiledSong,
  project: SongProject,
  chordView: ChordInstrument
): void {
  const bytes = exportToMidi(compiled, project, chordView);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `motif_${NOTE_NAMES_SHARP[project.keyRoot]}_${project.mode}.mid`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
