// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BASICS_STORAGE_KEY,
  CHORD_VIEW_STORAGE_KEY,
  LIBRARY_STORAGE_KEY,
  MIXER_VOLUMES_STORAGE_KEY,
  MODE_STORAGE_KEY,
  STORAGE_KEY,
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
} from '../src/app/storage';
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
});
