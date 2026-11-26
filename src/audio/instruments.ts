import type { DrumKind } from '../core/model';

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class MotifAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private dryBus: GainNode | null = null;
  private wetBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private ksCache = new Map<string, AudioBuffer>();

  public ensureContext(): AudioContext {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 18;
      comp.ratio.value = 3.2;
      comp.attack.value = 0.005;
      comp.release.value = 0.16;

      const master = this.ctx.createGain();
      master.gain.value = 0.85;
      comp.connect(master);
      master.connect(this.ctx.destination);

      const dryBus = this.ctx.createGain();
      dryBus.gain.value = 0.92;
      dryBus.connect(comp);

      const convolver = this.ctx.createConvolver();
      convolver.buffer = this.buildRoomImpulse(this.ctx);
      const wetBus = this.ctx.createGain();
      wetBus.gain.value = 0.24;
      wetBus.connect(convolver);
      convolver.connect(comp);

      this.master = master;
      this.dryBus = dryBus;
      this.wetBus = wetBus;
      this.noiseBuf = this.buildNoiseBuffer(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public get currentTime(): number {
    return this.ensureContext().currentTime;
  }

  private buildRoomImpulse(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 0.95);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let prev = 0;
      for (let i = 0; i < len; i++) {
        const decay = Math.pow(1 - i / len, 2.8);
        const white = Math.random() * 2 - 1;
        prev = prev * 0.62 + white * 0.38;
        d[i] = prev * decay * 0.45;
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

  private getPluckBuffer(ctx: AudioContext, midi: number): AudioBuffer {
    const bucket = Math.round(midi);
    const key = `${bucket}_${ctx.sampleRate}`;
    const cached = this.ksCache.get(key);
    if (cached) return cached;

    const freq = midiToFreq(bucket);
    const durSec = 2.1;
    const len = Math.floor(ctx.sampleRate * durSec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const out = buf.getChannelData(0);

    const period = Math.max(2, Math.round(ctx.sampleRate / freq));
    const ring = new Float32Array(period);
    // 따뜻한 핑거피킹 느낌을 위해 초기 잡음 버스트를 한 차례 저역 필터링한다.
    let seed = (bucket * 2654435761) >>> 0;
    let lp = 0;
    for (let i = 0; i < period; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const white = (seed / 4294967296) * 2 - 1;
      lp = lp * 0.45 + white * 0.55;
      ring[i] = lp;
    }

    const damping = midi > 64 ? 0.9945 : 0.9965;
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const nextIdx = (idx + 1) % period;
      const sample = damping * 0.5 * (ring[idx] + ring[nextIdx]);
      ring[idx] = sample;
      out[i] = sample;
      idx = nextIdx;
    }

    if (this.ksCache.size > 48) {
      this.ksCache.clear();
    }
    this.ksCache.set(key, buf);
    return buf;
  }

  public playPiano(midi: number, when: number, durationSec: number, velocity = 0.75, wetAmt = 0.28): void {
    const ctx = this.ensureContext();
    if (!this.dryBus || !this.wetBus || !this.master) return;

    const freq = midiToFreq(midi);
    const t0 = Math.max(ctx.currentTime, when);
    const rel = Math.min(0.45, Math.max(0.16, durationSec * 0.4));
    const end = t0 + Math.max(0.08, durationSec) + rel;

    // 캐리어(따뜻한 트라이앵글 + 사인) + 부드러운 FM 타인(어택)
    const carrier = ctx.createOscillator();
    carrier.type = 'triangle';
    carrier.frequency.setValueAtTime(freq, t0);

    const subSine = ctx.createOscillator();
    subSine.type = 'sine';
    subSine.frequency.setValueAtTime(freq, t0);

    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(freq * 2, t0);

    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * (0.65 + velocity * 0.65), t0);
    modGain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.24);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(6200, freq * (3.2 + velocity * 2.5)), t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(550, freq * 1.8), end);

    const env = ctx.createGain();
    const peak = Math.max(0.01, Math.min(0.32, velocity * 0.26));
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + 0.008);
    env.gain.exponentialRampToValueAtTime(peak * 0.55, t0 + Math.max(0.06, durationSec * 0.6));
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    carrier.connect(filter);
    subSine.connect(filter);
    filter.connect(env);
    env.connect(this.dryBus);

    const send = ctx.createGain();
    send.gain.value = wetAmt;
    env.connect(send);
    send.connect(this.wetBus);

    carrier.start(t0);
    subSine.start(t0);
    mod.start(t0);
    carrier.stop(end + 0.02);
    subSine.stop(end + 0.02);
    mod.stop(end + 0.02);
  }

  public playGuitar(midi: number, when: number, durationSec: number, velocity = 0.72, wetAmt = 0.2): void {
    const ctx = this.ensureContext();
    if (!this.dryBus || !this.wetBus) return;

    const t0 = Math.max(ctx.currentTime, when);
    const src = ctx.createBufferSource();
    src.buffer = this.getPluckBuffer(ctx, midi);

    const bodyEq = ctx.createBiquadFilter();
    bodyEq.type = 'peaking';
    bodyEq.frequency.value = 190;
    bodyEq.Q.value = 1.4;
    bodyEq.gain.value = 3.5;

    const hiCut = ctx.createBiquadFilter();
    hiCut.type = 'lowpass';
    hiCut.frequency.value = 3400 + velocity * 1400;

    const env = ctx.createGain();
    const peak = Math.max(0.01, Math.min(0.45, velocity * 0.34));
    const end = t0 + Math.max(0.12, durationSec) + 0.28;
    env.gain.setValueAtTime(peak, t0);
    env.gain.setValueAtTime(peak, Math.max(t0 + 0.02, end - 0.18));
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    src.connect(bodyEq);
    bodyEq.connect(hiCut);
    hiCut.connect(env);
    env.connect(this.dryBus);

    const send = ctx.createGain();
    send.gain.value = wetAmt;
    env.connect(send);
    send.connect(this.wetBus);

    src.start(t0);
    src.stop(end + 0.02);
  }

  public playBass(midi: number, when: number, durationSec: number, velocity = 0.75): void {
    const ctx = this.ensureContext();
    if (!this.dryBus) return;
    const t0 = Math.max(ctx.currentTime, when);
    const freq = midiToFreq(midi);
    const end = t0 + Math.max(0.08, durationSec) + 0.14;

    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.setValueAtTime(freq, t0);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(freq, t0);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(420 + velocity * 260, t0);
    lp.frequency.exponentialRampToValueAtTime(160, end);

    const env = ctx.createGain();
    const peak = Math.min(0.34, velocity * 0.28);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    saw.connect(lp);
    sub.connect(lp);
    lp.connect(env);
    env.connect(this.dryBus);

    saw.start(t0);
    sub.start(t0);
    saw.stop(end + 0.02);
    sub.stop(end + 0.02);
  }

  public playDrum(kind: DrumKind, when: number, velocity = 0.75): void {
    const ctx = this.ensureContext();
    if (!this.dryBus || !this.wetBus || !this.noiseBuf) return;
    const t0 = Math.max(ctx.currentTime, when);

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
      g.connect(this.dryBus);
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
      ng.gain.setValueAtTime(velocity * 0.24, t0);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);

      const tone = ctx.createOscillator();
      tone.type = 'triangle';
      tone.frequency.setValueAtTime(185, t0);
      tone.frequency.exponentialRampToValueAtTime(110, t0 + 0.07);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(velocity * 0.22, t0);
      tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);

      noise.connect(bp);
      bp.connect(ng);
      ng.connect(this.dryBus);
      ng.connect(this.wetBus);
      tone.connect(tg);
      tg.connect(this.dryBus);

      noise.start(t0);
      noise.stop(t0 + 0.16);
      tone.start(t0);
      tone.stop(t0 + 0.1);
      return;
    }

    // closed hi-hat
    const hat = ctx.createBufferSource();
    hat.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6800;
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(velocity * 0.13, t0);
    hg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.055);
    hat.connect(hp);
    hp.connect(hg);
    hg.connect(this.dryBus);
    hat.start(t0);
    hat.stop(t0 + 0.065);
  }

  public auditionChord(midis: number[], instrument: 'guitar' | 'piano' = 'guitar'): void {
    const t0 = this.currentTime + 0.01;
    midis.forEach((m, idx) => {
      const offset = idx * 0.022;
      if (instrument === 'guitar') {
        this.playGuitar(m, t0 + offset, 1.1, 0.72, 0.25);
      } else {
        this.playPiano(m, t0 + offset * 0.5, 1.1, 0.68, 0.25);
      }
    });
  }
}
