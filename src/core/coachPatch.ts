import coachRaw from '../data/coach.json';
import type { DiagnosisReport } from './analyzer';
import { type CompiledSong, compileSong } from './compiler';
import {
  PRESETS,
  type ModifierId,
  type SongProject,
  cloneProject,
} from './model';
import {
  type DegreeSymbol,
  KOREAN_SOLFEGE,
  NOTE_NAMES_SHARP,
  type ScaleMode,
  koreanNoteName,
  noteName,
} from './theory';

export interface CoachModelOption {
  id: string;
  labelKo: string;
  descKo: string;
}

export interface CoachQuickPrompt {
  id: string;
  label: string;
  prompt: string;
}

export interface CoachConfigData {
  apiBaseUrl: string;
  defaultModel: string;
  models: CoachModelOption[];
  generation: {
    thinkingLevel: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    maxOutputTokens: number;
    temperature?: number;
  };
  limits: {
    maxPromptLength: number;
    maxDemoChordsByBars: Record<'4' | '8', number>;
    maxDemoModifiers: number;
    maxDemoMelodyBars: number;
    maxDemoMelodyNotesPerBar: number;
    minMelodyMidi: number;
    maxMelodyMidi: number;
    maxHistoryTurns: number;
    maxHistorySummaryChars: number;
  };
  quickPrompts: CoachQuickPrompt[];
}

export const COACH_CONFIG = coachRaw as CoachConfigData;

export function getMaxDemoChords(bars: 4 | 8): number {
  return COACH_CONFIG.limits.maxDemoChordsByBars[String(bars) as '4' | '8'] ?? 2;
}

export interface CoachChordPatch {
  bar: number;
  degree: DegreeSymbol;
}

export interface CoachModifierPatch {
  id: ModifierId;
  enabled?: boolean;
  amount?: number;
}

export interface CoachDemoNote {
  stepInBar: number;
  midi: number;
  duration: number;
}

export interface CoachMelodyBarPatch {
  bar: number;
  notes: CoachDemoNote[];
}

export interface CoachPatch {
  chords?: CoachChordPatch[];
  modifiers?: CoachModifierPatch[];
  melodyBars?: CoachMelodyBarPatch[];
}

export interface CoachResponse {
  headline: string;
  explanation: string;
  theoryTip?: string;
  manualSteps?: string[];
  patchSummary?: string;
  patch?: CoachPatch;
}

export interface CoachTurn {
  mode: 'explain' | 'request';
  userPrompt: string;
  assistantHeadline: string;
  assistantExplanation: string;
  patchSummary?: string;
}

