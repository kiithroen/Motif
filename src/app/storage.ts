import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
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

export interface NativeFileExporter {
  isNative: () => boolean;
  shareFile: (params: {
    filename: string;
    base64Data: string;
    title: string;
    mime: string;
  }) => Promise<void>;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function utf8ToBase64(text: string): string {
  return uint8ArrayToBase64(new TextEncoder().encode(text));
}

const defaultNativeExporter: NativeFileExporter = {
  isNative: () => Capacitor.isNativePlatform(),
  shareFile: async ({ filename, base64Data, title }) => {
    const written = await Filesystem.writeFile({
      path: filename,
      data: base64Data,
      directory: Directory.Cache,
    });
    await Share.share({
      title,
      url: written.uri,
      dialogTitle: title,
    });
  },
};

function triggerBlobDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadTextFile(
  filename: string,
  content: string,
  mime: string,
  exporter: NativeFileExporter = defaultNativeExporter
): Promise<void> {
  if (exporter.isNative()) {
    await exporter.shareFile({
      filename,
      base64Data: utf8ToBase64(content),
      title: filename,
      mime,
    });
    return;
  }
  triggerBlobDownload(filename, new Blob([content], { type: mime }));
}

export async function downloadMidi(
  compiled: CompiledSong,
  project: SongProject,
  chordView: ChordInstrument,
  exporter: NativeFileExporter = defaultNativeExporter
): Promise<void> {
  const bytes = exportToMidi(compiled, project, chordView);
  const filename = `motif_${NOTE_NAMES_SHARP[project.keyRoot]}_${project.mode}.mid`;
  if (exporter.isNative()) {
    await exporter.shareFile({
      filename,
      base64Data: uint8ArrayToBase64(bytes),
      title: filename,
      mime: 'audio/midi',
    });
    return;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  triggerBlobDownload(filename, new Blob([copy.buffer], { type: 'audio/midi' }));
}
