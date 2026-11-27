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
    playMetronome: vi.fn(),
    stopAll: vi.fn(),
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
    expect(mock.engine.stopAll).toHaveBeenCalled();
  });

  it('seeks to a specific bar from stopped or playing state', () => {
    const mock = createMockAudio();
    const proj = createDefaultProject();
    proj.bars = 4;
    proj.baked = true;
    proj.bakedMelody = [
      { id: 'm0', midi: 60, step: 0, duration: 4, velocity: 0.8 },
      { id: 'm2', midi: 67, step: 32, duration: 4, velocity: 0.8 },
    ];
    const song = compileSong(proj);
    const onStep = vi.fn();
    const transport = new MotifTransport(mock.engine, song, { onStep });
    const mutes = { melody: false, chords: true, bass: true, drums: true };
    transport.updateSong(song, 120, 'piano', mutes);

    // 정지 상태에서 3마디(bar 2, step 32) 클릭 시 해당 마디부터 바로 재생 시작한다.
    transport.seekToBar(2);
    expect(transport.isPlaying()).toBe(true);
    expect(onStep).toHaveBeenLastCalledWith(32);

    mock.advance(0.05);
    vi.advanceTimersByTime(50);
    expect(mock.playedPitches).toContain(67);
    expect(mock.playedPitches).not.toContain(60);

    // 재생 중 1마디(bar 0, step 0)로 Seek 하면 기존 소리를 끊고 즉시 점프한다.
    mock.playedPitches.length = 0;
    transport.seekToBar(0);
    expect(mock.engine.stopAll).toHaveBeenCalled();
    expect(onStep).toHaveBeenLastCalledWith(0);

    mock.advance(0.05);
    vi.advanceTimersByTime(50);
    expect(mock.playedPitches).toContain(60);

    transport.stop();
  });

  it('loops only within selected bars and does not affect one-shot previews', () => {
    const mock = createMockAudio();
    const proj = createDefaultProject();
    proj.bars = 4;
    proj.baked = true;
    proj.bakedMelody = [
      { id: 'b0', midi: 60, step: 0, duration: 4, velocity: 0.8 },
      { id: 'b1', midi: 64, step: 16, duration: 4, velocity: 0.8 },
      { id: 'b2', midi: 67, step: 32, duration: 4, velocity: 0.8 },
    ];
    const song = compileSong(proj);
    const transport = new MotifTransport(mock.engine, song);
    const mutes = { melody: false, chords: true, bass: true, drums: true };
    transport.updateSong(song, 120, 'piano', mutes);

    // 2마디(bar 1, step 16..31)만 반복 지정
    transport.setLoopRange({ startBar: 1, endBar: 1 });
    transport.start(true);

    // 120 BPM 에서 16스텝 = 2초, 5초 동안 진행해도 bar 1 음만 반복되고 bar 0/bar 2 는 울리지 않는다.
    for (let i = 0; i < 200; i++) {
      mock.advance(0.025);
      vi.advanceTimersByTime(25);
    }
    expect(mock.playedPitches).toContain(64);
    expect(mock.playedPitches).not.toContain(60);
    expect(mock.playedPitches).not.toContain(67);
    transport.stop();

    // playOncePreview 는 loopRange 설정과 무관하게 전체 프리뷰를 끝까지 재생한다.
    mock.playedPitches.length = 0;
    transport.playOncePreview(song, 120, 'piano', mutes);
    for (let i = 0; i < 360; i++) {
      mock.advance(0.025);
      vi.advanceTimersByTime(25);
    }
    expect(mock.playedPitches).toContain(60);
    expect(mock.playedPitches).toContain(64);
    expect(mock.playedPitches).toContain(67);
  });

  it('scales melody and chord volumes independently and triggers metronome except during previews', () => {
    const mock = createMockAudio();
    const proj = createDefaultProject();
    proj.bars = 4;
    proj.baked = true;
    proj.bakedMelody = [{ id: 'm0', midi: 72, step: 0, duration: 4, velocity: 0.8 }];
    const song = compileSong(proj);
    const transport = new MotifTransport(mock.engine, song);

    transport.updateSong(
      song,
      120,
      'piano',
      { melody: false, chords: false, bass: true, drums: true, pad: true },
      'piano',
      { melody: 0.5, chords: 0, bass: 1, drums: 1, pad: 0 }
    );
    transport.setMetronome(true);
    transport.start(true);

    // 120 BPM 에서 1박 = 0.5초 -> step 0 (강박)과 step 4 (약박) 모두 스케줄되도록 0.55초 진행
    for (let i = 0; i < 22; i++) {
      mock.advance(0.025);
      vi.advanceTimersByTime(25);
    }

    // chords 볼륨이 0이므로 멜로디 음(72)만 스케일된 벨로시티로 재생된다.
    const pianoCalls = vi.mocked(mock.engine.playPiano).mock.calls;
    expect(pianoCalls.length).toBeGreaterThanOrEqual(1);
    expect(pianoCalls.every((c) => c[0] === 72)).toBe(true);
    expect(pianoCalls[0][3]).toBeCloseTo(0.4, 5);

    const metroCalls = vi.mocked(mock.engine.playMetronome).mock.calls;
    expect(metroCalls.some((c) => c[0] === true)).toBe(true);
    expect(metroCalls.some((c) => c[0] === false)).toBe(true);
    transport.stop();

    // 프리뷰 재생 중에는 메트로놈 클릭이 울리지 않는다.
    vi.mocked(mock.engine.playMetronome).mockClear();
    transport.playOncePreview(song, 120, 'piano', {
      melody: false,
      chords: true,
      bass: true,
      drums: true,
    });
    mock.advance(0.1);
    vi.advanceTimersByTime(100);
    expect(mock.engine.playMetronome).not.toHaveBeenCalled();
    transport.stop();
  });
});
