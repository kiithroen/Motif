import type { CompiledSong } from '../core/compiler';
import { type ChordInstrument, type MelodyInstrument, PRESETS, type TrackVolumes } from '../core/model';
import {
  type LoopBarRange,
  type TrackMuteState,
  clampLoopRangeOnBarResize,
  clampTrackVolume,
  createDefaultTrackMutes,
  createDefaultTrackVolumes,
  isMetronomeBeat,
  loopRangeToStepRange,
  normalizeLoopRange,
  scaleTrackVelocity,
} from '../core/playbackControl';
import { MotifAudioEngine } from './instruments';

export type { LoopBarRange, TrackMuteState, TrackVolumes };

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
  private mutes: TrackMuteState = createDefaultTrackMutes();
  private volumes: TrackVolumes = createDefaultTrackVolumes();
  private metronomeEnabled = PRESETS.playback.metronome.defaultEnabled;
  private loopRange: LoopBarRange | null = null;
  private swing = PRESETS.playback.effects.defaultSwing;
  private chiptuneMode = false;
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

  public setTrackVolumes(volumes: TrackVolumes): void {
    this.volumes = {
      melody: clampTrackVolume(volumes.melody),
      chords: clampTrackVolume(volumes.chords),
      bass: clampTrackVolume(volumes.bass),
      drums: clampTrackVolume(volumes.drums),
      pad: clampTrackVolume(volumes.pad ?? PRESETS.playback.mixer.defaults.pad),
    };
  }

  public setEffects(effects: {
    swing?: number;
    reverb?: number;
    tone?: number;
    chiptuneMode?: boolean;
  }): void {
    if (typeof effects.swing === 'number' && Number.isFinite(effects.swing)) {
      this.swing = Math.max(0, Math.min(PRESETS.playback.effects.maxSwing, effects.swing));
    }
    if (typeof effects.chiptuneMode === 'boolean') {
      this.chiptuneMode = effects.chiptuneMode;
    }
    this.audio.setMasterEffects?.({ reverb: effects.reverb, tone: effects.tone });
  }

  public getTrackVolumes(): TrackVolumes {
    return { ...this.volumes };
  }

  public setMetronome(enabled: boolean): void {
    this.metronomeEnabled = enabled;
  }

  public isMetronomeEnabled(): boolean {
    return this.metronomeEnabled;
  }

  public setLoopRange(range: LoopBarRange | null): void {
    const totalBars = Math.floor(this.mainSong.totalSteps / 16);
    this.loopRange = normalizeLoopRange(range, totalBars);

    if (this.playing && !this.previewSong && this.loopRange) {
      const win = loopRangeToStepRange(this.loopRange, this.mainSong.totalSteps);
      if (this.currentStep < win.startStep || this.currentStep >= win.endStep) {
        this.jumpMainPlaybackToStep(win.startStep);
      }
    }
  }

  public getLoopRange(): LoopBarRange | null {
    return this.loopRange ? { ...this.loopRange } : null;
  }

  public seekToBar(barIdx: number): void {
    const totalBars = Math.max(1, Math.floor(this.mainSong.totalSteps / 16));
    const clampedBar = Math.max(0, Math.min(totalBars - 1, Math.trunc(barIdx)));
    this.seekToStep(clampedBar * 16);
  }

  public seekToStep(step: number): void {
    const maxStep = Math.max(0, this.mainSong.totalSteps - 1);
    const clamped = Math.max(0, Math.min(maxStep, Math.trunc(step)));

    if (this.playing && !this.previewSong) {
      this.jumpMainPlaybackToStep(clamped);
      return;
    }

    this.previewSong = null;
    this.beginPlayback(true, clamped);
    this.callbacks.onStep?.(clamped);
  }

  private jumpMainPlaybackToStep(step: number): void {
    this.audio.stopAll?.();
    this.stepQueue = [];
    this.finishing = false;
    if (this.finishTimerId !== null) {
      globalThis.clearTimeout(this.finishTimerId);
      this.finishTimerId = null;
    }
    this.currentStep = step;
    this.nextNoteTime = this.audio.currentTime + 0.02;
    this.callbacks.onStep?.(step);
  }

  public updateSong(
    compiled: CompiledSong,
    bpm: number,
    melodyInstrument: MelodyInstrument,
    mutes: TrackMuteState,
    chordInstrument: ChordInstrument = this.chordInstrument,
    volumes?: TrackVolumes
  ): void {
    this.mainSong = compiled;
    this.bpm = Math.max(45, Math.min(200, bpm));
    this.melodyInstrument = melodyInstrument;
    this.chordInstrument = chordInstrument;
    this.mutes = { ...mutes };
    if (volumes) {
      this.setTrackVolumes(volumes);
    }
    if (this.loopRange) {
      const totalBars = Math.floor(compiled.totalSteps / 16);
      this.loopRange = clampLoopRangeOnBarResize(this.loopRange, totalBars);
    }
    if (this.currentStep >= this.activeSong.totalSteps) {
      this.currentStep = 0;
    }
  }

  public start(loop = true): void {
    this.previewSong = null;
    this.beginPlayback(loop);
  }

  private beginPlayback(loop: boolean, startStep?: number): void {
    const preservedPreview = this.previewSong;
    this.stop();
    this.previewSong = preservedPreview;
    const ctx = this.audio.ensureContext();
    this.playing = true;
    this.finishing = false;
    this.loop = loop;

    let initialStep = 0;
    if (typeof startStep === 'number' && Number.isFinite(startStep)) {
      const maxStep = Math.max(0, this.activeSong.totalSteps - 1);
      initialStep = Math.max(0, Math.min(maxStep, Math.trunc(startStep)));
    } else if (!this.previewSong && loop && this.loopRange) {
      initialStep = loopRangeToStepRange(this.loopRange, this.activeSong.totalSteps).startStep;
    }

    this.currentStep = initialStep;
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
      const nextStep = this.currentStep + 1;
      if (this.loop) {
        if (!this.previewSong && this.loopRange) {
          const win = loopRangeToStepRange(this.loopRange, song.totalSteps);
          if ((step < win.endStep && nextStep >= win.endStep) || nextStep >= song.totalSteps) {
            this.currentStep = win.startStep;
          } else {
            this.currentStep = nextStep;
          }
        } else {
          this.currentStep = nextStep % song.totalSteps;
        }
      } else {
        this.currentStep = nextStep;
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
    const swingOffset = step % 2 === 1 && this.swing > 0 ? this.swing * 0.5 * stepDur : 0;
    const t = when + swingOffset;

    if (!this.mutes.chords && this.volumes.chords > 0) {
      let chordIdx = 0;
      for (const c of song.chords) {
        if (c.step === step) {
          const baseScale = this.chordInstrument === 'guitar' ? 0.92 : 0.64;
          const vel = scaleTrackVelocity(c.velocity * baseScale, this.volumes.chords);
          if (vel > 0) {
            if (this.chiptuneMode) {
              this.audio.playInstrument?.(
                'chiptune_pulse25',
                c.midi,
                t + chordIdx * 0.005,
                c.duration * stepDur,
                vel * 0.72
              );
            } else if (this.chordInstrument === 'guitar') {
              this.audio.playGuitar(c.midi, t + chordIdx * 0.011, c.duration * stepDur, vel, 0.22);
            } else {
              this.audio.playPiano(c.midi, t + chordIdx * 0.006, c.duration * stepDur, vel, 0.2);
            }
          }
          chordIdx++;
        }
      }
    }

    if (!this.mutes.pad && (this.volumes.pad ?? 0) > 0 && song.pad) {
      for (const p of song.pad) {
        if (p.step === step) {
          const vel = scaleTrackVelocity(p.velocity * 0.75, this.volumes.pad ?? 0.65);
          if (vel > 0) {
            this.audio.playInstrument?.(
              this.chiptuneMode ? 'chiptune_pulse25' : 'pad',
              p.midi,
              t,
              p.duration * stepDur,
              vel
            );
          }
        }
      }
    }

    if (!this.mutes.bass && this.volumes.bass > 0) {
      for (const b of song.bass) {
        if (b.step === step) {
          const vel = scaleTrackVelocity(b.velocity * 0.96, this.volumes.bass);
          if (vel > 0) {
            if (this.chiptuneMode) {
              this.audio.playChiptuneBass?.(b.midi, t, b.duration * stepDur, vel);
            } else {
              this.audio.playBass(b.midi, t, b.duration * stepDur, vel);
            }
          }
        }
      }
    }

    if (!this.mutes.drums && this.volumes.drums > 0) {
      for (const d of song.drums) {
        if (d.step === step) {
          const vel = scaleTrackVelocity(d.velocity * 1.05, this.volumes.drums);
          if (vel > 0) {
            if (this.chiptuneMode) {
              this.audio.playChiptuneDrum?.(d.kind, t, vel);
            } else {
              this.audio.playDrum(d.kind, t, vel);
            }
          }
        }
      }
    }

    if (!this.mutes.melody && this.volumes.melody > 0) {
      for (const m of song.melody) {
        if (m.step === step) {
          const vel = scaleTrackVelocity(m.velocity, this.volumes.melody);
          if (vel > 0) {
            const dur = m.duration * stepDur;
            if (this.audio.playInstrument) {
              this.audio.playInstrument(this.melodyInstrument, m.midi, t, dur, vel);
            } else if (this.melodyInstrument === 'guitar') {
              this.audio.playGuitar(m.midi, t, dur, vel, 0.24);
            } else {
              this.audio.playPiano(m.midi, t, dur, vel, 0.3);
            }
          }
        }
      }
    }

    if (!this.previewSong && this.metronomeEnabled) {
      const beat = isMetronomeBeat(step);
      if (beat.trigger) {
        this.audio.playMetronome?.(beat.accent, t);
      }
    }
  }
}
