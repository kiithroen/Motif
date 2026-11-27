import { CacheStorage, DrumMachine, Soundfont, SplendidGrandPiano } from 'smplr';
import type { ChordInstrument, DrumKind } from '../core/model';

export type SampleLoadStatus = 'idle' | 'loading' | 'ready' | 'fallback';

export interface SamplerVoice {
  load: Promise<unknown>;
  start(opts: { note: number | string; time?: number; duration?: number; velocity?: number }): unknown;
  stop?(time?: number): void;
}

export interface SamplerBundle {
  piano: SamplerVoice;
  guitar: SamplerVoice;
  bass: SamplerVoice;
  drums: SamplerVoice;
  drumMap: Record<DrumKind, string>;
}

export interface SamplerBuses {
  piano: AudioNode;
  guitar: AudioNode;
  bass: AudioNode;
  drums: AudioNode;
}

export type SamplerFactory = (ctx: AudioContext, buses: SamplerBuses) => SamplerBundle;

type VoiceKey = 'piano' | 'guitar' | 'bass' | 'drums';

const PIANO_SAMPLE_NOTES = [40, 45, 48, 52, 55, 60, 64, 67, 72, 76, 79, 83, 86];
const GUITAR_SAMPLE_NOTES = [40, 43, 45, 48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84];
const BASS_SAMPLE_NOTES = [28, 31, 33, 36, 38, 40, 43, 45, 48, 50, 52, 55, 57, 60];

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function toMidiVelocity(velocity: number): number {
  return Math.max(1, Math.min(127, Math.round(velocity * 127)));
}

function createDefaultSamplerBundle(ctx: AudioContext, buses: SamplerBuses): SamplerBundle {
  const storage = typeof window !== 'undefined' && 'caches' in window ? CacheStorage('motif-smplr-v1') : undefined;

  const piano = SplendidGrandPiano(ctx, {
    destination: buses.piano,
    storage,
    volume: 104,
    decayTime: 0.35,
    notesToLoad: {
      notes: PIANO_SAMPLE_NOTES,
      fallback: 'nearest',
    },
  });

  const guitar = Soundfont(ctx, {
    instrument: 'acoustic_guitar_nylon',
    destination: buses.guitar,
    storage,
    volume: 108,
    notesToLoad: {
      notes: GUITAR_SAMPLE_NOTES,
      fallback: 'nearest',
    },
  });

  const bass = Soundfont(ctx, {
    instrument: 'electric_bass_finger',
    destination: buses.bass,
    storage,
    volume: 104,
    notesToLoad: {
      notes: BASS_SAMPLE_NOTES,
      fallback: 'nearest',
    },
  });

  const drums = DrumMachine(ctx, {
    instrument: 'LM-2',
    destination: buses.drums,
    storage,
    volume: 98,
  });

  return {
    piano,
    guitar,
    bass,
    drums,
    drumMap: {
      kick: 'kick',
      snare: 'snare-m',
      hat: 'hhclosed-short',
    },
  };
}

export class MotifAudioEngine {
  private readonly samplerFactory: SamplerFactory;
  private readonly contextFactory?: () => AudioContext;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private pianoBus: AudioNode | null = null;
  private guitarBus: AudioNode | null = null;
  private bassBus: AudioNode | null = null;
  private drumBus: AudioNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  private samplers: SamplerBundle | null = null;
  private readyVoices: Record<VoiceKey, boolean> = {
    piano: false,
    guitar: false,
    bass: false,
    drums: false,
  };
  private sampleStatus: SampleLoadStatus = 'idle';
  private statusListeners = new Set<(status: SampleLoadStatus) => void>();

  constructor(samplerFactory: SamplerFactory = createDefaultSamplerBundle, contextFactory?: () => AudioContext) {
    this.samplerFactory = samplerFactory;
    this.contextFactory = contextFactory;
  }

  public getSampleStatus(): SampleLoadStatus {
    return this.sampleStatus;
  }

