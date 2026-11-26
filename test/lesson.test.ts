import { describe, expect, it } from 'vitest';
import { analyzeSong } from '../src/core/analyzer';
import { compileSong, unpackBlocksToChain } from '../src/core/compiler';
import { LESSONS, createLessonProject, evaluateLesson } from '../src/core/lesson';

describe('Duolingo-style micro composition lessons', () => {
  it('starts every lesson in an unsolved state and verifies wrong vs intended solutions', () => {
    expect(LESSONS).toHaveLength(6);

    for (const lesson of LESSONS) {
      const initial = createLessonProject(lesson.id);
      const initEval = evaluateLesson(lesson.id, initial);
      expect(initEval.passed, `${lesson.id} should fail initially`).toBe(false);
    }
  });

  it('evaluates Lesson 1 (groove + energy)', () => {
    const p = createLessonProject('lesson_1_groove');
    // 잘못된 수정: 에너지만 올리고 그루브는 발라드 유지
    p.blocks.energy = 0.85;
    expect(evaluateLesson('lesson_1_groove', p).passed).toBe(false);

    // 정답: 그루브를 8비트 기타 스트럼으로 변경
    p.blocks.grooveId = 'strum_8beat';
    expect(evaluateLesson('lesson_1_groove', p).passed).toBe(true);
  });

  it('evaluates Lesson 2 (4th bar iv chord mood)', () => {
    const p = createLessonProject('lesson_2_chord_mood');
    // 잘못된 수정: 4번째 마디를 V7 로 변경
    p.chain.chords[3].degree = 'V7';
    expect(evaluateLesson('lesson_2_chord_mood', p).passed).toBe(false);

    // 정답: 4번째 마디를 iv 로 변경
    p.chain.chords[3].degree = 'iv';
    expect(evaluateLesson('lesson_2_chord_mood', p).passed).toBe(true);
  });

  it('evaluates Lesson 3 (cadence fix via coach or L3 edit)', () => {
    const p = createLessonProject('lesson_3_cadence_fix');
    // 잘못된 수정: 마지막 음을 B4(71, 7음) 로 옮김 -> 여전히 열린 종지
    p.bakedMelody[p.bakedMelody.length - 1] = {
      ...p.bakedMelody[p.bakedMelody.length - 1],
      midi: 71,
    };
    expect(evaluateLesson('lesson_3_cadence_fix', p).passed).toBe(false);

    // 정답: 이론 코치의 weak_cadence 수정안 적용
    const report = analyzeSong(compileSong(p), p);
    const cadIssue = report.issues.find((i) => i.kind === 'weak_cadence');
    expect(cadIssue).toBeDefined();
    const fixed = cadIssue!.applyFix(p);
    expect(evaluateLesson('lesson_3_cadence_fix', fixed).passed).toBe(true);
  });

  it('evaluates Lesson 4 (downbeat chord tones + zero clashes)', () => {
    const p = createLessonProject('lesson_4_chord_tones');
    // 잘못된 수정: 충돌음만 고치고 3·4마디 첫 박자는 비워둠
    p.bakedMelody[0] = { ...p.bakedMelody[0], midi: 64 }; // E4
    p.bakedMelody[3] = { ...p.bakedMelody[3], midi: 74 }; // D5
    expect(evaluateLesson('lesson_4_chord_tones', p).passed).toBe(false);

    // 정답: 3마디(Am -> A4=69), 4마디(F -> F4=65) 첫 박자 코드톤 추가
    p.bakedMelody.push(
      { id: 'fix_3', midi: 69, step: 32, duration: 4, velocity: 0.82, origin: 'user' },
      { id: 'fix_4', midi: 65, step: 48, duration: 4, velocity: 0.82, origin: 'user' }
    );
    expect(evaluateLesson('lesson_4_chord_tones', p).passed).toBe(true);
  });

  it('evaluates Lesson 5 (motif repeat + passing/syncopation + score >= 85)', () => {
    const p = createLessonProject('lesson_5_motif_var');
    // 잘못된 수정: 경과음만 켜고 motif_repeat 는 끔
    p.chain.modifiers = p.chain.modifiers.map((m) =>
      m.id === 'passing_tones' ? { ...m, enabled: true } : m
    );
    expect(evaluateLesson('lesson_5_motif_var', p).passed).toBe(false);

    // 정답: motif_repeat 강도 0.75 로 켜기 (passing_tones 또는 syncopation 모두 통과)
    p.chain.modifiers = p.chain.modifiers.map((m) =>
      m.id === 'motif_repeat' ? { ...m, enabled: true, amount: 0.75 } : m
    );
    expect(evaluateLesson('lesson_5_motif_var', p).passed).toBe(true);

    const pSync = createLessonProject('lesson_5_motif_var');
    pSync.chain.modifiers = pSync.chain.modifiers.map((m) =>
      m.id === 'motif_repeat' || m.id === 'syncopation' ? { ...m, enabled: true, amount: 0.75 } : m
    );
    expect(evaluateLesson('lesson_5_motif_var', pSync).passed).toBe(true);
  });

  it('evaluates Lesson 6 (8 bars + second-half climax + clean score)', () => {
    const p = createLessonProject('lesson_6_eight_bars');
    // 잘못된 수정: 8마디로만 늘리고 후반부 클라이맥스를 켜지 않음
    p.bars = 8;
    p.chain = unpackBlocksToChain(p.blocks, 8, p.chain.modifiers);
    expect(evaluateLesson('lesson_6_eight_bars', p).passed).toBe(false);

    // 정답: octave_lift 켜기
    p.chain.modifiers = p.chain.modifiers.map((m) =>
      m.id === 'octave_lift' ? { ...m, enabled: true, amount: 0.75 } : m
    );
    expect(evaluateLesson('lesson_6_eight_bars', p).passed).toBe(true);
  });
});
