import {
  BASIC_LESSONS,
  type BasicLessonDefinition,
  type BasicLessonEvaluation,
  type BasicLessonKindTag,
  type CompareDemo,
  getBasicUnits,
} from '../core/basics';
import type { CompiledSong } from '../core/compiler';
import { PRESETS, type SongProject, cloneProject } from '../core/model';
import {
  type DegreeSymbol,
  KOREAN_SOLFEGE,
  type ResolvedChord,
  classifyPitch,
  koreanNoteName,
  resolveChord,
  wrapPc,
} from '../core/theory';
import { buildChordDiagramSvg } from './guitarStrip';
import { renderFocusedPianoRoll } from './layers';

export interface BasicsMapCallbacks {
  onStartLesson: (lessonId: string) => void;
  onResumeActive: () => void;
  onReviewRandomCompleted: () => void;
}

export interface BasicsViewState {
  completedIds: ReadonlySet<string>;
  activeStep: number;
  isPlaying: boolean;
  showHint: boolean;
  canUndo: boolean;
  selectedDuration: number;
  selectedPickBar: number;
}

export interface BasicsViewCallbacks {
  onBackToMap: () => void;
  onPrevLesson: () => void;
  onNextLesson: () => void;
  onPlayDemo: (demo: CompareDemo) => void;
  onTogglePlay: () => void;
  onUndo: () => void;
  onToggleHint: () => void;
  onReset: () => void;
  onSelectDuration: (steps: number) => void;
  onSelectPickBar: (barIdx: number) => void;
  onProjectChange: (next: SongProject) => void;
  onAuditionPitch: (midi: number) => void;
  onAuditionChordWithNote: (voicingMidi: number[], midi: number) => void;
  onAuditionChord: (chord: ResolvedChord) => void;
  onGoToMissions: () => void;
  onOpenInFreeSketch: () => void;
}

const SOLFEGE_KEYS = [
  { midi: 60, label: '도', en: 'C4' },
  { midi: 62, label: '레', en: 'D4' },
  { midi: 64, label: '미', en: 'E4' },
  { midi: 65, label: '파', en: 'F4' },
  { midi: 67, label: '솔', en: 'G4' },
  { midi: 69, label: '라', en: 'A4' },
  { midi: 71, label: '시', en: 'B4' },
  { midi: 72, label: '도5', en: 'C5' },
];

const CHORD_SWAP_OPTIONS: Array<{ degree: DegreeSymbol; labelKo: string }> = [
  { degree: 'I', labelKo: 'C (I)' },
  { degree: 'ii', labelKo: 'Dm (ii)' },
  { degree: 'iii', labelKo: 'Em (iii)' },
  { degree: 'IV', labelKo: 'F (IV)' },
  { degree: 'iv', labelKo: 'Fm (iv)' },
  { degree: 'V', labelKo: 'G (V)' },
  { degree: 'vi', labelKo: 'Am (vi)' },
];

function kindBadgeClass(tag: BasicLessonKindTag): string {
  if (tag === '개념') return 'concept';
  if (tag === '반복') return 'drill';
  if (tag === '클래식') return 'classic';
  return 'review';
}

