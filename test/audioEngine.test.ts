import { describe, expect, it, vi } from 'vitest';
import {
  MotifAudioEngine,
  type SampleLoadStatus,
  type SamplerBundle,
  type SamplerVoice,
  toMidiVelocity,
} from '../src/audio/instruments';
import { PRESETS } from '../src/core/model';

function makeAudioParam(initial = 0) {
  return {
    value: initial,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}

function createMockAudioContext() {
  const createdOscillators: Array<{ stop: ReturnType<typeof vi.fn>; onended?: (() => void) | null }> = [];
  const ctx = {
    currentTime: 10,
    sampleRate: 44100,
    state: 'running',
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    createDynamicsCompressor: vi.fn(() => ({
      threshold: makeAudioParam(),
      knee: makeAudioParam(),
      ratio: makeAudioParam(),
      attack: makeAudioParam(),
      release: makeAudioParam(),
      connect: vi.fn(),
    })),
    createGain: vi.fn(() => ({
      gain: {
        ...makeAudioParam(1),
        cancelScheduledValues: vi.fn(),
      },
      connect: vi.fn(),
    })),
    createBiquadFilter: vi.fn(() => ({
      type: 'lowpass',
      frequency: makeAudioParam(),
      Q: makeAudioParam(),
      gain: makeAudioParam(),
      connect: vi.fn(),
    })),
    createOscillator: vi.fn(() => {
      const osc = {
        type: 'sine',
        frequency: makeAudioParam(),
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as (() => void) | null,
      };
      createdOscillators.push(osc);
      return osc;
    }),
    createBuffer: vi.fn((_ch: number, len: number) => ({
      getChannelData: () => new Float32Array(len),
    })),
    createBufferSource: vi.fn(() => ({
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as (() => void) | null,
    })),
  } as unknown as AudioContext;

  return { ctx, createdOscillators };
}

function deferredVoice() {
  let resolveLoad!: (val?: unknown) => void;
  let rejectLoad!: (err?: unknown) => void;
  const load = new Promise<unknown>((res, rej) => {
    resolveLoad = res;
    rejectLoad = rej;
  });
  const start = vi.fn();
  const stop = vi.fn();
  const voice: SamplerVoice = { load, start, stop };
  return { voice, start, stop, resolveLoad, rejectLoad };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('MotifAudioEngine sampler lifecycle and fallback', () => {
  it('uses clean fallback while loading and delegates to samplers once resolved', async () => {
    const { ctx, createdOscillators } = createMockAudioContext();
    const piano = deferredVoice();
    const guitar = deferredVoice();
    const bass = deferredVoice();
    const drums = deferredVoice();

    const bundle: SamplerBundle = {
      piano: piano.voice,
      guitar: guitar.voice,
      bass: bass.voice,
      drums: drums.voice,
      drumMap: { kick: 'kick', snare: 'snare-m', hat: 'hhclosed-short' },
    };

    const statuses: SampleLoadStatus[] = [];
    const engine = new MotifAudioEngine(() => bundle, () => ctx);
    engine.onSampleStatusChange((s) => statuses.push(s));

    expect(engine.getSampleStatus()).toBe('idle');

    // 로딩 중 첫 호출에서는 폴백 신스로 즉시 재생되고 샘플러 start는 호출되지 않는다.
    engine.playPiano(60, 10.5, 0.5, 0.8);
    engine.playGuitar(64, 10.5, 0.4, 0.7);
    expect(engine.getSampleStatus()).toBe('loading');
    expect(createdOscillators.length).toBeGreaterThan(0);
    expect(piano.start).not.toHaveBeenCalled();
    expect(guitar.start).not.toHaveBeenCalled();

    // 샘플 로딩 완료 후에는 각 악기 샘플러로 정확히 위임된다.
    piano.resolveLoad();
    guitar.resolveLoad();
    bass.resolveLoad();
    drums.resolveLoad();
    await flushMicrotasks();

    expect(engine.getSampleStatus()).toBe('ready');

    engine.playPiano(60, 11.0, 0.5, 0.8);
    expect(piano.start).toHaveBeenCalledWith({
      note: 60,
      time: 11.0,
      duration: expect.closeTo(0.54, 5),
      velocity: toMidiVelocity(0.8),
    });

    engine.playGuitar(64, 11.2, 0.4, 0.75);
    expect(guitar.start).toHaveBeenCalledWith({
      note: 64,
      time: 11.2,
      duration: expect.closeTo(0.48, 5),
      velocity: toMidiVelocity(0.75),
    });

    engine.playBass(36, 11.4, 0.25, 0.9);
    expect(bass.start).toHaveBeenCalledWith({
      note: 36,
      time: 11.4,
      duration: 0.25,
      velocity: toMidiVelocity(0.9),
    });

    engine.playDrum('snare', 11.6, 0.6);
    expect(drums.start).toHaveBeenCalledWith({
      note: 'snare-m',
      time: 11.6,
      velocity: toMidiVelocity(0.6),
    });

    // 약박 벨로시티(0.4)는 제곱 감쇠 보정 커브에 의해 단순 선형(0.4 * 127)보다 높게 유지된다.
    expect(toMidiVelocity(0.4)).toBeGreaterThan(Math.round(0.4 * 127));
    expect(toMidiVelocity(0)).toBeGreaterThanOrEqual(1);
    expect(toMidiVelocity(1.5)).toBeLessThanOrEqual(127);

    engine.stopAll();
    expect(piano.stop).toHaveBeenCalledWith(10);
    expect(guitar.stop).toHaveBeenCalledWith(10);
    expect(bass.stop).toHaveBeenCalledWith(10);
    expect(drums.stop).toHaveBeenCalledWith(10);
    expect(statuses).toEqual(['idle', 'loading', 'ready']);
  });

  it('falls back cleanly without unhandled rejections when all sample loads fail', async () => {
    const { ctx, createdOscillators } = createMockAudioContext();
    const piano = deferredVoice();
    const guitar = deferredVoice();
    const bass = deferredVoice();
    const drums = deferredVoice();

    const engine = new MotifAudioEngine(
      () => ({
        piano: piano.voice,
        guitar: guitar.voice,
        bass: bass.voice,
        drums: drums.voice,
        drumMap: { kick: 'kick', snare: 'snare-m', hat: 'hhclosed-short' },
      }),
      () => ctx
    );

    engine.preload();
    expect(engine.getSampleStatus()).toBe('loading');

    piano.rejectLoad(new Error('network error'));
    guitar.rejectLoad(new Error('network error'));
    bass.rejectLoad(new Error('network error'));
    drums.rejectLoad(new Error('network error'));
    await flushMicrotasks();

    expect(engine.getSampleStatus()).toBe('fallback');
    const oscBefore = createdOscillators.length;
    engine.playPiano(60, 10.2, 0.4, 0.7);
    engine.playGuitar(67, 10.3, 0.4, 0.7);
    engine.playBass(36, 10.4, 0.4, 0.7);
    engine.playDrum('kick', 10.5, 0.8);

    expect(createdOscillators.length).toBeGreaterThan(oscBefore);
    expect(piano.start).not.toHaveBeenCalled();
    expect(guitar.start).not.toHaveBeenCalled();
    expect(bass.start).not.toHaveBeenCalled();
    expect(drums.start).not.toHaveBeenCalled();

    // 폴백 재생 중 stopAll 호출 시 스케줄된 폴백 오실레이터도 즉시 정지된다.
    const stopsBefore = createdOscillators.reduce((sum, osc) => sum + osc.stop.mock.calls.length, 0);
    engine.stopAll();
    const stopsAfter = createdOscillators.reduce((sum, osc) => sum + osc.stop.mock.calls.length, 0);
    expect(stopsAfter).toBeGreaterThan(stopsBefore);
    expect(createdOscillators[createdOscillators.length - 1].stop).toHaveBeenLastCalledWith(10);
  });

  it('transitions to fallback on sample load timeout and recovers if a voice resolves later', async () => {
    vi.useFakeTimers();
    try {
      const { ctx } = createMockAudioContext();
      const piano = deferredVoice();
      const guitar = deferredVoice();
      const bass = deferredVoice();
      const drums = deferredVoice();

      const engine = new MotifAudioEngine(
        () => ({
          piano: piano.voice,
          guitar: guitar.voice,
          bass: bass.voice,
          drums: drums.voice,
          drumMap: { kick: 'kick', snare: 'snare-m', hat: 'hhclosed-short' },
        }),
        () => ctx,
        25
      );

      engine.preload();
      expect(engine.getSampleStatus()).toBe('loading');

      vi.advanceTimersByTime(30);
      expect(engine.getSampleStatus()).toBe('fallback');

      piano.resolveLoad();
      await flushMicrotasks();
      expect(engine.getSampleStatus()).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('plays metronome accent and beat clicks at preset frequencies and stops cleanly on stopAll', () => {
    const { ctx, createdOscillators } = createMockAudioContext();
    const voice = deferredVoice().voice;
    const engine = new MotifAudioEngine(
      () => ({
        piano: voice,
        guitar: voice,
        bass: voice,
        drums: voice,
        drumMap: { kick: 'kick', snare: 'snare-m', hat: 'hhclosed-short' },
      }),
      () => ctx
    );

    const before = createdOscillators.length;
    engine.playMetronome(true, 10.1);
    engine.playMetronome(false, 10.6);
    expect(createdOscillators.length).toBe(before + 2);

    const oscCalls = (ctx.createOscillator as ReturnType<typeof vi.fn>).mock.results.map(
      (r) => r.value as { frequency: { setValueAtTime: ReturnType<typeof vi.fn> }; stop: ReturnType<typeof vi.fn> }
    );
    const accentOsc = oscCalls[oscCalls.length - 2];
    const beatOsc = oscCalls[oscCalls.length - 1];
    expect(accentOsc.frequency.setValueAtTime).toHaveBeenCalledWith(
      PRESETS.playback.metronome.accentFreqHz,
      10.1
    );
    expect(beatOsc.frequency.setValueAtTime).toHaveBeenCalledWith(
      PRESETS.playback.metronome.beatFreqHz,
      10.6
    );

    engine.stopAll();
    expect(accentOsc.stop).toHaveBeenLastCalledWith(10);
    expect(beatOsc.stop).toHaveBeenLastCalledWith(10);
  });
});
