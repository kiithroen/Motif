import basicsRaw from '../data/basics.json';
import { type DiagnosisReport, type IssueKind, analyzeSong } from './analyzer';
import { type CompiledSong, compileSong } from './compiler';
import {
  type L1Blocks,
  type NoteEvent,
  type SongProject,
  buildChordsFromProgression,
  buildDefaultModifiers,
  createDefaultProject,
} from './model';
import { type DegreeSymbol, type ScaleMode, wrapPc } from './theory';

export type BasicLessonWorkspaceKind = 'chord_tone_pick' | 'piano_roll' | 'chord_swap' | 'classic_arrange';

export type BasicLessonRule =
  | { type: 'bar_downbeat_chord_tones'; bars: number[]; labelKo: string }
  | { type: 'no_issue'; issueKind: IssueKind; labelKo: string }
  | { type: 'min_non_downbeat_scale_notes'; minCount: number; labelKo: string }
  | { type: 'min_distinct_durations'; minCount: number; labelKo: string }
  | { type: 'min_rest_ratio'; minRatio: number; labelKo: string }
  | { type: 'last_note_pc'; allowedPcs: number[]; labelKo: string }
  | { type: 'bar_chord_degree'; barIndex: number; degree: DegreeSymbol; labelKo: string }
  | { type: 'groove_not'; disallowedId: string; labelKo: string }
  | { type: 'arrangement_changed'; labelKo: string };

export interface CompareDemo {
  id: string;
  labelKo: string;
  badgeKo: string;
  tone: 'good' | 'warn' | 'neutral';
  descKo: string;
  bpm: number;
  mode: ScaleMode;
  grooveId: string;
  chords: DegreeSymbol[];
  melody: NoteEvent[];
}

export interface TheoryPoint {
  headingKo: string;
  bodyKo: string;
  chips?: string[];
}

export interface LessonAnnotation {
  barLabelKo: string;
  textKo: string;
}

export interface BasicLessonInitialProject {
  bars?: 4 | 8;
  bpm?: number;
  mode?: ScaleMode;
  grooveId?: string;
  progressionId?: string;
  chordOverrides?: DegreeSymbol[];
  baked?: boolean;
  bakedMelody?: NoteEvent[];
}

export interface BasicLessonDefinition {
  id: string;
  order: number;
  categoryKo: string;
  titleKo: string;
  subtitleKo: string;
  compareDemos: CompareDemo[];
  theoryPoints: TheoryPoint[];
  annotations?: LessonAnnotation[];
  workspaceKind: BasicLessonWorkspaceKind;
  showDurationPicker?: boolean;
  goalSummaryKo: string;
  hintKo: string;
  initialProject: BasicLessonInitialProject;
  rules: BasicLessonRule[];
}

export interface BasicLessonCheckResult {
  labelKo: string;
  passed: boolean;
}

export interface BasicLessonEvaluation {
  lessonId: string;
  passed: boolean;
  checks: BasicLessonCheckResult[];
  passedCount: number;
  totalCount: number;
}

export const BASIC_LESSONS = basicsRaw as BasicLessonDefinition[];

export function getBasicLessonById(lessonId: string): BasicLessonDefinition {
  return BASIC_LESSONS.find((l) => l.id === lessonId) ?? BASIC_LESSONS[0];
}

export function createBasicLessonProject(lessonId: string): SongProject {
  const lesson = getBasicLessonById(lessonId);
  const init = lesson.initialProject;
  const base = createDefaultProject();

  const bars = init.bars ?? base.bars;
  const blocks: L1Blocks = {
    ...base.blocks,
    progressionId: init.progressionId ?? base.blocks.progressionId,
    grooveId: init.grooveId ?? base.blocks.grooveId,
  };

  const chords = init.chordOverrides
    ? init.chordOverrides.slice(0, bars).map((degree, bar) => ({ bar, degree }))
    : buildChordsFromProgression(blocks.progressionId, bars);

  return {
    ...base,
    bars,
    bpm: init.bpm ?? base.bpm,
    mode: init.mode ?? base.mode,
    activeLayer: 'L3',
    blocks,
    chain: {
      chords,
      modifiers: buildDefaultModifiers(),
    },
    baked: init.baked ?? true,
    bakedMelody: init.bakedMelody ? init.bakedMelody.map((n) => ({ ...n })) : [],
  };
}

