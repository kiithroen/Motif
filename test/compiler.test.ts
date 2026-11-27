import { describe, expect, it } from 'vitest';
import {
  bakeProjectMelody,
  compileSong,
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
});
