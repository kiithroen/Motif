import coachRaw from '../data/coach.json';
import type { DiagnosisReport } from './analyzer';
import { type CompiledSong, unpackBlocksToChain } from './compiler';
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
    minBpm: number;
    maxBpm: number;
    minEnergy: number;
    maxEnergy: number;
    minDensity: number;
    maxDensity: number;
    maxPromptLength: number;
  };
  quickPrompts: CoachQuickPrompt[];
}

export const COACH_CONFIG = coachRaw as CoachConfigData;

export interface CoachChordPatch {
  bar: number;
  degree: DegreeSymbol;
}

export interface CoachModifierPatch {
  id: ModifierId;
  enabled?: boolean;
  amount?: number;
}

export interface CoachBlocksPatch {
  progressionId?: string;
  grooveId?: string;
  contourId?: string;
  energy?: number;
  density?: number;
}

export interface CoachPatch {
  keyRoot?: number;
  mode?: ScaleMode;
  bars?: 4 | 8;
  bpm?: number;
  blocks?: CoachBlocksPatch;
  chords?: CoachChordPatch[];
  modifiers?: CoachModifierPatch[];
  unbakeMelody?: boolean;
}

export interface CoachResponse {
  headline: string;
  explanation: string;
  theoryTip?: string;
  patchSummary?: string;
  patch?: CoachPatch;
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
    progressions: Array<{ id: string; nameKo: string; moodKo: string; degrees: DegreeSymbol[] }>;
    grooves: Array<{ id: string; nameKo: string; moodKo: string; defaultBpm: number }>;
    contours: Array<{ id: string; nameKo: string; descKo: string }>;
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
      progressions: PRESETS.progressions.map((p) => ({
        id: p.id,
        nameKo: p.nameKo,
        moodKo: p.moodKo,
        degrees: [...p.degrees],
      })),
      grooves: PRESETS.grooves.map((g) => ({
        id: g.id,
        nameKo: g.nameKo,
        moodKo: g.moodKo,
        defaultBpm: g.defaultBpm,
      })),
      contours: PRESETS.contours.map((c) => ({
        id: c.id,
        nameKo: c.nameKo,
        descKo: c.descKo,
      })),
      modifiers: PRESETS.modifiers.map((m) => ({
        id: m.id,
        nameKo: m.nameKo,
        descKo: m.descKo,
      })),
      availableDegrees: [...PRESETS.availableDegrees],
    },
  };
}

export function buildCoachResponseSchema(): Record<string, unknown> {
  const progressionIds = PRESETS.progressions.map((p) => p.id);
  const grooveIds = PRESETS.grooves.map((g) => g.id);
  const contourIds = PRESETS.contours.map((c) => c.id);
  const modifierIds = PRESETS.modifiers.map((m) => m.id);
  const degrees = [...PRESETS.availableDegrees];
  const limits = COACH_CONFIG.limits;

  return {
    type: 'object',
    properties: {
      headline: {
        type: 'string',
        description: '한 줄 핵심 코칭 요약 (한국어)',
      },
      explanation: {
        type: 'string',
        description: '도레미·기초 기타 코드 수준의 초보자를 위한 친절한 한국어 설명 (2~4문장)',
      },
      theoryTip: {
        type: 'string',
        description: '선택적 음악 이론 한 줄 팁 (한국어)',
      },
      patchSummary: {
        type: 'string',
        description: '제안하는 편곡 변경 한 줄 요약 (한국어)',
      },
      patch: {
        type: 'object',
        properties: {
          keyRoot: {
            type: 'integer',
            minimum: 0,
            maximum: 11,
            description: '0(C)~11(B) 사이의 루트 음높이',
          },
          mode: {
            type: 'string',
            enum: ['major', 'minor'],
          },
          bars: {
            type: 'integer',
            enum: [4, 8],
          },
          bpm: {
            type: 'integer',
            minimum: limits.minBpm,
            maximum: limits.maxBpm,
          },
          blocks: {
            type: 'object',
            properties: {
              progressionId: { type: 'string', enum: progressionIds },
              grooveId: { type: 'string', enum: grooveIds },
              contourId: { type: 'string', enum: contourIds },
              energy: { type: 'number', minimum: limits.minEnergy, maximum: limits.maxEnergy },
              density: { type: 'number', minimum: limits.minDensity, maximum: limits.maxDensity },
            },
            additionalProperties: false,
          },
          chords: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                bar: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 8,
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
          unbakeMelody: {
            type: 'boolean',
            description: '고정된 L3 멜로디를 풀고 새 블록/변형으로 다시 생성할지 여부',
          },
        },
        additionalProperties: false,
      },
    },
    required: ['headline', 'explanation'],
    additionalProperties: false,
  };
}

