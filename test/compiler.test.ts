import { describe, expect, it } from 'vitest';
import {
  bakeProjectMelody,
  clearPreviewCache,
  compileSong,
  getPreviewCacheStats,
  previewModifierDiff,
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
});
