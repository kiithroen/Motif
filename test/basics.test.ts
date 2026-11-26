import { describe, expect, it } from 'vitest';
import {
  BASIC_LESSONS,
  compileCompareDemo,
  createBasicLessonProject,
  evaluateBasicLesson,
} from '../src/core/basics';

describe('Focused music theory & classical curriculum', () => {
  it('starts every lesson in an unsolved state and compiles all compare demos cleanly', () => {
    expect(BASIC_LESSONS).toHaveLength(7);

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

  it('evaluates Lesson 1 (chord tones vs semitone clash)', () => {
    const p = createBasicLessonProject('c1_chord_clash');
    // 잘못된 수정: 1마디만 E4(64)로 고치고 2마디(G)는 여전히 C5(72) 충돌 유지
    p.bakedMelody[0] = { ...p.bakedMelody[0], midi: 64 };
    expect(evaluateBasicLesson('c1_chord_clash', p).passed).toBe(false);

    // 정답: 2마디(G)도 코드톤 G4(67)로 변경
    p.bakedMelody[1] = { ...p.bakedMelody[1], midi: 67 };
    expect(evaluateBasicLesson('c1_chord_clash', p).passed).toBe(true);
  });

  it('evaluates Lesson 2 (4 downbeat skeleton notes on empty roll)', () => {
    const p = createBasicLessonProject('c2_skeleton');
    // 잘못된 수정: 3개 마디만 채움
    p.bakedMelody = [
      { id: 's1', midi: 64, step: 0, duration: 8, velocity: 0.8 },
      { id: 's2', midi: 67, step: 16, duration: 8, velocity: 0.8 },
      { id: 's3', midi: 72, step: 32, duration: 8, velocity: 0.8 },
    ];
    expect(evaluateBasicLesson('c2_skeleton', p).passed).toBe(false);

    // 정답: 4마디(F) 첫 박자에도 코드톤 F4(65) 추가
    p.bakedMelody.push({ id: 's4', midi: 65, step: 48, duration: 8, velocity: 0.8 });
    expect(evaluateBasicLesson('c2_skeleton', p).passed).toBe(true);
  });

  it('evaluates Lesson 3 (passing notes between skeleton tones)', () => {
    const p = createBasicLessonProject('c3_passing_step');
    // 잘못된 수정: 강박(step 8)에 F4(65) 충돌음 추가
    p.bakedMelody.push({ id: 'bad_pass', midi: 65, step: 8, duration: 4, velocity: 0.8 });
    expect(evaluateBasicLesson('c3_passing_step', p).passed).toBe(false);

    // 정답: 약박(step 10, step 22)에 짧은 스케일 연결음 2개 추가
    p.bakedMelody.pop();
    p.bakedMelody.push(
      { id: 'p1', midi: 65, step: 10, duration: 2, velocity: 0.75 },
      { id: 'p2', midi: 69, step: 22, duration: 2, velocity: 0.75 }
    );
    expect(evaluateBasicLesson('c3_passing_step', p).passed).toBe(true);
  });

  it('evaluates Lesson 4 (varied durations + breathing room)', () => {
    const p = createBasicLessonProject('c4_rhythm_rest');
    // 잘못된 수정: 음표 1개만 지우면 쉼표 비율 12.5% (< 15%) 이고 음표 길이도 1종류
    p.bakedMelody.pop();
    expect(evaluateBasicLesson('c4_rhythm_rest', p).passed).toBe(false);

    // 정답: 하나 더 지워 쉼표 확보(25%) + 짧은 4칸 음표 추가해 길이 2종류 이상
    p.bakedMelody.pop();
    p.bakedMelody[0] = { ...p.bakedMelody[0], duration: 4 };
    expect(evaluateBasicLesson('c4_rhythm_rest', p).passed).toBe(true);
  });

  it('evaluates Lesson 5 (Beethoven Ode to Joy cadence)', () => {
    const p = createBasicLessonProject('c5_ode_cadence');
    // 잘못된 수정: 마지막 음을 B4(71) 로 바꿔도 여전히 열린 종지
    p.bakedMelody[p.bakedMelody.length - 1] = {
      ...p.bakedMelody[p.bakedMelody.length - 1],
      midi: 71,
    };
    expect(evaluateBasicLesson('c5_ode_cadence', p).passed).toBe(false);

    // 정답: 마지막 음을 C4(60) 으뜸음 도로 변경
    p.bakedMelody[p.bakedMelody.length - 1] = {
      ...p.bakedMelody[p.bakedMelody.length - 1],
      midi: 60,
    };
    expect(evaluateBasicLesson('c5_ode_cadence', p).passed).toBe(true);
  });

  it('evaluates Lesson 6 (swap 4th bar F -> Fm)', () => {
    const p = createBasicLessonProject('c6_chord_color');
    // 잘못된 수정: 4번째 마디를 G(V) 로 변경
    p.chain.chords[3].degree = 'V';
    expect(evaluateBasicLesson('c6_chord_color', p).passed).toBe(false);

    // 정답: iv(Fm) 로 변경
    p.chain.chords[3].degree = 'iv';
    expect(evaluateBasicLesson('c6_chord_color', p).passed).toBe(true);
  });

  it('evaluates Lesson 7 (Pachelbel Canon arrangement)', () => {
    const p = createBasicLessonProject('c7_canon_arrange');
    // 잘못된 수정: 단조로만 바꾸고 원곡 반주(ballad_arp) 유지
    p.mode = 'minor';
    expect(evaluateBasicLesson('c7_canon_arrange', p).passed).toBe(false);

    // 정답: 로파이 그루브로 변경 + 단조 전환
    p.blocks.grooveId = 'lofi_chill';
    expect(evaluateBasicLesson('c7_canon_arrange', p).passed).toBe(true);
  });
});
