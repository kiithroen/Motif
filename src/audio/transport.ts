import type { CompiledSong } from '../core/compiler';
import type { ChordInstrument, MelodyInstrument } from '../core/model';
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
  private mainSong: CompiledSong;
  private previewSong: CompiledSong | null = null;
  private bpm = 96;
  private melodyInstrument: MelodyInstrument = 'piano';
  private chordInstrument: ChordInstrument = 'piano';
  private mutes: TrackMuteState = { melody: false, chords: false, bass: false, drums: false };
  private callbacks: TransportCallbacks;

  private playing = false;
  private finishing = false;
  private loop = true;
  private currentStep = 0;
  private nextNoteTime = 0;
  private timerId: number | null = null;
  private uiTimerId: number | null = null;
  private finishTimerId: number | null = null;
  private stepQueue: Array<{ step: number; time: number }> = [];

  constructor(audio: MotifAudioEngine, compiled: CompiledSong, callbacks: TransportCallbacks = {}) {
    this.audio = audio;
    this.mainSong = compiled;
    this.callbacks = callbacks;
  }

  private get activeSong(): CompiledSong {
    return this.previewSong ?? this.mainSong;
  }

  public isPlaying(): boolean {
    return this.playing;
  }

  public updateSong(
    compiled: CompiledSong,
    bpm: number,
    melodyInstrument: MelodyInstrument,
    mutes: TrackMuteState,
    chordInstrument: ChordInstrument = this.chordInstrument
  ): void {
    this.mainSong = compiled;
    this.bpm = Math.max(45, Math.min(200, bpm));
    this.melodyInstrument = melodyInstrument;
    this.chordInstrument = chordInstrument;
    this.mutes = { ...mutes };
    if (this.currentStep >= this.activeSong.totalSteps) {
      this.currentStep = 0;
    }
  }

  public start(loop = true): void {
    this.previewSong = null;
    this.beginPlayback(loop);
  }

  private beginPlayback(loop: boolean): void {
    const preservedPreview = this.previewSong;
    this.stop();
    this.previewSong = preservedPreview;
    const ctx = this.audio.ensureContext();
    this.playing = true;
    this.finishing = false;
    this.loop = loop;
    this.currentStep = 0;
    this.stepQueue = [];
    this.nextNoteTime = ctx.currentTime + 0.04;

    this.timerId = globalThis.setInterval(() => this.schedulerTick(), 25) as unknown as number;
    this.uiTimerId = globalThis.setInterval(() => this.flushUiStep(), 30) as unknown as number;
  }

  public stop(): void {
    if (this.timerId !== null) {
      globalThis.clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.uiTimerId !== null) {
      globalThis.clearInterval(this.uiTimerId);
      this.uiTimerId = null;
    }
    if (this.finishTimerId !== null) {
      globalThis.clearTimeout(this.finishTimerId);
      this.finishTimerId = null;
    }
    const wasPlaying = this.playing;
    this.playing = false;
    this.finishing = false;
    this.previewSong = null;
    this.stepQueue = [];
    if (wasPlaying) {
      this.audio.stopAll?.();
    }
    this.callbacks.onStep?.(-1);
    if (wasPlaying) {
      this.callbacks.onStop?.();
    }
  }

  public playOncePreview(
    song: CompiledSong,
    bpm: number,
    melodyInstrument: MelodyInstrument,
    mutes: TrackMuteState,
    chordInstrument: ChordInstrument = this.chordInstrument
  ): void {
    this.stop();
    this.previewSong = song;
    this.bpm = Math.max(45, Math.min(200, bpm));
    this.melodyInstrument = melodyInstrument;
    this.chordInstrument = chordInstrument;
    this.mutes = { ...mutes };
    this.beginPlayback(false);
  }

  private stepDurationSec(): number {
    return 60 / this.bpm / 4;
  }

  private schedulerTick(): void {
    if (!this.playing || this.finishing) return;
    const song = this.activeSong;
    const lookaheadSec = 0.14;
    const now = this.audio.currentTime;
    const stepDur = this.stepDurationSec();

    while (this.nextNoteTime < now + lookaheadSec) {
      if (!this.loop && this.currentStep >= song.totalSteps) {
        const stopDelayMs = Math.max(40, (this.nextNoteTime - now) * 1000);
        this.finishing = true;
        this.finishTimerId = globalThis.setTimeout(() => {
          if (this.finishing) this.stop();
        }, stopDelayMs) as unknown as number;
        break;
      }

      const step = this.currentStep % song.totalSteps;
      this.scheduleStepEvents(song, step, this.nextNoteTime, stepDur);
      this.stepQueue.push({ step, time: this.nextNoteTime });

      this.nextNoteTime += stepDur;
      this.currentStep += 1;
      if (this.loop) {
        this.currentStep %= song.totalSteps;
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

  private scheduleStepEvents(song: CompiledSong, step: number, when: number, stepDur: number): void {
    if (!this.mutes.chords) {
      let chordIdx = 0;
      for (const c of song.chords) {
        if (c.step === step) {
          if (this.chordInstrument === 'guitar') {
            this.audio.playGuitar(
              c.midi,
              when + chordIdx * 0.011,
              c.duration * stepDur,
              Math.min(1, c.velocity * 0.92),
              0.22
            );
          } else {
            this.audio.playPiano(
              c.midi,
              when + chordIdx * 0.006,
              c.duration * stepDur,
              Math.min(1, c.velocity * 0.64),
              0.2
            );
          }
          chordIdx++;
        }
      }
    }

    if (!this.mutes.bass) {
      for (const b of song.bass) {
        if (b.step === step) {
          this.audio.playBass(b.midi, when, b.duration * stepDur, Math.min(1, b.velocity * 0.96));
        }
      }
    }

    if (!this.mutes.drums) {
      for (const d of song.drums) {
        if (d.step === step) {
          this.audio.playDrum(d.kind, when, Math.min(1, d.velocity * 1.05));
        }
      }
    }

    if (!this.mutes.melody) {
      for (const m of song.melody) {
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
