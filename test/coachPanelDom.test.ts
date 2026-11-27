// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeSong } from '../src/core/analyzer';
import { COACH_CONFIG } from '../src/core/coachPatch';
import { compileSong } from '../src/core/compiler';
import { createDefaultProject } from '../src/core/model';
import { type CoachCallbacks, type GeminiCoachUiState, renderCoachPanel } from '../src/ui/coachPanel';

function makeCallbacks(): CoachCallbacks {
  return {
    onPreviewIssueFix: vi.fn(),
    onApplyIssueFix: vi.fn(),
    onToggleGeminiSettings: vi.fn(),
    onSaveGeminiSettings: vi.fn(),
    onClearGeminiKey: vi.fn(),
    onPromptChange: vi.fn(),
    onExplainReport: vi.fn(),
    onSubmitPrompt: vi.fn(),
    onCancelGemini: vi.fn(),
    onPreviewGeminiPatch: vi.fn(),
    onApplyGeminiPatch: vi.fn(),
    onDismissGeminiSuggestion: vi.fn(),
  };
}

function makeUiState(overrides: Partial<GeminiCoachUiState> = {}): GeminiCoachUiState {
  return {
    hasApiKey: false,
    maskedKey: '',
    selectedModel: COACH_CONFIG.defaultModel,
    settingsOpen: false,
    promptDraft: '',
    loading: false,
    error: null,
    suggestion: null,
    activePreview: null,
    ...overrides,
  };
}

describe('coachPanel DOM interactions and Gemini UI', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="coach-mount"></div>';
    container = document.getElementById('coach-mount')!;
  });

  it('renders missing-key status and saves settings form values', () => {
    const project = createDefaultProject();
    const report = analyzeSong(compileSong(project), project);
    const callbacks = makeCallbacks();
    const nextModel = COACH_CONFIG.models[1]?.id ?? COACH_CONFIG.defaultModel;

    renderCoachPanel(
      container,
      report,
      makeUiState({ settingsOpen: true }),
      callbacks
    );

    expect(container.querySelector('.gemini-status')?.textContent?.trim()).toBe('키 필요');

    const keyInput = container.querySelector<HTMLInputElement>('#gemini-api-key-input')!;
    const modelSel = container.querySelector<HTMLSelectElement>('#gemini-model-select')!;
    keyInput.value = 'AIzaTestKey1234';
    modelSel.value = nextModel;

    container.querySelector<HTMLButtonElement>('#btn-gemini-save')!.click();
    expect(callbacks.onSaveGeminiSettings).toHaveBeenCalledWith('AIzaTestKey1234', nextModel);
  });

  it('triggers quick prompt chips, explain button, and natural language submission', () => {
    const project = createDefaultProject();
    const report = analyzeSong(compileSong(project), project);
    const callbacks = makeCallbacks();
    const firstQuick = COACH_CONFIG.quickPrompts[0];

    renderCoachPanel(
      container,
      report,
      makeUiState({ hasApiKey: true, maskedKey: 'AIza...1234' }),
      callbacks
    );

    expect(container.querySelector('.gemini-status')?.textContent?.trim()).toBe('연결됨');

    container.querySelector<HTMLButtonElement>('#btn-gemini-explain')!.click();
    expect(callbacks.onExplainReport).toHaveBeenCalledTimes(1);

    container.querySelector<HTMLButtonElement>(`[data-gemini-quick="${firstQuick.id}"]`)!.click();
    expect(callbacks.onSubmitPrompt).toHaveBeenCalledWith(firstQuick.prompt);

    const textarea = container.querySelector<HTMLTextAreaElement>('#gemini-prompt-input')!;
    textarea.value = '후반부를 밝게 바꿔 줘';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(callbacks.onPromptChange).toHaveBeenCalledWith('후반부를 밝게 바꿔 줘');

    container.querySelector<HTMLButtonElement>('#btn-gemini-submit')!.click();
    expect(callbacks.onSubmitPrompt).toHaveBeenCalledWith('후반부를 밝게 바꿔 줘');
  });

  it('renders suggestion card with Before/After preview, apply, dismiss, and escapes HTML', () => {
    const project = createDefaultProject();
    const patched = createDefaultProject();
    patched.bpm = 82;
    const report = analyzeSong(compileSong(project), project);
    const callbacks = makeCallbacks();

    renderCoachPanel(
      container,
      report,
      makeUiState({
        hasApiKey: true,
        maskedKey: 'AIza...1234',
        activePreview: 'after',
        suggestion: {
          headline: '<script>alert(1)</script>부드러운 편곡',
          explanation: '<b>차분한</b> 느낌으로 템포를 낮췄습니다.',
          theoryTip: 'BPM을 낮추면 여백이 들립니다.',
          patchSummary: '템포 조절',
          changeDescriptions: ['빠르기(BPM): 96 → 82'],
          warnings: [],
          patchedProject: patched,
          applied: false,
        },
      }),
      callbacks
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('.gemini-result-head strong')?.textContent).toContain('<script>alert(1)</script>');

    const beforeBtn = container.querySelector<HTMLButtonElement>('[data-gemini-preview="before"]')!;
    const afterBtn = container.querySelector<HTMLButtonElement>('[data-gemini-preview="after"]')!;
    expect(afterBtn.classList.contains('active')).toBe(true);

    beforeBtn.click();
    afterBtn.click();
    expect(callbacks.onPreviewGeminiPatch).toHaveBeenNthCalledWith(1, false);
    expect(callbacks.onPreviewGeminiPatch).toHaveBeenNthCalledWith(2, true);

    container.querySelector<HTMLButtonElement>('#btn-gemini-apply')!.click();
    expect(callbacks.onApplyGeminiPatch).toHaveBeenCalledTimes(1);

    container.querySelector<HTMLButtonElement>('#btn-gemini-dismiss')!.click();
    expect(callbacks.onDismissGeminiSuggestion).toHaveBeenCalledTimes(1);
  });
});
