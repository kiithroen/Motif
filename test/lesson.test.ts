import { describe, expect, it } from 'vitest';
import { analyzeSong } from '../src/core/analyzer';
import { compileSong, unpackBlocksToChain } from '../src/core/compiler';
import {
  LESSONS,
  createLessonProject,
  evaluateLesson,
  getLessonUnits,
} from '../src/core/lesson';

describe('Practical 20-mission curriculum (4 units x 5 missions)', () => {
  it('organizes 20 missions into 4 units and starts every mission unsolved', () => {
    expect(LESSONS).toHaveLength(20);
    const units = getLessonUnits();
    expect(units).toHaveLength(4);
    for (const u of units) {
      expect(u.lessons).toHaveLength(5);
    }

    for (const lesson of LESSONS) {
      const initial = createLessonProject(lesson.id);
      expect(evaluateLesson(lesson.id, initial).passed, `${lesson.id} should start unsolved`).toBe(false);
    }
  });

  it('Unit 1 (1..5): L1 blocks & genre design', () => {
    // 1
    const m1 = createLessonProject('lesson_1_groove');
    m1.blocks.energy = 0.85;
    expect(evaluateLesson('lesson_1_groove', m1).passed).toBe(false);
    m1.blocks.grooveId = 'strum_8beat';
    expect(evaluateLesson('lesson_1_groove', m1).passed).toBe(true);

    // 2
    const m2 = createLessonProject('m02_lofi_setup');
    m2.blocks.grooveId = 'lofi_chill';
    expect(evaluateLesson('m02_lofi_setup', m2).passed).toBe(false);
    m2.blocks.progressionId = 'lofi_2516';
    m2.chain = unpackBlocksToChain(m2.blocks, m2.bars, m2.chain.modifiers);
    expect(evaluateLesson('m02_lofi_setup', m2).passed).toBe(true);

    // 3
    const m3 = createLessonProject('m03_synth_energy');
    m3.blocks.grooveId = 'bouncy_pop';
    m3.blocks.energy = 0.85;
    expect(evaluateLesson('m03_synth_energy', m3).passed).toBe(false);
    m3.blocks.density = 0.75;
    expect(evaluateLesson('m03_synth_energy', m3).passed).toBe(true);

    // 4
    const m4 = createLessonProject('m04_minor_ballad');
    m4.mode = 'minor';
    m4.blocks.grooveId = 'ballad_arp';
    expect(evaluateLesson('m04_minor_ballad', m4).passed).toBe(false);
    m4.blocks.progressionId = 'sad_6415';
    m4.chain = unpackBlocksToChain(m4.blocks, m4.bars, m4.chain.modifiers);
    expect(evaluateLesson('m04_minor_ballad', m4).passed).toBe(true);

    // 5
    const m5 = createLessonProject('m05_l1_eight_bars');
    m5.bars = 8;
    m5.chain = unpackBlocksToChain(m5.blocks, 8, m5.chain.modifiers);
    m5.blocks.contourId = 'call_response';
    expect(evaluateLesson('m05_l1_eight_bars', m5).passed).toBe(false);
    m5.blocks.grooveId = 'strum_8beat';
    expect(evaluateLesson('m05_l1_eight_bars', m5).passed).toBe(true);
  });

  it('Unit 2 (6..10): L2 chords & modifier chains', () => {
    // 6
    const m6 = createLessonProject('lesson_2_chord_mood');
    m6.chain.chords[3].degree = 'V7';
    expect(evaluateLesson('lesson_2_chord_mood', m6).passed).toBe(false);
    m6.chain.chords[3].degree = 'iv';
    expect(evaluateLesson('lesson_2_chord_mood', m6).passed).toBe(true);

    // 7
    const m7 = createLessonProject('lesson_5_motif_var');
    m7.chain.modifiers = m7.chain.modifiers.map((m) =>
      m.id === 'passing_tones' ? { ...m, enabled: true } : m
    );
    expect(evaluateLesson('lesson_5_motif_var', m7).passed).toBe(false);
    m7.chain.modifiers = m7.chain.modifiers.map((m) =>
      m.id === 'motif_repeat' ? { ...m, enabled: true, amount: 0.75 } : m
    );
    expect(evaluateLesson('lesson_5_motif_var', m7).passed).toBe(true);

    // 8
    const m8 = createLessonProject('m08_syncopation');
    m8.blocks.grooveId = 'bouncy_pop';
    expect(evaluateLesson('m08_syncopation', m8).passed).toBe(false);
    m8.chain.modifiers = m8.chain.modifiers.map((m) =>
      m.id === 'syncopation' ? { ...m, enabled: true, amount: 0.7 } : m
    );
    expect(evaluateLesson('m08_syncopation', m8).passed).toBe(true);

    // 9
    const m9 = createLessonProject('m09_passing_cadence');
    m9.chain.modifiers = m9.chain.modifiers.map((m) =>
      m.id === 'passing_tones' ? { ...m, enabled: true, amount: 0.7 } : m
    );
    expect(evaluateLesson('m09_passing_cadence', m9).passed).toBe(false);
    m9.chain.modifiers = m9.chain.modifiers.map((m) =>
      m.id === 'cadence_resolve' ? { ...m, enabled: true, amount: 0.9 } : m
    );
    expect(evaluateLesson('m09_passing_cadence', m9).passed).toBe(true);

    // 10
    const m10 = createLessonProject('m10_l2_jazz_combo');
    m10.blocks.progressionId = 'lofi_2516';
    m10.chain = unpackBlocksToChain(m10.blocks, m10.bars, m10.chain.modifiers);
    m10.chain.modifiers = m10.chain.modifiers.map((m) =>
      m.id === 'motif_repeat' ? { ...m, enabled: true, amount: 0.7 } : m
    );
    expect(evaluateLesson('m10_l2_jazz_combo', m10).passed).toBe(false);
    m10.chain.modifiers = m10.chain.modifiers.map((m) =>
      m.id === 'syncopation' ? { ...m, enabled: true, amount: 0.65 } : m
    );
    expect(evaluateLesson('m10_l2_jazz_combo', m10).passed).toBe(true);
  });

  it('Unit 3 (11..15): L3 precision editing & theory coach', () => {
    // 11
    const m11 = createLessonProject('lesson_4_chord_tones');
    m11.bakedMelody[0] = { ...m11.bakedMelody[0], midi: 64 };
    m11.bakedMelody[3] = { ...m11.bakedMelody[3], midi: 74 };
    expect(evaluateLesson('lesson_4_chord_tones', m11).passed).toBe(false);
    m11.bakedMelody.push(
      { id: 'fix_3', midi: 69, step: 32, duration: 4, velocity: 0.82 },
      { id: 'fix_4', midi: 65, step: 48, duration: 4, velocity: 0.82 }
    );
    expect(evaluateLesson('lesson_4_chord_tones', m11).passed).toBe(true);

    // 12
    const m12 = createLessonProject('lesson_3_cadence_fix');
    m12.bakedMelody[m12.bakedMelody.length - 1] = {
      ...m12.bakedMelody[m12.bakedMelody.length - 1],
      midi: 71,
    };
    expect(evaluateLesson('lesson_3_cadence_fix', m12).passed).toBe(false);
    const cadReport = analyzeSong(compileSong(m12), m12);
    const fixed12 = cadReport.issues.find((i) => i.kind === 'weak_cadence')!.applyFix(m12);
    expect(evaluateLesson('lesson_3_cadence_fix', fixed12).passed).toBe(true);

    // 13
    const m13 = createLessonProject('m13_wide_range');
    m13.bakedMelody[7] = { ...m13.bakedMelody[7], midi: 65 }; // F4 clash + still narrow
    expect(evaluateLesson('m13_wide_range', m13).passed).toBe(false);
    m13.bakedMelody[7] = { ...m13.bakedMelody[7], midi: 72 }; // C5 -> span 64..72 = 8
    expect(evaluateLesson('m13_wide_range', m13).passed).toBe(true);

    // 14
    const m14 = createLessonProject('m14_rhythm_breath');
    m14.bakedMelody.pop(); // restRatio=12.5%, still monotone
    expect(evaluateLesson('m14_rhythm_breath', m14).passed).toBe(false);
    m14.bakedMelody.pop(); // restRatio=25%
    m14.bakedMelody[0] = { ...m14.bakedMelody[0], duration: 4 };
    m14.bakedMelody[2] = { ...m14.bakedMelody[2], duration: 4 };
    expect(evaluateLesson('m14_rhythm_breath', m14).passed).toBe(true);

    // 15
    const m15 = createLessonProject('m15_coach_clean');
    m15.bakedMelody[0] = { ...m15.bakedMelody[0], midi: 64 }; // clash만 고침 (종지 남아있어 92점)
    expect(evaluateLesson('m15_coach_clean', m15).passed).toBe(false);
    m15.bakedMelody[7] = { ...m15.bakedMelody[7], midi: 60 }; // C4 종지 해결 -> 100점
    expect(evaluateLesson('m15_coach_clean', m15).passed).toBe(true);
  });

  it('Unit 4 (16..20): 8-bar songs & transposition', () => {
    // 16
    const m16 = createLessonProject('lesson_6_eight_bars');
    m16.bars = 8;
    m16.chain = unpackBlocksToChain(m16.blocks, 8, m16.chain.modifiers);
    expect(evaluateLesson('lesson_6_eight_bars', m16).passed).toBe(false);
    m16.chain.modifiers = m16.chain.modifiers.map((m) =>
      m.id === 'octave_lift' ? { ...m, enabled: true, amount: 0.75 } : m
    );
    expect(evaluateLesson('lesson_6_eight_bars', m16).passed).toBe(true);

    // 17
    const m17 = createLessonProject('m17_minor_eight');
    m17.bars = 8;
    m17.mode = 'minor';
    expect(evaluateLesson('m17_minor_eight', m17).passed).toBe(false);
    m17.blocks.progressionId = 'sad_6415';
    m17.chain = unpackBlocksToChain(m17.blocks, 8, m17.chain.modifiers);
    expect(evaluateLesson('m17_minor_eight', m17).passed).toBe(true);

    // 18
    const m18 = createLessonProject('m18_canon_modern');
    m18.blocks.progressionId = 'canon';
    m18.chain = unpackBlocksToChain(m18.blocks, 8, m18.chain.modifiers);
    m18.blocks.grooveId = 'lofi_chill';
    expect(evaluateLesson('m18_canon_modern', m18).passed).toBe(false);
    m18.chain.modifiers = m18.chain.modifiers.map((m) =>
      m.id === 'motif_repeat' ? { ...m, enabled: true, amount: 0.75 } : m
    );
    expect(evaluateLesson('m18_canon_modern', m18).passed).toBe(true);

    // 19
    const m19 = createLessonProject('m19_transpose_key');
    m19.keyRoot = 5;
    expect(evaluateLesson('m19_transpose_key', m19).passed).toBe(false);
    m19.keyRoot = 7;
    expect(evaluateLesson('m19_transpose_key', m19).passed).toBe(true);

    // 20
    const m20 = createLessonProject('m20_final_master');
    m20.bars = 8;
    m20.chain = unpackBlocksToChain(m20.blocks, 8, m20.chain.modifiers);
    m20.chain.modifiers = m20.chain.modifiers.map((m) =>
      m.id === 'motif_repeat' || m.id === 'octave_lift' ? { ...m, enabled: true, amount: 0.75 } : m
    );
    expect(evaluateLesson('m20_final_master', m20).passed).toBe(false);
    m20.chain.modifiers = m20.chain.modifiers.map((m) =>
      m.id === 'passing_tones' ? { ...m, enabled: true, amount: 0.55 } : m
    );
    expect(evaluateLesson('m20_final_master', m20).passed).toBe(true);
  });
});
