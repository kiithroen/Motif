import {
  BASIC_LESSONS,
  type BasicLessonDefinition,
  type BasicLessonEvaluation,
  type CompareDemo,
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
  onSelectLesson: (lessonId: string) => void;
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
  onNextLesson: () => void;
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

function renderChordTonePickBody(
  project: SongProject,
  compiled: CompiledSong,
  selectedPickBar: number
): string {
  const targetBars = [0, 1];
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
        <button class="pick-chord-card${selectedPickBar === b ? ' selected' : ''}" data-pick-bar="${b}" type="button">
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

  const activeChord = compiled.resolvedChords[selectedPickBar] ?? compiled.resolvedChords[0];
  const activeNote = compiled.melody.find((n) => n.step === selectedPickBar * 16);
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

  let feedbackMsg = `${selectedPickBar + 1}마디 ${activeChord.symbol} 코드(${activeTones}) 위에 올릴 음을 아래 건반에서 눌러 소리를 들어 보자.`;
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
        <strong>${selectedPickBar + 1}마디 (${activeChord.symbol}) 위에 올릴 음 고르기</strong>
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
  const isLastLesson = lesson.order >= BASIC_LESSONS.length;

  const stepperHtml = BASIC_LESSONS.map((item) => {
    const done = state.completedIds.has(item.id);
    const active = item.id === lesson.id;
    const cls = `lesson-pill${active ? ' active' : ''}${done ? ' done' : ''}`;
    return `
      <button class="${cls}" data-basic-id="${item.id}" type="button" title="${item.titleKo}">
        <span class="lesson-pill-num">${done ? '✓' : item.order}</span>
        <span>${item.titleKo}</span>
      </button>
    `;
  }).join('');

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
    workspaceHtml = renderChordTonePickBody(project, compiled, state.selectedPickBar);
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
              : `<button class="btn btn-primary" id="btn-basics-next" type="button">다음 강으로 →</button>`
          }
        </div>
      </div>
    `
    : '';

  container.innerHTML = `
    <div class="learn-shell">
      <div class="lesson-stepper">${stepperHtml}</div>

      <article class="learn-card">
        <div class="learn-header">
          <div class="lesson-meta-row">
            <span class="lesson-stage-badge">${lesson.categoryKo}</span>
            <span class="lesson-progress-text">${lesson.order}강 / ${BASIC_LESSONS.length}강</span>
          </div>
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

  // 마운트된 피아노롤이 있는 강의면 피아노롤을 그린다.
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

  container.querySelectorAll<HTMLButtonElement>('[data-basic-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.basicId;
      if (id && id !== lesson.id) callbacks.onSelectLesson(id);
    });
  });

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
  container.querySelector('#btn-basics-next')?.addEventListener('click', callbacks.onNextLesson);
  container.querySelector('#btn-basics-missions')?.addEventListener('click', callbacks.onGoToMissions);
  container.querySelector('#btn-basics-open-free')?.addEventListener('click', callbacks.onOpenInFreeSketch);
  container.querySelector('#btn-basics-to-free')?.addEventListener('click', callbacks.onOpenInFreeSketch);

  // 1강: 코드 카드 및 도레미 건반
  container.querySelectorAll<HTMLButtonElement>('[data-pick-bar]').forEach((btn) => {
    btn.addEventListener('click', () => {
      callbacks.onSelectPickBar(Number(btn.dataset.pickBar));
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-pick-midi]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const midi = Number(btn.dataset.pickMidi);
      const chord = compiled.resolvedChords[state.selectedPickBar] ?? compiled.resolvedChords[0];
      callbacks.onAuditionChordWithNote(chord.voicingMidi, midi);

      const step = state.selectedPickBar * 16;
      const next = cloneProject(project);
      const filtered = next.bakedMelody.filter((n) => n.step !== step);
      filtered.push({
        id: `pick_${state.selectedPickBar}_${Date.now()}`,
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

  // 6강: 코드 교체 버튼
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

  // 7강: 캐논 편곡 컨트롤
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
