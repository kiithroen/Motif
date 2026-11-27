import { describe, expect, it } from 'vitest';
import { analyzeSong } from '../src/core/analyzer';
import { compileSong, unpackBlocksToChain } from '../src/core/compiler';
import {
  LESSONS,
  createLessonProject,
  evaluateLesson,
  getLessonUnits,
} from '../src/core/lesson';

describe('Practical 12-mission curriculum (4 units x 3 missions)', () => {
  it('organizes 12 missions into 4 units and starts every mission unsolved', () => {
    expect(LESSONS).toHaveLength(12);
    const units = getLessonUnits();
    expect(units).toHaveLength(4);
    for (const u of units) {
      expect(u.lessons).toHaveLength(3);
    }

    for (const lesson of LESSONS) {
      const initial = createLessonProject(lesson.id);
      expect(evaluateLesson(lesson.id, initial).passed, `${lesson.id} should start unsolved`).toBe(false);
    }
  });

  it('Unit 1 (1..3): L1 blocks & genre design', () => {
    // 1
    const m1 = createLessonProject('lesson_1_groove');
    m1.blocks.grooveId = 'strum_8beat';
    m1.blocks.energy = 0.8;
    expect(evaluateLesson('lesson_1_groove', m1).passed).toBe(false);
    m1.blocks.density = 0.7;
    expect(evaluateLesson('lesson_1_groove', m1).passed).toBe(true);

    // 2
    const m2 = createLessonProject('m02_mode_progression');
    m2.mode = 'minor';
    m2.blocks.grooveId = 'ballad_arp';
    expect(evaluateLesson('m02_mode_progression', m2).passed).toBe(false);
    m2.blocks.progressionId = 'sad_6415';
    m2.chain = unpackBlocksToChain(m2.blocks, m2.bars, m2.chain.modifiers);
    expect(evaluateLesson('m02_mode_progression', m2).passed).toBe(true);

    // 3
    const m3 = createLessonProject('m03_eight_bar_contour');
    m3.bars = 8;
    m3.chain = unpackBlocksToChain(m3.blocks, 8, m3.chain.modifiers);
    m3.blocks.contourId = 'call_response';
    expect(evaluateLesson('m03_eight_bar_contour', m3).passed).toBe(false);
    m3.blocks.grooveId = 'strum_8beat';
    expect(evaluateLesson('m03_eight_bar_contour', m3).passed).toBe(true);
  });

  it('Unit 2 (4..6): L2 modifier chains & L3 bridge', () => {
    // 4
    const m4 = createLessonProject('m04_chord_motif');
    m4.chain.chords[3].degree = 'iv';
    expect(evaluateLesson('m04_chord_motif', m4).passed).toBe(false);
    m4.chain.modifiers = m4.chain.modifiers.map((m) =>
      m.id === 'motif_repeat' ? { ...m, enabled: true, amount: 0.75 } : m
    );
    expect(evaluateLesson('m04_chord_motif', m4).passed).toBe(true);

    // 5
    const m5 = createLessonProject('m05_chain_combo');
    m5.blocks.progressionId = 'lofi_2516';
    m5.chain = unpackBlocksToChain(m5.blocks, m5.bars, m5.chain.modifiers);
    m5.chain.modifiers = m5.chain.modifiers.map((m) =>
      m.id === 'syncopation' ? { ...m, enabled: true, amount: 0.7 } : m
    );
    expect(evaluateLesson('m05_chain_combo', m5).passed).toBe(false);
    m5.chain.modifiers = m5.chain.modifiers.map((m) =>
      m.id === 'passing_tones' ? { ...m, enabled: true, amount: 0.65 } : m
    );
    expect(evaluateLesson('m05_chain_combo', m5).passed).toBe(true);

    // 6: L2 -> L3 브릿지 (has_user_edited_notes)
    const m6 = createLessonProject('m06_l2_to_l3_bridge');
    m6.chain.chords[3].degree = 'iv';
    expect(evaluateLesson('m06_l2_to_l3_bridge', m6).passed).toBe(false);
    const compiled6 = compileSong(m6);
    m6.baked = true;
    m6.bakedMelody = compiled6.melody.map((n, idx) =>
      idx === 0 ? { ...n, origin: 'user' as const } : { ...n, origin: 'base' as const }
    );
    const res6 = evaluateLesson('m06_l2_to_l3_bridge', m6);
    expect(res6.passed, JSON.stringify(res6.checks)).toBe(true);
  });

  it('Unit 3 (7..9): L3 precision editing, coach cleanup & manual motif variation', () => {
    // 7: 잦은 큰 도약 교정
    const m7 = createLessonProject('m07_range_leaps');
    const rep7 = analyzeSong(compileSong(m7), m7);
    expect(rep7.issues.some((i) => i.kind === 'excessive_leaps')).toBe(true);
    m7.bakedMelody[1] = { ...m7.bakedMelody[1], midi: 64 }; // E4
    m7.bakedMelody[3] = { ...m7.bakedMelody[3], midi: 67 }; // G4
    expect(evaluateLesson('m07_range_leaps', m7).passed).toBe(true);

    // 8: 복합 결함(충돌 + 이탈음 + 열린 종지) 진단·개선
    const m8 = createLessonProject('m08_coach_cleanup');
    const rep8 = analyzeSong(compileSong(m8), m8);
    expect(rep8.issues.some((i) => i.kind === 'clash')).toBe(true);
    expect(rep8.issues.some((i) => i.kind === 'out_of_scale')).toBe(true);
    expect(rep8.issues.some((i) => i.kind === 'weak_cadence')).toBe(true);
    m8.bakedMelody[0] = { ...m8.bakedMelody[0], midi: 64 }; // clash 해결
    m8.bakedMelody[1] = { ...m8.bakedMelody[1], midi: 67 }; // out_of_scale 해결
    expect(evaluateLesson('m08_coach_cleanup', m8).passed).toBe(false);
    m8.bakedMelody[7] = { ...m8.bakedMelody[7], midi: 60 }; // weak_cadence 해결
    expect(evaluateLesson('m08_coach_cleanup', m8).passed).toBe(true);

    // 9: 1마디 모티프 2~4마디 직접 변주
    const m9 = createLessonProject('m09_manual_motif');
    m9.bakedMelody.push(
      { id: 'b2_1', midi: 62, step: 16, duration: 4, velocity: 0.82 },
      { id: 'b2_2', midi: 64, step: 22, duration: 2, velocity: 0.76 },
      { id: 'b2_3', midi: 67, step: 24, duration: 4, velocity: 0.82 },
      { id: 'b3_1', midi: 69, step: 32, duration: 4, velocity: 0.82 },
      { id: 'b3_2', midi: 71, step: 38, duration: 2, velocity: 0.76 }
    );
    expect(evaluateLesson('m09_manual_motif', m9).passed).toBe(false);
    m9.bakedMelody.push(
      { id: 'b4_1', midi: 69, step: 48, duration: 4, velocity: 0.82 },
      { id: 'b4_2', midi: 72, step: 56, duration: 6, velocity: 0.86 }
    );
    expect(evaluateLesson('m09_manual_motif', m9).passed).toBe(true);
  });

  it('Unit 4 (10..12): 8-bar climax, Canon transposition & full pipeline master', () => {
    // 10
    const m10 = createLessonProject('m10_eight_climax');
    m10.bars = 8;
    m10.chain = unpackBlocksToChain(m10.blocks, 8, m10.chain.modifiers);
    expect(evaluateLesson('m10_eight_climax', m10).passed).toBe(false);
    m10.chain.modifiers = m10.chain.modifiers.map((m) =>
      m.id === 'octave_lift' ? { ...m, enabled: true, amount: 0.75 } : m
    );
    expect(evaluateLesson('m10_eight_climax', m10).passed).toBe(true);

    // 11
    const m11 = createLessonProject('m11_transpose_canon');
    m11.blocks.progressionId = 'canon';
    m11.chain = unpackBlocksToChain(m11.blocks, 8, m11.chain.modifiers);
    m11.blocks.grooveId = 'lofi_chill';
    expect(evaluateLesson('m11_transpose_canon', m11).passed).toBe(false);
    m11.keyRoot = 7; // G
    const res11 = evaluateLesson('m11_transpose_canon', m11);
    expect(res11.passed, JSON.stringify(res11.checks)).toBe(true);

    // 12: 풀 파이프라인 마스터 (L1/L2 -> L3 직접 수정 2음 이상 + 90점+)
    const m12 = createLessonProject('m12_final_master');
    m12.bars = 8;
    m12.chain = unpackBlocksToChain(m12.blocks, 8, m12.chain.modifiers);
    m12.chain.modifiers = m12.chain.modifiers.map((m) =>
      m.id === 'octave_lift' ? { ...m, enabled: true, amount: 0.75 } : m
    );
    expect(evaluateLesson('m12_final_master', m12).passed).toBe(false);
    const compiled12 = compileSong(m12);
    m12.baked = true;
    m12.bakedMelody = compiled12.melody.map((n, idx) =>
      idx < 2 ? { ...n, origin: 'user' as const } : { ...n, origin: 'base' as const }
    );
    expect(evaluateLesson('m12_final_master', m12).passed).toBe(true);
  });
});
