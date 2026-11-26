import type { CompiledSong } from '../core/compiler';
import type { MelodyInstrument } from '../core/model';
import { MotifAudioEngine } from './instruments';

export interface TrackMuteState {
  melody: boolean;
  chords: boolean;
  bass: boolean;
  drums: boolean;
}

export interface TransportCallbacks {
  onStep?: (step: number) => void;
  onStop?: () => void;
}

export class MotifTransport {
  private readonly audio: MotifAudioEngine;
  private compiled: CompiledSong;
  private bpm = 96;
  private melodyInstrument: MelodyInstrument = 'piano';
  private mutes: TrackMuteState = { melody: false, chords: false, bass: false, drums: false };
  private callbacks: TransportCallbacks;

  private playing = false;
  private loop = true;
  private currentStep = 0;
  private nextNoteTime = 0;
  private timerId: number | null = null;
  private uiTimerId: number | null = null;
  private stepQueue: Array<{ step: number; time: number }> = [];

  constructor(audio: MotifAudioEngine, compiled: CompiledSong, callbacks: TransportCallbacks = {}) {
    this.audio = audio;
    this.compiled = compiled;
    this.callbacks = callbacks;
  }

  public isPlaying(): boolean {
    return this.playing;
  }

  public updateSong(compiled: CompiledSong, bpm: number, melodyInstrument: MelodyInstrument, mutes: TrackMuteState): void {
    this.compiled = compiled;
    this.bpm = Math.max(45, Math.min(200, bpm));
    this.melodyInstrument = melodyInstrument;
    this.mutes = { ...mutes };
    if (this.currentStep >= compiled.totalSteps) {
      this.currentStep = 0;
    }
  }

  public start(loop = true): void {
    this.stop();
    const ctx = this.audio.ensureContext();
    this.playing = true;
    this.loop = loop;
    this.currentStep = 0;
    this.stepQueue = [];
    this.nextNoteTime = ctx.currentTime + 0.04;

    this.timerId = window.setInterval(() => this.schedulerTick(), 25);
    this.uiTimerId = window.setInterval(() => this.flushUiStep(), 30);
  }

  public stop(): void {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.uiTimerId !== null) {
      window.clearInterval(this.uiTimerId);
      this.uiTimerId = null;
    }
    const wasPlaying = this.playing;
    this.playing = false;
    this.stepQueue = [];
    this.callbacks.onStep?.(-1);
    if (wasPlaying) {
      this.callbacks.onStop?.();
    }
  }

  public playOncePreview(song: CompiledSong, bpm: number, melodyInstrument: MelodyInstrument, mutes: TrackMuteState): void {
    this.updateSong(song, bpm, melodyInstrument, mutes);
    this.start(false);
  }

  private stepDurationSec(): number {
    return 60 / this.bpm / 4;
  }

  private schedulerTick(): void {
    if (!this.playing) return;
    const lookaheadSec = 0.14;
    const now = this.audio.currentTime;
    const stepDur = this.stepDurationSec();

    while (this.nextNoteTime < now + lookaheadSec) {
      if (!this.loop && this.currentStep >= this.compiled.totalSteps) {
        const stopDelayMs = Math.max(40, (this.nextNoteTime - now) * 1000);
        window.setTimeout(() => {
          if (this.playing && !this.loop) this.stop();
        }, stopDelayMs);
        this.playing = false;
        break;
      }

      const step = this.currentStep % this.compiled.totalSteps;
      this.scheduleStepEvents(step, this.nextNoteTime, stepDur);
      this.stepQueue.push({ step, time: this.nextNoteTime });

      this.nextNoteTime += stepDur;
      this.currentStep += 1;
      if (this.loop) {
        this.currentStep %= this.compiled.totalSteps;
      }
    }
  }

  private flushUiStep(): void {
    const now = this.audio.currentTime;
    let latestStep: number | null = null;
    while (this.stepQueue.length > 0 && this.stepQueue[0].time <= now) {
      latestStep = this.stepQueue.shift()!.step;
    }
    if (latestStep !== null) {
      this.callbacks.onStep?.(latestStep);
    }
  }

  private scheduleStepEvents(step: number, when: number, stepDur: number): void {
    if (!this.mutes.chords) {
      let chordIdx = 0;
      for (const c of this.compiled.chords) {
        if (c.step === step) {
          this.audio.playGuitar(c.midi, when + chordIdx * 0.011, c.duration * stepDur, c.velocity * 0.72, 0.22);
          chordIdx++;
        }
      }
    }

    if (!this.mutes.bass) {
      for (const b of this.compiled.bass) {
        if (b.step === step) {
          this.audio.playBass(b.midi, when, b.duration * stepDur, b.velocity * 0.85);
        }
      }
    }

    if (!this.mutes.drums) {
      for (const d of this.compiled.drums) {
        if (d.step === step) {
          this.audio.playDrum(d.kind, when, d.velocity);
        }
      }
    }

    if (!this.mutes.melody) {
      for (const m of this.compiled.melody) {
        if (m.step === step) {
          const dur = m.duration * stepDur;
          if (this.melodyInstrument === 'guitar') {
            this.audio.playGuitar(m.midi, when, dur, m.velocity, 0.24);
          } else {
            this.audio.playPiano(m.midi, when, dur, m.velocity, 0.3);
          }
        }
      }
    }
  }
}
