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
});
