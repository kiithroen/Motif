// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { CoachController } from '../src/app/coachController';
import { COACH_CONFIG } from '../src/core/coachPatch';
import { compileSong, unpackBlocksToChain } from '../src/core/compiler';
import { cloneProject, createDefaultProject } from '../src/core/model';
import { computeSongDiff } from '../src/core/songDiff';
import { renderLayerEditor } from '../src/ui/layers';

describe('miniPianoRoll and visualDiff integration', () => {
  it('renders live mini piano roll in L1 and L2 and highlights visualDiff', () => {
    const container = document.createElement('div');
    const beforeProj = createDefaultProject();
    beforeProj.activeLayer = 'L1';
    const afterProj = cloneProject(beforeProj);
    afterProj.blocks.progressionId = afterProj.blocks.progressionId === 'canon' ? 'pop_4' : 'canon';
    afterProj.chain = unpackBlocksToChain(afterProj.blocks, afterProj.bars, afterProj.chain.modifiers);

    const beforeCompiled = compileSong(beforeProj);
    const afterCompiled = compileSong(afterProj);
    const diff = computeSongDiff(beforeCompiled, afterCompiled, { label: '코드 진행 변경' });
    const onSeekBar = vi.fn();

    renderLayerEditor(container, afterProj, afterCompiled, 0, {
      selectedDuration: 4,
      visualDiff: diff,
      onSelectDuration: vi.fn(),
      onProjectChange: vi.fn(),
      onAuditionPitch: vi.fn(),
      onPreviewModifier: vi.fn(),
      onSeekBar,
    });

    expect(container.querySelector('.mini-pr-card')).not.toBeNull();
    expect(container.querySelector('.mini-pr-svg')).not.toBeNull();
    expect(container.querySelector('.mini-pr-track-legend')?.textContent).toContain('베이스');
    expect(container.querySelector('.mini-pr-diff-bar')?.textContent).toContain('코드 진행 변경');

    const firstBar = container.querySelector<SVGRectElement>('[data-mini-bar="2"]');
    firstBar?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onSeekBar).toHaveBeenCalledWith(2);

    // L2 also renders mini piano roll
    afterProj.activeLayer = 'L2';
    renderLayerEditor(container, afterProj, afterCompiled, 0, {
      selectedDuration: 4,
      visualDiff: diff,
      onSelectDuration: vi.fn(),
      onProjectChange: vi.fn(),
      onAuditionPitch: vi.fn(),
      onPreviewModifier: vi.fn(),
    });
    expect(container.querySelector('.mini-pr-card')).not.toBeNull();
  });

  it('renders visualDiff badge and removed ghost notes in L3', () => {
    const container = document.createElement('div');
    const beforeProj = createDefaultProject();
    beforeProj.activeLayer = 'L3';
    beforeProj.baked = true;
    beforeProj.bakedMelody = [
      { id: 'm1', step: 0, midi: 61, duration: 8, velocity: 0.9, origin: 'user' },
    ];
    const afterProj = cloneProject(beforeProj);
    afterProj.bakedMelody = [
      { id: 'm1', step: 0, midi: 60, duration: 8, velocity: 0.9, origin: 'user' },
    ];

    const diff = computeSongDiff(compileSong(beforeProj), compileSong(afterProj), {
      label: '코치 적용',
    });

    renderLayerEditor(container, afterProj, compileSong(afterProj), 0, {
      selectedDuration: 4,
      visualDiff: diff,
      onSelectDuration: vi.fn(),
      onProjectChange: vi.fn(),
      onAuditionPitch: vi.fn(),
      onPreviewModifier: vi.fn(),
    });

    expect(container.querySelector('.pr-diff-badge')?.textContent).toContain('코치 적용');
    expect(container.querySelector('.legend .swatch-diff-changed')).not.toBeNull();
    expect(container.querySelector('.legend .swatch-diff-removed')).not.toBeNull();
    expect(container.querySelector('.pr-note.is-diff-changed')).not.toBeNull();
    expect(container.querySelector('.pr-diff-removed-note')).not.toBeNull();
  });

  it('keeps activeLayer and sends changeLabel when applying coach issue fix', () => {
    const project = createDefaultProject();
    project.activeLayer = 'L2';
    project.baked = true;
    project.bakedMelody = [
      { id: 'm1', step: 0, midi: 61, duration: 8, velocity: 0.9, origin: 'user' },
    ];
    const compiled = compileSong(project);
    const onPreviewVisualDiff = vi.fn();
    const onApplyProject = vi.fn();

    const controller = new CoachController({
      getProject: () => project,
      getCompiled: () => compiled,
      getChordView: () => 'piano',
      isBasicsMode: () => false,
      playOncePreview: vi.fn(),
      onPreviewVisualDiff,
      onApplyProject,
      onRenderDynamicParts: vi.fn(),
      onRenderTopControls: vi.fn(),
      onRenderCoach: vi.fn(),
      loadSettings: () => ({ apiKey: '', model: COACH_CONFIG.defaultModel }),
      saveSettings: vi.fn(),
    });

    const callbacks = controller.createCallbacks();
    const fakeIssue = {
      id: 'issue_clash',
      kind: 'clash' as const,
      severity: 'warn' as const,
      bar: 1,
      title: '1마디 화음 충돌음 1개',
      explanation: 'test',
      affectedNoteIds: ['m1'],
      applyFix: (p: typeof project) => {
        const next = cloneProject(p);
        next.bakedMelody[0].midi = 60;
        return next;
      },
    };

    callbacks.onPreviewIssueFix(fakeIssue);
    expect(onPreviewVisualDiff).toHaveBeenCalledTimes(1);

    callbacks.onApplyIssueFix(fakeIssue);
    expect(onApplyProject).toHaveBeenCalledTimes(1);
    const [appliedProj, label] = onApplyProject.mock.calls[0];
    expect(appliedProj.activeLayer).toBe('L2');
    expect(label).toContain('코치 적용');
  });
});
