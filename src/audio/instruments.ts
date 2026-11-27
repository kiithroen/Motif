import { CacheStorage, DrumMachine, Soundfont, SplendidGrandPiano } from 'smplr';
import { type ChordInstrument, type DrumKind, type MelodyInstrument, PRESETS } from '../core/model';

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

export function toMidiVelocity(velocity: number): number {
  const clamped = Math.max(0.02, Math.min(1, velocity));
  // smplr 내부 제곱 감쇠((vel/127)^2)로 약박이 과도하게 묻히지 않도록 지수 커브로 보정한다.
  return Math.max(1, Math.min(127, Math.round(Math.pow(clamped, 0.65) * 127)));
}

function createDefaultSamplerBundle(ctx: AudioContext, buses: SamplerBuses): SamplerBundle {
  const storage = typeof window !== 'undefined' && 'caches' in window ? CacheStorage('motif-smplr-v1') : undefined;

  const piano = SplendidGrandPiano(ctx, {
    destination: buses.piano,
    storage,
    volume: 127,
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
    volume: 127,
    extraGain: 7.5,
    notesToLoad: {
      notes: GUITAR_SAMPLE_NOTES,
      fallback: 'nearest',
    },
  });

  const bass = Soundfont(ctx, {
    instrument: 'electric_bass_finger',
    destination: buses.bass,
    storage,
    volume: 127,
    extraGain: 7.5,
    notesToLoad: {
      notes: BASS_SAMPLE_NOTES,
      fallback: 'nearest',
    },
  });

  const drums = DrumMachine(ctx, {
    instrument: 'LM-2',
    destination: buses.drums,
    storage,
    volume: 127,
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
      clap: 'clap',
    },
  };
}

type FallbackSourceNode = Pick<AudioScheduledSourceNode, 'stop' | 'onended'>;

interface FallbackGainNode {
  gain: {
    cancelScheduledValues?: (t: number) => void;
    setValueAtTime?: (v: number, t: number) => void;
  };
}

interface ActiveFallbackVoice {
  sources: FallbackSourceNode[];
  envs: FallbackGainNode[];
}

export class MotifAudioEngine {
  private readonly samplerFactory: SamplerFactory;
  private readonly contextFactory?: () => AudioContext;
  private readonly sampleLoadTimeoutMs: number;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private pianoBus: AudioNode | null = null;
  private guitarBus: AudioNode | null = null;
  private bassBus: AudioNode | null = null;
  private drumBus: AudioNode | null = null;
  private metronomeBus: AudioNode | null = null;
  private masterTone: BiquadFilterNode | null = null;
  private reverbSend: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private pulseWaveCache = new Map<number, PeriodicWave>();
  private extraSamplers = new Map<string, { voice: SamplerVoice; ready: boolean; loading: boolean }>();
  private reverbAmount = PRESETS.playback.effects.defaultReverb;
  private toneAmount = PRESETS.playback.effects.defaultTone;

  private samplers: SamplerBundle | null = null;
  private readyVoices: Record<VoiceKey, boolean> = {
    piano: false,
    guitar: false,
    bass: false,
    drums: false,
  };
  private activeFallbackVoices = new Set<ActiveFallbackVoice>();
  private sampleLoadTimerId: ReturnType<typeof setTimeout> | null = null;
  private sampleStatus: SampleLoadStatus = 'idle';
  private statusListeners = new Set<(status: SampleLoadStatus) => void>();

