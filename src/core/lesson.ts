import lessonsRaw from '../data/lessons.json';
import { type DiagnosisReport, type IssueKind, analyzeSong } from './analyzer';
import { type CompiledSong, compileSong } from './compiler';
import {
  type EditorLayer,
  type L1Blocks,
  type ModifierId,
  type NoteEvent,
  type SongProject,
  buildChordsFromProgression,
  buildDefaultModifiers,
  createDefaultProject,
} from './model';
import type { DegreeSymbol, ScaleMode } from './theory';

export type LessonKindTag = '개념' | '반복' | '클래식' | '종합';

export type LessonRule =
  | { type: 'groove_in'; allowedIds: string[]; labelKo: string }
  | { type: 'energy_min'; min: number; labelKo: string }
  | { type: 'density_min'; min: number; labelKo: string }
  | { type: 'progression_equals'; progressionId: string; labelKo: string }
  | { type: 'contour_equals'; contourId: string; labelKo: string }
  | { type: 'mode_equals'; mode: ScaleMode; labelKo: string }
  | { type: 'key_root_in'; allowedRoots: number[]; labelKo: string }
  | { type: 'bar_chord_degree'; barIndex: number; degree: DegreeSymbol; labelKo: string }
  | { type: 'no_issue'; issueKind: IssueKind; labelKo: string }
  | { type: 'min_score'; minScore: number; labelKo: string }
  | { type: 'bar_downbeat_chord_tones'; bars: number[]; labelKo: string }
  | { type: 'min_note_count'; minCount: number; labelKo: string }
  | { type: 'modifier_enabled'; modifierId: ModifierId; minAmount?: number; labelKo: string }
  | { type: 'any_modifier_enabled'; modifierIds: ModifierId[]; labelKo: string }
  | { type: 'bars_equals'; bars: 4 | 8; labelKo: string }
  | { type: 'second_half_climax'; labelKo: string };

export interface LessonModifierOverride {
  id: ModifierId;
  enabled: boolean;
  amount: number;
}

export interface LessonInitialProject {
  activeLayer?: EditorLayer;
  keyRoot?: number;
  mode?: ScaleMode;
  bars?: 4 | 8;
  bpm?: number;
  seed?: number;
  blocks?: Partial<L1Blocks>;
  chordOverrides?: DegreeSymbol[];
  modifierOverrides?: LessonModifierOverride[];
  baked?: boolean;
  bakedMelody?: NoteEvent[];
}

export interface LessonDefinition {
  id: string;
  order: number;
  unitId: string;
  unitTitleKo: string;
  unitDescKo: string;
  kindTagKo: LessonKindTag;
  unlockedConceptKo: string;
  titleKo: string;
  stageTagKo: string;
  goalSummaryKo: string;
  whyKo: string;
  hintKo: string;
  initialProject: LessonInitialProject;
  rules: LessonRule[];
}

export interface LessonUnitGroup {
  unitId: string;
  unitTitleKo: string;
  unitDescKo: string;
  lessons: LessonDefinition[];
}

export interface LessonCheckResult {
  labelKo: string;
  passed: boolean;
}

export interface LessonEvaluation {
  lessonId: string;
  passed: boolean;
  checks: LessonCheckResult[];
  passedCount: number;
  totalCount: number;
}

export const LESSONS = lessonsRaw as LessonDefinition[];

export function getLessonById(lessonId: string): LessonDefinition {
  return LESSONS.find((l) => l.id === lessonId) ?? LESSONS[0];
}

export function getLessonUnits(): LessonUnitGroup[] {
  const map = new Map<string, LessonUnitGroup>();
  for (const lesson of LESSONS) {
    let group = map.get(lesson.unitId);
    if (!group) {
      group = {
        unitId: lesson.unitId,
        unitTitleKo: lesson.unitTitleKo,
        unitDescKo: lesson.unitDescKo,
        lessons: [],
      };
      map.set(lesson.unitId, group);
    }
    group.lessons.push(lesson);
  }
  return Array.from(map.values());
}

