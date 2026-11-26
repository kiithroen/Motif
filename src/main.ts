import './styles.css';
import { MotifAudioEngine } from './audio/instruments';
import { MotifTransport, type TrackMuteState } from './audio/transport';
import { analyzeSong } from './core/analyzer';
import {
  bakeProjectMelody,
  compileSong,
  previewModifierDiff,
  unpackBlocksToChain,
} from './core/compiler';
import { exportToMidi } from './core/midi';
import {
  type MelodyInstrument,
  type ModifierId,
  PRESETS,
  type SongProject,
  cloneProject,
  createDefaultProject,
} from './core/model';
import { ProjectHistory } from './core/history';
import { LESSONS, createLessonProject, evaluateLesson, getLessonById } from './core/lesson';
import { KOREAN_SOLFEGE, NOTE_NAMES_SHARP, type ScaleMode } from './core/theory';
import { renderCoachPanel } from './ui/coachPanel';
import { renderGuitarStrip, updateGuitarStripActiveBar } from './ui/guitarStrip';
import { renderLayerEditor, updatePianoRollPlayhead } from './ui/layers';
import { renderLessonBanner } from './ui/lessonPanel';

const STORAGE_KEY = 'motif_project_v1';
const LESSON_STORAGE_KEY = 'motif_lessons_v1';

type AppMode = 'free' | 'lesson';

interface LessonProgress {
  completedIds: string[];
  activeLessonId: string;
}

const PC_KEYBOARD_NOTES: Record<string, number> = {
  a: 60, // C4
  w: 61,
  s: 62,
  e: 63,
  d: 64,
  f: 65,
  t: 66,
  g: 67,
  y: 68,
  h: 69,
  u: 70,
  j: 71,
  k: 72, // C5
};

function loadInitialProject(): SongProject {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SongProject;
      if (parsed && parsed.blocks && parsed.chain) return parsed;
    }
  } catch {
    // 저장 데이터 파싱 실패 시 기본 프로젝트로 시작한다.
  }
  return createDefaultProject();
}

function saveProject(project: SongProject): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch {
    // 프라이빗 모드 등 저장 불가 환경은 조용히 건너뛴다.
  }
}

function loadLessonProgress(): LessonProgress {
  try {
    const raw = localStorage.getItem(LESSON_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LessonProgress>;
      const validIds = new Set(LESSONS.map((l) => l.id));
      const completedIds = Array.isArray(parsed.completedIds)
        ? parsed.completedIds.filter((id): id is string => typeof id === 'string' && validIds.has(id))
        : [];
      const activeLessonId =
        typeof parsed.activeLessonId === 'string' && validIds.has(parsed.activeLessonId)
          ? parsed.activeLessonId
          : LESSONS[0].id;
      return { completedIds, activeLessonId };
    }
  } catch {
    // 저장 데이터 파싱 실패 시 기본 진행도로 시작한다.
  }
  return { completedIds: [], activeLessonId: LESSONS[0].id };
}

