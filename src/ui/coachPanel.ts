import type { DiagnosisIssue, DiagnosisReport } from '../core/analyzer';
import { COACH_CONFIG } from '../core/coachPatch';
import type { SongProject } from '../core/model';

export interface GeminiCoachSuggestion {
  headline: string;
  explanation: string;
  theoryTip?: string;
  patchSummary?: string;
  changeDescriptions: string[];
  warnings: string[];
  patchedProject?: SongProject;
  applied: boolean;
}

export interface GeminiCoachUiState {
  hasApiKey: boolean;
  maskedKey: string;
  selectedModel: string;
  settingsOpen: boolean;
  promptDraft: string;
  loading: boolean;
  error: string | null;
  suggestion: GeminiCoachSuggestion | null;
  activePreview: 'before' | 'after' | null;
}

export interface CoachCallbacks {
  onPreviewIssueFix: (issue: DiagnosisIssue) => void;
  onApplyIssueFix: (issue: DiagnosisIssue) => void;
  onToggleGeminiSettings: () => void;
  onSaveGeminiSettings: (apiKey: string, model: string) => void;
  onClearGeminiKey: () => void;
  onPromptChange: (draft: string) => void;
  onExplainReport: () => void;
  onSubmitPrompt: (prompt: string) => void;
  onCancelGemini: () => void;
  onPreviewGeminiPatch: (after: boolean) => void;
  onApplyGeminiPatch: () => void;
  onDismissGeminiSuggestion: () => void;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderGeminiCoachSection(gemini: GeminiCoachUiState): string {
  const modelOptionsHtml = COACH_CONFIG.models
    .map(
      (m) =>
        `<option value="${escapeHtml(m.id)}"${m.id === gemini.selectedModel ? ' selected' : ''}>${escapeHtml(m.labelKo)}</option>`
    )
    .join('');

  const settingsHtml = gemini.settingsOpen
    ? `
      <div class="gemini-settings">
        <label class="gemini-field">
          <span>Gemini API 키</span>
          <input
            id="gemini-api-key-input"
            type="password"
            placeholder="${gemini.hasApiKey ? '새 키를 입력하면 교체됩니다' : 'AIza... 형식의 API 키 입력'}"
            autocomplete="off"
          />
        </label>
        ${
          gemini.hasApiKey
            ? `<div class="gemini-key-hint">저장된 키: <code>${escapeHtml(gemini.maskedKey)}</code></div>`
            : ''
        }
        <label class="gemini-field">
          <span>모델</span>
          <select id="gemini-model-select">${modelOptionsHtml}</select>
        </label>
        <div class="gemini-settings-actions">
          <button class="btn btn-chip btn-primary" id="btn-gemini-save" type="button">저장</button>
          ${
            gemini.hasApiKey
              ? `<button class="btn btn-chip" id="btn-gemini-clear" type="button">키 삭제</button>`
              : ''
          }
        </div>
        <div class="gemini-privacy-note">
          API 키는 현재 브라우저(localStorage)에만 저장되며 Gemini API 요청 외에는 전송되지 않습니다.
        </div>
      </div>
    `
    : '';

  const quickChipsHtml = COACH_CONFIG.quickPrompts
    .map(
      (q) =>
        `<button class="btn btn-chip" data-gemini-quick="${escapeHtml(q.id)}" type="button"${gemini.loading ? ' disabled' : ''}>${escapeHtml(q.label)}</button>`
    )
    .join('');

  const errorHtml = gemini.error
    ? `<div class="gemini-error" role="alert">${escapeHtml(gemini.error)}</div>`
    : '';

  const loadingHtml = gemini.loading
    ? `<div class="gemini-loading">Gemini 코치가 곡과 이론 리포트를 분석하고 있습니다...</div>`
    : '';

  let resultHtml = '';
  if (gemini.suggestion) {
    const s = gemini.suggestion;
    const tipHtml = s.theoryTip
      ? `<div class="gemini-tip"><strong>이론 한 줄 팁:</strong> ${escapeHtml(s.theoryTip)}</div>`
      : '';

    const hasPatch = Boolean(s.patchedProject && s.changeDescriptions.length > 0);
    const patchHtml = hasPatch
      ? `
        <div class="gemini-patch-box">
          ${s.patchSummary ? `<div class="gemini-patch-summary">${escapeHtml(s.patchSummary)}</div>` : ''}
          <ul class="gemini-patch-list">
            ${s.changeDescriptions.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
          </ul>
          <div class="gemini-compare-actions">
            <button
              class="btn btn-chip${gemini.activePreview === 'before' ? ' active' : ''}"
              data-gemini-preview="before"
              type="button"
            >▶ 원본 듣기</button>
            <button
              class="btn btn-chip${gemini.activePreview === 'after' ? ' active' : ''}"
              data-gemini-preview="after"
              type="button"
            >▶ 수정안 듣기</button>
            ${
              s.applied
                ? `<span class="gemini-applied-badge">적용 완료 (Ctrl+Z 되돌리기)</span>`
                : `<button class="btn btn-chip btn-primary" id="btn-gemini-apply" type="button">패치 적용</button>`
            }
          </div>
        </div>
      `
      : '';

    const warningsHtml =
      s.warnings.length > 0
        ? `<div class="gemini-warnings">${s.warnings.map((w) => `<div>• ${escapeHtml(w)}</div>`).join('')}</div>`
        : '';

    resultHtml = `
      <div class="gemini-result-card">
        <div class="gemini-result-head">
          <strong>${escapeHtml(s.headline)}</strong>
          <button class="btn btn-chip" id="btn-gemini-dismiss" type="button">닫기</button>
        </div>
        <div class="gemini-result-desc">${escapeHtml(s.explanation)}</div>
        ${tipHtml}
        ${patchHtml}
        ${warningsHtml}
      </div>
    `;
  }

  return `
    <div class="gemini-coach-card">
      <div class="gemini-header">
        <div class="gemini-title-wrap">
          <strong>Gemini 작곡 코치</strong>
          <span class="gemini-status ${gemini.hasApiKey ? 'connected' : 'missing'}">
            ${gemini.hasApiKey ? '연결됨' : '키 필요'}
          </span>
        </div>
        <button class="btn btn-chip" id="btn-gemini-settings" type="button" aria-expanded="${gemini.settingsOpen}">
          ${gemini.settingsOpen ? '설정 닫기' : '설정'}
        </button>
      </div>
      ${settingsHtml}
      <div class="gemini-explain-row">
        <button class="btn btn-chip" id="btn-gemini-explain" type="button"${gemini.loading ? ' disabled' : ''}>
          현재 분석 리포트 쉽게 풀기
        </button>
      </div>
      <div class="gemini-quick-chips">${quickChipsHtml}</div>
      <div class="gemini-prompt-row">
        <textarea
          id="gemini-prompt-input"
          rows="2"
          maxlength="${COACH_CONFIG.limits.maxPromptLength}"
          placeholder="예: 3~4마디를 더 쓸쓸하게 바꿔 줘"
          ${gemini.loading ? 'disabled' : ''}
        >${escapeHtml(gemini.promptDraft)}</textarea>
        <div class="gemini-submit-row">
          ${
            gemini.loading
              ? `<button class="btn btn-chip" id="btn-gemini-cancel" type="button">취소</button>`
              : `<button class="btn btn-chip btn-primary" id="btn-gemini-submit" type="button">요청 보내기</button>`
          }
        </div>
      </div>
      ${loadingHtml}
      ${errorHtml}
      ${resultHtml}
    </div>
  `;
}

export function renderCoachPanel(
  container: HTMLElement,
  report: DiagnosisReport,
  gemini: GeminiCoachUiState,
  callbacks: CoachCallbacks
): void {
  const issuesHtml =
    report.issues.length === 0
      ? `<div class="choice-card-desc">현재 곡에 눈에 띄는 화성·리듬 문제가 없다. 다른 코드 진행이나 변형 카드를 실험해 보자.</div>`
      : report.issues
          .map(
            (issue) => `
          <div class="issue-card ${issue.severity}">
            <div class="issue-title">${escapeHtml(issue.title)}</div>
            <div class="issue-desc">${escapeHtml(issue.explanation)}</div>
            <div class="issue-actions">
              <button class="btn btn-chip" data-preview="${escapeHtml(issue.id)}" type="button">수정안 미리듣기</button>
              <button class="btn btn-chip btn-primary" data-apply="${escapeHtml(issue.id)}" type="button">바로 적용</button>
            </div>
          </div>
        `
          )
          .join('');

  container.innerHTML = `
    <p class="section-title">작곡 이론 코치</p>
    <div class="coach-score-card">
      <div class="score-badge">${report.score}</div>
      <div>
        <div style="font-weight:700;font-size:14px;">화성·리듬 균형 점수</div>
        <div class="choice-card-desc">${escapeHtml(report.summary)}</div>
      </div>
    </div>
    <div class="issue-list">${issuesHtml}</div>
    ${renderGeminiCoachSection(gemini)}
  `;

  container.querySelectorAll<HTMLButtonElement>('[data-preview]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const issue = report.issues.find((i) => i.id === btn.dataset.preview);
      if (issue) callbacks.onPreviewIssueFix(issue);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-apply]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const issue = report.issues.find((i) => i.id === btn.dataset.apply);
      if (issue) callbacks.onApplyIssueFix(issue);
    });
  });

  container.querySelector('#btn-gemini-settings')?.addEventListener('click', () => {
    callbacks.onToggleGeminiSettings();
  });

  container.querySelector('#btn-gemini-save')?.addEventListener('click', () => {
    const keyInput = container.querySelector<HTMLInputElement>('#gemini-api-key-input');
    const modelSel = container.querySelector<HTMLSelectElement>('#gemini-model-select');
    callbacks.onSaveGeminiSettings(
      keyInput?.value ?? '',
      modelSel?.value ?? gemini.selectedModel
    );
  });

  container.querySelector('#btn-gemini-clear')?.addEventListener('click', () => {
    callbacks.onClearGeminiKey();
  });

  container.querySelector('#btn-gemini-explain')?.addEventListener('click', () => {
    callbacks.onExplainReport();
  });

  container.querySelectorAll<HTMLButtonElement>('[data-gemini-quick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const quick = COACH_CONFIG.quickPrompts.find((q) => q.id === btn.dataset.geminiQuick);
      if (quick) callbacks.onSubmitPrompt(quick.prompt);
    });
  });

  const promptEl = container.querySelector<HTMLTextAreaElement>('#gemini-prompt-input');
  promptEl?.addEventListener('input', () => {
    callbacks.onPromptChange(promptEl.value);
  });
  promptEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      callbacks.onSubmitPrompt(promptEl.value);
    }
  });

  container.querySelector('#btn-gemini-submit')?.addEventListener('click', () => {
    callbacks.onSubmitPrompt(promptEl?.value ?? gemini.promptDraft);
  });

  container.querySelector('#btn-gemini-cancel')?.addEventListener('click', () => {
    callbacks.onCancelGemini();
  });

  container.querySelectorAll<HTMLButtonElement>('[data-gemini-preview]').forEach((btn) => {
    btn.addEventListener('click', () => {
      callbacks.onPreviewGeminiPatch(btn.dataset.geminiPreview === 'after');
    });
  });

  container.querySelector('#btn-gemini-apply')?.addEventListener('click', () => {
    callbacks.onApplyGeminiPatch();
  });

  container.querySelector('#btn-gemini-dismiss')?.addEventListener('click', () => {
    callbacks.onDismissGeminiSuggestion();
  });
}