export function buildCoachSystemPrompt(): string {
  return [
    '너는 도레미 계이름과 기초 기타 코드만 아는 초보자에게 작곡 원리를 알려주는 한국어 음악 코치다.',
    '어려운 전문 용어는 피하거나 계이름(도·레·미·파·솔·라·시)과 느낌으로 쉽게 풀어서 설명한다.',
    '설명은 단정하고 친절한 한국어로 간결하게 쓴다.',
    '반드시 응답 스키마에 맞는 순수 JSON 객체 하나만 출력한다(마크다운 코드블록 금지).',
    'patch 를 제안할 때는 반드시 제공된 catalog 의 progressionId, grooveId, contourId, modifier.id, availableDegrees 만 사용한다.',
    'chords 배열의 bar 필드는 반드시 1부터 시작하는 마디 번호(1~bars)로 지정한다.',
    '사용자가 바꾸지 않아도 되는 항목은 patch 에 불필요하게 넣지 않는다.',
  ].join('\n');
}

export function buildCoachUserPrompt(
  context: CoachContextPayload,
  mode: 'explain' | 'request',
  userRequest?: string
): string {
  const instruction =
    mode === 'explain'
      ? [
          '요청 유형: 로컬 이론 분석 리포트 해설 및 개선 패치 제안.',
          '현재 곡 상태와 analysis 리포트를 보고, 왜 점수가 이렇게 나왔는지와 가장 효과적인 개선 포인트를 초보자 눈높이로 설명하라.',
          '개선이 도움이 되면 바로 비교 재생해 볼 수 있도록 L1/L2 블록·코드·변형 카드 중심의 patch 도 함께 제안하라.',
        ].join('\n')
      : [
          '요청 유형: 자연어 편곡 요청 반영.',
          `사용자 요청: "${(userRequest ?? '').trim()}"`,
          '사용자 요청을 음악적으로 구현할 수 있는 L1/L2 patch 를 만들고, 무엇을 왜 바꿨는지 초보자 눈높이로 설명하라.',
          '현재 멜로디가 baked=true 상태이고 블록·변형 변화가 체감돼야 한다면 unbakeMelody=true 를 포함하라.',
        ].join('\n');

  return `${instruction}\n\n현재 곡 및 허용 카탈로그 JSON:\n${JSON.stringify(context)}`;
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
    warnings.push('패치 형식이 올바르지 않아 제안 변경을 건너뛰었다.');
    return { patch: undefined, warnings };
  }

  const limits = COACH_CONFIG.limits;
  const validProgressions = new Set(PRESETS.progressions.map((p) => p.id));
  const validGrooves = new Set(PRESETS.grooves.map((g) => g.id));
  const validContours = new Set(PRESETS.contours.map((c) => c.id));
  const validModifiers = new Set<string>(PRESETS.modifiers.map((m) => m.id));
  const validDegrees = new Set<string>(PRESETS.availableDegrees);

  const patch: CoachPatch = {};
  let hasAnyField = false;

  if (raw.keyRoot !== undefined) {
    if (typeof raw.keyRoot === 'number' && Number.isInteger(raw.keyRoot) && raw.keyRoot >= 0 && raw.keyRoot <= 11) {
      patch.keyRoot = raw.keyRoot;
      hasAnyField = true;
    } else {
      warnings.push('유효하지 않은 키(keyRoot) 값을 제외했다.');
    }
  }

  if (raw.mode !== undefined) {
    if (raw.mode === 'major' || raw.mode === 'minor') {
      patch.mode = raw.mode;
      hasAnyField = true;
    } else {
      warnings.push('유효하지 않은 조성(mode) 값을 제외했다.');
    }
  }

  if (raw.bars !== undefined) {
    if (raw.bars === 4 || raw.bars === 8) {
      patch.bars = raw.bars;
      hasAnyField = true;
    } else {
      warnings.push('마디 수는 4 또는 8만 지원해 해당 변경을 제외했다.');
    }
  }

  const effectiveBars = patch.bars ?? currentBars;

  if (raw.bpm !== undefined) {
    if (typeof raw.bpm === 'number' && Number.isFinite(raw.bpm)) {
      const clampedBpm = Math.round(clamp(raw.bpm, limits.minBpm, limits.maxBpm));
      if (clampedBpm !== Math.round(raw.bpm)) {
        warnings.push(`BPM 을 허용 범위(${limits.minBpm}~${limits.maxBpm})로 맞췄다.`);
      }
      patch.bpm = clampedBpm;
      hasAnyField = true;
    } else {
      warnings.push('유효하지 않은 BPM 값을 제외했다.');
    }
  }

  if (raw.blocks !== undefined) {
    if (!isPlainObject(raw.blocks)) {
      warnings.push('블록 패치 형식이 올바르지 않아 제외했다.');
    } else {
      const blocksPatch: CoachBlocksPatch = {};
      let hasBlockField = false;

      if (raw.blocks.progressionId !== undefined) {
        if (typeof raw.blocks.progressionId === 'string' && validProgressions.has(raw.blocks.progressionId)) {
          blocksPatch.progressionId = raw.blocks.progressionId;
          hasBlockField = true;
        } else {
          warnings.push('목록에 없는 코드 진행 ID 를 제외했다.');
        }
      }

      if (raw.blocks.grooveId !== undefined) {
        if (typeof raw.blocks.grooveId === 'string' && validGrooves.has(raw.blocks.grooveId)) {
          blocksPatch.grooveId = raw.blocks.grooveId;
          hasBlockField = true;
        } else {
          warnings.push('목록에 없는 그루브 ID 를 제외했다.');
        }
      }

      if (raw.blocks.contourId !== undefined) {
        if (typeof raw.blocks.contourId === 'string' && validContours.has(raw.blocks.contourId)) {
          blocksPatch.contourId = raw.blocks.contourId;
          hasBlockField = true;
        } else {
          warnings.push('목록에 없는 선율 윤곽 ID 를 제외했다.');
        }
      }

      if (raw.blocks.energy !== undefined) {
        if (typeof raw.blocks.energy === 'number' && Number.isFinite(raw.blocks.energy)) {
          const clampedEnergy = round2(clamp(raw.blocks.energy, limits.minEnergy, limits.maxEnergy));
          if (raw.blocks.energy < limits.minEnergy || raw.blocks.energy > limits.maxEnergy) {
            warnings.push(`에너지 값을 허용 범위(${limits.minEnergy}~${limits.maxEnergy})로 맞췄다.`);
          }
          blocksPatch.energy = clampedEnergy;
          hasBlockField = true;
        } else {
          warnings.push('유효하지 않은 에너지 값을 제외했다.');
        }
      }

      if (raw.blocks.density !== undefined) {
        if (typeof raw.blocks.density === 'number' && Number.isFinite(raw.blocks.density)) {
          const clampedDensity = round2(clamp(raw.blocks.density, limits.minDensity, limits.maxDensity));
          if (raw.blocks.density < limits.minDensity || raw.blocks.density > limits.maxDensity) {
            warnings.push(`음표 밀도 값을 허용 범위(${limits.minDensity}~${limits.maxDensity})로 맞췄다.`);
          }
          blocksPatch.density = clampedDensity;
          hasBlockField = true;
        } else {
          warnings.push('유효하지 않은 음표 밀도 값을 제외했다.');
        }
      }

      if (hasBlockField) {
        patch.blocks = blocksPatch;
        hasAnyField = true;
      }
    }
  }

  if (raw.chords !== undefined) {
    if (!Array.isArray(raw.chords)) {
      warnings.push('코드 패치 형식이 올바르지 않아 제외했다.');
    } else {
      const byBar = new Map<number, DegreeSymbol>();
      for (const item of raw.chords) {
        if (!isPlainObject(item)) {
          warnings.push('잘못된 코드 슬롯 항목을 제외했다.');
          continue;
        }
        const bar = item.bar;
        const degree = item.degree;
        if (typeof bar !== 'number' || !Number.isInteger(bar) || bar < 1 || bar > effectiveBars) {
          warnings.push(`범위를 벗어난 마디 번호(${String(bar)}) 코드 변경을 제외했다.`);
          continue;
        }
        if (typeof degree !== 'string' || !validDegrees.has(degree)) {
          warnings.push(`지원하지 않는 코드 도수(${String(degree)})를 제외했다.`);
          continue;
        }
        byBar.set(bar, degree as DegreeSymbol);
      }
      if (byBar.size > 0) {
        patch.chords = Array.from(byBar.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([bar, degree]) => ({ bar, degree }));
        hasAnyField = true;
      }
    }
  }

  if (raw.modifiers !== undefined) {
    if (!Array.isArray(raw.modifiers)) {
      warnings.push('변형 카드 패치 형식이 올바르지 않아 제외했다.');
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
      if (byId.size > 0) {
        patch.modifiers = Array.from(byId.values());
        hasAnyField = true;
      }
    }
  }

  if (raw.unbakeMelody !== undefined) {
    if (typeof raw.unbakeMelody === 'boolean') {
      patch.unbakeMelody = raw.unbakeMelody;
      hasAnyField = true;
    } else {
      warnings.push('unbakeMelody 값이 불리언이 아니어서 제외했다.');
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

  const { patch, warnings } = sanitizeCoachPatch(parsed.patch, currentBars);

  return {
    response: {
      headline,
      explanation,
      theoryTip,
      patchSummary,
      patch,
    },
    warnings,
  };
}

export function applyCoachPatch(project: SongProject, patch: CoachPatch): SongProject {
  const next = cloneProject(project);

  if (patch.keyRoot !== undefined) next.keyRoot = patch.keyRoot;
  if (patch.mode !== undefined) next.mode = patch.mode;
  if (patch.bpm !== undefined) next.bpm = patch.bpm;
  if (patch.bars !== undefined) next.bars = patch.bars;

  if (patch.blocks) {
    if (patch.blocks.progressionId !== undefined) next.blocks.progressionId = patch.blocks.progressionId;
    if (patch.blocks.grooveId !== undefined) next.blocks.grooveId = patch.blocks.grooveId;
    if (patch.blocks.contourId !== undefined) next.blocks.contourId = patch.blocks.contourId;
    if (patch.blocks.energy !== undefined) next.blocks.energy = patch.blocks.energy;
    if (patch.blocks.density !== undefined) next.blocks.density = patch.blocks.density;
  }

  if (next.blocks.progressionId !== project.blocks.progressionId || next.bars !== project.bars) {
    next.chain = unpackBlocksToChain(next.blocks, next.bars, next.chain.modifiers);
  }

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

  const structuralBlockOrModChange =
    patch.blocks !== undefined || patch.modifiers !== undefined || patch.bars !== undefined;
  if (patch.unbakeMelody === true || (patch.unbakeMelody !== false && structuralBlockOrModChange)) {
    next.baked = false;
  }

  return next;
}

export function describeCoachPatch(before: SongProject, after: SongProject, patch: CoachPatch): string[] {
  const lines: string[] = [];
  const progMap = new Map(PRESETS.progressions.map((p) => [p.id, p.nameKo]));
  const grooveMap = new Map(PRESETS.grooves.map((g) => [g.id, g.nameKo]));
  const contourMap = new Map(PRESETS.contours.map((c) => [c.id, c.nameKo]));
  const modMap = new Map(PRESETS.modifiers.map((m) => [m.id, m.nameKo]));

  if (before.keyRoot !== after.keyRoot || before.mode !== after.mode) {
    const modeKo = after.mode === 'major' ? '장조' : '단조';
    const rootName = `${NOTE_NAMES_SHARP[after.keyRoot] ?? 'C'}(${KOREAN_SOLFEGE[after.keyRoot] ?? '도'})`;
    lines.push(`키/조성: ${rootName} ${modeKo}`);
  }

  if (before.bars !== after.bars) {
    lines.push(`곡 길이: ${before.bars}마디 → ${after.bars}마디`);
  }

  if (before.bpm !== after.bpm) {
    lines.push(`빠르기(BPM): ${before.bpm} → ${after.bpm}`);
  }

  if (before.blocks.progressionId !== after.blocks.progressionId) {
    lines.push(
      `코드 진행: ${progMap.get(before.blocks.progressionId) ?? before.blocks.progressionId} → ${progMap.get(after.blocks.progressionId) ?? after.blocks.progressionId}`
    );
  }

  if (before.blocks.grooveId !== after.blocks.grooveId) {
    lines.push(
      `리듬 그루브: ${grooveMap.get(before.blocks.grooveId) ?? before.blocks.grooveId} → ${grooveMap.get(after.blocks.grooveId) ?? after.blocks.grooveId}`
    );
  }

  if (before.blocks.contourId !== after.blocks.contourId) {
    lines.push(
      `선율 윤곽: ${contourMap.get(before.blocks.contourId) ?? before.blocks.contourId} → ${contourMap.get(after.blocks.contourId) ?? after.blocks.contourId}`
    );
  }

  if (Math.abs(before.blocks.energy - after.blocks.energy) >= 0.01) {
    lines.push(`에너지: ${Math.round(before.blocks.energy * 100)}% → ${Math.round(after.blocks.energy * 100)}%`);
  }

  if (Math.abs(before.blocks.density - after.blocks.density) >= 0.01) {
    lines.push(`음표 밀도: ${Math.round(before.blocks.density * 100)}% → ${Math.round(after.blocks.density * 100)}%`);
  }

  const changedBars: string[] = [];
  const requestedChordBars = new Set((patch.chords ?? []).map((c) => c.bar - 1));
  const progressionChanged = before.blocks.progressionId !== after.blocks.progressionId;
  for (let i = 0; i < after.chain.chords.length; i++) {
    const prevDeg = before.chain.chords[i]?.degree;
    const nextDeg = after.chain.chords[i].degree;
    if (prevDeg !== nextDeg && (!progressionChanged || requestedChordBars.has(i))) {
      changedBars.push(`${i + 1}마디 ${prevDeg ?? '-'}→${nextDeg}`);
    }
  }
  if (changedBars.length > 0) {
    lines.push(`마디 코드: ${changedBars.join(', ')}`);
  }

  for (const afterMod of after.chain.modifiers) {
    const beforeMod = before.chain.modifiers.find((m) => m.id === afterMod.id);
    if (!beforeMod) continue;
    const modName = modMap.get(afterMod.id) ?? afterMod.id;
    const enabledChanged = beforeMod.enabled !== afterMod.enabled;
    const amountChanged = Math.abs(beforeMod.amount - afterMod.amount) >= 0.01;
    if (enabledChanged) {
      lines.push(
        `변형 카드 [${modName}]: ${afterMod.enabled ? `켜기 (${Math.round(afterMod.amount * 100)}%)` : '끄기'}`
      );
    } else if (amountChanged) {
      lines.push(
        `변형 카드 [${modName}] 강도: ${Math.round(beforeMod.amount * 100)}% → ${Math.round(afterMod.amount * 100)}%`
      );
    }
  }

  if (before.baked && !after.baked) {
    lines.push('멜로디: 고정 음표를 풀고 새 블록·변형에 맞춰 다시 생성');
  }

  return lines;
}
