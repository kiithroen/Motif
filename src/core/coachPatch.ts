import coachRaw from '../data/coach.json';
import type { DiagnosisReport } from './analyzer';
import type { CompiledSong } from './compiler';
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
    maxDemoChords: number;
    maxDemoModifiers: number;
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

export interface CoachPatch {
  chords?: CoachChordPatch[];
  modifiers?: CoachModifierPatch[];
}

export interface CoachResponse {
  headline: string;
  explanation: string;
  theoryTip?: string;
  manualSteps?: string[];
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
  const modifierIds = PRESETS.modifiers.map((m) => m.id);
  const degrees = [...PRESETS.availableDegrees];
  const limits = COACH_CONFIG.limits;

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
            maxItems: limits.maxDemoChords,
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
        },
        additionalProperties: false,
      },
    },
    required: ['headline', 'explanation'],
    additionalProperties: false,
  };
}

export function buildCoachSystemPrompt(): string {
  const { maxDemoChords, maxDemoModifiers } = COACH_CONFIG.limits;
  return [
    '너는 곡을 대신 작곡하거나 수정하지 않는 한국어 음악 이론 튜터다.',
    '도레미 계이름과 기초 기타 코드만 아는 초보자에게 화성·선율·리듬 원리를 계이름(도·레·미·파·솔·라·시)과 느낌으로 쉽게 설명한다.',
    '사용자의 L3 멜로디와 전체 곡 구조(키·조성·마디·BPM·L1 블록)는 절대 대신 덮어쓰거나 갈아엎지 않는다.',
    `비교 청취 예시(patch)가 필요할 때만 마디 코드 최대 ${maxDemoChords}개(chords) 또는 L2 변형 카드 최대 ${maxDemoModifiers}개(modifiers)만 국소 대안으로 제안한다.`,
    '가능하면 사용자가 직접 손으로 고쳐볼 수 있도록 manualSteps 에 구체적인 L2/L3 조작 안내를 1~3줄 적는다.',
    '반드시 응답 스키마에 맞는 순수 JSON 객체 하나만 출력한다(마크다운 코드블록 금지).',
    'patch 를 포함할 때는 반드시 제공된 catalog 의 availableDegrees 와 modifiers.id 만 사용하며, chords[].bar 는 1부터 시작하는 마디 번호를 쓴다.',
  ].join('\n');
}

export function buildCoachUserPrompt(
  context: CoachContextPayload,
  mode: 'explain' | 'request',
  userRequest?: string
): string {
  const bakedNotice = context.song.baked
    ? '주의: 현재 곡은 사용자가 직접 편집한 L3 멜로디(baked=true) 상태이므로 멜로디를 재생성하지 않고 화성(chords/modal_borrow) 비교 예시와 텍스트 기반 멜로디 조언만 우선 제공하라.'
    : '참고: 현재 곡은 L1/L2 규칙 상태(baked=false)이므로 L2 코드·변형 카드 비교 예시로 차이를 들려줄 수 있다.';

  const instruction =
    mode === 'explain'
      ? [
          '요청 유형: 로컬 이론 분석 리포트 해설.',
          '현재 곡 상태와 analysis 리포트를 보고, 왜 점수가 이렇게 나왔는지와 가장 핵심적인 이론 원리를 초보자 눈높이로 설명하라.',
          '청각 비교가 도움이 되면 국소 비교 예시(patch)와 사용자가 직접 해볼 manualSteps 를 제안하라.',
        ].join('\n')
      : [
          '요청 유형: 작곡 이론 질문·대안 비교.',
          `사용자 질문: "${(userRequest ?? '').trim()}"`,
          '질문에 대한 이론 원리를 먼저 설명하고, 사용자가 직접 바꿔 볼 manualSteps 와 필요 시 국소 비교 청취 예시(patch)를 제안하라.',
        ].join('\n');

  return `${instruction}\n${bakedNotice}\n\n현재 곡 및 허용 카탈로그 JSON:\n${JSON.stringify(context)}`;
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
      if (byBar.size > limits.maxDemoChords) {
        warnings.push(`비교용 마디 코드 대안은 최대 ${limits.maxDemoChords}개까지만 허용해 나머지를 제외했다.`);
      }
      const limitedChords = Array.from(byBar.entries())
        .slice(0, limits.maxDemoChords)
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

  return lines;
}
