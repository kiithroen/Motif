import { describe, expect, it } from 'vitest';
import {
  bakeProjectMelody,
  clearPreviewCache,
  compileSong,
  duplicateAToBWithVariation,
  getPreviewCacheStats,
  previewModifierDiff,
  resizeProjectBars,
  resolveChordAtStep,
  unpackBlocksToChain,
} from '../src/core/compiler';
import { PRESETS, createDefaultProject } from '../src/core/model';

describe('3-tier song compiler', () => {
  it('is deterministic for the same seed and changes when seed changes', () => {
    const p1 = createDefaultProject();
    const p2 = createDefaultProject();
    const c1 = compileSong(p1);
    const c2 = compileSong(p2);
    expect(c1.melody.map((n) => [n.step, n.midi, n.duration])).toEqual(
      c2.melody.map((n) => [n.step, n.midi, n.duration])
    );

    const p3 = { ...p1, seed: p1.seed + 1 };
    const c3 = compileSong(p3);
    expect(c3.melody.map((n) => n.midi)).not.toEqual(c1.melody.map((n) => n.midi));
  });

  it('unpacks L1 progression blocks cleanly to 4 or 8 bars', () => {
    const p = createDefaultProject();
    const chain8 = unpackBlocksToChain(p.blocks, 8);
    expect(chain8.chords).toHaveLength(8);
    expect(chain8.chords.map((c) => c.degree)).toEqual(['I', 'V', 'vi', 'IV', 'I', 'V', 'vi', 'IV']);
  });

  it('applies each L2 modifier and shows audible note differences', () => {
    const p = createDefaultProject();

    const modalDiff = previewModifierDiff(p, 'modal_borrow');
    expect(modalDiff.after.resolvedChords[3].degree).toBe('iv');
    expect(modalDiff.before.resolvedChords[3].degree).toBe('IV');

    const syncDiff = previewModifierDiff(p, 'syncopation');
    expect(syncDiff.changedCount + syncDiff.addedCount + syncDiff.removedCount).toBeGreaterThan(0);

    const liftDiff = previewModifierDiff(p, 'octave_lift');
    const maxBefore = Math.max(...liftDiff.before.melody.map((n) => n.midi));
    const maxAfter = Math.max(...liftDiff.after.melody.map((n) => n.midi));
    expect(maxAfter).toBeGreaterThanOrEqual(maxBefore);
  });

  it('preserves user edits once baked into L3', () => {
    const p = bakeProjectMelody(createDefaultProject());
    expect(p.baked).toBe(true);
    p.bakedMelody[0] = { ...p.bakedMelody[0], midi: 79, origin: 'user' };
    const c = compileSong(p);
    expect(c.melody[0].midi).toBe(79);
    expect(c.melody[0].origin).toBe('user');
  });

  it('uses groove pianoPattern in piano mode and chordStrums in guitar mode', () => {
    for (const groove of PRESETS.grooves) {
      const p = createDefaultProject();
      p.bars = 4;
      p.blocks.grooveId = groove.id;

      const pianoComp = compileSong(p, 'piano');
      const guitarComp = compileSong(p, 'guitar');

      const bar0PianoSteps = [...new Set(pianoComp.chords.filter((c) => c.step < 16).map((c) => c.step))];
      const bar0GuitarSteps = [...new Set(guitarComp.chords.filter((c) => c.step < 16).map((c) => c.step))];

      const expectedPianoSteps = (groove.pianoPattern ?? groove.chordStrums).map((s) => s.step);
      const expectedGuitarSteps = groove.chordStrums.map((s) => s.step);

      expect(bar0PianoSteps).toEqual(expectedPianoSteps);
      expect(bar0GuitarSteps).toEqual(expectedGuitarSteps);
    }
  });

  it('caches modifier diffs without diverging from direct compileSong output', () => {
    clearPreviewCache();
    const base = createDefaultProject();
    base.bars = 8;
    base.chain = unpackBlocksToChain(base.blocks, 8);
    // 일부 변형을 미리 켜 둔 상태와 끈 상태 모두 검증한다.
    base.chain.modifiers = base.chain.modifiers.map((m, i) => ({
      ...m,
      enabled: i % 2 === 0,
    }));

    for (const meta of PRESETS.modifiers) {
      const diff = previewModifierDiff(base, meta.id, 'guitar');

      const offProj = {
        ...base,
        baked: false,
        chain: {
          ...base.chain,
          modifiers: base.chain.modifiers.map((m) =>
            m.id === meta.id ? { ...m, enabled: false } : { ...m }
          ),
        },
      };
      const onProj = {
        ...base,
        baked: false,
        chain: {
          ...base.chain,
          modifiers: base.chain.modifiers.map((m) =>
            m.id === meta.id ? { ...m, enabled: true } : { ...m }
          ),
        },
      };

      const directBefore = compileSong(offProj, 'guitar');
      const directAfter = compileSong(onProj, 'guitar');

      expect(diff.before.melody).toEqual(directBefore.melody);
      expect(diff.after.melody).toEqual(directAfter.melody);
      expect(diff.before.resolvedChords).toEqual(directBefore.resolvedChords);
      expect(diff.after.resolvedChords).toEqual(directAfter.resolvedChords);
    }

    const afterFirstPass = getPreviewCacheStats();
    expect(afterFirstPass.misses).toBe(PRESETS.modifiers.length);
    // 기준 1회 + modal_borrow 반대 상태 1회만 full compile 된다.
    expect(afterFirstPass.fullCompiles).toBe(2);

    // 동일 상태 및 캐시 무관 필드(bpm/activeLayer/baked)만 바꾼 반복 호출은 전부 히트한다.
    const sameWithUiOnlyChange = {
      ...base,
      bpm: base.bpm + 12,
      activeLayer: 'L3' as const,
      baked: true,
    };
    for (const meta of PRESETS.modifiers) {
      previewModifierDiff(sameWithUiOnlyChange, meta.id, 'guitar');
    }
    const afterHits = getPreviewCacheStats();
    expect(afterHits.hits).toBe(PRESETS.modifiers.length);
    expect(afterHits.misses).toBe(afterFirstPass.misses);
    expect(afterHits.fullCompiles).toBe(afterFirstPass.fullCompiles);

    // seed 변경 시 캐시 키가 달라져 미스가 발생한다.
    const nextSeed = { ...base, seed: base.seed + 1 };
    previewModifierDiff(nextSeed, PRESETS.modifiers[0].id, 'guitar');
    expect(getPreviewCacheStats().misses).toBe(afterFirstPass.misses + 1);
  });

  it('supports 16-bar expansion, A-to-B variation, and 2-chord split bars', () => {
    const base = createDefaultProject();
    const proj16 = resizeProjectBars(base, 16);
    expect(proj16.bars).toBe(16);
    expect(proj16.chain.chords).toHaveLength(16);

    const varied = duplicateAToBWithVariation(proj16);
    expect(varied.bars).toBe(16);
    expect(varied.chain.chords[8].degree).toBe(varied.chain.chords[0].degree);
    expect(varied.chain.chords[14].extension).toBe('sus4');

    varied.chain.chords[0] = {
      bar: 0,
      degree: 'I',
      extension: 'add9',
      halfDegree: 'V',
      halfInversion: 1,
    };
    const compiled = compileSong(varied, 'piano');
    expect(compiled.totalSteps).toBe(256);
    expect(compiled.resolvedChords[0].symbol).toBe('Cadd9');
    expect(compiled.resolvedHalfChords[0]?.symbol).toBe('G/B');
    expect(resolveChordAtStep(compiled, 0).symbol).toBe('Cadd9');
    expect(resolveChordAtStep(compiled, 8).symbol).toBe('G/B');

    const bar0BassFirst = compiled.bass.find((b) => b.step === 0);
    const bar0BassSecond = compiled.bass.find((b) => b.step === 8);
    expect(bar0BassFirst!.midi % 12).toBe(0); // C
    expect(bar0BassSecond!.midi % 12).toBe(11); // B (G/B)
  });

  it('compiles customDrums with fill-in, bakedBass, bakedChords, and polyphonic melody', () => {
    const p = createDefaultProject();
    p.bars = 4;
    p.baked = true;
    p.bakedMelody = [
      { id: 'm1', midi: 64, step: 0, duration: 4, velocity: 0.8, origin: 'user' },
      { id: 'm2', midi: 67, step: 0, duration: 4, velocity: 0.8, origin: 'user' },
    ];
    p.bakedBass = [{ id: 'b1', midi: 36, step: 0, duration: 4, velocity: 0.8, origin: 'user' }];
    p.bakedChords = [
      { id: 'c1', midi: 60, step: 0, duration: 8, velocity: 0.7, origin: 'user' },
      { id: 'c2', midi: 64, step: 0, duration: 8, velocity: 0.7, origin: 'user' },
    ];
    p.customDrums = {
      kicks: [0, 8],
      snares: [4, 12],
      hats: [0, 4, 8, 12],
      claps: [4],
      fillEnabled: true,
      fillSteps: [
        { kind: 'snare', step: 12 },
        { kind: 'clap', step: 15 },
      ],
    };

    const compiled = compileSong(p);
    // 폴리포니 멜로디 두 음이 모두 보존된다.
    expect(compiled.melody.filter((n) => n.step === 0).map((n) => n.midi)).toEqual([64, 67]);
    expect(compiled.bass).toHaveLength(1);
    expect(compiled.chords).toHaveLength(2);
    // 4마디째(bar=3, step>=48)에는 fillSteps(12+48=60 snare, 15+48=63 clap)가 적용된다.
    expect(compiled.drums.some((d) => d.kind === 'clap' && d.step === 4)).toBe(true);
    expect(compiled.drums.some((d) => d.kind === 'clap' && d.step === 63)).toBe(true);
  });
});