function saveLessonProgress(progress: LessonProgress): void {
  try {
    localStorage.setItem(LESSON_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // 저장 불가 환경은 조용히 건너뛴다.
  }
}

function downloadMidi(project: SongProject): void {
  const compiled = compileSong(project);
  const bytes = exportToMidi(compiled, project);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `motif_${NOTE_NAMES_SHARP[project.keyRoot]}_${project.mode}.mid`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function init(): void {
  const root = document.getElementById('app');
  if (!root) return;

  let appMode: AppMode = 'free';
  let freeProject = loadInitialProject();
  let lessonProgress = loadLessonProgress();
  let showLessonHint = false;
  let project = cloneProject(freeProject);
  let compiled = compileSong(project);
  let activeStep = -1;
  let selectedDuration = PRESETS.noteDurationOptions[0]?.steps ?? 2;
  const history = new ProjectHistory();
  const mutes: TrackMuteState = { melody: false, chords: false, bass: false, drums: false };

  const audio = new MotifAudioEngine();
  const transport = new MotifTransport(audio, compiled, {
    onStep: (step) => {
      activeStep = step;
      const activeBar = activeStep >= 0 ? Math.floor(activeStep / 16) : -1;
      updateGuitarStripActiveBar(stripEl, activeBar);
      updatePianoRollPlayhead(mainEl, activeStep, compiled.totalSteps);
    },
    onStop: () => {
      renderTopControls();
    },
  });

  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar" id="topbar"></header>
      <section class="lesson-banner" id="lesson-banner" hidden></section>
      <section class="chord-strip" id="chord-strip"></section>
      <main class="workspace-grid">
        <section class="main-panel" id="main-panel"></section>
        <aside class="coach-panel" id="coach-panel"></aside>
      </main>
    </div>
  `;

  const topbarEl = document.getElementById('topbar')!;
  const lessonBannerEl = document.getElementById('lesson-banner')!;
  const stripEl = document.getElementById('chord-strip')!;
  const mainEl = document.getElementById('main-panel')!;
  const coachEl = document.getElementById('coach-panel')!;

  function isTabOnlyChange(prev: SongProject, next: SongProject): boolean {
    if (prev.activeLayer === next.activeLayer) return false;
    const normalizedPrev = { ...prev, activeLayer: next.activeLayer };
    return JSON.stringify(normalizedPrev) === JSON.stringify(next);
  }

  function loadWorkspaceProject(target: SongProject): void {
    transport.stop();
    history.clear();
    activeStep = -1;
    project = cloneProject(target);
    compiled = compileSong(project);
    transport.updateSong(compiled, project.bpm, project.melodyInstrument, mutes);
    renderAll();
  }

  function switchMode(mode: AppMode): void {
    if (mode === appMode) return;
    appMode = mode;
    showLessonHint = false;
    if (mode === 'free') {
      loadWorkspaceProject(freeProject);
    } else {
      loadWorkspaceProject(createLessonProject(lessonProgress.activeLessonId));
    }
  }

  function selectLesson(lessonId: string): void {
    lessonProgress = { ...lessonProgress, activeLessonId: lessonId };
    saveLessonProgress(lessonProgress);
    showLessonHint = false;
    if (appMode !== 'lesson') {
      appMode = 'lesson';
    }
    loadWorkspaceProject(createLessonProject(lessonId));
  }

  function updateState(next: SongProject, recompileAudioOnly = false, recordHistory = true): void {
    const prev = project;
    const tabOnly = isTabOnlyChange(prev, next);

    // L1 블록의 progressionId 변경 시 L2 코드 슬롯도 동기화한다.
    if (
      next.blocks.progressionId !== project.blocks.progressionId ||
      next.bars !== project.bars
    ) {
      next.chain = unpackBlocksToChain(next.blocks, next.bars, next.chain.modifiers);
    }

    let resolvedNext = next;
    // L2 -> L3 탭 전환 시 아직 구워지지 않았으면 자동으로 음표를 굽는다.
    if (next.activeLayer === 'L3' && !next.baked && project.activeLayer !== 'L3') {
      resolvedNext = bakeProjectMelody(next);
    }

    if (recordHistory && !tabOnly && !recompileAudioOnly) {
      history.push(prev);
    }

    project = resolvedNext;
    compiled = compileSong(project);
    if (appMode === 'free') {
      freeProject = cloneProject(project);
      saveProject(freeProject);
    }
    transport.updateSong(compiled, project.bpm, project.melodyInstrument, mutes);
    if (!recompileAudioOnly) {
      renderAll();
    } else if (appMode === 'lesson') {
      const newlyCompleted = syncLessonBanner();
      if (newlyCompleted) renderTopControls();
    }
  }

  function performUndo(): void {
    const restored = history.undo(project);
    if (!restored) return;
    updateState(restored, false, false);
  }

  function performRedo(): void {
    const restored = history.redo(project);
    if (!restored) return;
    updateState(restored, false, false);
  }

  function renderTopControls(): void {
    const keyOpts = NOTE_NAMES_SHARP.map(
      (n, idx) =>
        `<option value="${idx}"${idx === project.keyRoot ? ' selected' : ''}>${n} (${KOREAN_SOLFEGE[idx]})</option>`
    ).join('');

    topbarEl.innerHTML = `
      <div class="brand">
        <div class="brand-mark">M</div>
        <div>
          <div class="brand-title">Motif 작곡 스케치북</div>
          <div class="brand-sub">L1 블록 → L2 변형 체인 → L3 음표로 배우는 4/8마디 작곡</div>
        </div>
      </div>
      <div class="controls-row">
        <div class="mode-switch">
          <button class="mode-pill${appMode === 'free' ? ' active' : ''}" data-app-mode="free" type="button">자유 스케치</button>
          <button class="mode-pill${appMode === 'lesson' ? ' active' : ''}" data-app-mode="lesson" type="button">레슨 (${lessonProgress.completedIds.length}/${LESSONS.length})</button>
        </div>
        <button class="btn btn-primary btn-play${transport.isPlaying() ? ' playing' : ''}" id="btn-play" type="button">
          ${transport.isPlaying() ? '■ 정지 (Space)' : '▶ 재생 (Space)'}
        </button>
        <div class="ctrl-group">
          <span>키</span>
          <select id="sel-key">${keyOpts}</select>
          <select id="sel-mode">
            <option value="major"${project.mode === 'major' ? ' selected' : ''}>장조 (밝게)</option>
            <option value="minor"${project.mode === 'minor' ? ' selected' : ''}>단조 (차분)</option>
          </select>
        </div>
        <div class="ctrl-group">
          <span>마디</span>
          <select id="sel-bars">
            <option value="4"${project.bars === 4 ? ' selected' : ''}>4마디</option>
            <option value="8"${project.bars === 8 ? ' selected' : ''}>8마디</option>
          </select>
        </div>
        <div class="ctrl-group">
          <span>BPM</span>
          <strong id="bpm-val">${project.bpm}</strong>
          <input id="sl-bpm" type="range" min="60" max="150" step="2" value="${project.bpm}" style="width:76px;" />
        </div>
        <div class="ctrl-group">
          <span>선율 악기</span>
          <select id="sel-inst">
            <option value="piano"${project.melodyInstrument === 'piano' ? ' selected' : ''}>일렉 피아노</option>
            <option value="guitar"${project.melodyInstrument === 'guitar' ? ' selected' : ''}>어쿠스틱 기타</option>
          </select>
        </div>
        <button class="btn btn-chip${mutes.melody ? ' muted' : ''}" data-mute="melody" type="button">멜로디</button>
        <button class="btn btn-chip${mutes.chords ? ' muted' : ''}" data-mute="chords" type="button">코드</button>
        <button class="btn btn-chip${mutes.bass ? ' muted' : ''}" data-mute="bass" type="button">베이스</button>
        <button class="btn btn-chip${mutes.drums ? ' muted' : ''}" data-mute="drums" type="button">드럼</button>
        <button class="btn" id="btn-undo" type="button" title="되돌리기 (Ctrl+Z)"${history.canUndo() ? '' : ' disabled'}>↩ 되돌리기</button>
        <button class="btn" id="btn-redo" type="button" title="다시 실행 (Ctrl+Y)"${history.canRedo() ? '' : ' disabled'}>↪ 다시 실행</button>
        <button class="btn" id="btn-seed" type="button">새 변형 뽑기</button>
        <button class="btn" id="btn-midi" type="button">MIDI 저장</button>
      </div>
    `;

    topbarEl.querySelectorAll<HTMLButtonElement>('[data-app-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchMode(btn.dataset.appMode as AppMode);
      });
    });

    topbarEl.querySelector('#btn-play')?.addEventListener('click', () => {
      if (transport.isPlaying()) transport.stop();
      else transport.start(true);
      renderTopControls();
    });

    topbarEl.querySelector('#sel-key')?.addEventListener('change', (e) => {
      const next = cloneProject(project);
      next.keyRoot = Number((e.target as HTMLSelectElement).value);
      updateState(next);
    });

    topbarEl.querySelector('#sel-mode')?.addEventListener('change', (e) => {
      const next = cloneProject(project);
      next.mode = (e.target as HTMLSelectElement).value as ScaleMode;
      updateState(next);
    });

    topbarEl.querySelector('#sel-bars')?.addEventListener('change', (e) => {
      const next = cloneProject(project);
      next.bars = Number((e.target as HTMLSelectElement).value) as 4 | 8;
      next.baked = false;
      updateState(next);
    });

    topbarEl.querySelector('#sl-bpm')?.addEventListener('input', (e) => {
      const next = cloneProject(project);
      next.bpm = Number((e.target as HTMLInputElement).value);
      const valEl = topbarEl.querySelector('#bpm-val');
      if (valEl) valEl.textContent = String(next.bpm);
      project = next;
      if (appMode === 'free') {
        freeProject = cloneProject(project);
        saveProject(freeProject);
      }
      transport.updateSong(compiled, project.bpm, project.melodyInstrument, mutes);
    });

    topbarEl.querySelector('#sel-inst')?.addEventListener('change', (e) => {
      const next = cloneProject(project);
      next.melodyInstrument = (e.target as HTMLSelectElement).value as MelodyInstrument;
      updateState(next, true);
    });

    topbarEl.querySelectorAll<HTMLButtonElement>('[data-mute]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.mute as keyof TrackMuteState;
        mutes[key] = !mutes[key];
        transport.updateSong(compiled, project.bpm, project.melodyInstrument, mutes);
        renderTopControls();
      });
    });

    topbarEl.querySelector('#btn-undo')?.addEventListener('click', () => {
      performUndo();
    });

    topbarEl.querySelector('#btn-redo')?.addEventListener('click', () => {
      performRedo();
    });

    topbarEl.querySelector('#btn-seed')?.addEventListener('click', () => {
      const next = cloneProject(project);
      next.seed += 1;
      next.baked = false;
      updateState(next);
    });

    topbarEl.querySelector('#btn-midi')?.addEventListener('click', () => {
      downloadMidi(project);
    });
  }

  function auditionPitch(midi: number): void {
    const t0 = audio.currentTime + 0.01;
    if (project.melodyInstrument === 'guitar') {
      audio.playGuitar(midi, t0, 0.55, 0.78, 0.25);
    } else {
      audio.playPiano(midi, t0, 0.55, 0.78, 0.28);
    }
  }

  function renderDynamicParts(): void {
    const activeBar = activeStep >= 0 ? Math.floor(activeStep / 16) : -1;
    renderGuitarStrip(stripEl, compiled.resolvedChords, activeBar, (chord) => {
      audio.auditionChord(chord.voicingMidi, 'guitar');
    });

    renderLayerEditor(mainEl, project, compiled, activeStep, {
      selectedDuration,
      onSelectDuration: (steps) => {
        selectedDuration = steps;
        renderDynamicParts();
      },
      onProjectChange: (next, audioOnly) => updateState(next, audioOnly),
      onAuditionPitch: auditionPitch,
      onPreviewModifier: (modId: ModifierId, after: boolean) => {
        const diff = previewModifierDiff(project, modId);
        transport.playOncePreview(after ? diff.after : diff.before, project.bpm, project.melodyInstrument, mutes);
        renderTopControls();
      },
    });
  }

  function syncLessonBanner(report = analyzeSong(compiled, project)): boolean {
    if (appMode !== 'lesson') {
      lessonBannerEl.hidden = true;
      lessonBannerEl.innerHTML = '';
      return false;
    }
    lessonBannerEl.hidden = false;
    const lesson = getLessonById(lessonProgress.activeLessonId);
    const evaluation = evaluateLesson(lesson.id, project, compiled, report);
    let newlyCompleted = false;
    if (evaluation.passed && !lessonProgress.completedIds.includes(lesson.id)) {
      lessonProgress = {
        ...lessonProgress,
        completedIds: [...lessonProgress.completedIds, lesson.id],
      };
      saveLessonProgress(lessonProgress);
      newlyCompleted = true;
    }

    renderLessonBanner(
      lessonBannerEl,
      lesson,
      evaluation,
      new Set(lessonProgress.completedIds),
      showLessonHint,
      {
        onSelectLesson: (id) => selectLesson(id),
        onToggleHint: () => {
          showLessonHint = !showLessonHint;
          syncLessonBanner();
        },
        onResetLesson: () => {
          showLessonHint = false;
          loadWorkspaceProject(createLessonProject(lesson.id));
        },
        onNextLesson: () => {
          const idx = LESSONS.findIndex((l) => l.id === lesson.id);
          const nextLesson = LESSONS[idx + 1];
          if (nextLesson) selectLesson(nextLesson.id);
        },
        onExitToFree: () => switchMode('free'),
      }
    );
    return newlyCompleted;
  }

  function renderAll(): void {
    const report = analyzeSong(compiled, project);
    syncLessonBanner(report);
    renderTopControls();
    renderDynamicParts();
    renderCoachPanel(coachEl, report, {
      onPreviewIssueFix: (issue) => {
        const previewProj = issue.applyFix(project);
        const previewCompiled = compileSong(previewProj);
        transport.playOncePreview(previewCompiled, project.bpm, project.melodyInstrument, mutes);
        renderTopControls();
      },
      onApplyIssueFix: (issue) => {
        const fixed = issue.applyFix(project);
        fixed.activeLayer = 'L3';
        updateState(fixed);
      },
    });
  }

  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT') return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        performUndo();
        return;
      }
      if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        performRedo();
        return;
      }
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (transport.isPlaying()) transport.stop();
      else transport.start(true);
      renderTopControls();
      return;
    }
    const midi = PC_KEYBOARD_NOTES[e.key.toLowerCase()];
    if (midi && !e.repeat) {
      auditionPitch(midi);
    }
  });

  renderAll();
}

init();
