import {
  type GeminiCoachSettings,
  loadGeminiSettings,
  maskApiKey,
  requestGeminiCoach,
  saveGeminiSettings,
} from '../ai/geminiCoach';
import { type DiagnosisReport, analyzeSong } from '../core/analyzer';
import {
  type CoachVisualDiff,
  applyCoachPatch,
  buildCoachVisualDiff,
  describeCoachPatch,
  trimCoachHistory,
} from '../core/coachPatch';
import { type CompiledSong, compileSong } from '../core/compiler';
import { type ChordInstrument, type SongProject, cloneProject } from '../core/model';
import type { CoachCallbacks, GeminiCoachUiState } from '../ui/coachPanel';

export interface CoachControllerDeps {
  getProject: () => SongProject;
  getCompiled: () => CompiledSong;
  getChordView: () => ChordInstrument;
  isBasicsMode: () => boolean;
  playOncePreview: (compiled: CompiledSong) => void;
  onPreviewVisualDiff?: (previewCompiled: CompiledSong, label: string) => void;
  onApplyProject: (next: SongProject, changeLabel?: string) => void;
  onRenderDynamicParts: () => void;
  onRenderTopControls: () => void;
  onRenderCoach: (report?: DiagnosisReport) => void;
  requestCoach?: typeof requestGeminiCoach;
  loadSettings?: typeof loadGeminiSettings;
  saveSettings?: typeof saveGeminiSettings;
}

export class CoachController {
  private readonly deps: CoachControllerDeps;
  private readonly loadSettingsFn: typeof loadGeminiSettings;
  private readonly saveSettingsFn: typeof saveGeminiSettings;
  private readonly requestCoachFn: typeof requestGeminiCoach;
  private settings: GeminiCoachSettings;
  private abortController: AbortController | null = null;
  private readonly uiState: GeminiCoachUiState;

  constructor(deps: CoachControllerDeps) {
    this.deps = deps;
    this.loadSettingsFn = deps.loadSettings ?? loadGeminiSettings;
    this.saveSettingsFn = deps.saveSettings ?? saveGeminiSettings;
    this.requestCoachFn = deps.requestCoach ?? requestGeminiCoach;
    this.settings = this.loadSettingsFn();
    this.uiState = {
      hasApiKey: Boolean(this.settings.apiKey),
      maskedKey: maskApiKey(this.settings.apiKey),
      selectedModel: this.settings.model,
      settingsOpen: false,
      promptDraft: '',
      loading: false,
      error: null,
      suggestion: null,
      activePreview: null,
      history: [],
      showVisualCompare: true,
    };
  }

  getUiState(): GeminiCoachUiState {
    return this.uiState;
  }

  getVisualCompare(): CoachVisualDiff | null {
    return this.uiState.showVisualCompare ? (this.uiState.suggestion?.visualDiff ?? null) : null;
  }

  isComparePreviewActive(): boolean {
    return this.uiState.activePreview === 'after';
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.uiState.loading = false;
  }

  resetForProjectLoad(): void {
    this.abort();
    this.uiState.error = null;
    this.uiState.suggestion = null;
    this.uiState.activePreview = null;
    this.uiState.history = [];
    this.uiState.showVisualCompare = true;
  }

  invalidateSuggestion(): void {
    this.uiState.suggestion = null;
    this.uiState.activePreview = null;
  }

  handleTransportStop(coachEl: HTMLElement): void {
    if (this.uiState.activePreview === null) return;
    this.uiState.activePreview = null;
    coachEl
      .querySelectorAll<HTMLButtonElement>('[data-gemini-preview]')
      .forEach((btn) => btn.classList.remove('active'));
    if (!this.deps.isBasicsMode()) {
      this.deps.onRenderDynamicParts();
    }
  }

  dismissVisualCompare(): void {
    this.uiState.showVisualCompare = false;
    this.deps.onRenderDynamicParts();
    this.deps.onRenderCoach();
  }

  private syncSettingsMeta(): void {
    this.uiState.hasApiKey = Boolean(this.settings.apiKey);
    this.uiState.maskedKey = maskApiKey(this.settings.apiKey);
    this.uiState.selectedModel = this.settings.model;
  }