export interface CoachContentMessage {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

export interface CoachGhostNote {
  step: number;
  midi: number;
  duration: number;
  bar: number;
  label: string;
}

export interface CoachChangedChordBar {
  bar: number;
  beforeSymbol: string;
  afterSymbol: string;
  afterDegree: DegreeSymbol;
  afterTonesKo: string;
}

export interface CoachVisualDiff {
  changedChordBars: CoachChangedChordBar[];
  ghostNotes: CoachGhostNote[];
  affectedMelodyBars: number[];
}

export interface CoachContextPayload {
  song: {
    keyRoot: number;
    keyName: string;
    koreanKeyName: string;
    mode: ScaleMode;
    bars: 4 | 8;
    bpm: number;
    baked: boolean;
    activeLayer: SongProject['activeLayer'];
  };
  blocks: {
    progressionId: string;
    grooveId: string;
    contourId: string;
    energy: number;
    density: number;
  };
  chords: Array<{
    bar: number;
    degree: DegreeSymbol;
    symbol: string;
    koreanRoot: string;
  }>;
  modifiers: Array<{
    id: ModifierId;
    nameKo: string;
    enabled: boolean;
    amount: number;
  }>;
  melodyStats: {
    noteCount: number;
    lowestNote: string | null;
    highestNote: string | null;
    rangeSemitones: number;
    clashCount: number;
    lastNote: string | null;
  };
  melodyByBar: Array<{
    bar: number;
    notes: Array<{
      stepInBar: number;
      duration: number;
      midi: number;
      note: string;
      korean: string;
      role: string;
    }>;
  }>;
  analysis: {
    score: number;
    summary: string;
    issues: Array<{
      id: string;
      kind: string;
      severity: 'warn' | 'tip';
      bar: number;
      title: string;
      explanation: string;
    }>;
  };
  catalog: {
    modifiers: Array<{ id: ModifierId; nameKo: string; descKo: string }>;
    availableDegrees: DegreeSymbol[];
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatPitchLabel(midi: number): string {
  return `${koreanNoteName(midi)}(${noteName(midi)})`;
}

export function buildCoachContext(
  project: SongProject,
  compiled: CompiledSong,
  report: DiagnosisReport
): CoachContextPayload {
  const modNameMap = new Map(PRESETS.modifiers.map((m) => [m.id, m.nameKo]));
  const melody = compiled.melody;
  const midis = melody.map((n) => n.midi);
  const minMidi = midis.length > 0 ? Math.min(...midis) : null;
  const maxMidi = midis.length > 0 ? Math.max(...midis) : null;
  const lastNote = melody.length > 0 ? melody[melody.length - 1] : null;

  const melodyByBar = Array.from({ length: project.bars }, (_, barIdx) => {
    const barNotes = melody
      .filter((n) => Math.floor(n.step / 16) === barIdx)
      .map((n) => ({
        stepInBar: n.step % 16,
        duration: n.duration,
        midi: n.midi,
        note: noteName(n.midi),
        korean: koreanNoteName(n.midi),
        role: n.role,
      }));
    return {
      bar: barIdx + 1,
      notes: barNotes,
    };
  });

  return {
    song: {
      keyRoot: project.keyRoot,
      keyName: NOTE_NAMES_SHARP[project.keyRoot] ?? 'C',
      koreanKeyName: KOREAN_SOLFEGE[project.keyRoot] ?? '도',
      mode: project.mode,
      bars: project.bars,
      bpm: project.bpm,
      baked: project.baked,
      activeLayer: project.activeLayer,
    },
    blocks: {
      progressionId: project.blocks.progressionId,
      grooveId: project.blocks.grooveId,
      contourId: project.blocks.contourId,
      energy: round2(project.blocks.energy),
      density: round2(project.blocks.density),
    },
    chords: compiled.resolvedChords.map((rc, idx) => ({
      bar: idx + 1,
      degree: rc.degree,
      symbol: rc.symbol,
      koreanRoot: rc.koreanRoot,
    })),
    modifiers: project.chain.modifiers.map((m) => ({
      id: m.id,
      nameKo: modNameMap.get(m.id) ?? m.id,
      enabled: m.enabled,
      amount: round2(m.amount),
    })),
    melodyStats: {
      noteCount: melody.length,
      lowestNote: minMidi !== null ? formatPitchLabel(minMidi) : null,
      highestNote: maxMidi !== null ? formatPitchLabel(maxMidi) : null,
      rangeSemitones: minMidi !== null && maxMidi !== null ? maxMidi - minMidi : 0,
      clashCount: melody.filter((n) => n.role === 'clash').length,
      lastNote: lastNote ? formatPitchLabel(lastNote.midi) : null,
    },
    melodyByBar,
    analysis: {
      score: report.score,
      summary: report.summary,
      issues: report.issues.map((issue) => ({
        id: issue.id,
        kind: issue.kind,
        severity: issue.severity,
        bar: issue.bar,
        title: issue.title,
        explanation: issue.explanation,
      })),
    },
    catalog: {
      modifiers: PRESETS.modifiers.map((m) => ({
        id: m.id,
        nameKo: m.nameKo,
        descKo: m.descKo,
      })),
      availableDegrees: [...PRESETS.availableDegrees],
    },
  };
}

export function buildCoachResponseSchema(bars: 4 | 8 = 4): Record<string, unknown> {
  const modifierIds = PRESETS.modifiers.map((m) => m.id);
  const degrees = [...PRESETS.availableDegrees];
  const limits = COACH_CONFIG.limits;
  const maxChords = getMaxDemoChords(bars);

  return {
    type: 'object',
    properties: {
      headline: {
        type: 'string',
        description: '한 줄 핵심 이론 요약 (한국어)',
      },
      explanation: {
        type: 'string',
        description: '도레미·기초 기타 코드 수준의 초보자를 위한 친절한 한국어 이론 설명 (2~4문장)',
      },
      theoryTip: {
        type: 'string',
        description: '선택적 음악 이론 한 줄 팁 (한국어)',
      },
      manualSteps: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'string',
        },
        description: '사용자가 L2 또는 L3 화면에서 손으로 직접 따라 해볼 수 있는 단계 안내 (최대 4줄)',
      },
      patchSummary: {
        type: 'string',
        description: '비교 청취용 국소 대안 한 줄 요약 (한국어)',
      },
      patch: {
        type: 'object',
        description: '비교 청취 전용 국소 대안 (원곡을 직접 수정하지 않음)',
        properties: {
          chords: {
            type: 'array',
            maxItems: maxChords,
            items: {
              type: 'object',
              properties: {
                bar: {
                  type: 'integer',
                  minimum: 1,
                  maximum: bars,
                  description: '1부터 시작하는 마디 번호',
                },
                degree: {
                  type: 'string',
                  enum: degrees,
                },
              },
              required: ['bar', 'degree'],
              additionalProperties: false,
            },
          },
          modifiers: {
            type: 'array',
            maxItems: limits.maxDemoModifiers,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', enum: modifierIds },
                enabled: { type: 'boolean' },
                amount: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: ['id'],
              additionalProperties: false,
            },
          },
          melodyBars: {
            type: 'array',
            maxItems: limits.maxDemoMelodyBars,
            description: '특정 마디 멜로디 대안 비교 청취용 (최대 2마디)',
            items: {
              type: 'object',
              properties: {
                bar: {
                  type: 'integer',
                  minimum: 1,
                  maximum: bars,
                  description: '1부터 시작하는 마디 번호',
                },
                notes: {
                  type: 'array',
                  minItems: 1,
                  maxItems: limits.maxDemoMelodyNotesPerBar,
                  items: {
                    type: 'object',
                    properties: {
                      stepInBar: {
                        type: 'integer',
                        minimum: 0,
                        maximum: 15,
                        description: '마디 내 16분음표 위치 (0=1박, 4=2박, 8=3박, 12=4박)',
                      },
                      midi: {
                        type: 'integer',
                        minimum: limits.minMelodyMidi,
                        maximum: limits.maxMelodyMidi,
                        description: 'MIDI 음높이 (60=C4 ~ 84=C6)',
                      },
                      duration: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 16,
                        description: '16분음표 칸 길이 (2=8분음표, 4=4분음표)',
                      },
                    },
                    required: ['stepInBar', 'midi', 'duration'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['bar', 'notes'],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
    required: ['headline', 'explanation'],
    additionalProperties: false,
  };
}

export function buildCoachSystemPrompt(bars: 4 | 8 = 4): string {
  const maxChords = getMaxDemoChords(bars);
  const { maxDemoModifiers, maxDemoMelodyBars } = COACH_CONFIG.limits;
  return [
    '너는 곡을 대신 작곡하거나 수정하지 않는 한국어 음악 이론 튜터다.',
    '도레미 계이름과 기초 기타 코드만 아는 초보자에게 화성·선율·리듬 원리를 계이름(도·레·미·파·솔·라·시)과 느낌으로 쉽게 설명한다.',
    '사용자의 원곡과 L3 멜로디는 절대 자동으로 덮어쓰지 않는다.',
    `비교 청취 예시(patch)가 필요할 때만 마디 코드 최대 ${maxChords}개(chords), L2 변형 카드 최대 ${maxDemoModifiers}개(modifiers), 국소 멜로디 대안 최대 ${maxDemoMelodyBars}마디(melodyBars)만 제안한다.`,
    'melodyByBar 의 실제 음표(계이름·박자·역할)를 근거로 멜로디 조언을 작성하고, 사용자가 L2/L3에서 직접 고쳐볼 수 있도록 manualSteps 에 마디 번호와 계이름(예: 4마디 마지막 음을 미로 착지)을 1~3줄 적는다.',
    '반드시 응답 스키마에 맞는 순수 JSON 객체 하나만 출력한다(마크다운 코드블록 금지).',
    'patch 를 포함할 때는 반드시 제공된 catalog 의 availableDegrees 와 modifiers.id 만 사용하며, chords[].bar 와 melodyBars[].bar 는 1부터 시작하는 마디 번호를 쓴다.',
  ].join('\n');
}

export function buildCoachUserPrompt(
  context: CoachContextPayload,
  mode: 'explain' | 'request',
  userRequest?: string,
  hasHistory = false
): string {
  const bakedNotice = context.song.baked
    ? '참고: 현재 곡은 사용자가 직접 편집한 L3 멜로디(baked=true) 상태다. 원곡은 보존되므로 필요 시 1~2마디 멜로디 대안(melodyBars)이나 화성 대안(chords)을 비교 예시로 들려주고 직접 수정할 manualSteps 를 안내하라.'
    : '참고: 현재 곡은 L1/L2 규칙 상태(baked=false)이므로 L2 코드·변형 카드 또는 국소 멜로디 비교 예시로 차이를 들려줄 수 있다.';

  const historyNotice = hasHistory
    ? '이전 대화 맥락을 이어서 답하되, 반드시 아래 최신 곡 상태 JSON을 기준으로 설명하라.'
    : '';

  const instruction =
    mode === 'explain'
      ? [
          '요청 유형: 로컬 이론 분석 리포트 해설.',
          '현재 곡 상태, melodyByBar, analysis 리포트를 보고 왜 점수가 이렇게 나왔는지와 핵심 이론 원리를 초보자 눈높이로 설명하라.',
          '청각 비교가 도움이 되면 국소 비교 예시(patch)와 사용자가 직접 해볼 manualSteps 를 제안하라.',
        ].join('\n')
      : [
          '요청 유형: 작곡 이론 질문·대안 비교.',
          `사용자 질문: "${(userRequest ?? '').trim()}"`,
          '질문에 대한 화성·멜로디 이론 원리를 먼저 설명하고, 사용자가 직접 바꿔 볼 manualSteps 와 필요 시 국소 비교 청취 예시(patch)를 제안하라.',
        ].join('\n');

  return [instruction, historyNotice, bakedNotice, '', '현재 곡 및 허용 카탈로그 JSON:', JSON.stringify(context)]
    .filter((line, idx) => line.length > 0 || idx === 3)
    .join('\n');
}

export function trimCoachHistory(
  history: CoachTurn[],
  maxTurns = COACH_CONFIG.limits.maxHistoryTurns
): CoachTurn[] {
  const safeMax = Math.max(0, Math.floor(maxTurns));
  if (safeMax === 0 || history.length === 0) return [];
  return history.slice(-safeMax);
}

export function buildCoachContents(
  context: CoachContextPayload,
  mode: 'explain' | 'request',
  userRequest?: string,
  history: CoachTurn[] = []
): CoachContentMessage[] {
  const recentHistory = trimCoachHistory(history);
  const maxChars = Math.max(1, COACH_CONFIG.limits.maxHistorySummaryChars);
  const contents: CoachContentMessage[] = [];

  for (const turn of recentHistory) {
    const truncatedExplanation =
      turn.assistantExplanation.length > maxChars
        ? `${turn.assistantExplanation.slice(0, maxChars)}...`
        : turn.assistantExplanation;
    const modelSummary: Record<string, string> = {
      headline: turn.assistantHeadline,
      explanation: truncatedExplanation,
    };
    if (turn.patchSummary) {
      modelSummary.patchSummary = turn.patchSummary;
    }
    contents.push({
      role: 'user',
      parts: [{ text: turn.userPrompt }],
    });
    contents.push({
      role: 'model',
      parts: [{ text: JSON.stringify(modelSummary) }],
    });
  }

  contents.push({
    role: 'user',
    parts: [{ text: buildCoachUserPrompt(context, mode, userRequest, recentHistory.length > 0) }],
  });

  return contents;
}

export function extractJsonText(rawText: string): string {
  const trimmed = rawText.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return candidate.slice(firstBrace, lastBrace + 1);
  }
  return candidate;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sanitizeCoachPatch(
  raw: unknown,
  currentBars: 4 | 8
): { patch: CoachPatch | undefined; warnings: string[] } {
  const warnings: string[] = [];
  if (raw === undefined || raw === null) {
    return { patch: undefined, warnings };
  }
  if (!isPlainObject(raw)) {
    warnings.push('비교 예시 패치 형식이 올바르지 않아 제외했다.');
    return { patch: undefined, warnings };
  }

  const forbiddenFields = [
    ['keyRoot', '키(keyRoot)'],
    ['mode', '조성(mode)'],
    ['bars', '마디 수(bars)'],
    ['bpm', '빠르기(bpm)'],
    ['blocks', 'L1 블록 일괄 교체(blocks)'],
    ['unbakeMelody', '사용자 멜로디 덮어쓰기(unbakeMelody)'],
  ] as const;

  for (const [key, label] of forbiddenFields) {
    if (raw[key] !== undefined) {
      warnings.push(`튜터 정책상 ${label} 변경은 차단했다.`);
    }
  }

  const limits = COACH_CONFIG.limits;
  const maxChords = getMaxDemoChords(currentBars);
  const validModifiers = new Set<string>(PRESETS.modifiers.map((m) => m.id));
  const validDegrees = new Set<string>(PRESETS.availableDegrees);

  const patch: CoachPatch = {};
  let hasAnyField = false;

  if (raw.chords !== undefined) {
    if (!Array.isArray(raw.chords)) {
      warnings.push('코드 비교 항목 형식이 올바르지 않아 제외했다.');
    } else {
      const byBar = new Map<number, DegreeSymbol>();
      for (const item of raw.chords) {
        if (!isPlainObject(item)) {
          warnings.push('잘못된 코드 슬롯 항목을 제외했다.');
          continue;
        }
        const bar = item.bar;
        const degree = item.degree;
        if (typeof bar !== 'number' || !Number.isInteger(bar) || bar < 1 || bar > currentBars) {
          warnings.push(`범위를 벗어난 마디 번호(${String(bar)}) 코드 변경을 제외했다.`);
          continue;
        }
        if (typeof degree !== 'string' || !validDegrees.has(degree)) {
          warnings.push(`지원하지 않는 코드 도수(${String(degree)})를 제외했다.`);
          continue;
        }
        byBar.set(bar, degree as DegreeSymbol);
      }
      if (byBar.size > maxChords) {
        warnings.push(`비교용 마디 코드 대안은 최대 ${maxChords}개까지만 허용해 나머지를 제외했다.`);
      }
      const limitedChords = Array.from(byBar.entries())
        .slice(0, maxChords)
        .sort((a, b) => a[0] - b[0])
        .map(([bar, degree]) => ({ bar, degree }));
      if (limitedChords.length > 0) {
        patch.chords = limitedChords;
        hasAnyField = true;
      }
    }
  }

  if (raw.modifiers !== undefined) {
    if (!Array.isArray(raw.modifiers)) {
      warnings.push('변형 카드 비교 항목 형식이 올바르지 않아 제외했다.');
    } else {
      const byId = new Map<ModifierId, CoachModifierPatch>();
      for (const item of raw.modifiers) {
        if (!isPlainObject(item)) {
          warnings.push('잘못된 변형 카드 항목을 제외했다.');
          continue;
        }
        if (typeof item.id !== 'string' || !validModifiers.has(item.id)) {
          warnings.push(`목록에 없는 변형 카드 ID(${String(item.id)})를 제외했다.`);
          continue;
        }
        const entry: CoachModifierPatch = { id: item.id as ModifierId };
        let hasModField = false;
        if (typeof item.enabled === 'boolean') {
          entry.enabled = item.enabled;
          hasModField = true;
        } else if (item.enabled !== undefined) {
          warnings.push(`변형 카드(${item.id})의 enabled 값이 올바르지 않아 제외했다.`);
        }
        if (typeof item.amount === 'number' && Number.isFinite(item.amount)) {
          const clampedAmt = round2(clamp(item.amount, 0, 1));
          if (item.amount < 0 || item.amount > 1) {
            warnings.push(`변형 카드(${item.id}) 강도를 0~1 범위로 맞췄다.`);
          }
          entry.amount = clampedAmt;
          hasModField = true;
        } else if (item.amount !== undefined) {
          warnings.push(`변형 카드(${item.id})의 강도 값이 올바르지 않아 제외했다.`);
        }
        if (hasModField) {
          byId.set(entry.id, entry);
        }
      }
      if (byId.size > limits.maxDemoModifiers) {
        warnings.push(`비교용 변형 카드 대안은 최대 ${limits.maxDemoModifiers}개까지만 허용해 나머지를 제외했다.`);
      }
      const limitedMods = Array.from(byId.values()).slice(0, limits.maxDemoModifiers);
      if (limitedMods.length > 0) {
        patch.modifiers = limitedMods;
        hasAnyField = true;
      }
    }
  }

  if (raw.melodyBars !== undefined) {
    if (!Array.isArray(raw.melodyBars)) {
      warnings.push('멜로디 비교 항목 형식이 올바르지 않아 제외했다.');
    } else {
      const byBar = new Map<number, CoachDemoNote[]>();
      for (const item of raw.melodyBars) {
        if (!isPlainObject(item)) {
          warnings.push('잘못된 멜로디 마디 항목을 제외했다.');
          continue;
        }
        const bar = item.bar;
        if (typeof bar !== 'number' || !Number.isInteger(bar) || bar < 1 || bar > currentBars) {
          warnings.push(`범위를 벗어난 멜로디 비교 마디(${String(bar)})를 제외했다.`);
          continue;
        }
        if (!Array.isArray(item.notes)) {
          warnings.push(`${bar}마디 멜로디 음표 목록이 배열이 아니어서 제외했다.`);
          continue;
        }

        const byStep = new Map<number, CoachDemoNote>();
        for (const rawNote of item.notes) {
          if (!isPlainObject(rawNote)) {
            warnings.push(`${bar}마디 잘못된 음표 항목을 제외했다.`);
            continue;
          }
          const stepInBar = rawNote.stepInBar;
          if (typeof stepInBar !== 'number' || !Number.isInteger(stepInBar) || stepInBar < 0 || stepInBar > 15) {
            warnings.push(`${bar}마디 범위를 벗어난 박자 위치(${String(stepInBar)}) 음표를 제외했다.`);
            continue;
          }
          if (typeof rawNote.midi !== 'number' || !Number.isFinite(rawNote.midi)) {
            warnings.push(`${bar}마디 유효하지 않은 음높이(midi) 음표를 제외했다.`);
            continue;
          }
          if (typeof rawNote.duration !== 'number' || !Number.isFinite(rawNote.duration)) {
            warnings.push(`${bar}마디 유효하지 않은 길이(duration) 음표를 제외했다.`);
            continue;
          }

          const roundedMidi = Math.round(rawNote.midi);
          const clampedMidi = clamp(roundedMidi, limits.minMelodyMidi, limits.maxMelodyMidi);
          if (clampedMidi !== roundedMidi) {
            warnings.push(`${bar}마디 음높이를 피아노롤 범위(${limits.minMelodyMidi}~${limits.maxMelodyMidi})로 맞췄다.`);
          }

          const maxStepDur = 16 - stepInBar;
          const roundedDur = Math.round(rawNote.duration);
          const clampedDur = clamp(roundedDur, 1, maxStepDur);
          if (roundedDur < 1 || roundedDur > 16) {
            warnings.push(`${bar}마디 음표 길이를 허용 범위로 맞췄다.`);
          }

          byStep.set(stepInBar, {
            stepInBar,
            midi: clampedMidi,
            duration: clampedDur,
          });
        }

        const sortedNotes = Array.from(byStep.values()).sort((a, b) => a.stepInBar - b.stepInBar);
        if (sortedNotes.length > limits.maxDemoMelodyNotesPerBar) {
          warnings.push(
            `${bar}마디 비교 멜로디는 최대 ${limits.maxDemoMelodyNotesPerBar}음까지만 허용해 나머지를 제외했다.`
          );
        }
        const limitedNotes = sortedNotes.slice(0, limits.maxDemoMelodyNotesPerBar);
        if (limitedNotes.length > 0) {
          byBar.set(bar, limitedNotes);
        }
      }

      if (byBar.size > limits.maxDemoMelodyBars) {
        warnings.push(
          `비교용 멜로디 대안은 최대 ${limits.maxDemoMelodyBars}마디까지만 허용해 나머지를 제외했다.`
        );
      }
      const limitedMelodyBars = Array.from(byBar.entries())
        .slice(0, limits.maxDemoMelodyBars)
        .sort((a, b) => a[0] - b[0])
        .map(([bar, notes]) => ({ bar, notes }));
      if (limitedMelodyBars.length > 0) {
        patch.melodyBars = limitedMelodyBars;
        hasAnyField = true;
      }
    }
  }

  return { patch: hasAnyField ? patch : undefined, warnings };
}

export function parseCoachResponse(
  rawText: string,
  currentBars: 4 | 8
): { response: CoachResponse; warnings: string[] } {
  const jsonText = extractJsonText(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('코치 응답을 JSON 으로 해석하지 못했다.');
  }

  if (!isPlainObject(parsed)) {
    throw new Error('코치 응답 형식이 객체가 아니다.');
  }

  const headline = typeof parsed.headline === 'string' ? parsed.headline.trim() : '';
  const explanation = typeof parsed.explanation === 'string' ? parsed.explanation.trim() : '';

  if (!headline || !explanation) {
    throw new Error('코치 응답에 필수 설명(headline, explanation)이 빠져 있다.');
  }

  const theoryTip =
    typeof parsed.theoryTip === 'string' && parsed.theoryTip.trim().length > 0
      ? parsed.theoryTip.trim()
      : undefined;
  const patchSummary =
    typeof parsed.patchSummary === 'string' && parsed.patchSummary.trim().length > 0
      ? parsed.patchSummary.trim()
      : undefined;

  let manualSteps: string[] | undefined;
  if (Array.isArray(parsed.manualSteps)) {
    const cleaned = parsed.manualSteps
      .filter((step): step is string => typeof step === 'string')
      .map((step) => step.trim())
      .filter((step) => step.length > 0)
      .slice(0, 4);
    if (cleaned.length > 0) {
      manualSteps = cleaned;
    }
  }

  const { patch, warnings } = sanitizeCoachPatch(parsed.patch, currentBars);

  return {
    response: {
      headline,
      explanation,
      theoryTip,
      manualSteps,
      patchSummary,
      patch,
    },
    warnings,
  };
}

export function applyCoachPatch(project: SongProject, patch: CoachPatch): SongProject {
  const next = cloneProject(project);

  if (patch.chords) {
    for (const slot of patch.chords) {
      const idx = slot.bar - 1;
      if (idx >= 0 && idx < next.chain.chords.length) {
        next.chain.chords[idx] = { bar: idx, degree: slot.degree };
      }
    }
  }

  if (patch.modifiers) {
    for (const modPatch of patch.modifiers) {
      const target = next.chain.modifiers.find((m) => m.id === modPatch.id);
      if (!target) continue;
      if (modPatch.enabled !== undefined) target.enabled = modPatch.enabled;
      if (modPatch.amount !== undefined) target.amount = modPatch.amount;
    }
  }

  if (patch.melodyBars && patch.melodyBars.length > 0) {
    const baseNotes =
      next.baked && next.bakedMelody.length > 0
        ? next.bakedMelody.map((n) => ({ ...n }))
        : compileSong(next).melody.map(({ role: _role, ...n }) => ({ ...n }));

    const replaceBars = new Set(patch.melodyBars.map((mb) => mb.bar - 1));
    const kept = baseNotes.filter((n) => !replaceBars.has(Math.floor(n.step / 16)));

    for (const mb of patch.melodyBars) {
      const barBaseStep = (mb.bar - 1) * 16;
      mb.notes.forEach((n, idx) => {
        kept.push({
          id: `demo_m_${mb.bar}_${idx}`,
          midi: n.midi,
          step: barBaseStep + n.stepInBar,
          duration: Math.min(n.duration, 16 - n.stepInBar),
          velocity: 0.82,
          origin: 'user',
        });
      });
    }

    kept.sort((a, b) => a.step - b.step || a.midi - b.midi);
    next.bakedMelody = kept;
    next.baked = true;
  }

  return next;
}

export function describeCoachPatch(before: SongProject, after: SongProject, patch: CoachPatch): string[] {
  const lines: string[] = [];
  const modMap = new Map(PRESETS.modifiers.map((m) => [m.id, m.nameKo]));

  const requestedBars = new Set((patch.chords ?? []).map((c) => c.bar - 1));
  const changedBars: string[] = [];
  for (let i = 0; i < after.chain.chords.length; i++) {
    const prevDeg = before.chain.chords[i]?.degree;
    const nextDeg = after.chain.chords[i].degree;
    if (prevDeg !== nextDeg && (requestedBars.size === 0 || requestedBars.has(i))) {
      changedBars.push(`${i + 1}마디 ${prevDeg ?? '-'}→${nextDeg}`);
    }
  }
  if (changedBars.length > 0) {
    lines.push(`마디 코드 예시: ${changedBars.join(', ')}`);
  }

  for (const afterMod of after.chain.modifiers) {
    const beforeMod = before.chain.modifiers.find((m) => m.id === afterMod.id);
    if (!beforeMod) continue;
    const modName = modMap.get(afterMod.id) ?? afterMod.id;
    const enabledChanged = beforeMod.enabled !== afterMod.enabled;
    const amountChanged = Math.abs(beforeMod.amount - afterMod.amount) >= 0.01;
    if (enabledChanged) {
      lines.push(
        `변형 카드 예시 [${modName}]: ${afterMod.enabled ? `켜기 (${Math.round(afterMod.amount * 100)}%)` : '끄기'}`
      );
    } else if (amountChanged) {
      lines.push(
        `변형 카드 예시 [${modName}] 강도: ${Math.round(beforeMod.amount * 100)}% → ${Math.round(afterMod.amount * 100)}%`
      );
    }
  }

  if (patch.melodyBars) {
    for (const mb of patch.melodyBars) {
      const pitchSeq = mb.notes.map((n) => formatPitchLabel(n.midi)).join(' → ');
      if (pitchSeq) {
        lines.push(`멜로디 예시 (${mb.bar}마디): ${pitchSeq}`);
      }
    }
  }

  return lines;
}

export function buildCoachVisualDiff(
  beforeCompiled: CompiledSong,
  demoCompiled: CompiledSong,
  patch?: CoachPatch
): CoachVisualDiff {
  const changedChordBars: CoachChangedChordBar[] = [];
  const barCount = Math.min(beforeCompiled.resolvedChords.length, demoCompiled.resolvedChords.length);
  for (let i = 0; i < barCount; i++) {
    const before = beforeCompiled.resolvedChords[i];
    const after = demoCompiled.resolvedChords[i];
    if (before.symbol !== after.symbol || before.degree !== after.degree) {
      changedChordBars.push({
        bar: i,
        beforeSymbol: before.symbol,
        afterSymbol: after.symbol,
        afterDegree: after.degree,
        afterTonesKo: after.pitchClasses.map((pc) => KOREAN_SOLFEGE[pc]).join('·'),
      });
    }
  }

  const patchBars = new Set((patch?.melodyBars ?? []).map((mb) => mb.bar - 1));
  const ghostNotes: CoachGhostNote[] = [];

  if (patchBars.size > 0) {
    for (const n of demoCompiled.melody) {
      const bar = Math.floor(n.step / 16);
      if (patchBars.has(bar)) {
        ghostNotes.push({
          step: n.step,
          midi: n.midi,
          duration: n.duration,
          bar,
          label: koreanNoteName(n.midi),
        });
      }
    }
  } else {
    const beforeKeys = new Set(
      beforeCompiled.melody.map((n) => `${n.step}:${n.midi}:${n.duration}`)
    );
    for (const n of demoCompiled.melody) {
      const key = `${n.step}:${n.midi}:${n.duration}`;
      if (!beforeKeys.has(key)) {
        ghostNotes.push({
          step: n.step,
          midi: n.midi,
          duration: n.duration,
          bar: Math.floor(n.step / 16),
          label: koreanNoteName(n.midi),
        });
      }
    }
  }

  const affectedSet = new Set<number>([...patchBars, ...ghostNotes.map((g) => g.bar)]);
  const affectedMelodyBars = Array.from(affectedSet).sort((a, b) => a - b);

  return {
    changedChordBars,
    ghostNotes,
    affectedMelodyBars,
  };
}
