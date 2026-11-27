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
    onOpenManualEditLayer: vi.fn(),
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

describe('coachPanel DOM interactions and read-only Gemini tutor UI', () => {
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
    expect(container.querySelector('.gemini-policy-note')?.textContent).toContain('직접 바꾸지 않고');

    const keyInput = container.querySelector<HTMLInputElement>('#gemini-api-key-input')!;
    const modelSel = container.querySelector<HTMLSelectElement>('#gemini-model-select')!;
    keyInput.value = 'AIzaTestKey1234';
    modelSel.value = nextModel;

    container.querySelector<HTMLButtonElement>('#btn-gemini-save')!.click();
    expect(callbacks.onSaveGeminiSettings).toHaveBeenCalledWith('AIzaTestKey1234', nextModel);
  });

  it('triggers quick prompt chips, explain button, and natural language question submission', () => {
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
    textarea.value = '왜 2마디가 어색하게 들려?';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(callbacks.onPromptChange).toHaveBeenCalledWith('왜 2마디가 어색하게 들려?');

    container.querySelector<HTMLButtonElement>('#btn-gemini-submit')!.click();
    expect(callbacks.onSubmitPrompt).toHaveBeenCalledWith('왜 2마디가 어색하게 들려?');
  });

  it('renders manualSteps and comparison preview without any auto-apply button, escaping HTML', () => {
    const project = createDefaultProject();
    const demo = createDefaultProject();
    demo.chain.chords[3].degree = 'iv';
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
          headline: '<script>alert(1)</script>4마디 모달 인터체인지',
          explanation: '<b>IV를 iv로</b> 바꾸면 여운이 살아납니다.',
          theoryTip: '같은 뿌리 단조 화음 차용 기법입니다.',
          manualSteps: ['L2 변형 체인에서 4마디를 iv로 직접 바꿔 보세요.'],
          patchSummary: '4마디 IV → iv 및 멜로디 비교 예시',
          changeDescriptions: ['마디 코드 예시: 4마디 IV→iv', '멜로디 예시 (4마디): 레(D5) → 도(C5)'],
          warnings: [],
          demoProject: demo,
          hasHarmonyDemo: true,
          hasMelodyDemo: true,
        },
      }),
      callbacks
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('.gemini-result-head strong')?.textContent).toContain('<script>alert(1)</script>');
    expect(container.querySelector('#btn-gemini-apply')).toBeNull();
    expect(container.querySelectorAll('.gemini-manual-list li').length).toBe(1);

    const beforeBtn = container.querySelector<HTMLButtonElement>('[data-gemini-preview="before"]')!;
    const afterBtn = container.querySelector<HTMLButtonElement>('[data-gemini-preview="after"]')!;
    expect(afterBtn.classList.contains('active')).toBe(true);

    beforeBtn.click();
    afterBtn.click();
    expect(callbacks.onPreviewGeminiPatch).toHaveBeenNthCalledWith(1, false);
    expect(callbacks.onPreviewGeminiPatch).toHaveBeenNthCalledWith(2, true);

    container.querySelector<HTMLButtonElement>('[data-gemini-open-layer="L2"]')!.click();
    container.querySelector<HTMLButtonElement>('[data-gemini-open-layer="L3"]')!.click();
    expect(callbacks.onOpenManualEditLayer).toHaveBeenNthCalledWith(1, 'L2');
    expect(callbacks.onOpenManualEditLayer).toHaveBeenNthCalledWith(2, 'L3');

    container.querySelector<HTMLButtonElement>('#btn-gemini-dismiss')!.click();
    expect(callbacks.onDismissGeminiSuggestion).toHaveBeenCalledTimes(1);
  });
});
