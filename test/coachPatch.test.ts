import { describe, expect, it } from 'vitest';
import { analyzeSong } from '../src/core/analyzer';
import {
  COACH_CONFIG,
  applyCoachPatch,
  buildCoachContext,
  buildCoachResponseSchema,
  describeCoachPatch,
  parseCoachResponse,
  sanitizeCoachPatch,
} from '../src/core/coachPatch';
import { compileSong } from '../src/core/compiler';
import { PRESETS, createDefaultProject } from '../src/core/model';

describe('coachPatch tutor context, strict guardrails, and demo comparison', () => {
  it('excludes L1 generator catalogs from context and builds strict local-demo schema', () => {
    const project = createDefaultProject();
    project.baked = true;
    project.bakedMelody = [
      { id: 'n1', midi: 65, step: 0, duration: 4, velocity: 0.8, origin: 'user' },
      { id: 'n2', midi: 67, step: 16, duration: 4, velocity: 0.8, origin: 'user' },
    ];
    const compiled = compileSong(project);
    const report = analyzeSong(compiled, project);

    const ctx = buildCoachContext(project, compiled, report);
    const roundTripped = JSON.parse(JSON.stringify(ctx)) as typeof ctx;

    expect(roundTripped.song.bars).toBe(project.bars);
    expect(roundTripped.chords.length).toBe(project.bars);
    expect(roundTripped.chords[0].bar).toBe(1);
    expect(roundTripped.analysis.score).toBe(report.score);
    expect(roundTripped.analysis.issues.length).toBe(report.issues.length);
    expect(roundTripped.catalog.availableDegrees).toEqual(PRESETS.availableDegrees);
    expect(roundTripped.catalog.modifiers.map((m) => m.id)).toEqual(
      PRESETS.modifiers.map((m) => m.id)
    );
    expect('progressions' in roundTripped.catalog).toBe(false);
    expect('grooves' in roundTripped.catalog).toBe(false);
    expect('contours' in roundTripped.catalog).toBe(false);

    const schema = buildCoachResponseSchema() as {
      type: string;
      additionalProperties: boolean;
      required: string[];
      properties: { patch: { properties: Record<string, unknown> } };
    };
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['headline', 'explanation']);
    expect(Object.keys(schema.properties.patch.properties).sort()).toEqual(['chords', 'modifiers']);
  });

  it('parses fenced JSON with manualSteps and rejects malformed JSON or missing required fields', () => {
    const raw = [
      '이론 설명과 비교 예시입니다:',
      '```json',
      JSON.stringify({
        headline: '4마디 모달 인터체인지 비교',
        explanation: '4마디의 IV(F)를 같은 뿌리의 마이너 iv(Fm)로 잠시 바꾸면 아련한 여운이 생깁니다.',
        theoryTip: '같은 으뜸음 조에서 화음을 빌려오는 기법을 모달 인터체인지라고 합니다.',
        manualSteps: [
          'L2 변형 체인 탭으로 이동한다.',
          '4마디 코드 슬롯을 iv(Fm)로 직접 바꿔 들어 본다.',
        ],
        patchSummary: '4마디 IV → iv 비교 예시',
        patch: {
          chords: [{ bar: 4, degree: 'iv' }],
          modifiers: [{ id: 'modal_borrow', enabled: true, amount: 0.8 }],
        },
      }),
      '```',
    ].join('\n');

    const { response, warnings } = parseCoachResponse(raw, 4);
    expect(warnings).toEqual([]);
    expect(response.headline).toBe('4마디 모달 인터체인지 비교');
    expect(response.manualSteps).toEqual([
      'L2 변형 체인 탭으로 이동한다.',
      '4마디 코드 슬롯을 iv(Fm)로 직접 바꿔 들어 본다.',
    ]);
    expect(response.patch?.chords).toEqual([{ bar: 4, degree: 'iv' }]);

    expect(() => parseCoachResponse('not-json', 4)).toThrow();
    expect(() => parseCoachResponse(JSON.stringify({ headline: '제목만 있음' }), 4)).toThrow();
  });

  it('blocks global/L1/melody-overwrite fields and truncates oversized demo lists with warnings', () => {
    const limits = COACH_CONFIG.limits;
    const validDegrees = PRESETS.availableDegrees;
    const validMods = PRESETS.modifiers;

    const oversizedChords = [
      { bar: 0, degree: validDegrees[0] },
      { bar: 5, degree: validDegrees[0] },
      { bar: 1, degree: 'INVALID' },
      ...Array.from({ length: limits.maxDemoChords + 1 }, (_, idx) => ({
        bar: idx + 1,
        degree: validDegrees[idx % validDegrees.length],
      })),
    ];

    const oversizedMods = [
      { id: 'unknown_mod', enabled: true },
      ...validMods.slice(0, limits.maxDemoModifiers + 1).map((m, idx) => ({
        id: m.id,
        enabled: true,
        amount: idx === 0 ? 1.8 : 0.7,
      })),
    ];

    const { patch, warnings } = sanitizeCoachPatch(
      {
        keyRoot: 2,
        mode: 'minor',
        bars: 8,
        bpm: 120,
        blocks: { progressionId: PRESETS.progressions[0].id },
        unbakeMelody: true,
        chords: oversizedChords,
        modifiers: oversizedMods,
      },
      4
    );

    expect(warnings.length).toBeGreaterThanOrEqual(11);
    expect('blocks' in (patch ?? {})).toBe(false);
    expect('bpm' in (patch ?? {})).toBe(false);
    expect('unbakeMelody' in (patch ?? {})).toBe(false);
    expect(patch?.chords?.length).toBe(limits.maxDemoChords);
    expect(patch?.modifiers?.length).toBe(limits.maxDemoModifiers);
    expect(patch?.modifiers?.[0].amount).toBe(1);
  });

  it('builds isolated comparison copy without altering baked L3 melody or original blocks', () => {
    const project = createDefaultProject();
    project.baked = true;
    project.bakedMelody = [
      { id: 'u1', midi: 72, step: 0, duration: 4, velocity: 0.8, origin: 'user' },
      { id: 'u2', midi: 76, step: 16, duration: 4, velocity: 0.8, origin: 'user' },
    ];

    const patch = {
      chords: [{ bar: 4, degree: 'iv' as const }],
      modifiers: [{ id: 'modal_borrow' as const, enabled: true, amount: 0.8 }],
    };

    const demo = applyCoachPatch(project, patch);
    expect(demo.baked).toBe(true);
    expect(demo.bakedMelody).toEqual(project.bakedMelody);
    expect(demo.blocks).toEqual(project.blocks);
    expect(demo.chain.chords[3].degree).toBe('iv');
    expect(project.chain.chords[3].degree).not.toBe('iv');

    const summary = describeCoachPatch(project, demo, patch);
    expect(summary.length).toBe(2);
    expect(describeCoachPatch(project, applyCoachPatch(project, {}), {})).toEqual([]);
  });
});
