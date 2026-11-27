import { describe, expect, it } from 'vitest';
import { analyzeSong } from '../src/core/analyzer';
import { compileSong } from '../src/core/compiler';
import { createDefaultProject, cloneProject } from '../src/core/model';
import { computeSongDiff } from '../src/core/songDiff';

describe('computeSongDiff', () => {
  it('reports no change for identical compiled songs', () => {
    const project = createDefaultProject();
    const compiled = compileSong(project);
    const diff = computeSongDiff(compiled, compiled);

    expect(diff.hasAnyChange).toBe(false);
    expect(diff.addedCount).toBe(0);
    expect(diff.removedCount).toBe(0);
    expect(diff.changedCount).toBe(0);
    expect(diff.chordChanges).toHaveLength(0);
  });

  it('detects chord and accompaniment changes when L2 chord degree changes', () => {
    const beforeProj = createDefaultProject();
    const afterProj = cloneProject(beforeProj);
    afterProj.chain.chords[1].degree = 'IV';

    const before = compileSong(beforeProj);
    const after = compileSong(afterProj);
    const diff = computeSongDiff(before, after, { label: '2마디 코드 변경' });

    expect(diff.hasAnyChange).toBe(true);
    expect(diff.changedChordBars.has(1)).toBe(true);
    expect(diff.chordChanges[0]).toMatchObject({ bar: 1 });
    expect(diff.changedAccompBars.has(1)).toBe(true);
    expect(diff.summaryText).toContain('2마디');
  });

  it('detects exact melody note movement from analyzer issue fix', () => {
    const project = createDefaultProject();
    project.baked = true;
    project.bakedMelody = [
      { id: 'n1', step: 0, midi: 61, duration: 8, velocity: 0.9, origin: 'user' },
    ];
    const before = compileSong(project);
    const report = analyzeSong(before, project);
    const clashIssue = report.issues.find((i) => i.kind === 'clash');
    expect(clashIssue).toBeDefined();

    const fixedProj = clashIssue!.applyFix(project);
    const after = compileSong(fixedProj);
    const diff = computeSongDiff(before, after, { label: '코치 적용', mode: 'applied' });

    expect(diff.hasAnyChange).toBe(true);
    expect(diff.changedCount).toBe(1);
    expect(diff.changedMelodyIds.has('n1')).toBe(true);
    expect(diff.removedMelodyNotes).toHaveLength(1);
    expect(diff.summaryText).toContain('멜로디');
  });
});