export function createLessonProject(lessonId: string): SongProject {
  const lesson = getLessonById(lessonId);
  const init = lesson.initialProject;
  const base = createDefaultProject();

  const bars = init.bars ?? base.bars;
  const blocks: L1Blocks = {
    ...base.blocks,
    ...(init.blocks ?? {}),
  };

  const chords = init.chordOverrides
    ? init.chordOverrides.slice(0, bars).map((degree, bar) => ({ bar, degree }))
    : buildChordsFromProgression(blocks.progressionId, bars);

  const modifiers = buildDefaultModifiers().map((m) => {
    const ov = init.modifierOverrides?.find((o) => o.id === m.id);
    return ov ? { ...m, enabled: ov.enabled, amount: ov.amount } : m;
  });

  return {
    ...base,
    keyRoot: init.keyRoot ?? base.keyRoot,
    mode: init.mode ?? base.mode,
    bars,
    bpm: init.bpm ?? base.bpm,
    seed: init.seed ?? base.seed,
    activeLayer: init.activeLayer ?? base.activeLayer,
    blocks,
    chain: {
      chords,
      modifiers,
    },
    baked: init.baked ?? false,
    bakedMelody: init.bakedMelody ? init.bakedMelody.map((n) => ({ ...n })) : [],
  };
}

function evaluateRule(
  rule: LessonRule,
  project: SongProject,
  compiled: CompiledSong,
  report: DiagnosisReport
): boolean {
  switch (rule.type) {
    case 'groove_in':
      return rule.allowedIds.includes(project.blocks.grooveId);

    case 'energy_min':
      return project.blocks.energy >= rule.min;

    case 'density_min':
      return project.blocks.density >= rule.min;

    case 'progression_equals':
      return project.blocks.progressionId === rule.progressionId;

    case 'contour_equals':
      return project.blocks.contourId === rule.contourId;

    case 'mode_equals':
      return project.mode === rule.mode;

    case 'key_root_in':
      return rule.allowedRoots.includes(project.keyRoot);

    case 'bar_chord_degree':
      return compiled.resolvedChords[rule.barIndex]?.degree === rule.degree;

    case 'no_issue':
      return !report.issues.some((i) => i.kind === rule.issueKind);

    case 'min_score':
      return report.score >= rule.minScore;

    case 'bar_downbeat_chord_tones':
      return rule.bars.every((barIdx) =>
        compiled.melody.some((n) => n.step === barIdx * 16 && n.role === 'chord_tone')
      );

    case 'min_note_count':
      return compiled.melody.length >= rule.minCount;

    case 'modifier_enabled': {
      if (project.baked) return false;
      const mod = project.chain.modifiers.find((m) => m.id === rule.modifierId);
      return Boolean(mod && mod.enabled && mod.amount >= (rule.minAmount ?? 0.1));
    }

    case 'any_modifier_enabled': {
      if (project.baked) return false;
      return rule.modifierIds.some((id) =>
        project.chain.modifiers.some((m) => m.id === id && m.enabled && m.amount > 0.1)
      );
    }

    case 'bars_equals':
      return project.bars === rule.bars;

    case 'second_half_climax': {
      if (project.bars !== 8) return false;
      const lift = project.chain.modifiers.find((m) => m.id === 'octave_lift');
      if (!project.baked && lift?.enabled && lift.amount >= 0.5) {
        return true;
      }
      const firstHalf = compiled.melody.filter((n) => n.step < 64).map((n) => n.midi);
      const secondHalf = compiled.melody.filter((n) => n.step >= 64).map((n) => n.midi);
      if (firstHalf.length === 0 || secondHalf.length === 0) return false;
      return Math.max(...secondHalf) > Math.max(...firstHalf);
    }
  }
}

export function evaluateLesson(
  lessonId: string,
  project: SongProject,
  compiled?: CompiledSong,
  report?: DiagnosisReport
): LessonEvaluation {
  const lesson = getLessonById(lessonId);
  const comp = compiled ?? compileSong(project);
  const rep = report ?? analyzeSong(comp, project);

  const checks: LessonCheckResult[] = lesson.rules.map((rule) => ({
    labelKo: rule.labelKo,
    passed: evaluateRule(rule, project, comp, rep),
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
