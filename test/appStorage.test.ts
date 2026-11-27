// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BASICS_STORAGE_KEY,
  CHORD_VIEW_STORAGE_KEY,
  LIBRARY_STORAGE_KEY,
  MIXER_VOLUMES_STORAGE_KEY,
  MODE_STORAGE_KEY,
  type NativeFileExporter,
  STORAGE_KEY,
  downloadMidi,
  downloadTextFile,
  loadInitialChordView,
  loadInitialLibrary,
  loadInitialMode,
  loadProgress,
  loadTrackVolumes,
  saveChordView,
  saveLibrary,
  saveMode,
  saveProgress,
  saveTrackVolumes,
  uint8ArrayToBase64,
  utf8ToBase64,
} from '../src/app/storage';
import { compileSong } from '../src/core/compiler';
import { PRESETS, createDefaultProject } from '../src/core/model';
import { createDefaultTrackVolumes } from '../src/core/playbackControl';
import { createSongSlot, getActiveSlot } from '../src/core/projectLibrary';

describe('app storage helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists and restores mode, chordView, and track volumes with safe defaults', () => {
    expect(loadInitialMode()).toBe('basics');
    saveMode('free');
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('free');
    expect(loadInitialMode()).toBe('free');

    localStorage.setItem(MODE_STORAGE_KEY, 'invalid-mode');
    expect(loadInitialMode()).toBe('basics');

    expect(loadInitialChordView()).toBe('piano');
    saveChordView('guitar');
    expect(localStorage.getItem(CHORD_VIEW_STORAGE_KEY)).toBe('guitar');
    expect(loadInitialChordView()).toBe('guitar');

    expect(loadTrackVolumes()).toEqual(createDefaultTrackVolumes());
    const nextVol = {
      ...createDefaultTrackVolumes(),
      melody: PRESETS.playback.mixer.min,
      drums: PRESETS.playback.mixer.max,
    };
    saveTrackVolumes(nextVol);
    expect(loadTrackVolumes()).toEqual(nextVol);

    localStorage.setItem(MIXER_VOLUMES_STORAGE_KEY, '{broken-json');
    expect(loadTrackVolumes()).toEqual(createDefaultTrackVolumes());
  });

  it('migrates legacy single project into song library and syncs active slot on save', () => {
    const legacy = createDefaultProject();
    legacy.keyRoot = 5;
    legacy.bars = 8;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    const migrated = loadInitialLibrary();
    expect(migrated.slots).toHaveLength(1);
    expect(getActiveSlot(migrated).project.keyRoot).toBe(5);
    expect(getActiveSlot(migrated).project.bars).toBe(8);

    const created = createSongSlot(migrated, { name: '두 번째 곡' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    saveLibrary(created.library);

    const reloaded = loadInitialLibrary();
    expect(reloaded.slots).toHaveLength(2);
    expect(getActiveSlot(reloaded).name).toBe('두 번째 곡');
    expect(localStorage.getItem(LIBRARY_STORAGE_KEY)).toBeTruthy();
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();
  });

  it('filters unknown lesson ids when loading progress', () => {
    const valid = [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }];
    saveProgress(BASICS_STORAGE_KEY, {
      completedIds: ['b1', 'removed-lesson'],
      activeLessonId: 'b2',
    });

    expect(loadProgress(BASICS_STORAGE_KEY, valid)).toEqual({
      completedIds: ['b1'],
      activeLessonId: 'b2',
    });

    localStorage.setItem(
      BASICS_STORAGE_KEY,
      JSON.stringify({ completedIds: ['b3'], activeLessonId: 'missing' })
    );
    expect(loadProgress(BASICS_STORAGE_KEY, valid)).toEqual({
      completedIds: ['b3'],
      activeLessonId: 'b1',
    });
  });

  it('encodes UTF-8 and binary bytes to base64 and routes native exports via shareFile', async () => {
    const sampleText = '{"name":"폴드7 스케치"}';
    const textB64 = utf8ToBase64(sampleText);
    const decodedText = new TextDecoder().decode(Uint8Array.from(atob(textB64), (c) => c.charCodeAt(0)));
    expect(decodedText).toBe(sampleText);

    const rawBytes = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0x00, 0xff]);
    const binB64 = uint8ArrayToBase64(rawBytes);
    expect(Array.from(Uint8Array.from(atob(binB64), (c) => c.charCodeAt(0)))).toEqual(Array.from(rawBytes));

    const shareFile = vi.fn<NativeFileExporter['shareFile']>(async () => undefined);
    const nativeExporter: NativeFileExporter = {
      isNative: () => true,
      shareFile,
    };

    await downloadTextFile('test_song.json', sampleText, 'application/json', nativeExporter);
    expect(shareFile).toHaveBeenCalledWith({
      filename: 'test_song.json',
      base64Data: textB64,
      title: 'test_song.json',
      mime: 'application/json',
    });

    const project = createDefaultProject();
    const compiled = compileSong(project, 'piano');
    await downloadMidi(compiled, project, 'piano', nativeExporter);
    expect(shareFile).toHaveBeenCalledTimes(2);
    const midiCall = shareFile.mock.calls[1][0];
    expect(midiCall.filename).toBe('motif_C_major.mid');
    expect(midiCall.mime).toBe('audio/midi');
    const midiHeader = atob(midiCall.base64Data).slice(0, 4);
    expect(midiHeader).toBe('MThd');

    // 웹 환경(isNative: false)에서는 네이티브 shareFile 대신 Blob URL 다운로드를 사용한다.
    shareFile.mockClear();
    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    const createUrlMock = vi.fn(() => 'blob:motif-test');
    const revokeUrlMock = vi.fn();
    URL.createObjectURL = createUrlMock;
    URL.revokeObjectURL = revokeUrlMock;
    try {
      await downloadTextFile('web.json', sampleText, 'application/json', {
        isNative: () => false,
        shareFile,
      });
      expect(shareFile).not.toHaveBeenCalled();
      expect(createUrlMock).toHaveBeenCalledTimes(1);
      expect(revokeUrlMock).toHaveBeenCalledWith('blob:motif-test');
    } finally {
      URL.createObjectURL = origCreateObjectURL;
      URL.revokeObjectURL = origRevokeObjectURL;
    }
  });
});