  constructor(
    samplerFactory: SamplerFactory = createDefaultSamplerBundle,
    contextFactory?: () => AudioContext,
    sampleLoadTimeoutMs = 15000
  ) {
    this.samplerFactory = samplerFactory;
    this.contextFactory = contextFactory;
    this.sampleLoadTimeoutMs = sampleLoadTimeoutMs;
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
      comp.threshold.value = -6;
      comp.knee.value = 14;
      comp.ratio.value = 2.5;
      comp.attack.value = 0.006;
      comp.release.value = 0.18;

      const master = ctx.createGain();
      master.gain.value = 0.92;
      master.connect(ctx.destination);

      const masterTone = ctx.createBiquadFilter();
      masterTone.type = 'highshelf';
      masterTone.frequency.value = 3200;
      masterTone.gain.value = this.toneAmount * 6;
      comp.connect(masterTone);
      masterTone.connect(master);

      const reverbSend = ctx.createGain();
      reverbSend.gain.value = this.reverbAmount * 0.45;
      if (typeof ctx.createConvolver === 'function') {
        try {
          const convolver = ctx.createConvolver();
          convolver.buffer = this.buildReverbImpulse(ctx);
          comp.connect(reverbSend);
          reverbSend.connect(convolver);
          convolver.connect(master);
        } catch {
          // Convolver 미지원 환경은 드라이 출력만 사용한다.
        }
      }
      this.masterTone = masterTone;
      this.reverbSend = reverbSend;

      // 그랜드 피아노 음압을 기준으로 낮추고 기타·베이스·드럼 존재감을 맞춘다.
      const pianoGain = ctx.createGain();
      pianoGain.gain.value = 0.76;
      pianoGain.connect(comp);

      const guitarLowCut = ctx.createBiquadFilter();
      guitarLowCut.type = 'peaking';
      guitarLowCut.frequency.value = 220;
      guitarLowCut.Q.value = 1.2;
      guitarLowCut.gain.value = -1.5;

      const guitarPresence = ctx.createBiquadFilter();
      guitarPresence.type = 'peaking';
      guitarPresence.frequency.value = 2600;
      guitarPresence.Q.value = 1.0;
      guitarPresence.gain.value = 2.5;

      const guitarGain = ctx.createGain();
      guitarGain.gain.value = 1.45;
      guitarLowCut.connect(guitarPresence);
      guitarPresence.connect(guitarGain);
      guitarGain.connect(comp);

      const bassPresence = ctx.createBiquadFilter();
      bassPresence.type = 'peaking';
      bassPresence.frequency.value = 900;
      bassPresence.Q.value = 1.0;
      bassPresence.gain.value = 2.5;

      const bassLp = ctx.createBiquadFilter();
      bassLp.type = 'lowpass';
      bassLp.frequency.value = 2400;

      const bassGain = ctx.createGain();
      bassGain.gain.value = 1.4;
      bassPresence.connect(bassLp);
      bassLp.connect(bassGain);
      bassGain.connect(comp);

      const drumGain = ctx.createGain();
      drumGain.gain.value = 1.45;
      drumGain.connect(comp);

      const metronomeGain = ctx.createGain();
      metronomeGain.gain.value = 0.85;
      metronomeGain.connect(comp);

      this.master = master;
      this.pianoBus = pianoGain;
      this.guitarBus = guitarLowCut;
      this.bassBus = bassPresence;
      this.drumBus = drumGain;
      this.metronomeBus = metronomeGain;
      this.noiseBuf = this.buildNoiseBuffer(ctx);

      this.initSamplers(ctx, {
        piano: pianoGain,
        guitar: guitarLowCut,
        bass: bassPresence,
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

      if (this.sampleLoadTimerId !== null) {
        globalThis.clearTimeout(this.sampleLoadTimerId);
        this.sampleLoadTimerId = null;
      }
      if (this.sampleLoadTimeoutMs > 0) {
        this.sampleLoadTimerId = globalThis.setTimeout(() => {
          this.sampleLoadTimerId = null;
          if (this.sampleStatus === 'loading') {
            this.setSampleStatus(loadedCount > 0 ? 'ready' : 'fallback');
          }
        }, this.sampleLoadTimeoutMs);
      }

      for (const key of keys) {
        const voice = bundle[key];
        Promise.resolve(voice.load)
          .then(() => {
            this.readyVoices[key] = true;
            loadedCount += 1;
            if (this.sampleStatus === 'fallback') {
              this.setSampleStatus('ready');
            }
          })
          .catch(() => {
            this.readyVoices[key] = false;
          })
          .finally(() => {
            remaining -= 1;
            if (remaining === 0) {
              if (this.sampleLoadTimerId !== null) {
                globalThis.clearTimeout(this.sampleLoadTimerId);
                this.sampleLoadTimerId = null;
              }
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

  private registerFallbackVoice(sources: FallbackSourceNode[], envs: FallbackGainNode[]): void {
    const entry: ActiveFallbackVoice = { sources, envs };
    this.activeFallbackVoices.add(entry);
    const primary = sources[0];
    if (primary) {
      primary.onended = () => {
        this.activeFallbackVoices.delete(entry);
      };
    }
  }

  public stopAll(): void {
    const t = this.ctx?.currentTime ?? 0;
    if (this.samplers) {
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
    for (const entry of this.extraSamplers.values()) {
      if (!entry.ready) continue;
      try {
        entry.voice.stop?.(t);
      } catch {
        // 확장 샘플러 정지 오류는 무시한다.
      }
    }

    for (const voice of this.activeFallbackVoices) {
      for (const env of voice.envs) {
        try {
          env.gain.cancelScheduledValues?.(t);
          env.gain.setValueAtTime?.(0.0001, t);
        } catch {
          // 엔벨로프 정리 오류는 무시한다.
        }
      }
      for (const src of voice.sources) {
        try {
          src.stop(t);
        } catch {
          // 이미 종료된 소스 정지 오류는 무시한다.
        }
      }
    }
    this.activeFallbackVoices.clear();
  }

  public setMasterEffects(effects: { reverb?: number; tone?: number }): void {
    if (typeof effects.reverb === 'number' && Number.isFinite(effects.reverb)) {
      this.reverbAmount = Math.max(0, Math.min(1, effects.reverb));
      if (this.reverbSend) {
        this.reverbSend.gain.value = this.reverbAmount * 0.45;
      }
    }
    if (typeof effects.tone === 'number' && Number.isFinite(effects.tone)) {
      this.toneAmount = Math.max(-1, Math.min(1, effects.tone));
      if (this.masterTone) {
        this.masterTone.gain.value = this.toneAmount * 6;
      }
    }
  }

  private buildReverbImpulse(ctx: AudioContext): AudioBuffer {
    const durationSec = 1.3;
    const len = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const decay = Math.pow(1 - i / len, 2.4);
        data[i] = (Math.random() * 2 - 1) * decay * 0.45;
      }
    }
    return buf;
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

  public playMetronome(accent: boolean, when: number): void {
    const ctx = this.ensureContext();
    if (!this.metronomeBus) return;
    const t0 = Math.max(ctx.currentTime, when);
    const { accentFreqHz, beatFreqHz, durationSec, accentVelocity, beatVelocity } =
      PRESETS.playback.metronome;
    const freq = accent ? accentFreqHz : beatFreqHz;
    const peak = accent ? accentVelocity : beatVelocity;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 0.72), t0 + durationSec);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec);

    osc.connect(env);
    env.connect(this.metronomeBus);

    this.registerFallbackVoice([osc], [env]);
    osc.start(t0);
    osc.stop(t0 + durationSec + 0.01);
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

    this.registerFallbackVoice([fundamental, h2, h3], [env]);
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
    const peak = Math.max(0.01, Math.min(0.24, velocity * 0.2));
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + 0.006);
    env.gain.exponentialRampToValueAtTime(peak * 0.42, t0 + Math.max(0.08, durationSec * 0.55));
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    body.connect(pluckFilter);
    harmonic.connect(harmonicGain);
    harmonicGain.connect(pluckFilter);
    pluckFilter.connect(env);
    env.connect(this.guitarBus);

    this.registerFallbackVoice([body, harmonic], [env]);
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
    const peak = Math.min(0.26, velocity * 0.2);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    tri.connect(lp);
    sub.connect(lp);
    lp.connect(env);
    env.connect(this.bassBus);

    this.registerFallbackVoice([tri, sub], [env]);
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
      g.gain.linearRampToValueAtTime(velocity * 0.4, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);

      osc.connect(g);
      g.connect(this.drumBus);
      this.registerFallbackVoice([osc], [g]);
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
      ng.gain.linearRampToValueAtTime(velocity * 0.18, t0 + 0.003);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);

      const tone = ctx.createOscillator();
      tone.type = 'triangle';
      tone.frequency.setValueAtTime(185, t0);
      tone.frequency.exponentialRampToValueAtTime(110, t0 + 0.07);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, t0);
      tg.gain.linearRampToValueAtTime(velocity * 0.16, t0 + 0.003);
      tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);

      noise.connect(bp);
      bp.connect(ng);
      ng.connect(this.drumBus);
      tone.connect(tg);
      tg.connect(this.drumBus);

      this.registerFallbackVoice([noise, tone], [ng, tg]);
      noise.start(t0);
      noise.stop(t0 + 0.16);
      tone.start(t0);
      tone.stop(t0 + 0.1);
      return;
    }