  async runRequest(mode: 'explain' | 'request', promptText?: string): Promise<void> {
    if (!this.settings.apiKey.trim()) {
      if (mode === 'request' && promptText) {
        this.uiState.promptDraft = promptText;
      }
      this.uiState.settingsOpen = true;
      this.uiState.error = '먼저 Gemini API 키를 입력하고 저장해 주세요.';
      this.deps.onRenderCoach();
      return;
    }

    const trimmedPrompt = (promptText ?? '').trim();
    if (mode === 'request') {
      if (!trimmedPrompt) {
        this.uiState.error = '원하는 분위기나 수정 요청을 입력해 주세요.';
        this.deps.onRenderCoach();
        return;
      }
      this.uiState.promptDraft = trimmedPrompt;
    }

    this.abort();
    const controller = new AbortController();
    this.abortController = controller;
    this.uiState.loading = true;
    this.uiState.error = null;
    this.uiState.activePreview = null;
    this.deps.onRenderCoach();

    const chordView = this.deps.getChordView();
    const baseSnapshot = cloneProject(this.deps.getProject());
    const baseCompiled = compileSong(baseSnapshot, chordView);
    const baseReport = analyzeSong(baseCompiled, baseSnapshot);

    try {
      const res = await this.requestCoachFn({
        settings: this.settings,
        mode,
        userRequest: trimmedPrompt,
        history: this.uiState.history,
        project: baseSnapshot,
        compiled: baseCompiled,
        report: baseReport,
        signal: controller.signal,
      });

      if (this.abortController !== controller) return;

      let demoProject: SongProject | undefined;
      let changeDescriptions: string[] = [];
      let visualDiff: CoachVisualDiff | undefined;
      if (res.response.patch) {
        const candidate = applyCoachPatch(baseSnapshot, res.response.patch);
        changeDescriptions = describeCoachPatch(baseSnapshot, candidate, res.response.patch);
        if (changeDescriptions.length > 0) {
          demoProject = candidate;
          const demoCompiled = compileSong(candidate, chordView);
          visualDiff = buildCoachVisualDiff(baseCompiled, demoCompiled, res.response.patch);
        }
      }

      this.uiState.showVisualCompare = true;
      this.uiState.suggestion = {
        headline: res.response.headline,
        explanation: res.response.explanation,
        theoryTip: res.response.theoryTip,
        manualSteps: res.response.manualSteps ?? [],
        patchSummary: res.response.patchSummary,
        changeDescriptions,
        warnings: res.warnings,
        demoProject,
        visualDiff,
        hasHarmonyDemo: Boolean(
          res.response.patch?.chords?.length || res.response.patch?.modifiers?.length
        ),
        hasMelodyDemo: Boolean(res.response.patch?.melodyBars?.length),
      };
      this.uiState.history = trimCoachHistory([
        ...this.uiState.history,
        {
          mode,
          userPrompt: mode === 'explain' ? '현재 분석 리포트 쉽게 풀기' : trimmedPrompt,
          assistantHeadline: res.response.headline,
          assistantExplanation: res.response.explanation,
          patchSummary: res.response.patchSummary,
        },
      ]);
      if (mode === 'request') {
        this.uiState.promptDraft = '';
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (this.abortController !== controller) return;
      this.uiState.error =
        err instanceof Error ? err.message : 'Gemini 요청 중 오류가 발생했다.';
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
        this.uiState.loading = false;
        if (!this.deps.isBasicsMode()) {
          this.deps.onRenderDynamicParts();
        }
        this.deps.onRenderCoach();
      }
    }
  }

  createCallbacks(): CoachCallbacks {
    return {
      onPreviewIssueFix: (issue) => {
        const project = this.deps.getProject();
        const chordView = this.deps.getChordView();
        const previewProj = issue.applyFix(project);
        const previewCompiled = compileSong(previewProj, chordView);
        this.uiState.activePreview = null;
        this.deps.onPreviewVisualDiff?.(previewCompiled, `코치 미리보기: ${issue.title}`);
        this.deps.playOncePreview(previewCompiled);
        this.deps.onRenderTopControls();
      },
      onApplyIssueFix: (issue) => {
        const current = this.deps.getProject();
        const fixed = issue.applyFix(current);
        fixed.activeLayer = current.activeLayer;
        this.deps.onApplyProject(fixed, `코치 적용: ${issue.title}`);
      },
      onToggleGeminiSettings: () => {
        this.uiState.settingsOpen = !this.uiState.settingsOpen;
        this.deps.onRenderCoach();
      },
      onSaveGeminiSettings: (apiKey, model) => {
        const nextKey = apiKey.trim() || this.settings.apiKey;
        this.settings = {
          ...this.settings,
          apiKey: nextKey,
          model,
        };
        this.saveSettingsFn(this.settings);
        this.syncSettingsMeta();
        this.uiState.error = null;
        if (this.settings.apiKey) {
          this.uiState.settingsOpen = false;
        }
        this.deps.onRenderCoach();
      },
      onClearGeminiKey: () => {
        this.settings = { ...this.settings, apiKey: '' };
        this.saveSettingsFn(this.settings);
        this.syncSettingsMeta();
        this.uiState.error = null;
        this.deps.onRenderCoach();
      },
      onPromptChange: (draft) => {
        this.uiState.promptDraft = draft;
      },
      onExplainReport: () => {
        void this.runRequest('explain');
      },
      onSubmitPrompt: (prompt) => {
        void this.runRequest('request', prompt);
      },
      onCancelGemini: () => {
        this.abort();
        this.deps.onRenderCoach();
      },
      onPreviewGeminiPatch: (after) => {
        const sug = this.uiState.suggestion;
        if (!sug?.demoProject) return;
        const chordView = this.deps.getChordView();
        if (after) {
          const previewCompiled = compileSong(sug.demoProject, chordView);
          this.uiState.activePreview = 'after';
          this.uiState.showVisualCompare = true;
          this.deps.playOncePreview(previewCompiled);
        } else {
          this.uiState.activePreview = 'before';
          this.deps.playOncePreview(this.deps.getCompiled());
        }
        this.deps.onRenderDynamicParts();
        this.deps.onRenderCoach();
        this.deps.onRenderTopControls();
      },
      onOpenManualEditLayer: (layer) => {
        const project = this.deps.getProject();
        if (project.activeLayer === layer) return;
        const next = cloneProject(project);
        next.activeLayer = layer;
        this.deps.onApplyProject(next);
      },
      onDismissGeminiSuggestion: () => {
        this.uiState.suggestion = null;
        this.uiState.activePreview = null;
        this.deps.onRenderDynamicParts();
        this.deps.onRenderCoach();
      },
      onClearGeminiHistory: () => {
        this.abort();
        this.uiState.history = [];
        this.uiState.suggestion = null;
        this.uiState.activePreview = null;
        this.uiState.error = null;
        this.deps.onRenderDynamicParts();
        this.deps.onRenderCoach();
      },
      onToggleVisualCompare: () => {
        this.uiState.showVisualCompare = !this.uiState.showVisualCompare;
        this.deps.onRenderDynamicParts();
        this.deps.onRenderCoach();
      },
    };
  }
}