export function compileCompareDemo(demo: CompareDemo, keyRoot = 0): CompiledSong {
  const base = createDefaultProject();
  const fullBars: 4 | 8 = demo.chords.length > 4 ? 8 : 4;
  const paddedChords = Array.from({ length: fullBars }, (_, bar) => ({
    bar,
    degree: demo.chords[bar % demo.chords.length] ?? 'I',
  }));

  const proj: SongProject = {
    ...base,
    keyRoot,
    mode: demo.mode,
    bars: fullBars,
    bpm: demo.bpm,
    blocks: {
      ...base.blocks,
      grooveId: demo.grooveId,
    },
    chain: {
      chords: paddedChords,
      modifiers: buildDefaultModifiers(),
    },
    baked: true,
    bakedMelody: demo.melody.map((n) => ({ ...n })),
  };

  const compiled = compileSong(proj);
  const targetBars = demo.chords.length;
  const totalSteps = targetBars * 16;

  return {
    bars: targetBars,
    totalSteps,
    resolvedChords: compiled.resolvedChords.slice(0, targetBars),
    chords: compiled.chords.filter((c) => c.step < totalSteps),
    bass: compiled.bass.filter((b) => b.step < totalSteps),
    drums: compiled.drums.filter((d) => d.step < totalSteps),
    melody: compiled.melody.filter((m) => m.step < totalSteps),
  };
}

function evaluateRule(
  lesson: BasicLessonDefinition,
  rule: BasicLessonRule,
  project: SongProject,
  compiled: CompiledSong,
  report: DiagnosisReport
): boolean {
  switch (rule.type) {
    case 'bar_downbeat_chord_tones':
      return rule.bars.every((barIdx) =>
        compiled.melody.some((n) => n.step === barIdx * 16 && n.role === 'chord_tone')
      );

    case 'no_issue':
      return !report.issues.some((i) => i.kind === rule.issueKind);

    case 'min_non_downbeat_scale_notes':
      return (
        compiled.melody.filter((n) => n.step % 16 !== 0 && n.role !== 'clash').length >=
        rule.minCount
      );

    case 'min_distinct_durations':
      return new Set(compiled.melody.map((n) => n.duration)).size >= rule.minCount;

    case 'min_rest_ratio': {
      const soundSteps = compiled.melody.reduce((acc, n) => acc + n.duration, 0);
      return 1 - soundSteps / compiled.totalSteps >= rule.minRatio;
    }

    case 'last_note_pc': {
      if (compiled.melody.length === 0) return false;
      const last = compiled.melody[compiled.melody.length - 1];
      return rule.allowedPcs.includes(wrapPc(last.midi));
    }

    case 'bar_chord_degree':
      return compiled.resolvedChords[rule.barIndex]?.degree === rule.degree;

    case 'groove_not':
      return project.blocks.grooveId !== rule.disallowedId;

    case 'arrangement_changed': {
      const initial = createBasicLessonProject(lesson.id);
      if (project.mode !== initial.mode) return true;
      const initDegrees = initial.chain.chords.map((c) => c.degree).join(',');
      const curDegrees = project.chain.chords.map((c) => c.degree).join(',');
      if (initDegrees !== curDegrees) return true;
      const sig = (notes: NoteEvent[]) =>
        notes.map((n) => `${n.step}:${n.midi}:${n.duration}`).join('|');
      return sig(project.bakedMelody) !== sig(initial.bakedMelody);
    }
  }
}

export function evaluateBasicLesson(
  lessonId: string,
  project: SongProject,
  compiled?: CompiledSong,
  report?: DiagnosisReport
): BasicLessonEvaluation {
  const lesson = getBasicLessonById(lessonId);
  const comp = compiled ?? compileSong(project);
  const rep = report ?? analyzeSong(comp, project);

  const checks: BasicLessonCheckResult[] = lesson.rules.map((rule) => ({
    labelKo: rule.labelKo,
    passed: evaluateRule(lesson, rule, project, comp, rep),
  }));

  const passedCount = checks.filter((c) => c.passed).length;
  return {
    lessonId: lesson.id,
    passed: checks.every((c) => c.passed),
    checks,
    passedCount,
    totalCount: checks.length,
  };
}