    if (kind === 'clap') {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1450;
      bp.Q.value = 1.4;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t0);
      cg.gain.linearRampToValueAtTime(velocity * 0.22, t0 + 0.002);
      cg.gain.exponentialRampToValueAtTime(0.03, t0 + 0.015);
      cg.gain.linearRampToValueAtTime(velocity * 0.2, t0 + 0.022);
      cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
      noise.connect(bp);
      bp.connect(cg);
      cg.connect(this.drumBus);
      this.registerFallbackVoice([noise], [cg]);
      noise.start(t0);
      noise.stop(t0 + 0.15);
      return;
    }

    const hat = ctx.createBufferSource();
    hat.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6800;
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.0001, t0);
    hg.gain.linearRampToValueAtTime(velocity * 0.1, t0 + 0.002);
    hg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.055);
    hat.connect(hp);
    hp.connect(hg);
    hg.connect(this.drumBus);
    this.registerFallbackVoice([hat], [hg]);
    hat.start(t0);
    hat.stop(t0 + 0.065);
  }

  public playInstrument(
    instrument: MelodyInstrument,
    midi: number,
    when: number,
    durationSec: number,
    velocity = 0.75
  ): void {
    if (instrument === 'piano') {
      this.playPiano(midi, when, durationSec, velocity);
      return;
    }
    if (instrument === 'guitar') {
      this.playGuitar(midi, when, durationSec, velocity);
      return;
    }

    const ctx = this.ensureContext();
    const t0 = Math.max(ctx.currentTime, when);

    if (instrument === 'chiptune_pulse50' || instrument === 'chiptune_pulse25') {
      this.playChiptunePulse(
        ctx,
        midi,
        t0,
        durationSec,
        velocity,
        instrument === 'chiptune_pulse25' ? 0.25 : 0.5
      );
      return;
    }

    const sfNameMap: Record<string, string> = {
      epiano: 'electric_piano_1',
      clean_guitar: 'electric_guitar_clean',
      synth_lead: 'lead_2_sawtooth',
      pad: 'pad_2_warm',
      strings: 'string_ensemble_1',
    };
    const sfName = sfNameMap[instrument];
    if (sfName && this.pianoBus && typeof window !== 'undefined' && this.readyVoices.piano) {
      let entry = this.extraSamplers.get(sfName);
      if (!entry) {
        try {
          const storage = 'caches' in window ? CacheStorage('motif-smplr-v1') : undefined;
          const voice = Soundfont(ctx, {
            instrument: sfName,
            destination: this.pianoBus,
            storage,
            volume: 127,
            extraGain: 4.5,
          });
          entry = { voice, ready: false, loading: true };
          this.extraSamplers.set(sfName, entry);
          void Promise.resolve(voice.load)
            .then(() => {
              if (entry) {
                entry.ready = true;
                entry.loading = false;
              }
            })
            .catch(() => {
              if (entry) entry.loading = false;
            });
        } catch {
          // Soundfont 초기화 실패 시 아래 폴백 신스로 재생한다.
        }
      }
      if (entry?.ready) {
        try {
          entry.voice.start({
            note: midi,
            time: t0,
            duration: Math.max(0.12, durationSec + 0.06),
            velocity: toMidiVelocity(velocity),
          });
          return;
        } catch {
          // 폴백 신스로 복구한다.
        }
      }
    }

    this.playFallbackVoiceForInstrument(ctx, instrument, midi, t0, durationSec, velocity);
  }

  private getPulseWave(ctx: AudioContext, duty: number): PeriodicWave | null {
    if (typeof ctx.createPeriodicWave !== 'function') return null;
    const key = Math.round(duty * 100);
    const cached = this.pulseWaveCache.get(key);
    if (cached) return cached;
    const harmonics = 24;
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);
    for (let n = 1; n <= harmonics; n++) {
      imag[n] = (2 / (n * Math.PI)) * (1 - Math.cos(2 * Math.PI * n * duty));
      real[n] = (2 / (n * Math.PI)) * Math.sin(2 * Math.PI * n * duty);
    }
    const wave = ctx.createPeriodicWave(real, imag);
    this.pulseWaveCache.set(key, wave);
    return wave;
  }

  public playChiptunePulse(
    ctx: AudioContext,
    midi: number,
    t0: number,
    durationSec: number,
    velocity: number,
    duty = 0.5
  ): void {
    if (!this.pianoBus) return;
    const freq = midiToFreq(midi);
    const osc = ctx.createOscillator();
    const wave = this.getPulseWave(ctx, duty);
    if (wave && typeof osc.setPeriodicWave === 'function') {
      osc.setPeriodicWave(wave);
    } else {
      osc.type = 'square';
    }
    osc.frequency.setValueAtTime(freq, t0);

    const env = ctx.createGain();
    const dur = Math.max(0.06, durationSec);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(velocity * 0.22, t0 + 0.006);
    env.gain.setValueAtTime(velocity * 0.18, t0 + Math.max(0.01, dur * 0.75));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.02);

    osc.connect(env);
    env.connect(this.pianoBus);
    this.registerFallbackVoice([osc], [env]);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  public playChiptuneBass(midi: number, when: number, durationSec: number, velocity = 0.75): void {
    const ctx = this.ensureContext();
    if (!this.bassBus) return;
    const t0 = Math.max(ctx.currentTime, when);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(midiToFreq(midi), t0);

    const env = ctx.createGain();
    const dur = Math.max(0.08, durationSec);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(velocity * 0.36, t0 + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.03);

    osc.connect(env);
    env.connect(this.bassBus);
    this.registerFallbackVoice([osc], [env]);
    osc.start(t0);
    osc.stop(t0 + dur + 0.04);
  }

  public playChiptuneDrum(kind: DrumKind, when: number, velocity = 0.75): void {
    const ctx = this.ensureContext();
    if (!this.drumBus || !this.noiseBuf) return;
    const t0 = Math.max(ctx.currentTime, when);
    if (kind === 'kick') {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, t0);
      osc.frequency.exponentialRampToValueAtTime(42, t0 + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t0);
      g.gain.linearRampToValueAtTime(velocity * 0.42, t0 + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      osc.connect(g);
      g.connect(this.drumBus);
      this.registerFallbackVoice([osc], [g]);
      osc.start(t0);
      osc.stop(t0 + 0.13);
      return;
    }
    // 8비트 노이즈 기반 스네어·하이햇·클랩
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = kind === 'hat' ? 'highpass' : 'bandpass';
    filter.frequency.value = kind === 'hat' ? 7500 : kind === 'clap' ? 1600 : 2200;
    const g = ctx.createGain();
    const dur = kind === 'hat' ? 0.045 : 0.11;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(velocity * (kind === 'hat' ? 0.12 : 0.24), t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    noise.connect(filter);
    filter.connect(g);
    g.connect(this.drumBus);
    this.registerFallbackVoice([noise], [g]);
    noise.start(t0);
    noise.stop(t0 + dur + 0.01);
  }

  private playFallbackVoiceForInstrument(
    ctx: AudioContext,
    instrument: MelodyInstrument,
    midi: number,
    t0: number,
    durationSec: number,
    velocity: number
  ): void {
    if (instrument === 'clean_guitar') {
      this.playFallbackGuitar(ctx, midi, t0, durationSec, velocity);
      return;
    }
    if (!this.pianoBus) return;
    const freq = midiToFreq(midi);
    const osc = ctx.createOscillator();
    osc.type =
      instrument === 'synth_lead'
        ? 'sawtooth'
        : instrument === 'pad' || instrument === 'strings'
          ? 'triangle'
          : 'sine';
    osc.frequency.setValueAtTime(freq, t0);

    const env = ctx.createGain();
    const attack = instrument === 'pad' || instrument === 'strings' ? 0.09 : 0.012;
    const dur = Math.max(0.1, durationSec);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(velocity * 0.22, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.14);

    osc.connect(env);
    env.connect(this.pianoBus);
    this.registerFallbackVoice([osc], [env]);
    osc.start(t0);
    osc.stop(t0 + dur + 0.16);
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
