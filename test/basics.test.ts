import { describe, expect, it } from 'vitest';
import {
  BASIC_LESSONS,
  compileCompareDemo,
  createBasicLessonProject,
  evaluateBasicLesson,
  getBasicUnits,
} from '../src/core/basics';

describe('Basics 14-lesson curriculum (4 units: 4+3+4+3)', () => {
  it('organizes 14 lessons into 4 units, starts every lesson unsolved, and compiles all demos', () => {
    expect(BASIC_LESSONS).toHaveLength(14);
    const units = getBasicUnits();
    expect(units).toHaveLength(4);
    expect(units.map((u) => u.lessons.length)).toEqual([4, 3, 4, 3]);

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

  it('Unit 1 (1..4): chord tones, scale mode, blind ear drill & piano roll rescue', () => {
    // 1강: C, G
    const l1 = createBasicLessonProject('c1_chord_clash');
    l1.bakedMelody[0] = { ...l1.bakedMelody[0], midi: 64 };
    expect(evaluateBasicLesson('c1_chord_clash', l1).passed).toBe(false);
    l1.bakedMelody[1] = { ...l1.bakedMelody[1], midi: 67 };
    expect(evaluateBasicLesson('c1_chord_clash', l1).passed).toBe(true);

    // 2강: 음계 이탈음 2곳 교정
    const l2 = createBasicLessonProject('b02_scale_mode');
    l2.bakedMelody[1] = { ...l2.bakedMelody[1], midi: 67 }; // Bb4 -> G4 해결, F#4 남음
    expect(evaluateBasicLesson('b02_scale_mode', l2).passed).toBe(false);
    l2.bakedMelody[5] = { ...l2.bakedMelody[5], midi: 64 }; // F#4 -> E4 해결
    expect(evaluateBasicLesson('b02_scale_mode', l2).passed).toBe(true);

    // 3강: 라벨 숨김 귀 훈련 4마디
    const l3 = createBasicLessonProject('b03_ear_triads');
    expect(BASIC_LESSONS[2].hidePickLabels).toBe(true);
    l3.bakedMelody[0] = { ...l3.bakedMelody[0], midi: 64 };
    l3.bakedMelody[1] = { ...l3.bakedMelody[1], midi: 67 };
    expect(evaluateBasicLesson('b03_ear_triads', l3).passed).toBe(false);
    l3.bakedMelody[2] = { ...l3.bakedMelody[2], midi: 69 };
    l3.bakedMelody[3] = { ...l3.bakedMelody[3], midi: 65 };
    expect(evaluateBasicLesson('b03_ear_triads', l3).passed).toBe(true);

    // 4강: 피아노롤 첫 만남 충돌음 3곳 구출
    const l4 = createBasicLessonProject('b04_u1_review');
    l4.bakedMelody[0] = { ...l4.bakedMelody[0], midi: 64 };
    expect(evaluateBasicLesson('b04_u1_review', l4).passed).toBe(false);
    l4.bakedMelody[2] = { ...l4.bakedMelody[2], midi: 71 };
    l4.bakedMelody[6] = { ...l4.bakedMelody[6], midi: 65 };
    expect(evaluateBasicLesson('b04_u1_review', l4).passed).toBe(true);
  });

  it('Unit 2 (5..7): skeleton, passing/tension & Twinkle leap compensation', () => {
    // 5강: 뼈대 4음
    const l5 = createBasicLessonProject('c2_skeleton');
    l5.bakedMelody = [
      { id: 's1', midi: 64, step: 0, duration: 8, velocity: 0.8 },
      { id: 's2', midi: 67, step: 16, duration: 8, velocity: 0.8 },
      { id: 's3', midi: 72, step: 32, duration: 8, velocity: 0.8 },
    ];
    expect(evaluateBasicLesson('c2_skeleton', l5).passed).toBe(false);
    l5.bakedMelody.push({ id: 's4', midi: 65, step: 48, duration: 8, velocity: 0.8 });
    expect(evaluateBasicLesson('c2_skeleton', l5).passed).toBe(true);

    // 6강: 계단 연결음 + 긴장음 3개 이상
    const l6 = createBasicLessonProject('c3_passing_step');
    l6.bakedMelody.push(
      { id: 'p1', midi: 65, step: 10, duration: 2, velocity: 0.75 },
      { id: 'p2', midi: 69, step: 22, duration: 2, velocity: 0.75 }
    );
    expect(evaluateBasicLesson('c3_passing_step', l6).passed).toBe(false);
    l6.bakedMelody.push({ id: 'p3', midi: 71, step: 26, duration: 2, velocity: 0.75 });
    expect(evaluateBasicLesson('c3_passing_step', l6).passed).toBe(true);

    // 7강: 모차르트 작은 별 3마디 계단 하강 채우기 (min_notes_in_bar)
    const l7 = createBasicLessonProject('b07_twinkle_leap');
    l7.bakedMelody.push({ id: 'tw_8', midi: 65, step: 32, duration: 4, velocity: 0.82 });
    expect(evaluateBasicLesson('b07_twinkle_leap', l7).passed).toBe(false);
    l7.bakedMelody.push({ id: 'tw_10', midi: 64, step: 42, duration: 4, velocity: 0.82 });
    expect(evaluateBasicLesson('b07_twinkle_leap', l7).passed).toBe(true);
  });

  it('Unit 3 (8..11): meter beats, rhythm/rest, syncopation & Ode cadence', () => {
    // 8강: 4/4 강박 6개 이상 (min_strong_beat_notes)
    const l8 = createBasicLessonProject('b08_meter_beats');
    l8.bakedMelody.push({ id: 'b3_1', midi: 67, step: 8, duration: 4, velocity: 0.82 }); // 5 strong beats
    expect(evaluateBasicLesson('b08_meter_beats', l8).passed).toBe(false);
    l8.bakedMelody.push({ id: 'b3_2', midi: 71, step: 24, duration: 4, velocity: 0.82 }); // 6 strong beats
    expect(evaluateBasicLesson('b08_meter_beats', l8).passed).toBe(true);

    // 9강: 음표 길이 2종류 이상 + 쉼표 20% 이상
    const l9 = createBasicLessonProject('c4_rhythm_rest');
    l9.bakedMelody.pop(); // 12.5% rest -> fail
    expect(evaluateBasicLesson('c4_rhythm_rest', l9).passed).toBe(false);
    l9.bakedMelody.pop(); // 25% rest
    l9.bakedMelody[0] = { ...l9.bakedMelody[0], duration: 4 };
    expect(evaluateBasicLesson('c4_rhythm_rest', l9).passed).toBe(true);

    // 10강: 당김음 2개 이상 (min_syncopated_notes)
    const l10 = createBasicLessonProject('b10_syncopation');
    l10.bakedMelody[1] = { ...l10.bakedMelody[1], step: 6 }; // 1개만 앞당김
    expect(evaluateBasicLesson('b10_syncopation', l10).passed).toBe(false);
    l10.bakedMelody[3] = { ...l10.bakedMelody[3], step: 22 }; // 2개 앞당김
    expect(evaluateBasicLesson('b10_syncopation', l10).passed).toBe(true);

    // 11강: 베토벤 환희의 송가
    const l11 = createBasicLessonProject('c5_ode_cadence');
    l11.bakedMelody[l11.bakedMelody.length - 1] = {
      ...l11.bakedMelody[l11.bakedMelody.length - 1],
      midi: 71,
    };
    expect(evaluateBasicLesson('c5_ode_cadence', l11).passed).toBe(false);
    l11.bakedMelody[l11.bakedMelody.length - 1] = {
      ...l11.bakedMelody[l11.bakedMelody.length - 1],
      midi: 60,
    };
    expect(evaluateBasicLesson('c5_ode_cadence', l11).passed).toBe(true);
  });

  it('Unit 4 (12..14): harmonic functions, chord colors & Canon graduation', () => {
    // 12강: I - IV - V7 - I
    const l12 = createBasicLessonProject('b12_harmonic_function');
    l12.chain.chords[1].degree = 'IV';
    expect(evaluateBasicLesson('b12_harmonic_function', l12).passed).toBe(false);
    l12.chain.chords[2].degree = 'V7';
    expect(evaluateBasicLesson('b12_harmonic_function', l12).passed).toBe(true);

    // 13강: 마이너 시작 + 대리화음 iv
    const l13 = createBasicLessonProject('c6_chord_color');
    l13.chain.chords[0].degree = 'vi';
    expect(evaluateBasicLesson('c6_chord_color', l13).passed).toBe(false);
    l13.chain.chords[3].degree = 'iv';
    expect(evaluateBasicLesson('c6_chord_color', l13).passed).toBe(true);

    // 14강: 캐논 졸업 종합
    const l14 = createBasicLessonProject('c7_canon_graduation');
    l14.blocks.grooveId = 'strum_8beat';
    expect(evaluateBasicLesson('c7_canon_graduation', l14).passed).toBe(false);
    l14.bakedMelody[0] = { ...l14.bakedMelody[0], duration: 4 };
    expect(evaluateBasicLesson('c7_canon_graduation', l14).passed).toBe(true);
  });
});
