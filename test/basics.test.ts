import { describe, expect, it } from 'vitest';
import {
  BASIC_LESSONS,
  compileCompareDemo,
  createBasicLessonProject,
  evaluateBasicLesson,
  getBasicUnits,
} from '../src/core/basics';

describe('Basics 20-lesson curriculum (4 units x 5 lessons)', () => {
  it('organizes 20 lessons into 4 units, starts every lesson unsolved, and compiles all demos', () => {
    expect(BASIC_LESSONS).toHaveLength(20);
    const units = getBasicUnits();
    expect(units).toHaveLength(4);
    for (const u of units) {
      expect(u.lessons).toHaveLength(5);
    }

    for (const lesson of BASIC_LESSONS) {
      const initial = createBasicLessonProject(lesson.id);
      expect(initial.baked).toBe(true);
      const initEval = evaluateBasicLesson(lesson.id, initial);
      expect(initEval.passed, `${lesson.id} should start unsolved`).toBe(false);

      expect(lesson.compareDemos).toHaveLength(2);
      for (const demo of lesson.compareDemos) {
        const compiled = compileCompareDemo(demo);
        expect(compiled.totalSteps).toBe(demo.chords.length * 16);
        expect(compiled.chords.length).toBeGreaterThan(0);
      }
    }
  });

  it('Unit 1 (1..5): chord tones & clash rescue', () => {
    // 1강: C, G
    const l1 = createBasicLessonProject('c1_chord_clash');
    l1.bakedMelody[0] = { ...l1.bakedMelody[0], midi: 64 };
    expect(evaluateBasicLesson('c1_chord_clash', l1).passed).toBe(false);
    l1.bakedMelody[1] = { ...l1.bakedMelody[1], midi: 67 };
    expect(evaluateBasicLesson('c1_chord_clash', l1).passed).toBe(true);

    // 2강: Am, F
    const l2 = createBasicLessonProject('b02_am_f_drill');
    l2.bakedMelody[0] = { ...l2.bakedMelody[0], midi: 69 }; // A4 on Am
    expect(evaluateBasicLesson('b02_am_f_drill', l2).passed).toBe(false);
    l2.bakedMelody[1] = { ...l2.bakedMelody[1], midi: 65 }; // F4 on F
    expect(evaluateBasicLesson('b02_am_f_drill', l2).passed).toBe(true);

    // 3강: Dm, Em
    const l3 = createBasicLessonProject('b03_minor_triads');
    l3.bakedMelody[0] = { ...l3.bakedMelody[0], midi: 62 }; // D4 on Dm
    expect(evaluateBasicLesson('b03_minor_triads', l3).passed).toBe(false);
    l3.bakedMelody[1] = { ...l3.bakedMelody[1], midi: 67 }; // G4 on Em
    expect(evaluateBasicLesson('b03_minor_triads', l3).passed).toBe(true);

    // 4강: C-G-Am-F 4마디 연속
    const l4 = createBasicLessonProject('b04_four_bar_pick');
    l4.bakedMelody[0] = { ...l4.bakedMelody[0], midi: 64 };
    l4.bakedMelody[1] = { ...l4.bakedMelody[1], midi: 67 };
    expect(evaluateBasicLesson('b04_four_bar_pick', l4).passed).toBe(false);
    l4.bakedMelody[2] = { ...l4.bakedMelody[2], midi: 69 };
    l4.bakedMelody[3] = { ...l4.bakedMelody[3], midi: 65 };
    expect(evaluateBasicLesson('b04_four_bar_pick', l4).passed).toBe(true);

    // 5강: 종합 충돌 3곳 구출
    const l5 = createBasicLessonProject('b05_u1_review');
    l5.bakedMelody[0] = { ...l5.bakedMelody[0], midi: 64 };
    expect(evaluateBasicLesson('b05_u1_review', l5).passed).toBe(false);
    l5.bakedMelody[2] = { ...l5.bakedMelody[2], midi: 71 };
    l5.bakedMelody[6] = { ...l5.bakedMelody[6], midi: 65 };
    expect(evaluateBasicLesson('b05_u1_review', l5).passed).toBe(true);
  });

  it('Unit 2 (6..10): skeleton & passing steps', () => {
    // 6강
    const l6 = createBasicLessonProject('c2_skeleton');
    l6.bakedMelody = [
      { id: 's1', midi: 64, step: 0, duration: 8, velocity: 0.8 },
      { id: 's2', midi: 67, step: 16, duration: 8, velocity: 0.8 },
      { id: 's3', midi: 72, step: 32, duration: 8, velocity: 0.8 },
    ];
    expect(evaluateBasicLesson('c2_skeleton', l6).passed).toBe(false);
    l6.bakedMelody.push({ id: 's4', midi: 65, step: 48, duration: 8, velocity: 0.8 });
    expect(evaluateBasicLesson('c2_skeleton', l6).passed).toBe(true);

    // 7강: Am-F-C-G 뼈대
    const l7 = createBasicLessonProject('b07_sad_skeleton');
    l7.bakedMelody = [
      { id: 'k1', midi: 69, step: 0, duration: 8, velocity: 0.8 },
      { id: 'k2', midi: 65, step: 16, duration: 8, velocity: 0.8 },
      { id: 'k3', midi: 64, step: 32, duration: 8, velocity: 0.8 },
      { id: 'k4', midi: 65, step: 48, duration: 8, velocity: 0.8 }, // F on G -> clash
    ];
    expect(evaluateBasicLesson('b07_sad_skeleton', l7).passed).toBe(false);
    l7.bakedMelody[3] = { ...l7.bakedMelody[3], midi: 67 };
    expect(evaluateBasicLesson('b07_sad_skeleton', l7).passed).toBe(true);

    // 8강: 상행 연결
    const l8 = createBasicLessonProject('c3_passing_step');
    l8.bakedMelody.push({ id: 'bad', midi: 65, step: 8, duration: 4, velocity: 0.8 });
    expect(evaluateBasicLesson('c3_passing_step', l8).passed).toBe(false);
    l8.bakedMelody.pop();
    l8.bakedMelody.push(
      { id: 'p1', midi: 65, step: 10, duration: 2, velocity: 0.75 },
      { id: 'p2', midi: 69, step: 22, duration: 2, velocity: 0.75 }
    );
    expect(evaluateBasicLesson('c3_passing_step', l8).passed).toBe(true);

    // 9강: 하행 연결
    const l9 = createBasicLessonProject('b09_desc_passing');
    l9.bakedMelody.push({ id: 'only1', midi: 72, step: 10, duration: 2, velocity: 0.75 });
    expect(evaluateBasicLesson('b09_desc_passing', l9).passed).toBe(false);
    l9.bakedMelody.push({ id: 'p2', midi: 71, step: 26, duration: 2, velocity: 0.75 });
    expect(evaluateBasicLesson('b09_desc_passing', l9).passed).toBe(true);

    // 10강: F-G-Em-Am 빈 4마디 자작
    const l10 = createBasicLessonProject('b10_u2_review');
    l10.bakedMelody = [
      { id: 'r1', midi: 69, step: 0, duration: 4, velocity: 0.8 },
      { id: 'r2', midi: 71, step: 16, duration: 4, velocity: 0.8 },
      { id: 'r3', midi: 67, step: 32, duration: 4, velocity: 0.8 },
      { id: 'r4', midi: 69, step: 48, duration: 4, velocity: 0.8 },
      { id: 'r5', midi: 72, step: 10, duration: 2, velocity: 0.75 },
      { id: 'r6', midi: 69, step: 26, duration: 2, velocity: 0.75 },
    ];
    expect(evaluateBasicLesson('b10_u2_review', l10).passed).toBe(false);
    l10.bakedMelody.push({ id: 'r7', midi: 71, step: 42, duration: 2, velocity: 0.75 });
    expect(evaluateBasicLesson('b10_u2_review', l10).passed).toBe(true);
  });

  it('Unit 3 (11..15): rhythm, rests & classical cadence dissection', () => {
    // 11강
    const l11 = createBasicLessonProject('c4_rhythm_rest');
    l11.bakedMelody.pop();
    expect(evaluateBasicLesson('c4_rhythm_rest', l11).passed).toBe(false);
    l11.bakedMelody.pop();
    l11.bakedMelody[0] = { ...l11.bakedMelody[0], duration: 4 };
    expect(evaluateBasicLesson('c4_rhythm_rest', l11).passed).toBe(true);

    // 12강: 20% 이상 여백 프레이즈
    const l12 = createBasicLessonProject('b12_phrase_breath');
    l12.bakedMelody.pop(); // 12.5% rest -> fail
    expect(evaluateBasicLesson('b12_phrase_breath', l12).passed).toBe(false);
    l12.bakedMelody.pop(); // 25% rest
    l12.bakedMelody[0] = { ...l12.bakedMelody[0], duration: 4 };
    expect(evaluateBasicLesson('b12_phrase_breath', l12).passed).toBe(true);

    // 13강: 베토벤 환희의 송가
    const l13 = createBasicLessonProject('c5_ode_cadence');
    l13.bakedMelody[l13.bakedMelody.length - 1] = {
      ...l13.bakedMelody[l13.bakedMelody.length - 1],
      midi: 71,
    };
    expect(evaluateBasicLesson('c5_ode_cadence', l13).passed).toBe(false);
    l13.bakedMelody[l13.bakedMelody.length - 1] = {
      ...l13.bakedMelody[l13.bakedMelody.length - 1],
      midi: 60,
    };
    expect(evaluateBasicLesson('c5_ode_cadence', l13).passed).toBe(true);

    // 14강: 모차르트 작은 별
    const l14 = createBasicLessonProject('b14_twinkle_mozart');
    l14.bakedMelody[l14.bakedMelody.length - 1] = {
      ...l14.bakedMelody[l14.bakedMelody.length - 1],
      midi: 67, // G -> weak_cadence
    };
    expect(evaluateBasicLesson('b14_twinkle_mozart', l14).passed).toBe(false);
    l14.bakedMelody[l14.bakedMelody.length - 1] = {
      ...l14.bakedMelody[l14.bakedMelody.length - 1],
      midi: 60,
    };
    expect(evaluateBasicLesson('b14_twinkle_mozart', l14).passed).toBe(true);

    // 15강: 유닛 3 종합
    const l15 = createBasicLessonProject('b15_u3_review');
    l15.bakedMelody[l15.bakedMelody.length - 1] = {
      ...l15.bakedMelody[l15.bakedMelody.length - 1],
      midi: 72, // 종지 해결만 하고 리듬/여백 미해결
    };
    expect(evaluateBasicLesson('b15_u3_review', l15).passed).toBe(false);
    l15.bakedMelody.splice(3, 1); // 2마디 끝 비우기
    l15.bakedMelody.splice(5, 1); // 4마디 앞 정리
    l15.bakedMelody[0] = { ...l15.bakedMelody[0], duration: 4 };
    expect(evaluateBasicLesson('b15_u3_review', l15).passed).toBe(true);
  });

  it('Unit 4 (16..20): chord colors & Canon arrangement', () => {
    // 16강: F -> Fm
    const l16 = createBasicLessonProject('c6_chord_color');
    l16.chain.chords[3].degree = 'V';
    expect(evaluateBasicLesson('c6_chord_color', l16).passed).toBe(false);
    l16.chain.chords[3].degree = 'iv';
    expect(evaluateBasicLesson('c6_chord_color', l16).passed).toBe(true);

    // 17강: 첫 코드 마이너 전환
    const l17 = createBasicLessonProject('b17_start_minor');
    l17.chain.chords[0].degree = 'IV'; // F (메이저)
    expect(evaluateBasicLesson('b17_start_minor', l17).passed).toBe(false);
    l17.chain.chords[0].degree = 'vi'; // Am
    expect(evaluateBasicLesson('b17_start_minor', l17).passed).toBe(true);

    // 18강: F-G-Em-Am 조립
    const l18 = createBasicLessonProject('b18_build_4536');
    l18.chain.chords[0].degree = 'IV';
    l18.chain.chords[1].degree = 'V';
    expect(evaluateBasicLesson('b18_build_4536', l18).passed).toBe(false);
    l18.chain.chords[2].degree = 'iii';
    l18.chain.chords[3].degree = 'vi';
    expect(evaluateBasicLesson('b18_build_4536', l18).passed).toBe(true);

    // 19강: 캐논 편곡
    const l19 = createBasicLessonProject('c7_canon_arrange');
    l19.mode = 'minor';
    expect(evaluateBasicLesson('c7_canon_arrange', l19).passed).toBe(false);
    l19.blocks.grooveId = 'lofi_chill';
    expect(evaluateBasicLesson('c7_canon_arrange', l19).passed).toBe(true);

    // 20강: 졸업 종합
    const l20 = createBasicLessonProject('b20_graduation');
    l20.blocks.grooveId = 'strum_8beat'; // 그루브만 바꾸고 음표 길이 1종류
    expect(evaluateBasicLesson('b20_graduation', l20).passed).toBe(false);
    l20.bakedMelody[0] = { ...l20.bakedMelody[0], duration: 4 };
    expect(evaluateBasicLesson('b20_graduation', l20).passed).toBe(true);
  });
});
