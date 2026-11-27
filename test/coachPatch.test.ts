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

describe('coachPatch pure context, validation, and patch application', () => {
  it('serializes song state, DiagnosisReport issues, and PRESETS catalog into pure JSON context', () => {
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
    expect(roundTripped.catalog.progressions.map((p) => p.id)).toEqual(
      PRESETS.progressions.map((p) => p.id)
    );
    expect(roundTripped.catalog.availableDegrees).toEqual(PRESETS.availableDegrees);

    const schema = buildCoachResponseSchema();
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['headline', 'explanation']);
  });

  it('parses fenced JSON responses and rejects malformed JSON or missing required fields', () => {
    const firstProg = PRESETS.progressions[0].id;
    const raw = [
      '여기에 제안한 편곡입니다:',
      '```json',
      JSON.stringify({
        headline: '후반부를 아련하게 다듬기',
        explanation: '4번째 마디 코드를 iv로 바꿔 여운을 남겼습니다.',
        theoryTip: '모달 인터체인지는 잠시 빌려온 화음입니다.',
        patchSummary: '4마디 iv 코드 및 아련한 대리화음 적용',
        patch: {
          blocks: { progressionId: firstProg, energy: 0.55 },
          chords: [{ bar: 4, degree: 'iv' }],
          modifiers: [{ id: 'modal_borrow', enabled: true, amount: 0.8 }],
        },
      }),
      '```',
    ].join('\n');

    const { response, warnings } = parseCoachResponse(raw, 4);
    expect(warnings).toEqual([]);
    expect(response.headline).toBe('후반부를 아련하게 다듬기');
    expect(response.patch?.chords).toEqual([{ bar: 4, degree: 'iv' }]);

    expect(() => parseCoachResponse('not-json', 4)).toThrow();
    expect(() => parseCoachResponse(JSON.stringify({ headline: '제목만 있음' }), 4)).toThrow();
  });

  it('filters invalid catalog IDs and clamps out-of-range parameters with warnings', () => {
    const limits = COACH_CONFIG.limits;
    const validGroove = PRESETS.grooves[1].id;

    const { patch, warnings } = sanitizeCoachPatch(
      {
        keyRoot: 99,
        mode: 'dorian',
        bars: 6,
        bpm: limits.maxBpm + 40,
        blocks: {
          progressionId: 'nonexistent_prog',
          grooveId: validGroove,
          contourId: 'unknown_contour',
          energy: limits.minEnergy - 0.5,
          density: limits.maxDensity + 0.5,
        },
        chords: [
          { bar: 0, degree: 'I' },
          { bar: 5, degree: 'V' },
          { bar: 3, degree: 'INVALID' },
          { bar: 4, degree: 'iv' },
        ],
        modifiers: [
          { id: 'unknown_mod', enabled: true },
          { id: 'syncopation', enabled: true, amount: 1.8 },
        ],
      },
      4
    );

    expect(warnings.length).toBeGreaterThanOrEqual(8);
    expect(patch?.keyRoot).toBeUndefined();
    expect(patch?.mode).toBeUndefined();
    expect(patch?.bars).toBeUndefined();
    expect(patch?.bpm).toBe(limits.maxBpm);
    expect(patch?.blocks).toEqual({
      grooveId: validGroove,
      energy: limits.minEnergy,
      density: limits.maxDensity,
    });
    expect(patch?.chords).toEqual([{ bar: 4, degree: 'iv' }]);
    expect(patch?.modifiers).toEqual([{ id: 'syncopation', enabled: true, amount: 1 }]);
  });

  it('keeps bar chord overrides when progressionId changes and unbakes L3 melody on structural patches', () => {
    const project = createDefaultProject();
    project.baked = true;
    project.bakedMelody = [{ id: 'u1', midi: 72, step: 0, duration: 4, velocity: 0.8, origin: 'user' }];

    const altProgression = PRESETS.progressions.find((p) => p.id !== project.blocks.progressionId)!;
    const altGroove = PRESETS.grooves.find((g) => g.id !== project.blocks.grooveId)!;

    const patch = {
      blocks: {
        progressionId: altProgression.id,
        grooveId: altGroove.id,
      },
      chords: [{ bar: 4, degree: 'iv' as const }],
      modifiers: [{ id: 'syncopation' as const, enabled: true, amount: 0.7 }],
    };

    const next = applyCoachPatch(project, patch);
    expect(next.blocks.progressionId).toBe(altProgression.id);
    expect(next.chain.chords[0].degree).toBe(altProgression.degrees[0]);
    expect(next.chain.chords[3].degree).toBe('iv');
    expect(next.baked).toBe(false);

    const compiledBefore = compileSong(project);
    const compiledAfter = compileSong(next);
    expect(compiledAfter.melody.length).not.toBe(compiledBefore.melody.length);

    const summary = describeCoachPatch(project, next, patch);
    expect(summary.length).toBeGreaterThan(0);
    expect(describeCoachPatch(project, applyCoachPatch(project, {}), {})).toEqual([]);
  });
});
