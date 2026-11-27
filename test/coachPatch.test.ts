import { describe, expect, it } from 'vitest';
import { analyzeSong } from '../src/core/analyzer';
import {
  COACH_CONFIG,
  type CoachTurn,
  applyCoachPatch,
  buildCoachContents,
  buildCoachContext,
  buildCoachResponseSchema,
  buildCoachVisualDiff,
  describeCoachPatch,
  getMaxDemoChords,
  parseCoachResponse,
  sanitizeCoachPatch,
  trimCoachHistory,
} from '../src/core/coachPatch';
import { compileSong } from '../src/core/compiler';
import { PRESETS, createDefaultProject } from '../src/core/model';

describe('coachPatch tutor context, melody comparison, and strict guardrails', () => {
  it('serializes melodyByBar and scales chord demo schema limit by bars (4 vs 8)', () => {
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
    expect(roundTripped.melodyByBar.length).toBe(project.bars);
    expect(roundTripped.melodyByBar[0].bar).toBe(1);
    expect(roundTripped.melodyByBar[0].notes[0]).toMatchObject({
      stepInBar: 0,
      midi: 65,
      korean: '파',
    });
    expect(roundTripped.melodyByBar[1].notes[0]).toMatchObject({
      stepInBar: 0,
      midi: 67,
      korean: '솔',
    });
    expect('progressions' in roundTripped.catalog).toBe(false);
    expect('grooves' in roundTripped.catalog).toBe(false);
    expect('contours' in roundTripped.catalog).toBe(false);

    const schema4 = buildCoachResponseSchema(4) as {
      type: string;
      additionalProperties: boolean;
      required: string[];
      properties: {
        patch: {
          properties: {
            chords: { maxItems: number };
            melodyBars: { maxItems: number };
          };
        };
      };
    };
    const schema8 = buildCoachResponseSchema(8) as typeof schema4;
    expect(schema4.type).toBe('object');
    expect(schema4.additionalProperties).toBe(false);
    expect(schema4.required).toEqual(['headline', 'explanation']);
    expect(Object.keys(schema4.properties.patch.properties).sort()).toEqual([
      'chords',
      'melodyBars',
      'modifiers',
    ]);
    expect(schema4.properties.patch.properties.chords.maxItems).toBe(getMaxDemoChords(4));
    expect(schema8.properties.patch.properties.chords.maxItems).toBe(getMaxDemoChords(8));
    expect(schema4.properties.patch.properties.melodyBars.maxItems).toBe(
      COACH_CONFIG.limits.maxDemoMelodyBars
    );
  });

  it('parses fenced JSON with manualSteps and melodyBars, rejecting malformed JSON', () => {
    const raw = [
      '이론 설명과 비교 예시입니다:',
      '```json',
      JSON.stringify({
        headline: '4마디 종지 멜로디 비교',
        explanation: '4마디 끝음을 으뜸음 도(C5)로 착지시키면 안정적인 마침표가 됩니다.',
        manualSteps: [
          'L3 피아노롤에서 4마디 마지막 음을 C5(도)로 옮겨 보세요.',
        ],
        patchSummary: '4마디 iv 코드 및 종지 멜로디 비교',
        patch: {
          chords: [{ bar: 4, degree: 'iv' }],
          melodyBars: [
            {
              bar: 4,
              notes: [
                { stepInBar: 0, midi: 74, duration: 4 },
                { stepInBar: 8, midi: 72, duration: 8 },
              ],
            },
          ],
        },
      }),
      '```',
    ].join('\n');

    const { response, warnings } = parseCoachResponse(raw, 4);
    expect(warnings).toEqual([]);
    expect(response.patch?.chords).toEqual([{ bar: 4, degree: 'iv' }]);
    expect(response.patch?.melodyBars?.[0]).toEqual({
      bar: 4,
      notes: [
        { stepInBar: 0, midi: 74, duration: 4 },
        { stepInBar: 8, midi: 72, duration: 8 },
      ],
    });

    expect(() => parseCoachResponse('not-json', 4)).toThrow();
    expect(() => parseCoachResponse(JSON.stringify({ headline: '제목만 있음' }), 4)).toThrow();
  });

  it('blocks forbidden fields, enforces bar-based chord limits, and sanitizes melodyBars', () => {
    const limits = COACH_CONFIG.limits;
    const validDegrees = PRESETS.availableDegrees;
    const validMods = PRESETS.modifiers;
    const maxChords8 = getMaxDemoChords(8);

    const oversizedChords8 = Array.from({ length: maxChords8 + 2 }, (_, idx) => ({
      bar: idx + 1,
      degree: validDegrees[idx % validDegrees.length],
    }));

    const oversizedMelodyBars = [
      { bar: 0, notes: [{ stepInBar: 0, midi: 72, duration: 4 }] },
      { bar: 9, notes: [{ stepInBar: 0, midi: 72, duration: 4 }] },
      {
        bar: 2,
        notes: [
          { stepInBar: 20, midi: 72, duration: 4 },
          { stepInBar: 0, midi: limits.minMelodyMidi - 10, duration: 20 },
          ...Array.from({ length: limits.maxDemoMelodyNotesPerBar + 2 }, (_, idx) => ({
            stepInBar: idx + 1,
            midi: limits.minMelodyMidi + idx,
            duration: 1,
          })),
        ],
      },
      { bar: 3, notes: [{ stepInBar: 0, midi: 72, duration: 4 }] },
      { bar: 4, notes: [{ stepInBar: 0, midi: 74, duration: 4 }] },
    ];

    const { patch, warnings } = sanitizeCoachPatch(
      {
        keyRoot: 2,
        mode: 'minor',
        bars: 4,
        bpm: 120,
        blocks: { progressionId: PRESETS.progressions[0].id },
        unbakeMelody: true,
        chords: oversizedChords8,
        modifiers: validMods.slice(0, limits.maxDemoModifiers + 1).map((m) => ({
          id: m.id,
          enabled: true,
        })),
        melodyBars: oversizedMelodyBars,
      },
      8
    );

    expect(warnings.length).toBeGreaterThanOrEqual(12);
    expect('blocks' in (patch ?? {})).toBe(false);
    expect('unbakeMelody' in (patch ?? {})).toBe(false);
    expect(patch?.chords?.length).toBe(maxChords8);
    expect(patch?.modifiers?.length).toBe(limits.maxDemoModifiers);
    expect(patch?.melodyBars?.length).toBe(limits.maxDemoMelodyBars);
    expect(patch?.melodyBars?.[0].notes.length).toBe(limits.maxDemoMelodyNotesPerBar);
    expect(patch?.melodyBars?.[0].notes[0].midi).toBe(limits.minMelodyMidi);
  });

  it('builds isolated demo copy: preserves other bars and original project, and keeps bakedMelody untouched when melodyBars is absent', () => {
    const project = createDefaultProject();
    project.baked = true;
    project.bakedMelody = [
      { id: 'u1', midi: 72, step: 0, duration: 4, velocity: 0.8, origin: 'user' },
      { id: 'u2', midi: 76, step: 16, duration: 4, velocity: 0.8, origin: 'user' },
      { id: 'u3', midi: 77, step: 48, duration: 4, velocity: 0.8, origin: 'user' },
    ];

    const harmonyOnlyPatch = {
      chords: [{ bar: 4, degree: 'iv' as const }],
      modifiers: [{ id: 'modal_borrow' as const, enabled: true, amount: 0.8 }],
    };
    const harmonyDemo = applyCoachPatch(project, harmonyOnlyPatch);
    expect(harmonyDemo.baked).toBe(true);
    expect(harmonyDemo.bakedMelody).toEqual(project.bakedMelody);

    const melodyPatch = {
      melodyBars: [
        {
          bar: 4,
          notes: [
            { stepInBar: 0, midi: 74, duration: 4 },
            { stepInBar: 8, midi: 72, duration: 8 },
          ],
        },
      ],
    };
    const melodyDemo = applyCoachPatch(project, melodyPatch);
    expect(melodyDemo.bakedMelody.filter((n) => n.step < 48)).toEqual(
      project.bakedMelody.filter((n) => n.step < 48)
    );
    expect(melodyDemo.bakedMelody.filter((n) => n.step >= 48)).toMatchObject([
      { step: 48, midi: 74, duration: 4 },
      { step: 56, midi: 72, duration: 8 },
    ]);
    // 원본 project 는 변경되지 않는다.
    expect(project.bakedMelody.find((n) => n.step === 48)?.midi).toBe(77);

    const summary = describeCoachPatch(project, melodyDemo, melodyPatch);
    expect(summary[0]).toContain('멜로디 예시 (4마디)');
    expect(describeCoachPatch(project, applyCoachPatch(project, {}), {})).toEqual([]);
  });

  it('trims multi-turn history using config limits and builds multi-turn contents', () => {
    const maxTurns = COACH_CONFIG.limits.maxHistoryTurns;
    const maxSummaryChars = COACH_CONFIG.limits.maxHistorySummaryChars;
    const longText = '가'.repeat(maxSummaryChars + 40);

    const turns: CoachTurn[] = Array.from({ length: maxTurns + 2 }, (_, idx) => ({
      mode: 'request',
      userPrompt: `질문 ${idx + 1}`,
      assistantHeadline: `요약 ${idx + 1}`,
      assistantExplanation: idx === maxTurns + 1 ? longText : `설명 ${idx + 1}`,
      patchSummary: idx === maxTurns ? '4마디 코드 예시' : undefined,
    }));

    const trimmed = trimCoachHistory(turns);
    expect(trimmed.length).toBe(maxTurns);
    expect(trimmed[0].userPrompt).toBe('질문 3');
    expect(trimCoachHistory(turns, 0)).toEqual([]);

    const project = createDefaultProject();
    const compiled = compileSong(project);
    const report = analyzeSong(compiled, project);
    const ctx = buildCoachContext(project, compiled, report);

    const contents = buildCoachContents(ctx, 'request', '후속 질문입니다', turns);
    expect(contents.length).toBe(maxTurns * 2 + 1);
    expect(contents[0]).toEqual({ role: 'user', parts: [{ text: '질문 3' }] });
    expect(contents[1].role).toBe('model');

    const lastModelMsg = JSON.parse(contents[contents.length - 2].parts[0].text) as {
      headline: string;
      explanation: string;
      patchSummary?: string;
    };
    expect(lastModelMsg.explanation.length).toBe(maxSummaryChars + 3);
    expect(lastModelMsg.explanation.endsWith('...')).toBe(true);

    const latestUserMsg = contents[contents.length - 1];
    expect(latestUserMsg.role).toBe('user');
    expect(latestUserMsg.parts[0].text).toContain('이전 대화 맥락을 이어서 답하되');
    expect(latestUserMsg.parts[0].text).toContain('후속 질문입니다');
  });

  it('extracts changed chord bars, explicit melodyBars ghost notes, and modifier-driven ghost notes', () => {
    const project = createDefaultProject();
    project.baked = false;
    const beforeCompiled = compileSong(project);

    const explicitPatch = {
      chords: [{ bar: 4, degree: 'iv' as const }],
      melodyBars: [
        {
          bar: 4,
          notes: [
            { stepInBar: 0, midi: 74, duration: 4 },
            { stepInBar: 8, midi: 72, duration: 8 },
          ],
        },
      ],
    };
    const explicitDemo = applyCoachPatch(project, explicitPatch);
    const explicitCompiled = compileSong(explicitDemo);
    const explicitDiff = buildCoachVisualDiff(beforeCompiled, explicitCompiled, explicitPatch);

    expect(explicitDiff.changedChordBars.length).toBe(1);
    expect(explicitDiff.changedChordBars[0]).toMatchObject({
      bar: 3,
      afterDegree: 'iv',
      afterSymbol: explicitCompiled.resolvedChords[3].symbol,
    });
    expect(explicitDiff.ghostNotes).toMatchObject([
      { step: 48, midi: 74, duration: 4, bar: 3 },
      { step: 56, midi: 72, duration: 8, bar: 3 },
    ]);
    expect(explicitDiff.affectedMelodyBars).toEqual([3]);

    const modPatch = {
      modifiers: [{ id: 'passing_tones' as const, enabled: true, amount: 1 }],
    };
    const modDemo = applyCoachPatch(project, modPatch);
    const modCompiled = compileSong(modDemo);
    const modDiff = buildCoachVisualDiff(beforeCompiled, modCompiled, modPatch);

    const beforeKeys = new Set(beforeCompiled.melody.map((n) => `${n.step}:${n.midi}:${n.duration}`));
    const expectedChangedCount = modCompiled.melody.filter(
      (n) => !beforeKeys.has(`${n.step}:${n.midi}:${n.duration}`)
    ).length;
    expect(modDiff.ghostNotes.length).toBe(expectedChangedCount);
    expect(modDiff.changedChordBars).toEqual([]);
  });
});
