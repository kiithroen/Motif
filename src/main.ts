import './styles.css';
import { Capacitor } from '@capacitor/core';
import { CoachController } from './app/coachController';
import { bindAppShortcuts } from './app/shortcuts';
import {
  type AppMode,
  BASICS_STORAGE_KEY,
  LESSON_STORAGE_KEY,
  downloadMidi,
  downloadTextFile,
  loadInitialChordView,
  loadInitialLibrary,
  loadInitialMode,
  loadProgress,
  loadTrackVolumes,
  saveChordView,
  saveLibrary,
  saveMode,
  saveProgress,
  saveTrackVolumes,
} from './app/storage';
import { MotifAudioEngine, type SampleLoadStatus } from './audio/instruments';
import { MotifTransport, type TrackMuteState } from './audio/transport';
import { analyzeSong } from './core/analyzer';
import {
  BASIC_LESSONS,
  type CompareDemo,
  compileCompareDemo,
  createBasicLessonProject,
  evaluateBasicLesson,
  getBasicLessonById,
} from './core/basics';
import {
  bakeProjectMelody,
  compileSong,
  previewModifierDiff,
  resizeProjectBars,
  unpackBlocksToChain,
} from './core/compiler';
import { ProjectHistory } from './core/history';
import { LESSONS, createLessonProject, evaluateLesson, getLessonById } from './core/lesson';
import {
  type BarCount,
  type ChordInstrument,
  type MelodyInstrument,
  type ModifierId,
  PRESETS,
  type SongProject,
  type TrackKey,
  type TrackVolumes,
  cloneProject,
} from './core/model';
import {
  buildBackupFilename,
  createSongSlot,
  deleteSongSlot,
  duplicateSongSlot,
  getActiveSlot,
  importBackupIntoLibrary,
  renameSongSlot,
  selectSongSlot,
  serializeLibraryBackup,
  serializeSongBackup,
  updateActiveSlotProject,
} from './core/projectLibrary';
import {
  type LoopBarRange,
  type MetronomeState,
  applyDrumMuteToMetronome,
  clampLoopRangeOnBarResize,
  clampTrackVolume,
  createDefaultMetronomeState,
  createDefaultTrackMutes,
  createDefaultTrackVolumes,
  normalizeLoopRange,
  toggleMetronomeManual,
} from './core/playbackControl';
import { KOREAN_SOLFEGE, NOTE_NAMES_SHARP, type ScaleMode } from './core/theory';
import { renderBasicsCourseMap, renderBasicsView, updateBasicsPlayButton } from './ui/basicsView';
import { renderCoachPanel } from './ui/coachPanel';
import { renderGuitarStrip, updateGuitarStripActiveBar } from './ui/guitarStrip';
import { type ProjectChangeOptions, renderLayerEditor, updatePianoRollPlayhead } from './ui/layers';
import { renderLessonBanner, renderLessonCourseMap } from './ui/lessonPanel';
import { type SongLibraryUiState, renderSongLibraryBar } from './ui/songLibraryBar';

