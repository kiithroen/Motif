import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MotifAudioEngine } from '../src/audio/instruments';
import { MotifTransport } from '../src/audio/transport';
import { compileSong } from '../src/core/compiler';
import { createDefaultProject } from '../src/core/model';

function createMockAudio() {
  let fakeNow = 0;
  const playedPitches: number[] = [];
  const engine = {
    get currentTime() {
      return fakeNow;
    },
    ensureContext() {
      return { currentTime: fakeNow };
    },
    playGuitar: vi.fn((midi: number) => {
      playedPitches.push(midi);
    }),
    playPiano: vi.fn((midi: number) => {
      playedPitches.push(midi);
    }),
    playBass: vi.fn(),
    playDrum: vi.fn(),
  } as unknown as MotifAudioEngine;

  return {
    engine,
    playedPitches,
    advance(sec: number) {
      fakeNow += sec;
    },
  };
}

describe('MotifTransport preview preservation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('plays preview once, fires onStop, and restores original main song on next start', () => {
    const mock = createMockAudio();
    const mainProj = createDefaultProject();
    mainProj.baked = true;
    mainProj.bakedMelody = [{ id: 'main_1', midi: 60, step: 0, duration: 4, velocity: 0.8 }];

    const previewProj = createDefaultProject();
    previewProj.baked = true;
    previewProj.bakedMelody = [{ id: 'prev_1', midi: 79, step: 0, duration: 4, velocity: 0.8 }];

    const mainSong = compileSong(mainProj);
    const previewSong = compileSong(previewProj);

    const onStop = vi.fn();
    const transport = new MotifTransport(mock.engine, mainSong, { onStop });
    const mutes = { melody: false, chords: true, bass: true, drums: true };

    transport.playOncePreview(previewSong, 120, 'piano', mutes);
    expect(transport.isPlaying()).toBe(true);

    // 4마디(64스텝 @ 120BPM = 8초) 동안 25ms 스케줄러 틱을 진행시킨다.
    for (let i = 0; i < 400; i++) {
      mock.advance(0.025);
      vi.advanceTimersByTime(25);
    }

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(transport.isPlaying()).toBe(false);
    expect(mock.playedPitches).toContain(79);
    expect(mock.playedPitches).not.toContain(60);

    // 미리듣기 후 다시 재생하면 원본 mainSong 이 재생되어야 한다.
    mock.playedPitches.length = 0;
    transport.start(true);
    mock.advance(0.05);
    vi.advanceTimersByTime(50);
    expect(mock.playedPitches).toContain(60);
    expect(mock.playedPitches).not.toContain(79);

    transport.stop();
  });

  it('plays chords with piano by default and switches to guitar when requested', () => {
    const mock = createMockAudio();
    const song = compileSong(createDefaultProject());
    const transport = new MotifTransport(mock.engine, song);
    const mutes = { melody: true, chords: false, bass: true, drums: true };

    transport.updateSong(song, 120, 'piano', mutes);
    transport.start(true);
    mock.advance(0.05);
    vi.advanceTimersByTime(50);

    expect(mock.engine.playPiano).toHaveBeenCalled();
    expect(mock.engine.playGuitar).not.toHaveBeenCalled();
    transport.stop();

    vi.mocked(mock.engine.playPiano).mockClear();
    vi.mocked(mock.engine.playGuitar).mockClear();

    transport.updateSong(song, 120, 'piano', mutes, 'guitar');
    transport.start(true);
    mock.advance(0.05);
    vi.advanceTimersByTime(50);

    expect(mock.engine.playGuitar).toHaveBeenCalled();
    expect(mock.engine.playPiano).not.toHaveBeenCalled();
    transport.stop();
  });
});