export function renderBasicsCourseMap(
  container: HTMLElement,
  completedIds: ReadonlySet<string>,
  activeLessonId: string,
  callbacks: BasicsMapCallbacks
): void {
  const units = getBasicUnits();
  const totalCount = BASIC_LESSONS.length;
  const doneCount = completedIds.size;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const activeLesson =
    (completedIds.has(activeLessonId)
      ? BASIC_LESSONS.find((l) => !completedIds.has(l.id))
      : undefined) ??
    BASIC_LESSONS.find((l) => l.id === activeLessonId) ??
    BASIC_LESSONS[0];

  const unitsHtml = units
    .map((unit) => {
      const unitDone = unit.lessons.filter((l) => completedIds.has(l.id)).length;
      const unitPct = Math.round((unitDone / unit.lessons.length) * 100);
      const rowsHtml = unit.lessons
        .map((lesson) => {
          const isDone = completedIds.has(lesson.id);
          const isCurrent = lesson.id === activeLesson.id;
          return `
            <button class="unit-lesson-row${isDone ? ' done' : ''}${isCurrent ? ' current' : ''}" data-start-basic="${lesson.id}" type="button">
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
          <div class="lesson-stage-badge">기초 입문 커리큘럼 · 4유닛 ${totalCount}강</div>
          <h1 class="learn-title" style="margin-top:6px;">화음 → 뼈대 → 리듬·클래식 → 편곡 단계별 학습</h1>
          <p class="learn-subtitle">각 강의마다 귀로 먼저 비교하고 직접 한 음씩 쌓으며 감각을 익힌다. 막히지 않도록 모든 강이 열려 있어 원하는 주제를 바로 눌러 볼 수도 있다.</p>
          <div class="course-hero-progress">
            <div class="progress-track" style="flex:1;"><div class="progress-fill" style="width:${pct}%"></div></div>
            <strong>${doneCount} / ${totalCount}강 완료 (${pct}%)</strong>
          </div>
        </div>
        <div class="course-hero-actions">
          <button class="btn btn-primary" id="btn-basics-resume" type="button">이어서 학습하기 (${activeLesson.order}강)</button>
          <button class="btn" id="btn-basics-review" type="button"${doneCount === 0 ? ' disabled' : ''}>완료한 강 랜덤 복습</button>
        </div>
      </section>

      <div class="unit-grid">${unitsHtml}</div>
    </div>
  `;

  container.querySelector('#btn-basics-resume')?.addEventListener('click', () => {
    callbacks.onStartLesson(activeLesson.id);
  });
  container.querySelector('#btn-basics-review')?.addEventListener('click', callbacks.onReviewRandomCompleted);
  container.querySelectorAll<HTMLButtonElement>('[data-start-basic]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.startBasic;
      if (id) callbacks.onStartLesson(id);
    });
  });
}

function renderChordTonePickBody(
  project: SongProject,
  compiled: CompiledSong,
  targetBars: number[],
  selectedPickBar: number
): string {
  const safeSelectedBar = targetBars.includes(selectedPickBar) ? selectedPickBar : targetBars[0] ?? 0;

  const cardsHtml = targetBars
    .map((b) => {
      const chord = compiled.resolvedChords[b];
      const note = compiled.melody.find((n) => n.step === b * 16);
      const tones = chord.pitchClasses.map((pc) => KOREAN_SOLFEGE[pc]).join(' · ');
      const noteLabel = note ? koreanNoteName(note.midi, true) : '없음';
      const statusText = !note
        ? '음을 골라 보자'
        : note.role === 'chord_tone'
          ? '어울림 (구성음)'
          : note.role === 'clash'
            ? '부딪힘 (충돌음)'
            : '긴장음';
      const statusCls = !note ? '' : note.role === 'chord_tone' ? 'good' : note.role === 'clash' ? 'warn' : '';
      return `
        <button class="pick-chord-card${safeSelectedBar === b ? ' selected' : ''}" data-pick-bar="${b}" type="button">
          <div class="pick-chord-info">
            <span class="chord-bar">${b + 1}마디 코드</span>
            <strong class="chord-symbol">${chord.symbol}</strong>
            <span class="pick-tones">구성음: ${tones}</span>
            <span class="pick-current ${statusCls}">현재 음: ${noteLabel} · ${statusText}</span>
          </div>
          ${buildChordDiagramSvg(chord)}
        </button>
      `;
    })
    .join('');

  const activeChord = compiled.resolvedChords[safeSelectedBar] ?? compiled.resolvedChords[0];
  const activeNote = compiled.melody.find((n) => n.step === safeSelectedBar * 16);
  const activeTones = activeChord.pitchClasses.map((pc) => KOREAN_SOLFEGE[pc]).join('·');

  const keysHtml = SOLFEGE_KEYS.map((k) => {
    const isChordTone = activeChord.pitchClasses.includes(wrapPc(k.midi));
    const role = classifyPitch(k.midi, activeChord, project.keyRoot, project.mode, 0, 12);
    const isSelected = activeNote ? wrapPc(activeNote.midi) === wrapPc(k.midi) && activeNote.midi === k.midi : false;
    const cls = [
      'solfege-key',
      isChordTone ? 'chord-tone' : '',
      role === 'clash' ? 'clash' : '',
      isSelected ? 'selected' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `
      <button class="${cls}" data-pick-midi="${k.midi}" type="button">
        <strong>${k.label}</strong>
        <span>${k.en}</span>
        <em>${isChordTone ? '구성음' : role === 'clash' ? '반음 충돌' : '음계음'}</em>
      </button>
    `;
  }).join('');

  let feedbackMsg = `${safeSelectedBar + 1}마디 ${activeChord.symbol} 코드(${activeTones}) 위에 올릴 음을 아래 건반에서 눌러 소리를 들어 보자.`;
  if (activeNote) {
    const nm = koreanNoteName(activeNote.midi);
    if (activeNote.role === 'chord_tone') {
      feedbackMsg = `좋아! '${nm}' 음은 ${activeChord.symbol} 코드(${activeTones}) 안에 들어 있어 부드럽게 어울린다.`;
    } else if (activeNote.role === 'clash') {
      feedbackMsg = `'${nm}' 음은 ${activeChord.symbol} 코드 구성음(${activeTones}) 바로 옆 반음(1칸)이라 첫 박자에서 날카롭게 부딪힌다.`;
    } else {
      feedbackMsg = `'${nm}' 음은 음계 안에는 있지만 ${activeChord.symbol} 코드 구성음(${activeTones})은 아니다. 구성음을 고르면 훨씬 안정된다.`;
    }
  }

  return `
    <div class="chord-pick-grid">${cardsHtml}</div>
    <div class="solfege-picker-box">
      <div class="solfege-picker-head">
        <strong>${safeSelectedBar + 1}마디 (${activeChord.symbol}) 위에 올릴 음 고르기</strong>
        <span>클릭하면 코드와 음이 함께 울린다</span>
      </div>
      <div class="solfege-keys">${keysHtml}</div>
      <div class="pick-feedback">${feedbackMsg}</div>
    </div>
  `;
}

function renderChordSwapBody(compiled: CompiledSong): string {
  const cards = compiled.resolvedChords
    .map((chord, barIdx) => {
      const tones = chord.pitchClasses.map((pc) => KOREAN_SOLFEGE[pc]).join('·');
      const buttons = CHORD_SWAP_OPTIONS.map(
        (opt) =>
          `<button class="btn btn-chip${chord.degree === opt.degree ? ' active' : ''}" data-swap-bar="${barIdx}" data-swap-deg="${opt.degree}" type="button">${opt.labelKo}</button>`
      ).join('');
      return `
        <div class="swap-bar-card">
          <div class="swap-bar-top">
            <div>
              <div class="chord-bar">${barIdx + 1}마디</div>
              <div class="chord-symbol">${chord.symbol}</div>
              <div class="pick-tones">구성음: ${tones}</div>
            </div>
            ${buildChordDiagramSvg(chord)}
          </div>
          <div class="swap-btn-grid">${buttons}</div>
        </div>
      `;
    })
    .join('');

  return `<div class="chord-swap-grid">${cards}</div>`;
}

function renderArrangeControlsBody(project: SongProject): string {
  const grooveButtons = PRESETS.grooves
    .map(
      (g) => `
      <button class="choice-card${project.blocks.grooveId === g.id ? ' selected' : ''}" data-arr-groove="${g.id}" type="button">
        <div class="choice-card-title">${g.nameKo}</div>
        <div class="choice-card-desc">${g.moodKo} (${g.defaultBpm} BPM)</div>
      </button>
    `
    )
    .join('');

  return `
    <div class="arrange-controls">
      <div class="arrange-mode-row">
        <span class="section-title" style="margin:0;">1. 분위기(장조 / 단조) 고르기</span>
        <div class="controls-row">
          <button class="btn btn-chip${project.mode === 'major' ? ' active' : ''}" data-arr-mode="major" type="button">장조 (원곡 밝은 느낌)</button>
          <button class="btn btn-chip${project.mode === 'minor' ? ' active' : ''}" data-arr-mode="minor" type="button">단조 (차분·애틋한 느낌)</button>
        </div>
      </div>
      <div>
        <div class="section-title">2. 반주 리듬 그루브 바꾸기</div>
        <div class="card-grid" style="margin-bottom:0;">${grooveButtons}</div>
      </div>
    </div>
    <div id="basics-pr-mount"></div>
  `;
}

export function renderBasicsView(
  container: HTMLElement,
  lesson: BasicLessonDefinition,
  project: SongProject,
  compiled: CompiledSong,
  evaluation: BasicLessonEvaluation,
  state: BasicsViewState,
  callbacks: BasicsViewCallbacks
): void {
  const isFirstLesson = lesson.order <= 1;
  const isLastLesson = lesson.order >= BASIC_LESSONS.length;
  const targetPickBars = lesson.pickBars ?? [0, 1];
  const activePickBar = targetPickBars.includes(state.selectedPickBar)
    ? state.selectedPickBar
    : targetPickBars[0] ?? 0;

  const demosHtml = lesson.compareDemos
    .map(
      (demo) => `
      <div class="demo-card ${demo.tone}">
        <div class="demo-card-head">
          <strong>${demo.labelKo}</strong>
          <span class="demo-badge ${demo.tone}">${demo.badgeKo}</span>
        </div>
        <p class="demo-desc">${demo.descKo}</p>
        <button class="btn btn-chip" data-play-demo="${demo.id}" type="button">▶ 소리 비교 듣기</button>
      </div>
    `
    )
    .join('');

  const theoryHtml = lesson.theoryPoints
    .map((pt) => {
      const chips = pt.chips?.length
        ? `<div class="theory-chips">${pt.chips.map((c) => `<span class="theory-chip">${c}</span>`).join('')}</div>`
        : '';
      return `
        <div class="theory-card">
          <h4>${pt.headingKo}</h4>
          <p>${pt.bodyKo}</p>
          ${chips}
        </div>
      `;
    })
    .join('');

  const annotationsHtml = lesson.annotations?.length
    ? `
      <div class="annotation-grid">
        ${lesson.annotations
          .map(
            (a) => `
          <div class="annotation-card">
            <strong>${a.barLabelKo}</strong>
            <p>${a.textKo}</p>
          </div>
        `
          )
          .join('')}
      </div>
    `
    : '';

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

  let workspaceHtml = '';
  if (lesson.workspaceKind === 'chord_tone_pick') {
    workspaceHtml = renderChordTonePickBody(project, compiled, targetPickBars, activePickBar);
  } else if (lesson.workspaceKind === 'chord_swap') {
    workspaceHtml = renderChordSwapBody(compiled);
  } else if (lesson.workspaceKind === 'classic_arrange') {
    workspaceHtml = renderArrangeControlsBody(project);
  } else {
    workspaceHtml = `<div id="basics-pr-mount"></div>`;
  }

  const passedBarHtml = evaluation.passed
    ? `
      <div class="lesson-passed-bar">
        <span><strong>완료!</strong> 내 곡 들어보기로 소리를 확인하고 다음 단계로 넘어가자.</span>
        <div class="controls-row">
          ${
            isLastLesson
              ? `
                <button class="btn" id="btn-basics-open-free" type="button">이 편곡을 자유 스케치에서 다듬기 →</button>
                <button class="btn btn-primary" id="btn-basics-missions" type="button">실전 미션으로 넘어가기 →</button>
              `
              : `<button class="btn btn-primary" id="btn-basics-next-pass" type="button">다음 강으로 →</button>`
          }
        </div>
      </div>
    `
    : '';

  container.innerHTML = `
    <div class="learn-shell">
      <div class="lesson-nav-bar">
        <div class="controls-row">
          <button class="btn" id="btn-basics-map" type="button">← 코스 목차로</button>
          <span class="lesson-stage-badge">${lesson.unitTitleKo}</span>
          <span class="kind-badge ${kindBadgeClass(lesson.kindTagKo)}">${lesson.kindTagKo}</span>
          <span class="concept-unlock-chip">이번 강 핵심: ${lesson.unlockedConceptKo}</span>
        </div>
        <div class="controls-row">
          <span class="lesson-progress-text">${lesson.order}강 / ${BASIC_LESSONS.length}강</span>
          <button class="btn btn-chip" id="btn-basics-prev" type="button"${isFirstLesson ? ' disabled' : ''}>◀ 이전</button>
          <button class="btn btn-chip" id="btn-basics-next" type="button"${isLastLesson ? ' disabled' : ''}>다음 ▶</button>
        </div>
      </div>

      <article class="learn-card">
        <div class="learn-header">
          <h1 class="learn-title">${lesson.order}. ${lesson.titleKo}</h1>
          <p class="learn-subtitle">${lesson.subtitleKo}</p>
        </div>

        <section class="learn-section">
          <div class="learn-section-label">1단계 · 귀로 먼저 비교해 보기</div>
          <div class="demo-grid">${demosHtml}</div>
        </section>

        <section class="learn-section">
          <div class="learn-section-label">2단계 · 왜 그럴까? 핵심 원리</div>
          <div class="theory-grid">${theoryHtml}</div>
          ${annotationsHtml}
        </section>

        <section class="learn-section">
          <div class="learn-practice-head">
            <div>
              <div class="learn-section-label">3단계 · 내 손으로 직접 해보기</div>
              <p class="learn-goal">${lesson.goalSummaryKo}</p>
            </div>
            <div class="controls-row">
              <button class="btn btn-primary btn-play${state.isPlaying ? ' playing' : ''}" id="btn-basics-play" type="button">
                ${state.isPlaying ? '■ 정지 (Space)' : '▶ 내 곡 들어보기 (Space)'}
              </button>
              <button class="btn" id="btn-basics-undo" type="button"${state.canUndo ? '' : ' disabled'}>↩ 되돌리기</button>
              <button class="btn" id="btn-basics-hint" type="button">${state.showHint ? '힌트 숨기기' : '힌트 보기'}</button>
              <button class="btn" id="btn-basics-reset" type="button">초기화</button>
              ${
                lesson.workspaceKind === 'classic_arrange'
                  ? `<button class="btn" id="btn-basics-to-free" type="button">자유 스케치로 가져가기</button>`
                  : ''
              }
            </div>
          </div>

          <div class="learn-checklist-box">
            <ul class="lesson-checklist">${checklistHtml}</ul>
            ${state.showHint ? `<div class="lesson-hint"><strong>힌트:</strong> ${lesson.hintKo}</div>` : ''}
          </div>

          ${workspaceHtml}
          ${passedBarHtml}
        </section>
      </article>
    </div>
  `;

  const prMount = container.querySelector<HTMLElement>('#basics-pr-mount');
  if (prMount) {
    renderFocusedPianoRoll(prMount, project, compiled, state.activeStep, {
      showDurationPicker: Boolean(lesson.showDurationPicker),
      selectedDuration: state.selectedDuration,
      onSelectDuration: callbacks.onSelectDuration,
      onProjectChange: (next) => callbacks.onProjectChange(next),
      onAuditionPitch: callbacks.onAuditionPitch,
    });
  }

  container.querySelector('#btn-basics-map')?.addEventListener('click', callbacks.onBackToMap);
  container.querySelector('#btn-basics-prev')?.addEventListener('click', callbacks.onPrevLesson);
  container.querySelector('#btn-basics-next')?.addEventListener('click', callbacks.onNextLesson);
  container.querySelector('#btn-basics-next-pass')?.addEventListener('click', callbacks.onNextLesson);

  container.querySelectorAll<HTMLButtonElement>('[data-play-demo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const demo = lesson.compareDemos.find((d) => d.id === btn.dataset.playDemo);
      if (demo) callbacks.onPlayDemo(demo);
    });
  });

  container.querySelector('#btn-basics-play')?.addEventListener('click', callbacks.onTogglePlay);
  container.querySelector('#btn-basics-undo')?.addEventListener('click', callbacks.onUndo);
  container.querySelector('#btn-basics-hint')?.addEventListener('click', callbacks.onToggleHint);
  container.querySelector('#btn-basics-reset')?.addEventListener('click', callbacks.onReset);
  container.querySelector('#btn-basics-missions')?.addEventListener('click', callbacks.onGoToMissions);
  container.querySelector('#btn-basics-open-free')?.addEventListener('click', callbacks.onOpenInFreeSketch);
  container.querySelector('#btn-basics-to-free')?.addEventListener('click', callbacks.onOpenInFreeSketch);

  container.querySelectorAll<HTMLButtonElement>('[data-pick-bar]').forEach((btn) => {
    btn.addEventListener('click', () => {
      callbacks.onSelectPickBar(Number(btn.dataset.pickBar));
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-pick-midi]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const midi = Number(btn.dataset.pickMidi);
      const chord = compiled.resolvedChords[activePickBar] ?? compiled.resolvedChords[0];
      callbacks.onAuditionChordWithNote(chord.voicingMidi, midi);

      const step = activePickBar * 16;
      const next = cloneProject(project);
      const filtered = next.bakedMelody.filter((n) => n.step !== step);
      filtered.push({
        id: `pick_${activePickBar}_${Date.now()}`,
        midi,
        step,
        duration: 12,
        velocity: 0.84,
        origin: 'user',
      });
      next.bakedMelody = filtered.sort((a, b) => a.step - b.step);
      next.baked = true;
      callbacks.onProjectChange(next);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-swap-bar]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const barIdx = Number(btn.dataset.swapBar);
      const degree = btn.dataset.swapDeg as DegreeSymbol;
      const next = cloneProject(project);
      if (next.chain.chords[barIdx]) {
        next.chain.chords[barIdx].degree = degree;
      }
      const rc = resolveChord(degree, next.keyRoot, next.mode);
      callbacks.onAuditionChord(rc);
      callbacks.onProjectChange(next);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-arr-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = cloneProject(project);
      next.mode = btn.dataset.arrMode as SongProject['mode'];
      callbacks.onProjectChange(next);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-arr-groove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const gId = btn.dataset.arrGroove!;
      const preset = PRESETS.grooves.find((g) => g.id === gId);
      const next = cloneProject(project);
      next.blocks.grooveId = gId;
      if (preset) next.bpm = preset.defaultBpm;
      callbacks.onProjectChange(next);
    });
  });
}

export function updateBasicsPlayButton(container: HTMLElement, isPlaying: boolean): void {
  const btn = container.querySelector<HTMLButtonElement>('#btn-basics-play');
  if (!btn) return;
  btn.classList.toggle('playing', isPlaying);
  btn.textContent = isPlaying ? '■ 정지 (Space)' : '▶ 내 곡 들어보기 (Space)';
}
