import type { DiagnosisIssue, DiagnosisReport } from '../core/analyzer';

export interface CoachCallbacks {
  onPreviewIssueFix: (issue: DiagnosisIssue) => void;
  onApplyIssueFix: (issue: DiagnosisIssue) => void;
}

export function renderCoachPanel(
  container: HTMLElement,
  report: DiagnosisReport,
  callbacks: CoachCallbacks
): void {
  const issuesHtml =
    report.issues.length === 0
      ? `<div class="choice-card-desc">현재 곡에 눈에 띄는 화성·리듬 문제가 없다. 다른 코드 진행이나 변형 카드를 실험해 보자.</div>`
      : report.issues
          .map(
            (issue) => `
          <div class="issue-card ${issue.severity}">
            <div class="issue-title">${issue.title}</div>
            <div class="issue-desc">${issue.explanation}</div>
            <div class="issue-actions">
              <button class="btn btn-chip" data-preview="${issue.id}" type="button">수정안 미리듣기</button>
              <button class="btn btn-chip btn-primary" data-apply="${issue.id}" type="button">바로 적용</button>
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
        <div class="choice-card-desc">${report.summary}</div>
      </div>
    </div>
    <div class="issue-list">${issuesHtml}</div>
    <div class="gemini-slot">
      <strong>3단계 확장 예정:</strong> Gemini API 를 연결하면 이 분석 리포트를 바탕으로 "3~4마디를 더 쓸쓸하게" 같은 자연어 요청을 블록 패치로 변환할 수 있다.
    </div>
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
}
