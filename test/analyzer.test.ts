import { describe, expect, it } from 'vitest';
import { analyzeSong } from '../src/core/analyzer';
import { compileSong } from '../src/core/compiler';
import { PRESETS, createDefaultProject } from '../src/core/model';

describe('music theory analyzer and deliberate fault checks', () => {
  it('catches strong-beat semitone clash and resolves it via applyFix', () => {
    const p = createDefaultProject();
    p.baked = true;
    p.bakedMelody = [
      { id: 'n1', midi: 65, step: 0, duration: 4, velocity: 0.8, origin: 'user' }, // F on C major beat 1 -> clash
      { id: 'n2', midi: 67, step: 8, duration: 4, velocity: 0.8, origin: 'user' },
      { id: 'n3', midi: 64, step: 16, duration: 8, velocity: 0.8, origin: 'user' },
      { id: 'n4', midi: 72, step: 48, duration: 8, velocity: 0.8, origin: 'user' },
    ];
    const report = analyzeSong(compileSong(p), p);
    const clash = report.issues.find((i) => i.kind === 'clash');
    expect(clash).toBeDefined();

    const fixedProj = clash!.applyFix(p);
    const after = analyzeSong(compileSong(fixedProj), fixedProj);
    expect(after.issues.find((i) => i.kind === 'clash')).toBeUndefined();
  });

  it('catches out-of-scale note, narrow range, monotone rhythm, and weak cadence', () => {
    const minSpan = PRESETS.analyzerThresholds.minRangeSemitones;
    const p = createDefaultProject();
    p.baked = true;
    p.bakedMelody = [
      { id: 'n1', midi: 61, step: 0, duration: 4, velocity: 0.8 }, // C# out of C major
      { id: 'n2', midi: 62, step: 4, duration: 4, velocity: 0.8 },
      { id: 'n3', midi: 62, step: 8, duration: 4, velocity: 0.8 },
      { id: 'n4', midi: 62, step: 12, duration: 4, velocity: 0.8 },
      { id: 'n5', midi: 62, step: 16, duration: 4, velocity: 0.8 },
      { id: 'n6', midi: 62, step: 20, duration: 4, velocity: 0.8 },
      { id: 'n7', midi: 62, step: 48, duration: 4, velocity: 0.8 }, // D (2nd degree) -> weak cadence
    ];
    expect(minSpan).toBeGreaterThan(1);

    const report = analyzeSong(compileSong(p), p);
    const kinds = new Set(report.issues.map((i) => i.kind));
    expect(kinds.has('narrow_range')).toBe(true);
    expect(kinds.has('monotone_rhythm')).toBe(true);
    expect(kinds.has('weak_cadence')).toBe(true);

    // 약한 종지 수정 적용 시 종지 경고 사라짐
    const cadFix = report.issues.find((i) => i.kind === 'weak_cadence')!;
    const fixedCad = cadFix.applyFix(p);
    const afterCad = analyzeSong(compileSong(fixedCad), fixedCad);
    expect(afterCad.issues.find((i) => i.kind === 'weak_cadence')).toBeUndefined();
  });

  it('does not flag borrowed chord tones as out_of_scale', () => {
    const p = createDefaultProject();
    p.chain.chords[3].degree = 'iv'; // Fm (F, Ab, C)
    p.baked = true;
    p.bakedMelody = [
      { id: 'n1', midi: 64, step: 0, duration: 8, velocity: 0.8 },
      { id: 'n2', midi: 67, step: 16, duration: 8, velocity: 0.8 },
      { id: 'n3', midi: 69, step: 32, duration: 8, velocity: 0.8 },
      { id: 'n4', midi: 68, step: 48, duration: 4, velocity: 0.8 }, // Ab4 (chord tone of Fm)
      { id: 'n5', midi: 60, step: 56, duration: 8, velocity: 0.8 }, // C4 tonic resolve
    ];
    const report = analyzeSong(compileSong(p), p);
    expect(report.issues.find((i) => i.kind === 'out_of_scale')).toBeUndefined();
  });

  it('catches non-clashing out_of_scale note and resolves it via applyFix', () => {
    const p = createDefaultProject();
    p.baked = true;
    p.bakedMelody = [
      { id: 'n1', midi: 64, step: 0, duration: 2, velocity: 0.8 },
      { id: 'n2', midi: 70, step: 2, duration: 2, velocity: 0.8 }, // Bb4 on C major weak beat -> out_of_scale
      { id: 'n3', midi: 67, step: 16, duration: 8, velocity: 0.8 },
      { id: 'n4', midi: 69, step: 32, duration: 8, velocity: 0.8 },
      { id: 'n5', midi: 60, step: 48, duration: 12, velocity: 0.8 },
    ];
    const report = analyzeSong(compileSong(p), p);
    const outIssue = report.issues.find((i) => i.kind === 'out_of_scale');
    expect(outIssue).toBeDefined();

    const fixed = outIssue!.applyFix(p);
    const after = analyzeSong(compileSong(fixed), fixed);
    expect(after.issues.find((i) => i.kind === 'out_of_scale')).toBeUndefined();
  });

  it('resolves monotone_rhythm on dense 8th-note melody and no_breathing_room when step 12 is short', () => {
    // 1) 모든 음표가 2스텝(8분음표)으로 꽉 찬 멜로디 -> monotone_rhythm 해소 확인
    const pMono = createDefaultProject();
    pMono.baked = true;
    pMono.bakedMelody = Array.from({ length: 32 }, (_, idx) => ({
      id: `m_${idx}`,
      midi: idx % 2 === 0 ? 64 : 67,
      step: idx * 2,
      duration: 2,
      velocity: 0.8,
    }));
    const monoReport = analyzeSong(compileSong(pMono), pMono);
    const monoIssue = monoReport.issues.find((i) => i.kind === 'monotone_rhythm');
    expect(monoIssue).toBeDefined();
    const monoFixed = monoIssue!.applyFix(pMono);
    const monoAfter = analyzeSong(compileSong(monoFixed), monoFixed);
    expect(monoAfter.issues.find((i) => i.kind === 'monotone_rhythm')).toBeUndefined();

    // 2) 다양한 길이로 64스텝이 꽉 차 있고 step 12가 2칸인 멜로디 -> no_breathing_room 해소 확인
    const pRest = createDefaultProject();
    pRest.baked = true;
    pRest.bakedMelody = [];
    let cursor = 0;
    let seq = 0;
    while (cursor < 64) {
      const local = cursor % 16;
      const dur = local === 12 ? 2 : local === 14 ? 2 : local === 0 ? 6 : local === 6 ? 4 : 2;
      pRest.bakedMelody.push({
        id: `r_${seq++}`,
        midi: seq % 2 === 0 ? 64 : 67,
        step: cursor,
        duration: Math.min(dur, 64 - cursor),
        velocity: 0.8,
      });
      cursor += dur;
    }
    const restReport = analyzeSong(compileSong(pRest), pRest);
    const restIssue = restReport.issues.find((i) => i.kind === 'no_breathing_room');
    expect(restIssue).toBeDefined();
    const restFixed = restIssue!.applyFix(pRest);
    const restAfter = analyzeSong(compileSong(restFixed), restFixed);
    expect(restAfter.issues.find((i) => i.kind === 'no_breathing_room')).toBeUndefined();
  });
});