function init(): void {
  const root = document.getElementById('app');
  if (!root) return;

  let appMode: AppMode = loadInitialMode();
  let chordView: ChordInstrument = loadInitialChordView();
  let basicsScreen: 'map' | 'lesson' = 'map';
  let lessonScreen: 'map' | 'lesson' = 'map';
  let songLibrary = loadInitialLibrary();
  const songLibraryUiState: SongLibraryUiState = {
    drawerOpen: false,
    confirmDeleteSlotId: null,
    notice: null,
  };
  let basicsProgress = loadProgress(BASICS_STORAGE_KEY, BASIC_LESSONS);
  let lessonProgress = loadProgress(LESSON_STORAGE_KEY, LESSONS);
  let showBasicsHint = false;
  let showLessonHint = false;
  let selectedPickBar = 0;

  let project =
    appMode === 'basics'
      ? createBasicLessonProject(basicsProgress.activeLessonId)
      : appMode === 'lesson'
        ? createLessonProject(lessonProgress.activeLessonId)
        : cloneProject(getActiveSlot(songLibrary).project);
  let compiled = compileSong(project, chordView);
  let activeStep = -1;
  let selectedDuration = PRESETS.defaults.noteDurationSteps;
  let preserveBakedOnChordChange = true;
  const history = new ProjectHistory();
  const mutes: TrackMuteState = createDefaultTrackMutes();
  let volumes: TrackVolumes = loadTrackVolumes();
  let metronome: MetronomeState = createDefaultMetronomeState();
  let mixerOpen = false;
  let mobileToolsOpen = false;
  let loopRange: LoopBarRange | null = null;

  const audio = new MotifAudioEngine();
  const transport = new MotifTransport(audio, compiled, {
    onStep: (step) => {
      activeStep = step;
      if (appMode === 'basics') {
        updatePianoRollPlayhead(basicsRootEl, activeStep, compiled.totalSteps);
        return;
      }
      const activeBar = activeStep >= 0 ? Math.floor(activeStep / 16) : -1;
      updateGuitarStripActiveBar(stripEl, activeBar);
      updatePianoRollPlayhead(mainEl, activeStep, compiled.totalSteps);
    },
    onStop: () => {
      coachController.handleTransportStop(coachEl);
      renderTopControls();
      if (appMode === 'basics') {
        updateBasicsPlayButton(basicsRootEl, false);
      }
      updateMobileDockPlayState();
    },
  });
  transport.setTrackVolumes(volumes);
  transport.setMetronome(metronome.enabled);

  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar" id="topbar"></header>
      <section class="basics-root" id="basics-root" hidden></section>
      <section class="basics-root" id="lesson-map-root" hidden></section>
      <div class="sandbox-root" id="sandbox-root" hidden>
        <section class="lesson-banner" id="lesson-banner" hidden></section>
        <section class="song-library-bar" id="song-library-bar" hidden></section>
        <section class="chord-strip" id="chord-strip"></section>
        <main class="workspace-grid">
          <section class="main-panel" id="main-panel"></section>
          <aside class="coach-panel" id="coach-panel"></aside>
        </main>
      </div>
      <nav class="mobile-thumb-dock" id="mobile-thumb-dock" aria-label="모바일 빠른 제어 바" hidden></nav>
    </div>
  `;

  const topbarEl = document.getElementById('topbar')!;
  const basicsRootEl = document.getElementById('basics-root')!;
  const lessonMapRootEl = document.getElementById('lesson-map-root')!;
  const sandboxRootEl = document.getElementById('sandbox-root')!;
  const lessonBannerEl = document.getElementById('lesson-banner')!;
  const songLibraryEl = document.getElementById('song-library-bar')!;
  const stripEl = document.getElementById('chord-strip')!;
  const mainEl = document.getElementById('main-panel')!;
  const coachEl = document.getElementById('coach-panel')!;
  const mobileDockEl = document.getElementById('mobile-thumb-dock')!;

  function updateAudioBadge(status: SampleLoadStatus): void {
    const badge = topbarEl.querySelector<HTMLElement>('#audio-status-badge');
    if (!badge) return;
    badge.className = `audio-status-badge ${status}`;
    if (status === 'idle') {
      badge.hidden = true;
      badge.textContent = '';
      return;
    }
    badge.hidden = false;
    if (status === 'loading') {
      badge.textContent = '음원 로딩 중...';
    } else if (status === 'ready') {
      badge.textContent = '실제 악기 음원';
    } else {
      badge.textContent = '기본 신스 음원';
    }
  }

  audio.onSampleStatusChange((status) => {
    updateAudioBadge(status);
  });

  const handleFirstGesture = (): void => {
    audio.preload();
  };
  window.addEventListener('pointerdown', handleFirstGesture, { once: true });
  window.addEventListener('keydown', handleFirstGesture, { once: true });

  function isTabOnlyChange(prev: SongProject, next: SongProject): boolean {
    if (prev.activeLayer === next.activeLayer) return false;
    const normalizedPrev = { ...prev, activeLayer: next.activeLayer };
    return JSON.stringify(normalizedPrev) === JSON.stringify(next);
  }

  const coachController = new CoachController({
    getProject: () => project,
    getCompiled: () => compiled,
    getChordView: () => chordView,
    isBasicsMode: () => appMode === 'basics',
    playOncePreview: (previewCompiled) => {
      transport.playOncePreview(
        previewCompiled,
        project.bpm,
        project.melodyInstrument,
        mutes,
        chordView
      );
    },
    onApplyProject: (next) => updateState(next),
    onRenderDynamicParts: () => renderDynamicParts(),
    onRenderTopControls: () => renderTopControls(),
    onRenderCoach: (report) => renderCoachSection(report),
  });

  function loadWorkspaceProject(target: SongProject): void {
    transport.stop();
    coachController.resetForProjectLoad();
    history.clear();
    activeStep = -1;
    loopRange = null;
    transport.setLoopRange(null);
    project = cloneProject(target);
    compiled = compileSong(project, chordView);
    transport.updateSong(compiled, project.bpm, project.melodyInstrument, mutes, chordView, volumes);
    renderAll();
  }

  function switchMode(mode: AppMode): void {
    if (mode === appMode) {
      if (mode === 'basics' && basicsScreen !== 'map') {
        basicsScreen = 'map';
        transport.stop();
        renderAll();
      } else if (mode === 'lesson' && lessonScreen !== 'map') {
        lessonScreen = 'map';
        transport.stop();
        renderAll();
      }
      return;
    }
    appMode = mode;
    saveMode(mode);
    showBasicsHint = false;
    showLessonHint = false;
    selectedPickBar = 0;
    songLibraryUiState.confirmDeleteSlotId = null;
    if (mode === 'basics') {
      basicsScreen = 'map';
      loadWorkspaceProject(createBasicLessonProject(basicsProgress.activeLessonId));
    } else if (mode === 'lesson') {
      lessonScreen = 'map';
      loadWorkspaceProject(createLessonProject(lessonProgress.activeLessonId));
    } else {
      loadWorkspaceProject(getActiveSlot(songLibrary).project);
    }
  }

  function selectBasicLesson(lessonId: string): void {
    basicsProgress = { ...basicsProgress, activeLessonId: lessonId };
    saveProgress(BASICS_STORAGE_KEY, basicsProgress);
    basicsScreen = 'lesson';
    showBasicsHint = false;
    selectedPickBar = 0;
    if (appMode !== 'basics') {
      appMode = 'basics';
      saveMode('basics');
    }
    loadWorkspaceProject(createBasicLessonProject(lessonId));
  }

  function reviewRandomCompletedBasic(): void {
    const done = basicsProgress.completedIds;
    if (done.length === 0) return;
    const pool = done.length > 1 ? done.filter((id) => id !== basicsProgress.activeLessonId) : done;
    const picked = pool[Math.floor(Math.random() * pool.length)] ?? done[0];
    selectBasicLesson(picked);
  }

  function selectLesson(lessonId: string): void {
    lessonProgress = { ...lessonProgress, activeLessonId: lessonId };
    saveProgress(LESSON_STORAGE_KEY, lessonProgress);
    lessonScreen = 'lesson';
    showLessonHint = false;
    if (appMode !== 'lesson') {
      appMode = 'lesson';
      saveMode('lesson');
    }
    loadWorkspaceProject(createLessonProject(lessonId));
  }

  function reviewRandomCompletedLesson(): void {
    const done = lessonProgress.completedIds;
    if (done.length === 0) return;
    const pool = done.length > 1 ? done.filter((id) => id !== lessonProgress.activeLessonId) : done;
    const picked = pool[Math.floor(Math.random() * pool.length)] ?? done[0];
    selectLesson(picked);
  }

  function openProjectInFreeSketch(source: SongProject, suggestedName?: string): void {
    const next = cloneProject(source);
    next.activeLayer = 'L3';
    const created = createSongSlot(songLibrary, {
      name: suggestedName,
      project: next,
    });
    if (created.ok) {
      songLibrary = created.library;
      songLibraryUiState.notice = {
        kind: 'info',
        text: `'${created.slot.name}' 슬롯을 새로 만들어 열었다.`,
      };
    } else {
      songLibrary = updateActiveSlotProject(songLibrary, next);
      songLibraryUiState.notice = {
        kind: 'info',
        text: `슬롯이 가득 차서 현재 슬롯('${getActiveSlot(songLibrary).name}')에 열어두었다.`,
      };
    }
    songLibraryUiState.confirmDeleteSlotId = null;
    saveLibrary(songLibrary);
    appMode = 'free';
    saveMode('free');
    loadWorkspaceProject(getActiveSlot(songLibrary).project);
  }

  function updateState(
    next: SongProject,
    optionsOrAudioOnly: boolean | ProjectChangeOptions = false,
    recordHistoryArg = true
  ): void {
    const opts: ProjectChangeOptions =
      typeof optionsOrAudioOnly === 'boolean'
        ? { recompileAudioOnly: optionsOrAudioOnly, recordHistory: recordHistoryArg }
        : optionsOrAudioOnly;
    const recompileAudioOnly = opts.recompileAudioOnly ?? false;
    const recordHistory = opts.recordHistory ?? true;
    const prev = project;
    const tabOnly = isTabOnlyChange(prev, next);

    // L1 블록의 progressionId 변경 시 L2 코드 슬롯도 동기화한다.
    if (
      appMode !== 'basics' &&
      (next.blocks.progressionId !== project.blocks.progressionId || next.bars !== project.bars)
    ) {
      next.chain = unpackBlocksToChain(next.blocks, next.bars, next.chain.modifiers);
    }

    let resolvedNext = next;
    // L2 -> L3 탭 전환 시 아직 구워지지 않았으면 자동으로 음표를 굽는다.
    if (appMode !== 'basics' && next.activeLayer === 'L3' && !next.baked && project.activeLayer !== 'L3') {
      resolvedNext = bakeProjectMelody(next);
    }

    if (recordHistory && !tabOnly && !recompileAudioOnly) {
      history.push(opts.historyBase ?? prev);
    }

    if (!tabOnly && !recompileAudioOnly) {
      coachController.invalidateSuggestion();
    }

    if (next.bars !== project.bars) {
      loopRange = clampLoopRangeOnBarResize(loopRange, next.bars);
      transport.setLoopRange(loopRange);
    }

    project = resolvedNext;
    compiled = compileSong(project, chordView);
    if (appMode === 'free') {
      songLibrary = updateActiveSlotProject(songLibrary, project);
      saveLibrary(songLibrary);
    }
    transport.updateSong(compiled, project.bpm, project.melodyInstrument, mutes, chordView, volumes);
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

  function togglePlayback(): void {
    if (transport.isPlaying()) transport.stop();
    else transport.start(true);
    renderTopControls();
    if (appMode === 'basics') {
      updateBasicsPlayButton(basicsRootEl, transport.isPlaying());
    }
  }

  function setChordView(nextView: ChordInstrument): void {
    if (nextView === chordView) return;
    chordView = nextView;
    saveChordView(chordView);
    compiled = compileSong(project, chordView);
    transport.updateSong(compiled, project.bpm, project.melodyInstrument, mutes, chordView, volumes);
    renderAll();
  }

  function toggleTrackMute(key: TrackKey): void {
    mutes[key] = !mutes[key];
    if (key === 'drums') {
      metronome = applyDrumMuteToMetronome(metronome, mutes.drums);
      transport.setMetronome(metronome.enabled);
    }
    transport.updateSong(compiled, project.bpm, project.melodyInstrument, mutes, chordView, volumes);
    renderTopControls();
  }

  function toggleMetronome(): void {
    metronome = toggleMetronomeManual(metronome);
    transport.setMetronome(metronome.enabled);
    renderTopControls();
  }

  function seekToBar(barIdx: number): void {
    transport.seekToBar(barIdx);
    renderTopControls();
    if (appMode === 'basics') {
      updateBasicsPlayButton(basicsRootEl, transport.isPlaying());
    }
  }

  function setLoopRange(nextRange: LoopBarRange | null): void {
    loopRange = normalizeLoopRange(nextRange, project.bars);
    transport.setLoopRange(loopRange);
    if (appMode === 'basics') {
      renderBasicsMode();
    } else {
      renderDynamicParts();
    }
  }

  function updateMobileDockPlayState(): void {
    const dockPlayBtn = mobileDockEl.querySelector<HTMLButtonElement>('#dock-play');
    if (!dockPlayBtn) return;
    const playing = transport.isPlaying();
    dockPlayBtn.classList.toggle('playing', playing);
    dockPlayBtn.textContent = playing ? '■ 정지' : '▶ 재생';
  }

  function renderMobileThumbDock(report = analyzeSong(compiled, project)): void {
    const isCourseMap =
      (appMode === 'basics' && basicsScreen === 'map') ||
      (appMode === 'lesson' && lessonScreen === 'map');
    if (isCourseMap) {
      mobileDockEl.hidden = true;
      mobileDockEl.innerHTML = '';
      return;
    }

    mobileDockEl.hidden = false;
    const playing = transport.isPlaying();
    const isBasics = appMode === 'basics';
    const rightActionHtml = isBasics
      ? `<button class="btn mobile-dock-btn" id="dock-hint" type="button">${showBasicsHint ? '힌트 닫기' : '힌트'}</button>`
      : `
          <button class="btn mobile-dock-btn" id="dock-redo" type="button"${history.canRedo() ? '' : ' disabled'}>↪ 다시</button>
          <button class="btn mobile-dock-btn mobile-dock-coach" id="dock-coach" type="button">코치 ${report.score}점</button>
        `;

    mobileDockEl.innerHTML = `
      <button class="btn btn-primary btn-play mobile-dock-btn${playing ? ' playing' : ''}" id="dock-play" type="button">
        ${playing ? '■ 정지' : '▶ 재생'}
      </button>
      <button class="btn mobile-dock-btn" id="dock-undo" type="button"${history.canUndo() ? '' : ' disabled'}>↩ 되돌리기</button>
      ${rightActionHtml}
    `;

    mobileDockEl.querySelector('#dock-play')?.addEventListener('click', () => {
      togglePlayback();
    });
    mobileDockEl.querySelector('#dock-undo')?.addEventListener('click', () => {
      performUndo();
    });
    mobileDockEl.querySelector('#dock-redo')?.addEventListener('click', () => {
      performRedo();
    });
    mobileDockEl.querySelector('#dock-hint')?.addEventListener('click', () => {
      showBasicsHint = !showBasicsHint;
      renderBasicsMode();
    });
    mobileDockEl.querySelector('#dock-coach')?.addEventListener('click', () => {
      coachEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function renderTopControls(): void {
    const chordSwitchHtml = `
      <div class="chord-view-switch" title="코드 그림 및 화음 반주 악기 전환">
        <button class="mode-pill${chordView === 'piano' ? ' active' : ''}" data-chord-view="piano" type="button">건반</button>
        <button class="mode-pill${chordView === 'guitar' ? ' active' : ''}" data-chord-view="guitar" type="button">기타</button>
      </div>
    `;

    const modeSwitchHtml = `
      <div class="mode-switch">
        <button class="mode-pill${appMode === 'basics' ? ' active' : ''}" data-app-mode="basics" type="button">기초 입문 (${basicsProgress.completedIds.length}/${BASIC_LESSONS.length})</button>
        <button class="mode-pill${appMode === 'lesson' ? ' active' : ''}" data-app-mode="lesson" type="button">실전 미션 (${lessonProgress.completedIds.length}/${LESSONS.length})</button>
        <button class="mode-pill${appMode === 'free' ? ' active' : ''}" data-app-mode="free" type="button">자유 스케치</button>
      </div>
    `;

    const topbarRightHtml = `<div class="topbar-right"><span class="audio-status-badge" id="audio-status-badge" hidden></span>${chordSwitchHtml}${modeSwitchHtml}</div>`;

    if (appMode === 'basics' || (appMode === 'lesson' && lessonScreen === 'map')) {
      const subText =
        appMode === 'basics'
          ? '귀로 원리를 듣고 내 손으로 한 음씩 쌓는 기초 학습 코스'
          : `4유닛 ${LESSONS.length}강 실전 미션에서 원하는 단원을 골라 도전한다`;
      topbarEl.innerHTML = `
        <div class="topbar-main">
          <div class="brand">
            <div class="brand-mark">M</div>
            <div>
              <div class="brand-title">Motif 작곡 스케치북</div>
              <div class="brand-sub">${subText}</div>
            </div>
          </div>
          ${topbarRightHtml}
        </div>
      `;
      updateAudioBadge(audio.getSampleStatus());
      topbarEl.querySelectorAll<HTMLButtonElement>('[data-chord-view]').forEach((btn) => {
        btn.addEventListener('click', () => {
          setChordView(btn.dataset.chordView as ChordInstrument);
        });
      });

      topbarEl.querySelectorAll<HTMLButtonElement>('[data-app-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          switchMode(btn.dataset.appMode as AppMode);
        });
      });
      renderMobileThumbDock();
      return;
    }

    const keyOpts = NOTE_NAMES_SHARP.map(
      (n, idx) =>
        `<option value="${idx}"${idx === project.keyRoot ? ' selected' : ''}>${n} (${KOREAN_SOLFEGE[idx]})</option>`
    ).join('');

    const mixerTracks: Array<{ key: TrackKey; label: string }> = [
      { key: 'melody', label: '멜로디' },
      { key: 'chords', label: '코드' },
      { key: 'bass', label: '베이스' },
      { key: 'drums', label: '드럼' },
    ];
    const { min: mixMin, max: mixMax, step: mixStep } = PRESETS.playback.mixer;
    const metronomeLabel = metronome.enabled
      ? metronome.autoActivated
        ? '메트로놈 (자동)'
        : '메트로놈 켜짐'
      : '메트로놈';

    const mixerPanelHtml = mixerOpen
      ? `
        <div class="topbar-mixer" id="topbar-mixer">
          <div class="mixer-grid">
            ${mixerTracks
              .map(
                (t) => `
                  <div class="mixer-channel${mutes[t.key] ? ' muted' : ''}" data-mix-channel="${t.key}">
                    <div class="mixer-channel-head">
                      <span>${t.label}</span>
                      <div class="controls-row" style="gap:4px;">
                        <strong id="mix-val-${t.key}">${Math.round(volumes[t.key] * 100)}%</strong>
                        <button class="btn btn-chip${mutes[t.key] ? ' muted' : ''}" data-mix-mute="${t.key}" type="button">${mutes[t.key] ? '음소거됨' : '음소거'}</button>
                      </div>
                    </div>
                    <input
                      class="sl-mix"
                      data-mix-track="${t.key}"
                      type="range"
                      min="${mixMin}"
                      max="${mixMax}"
                      step="${mixStep}"
                      value="${volumes[t.key]}"
                    />
                  </div>
                `
              )
              .join('')}
          </div>
          <div class="mixer-footer">
            <span>드럼을 음소거하면 박자 기준을 유지하도록 메트로놈이 자동으로 켜진다.</span>
            <button class="btn btn-chip" id="btn-mixer-reset" type="button">믹서 초기화</button>
          </div>
        </div>
      `
      : '';

    const mobileSummaryLabel = `${NOTE_NAMES_SHARP[project.keyRoot]} ${project.mode === 'major' ? '장' : '단'} · ${project.bars}마디 · ${project.bpm}BPM ${mobileToolsOpen ? '▲' : '▼'}`;

    topbarEl.innerHTML = `
      <div class="topbar-main">
        <div class="brand">
          <div class="brand-mark">M</div>
          <div>
            <div class="brand-title">Motif 작곡 스케치북</div>
            <div class="brand-sub">L1 블록 → L2 변형 체인 → L3 음표로 배우는 4/8마디 작곡</div>
          </div>
        </div>
      ${topbarRightHtml}
      </div>
      <div class="controls-row topbar-tools">
        <div class="controls-row topbar-tools-primary">
          <button class="btn btn-primary btn-play${transport.isPlaying() ? ' playing' : ''}" id="btn-play" type="button">
            ${transport.isPlaying() ? '■ 정지' : '▶ 재생'}<span class="kb-hint"> (Space)</span>
          </button>
          <button class="btn" id="btn-undo" type="button" title="되돌리기 (Ctrl+Z)"${history.canUndo() ? '' : ' disabled'}>↩ 되돌리기</button>
          <button class="btn" id="btn-redo" type="button" title="다시 실행 (Ctrl+Y)"${history.canRedo() ? '' : ' disabled'}>↪ 다시 실행</button>
          <button class="btn btn-chip${mixerOpen ? ' active' : ''}" id="btn-mixer-toggle" type="button" title="트랙별 볼륨 믹서 열기/닫기">믹서</button>
          <button class="btn btn-chip mobile-tools-toggle${mobileToolsOpen ? ' active' : ''}" id="btn-mobile-tools-toggle" type="button" aria-expanded="${mobileToolsOpen ? 'true' : 'false'}">${mobileSummaryLabel}</button>
        </div>
        <div class="controls-row topbar-tools-extra${mobileToolsOpen ? ' open' : ''}">
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
              <option value="16"${project.bars === 16 ? ' selected' : ''}>16마디 (A/B)</option>
            </select>
          </div>
          <div class="ctrl-group">
            <span>BPM</span>
            <strong id="bpm-val">${project.bpm}</strong>
            <input id="sl-bpm" type="range" min="${PRESETS.library.bpmMin}" max="${PRESETS.library.bpmMax}" step="2" value="${project.bpm}" style="width:60px;" />
          </div>
          <div class="ctrl-group">
            <span>선율 악기</span>
            <select id="sel-inst">
              <option value="piano"${project.melodyInstrument === 'piano' ? ' selected' : ''}>그랜드 피아노</option>
              <option value="guitar"${project.melodyInstrument === 'guitar' ? ' selected' : ''}>나일론 기타</option>
            </select>
          </div>
          <button class="btn btn-chip${mutes.melody ? ' muted' : ''}" data-mute="melody" type="button">멜로디</button>
          <button class="btn btn-chip${mutes.chords ? ' muted' : ''}" data-mute="chords" type="button">코드</button>
          <button class="btn btn-chip${mutes.bass ? ' muted' : ''}" data-mute="bass" type="button">베이스</button>
          <button class="btn btn-chip${mutes.drums ? ' muted' : ''}" data-mute="drums" type="button">드럼</button>
          <button class="btn btn-chip${metronome.enabled ? ' active' : ''}" id="btn-metronome" type="button" title="드럼 음소거 시 자동으로 켜지며 수동으로도 전환할 수 있다">${metronomeLabel}</button>
          <button class="btn" id="btn-seed" type="button" title="랜덤 초안 다시 뽑기">랜덤 초안</button>
          <button class="btn" id="btn-midi" type="button">MIDI 저장</button>
        </div>
      </div>
      ${mixerPanelHtml}
    `;

    updateAudioBadge(audio.getSampleStatus());
    renderMobileThumbDock();

    topbarEl.querySelector('#btn-mobile-tools-toggle')?.addEventListener('click', () => {
      mobileToolsOpen = !mobileToolsOpen;
      renderTopControls();
    });

    topbarEl.querySelectorAll<HTMLButtonElement>('[data-chord-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setChordView(btn.dataset.chordView as ChordInstrument);
      });
    });

    topbarEl.querySelectorAll<HTMLButtonElement>('[data-app-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchMode(btn.dataset.appMode as AppMode);
      });
    });

    topbarEl.querySelector('#btn-play')?.addEventListener('click', () => {
      togglePlayback();
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
      const nextBars = Number((e.target as HTMLSelectElement).value) as BarCount;
      const next = resizeProjectBars(project, nextBars);
      if (loopRange) {
        loopRange = normalizeLoopRange(loopRange, next.bars);
      }
      updateState(next);
    });

    let bpmStart: SongProject | null = null;
    const bpmSlider = topbarEl.querySelector<HTMLInputElement>('#sl-bpm');
    bpmSlider?.addEventListener('input', () => {
      if (!bpmStart) bpmStart = cloneProject(project);
      const next = cloneProject(project);
      next.bpm = Number(bpmSlider.value);
      const valEl = topbarEl.querySelector('#bpm-val');
      if (valEl) valEl.textContent = String(next.bpm);
      updateState(next, { recompileAudioOnly: true, recordHistory: false });
    });
    bpmSlider?.addEventListener('change', () => {
      if (!bpmStart) bpmStart = cloneProject(project);
      const next = cloneProject(project);
      next.bpm = Number(bpmSlider.value);
      const historyBase = bpmStart;
      bpmStart = null;
      updateState(next, { recompileAudioOnly: false, recordHistory: true, historyBase });
    });

    topbarEl.querySelector('#sel-inst')?.addEventListener('change', (e) => {
      const next = cloneProject(project);
      next.melodyInstrument = (e.target as HTMLSelectElement).value as MelodyInstrument;
      updateState(next, true);
    });

    topbarEl.querySelectorAll<HTMLButtonElement>('[data-mute]').forEach((btn) => {
      btn.addEventListener('click', () => {
        toggleTrackMute(btn.dataset.mute as TrackKey);
      });
    });

    topbarEl.querySelectorAll<HTMLButtonElement>('[data-mix-mute]').forEach((btn) => {
      btn.addEventListener('click', () => {
        toggleTrackMute(btn.dataset.mixMute as TrackKey);
      });
    });

    topbarEl.querySelector('#btn-metronome')?.addEventListener('click', () => {
      toggleMetronome();
    });

    topbarEl.querySelector('#btn-mixer-toggle')?.addEventListener('click', () => {
      mixerOpen = !mixerOpen;
      renderTopControls();
    });

    topbarEl.querySelectorAll<HTMLInputElement>('.sl-mix').forEach((sl) => {
      const track = sl.dataset.mixTrack as TrackKey;
      sl.addEventListener('input', () => {
        volumes = {
          ...volumes,
          [track]: clampTrackVolume(Number(sl.value)),
        };
        const valEl = topbarEl.querySelector(`#mix-val-${track}`);
        if (valEl) valEl.textContent = `${Math.round(volumes[track] * 100)}%`;
        transport.setTrackVolumes(volumes);
      });
      sl.addEventListener('change', () => {
        volumes = {
          ...volumes,
          [track]: clampTrackVolume(Number(sl.value)),
        };
        transport.setTrackVolumes(volumes);
        saveTrackVolumes(volumes);
      });
    });

    topbarEl.querySelector('#btn-mixer-reset')?.addEventListener('click', () => {
      volumes = createDefaultTrackVolumes();
      mutes.melody = false;
      mutes.chords = false;
      mutes.bass = false;
      mutes.drums = false;
      metronome = applyDrumMuteToMetronome(metronome, false);
      saveTrackVolumes(volumes);
      transport.setMetronome(metronome.enabled);
      transport.updateSong(compiled, project.bpm, project.melodyInstrument, mutes, chordView, volumes);
      renderTopControls();
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
      void downloadMidi(compiled, project, chordView).catch(() => undefined);
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

  function auditionChordWithNote(voicingMidi: number[], midi: number): void {
    audio.auditionChord(voicingMidi, chordView);
    audio.playPiano(midi, audio.currentTime + 0.04, 0.9, 0.85, 0.25);
  }

  function renderDynamicParts(): void {
    const activeBar = activeStep >= 0 ? Math.floor(activeStep / 16) : -1;
    renderGuitarStrip(
      stripEl,
      compiled.resolvedChords,
      activeBar,
      (chord) => {
        audio.auditionChord(chord.voicingMidi, chordView);
      },
      chordView
    );

    renderLayerEditor(mainEl, project, compiled, activeStep, {
      selectedDuration,
      chordView,
      loopRange,
      preserveBakedOnChordChange,
      coachCompare: coachController.getVisualCompare(),
      coachCompareActive: coachController.isComparePreviewActive(),
      onSelectDuration: (steps) => {
        selectedDuration = steps;
        renderDynamicParts();
      },
      onTogglePreserveBaked: (preserve) => {
        preserveBakedOnChordChange = preserve;
        renderDynamicParts();
      },
      onProjectChange: (next, options) => updateState(next, options),
      onAuditionPitch: auditionPitch,
      onSeekBar: seekToBar,
      onLoopRangeChange: setLoopRange,
      onDismissCoachCompare: () => coachController.dismissVisualCompare(),
      onPreviewModifier: (modId: ModifierId, after: boolean) => {
        const diff = previewModifierDiff(project, modId, chordView);
        transport.playOncePreview(
          after ? diff.after : diff.before,
          project.bpm,
          project.melodyInstrument,
          mutes,
          chordView
        );
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
      saveProgress(LESSON_STORAGE_KEY, lessonProgress);
      newlyCompleted = true;
    }

    renderLessonBanner(
      lessonBannerEl,
      lesson,
      evaluation,
      showLessonHint,
      {
        onBackToMap: () => {
          lessonScreen = 'map';
          transport.stop();
          renderAll();
        },
        onPrevLesson: () => {
          const idx = LESSONS.findIndex((l) => l.id === lesson.id);
          const prevLesson = LESSONS[idx - 1];
          if (prevLesson) selectLesson(prevLesson.id);
        },
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

  function renderBasicsMode(report = analyzeSong(compiled, project)): void {
    if (basicsScreen === 'map') {
      renderBasicsCourseMap(
        basicsRootEl,
        new Set(basicsProgress.completedIds),
        basicsProgress.activeLessonId,
        {
          onStartLesson: (id) => selectBasicLesson(id),
          onResumeActive: () => selectBasicLesson(basicsProgress.activeLessonId),
          onReviewRandomCompleted: reviewRandomCompletedBasic,
        }
      );
      return;
    }

    const lesson = getBasicLessonById(basicsProgress.activeLessonId);
    const evaluation = evaluateBasicLesson(lesson.id, project, compiled, report);
    if (evaluation.passed && !basicsProgress.completedIds.includes(lesson.id)) {
      basicsProgress = {
        ...basicsProgress,
        completedIds: [...basicsProgress.completedIds, lesson.id],
      };
      saveProgress(BASICS_STORAGE_KEY, basicsProgress);
    }

    renderBasicsView(
      basicsRootEl,
      lesson,
      project,
      compiled,
      evaluation,
      {
        completedIds: new Set(basicsProgress.completedIds),
        activeStep,
        isPlaying: transport.isPlaying(),
        showHint: showBasicsHint,
        canUndo: history.canUndo(),
        selectedDuration,
        selectedPickBar,
        chordView,
        loopRange,
      },
      {
        onBackToMap: () => {
          basicsScreen = 'map';
          transport.stop();
          renderAll();
        },
        onPrevLesson: () => {
          const idx = BASIC_LESSONS.findIndex((l) => l.id === lesson.id);
          const prevLesson = BASIC_LESSONS[idx - 1];
          if (prevLesson) selectBasicLesson(prevLesson.id);
        },
        onNextLesson: () => {
          const idx = BASIC_LESSONS.findIndex((l) => l.id === lesson.id);
          const nextLesson = BASIC_LESSONS[idx + 1];
          if (nextLesson) selectBasicLesson(nextLesson.id);
        },
        onPlayDemo: (demo: CompareDemo) => {
          const demoCompiled = compileCompareDemo(demo, project.keyRoot, chordView);
          transport.playOncePreview(
            demoCompiled,
            demo.bpm,
            'piano',
            {
              melody: false,
              chords: false,
              bass: false,
              drums: false,
            },
            chordView
          );
          updateBasicsPlayButton(basicsRootEl, true);
          updateMobileDockPlayState();
        },
        onTogglePlay: togglePlayback,
        onUndo: performUndo,
        onToggleHint: () => {
          showBasicsHint = !showBasicsHint;
          renderBasicsMode();
        },
        onReset: () => {
          showBasicsHint = false;
          selectedPickBar = 0;
          loadWorkspaceProject(createBasicLessonProject(lesson.id));
        },
        onSelectDuration: (steps) => {
          selectedDuration = steps;
          renderBasicsMode();
        },
        onSelectPickBar: (barIdx) => {
          selectedPickBar = barIdx;
          const chord = compiled.resolvedChords[barIdx];
          if (chord) audio.auditionChord(chord.voicingMidi, chordView);
          renderBasicsMode();
        },
        onProjectChange: (next) => updateState(next),
        onAuditionPitch: auditionPitch,
        onAuditionChordWithNote: auditionChordWithNote,
        onAuditionChord: (chord) => audio.auditionChord(chord.voicingMidi, chordView),
        onGoToMissions: () => switchMode('lesson'),
        onOpenInFreeSketch: () => openProjectInFreeSketch(project, `${lesson.titleKo} 편곡`),
        onSeekBar: seekToBar,
        onLoopRangeChange: setLoopRange,
      }
    );
    renderMobileThumbDock(report);
  }

  function renderCoachSection(report = analyzeSong(compiled, project)): void {
    renderCoachPanel(
      coachEl,
      report,
      coachController.getUiState(),
      coachController.createCallbacks()
    );
    renderMobileThumbDock(report);
  }

  function renderSongLibrarySection(): void {
    if (appMode !== 'free') {
      songLibraryEl.hidden = true;
      songLibraryEl.innerHTML = '';
      return;
    }
    songLibraryEl.hidden = false;
    renderSongLibraryBar(songLibraryEl, songLibrary, songLibraryUiState, {
      onSelectSlot: (slotId) => {
        if (slotId === songLibrary.activeSlotId) return;
        songLibrary = selectSongSlot(songLibrary, slotId);
        songLibraryUiState.confirmDeleteSlotId = null;
        songLibraryUiState.notice = null;
        saveLibrary(songLibrary);
        loadWorkspaceProject(getActiveSlot(songLibrary).project);
      },
      onCreateSlot: () => {
        const res = createSongSlot(songLibrary);
        if (!res.ok) {
          songLibraryUiState.notice = { kind: 'error', text: res.error };
          renderSongLibrarySection();
          return;
        }
        songLibrary = res.library;
        songLibraryUiState.confirmDeleteSlotId = null;
        songLibraryUiState.notice = {
          kind: 'info',
          text: `'${res.slot.name}' 새 곡 슬롯을 만들었다.`,
        };
        saveLibrary(songLibrary);
        loadWorkspaceProject(getActiveSlot(songLibrary).project);
      },
      onDuplicateSlot: (slotId) => {
        const res = duplicateSongSlot(songLibrary, slotId);
        if (!res.ok) {
          songLibraryUiState.notice = { kind: 'error', text: res.error };
          renderSongLibrarySection();
          return;
        }
        songLibrary = res.library;
        songLibraryUiState.confirmDeleteSlotId = null;
        songLibraryUiState.notice = {
          kind: 'info',
          text: `'${res.slot.name}' 슬롯으로 복제했다.`,
        };
        saveLibrary(songLibrary);
        loadWorkspaceProject(getActiveSlot(songLibrary).project);
      },
      onRenameSlot: (slotId, rawName) => {
        songLibrary = renameSongSlot(songLibrary, slotId, rawName);
        saveLibrary(songLibrary);
        renderSongLibrarySection();
      },
      onRequestDeleteSlot: (slotId) => {
        songLibraryUiState.confirmDeleteSlotId = slotId;
        renderSongLibrarySection();
      },
      onConfirmDeleteSlot: (slotId) => {
        const targetName = songLibrary.slots.find((s) => s.id === slotId)?.name ?? '슬롯';
        const prevActiveId = songLibrary.activeSlotId;
        const res = deleteSongSlot(songLibrary, slotId);
        if (!res.ok) {
          songLibraryUiState.confirmDeleteSlotId = null;
          songLibraryUiState.notice = { kind: 'error', text: res.error };
          renderSongLibrarySection();
          return;
        }
        songLibrary = res.library;
        songLibraryUiState.confirmDeleteSlotId = null;
        songLibraryUiState.notice = {
          kind: 'info',
          text: `'${targetName}' 슬롯을 삭제했다.`,
        };
        saveLibrary(songLibrary);
        if (prevActiveId === slotId) {
          loadWorkspaceProject(getActiveSlot(songLibrary).project);
        } else {
          renderSongLibrarySection();
        }
      },
      onCancelDeleteSlot: () => {
        songLibraryUiState.confirmDeleteSlotId = null;
        renderSongLibrarySection();
      },
      onToggleDrawer: () => {
        songLibraryUiState.drawerOpen = !songLibraryUiState.drawerOpen;
        songLibraryUiState.confirmDeleteSlotId = null;
        renderSongLibrarySection();
      },
      onExportSong: (slotId) => {
        const slot = songLibrary.slots.find((s) => s.id === slotId) ?? getActiveSlot(songLibrary);
        const json = serializeSongBackup(slot);
        void downloadTextFile(
          buildBackupFilename(slot.name, 'song'),
          json,
          'application/json;charset=utf-8'
        ).catch(() => undefined);
        songLibraryUiState.notice = {
          kind: 'info',
          text: `'${slot.name}' 곡을 JSON 파일로 저장했다.`,
        };
        renderSongLibrarySection();
      },
      onExportLibrary: () => {
        const json = serializeLibraryBackup(songLibrary);
        void downloadTextFile(
          buildBackupFilename('motif_library_backup', 'library'),
          json,
          'application/json;charset=utf-8'
        ).catch(() => undefined);
        songLibraryUiState.notice = {
          kind: 'info',
          text: `전체 ${songLibrary.slots.length}개 곡 슬롯 백업 JSON을 저장했다.`,
        };
        renderSongLibrarySection();
      },
      onImportJsonText: (jsonText) => {
        const res = importBackupIntoLibrary(songLibrary, jsonText);
        if (!res.ok) {
          songLibraryUiState.notice = { kind: 'error', text: res.error };
          renderSongLibrarySection();
          return;
        }
        songLibrary = res.library;
        songLibraryUiState.confirmDeleteSlotId = null;
        const warningNote = res.warnings.length > 0 ? ` (${res.warnings[0]})` : '';
        songLibraryUiState.notice = {
          kind: 'info',
          text: `${res.importedCount}개 곡 슬롯을 불러왔다.${warningNote}`,
        };
        saveLibrary(songLibrary);
        loadWorkspaceProject(getActiveSlot(songLibrary).project);
      },
      onImportError: (message) => {
        songLibraryUiState.notice = { kind: 'error', text: message };
        renderSongLibrarySection();
      },
      onDismissNotice: () => {
        songLibraryUiState.notice = null;
        renderSongLibrarySection();
      },
    });
  }

  function renderAll(): void {
    const report = analyzeSong(compiled, project);

    if (appMode === 'basics') {
      basicsRootEl.hidden = false;
      lessonMapRootEl.hidden = true;
      sandboxRootEl.hidden = true;
      renderBasicsMode(report);
      renderTopControls();
      return;
    }

    if (appMode === 'lesson' && lessonScreen === 'map') {
      basicsRootEl.hidden = true;
      lessonMapRootEl.hidden = false;
      sandboxRootEl.hidden = true;
      renderLessonCourseMap(
        lessonMapRootEl,
        new Set(lessonProgress.completedIds),
        lessonProgress.activeLessonId,
        {
          onStartLesson: (id) => selectLesson(id),
          onResumeActive: () => selectLesson(lessonProgress.activeLessonId),
          onReviewRandomCompleted: reviewRandomCompletedLesson,
        }
      );
      renderTopControls();
      return;
    }

    basicsRootEl.hidden = true;
    lessonMapRootEl.hidden = true;
    sandboxRootEl.hidden = false;
    syncLessonBanner(report);
    renderSongLibrarySection();
    renderTopControls();
    renderDynamicParts();
    renderCoachSection(report);
  }

  bindAppShortcuts({
    isBlocked: () =>
      (appMode === 'basics' && basicsScreen === 'map') ||
      (appMode === 'lesson' && lessonScreen === 'map'),
    onUndo: performUndo,
    onRedo: performRedo,
    onTogglePlayback: togglePlayback,
    onAuditionPitch: auditionPitch,
  });

  renderAll();

  if ('serviceWorker' in navigator && import.meta.env.PROD && !Capacitor.isNativePlatform()) {
    void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  }
}

init();
