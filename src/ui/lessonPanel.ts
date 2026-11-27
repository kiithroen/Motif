import {
  LESSONS,
  type LessonDefinition,
  type LessonEvaluation,
  type LessonKindTag,
  getLessonUnits,
} from '../core/lesson';

export interface LessonMapCallbacks {
  onStartLesson: (lessonId: string) => void;
  onResumeActive: () => void;
  onReviewRandomCompleted: () => void;
}

export interface LessonPanelCallbacks {
  onBackToMap: () => void;
  onPrevLesson: () => void;
  onNextLesson: () => void;
  onToggleHint: () => void;
  onResetLesson: () => void;
  onExitToFree: () => void;
}

function kindBadgeClass(tag: LessonKindTag): string {
  if (tag === '개념') return 'concept';
  if (tag === '반복') return 'drill';
  if (tag === '클래식') return 'classic';
  return 'review';
}

export function renderLessonCourseMap(
  container: HTMLElement,
  completedIds: ReadonlySet<string>,
  activeLessonId: string,
  callbacks: LessonMapCallbacks
): void {
  const units = getLessonUnits();
  const totalCount = LESSONS.length;
  const doneCount = completedIds.size;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const activeLesson =
    (completedIds.has(activeLessonId)
      ? LESSONS.find((l) => !completedIds.has(l.id))
      : undefined) ??
    LESSONS.find((l) => l.id === activeLessonId) ??
    LESSONS[0];

  const unitsHtml = units
    .map((unit) => {
      const unitDone = unit.lessons.filter((l) => completedIds.has(l.id)).length;
      const unitPct = Math.round((unitDone / unit.lessons.length) * 100);
      const rowsHtml = unit.lessons
        .map((lesson) => {
          const isDone = completedIds.has(lesson.id);
          const isCurrent = lesson.id === activeLesson.id;
          return `
            <button class="unit-lesson-row${isDone ? ' done' : ''}${isCurrent ? ' current' : ''}" data-start-mission="${lesson.id}" type="button">
              <span class="unit-lesson-num">${isDone ? '✓' : lesson.order}</span>
              <span class="unit-lesson-main">
                <strong>${lesson.order}강. ${lesson.titleKo}</strong>
                <span>${lesson.unlockedConceptKo}</span>
              </span>
              <span class="kind-badge ${kindBadgeClass(lesson.kindTagKo)}">${lesson.kindTagKo}</span>
            </button>
          `;
        })
        .join('');

      return `
        <section class="unit-card">
          <div class="unit-card-head">
            <div>
              <h3>${unit.unitTitleKo}</h3>
              <p>${unit.unitDescKo}</p>
            </div>
            <span class="unit-count-badge">${unitDone} / ${unit.lessons.length}</span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${unitPct}%"></div></div>
          <div class="unit-lesson-list">${rowsHtml}</div>
        </section>
      `;
    })
    .join('');

  container.innerHTML = `
    <div class="learn-shell">
      <section class="course-map-hero">
        <div class="course-hero-info">
          <div class="lesson-stage-badge">실전 미션 커리큘럼 · 4유닛 ${totalCount}강</div>
          <h1 class="learn-title" style="margin-top:6px;">L1 블록 → L2 변형 체인 → L3 피아노롤 & 이론 코치 실전</h1>
          <p class="learn-subtitle">기초 원리를 실제 작곡 샌드박스에 적용해 본다. 블록 조합부터 8마디 조바꿈까지 20개 미션으로 손에 익혀 보자.</p>
          <div class="course-hero-progress">
            <div class="progress-track" style="flex:1;"><div class="progress-fill" style="width:${pct}%"></div></div>
            <strong>${doneCount} / ${totalCount}강 완료 (${pct}%)</strong>
          </div>
        </div>
        <div class="course-hero-actions">
          <button class="btn btn-primary" id="btn-mission-resume" type="button">이어서 도전하기 (${activeLesson.order}강)</button>
          <button class="btn" id="btn-mission-review" type="button"${doneCount === 0 ? ' disabled' : ''}>완료한 미션 랜덤 복습</button>
        </div>
      </section>

      <div class="unit-grid">${unitsHtml}</div>
    </div>
  `;

  container.querySelector('#btn-mission-resume')?.addEventListener('click', () => {
    callbacks.onStartLesson(activeLesson.id);
  });
  container.querySelector('#btn-mission-review')?.addEventListener('click', callbacks.onReviewRandomCompleted);
  container.querySelectorAll<HTMLButtonElement>('[data-start-mission]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.startMission;
      if (id) callbacks.onStartLesson(id);
    });
  });
}

export function renderLessonBanner(
  container: HTMLElement,
  lesson: LessonDefinition,
  evaluation: LessonEvaluation,
  showHint: boolean,
  callbacks: LessonPanelCallbacks
): void {
  const isFirstLesson = lesson.order <= 1;
  const isLastLesson = lesson.order >= LESSONS.length;

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
              : `<button class="btn btn-primary" id="btn-lesson-next-pass" type="button">다음 미션 →</button>`
          }
        </div>
      </div>
    `
    : '';

  container.innerHTML = `
    <div class="lesson-nav-inline">
      <div class="controls-row">
        <button class="btn btn-chip" id="btn-lesson-map" type="button">← 미션 목차로</button>
        <span class="lesson-stage-badge">${lesson.unitTitleKo}</span>
        <span class="kind-badge ${kindBadgeClass(lesson.kindTagKo)}">${lesson.kindTagKo}</span>
        <span class="concept-unlock-chip">이번 미션 핵심: ${lesson.unlockedConceptKo}</span>
      </div>
      <div class="controls-row">
        <span class="lesson-progress-text">${lesson.order}강 / ${LESSONS.length}강 · ${evaluation.passedCount}/${evaluation.totalCount} 조건</span>
        <button class="btn btn-chip" id="btn-lesson-prev" type="button"${isFirstLesson ? ' disabled' : ''}>◀ 이전</button>
        <button class="btn btn-chip" id="btn-lesson-next" type="button"${isLastLesson ? ' disabled' : ''}>다음 ▶</button>
      </div>
    </div>
    <div class="lesson-body">
      <div class="lesson-info">
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

  container.querySelector('#btn-lesson-map')?.addEventListener('click', callbacks.onBackToMap);
  container.querySelector('#btn-lesson-prev')?.addEventListener('click', callbacks.onPrevLesson);
  container.querySelector('#btn-lesson-next')?.addEventListener('click', callbacks.onNextLesson);
  container.querySelector('#btn-lesson-next-pass')?.addEventListener('click', callbacks.onNextLesson);
  container.querySelector('#btn-lesson-hint')?.addEventListener('click', callbacks.onToggleHint);
  container.querySelector('#btn-lesson-reset')?.addEventListener('click', callbacks.onResetLesson);
  container.querySelector('#btn-lesson-finish')?.addEventListener('click', callbacks.onExitToFree);
}
