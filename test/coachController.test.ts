// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { CoachController } from '../src/app/coachController';
import { COACH_CONFIG } from '../src/core/coachPatch';
import { compileSong } from '../src/core/compiler';
import { createDefaultProject } from '../src/core/model';

describe('CoachController', () => {
  it('opens settings with validation error when API key is missing', async () => {
    const project = createDefaultProject();
    const compiled = compileSong(project);
    const onRenderCoach = vi.fn();

    const controller = new CoachController({
      getProject: () => project,
      getCompiled: () => compiled,
      getChordView: () => 'piano',
      isBasicsMode: () => false,
      playOncePreview: vi.fn(),
      onApplyProject: vi.fn(),
      onRenderDynamicParts: vi.fn(),
      onRenderTopControls: vi.fn(),
      onRenderCoach,
      loadSettings: () => ({ apiKey: '', model: COACH_CONFIG.defaultModel }),
      saveSettings: vi.fn(),
    });

    await controller.runRequest('request', '4마디 코드를 바꾸고 싶어');
    const ui = controller.getUiState();
    expect(ui.settingsOpen).toBe(true);
    expect(ui.error).toContain('API 키');
    expect(ui.promptDraft).toBe('4마디 코드를 바꾸고 싶어');
    expect(onRenderCoach).toHaveBeenCalled();
  });

  it('builds suggestion, visualDiff, preview playback, and handles transport stop', async () => {
    const project = createDefaultProject();
    const compiled = compileSong(project);
    const playOncePreview = vi.fn();
    const onRenderDynamicParts = vi.fn();
    const onRenderTopControls = vi.fn();
    const onRenderCoach = vi.fn();

    const requestCoach = vi.fn(async () => ({
      model: COACH_CONFIG.defaultModel,
      warnings: [],
      response: {
        headline: '4마디를 iv로 바꿔 여운 주기',
        explanation: '4마디 IV를 같은 루트의 단화음 iv로 바꾸면 차분한 여운이 생긴다.',
        theoryTip: '모달 인터체인지 예시',
        manualSteps: ['L2에서 4마디를 iv로 바꿔 본다.'],
        patchSummary: '4마디 IV → iv',
        patch: {
          chords: [{ bar: 4, degree: 'iv' as const }],
        },
      },
    }));

    const controller = new CoachController({
      getProject: () => project,
      getCompiled: () => compiled,
      getChordView: () => 'piano',
      isBasicsMode: () => false,
      playOncePreview,
      onApplyProject: vi.fn(),
      onRenderDynamicParts,
      onRenderTopControls,
      onRenderCoach,
      loadSettings: () => ({ apiKey: 'AIzaTest12345678', model: COACH_CONFIG.defaultModel }),
      saveSettings: vi.fn(),
      requestCoach,
    });

    await controller.runRequest('request', '4마디 여운');
    expect(requestCoach).toHaveBeenCalledTimes(1);
    const ui = controller.getUiState();
    expect(ui.loading).toBe(false);
    expect(ui.promptDraft).toBe('');
    expect(ui.history).toHaveLength(1);
    expect(ui.suggestion?.hasHarmonyDemo).toBe(true);
    expect(controller.getVisualCompare()?.changedChordBars[0]).toMatchObject({
      bar: 3,
      afterDegree: 'iv',
    });

    const callbacks = controller.createCallbacks();
    callbacks.onPreviewGeminiPatch(true);
    expect(controller.isComparePreviewActive()).toBe(true);
    expect(playOncePreview).toHaveBeenCalledTimes(1);

    const coachEl = document.createElement('div');
    coachEl.innerHTML = '<button data-gemini-preview="after" class="active"></button>';
    controller.handleTransportStop(coachEl);
    expect(controller.isComparePreviewActive()).toBe(false);
    expect(coachEl.querySelector('[data-gemini-preview]')?.classList.contains('active')).toBe(false);

    controller.dismissVisualCompare();
    expect(controller.getVisualCompare()).toBeNull();

    controller.invalidateSuggestion();
    expect(controller.getUiState().suggestion).toBeNull();
  });
});
