import { LESSONS, type LessonDefinition, type LessonEvaluation } from '../core/lesson';

export interface LessonPanelCallbacks {
  onSelectLesson: (lessonId: string) => void;
  onToggleHint: () => void;
  onResetLesson: () => void;
  onNextLesson: () => void;
  onExitToFree: () => void;
}

export function renderLessonBanner(
  container: HTMLElement,
  lesson: LessonDefinition,
  evaluation: LessonEvaluation,
  completedIds: ReadonlySet<string>,
  showHint: boolean,
  callbacks: LessonPanelCallbacks
): void {
  const isLastLesson = lesson.order >= LESSONS.length;

  const stepperHtml = LESSONS.map((item) => {
    const done = completedIds.has(item.id);
    const active = item.id === lesson.id;
    const cls = `lesson-pill${active ? ' active' : ''}${done ? ' done' : ''}`;
    return `
      <button class="${cls}" data-lesson-id="${item.id}" type="button" title="${item.titleKo}">
        <span class="lesson-pill-num">${done ? '✓' : item.order}</span>
        <span>${item.titleKo}</span>
      </button>
    `;
  }).join('');

  const checklistHtml = evaluation.checks
    .map(
      (chk) => `
      <li class="lesson-check-item${chk.passed ? ' passed' : ''}">
        <span class="lesson-check-icon">${chk.passed ? '✓' : '○'}</span>
        <span>${chk.labelKo}</span>
      </li>
    `
    )
    .join('');

  const passedBarHtml = evaluation.passed
    ? `
      <div class="lesson-passed-bar">
        <span><strong>미션 완료!</strong> 이제 귀로 비교 재생해 보거나 다음 단계로 넘어가자.</span>
        <div class="controls-row">
          ${
            isLastLesson
              ? `<button class="btn btn-primary" id="btn-lesson-finish" type="button">자유 스케치로 이동 →</button>`
              : `<button class="btn btn-primary" id="btn-lesson-next" type="button">다음 레슨 →</button>`
          }
        </div>
      </div>
    `
    : '';

  container.innerHTML = `
    <div class="lesson-stepper">${stepperHtml}</div>
    <div class="lesson-body">
      <div class="lesson-info">
        <div class="lesson-meta-row">
          <span class="lesson-stage-badge">${lesson.stageTagKo}</span>
          <span class="lesson-progress-text">${evaluation.passedCount} / ${evaluation.totalCount} 조건 달성</span>
        </div>
        <h2 class="lesson-title">${lesson.order}. ${lesson.titleKo}</h2>
        <p class="lesson-goal">${lesson.goalSummaryKo}</p>
        <p class="lesson-why"><strong>왜 중요할까?</strong> ${lesson.whyKo}</p>
        ${showHint ? `<div class="lesson-hint"><strong>힌트:</strong> ${lesson.hintKo}</div>` : ''}
      </div>
      <div class="lesson-side">
        <ul class="lesson-checklist">${checklistHtml}</ul>
        <div class="lesson-actions">
          <button class="btn btn-chip" id="btn-lesson-hint" type="button">${showHint ? '힌트 숨기기' : '힌트 보기'}</button>
          <button class="btn btn-chip" id="btn-lesson-reset" type="button">퍼즐 초기화</button>
        </div>
      </div>
    </div>
    ${passedBarHtml}
  `;

  container.querySelectorAll<HTMLButtonElement>('[data-lesson-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.lessonId;
      if (id && id !== lesson.id) callbacks.onSelectLesson(id);
    });
  });

  container.querySelector('#btn-lesson-hint')?.addEventListener('click', () => {
    callbacks.onToggleHint();
  });

  container.querySelector('#btn-lesson-reset')?.addEventListener('click', () => {
    callbacks.onResetLesson();
  });

  container.querySelector('#btn-lesson-next')?.addEventListener('click', () => {
    callbacks.onNextLesson();
  });

  container.querySelector('#btn-lesson-finish')?.addEventListener('click', () => {
    callbacks.onExitToFree();
  });
}