  public onSampleStatusChange(listener: (status: SampleLoadStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.sampleStatus);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setSampleStatus(next: SampleLoadStatus): void {
    if (this.sampleStatus === next) return;
    this.sampleStatus = next;
    for (const listener of this.statusListeners) {
      listener(next);
    }
  }

  public preload(): void {
    this.ensureContext();
  }

  public ensureContext(): AudioContext {
    if (!this.ctx) {
      const ctx = this.contextFactory
        ? this.contextFactory()
        : new (window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      this.ctx = ctx;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -4;
      comp.knee.value = 12;
      comp.ratio.value = 2.0;
      comp.attack.value = 0.008;
      comp.release.value = 0.2;

      const master = ctx.createGain();
      master.gain.value = 0.9;
      comp.connect(master);
      master.connect(ctx.destination);

      // 화이트 노이즈 리버브를 제거하고 악기별 대역을 분리해 선명도를 확보한다.
      const pianoGain = ctx.createGain();
      pianoGain.gain.value = 0.95;
      pianoGain.connect(comp);

      const guitarLowCut = ctx.createBiquadFilter();
      guitarLowCut.type = 'peaking';
      guitarLowCut.frequency.value = 220;
      guitarLowCut.Q.value = 1.2;
      guitarLowCut.gain.value = -2;

      const guitarPresence = ctx.createBiquadFilter();
      guitarPresence.type = 'peaking';
      guitarPresence.frequency.value = 2800;
      guitarPresence.Q.value = 1.0;
      guitarPresence.gain.value = 1.5;

      const guitarGain = ctx.createGain();
      guitarGain.gain.value = 0.92;
      guitarLowCut.connect(guitarPresence);
      guitarPresence.connect(guitarGain);
      guitarGain.connect(comp);

      const bassLp = ctx.createBiquadFilter();
      bassLp.type = 'lowpass';
      bassLp.frequency.value = 1500;

      const bassGain = ctx.createGain();
      bassGain.gain.value = 0.88;
      bassLp.connect(bassGain);
      bassGain.connect(comp);

      const drumGain = ctx.createGain();
      drumGain.gain.value = 0.78;
      drumGain.connect(comp);

      this.master = master;
      this.pianoBus = pianoGain;
      this.guitarBus = guitarLowCut;
      this.bassBus = bassLp;
      this.drumBus = drumGain;
      this.noiseBuf = this.buildNoiseBuffer(ctx);

      this.initSamplers(ctx, {
        piano: pianoGain,
        guitar: guitarLowCut,
        bass: bassLp,
        drums: drumGain,
      });
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private initSamplers(ctx: AudioContext, buses: SamplerBuses): void {
    this.setSampleStatus('loading');
    try {
      const bundle = this.samplerFactory(ctx, buses);
      this.samplers = bundle;
      const keys: VoiceKey[] = ['piano', 'guitar', 'bass', 'drums'];
      let remaining = keys.length;
      let loadedCount = 0;

      for (const key of keys) {
        const voice = bundle[key];
        Promise.resolve(voice.load)
          .then(() => {
            this.readyVoices[key] = true;
            loadedCount += 1;
          })
          .catch(() => {
            this.readyVoices[key] = false;
          })
          .finally(() => {
            remaining -= 1;
            if (remaining === 0) {
              this.setSampleStatus(loadedCount > 0 ? 'ready' : 'fallback');
            }
          });
      }
    } catch {
      this.samplers = null;
      this.setSampleStatus('fallback');
    }
  }

  public get currentTime(): number {
    return this.ensureContext().currentTime;
  }

  public stopAll(): void {
    if (!this.samplers) return;
    const t = this.ctx?.currentTime;
    const voices: VoiceKey[] = ['piano', 'guitar', 'bass', 'drums'];
    for (const key of voices) {
      if (!this.readyVoices[key]) continue;
      try {
        this.samplers[key].stop?.(t);
      } catch {
        // 개별 샘플러 정지 오류는 무시한다.
      }
    }
  }

  private buildNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  public playPiano(midi: number, when: number, durationSec: number, velocity = 0.75, _wetAmt = 0.28): void {
    const ctx = this.ensureContext();
    const t0 = Math.max(ctx.currentTime, when);

    if (this.readyVoices.piano && this.samplers) {
      try {
        this.samplers.piano.start({
          note: midi,
          time: t0,
          duration: Math.max(0.12, durationSec + 0.04),
          velocity: toMidiVelocity(velocity),
        });
        return;
      } catch {
        // 샘플 재생 예외 시 폴백 신스로 복구한다.
      }
    }
    this.playFallbackPiano(ctx, midi, t0, durationSec, velocity);
  }

  public playGuitar(midi: number, when: number, durationSec: number, velocity = 0.72, _wetAmt = 0.2): void {
    const ctx = this.ensureContext();
    const t0 = Math.max(ctx.currentTime, when);

    if (this.readyVoices.guitar && this.samplers) {
      try {
        this.samplers.guitar.start({
          note: midi,
          time: t0,
          duration: Math.max(0.16, durationSec + 0.08),
          velocity: toMidiVelocity(velocity),
        });
        return;
      } catch {
        // 샘플 재생 예외 시 폴백 신스로 복구한다.
      }
    }
    this.playFallbackGuitar(ctx, midi, t0, durationSec, velocity);
  }

  public playBass(midi: number, when: number, durationSec: number, velocity = 0.75): void {
    const ctx = this.ensureContext();
    const t0 = Math.max(ctx.currentTime, when);

    if (this.readyVoices.bass && this.samplers) {
      try {
        this.samplers.bass.start({
          note: midi,
          time: t0,
          duration: Math.max(0.12, durationSec),
          velocity: toMidiVelocity(velocity),
        });
        return;
      } catch {
        // 샘플 재생 예외 시 폴백 신스로 복구한다.
      }
    }
    this.playFallbackBass(ctx, midi, t0, durationSec, velocity);
  }

  public playDrum(kind: DrumKind, when: number, velocity = 0.75): void {
    const ctx = this.ensureContext();
    const t0 = Math.max(ctx.currentTime, when);

    if (this.readyVoices.drums && this.samplers) {
      try {
        const note = this.samplers.drumMap[kind];
        this.samplers.drums.start({
          note,
          time: t0,
          velocity: toMidiVelocity(velocity),
        });
        return;
      } catch {
        // 샘플 재생 예외 시 폴백 신스로 복구한다.
      }
    }
    this.playFallbackDrum(ctx, kind, t0, velocity);
  }

  private playFallbackPiano(
    ctx: AudioContext,
    midi: number,
    t0: number,
    durationSec: number,
    velocity: number
  ): void {
    if (!this.pianoBus || !this.master) return;
    const freq = midiToFreq(midi);
    const rel = Math.min(0.4, Math.max(0.16, durationSec * 0.35));
    const end = t0 + Math.max(0.08, durationSec) + rel;

    // 기음 + 2배음 + 3배음 가산 합성으로 FM 잡음 없이 맑은 음색을 만든다.
    const fundamental = ctx.createOscillator();
    fundamental.type = 'sine';
    fundamental.frequency.setValueAtTime(freq, t0);

    const h2 = ctx.createOscillator();
    h2.type = 'sine';
    h2.frequency.setValueAtTime(freq * 2, t0);
    const h2Gain = ctx.createGain();
    h2Gain.gain.value = 0.22;

    const h3 = ctx.createOscillator();
    h3.type = 'sine';
    h3.frequency.setValueAtTime(freq * 3, t0);
    const h3Gain = ctx.createGain();
    h3Gain.gain.value = 0.08;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(5400, freq * (3.6 + velocity * 1.8)), t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(700, freq * 2.0), end);

    const env = ctx.createGain();
    const peak = Math.max(0.01, Math.min(0.28, velocity * 0.24));
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + 0.005);
    env.gain.exponentialRampToValueAtTime(peak * 0.5, t0 + Math.max(0.06, durationSec * 0.6));
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    fundamental.connect(filter);
    h2.connect(h2Gain);
    h2Gain.connect(filter);
    h3.connect(h3Gain);
    h3Gain.connect(filter);
    filter.connect(env);
    env.connect(this.pianoBus);

    fundamental.start(t0);
    h2.start(t0);
    h3.start(t0);
    fundamental.stop(end + 0.02);
    h2.stop(end + 0.02);
    h3.stop(end + 0.02);
  }

  private playFallbackGuitar(
    ctx: AudioContext,
    midi: number,
    t0: number,
    durationSec: number,
    velocity: number
  ): void {
    if (!this.guitarBus) return;
    const freq = midiToFreq(midi);
    const end = t0 + Math.max(0.14, durationSec) + 0.26;

    // 6ms 페이드인 어택과 나일론 현 배음 감쇠로 노이즈와 음정 오차를 방지한다.
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(freq, t0);

    const harmonic = ctx.createOscillator();
    harmonic.type = 'sine';
    harmonic.frequency.setValueAtTime(freq * 2, t0);
    const harmonicGain = ctx.createGain();
    harmonicGain.gain.value = 0.18;

    const pluckFilter = ctx.createBiquadFilter();
    pluckFilter.type = 'lowpass';
    pluckFilter.frequency.setValueAtTime(Math.min(4800, freq * (4.2 + velocity * 1.4)), t0);
    pluckFilter.frequency.exponentialRampToValueAtTime(Math.max(680, freq * 1.9), t0 + 0.35);

    const env = ctx.createGain();
    const peak = Math.max(0.01, Math.min(0.32, velocity * 0.28));
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + 0.006);
    env.gain.exponentialRampToValueAtTime(peak * 0.42, t0 + Math.max(0.08, durationSec * 0.55));
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    body.connect(pluckFilter);
    harmonic.connect(harmonicGain);
    harmonicGain.connect(pluckFilter);
    pluckFilter.connect(env);
    env.connect(this.guitarBus);

    body.start(t0);
    harmonic.start(t0);
    body.stop(end + 0.02);
    harmonic.stop(end + 0.02);
  }

  private playFallbackBass(
    ctx: AudioContext,
    midi: number,
    t0: number,
    durationSec: number,
    velocity: number
  ): void {
    if (!this.bassBus) return;
    const freq = midiToFreq(midi);
    const end = t0 + Math.max(0.08, durationSec) + 0.14;

    const tri = ctx.createOscillator();
    tri.type = 'triangle';
    tri.frequency.setValueAtTime(freq, t0);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(freq, t0);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(480 + velocity * 260, t0);
    lp.frequency.exponentialRampToValueAtTime(170, end);

    const env = ctx.createGain();
    const peak = Math.min(0.34, velocity * 0.28);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    tri.connect(lp);
    sub.connect(lp);
    lp.connect(env);
    env.connect(this.bassBus);

    tri.start(t0);
    sub.start(t0);
    tri.stop(end + 0.02);
    sub.stop(end + 0.02);
  }

  private playFallbackDrum(ctx: AudioContext, kind: DrumKind, t0: number, velocity: number): void {
    if (!this.drumBus || !this.noiseBuf) return;

    if (kind === 'kick') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(135, t0);
      osc.frequency.exponentialRampToValueAtTime(44, t0 + 0.09);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t0);
      g.gain.linearRampToValueAtTime(velocity * 0.55, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);

      osc.connect(g);
      g.connect(this.drumBus);
      osc.start(t0);
      osc.stop(t0 + 0.26);
      return;
    }

