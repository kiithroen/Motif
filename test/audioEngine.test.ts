import { describe, expect, it, vi } from 'vitest';
import {
  MotifAudioEngine,
  type SampleLoadStatus,
  type SamplerBundle,
  type SamplerVoice,
} from '../src/audio/instruments';

function makeAudioParam(initial = 0) {
  return {
    value: initial,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}

function createMockAudioContext() {
  const createdOscillators: unknown[] = [];
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
      gain: makeAudioParam(1),
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
      velocity: 102,
    });

    engine.playGuitar(64, 11.2, 0.4, 0.75);
    expect(guitar.start).toHaveBeenCalledWith({
      note: 64,
      time: 11.2,
      duration: expect.closeTo(0.48, 5),
      velocity: 95,
    });

    engine.playBass(36, 11.4, 0.25, 0.9);
    expect(bass.start).toHaveBeenCalledWith({
      note: 36,
      time: 11.4,
      duration: 0.25,
      velocity: 114,
    });

    engine.playDrum('snare', 11.6, 0.6);
    expect(drums.start).toHaveBeenCalledWith({
      note: 'snare-m',
      time: 11.6,
      velocity: 76,
    });

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
  });
});
