import presetsRaw from '../data/presets.json';
import type { DegreeSymbol, ScaleMode } from './theory';

export type EditorLayer = 'L1' | 'L2' | 'L3';

export type MelodyInstrument = 'piano' | 'guitar';

export type ModifierId =
  | 'modal_borrow'
  | 'motif_repeat'
  | 'syncopation'
  | 'passing_tones'
  | 'octave_lift'
  | 'cadence_resolve';

export interface ModifierState {
  id: ModifierId;
  enabled: boolean;
  amount: number;
}

export interface ChordSlot {
  bar: number;
  degree: DegreeSymbol;
}

export interface L1Blocks {
  progressionId: string;
  grooveId: string;
  contourId: string;
  energy: number;
  density: number;
}

export interface L2Chain {
  chords: ChordSlot[];
  modifiers: ModifierState[];
}

export type NoteOrigin = 'base' | 'modifier' | 'user';

export interface NoteEvent {
  id: string;
  midi: number;
  step: number;
  duration: number;
  velocity: number;
  origin?: NoteOrigin;
}

export type DrumKind = 'kick' | 'snare' | 'hat';

export interface DrumEvent {
  kind: DrumKind;
  step: number;
  velocity: number;
}

export interface SongProject {
  keyRoot: number;
  mode: ScaleMode;
  bars: 4 | 8;
  bpm: number;
  seed: number;
  melodyInstrument: MelodyInstrument;
  activeLayer: EditorLayer;
  blocks: L1Blocks;
  chain: L2Chain;
  baked: boolean;
  bakedMelody: NoteEvent[];
}

export interface ProgressionPreset {
  id: string;
  nameKo: string;
  moodKo: string;
  degrees: DegreeSymbol[];
}

export interface StrumPattern {
  step: number;
  duration: number;
  direction: 'down' | 'up' | 'arp0' | 'arp1' | 'arp2';
  velocity: number;
}

export interface GroovePreset {
  id: string;
  nameKo: string;
  moodKo: string;
  defaultBpm: number;
  kicks: number[];
  snares: number[];
  hats: number[];
  bassSteps: number[];
  chordStrums: StrumPattern[];
}

export interface ContourPreset {
  id: string;
  nameKo: string;
  descKo: string;
  points: number[];
}

export interface ModifierMeta {
  id: ModifierId;
  nameKo: string;
  descKo: string;
  defaultEnabled: boolean;
  defaultAmount: number;
}

export interface NoteDurationOption {
  steps: number;
  labelKo: string;
}

export interface PresetsData {
  defaults: {
    keyRoot: number;
    mode: ScaleMode;
    bars: 4 | 8;
    bpm: number;
    seed: number;
    melodyInstrument: MelodyInstrument;
    progressionId: string;
    grooveId: string;
    contourId: string;
    energy: number;
    density: number;
  };
  progressions: ProgressionPreset[];
  grooves: GroovePreset[];
  contours: ContourPreset[];
  modifiers: ModifierMeta[];
  availableDegrees: DegreeSymbol[];
  noteDurationOptions: NoteDurationOption[];
  analyzerThresholds: {
    minRangeSemitones: number;
    largeLeapSemitones: number;
    maxLargeLeapRatio: number;
    minRestRatio: number;
    maxSameDurationRatio: number;
  };
}

export const PRESETS = presetsRaw as PresetsData;

export function buildChordsFromProgression(progressionId: string, bars: 4 | 8): ChordSlot[] {
  const prog = PRESETS.progressions.find((p) => p.id === progressionId) ?? PRESETS.progressions[0];
  const slots: ChordSlot[] = [];
  for (let bar = 0; bar < bars; bar++) {
    slots.push({
      bar,
      degree: prog.degrees[bar % prog.degrees.length],
    });
  }
  return slots;
}

export function buildDefaultModifiers(): ModifierState[] {
  return PRESETS.modifiers.map((m) => ({
    id: m.id,
    enabled: m.defaultEnabled,
    amount: m.defaultAmount,
  }));
}

export function createDefaultProject(): SongProject {
  const d = PRESETS.defaults;
  return {
    keyRoot: d.keyRoot,
    mode: d.mode,
    bars: d.bars,
    bpm: d.bpm,
    seed: d.seed,
    melodyInstrument: d.melodyInstrument,
    activeLayer: 'L1',
    blocks: {
      progressionId: d.progressionId,
      grooveId: d.grooveId,
      contourId: d.contourId,
      energy: d.energy,
      density: d.density,
    },
    chain: {
      chords: buildChordsFromProgression(d.progressionId, d.bars),
      modifiers: buildDefaultModifiers(),
    },
    baked: false,
    bakedMelody: [],
  };
}

export function cloneProject(project: SongProject): SongProject {
  return {
    ...project,
    blocks: { ...project.blocks },
    chain: {
      chords: project.chain.chords.map((c) => ({ ...c })),
      modifiers: project.chain.modifiers.map((m) => ({ ...m })),
    },
    bakedMelody: project.bakedMelody.map((n) => ({ ...n })),
  };
}