    if (kind === 'snare') {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1850;
      bp.Q.value = 0.9;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t0);
      ng.gain.linearRampToValueAtTime(velocity * 0.24, t0 + 0.003);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);

      const tone = ctx.createOscillator();
      tone.type = 'triangle';
      tone.frequency.setValueAtTime(185, t0);
      tone.frequency.exponentialRampToValueAtTime(110, t0 + 0.07);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, t0);
      tg.gain.linearRampToValueAtTime(velocity * 0.22, t0 + 0.003);
      tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);

      noise.connect(bp);
      bp.connect(ng);
      ng.connect(this.drumBus);
      tone.connect(tg);
      tg.connect(this.drumBus);

      noise.start(t0);
      noise.stop(t0 + 0.16);
      tone.start(t0);
      tone.stop(t0 + 0.1);
      return;
    }

    const hat = ctx.createBufferSource();
    hat.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6800;
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.0001, t0);
    hg.gain.linearRampToValueAtTime(velocity * 0.13, t0 + 0.002);
    hg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.055);
    hat.connect(hp);
    hp.connect(hg);
    hg.connect(this.drumBus);
    hat.start(t0);
    hat.stop(t0 + 0.065);
  }

  public auditionChord(midis: number[], instrument: ChordInstrument = 'piano'): void {
    const t0 = this.currentTime + 0.01;
    midis.forEach((m, idx) => {
      const offset = idx * 0.022;
      if (instrument === 'guitar') {
        this.playGuitar(m, t0 + offset, 1.1, 0.72, 0.25);
      } else {
        this.playPiano(m, t0 + offset * 0.4, 1.1, 0.65, 0.24);
      }
    });
  }
}
