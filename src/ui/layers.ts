import type { CoachVisualDiff } from '../core/coachPatch';
import {
  type CompiledSong,
  buildDefaultDrumPattern,
  duplicateAToBWithVariation,
  previewModifierDiff,
  resolveChordAtStep,
} from '../core/compiler';
import {
  PRESETS,
  type ChordInstrument,
  type DrumKind,
  type DrumStepPattern,
  type ModifierId,
  type NoteEvent,
  type SongProject,
  cloneProject,
} from '../core/model';
import {
  type NoteClipboard,
  addPianoRollNote,
  adjustPianoRollNotesDuration,
  clampGroupDelta,
  computeMaxResizeDuration,
  copyPianoRollNotes,
  deletePianoRollNote,
  deletePianoRollNotes,
  duplicatePianoRollNotes,
  movePianoRollNotes,
  pastePianoRollNotes,
  resizePianoRollNote,
  selectNotesInMarquee,
} from '../core/pianoRollOps';
import {
  type LoopBarRange,
  loopRangeToStepRange,
  normalizeLoopRange,
  selectLoopBarRange,
} from '../core/playbackControl';
import type { SongVisualDiff } from '../core/songDiff';
import {
  renderMiniPianoRollHtml,
  updateMiniPianoRollPlayhead,
  wireMiniPianoRollEvents,
} from './miniPianoRoll';
import {
  type ChordExtension,
  type ChordInversion,
  type DegreeSymbol,
  type HarmonicRole,
  type ScaleMode,
  KOREAN_SOLFEGE,
  classifyPitch,
  getScalePitchClasses,
  isWhiteKey,
  koreanNoteName,
  noteName,
  resolveChord,
  wrapPc,
} from '../core/theory';

export interface ProjectChangeOptions {
  recompileAudioOnly?: boolean;
  recordHistory?: boolean;
  historyBase?: SongProject;
  changeLabel?: string;
}

export interface LayerCallbacks {
  selectedDuration: number;
  chordView?: ChordInstrument;
  loopRange?: LoopBarRange | null;
  preserveBakedOnChordChange?: boolean;
  coachCompare?: CoachVisualDiff | null;
  coachCompareActive?: boolean;
  visualDiff?: SongVisualDiff | null;
  onSelectDuration: (steps: number) => void;
  onTogglePreserveBaked?: (preserve: boolean) => void;
  onProjectChange: (next: SongProject, options?: boolean | ProjectChangeOptions) => void;
  onAuditionPitch: (midi: number) => void;
  onAuditionDrum?: (kind: DrumKind) => void;
  onPreviewModifier: (modifierId: ModifierId, after: boolean) => void;
  onSeekBar?: (barIdx: number) => void;
  onLoopRangeChange?: (range: LoopBarRange | null) => void;
  onDismissCoachCompare?: () => void;
  onClearVisualDiff?: () => void;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export type PianoRollToolMode = 'draw' | 'select';
export type L3EditTrack = 'melody' | 'chords' | 'bass' | 'pad' | 'drums';

interface PianoRollMetrics {
  minMidi: number;
  maxMidi: number;
  stepW: number;
  rowH: number;
  zoomId: string;
  scale: number;
  touchSized: boolean;
}

let containerSelectionMap = new WeakMap<HTMLElement, Set<string>>();
let containerToolModeMap = new WeakMap<HTMLElement, PianoRollToolMode>();
let containerZoomMap = new WeakMap<HTMLElement, string>();
let containerL3TrackMap = new WeakMap<HTMLElement, L3EditTrack>();
type L2SectionTab = 'all' | 'A' | 'B';
let containerSectionTabMap = new WeakMap<HTMLElement, L2SectionTab>();
const containerMiniPrCollapsedMap = new WeakMap<HTMLElement, boolean>();
const activeKeyHandlers = new Map<HTMLElement, (e: KeyboardEvent) => void>();
const handledKeyEvents = new WeakSet<KeyboardEvent>();
let sharedClipboard: NoteClipboard | null = null;
let nextPasteStep: number | null = null;
let pasteSeq = 0;

function isCoarsePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

function getToolMode(container: HTMLElement): PianoRollToolMode {
  return containerToolModeMap.get(container) ?? 'draw';
}

function getZoomId(container: HTMLElement): string {
  const stored = containerZoomMap.get(container);
  if (stored) return stored;
  return isCoarsePointer()
    ? PRESETS.pianoRoll.defaultTouchZoomId
    : PRESETS.pianoRoll.defaultDesktopZoomId;
}

function getL3Track(container: HTMLElement): L3EditTrack {
  return containerL3TrackMap.get(container) ?? 'melody';
}

function getTrackPitchBounds(track: L3EditTrack): { minMidi: number; maxMidi: number } {
  const cfg = PRESETS.pianoRoll;
  if (track === 'bass') return { minMidi: 24, maxMidi: 60 };
  if (track === 'chords') return { minMidi: 36, maxMidi: 84 };
  if (track === 'pad') return { minMidi: 48, maxMidi: 84 };
  return { minMidi: cfg.minMidi, maxMidi: cfg.maxMidi };
}

function resolvePianoRollMetrics(
  zoomId: string,
  coarse = isCoarsePointer(),
  track: L3EditTrack = 'melody'
): PianoRollMetrics {
  const cfg = PRESETS.pianoRoll;
  const matched =
    cfg.zoomLevels.find((z) => z.id === zoomId) ??
    cfg.zoomLevels.find((z) => z.id === cfg.defaultDesktopZoomId) ??
    cfg.zoomLevels[0];
  const scale = matched?.scale ?? 1;
  const bounds = getTrackPitchBounds(track);
  return {
    minMidi: bounds.minMidi,
    maxMidi: bounds.maxMidi,
    stepW: Math.max(8, Math.round(cfg.baseStepWidth * scale)),
    rowH: Math.max(12, Math.round(cfg.baseRowHeight * scale)),
    zoomId: matched?.id ?? zoomId,
    scale,
    touchSized: coarse || scale > 1,
  };
}

function isTouchPointer(e: PointerEvent): boolean {
  return e.pointerType === 'touch';
}

function getSelectionSet(container: HTMLElement): Set<string> {
  let set = containerSelectionMap.get(container);
  if (!set) {
    set = new Set<string>();
    containerSelectionMap.set(container, set);
  }
  return set;
}

function getTrackNotesFromCompiled(
  compiled: CompiledSong,
  track: L3EditTrack
): Array<NoteEvent & { role?: HarmonicRole }> {
  if (track === 'chords') return compiled.chords;
  if (track === 'bass') return compiled.bass;
  if (track === 'pad') return compiled.pad;
  return compiled.melody;
}

function pruneSelectionForTrack(
  container: HTMLElement,
  compiled: CompiledSong,
  track: L3EditTrack = 'melody'
): Set<string> {
  const sel = getSelectionSet(container);
  if (sel.size === 0) return sel;
  const validIds = new Set(getTrackNotesFromCompiled(compiled, track).map((n) => n.id));
  for (const id of sel) {
    if (!validIds.has(id)) sel.delete(id);
  }
  return sel;
}

function detachContainerKeyHandler(container: HTMLElement): void {
  const prev = activeKeyHandlers.get(container);
  if (prev) {
    window.removeEventListener('keydown', prev);
    activeKeyHandlers.delete(container);
  }
}

/** 피아노롤 다중 선택 상태·도구 모드·배율·공유 클립보드·전역 단축키 리스너를 초기화한다. */
export function clearPianoRollEditState(container?: HTMLElement): void {
  if (container) {
    containerSelectionMap.delete(container);
    containerToolModeMap.delete(container);
    containerZoomMap.delete(container);
    detachContainerKeyHandler(container);
    return;
  }
  for (const [el, handler] of activeKeyHandlers) {
    window.removeEventListener('keydown', handler);
    activeKeyHandlers.delete(el);
  }
  containerSelectionMap = new WeakMap<HTMLElement, Set<string>>();
  containerToolModeMap = new WeakMap<HTMLElement, PianoRollToolMode>();
  containerZoomMap = new WeakMap<HTMLElement, string>();
  sharedClipboard = null;
  nextPasteStep = null;
}

export function computeFollowScrollLeft(
  playheadX: number,
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
  stepW = PRESETS.pianoRoll.baseStepWidth
): number {
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  if (maxScroll <= 0 || clientWidth <= 0) return scrollLeft;

  const leftMargin = Math.min(stepW * 2, Math.floor(clientWidth * 0.1));
  const rightMargin = Math.min(stepW * 4, Math.floor(clientWidth * 0.15));

  if (playheadX < scrollLeft || playheadX > scrollLeft + clientWidth - rightMargin) {
    return Math.max(0, Math.min(maxScroll, playheadX - leftMargin));
  }
  return scrollLeft;
}

export function updatePianoRollPlayhead(container: HTMLElement, activeStep: number, totalSteps: number): void {
  updateMiniPianoRollPlayhead(container, activeStep, totalSteps);
  const visible = activeStep >= 0 && activeStep < totalSteps;
  const activeBar = visible ? Math.floor(activeStep / 16) : -1;
  container.querySelectorAll<HTMLElement>('.pr-bar-cell[data-bar]').forEach((cell) => {
    cell.classList.toggle('active-bar', Number(cell.dataset.bar) === activeBar);
  });

  const svg = container.querySelector<SVGSVGElement>('.pr-svg');
  const line = container.querySelector<SVGLineElement>('.pr-playhead');
  if (!line) return;
  const parsedStepW = Number(svg?.dataset.stepW);
  const stepW = Number.isFinite(parsedStepW) && parsedStepW > 0 ? parsedStepW : PRESETS.pianoRoll.baseStepWidth;
  const x = visible ? activeStep * stepW : 0;
  line.setAttribute('x1', String(x));
  line.setAttribute('x2', String(x));
  line.setAttribute('visibility', visible ? 'visible' : 'hidden');

  if (visible) {
    const scrollEl = container.querySelector<HTMLElement>('.pr-grid-scroll');
    if (scrollEl) {
      const nextScroll = computeFollowScrollLeft(
        x,
        scrollEl.scrollLeft,
        scrollEl.clientWidth,
        scrollEl.scrollWidth,
        stepW
      );
      if (nextScroll !== scrollEl.scrollLeft) {
        scrollEl.scrollLeft = nextScroll;
      }
    }
  }
}

export interface FocusedPianoRollOptions {
  showDurationPicker: boolean;
  showUnbake?: boolean;
  selectedDuration: number;
  loopRange?: LoopBarRange | null;
  onSelectDuration: (steps: number) => void;
  onProjectChange: (next: SongProject, options?: boolean | ProjectChangeOptions) => void;
  onAuditionPitch: (midi: number) => void;
  onSeekBar?: (barIdx: number) => void;
  onLoopRangeChange?: (range: LoopBarRange | null) => void;
}

export function renderFocusedPianoRoll(
  container: HTMLElement,
  project: SongProject,
  compiled: CompiledSong,
  activeStep: number,
  options: FocusedPianoRollOptions
): void {
  const prevScrollLeft = container.querySelector<HTMLElement>('.pr-grid-scroll')?.scrollLeft ?? 0;
  const selectedIds = pruneSelectionForTrack(container, compiled, 'melody');
  const toolMode = getToolMode(container);
  const metrics = resolvePianoRollMetrics(getZoomId(container));
  container.innerHTML = renderL3Body(project, compiled, activeStep, options.selectedDuration, {
    showDurationPicker: options.showDurationPicker,
    showUnbake: Boolean(options.showUnbake),
    loopRange: options.loopRange,
    selectedIds,
    toolMode,
    metrics,
  });
  const scrollEl = container.querySelector<HTMLElement>('.pr-grid-scroll');
  if (scrollEl && prevScrollLeft > 0) {
    scrollEl.scrollLeft = prevScrollLeft;
  }
  wireL3Events(
    container,
    project,
    compiled,
    {
      selectedDuration: options.selectedDuration,
      loopRange: options.loopRange,
      onSelectDuration: options.onSelectDuration,
      onProjectChange: options.onProjectChange,
      onAuditionPitch: options.onAuditionPitch,
      onPreviewModifier: () => {},
      onSeekBar: options.onSeekBar,
      onLoopRangeChange: options.onLoopRangeChange,
    },
    metrics,
    () => renderFocusedPianoRoll(container, project, compiled, activeStep, options)
  );
}

export function renderLayerEditor(
  container: HTMLElement,
  project: SongProject,
  compiled: CompiledSong,
  activeStep: number,
  callbacks: LayerCallbacks
): void {
  const layer = project.activeLayer;
  const prevScrollLeft =
    layer === 'L3' ? container.querySelector<HTMLElement>('.pr-grid-scroll')?.scrollLeft ?? 0 : 0;
  const hasBakedMelody = project.baked && project.bakedMelody.length > 0;
  const preserveBakedOnChordChange = callbacks.preserveBakedOnChordChange ?? true;

  const tabsHtml = `
    <div class="ladder-tabs">
      <div class="tab-pills">
        <button class="tab-pill${layer === 'L1' ? ' active' : ''}" data-layer="L1" type="button">L1. 블록 조립</button>
        <button class="tab-pill${layer === 'L2' ? ' active' : ''}" data-layer="L2" type="button">L2. 변형 체인</button>
        <button class="tab-pill${layer === 'L3' ? ' active' : ''}" data-layer="L3" type="button">L3. 음표 피아노롤${project.baked ? ' (편집중)' : ''}</button>
      </div>
      <div class="controls-row">
        ${
          layer === 'L1'
            ? `<button class="btn btn-primary" id="btn-unpack" type="button">블록을 L2 변형 체인으로 펼치기 →</button>`
            : layer === 'L2'
              ? `<button class="btn btn-primary" id="btn-bake" type="button">${hasBakedMelody ? 'L3 피아노롤로 돌아가기 (편집 유지) →' : '음표로 L3 피아노롤에 굽기 →'}</button>`
              : `<button class="btn" id="btn-unbake" type="button">L2 체인 결과로 초기화</button>`
        }
      </div>
    </div>
  `;

  const miniPrHtml =
    layer === 'L1' || layer === 'L2'
      ? renderMiniPianoRollHtml(project, compiled, activeStep, {
          collapsed: containerMiniPrCollapsedMap.get(container) ?? false,
          loopRange: callbacks.loopRange,
          visualDiff: callbacks.visualDiff,
          coachCompare: callbacks.coachCompare,
          coachCompareActive: callbacks.coachCompareActive,
        })
      : '';

  const wireMiniPr = () => {
    wireMiniPianoRollEvents(container, {
      onToggleCollapse: () => {
        const nextCollapsed = !(containerMiniPrCollapsedMap.get(container) ?? false);
        containerMiniPrCollapsedMap.set(container, nextCollapsed);
        renderLayerEditor(container, project, compiled, activeStep, callbacks);
      },
      onClearDiff: () => callbacks.onClearVisualDiff?.(),
      onOpenL3: () => {
        const next = cloneProject(project);
        next.activeLayer = 'L3';
        if (!(next.baked && next.bakedMelody.length > 0)) {
          next.baked = false;
        }
        callbacks.onProjectChange(next);
      },
      onSeekBar: (bar) => callbacks.onSeekBar?.(bar),
    });
  };

  if (layer === 'L1') {
    containerSelectionMap.delete(container);
    detachContainerKeyHandler(container);
    container.innerHTML = tabsHtml + miniPrHtml + renderL1Body(project);
    wireTabs(container, project, callbacks);
    wireMiniPr();
    wireL1Events(container, project, callbacks);
    return;
  }

  if (layer === 'L2') {
    containerSelectionMap.delete(container);
    detachContainerKeyHandler(container);
    const chordView = callbacks.chordView ?? 'piano';
    const sectionTab: L2SectionTab =
      project.bars === 16 ? (containerSectionTabMap.get(container) ?? 'all') : 'all';
    container.innerHTML =
      tabsHtml +
      miniPrHtml +
      renderL2Body(project, compiled, preserveBakedOnChordChange, chordView, sectionTab, callbacks.loopRange);
    wireTabs(container, project, callbacks);
    wireMiniPr();
    wireL2Events(container, project, callbacks, preserveBakedOnChordChange, () =>
      renderLayerEditor(container, project, compiled, activeStep, callbacks)
    );
    return;
  }

  const activeTrack = getL3Track(container);
  const selectedIds = pruneSelectionForTrack(container, compiled, activeTrack);
  const toolMode = getToolMode(container);
  const metrics = resolvePianoRollMetrics(getZoomId(container), undefined, activeTrack);
  container.innerHTML = tabsHtml + renderL3Body(project, compiled, activeStep, callbacks.selectedDuration, {
    showDurationPicker: true,
    showTrackTabs: true,
    showUnbake: false,
    track: activeTrack,
    loopRange: callbacks.loopRange,
    coachCompare: callbacks.coachCompare,
    coachCompareActive: callbacks.coachCompareActive,
    visualDiff: callbacks.visualDiff,
    selectedIds,
    toolMode,
    metrics,
  });
  const scrollEl = container.querySelector<HTMLElement>('.pr-grid-scroll');
  if (scrollEl && prevScrollLeft > 0) {
    scrollEl.scrollLeft = prevScrollLeft;
  }
  wireTabs(container, project, callbacks);
  wireL3Events(
    container,
    project,
    compiled,
    callbacks,
    metrics,
    () => renderLayerEditor(container, project, compiled, activeStep, callbacks)
  );
}

function wireTabs(container: HTMLElement, project: SongProject, callbacks: LayerCallbacks): void {
  container.querySelectorAll<HTMLButtonElement>('.tab-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.layer as SongProject['activeLayer'];
      const next = cloneProject(project);
      next.activeLayer = target;
      callbacks.onProjectChange(next);
    });
  });

  container.querySelector('#btn-unpack')?.addEventListener('click', () => {
    const next = cloneProject(project);
    next.activeLayer = 'L2';
    callbacks.onProjectChange(next);
  });

  container.querySelector('#btn-bake')?.addEventListener('click', () => {
    const next = cloneProject(project);
    next.activeLayer = 'L3';
    if (!(next.baked && next.bakedMelody.length > 0)) {
      next.baked = false;
    }
    callbacks.onProjectChange(next);
  });
}

function renderL1Body(project: SongProject): string {
  const progs = PRESETS.progressions
    .map(
      (p) => `
      <button class="choice-card${project.blocks.progressionId === p.id ? ' selected' : ''}" data-prog="${p.id}" type="button">
        <div class="choice-card-title">${p.nameKo}</div>
        <div class="choice-card-desc">${p.moodKo}<br/>도수: ${p.degrees.join(' - ')}</div>
      </button>`
    )
    .join('');

  const grooves = PRESETS.grooves
    .map(
      (g) => `
      <button class="choice-card${project.blocks.grooveId === g.id ? ' selected' : ''}" data-groove="${g.id}" type="button">
        <div class="choice-card-title">${g.nameKo}</div>
        <div class="choice-card-desc">${g.moodKo} (${g.defaultBpm} BPM)</div>
      </button>`
    )
    .join('');

  const contours = PRESETS.contours
    .map(
      (c) => `
      <button class="choice-card${project.blocks.contourId === c.id ? ' selected' : ''}" data-contour="${c.id}" type="button">
        <div class="choice-card-title">${c.nameKo}</div>
        <div class="choice-card-desc">${c.descKo}</div>
      </button>`
    )
    .join('');

  return `
    <p class="section-title">1. 코드 진행 블록 (곡의 감정과 뼈대)</p>
    <div class="card-grid">${progs}</div>
    <p class="section-title">2. 리듬 그루브 블록 (드럼 · 베이스 · 기타 스트럼)</p>
    <div class="card-grid">${grooves}</div>
    <p class="section-title">3. 멜로디 윤곽 블록 (음의 높낮이 흐름)</p>
    <div class="card-grid">${contours}</div>
    <div class="sliders-row">
      <div class="slider-box">
        <div class="slider-label"><span>반주 세기 (강약)</span><span id="energy-val">${Math.round(project.blocks.energy * 100)}%</span></div>
        <input id="sl-energy" type="range" min="0.2" max="1" step="0.05" value="${project.blocks.energy}" />
      </div>
      <div class="slider-box">
        <div class="slider-label"><span>멜로디 음 수 (듬성↔촘촘)</span><span id="density-val">${Math.round(project.blocks.density * 100)}%</span></div>
        <input id="sl-density" type="range" min="0.2" max="1" step="0.05" value="${project.blocks.density}" />
      </div>
    </div>
  `;
}

function wireL1Events(container: HTMLElement, project: SongProject, callbacks: LayerCallbacks): void {
  let workingProject = cloneProject(project);
  let energyStart: SongProject | null = null;
  let densityStart: SongProject | null = null;

  container.querySelectorAll<HTMLButtonElement>('[data-prog]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = cloneProject(workingProject);
      next.blocks.progressionId = btn.dataset.prog!;
      next.baked = false;
      workingProject = cloneProject(next);
      const progName = PRESETS.progressions.find((p) => p.id === next.blocks.progressionId)?.nameKo;
      callbacks.onProjectChange(next, { changeLabel: progName ? `코드 진행: ${progName}` : '코드 진행 변경' });
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-groove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const gId = btn.dataset.groove!;
      const preset = PRESETS.grooves.find((g) => g.id === gId);
      const next = cloneProject(workingProject);
      next.blocks.grooveId = gId;
      if (preset) next.bpm = preset.defaultBpm;
      workingProject = cloneProject(next);
      callbacks.onProjectChange(next, { changeLabel: preset ? `그루브: ${preset.nameKo}` : '그루브 변경' });
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-contour]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = cloneProject(workingProject);
      next.blocks.contourId = btn.dataset.contour!;
      next.baked = false;
      workingProject = cloneProject(next);
      const contourName = PRESETS.contours.find((c) => c.id === next.blocks.contourId)?.nameKo;
      callbacks.onProjectChange(next, { changeLabel: contourName ? `멜로디 윤곽: ${contourName}` : '윤곽 변경' });
    });
  });

  const energySlider = container.querySelector<HTMLInputElement>('#sl-energy');
  energySlider?.addEventListener('input', () => {
    if (!energyStart) energyStart = cloneProject(workingProject);
    const next = cloneProject(workingProject);
    next.blocks.energy = Number(energySlider.value);
    workingProject = cloneProject(next);
    const valEl = container.querySelector('#energy-val');
    if (valEl) valEl.textContent = `${Math.round(next.blocks.energy * 100)}%`;
    callbacks.onProjectChange(next, { recompileAudioOnly: true, recordHistory: false });
  });
  energySlider?.addEventListener('change', () => {
    if (!energyStart) energyStart = cloneProject(workingProject);
    const next = cloneProject(workingProject);
    next.blocks.energy = Number(energySlider.value);
    const historyBase = energyStart;
    energyStart = null;
    workingProject = cloneProject(next);
    callbacks.onProjectChange(next, {
      recompileAudioOnly: false,
      recordHistory: true,
      historyBase,
    });
  });

  const densitySlider = container.querySelector<HTMLInputElement>('#sl-density');
  densitySlider?.addEventListener('input', () => {
    if (!densityStart) densityStart = cloneProject(workingProject);
    const next = cloneProject(workingProject);
    next.blocks.density = Number(densitySlider.value);
    next.baked = false;
    workingProject = cloneProject(next);
    const valEl = container.querySelector('#density-val');
    if (valEl) valEl.textContent = `${Math.round(next.blocks.density * 100)}%`;
    callbacks.onProjectChange(next, { recompileAudioOnly: true, recordHistory: false });
  });
  densitySlider?.addEventListener('change', () => {
    if (!densityStart) densityStart = cloneProject(workingProject);
    const next = cloneProject(workingProject);
    next.blocks.density = Number(densitySlider.value);
    next.baked = false;
    const historyBase = densityStart;
    densityStart = null;
    workingProject = cloneProject(next);
    callbacks.onProjectChange(next, {
      recompileAudioOnly: false,
      recordHistory: true,
      historyBase,
    });
  });
}

const CHORD_EXTENSION_OPTIONS: Array<{ value: ChordExtension; labelKo: string }> = [
  { value: 'triad', labelKo: '기본' },
  { value: '7', labelKo: '7' },
  { value: 'sus4', labelKo: 'sus4' },
  { value: 'add9', labelKo: 'add9' },
];

const CHORD_INVERSION_OPTIONS: Array<{ value: ChordInversion; labelKo: string }> = [
  { value: 0, labelKo: '근음' },
  { value: 1, labelKo: '1전위' },
  { value: 2, labelKo: '2전위' },
];

function renderChordSelectOptions(
  selectedDegree: DegreeSymbol,
  keyRoot: number,
  mode: ScaleMode
): string {
  return PRESETS.availableDegrees
    .map((deg) => {
      const chordName = resolveChord(deg, keyRoot, mode).baseSymbol;
      return `<option value="${deg}"${deg === selectedDegree ? ' selected' : ''}>${deg} · ${chordName}</option>`;
    })
    .join('');
}

function renderExtensionOptions(selected: ChordExtension = 'triad'): string {
  return CHORD_EXTENSION_OPTIONS.map(
    (opt) => `<option value="${opt.value}"${opt.value === selected ? ' selected' : ''}>${opt.labelKo}</option>`
  ).join('');
}

function renderInversionOptions(selected: ChordInversion = 0): string {
  return CHORD_INVERSION_OPTIONS.map(
    (opt) => `<option value="${opt.value}"${opt.value === selected ? ' selected' : ''}>${opt.labelKo}</option>`
  ).join('');
}

function renderL2Body(
  project: SongProject,
  compiled: CompiledSong,
  preserveBakedOnChordChange: boolean,
  chordView: ChordInstrument = 'piano',
  sectionTab: L2SectionTab = 'all',
  loopRange: LoopBarRange | null = null
): string {
  const hasBakedMelody = project.baked && project.bakedMelody.length > 0;
  const bakedGuardHtml = hasBakedMelody
    ? `
      <div class="l2-baked-guard">
        <div class="l2-baked-guard-main">
          <label class="l2-baked-guard-toggle">
            <input type="checkbox" id="chk-preserve-baked"${preserveBakedOnChordChange ? ' checked' : ''} />
            <span>L3 수동 편집 멜로디 유지 (코드만 변경)</span>
          </label>
          <p class="l2-baked-guard-desc">${
            preserveBakedOnChordChange
              ? '마디 코드를 바꿔도 L3에서 편집한 멜로디를 유지하고 화성 색상만 다시 계산한다. (변형 체인 변경 시에는 L2 멜로디를 다시 생성한다.)'
              : '마디 코드를 바꾸면 새 코드에 맞춰 L2 멜로디를 다시 생성한다.'
          }</p>
        </div>
        <button class="btn btn-chip" id="btn-l2-reset-baked" type="button">L2 결과로 덮어쓰기</button>
      </div>
    `
    : '';

  const isLoopA = Boolean(loopRange && loopRange.startBar === 0 && loopRange.endBar === 7);
  const isLoopB = Boolean(loopRange && loopRange.startBar === 8 && loopRange.endBar === 15);
  const sectionBarHtml =
    project.bars === 16
      ? `
        <div class="l2-section-bar">
          <div class="l2-section-tabs" role="group" aria-label="16마디 섹션 선택">
            <button class="btn btn-chip${sectionTab === 'all' ? ' active' : ''}" data-l2-section="all" type="button">전체 (1~16)</button>
            <button class="btn btn-chip${sectionTab === 'A' ? ' active' : ''}" data-l2-section="A" type="button">A 파트 (1~8)</button>
            <button class="btn btn-chip${sectionTab === 'B' ? ' active' : ''}" data-l2-section="B" type="button">B 파트 (9~16)</button>
          </div>
          <div class="l2-section-actions">
            <button class="btn btn-chip${isLoopA ? ' active' : ''}" id="btn-l2-loop-a" type="button">A 반복</button>
            <button class="btn btn-chip${isLoopB ? ' active' : ''}" id="btn-l2-loop-b" type="button">B 반복</button>
            <button class="btn btn-chip${!loopRange ? ' active' : ''}" id="btn-l2-loop-all" type="button">전체 연속</button>
            <button class="btn btn-chip btn-accent-chip" id="btn-l2-dup-ab" type="button" title="1~8마디(A 파트)를 9~16마디(B 파트)로 복제하고 클라이맥스 변주를 적용한다">A→B 복제·변주</button>
          </div>
        </div>
      `
      : '';

  const startBar = sectionTab === 'B' ? 8 : 0;
  const endBar = sectionTab === 'A' ? 8 : project.bars;

  const chordSlots = project.chain.chords
    .slice(0, project.bars)
    .map((slot, idx) => {
      if (idx < startBar || idx >= endBar) return '';
      const rc = compiled.resolvedChords[idx];
      const halfRc = compiled.resolvedHalfChords?.[idx] ?? null;
      const hasHalf = Boolean(slot.halfDegree);
      const titleSymbol = halfRc ? `${rc?.symbol ?? ''} → ${halfRc.symbol}` : rc?.symbol ?? '';
      const partTag = project.bars === 16 ? (idx < 8 ? 'A' : 'B') : '';
      const halfRowHtml = hasHalf
        ? `
          <div class="l2-half-chord-row">
            <span class="l2-half-label">3~4박</span>
            <select class="sel-half-degree" data-bar="${idx}" aria-label="${idx + 1}마디 후반 코드 도수">${renderChordSelectOptions(slot.halfDegree!, project.keyRoot, project.mode)}</select>
            <select class="sel-half-ext" data-bar="${idx}" aria-label="${idx + 1}마디 후반 코드 확장">${renderExtensionOptions(slot.halfExtension ?? 'triad')}</select>
            <select class="sel-half-inv" data-bar="${idx}" aria-label="${idx + 1}마디 후반 코드 전위">${renderInversionOptions(slot.halfInversion ?? 0)}</select>
          </div>
        `
        : '';
      return `
        <div class="l2-chord-slot${hasHalf ? ' is-split' : ''}">
          <div class="l2-chord-slot-head">
            <span>${partTag ? `[${partTag}] ` : ''}${idx + 1}마디 (${titleSymbol})</span>
            <button class="btn btn-chip btn-split-chord${hasHalf ? ' active' : ''}" data-split-bar="${idx}" type="button" title="한 마디를 전반/후반 2박(2코드)으로 나눈다">2코드</button>
          </div>
          <div class="l2-chord-controls">
            <select class="sel-degree" data-bar="${idx}" aria-label="${idx + 1}마디 코드 도수">${renderChordSelectOptions(slot.degree, project.keyRoot, project.mode)}</select>
            <select class="sel-ext" data-bar="${idx}" aria-label="${idx + 1}마디 코드 확장">${renderExtensionOptions(slot.extension ?? 'triad')}</select>
            <select class="sel-inv" data-bar="${idx}" aria-label="${idx + 1}마디 코드 전위">${renderInversionOptions(slot.inversion ?? 0)}</select>
          </div>
          ${halfRowHtml}
        </div>
      `;
    })
    .join('');

  const modCards = PRESETS.modifiers
    .map((meta) => {
      const state = project.chain.modifiers.find((m) => m.id === meta.id) ?? {
        id: meta.id,
        enabled: false,
        amount: 0.7,
      };
      const diff = previewModifierDiff(project, meta.id, chordView);
      const changed = diff.changedCount + diff.addedCount + diff.removedCount;
      return `
        <div class="mod-card${state.enabled ? ' enabled' : ''}">
          <div class="mod-head">
            <label>
              <input type="checkbox" class="chk-mod" data-mod="${meta.id}"${state.enabled ? ' checked' : ''} />
              <span>${meta.nameKo}</span>
            </label>
          </div>
          <div class="choice-card-desc">${meta.descKo}</div>
          <input type="range" class="sl-mod" data-mod="${meta.id}" min="0.1" max="1" step="0.05" value="${state.amount}" />
          <div class="mod-foot">
            <span>영향: 음표 ${changed}곳</span>
            <div>
              <button class="btn btn-chip" data-prev-off="${meta.id}" type="button">적용 전</button>
              <button class="btn btn-chip" data-prev-on="${meta.id}" type="button">적용 후</button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  return `
    <p class="section-title">마디별 코드 도수·보이싱 직접 바꾸기 (L1 진행이 펼쳐진 상태)</p>
    ${bakedGuardHtml}
    ${sectionBarHtml}
    <div class="l2-chords-editor">${chordSlots}</div>
    <p class="section-title">멜로디·화성 변형 체인 (켜고 끄며 차이 듣기)</p>
    <div class="modifier-list">${modCards}</div>
  `;
}

function wireL2Events(
  container: HTMLElement,
  project: SongProject,
  callbacks: LayerCallbacks,
  preserveBakedOnChordChange: boolean,
  onRerenderView?: () => void
): void {
  let workingProject = cloneProject(project);
  let preserveBaked = preserveBakedOnChordChange;
  const modStartSnapshots = new Map<ModifierId, SongProject>();

  const commitChordEdit = (next: SongProject): void => {
    const keepBaked = Boolean(workingProject.baked && workingProject.bakedMelody.length > 0 && preserveBaked);
    if (!keepBaked) {
      next.baked = false;
    }
    workingProject = cloneProject(next);
    callbacks.onProjectChange(next);
  };

  container.querySelectorAll<HTMLButtonElement>('[data-l2-section]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.l2Section as L2SectionTab;
      containerSectionTabMap.set(container, tab);
      onRerenderView?.();
    });
  });

  container.querySelector('#btn-l2-loop-a')?.addEventListener('click', () => {
    callbacks.onLoopRangeChange?.({ startBar: 0, endBar: 7 });
    callbacks.onSeekBar?.(0);
  });

  container.querySelector('#btn-l2-loop-b')?.addEventListener('click', () => {
    callbacks.onLoopRangeChange?.({ startBar: 8, endBar: 15 });
    callbacks.onSeekBar?.(8);
  });

  container.querySelector('#btn-l2-loop-all')?.addEventListener('click', () => {
    callbacks.onLoopRangeChange?.(null);
  });

  container.querySelector('#btn-l2-dup-ab')?.addEventListener('click', () => {
    const next = duplicateAToBWithVariation(workingProject);
    containerSectionTabMap.set(container, 'B');
    workingProject = cloneProject(next);
    callbacks.onProjectChange(next);
  });

  const preserveChk = container.querySelector<HTMLInputElement>('#chk-preserve-baked');
  preserveChk?.addEventListener('change', () => {
    preserveBaked = preserveChk.checked;
    callbacks.onTogglePreserveBaked?.(preserveChk.checked);
  });

  container.querySelector('#btn-l2-reset-baked')?.addEventListener('click', () => {
    const next = cloneProject(workingProject);
    next.baked = false;
    next.bakedMelody = [];
    workingProject = cloneProject(next);
    callbacks.onProjectChange(next);
  });

  container.querySelectorAll<HTMLSelectElement>('.sel-degree').forEach((sel) => {
    sel.addEventListener('change', () => {
      const bar = Number(sel.dataset.bar);
      const next = cloneProject(workingProject);
      if (next.chain.chords[bar]) {
        next.chain.chords[bar].degree = sel.value as DegreeSymbol;
      }
      commitChordEdit(next);
    });
  });

  container.querySelectorAll<HTMLSelectElement>('.sel-ext').forEach((sel) => {
    sel.addEventListener('change', () => {
      const bar = Number(sel.dataset.bar);
      const next = cloneProject(workingProject);
      if (next.chain.chords[bar]) {
        const val = sel.value as ChordExtension;
        next.chain.chords[bar].extension = val === 'triad' ? undefined : val;
      }
      commitChordEdit(next);
    });
  });

  container.querySelectorAll<HTMLSelectElement>('.sel-inv').forEach((sel) => {
    sel.addEventListener('change', () => {
      const bar = Number(sel.dataset.bar);
      const next = cloneProject(workingProject);
      if (next.chain.chords[bar]) {
        const val = Number(sel.value) as ChordInversion;
        next.chain.chords[bar].inversion = val === 0 ? undefined : val;
      }
      commitChordEdit(next);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('.btn-split-chord').forEach((btn) => {
    btn.addEventListener('click', () => {
      const bar = Number(btn.dataset.splitBar);
      const next = cloneProject(workingProject);
      const slot = next.chain.chords[bar];
      if (slot) {
        if (slot.halfDegree) {
          delete slot.halfDegree;
          delete slot.halfExtension;
          delete slot.halfInversion;
        } else {
          slot.halfDegree = slot.degree === 'V' || slot.degree === 'V7' ? 'I' : 'V';
        }
      }
      commitChordEdit(next);
    });
  });

  container.querySelectorAll<HTMLSelectElement>('.sel-half-degree').forEach((sel) => {
    sel.addEventListener('change', () => {
      const bar = Number(sel.dataset.bar);
      const next = cloneProject(workingProject);
      if (next.chain.chords[bar]) {
        next.chain.chords[bar].halfDegree = sel.value as DegreeSymbol;
      }
      commitChordEdit(next);
    });
  });

  container.querySelectorAll<HTMLSelectElement>('.sel-half-ext').forEach((sel) => {
    sel.addEventListener('change', () => {
      const bar = Number(sel.dataset.bar);
      const next = cloneProject(workingProject);
      if (next.chain.chords[bar]) {
        const val = sel.value as ChordExtension;
        next.chain.chords[bar].halfExtension = val === 'triad' ? undefined : val;
      }
      commitChordEdit(next);
    });
  });

  container.querySelectorAll<HTMLSelectElement>('.sel-half-inv').forEach((sel) => {
    sel.addEventListener('change', () => {
      const bar = Number(sel.dataset.bar);
      const next = cloneProject(workingProject);
      if (next.chain.chords[bar]) {
        const val = Number(sel.value) as ChordInversion;
        next.chain.chords[bar].halfInversion = val === 0 ? undefined : val;
      }
      commitChordEdit(next);
    });
  });

  container.querySelectorAll<HTMLInputElement>('.chk-mod').forEach((chk) => {
    chk.addEventListener('change', () => {
      const id = chk.dataset.mod as ModifierId;
      const next = cloneProject(workingProject);
      next.chain.modifiers = next.chain.modifiers.map((m) =>
        m.id === id ? { ...m, enabled: chk.checked } : m
      );
      next.baked = false;
      workingProject = cloneProject(next);
      const modName = PRESETS.modifiers.find((m) => m.id === id)?.nameKo ?? id;
      callbacks.onProjectChange(next, {
        changeLabel: `${modName} ${chk.checked ? '켜짐' : '꺼짐'}`,
      });
    });
  });

  container.querySelectorAll<HTMLInputElement>('.sl-mod').forEach((sl) => {
    const id = sl.dataset.mod as ModifierId;
    sl.addEventListener('input', () => {
      if (!modStartSnapshots.has(id)) {
        modStartSnapshots.set(id, cloneProject(workingProject));
      }
      const next = cloneProject(workingProject);
      next.chain.modifiers = next.chain.modifiers.map((m) =>
        m.id === id ? { ...m, amount: Number(sl.value), enabled: true } : m
      );
      next.baked = false;
      workingProject = cloneProject(next);

      const card = sl.closest('.mod-card');
      card?.classList.add('enabled');
      const chk = card?.querySelector<HTMLInputElement>('.chk-mod');
      if (chk) chk.checked = true;

      callbacks.onProjectChange(next, { recompileAudioOnly: true, recordHistory: false });
    });

    sl.addEventListener('change', () => {
      const historyBase = modStartSnapshots.get(id) ?? cloneProject(workingProject);
      modStartSnapshots.delete(id);
      const next = cloneProject(workingProject);
      next.chain.modifiers = next.chain.modifiers.map((m) =>
        m.id === id ? { ...m, amount: Number(sl.value), enabled: true } : m
      );
      next.baked = false;
      workingProject = cloneProject(next);
      callbacks.onProjectChange(next, {
        recompileAudioOnly: false,
        recordHistory: true,
        historyBase,
      });
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-prev-off]').forEach((btn) => {
    btn.addEventListener('click', () => callbacks.onPreviewModifier(btn.dataset.prevOff as ModifierId, false));
  });
  container.querySelectorAll<HTMLButtonElement>('[data-prev-on]').forEach((btn) => {
    btn.addEventListener('click', () => callbacks.onPreviewModifier(btn.dataset.prevOn as ModifierId, true));
  });
}

function noteRoleColor(role: HarmonicRole): string {
  if (role === 'chord_tone') return '#34d399';
  if (role === 'clash') return '#fb7185';
  return '#38bdf8';
}

function computeHandleWidth(noteWidth: number, touchSized: boolean): number {
  const cfg = PRESETS.pianoRoll;
  const minW = touchSized ? cfg.touchHandleMinPx : cfg.desktopHandleMinPx;
  const maxW = touchSized ? cfg.touchHandleMaxPx : cfg.desktopHandleMaxPx;
  const ratio = touchSized ? cfg.touchHandleRatio : cfg.desktopHandleRatio;
  return Math.min(noteWidth, Math.min(maxW, Math.max(minW, Math.floor(noteWidth * ratio))));
}

function applyNoteGroupGeometry(
  group: SVGGElement,
  step: number,
  midi: number,
  duration: number,
  role: HarmonicRole,
  metrics: PianoRollMetrics
): void {
  const rowIdx = metrics.maxMidi - midi;
  const x = step * metrics.stepW + 1;
  const y = rowIdx * metrics.rowH + 2;
  const w = Math.max(metrics.stepW - 2, duration * metrics.stepW - 2);
  const h = metrics.rowH - 4;
  const handleW = computeHandleWidth(w, metrics.touchSized);
  const fill = noteRoleColor(role);

  const body = group.querySelector<SVGRectElement>('.pr-note-body');
  if (body) {
    body.setAttribute('x', String(x));
    body.setAttribute('y', String(y));
    body.setAttribute('width', String(w));
    body.setAttribute('height', String(h));
    body.setAttribute('fill', fill);
  }

  const label = group.querySelector<SVGTextElement>('.pr-note-label');
  if (label) {
    label.setAttribute('x', String(x + 5));
    label.setAttribute('y', String(y + Math.round(metrics.rowH * 0.62)));
    label.textContent = duration >= 2 ? koreanNoteName(midi) : '';
  }

  const handle = group.querySelector<SVGRectElement>('.pr-note-resize');
  if (handle) {
    handle.setAttribute('x', String(x + w - handleW));
    handle.setAttribute('y', String(y));
    handle.setAttribute('width', String(handleW));
    handle.setAttribute('height', String(h));
  }

  const grip = group.querySelector<SVGLineElement>('.pr-note-grip');
  if (grip) {
    const gripX = x + w - Math.max(3.5, Math.min(6, handleW * 0.45));
    grip.setAttribute('x1', String(gripX));
    grip.setAttribute('y1', String(y + 4));
    grip.setAttribute('x2', String(gripX));
    grip.setAttribute('y2', String(y + h - 4));
  }
}

function computeLiveRole(
  compiled: CompiledSong,
  project: SongProject,
  step: number,
  midi: number,
  duration: number
): HarmonicRole {
  const rc = resolveChordAtStep(compiled, step);
  return rc ? classifyPitch(midi, rc, project.keyRoot, project.mode, step % 16, duration) : 'passing';
}

function renderL3TrackTabs(activeTrack: L3EditTrack, project: SongProject): string {
  const items: Array<{ id: L3EditTrack; label: string; edited: boolean }> = [
    { id: 'melody', label: '멜로디', edited: project.baked && project.bakedMelody.length > 0 },
    { id: 'chords', label: '코드 반주', edited: Boolean(project.bakedChords) },
    { id: 'bass', label: '베이스', edited: Boolean(project.bakedBass) },
    { id: 'pad', label: '보조/패드', edited: Boolean(project.bakedPad) },
    { id: 'drums', label: '드럼 시퀀서', edited: Boolean(project.customDrums) },
  ];
  return `
    <div class="pr-track-tabs" role="tablist" aria-label="L3 편집 트랙">
      ${items
        .map(
          (item) =>
            `<button class="btn btn-chip${activeTrack === item.id ? ' active' : ''}" data-l3-track="${item.id}" type="button" role="tab" aria-selected="${activeTrack === item.id}">${item.label}${item.edited ? ' •' : ''}</button>`
        )
        .join('')}
    </div>
  `;
}

function renderDrumSequencer(project: SongProject, trackTabsHtml: string): string {
  const pattern: DrumStepPattern = project.customDrums ?? buildDefaultDrumPattern(project.blocks.grooveId);
  const rows: Array<{ kind: DrumKind; label: string; activeSteps: Set<number> }> = [
    { kind: 'kick', label: '킥 (Kick)', activeSteps: new Set(pattern.kicks) },
    { kind: 'snare', label: '스네어 (Snare)', activeSteps: new Set(pattern.snares) },
    { kind: 'hat', label: '하이햇 (Hi-Hat)', activeSteps: new Set(pattern.hats) },
    { kind: 'clap', label: '클랩 (Clap)', activeSteps: new Set(pattern.claps) },
  ];

  const stepHeaders = Array.from({ length: 16 }, (_, s) => {
    const beatStart = s % 4 === 0;
    return `<div class="drum-step-head${beatStart ? ' beat-start' : ''}">${s + 1}</div>`;
  }).join('');

  const gridRows = rows
    .map((r) => {
      const cells = Array.from({ length: 16 }, (_, s) => {
        const active = r.activeSteps.has(s);
        const beatStart = s % 4 === 0;
        return `<button class="drum-cell${active ? ' active' : ''}${beatStart ? ' beat-start' : ''}" data-drum-kind="${r.kind}" data-drum-step="${s}" type="button" aria-pressed="${active}" title="${r.label} ${s + 1}스텝"></button>`;
      }).join('');
      return `
        <div class="drum-row">
          <button class="drum-row-label" data-audition-drum="${r.kind}" type="button" title="클릭해 ${r.label} 미리듣기">${r.label}</button>
          <div class="drum-row-cells">${cells}</div>
        </div>
      `;
    })
    .join('');

  const fillSteps = pattern.fillSteps ?? [];
  const fillEnabled = Boolean(pattern.fillEnabled);
  const fillRows = rows
    .map((r) => {
      const cells = [12, 13, 14, 15]
        .map((s) => {
          const active = fillSteps.some((f) => f.kind === r.kind && f.step === s);
          return `<button class="drum-cell${active ? ' active' : ''}" data-fill-kind="${r.kind}" data-fill-step="${s}" type="button" aria-pressed="${active}" title="필인 ${r.label} ${s + 1}스텝"></button>`;
        })
        .join('');
      return `
        <div class="drum-row">
          <span class="drum-row-label static">${r.label}</span>
          <div class="drum-fill-cells">${cells}</div>
        </div>
      `;
    })
    .join('');

  return `
    <div class="drum-seq-wrap">
      <div class="pianoroll-toolbar">
        ${trackTabsHtml}
        <div class="controls-row pr-controls-row">
          <label class="drum-fill-toggle">
            <input type="checkbox" id="chk-drum-fill"${fillEnabled ? ' checked' : ''} />
            <span>4마디마다 끝박(13~16스텝) 필인 자동 삽입</span>
          </label>
          <button class="btn btn-chip" id="btn-drum-reset" type="button">그루브 기본값으로 초기화</button>
        </div>
      </div>
      <div class="drum-grid-scroll">
        <div class="drum-grid">
          <div class="drum-header-row">
            <div class="drum-row-label static">드럼 채널</div>
            <div class="drum-row-cells">${stepHeaders}</div>
          </div>
          ${gridRows}
        </div>
      </div>
      ${
        fillEnabled
          ? `
            <div class="drum-fill-box">
              <p class="section-title">마디 끝 필인 패턴 (4·8·12·16마디의 13~16스텝)</p>
              <div class="drum-fill-grid">${fillRows}</div>
            </div>
          `
          : ''
      }
    </div>
  `;
}

function renderL3Body(
  project: SongProject,
  compiled: CompiledSong,
  activeStep: number,
  selectedDuration: number,
  opts: {
    showDurationPicker: boolean;
    showTrackTabs?: boolean;
    showUnbake: boolean;
    track?: L3EditTrack;
    loopRange?: LoopBarRange | null;
    coachCompare?: CoachVisualDiff | null;
    coachCompareActive?: boolean;
    visualDiff?: SongVisualDiff | null;
    selectedIds?: ReadonlySet<string>;
    toolMode?: PianoRollToolMode;
    metrics?: PianoRollMetrics;
  } = { showDurationPicker: true, showUnbake: false }
): string {
  const track: L3EditTrack = opts.track ?? 'melody';
  const trackTabsHtml = opts.showTrackTabs ? renderL3TrackTabs(track, project) : '';
  if (track === 'drums') {
    return renderDrumSequencer(project, trackTabsHtml);
  }
  const metrics =
    opts.metrics ?? resolvePianoRollMetrics(PRESETS.pianoRoll.defaultDesktopZoomId, false, track);
  const toolMode: PianoRollToolMode = opts.toolMode ?? 'draw';
  const { minMidi, maxMidi, stepW, rowH, zoomId, touchSized } = metrics;
  const totalPitches = maxMidi - minMidi + 1;
  const svgW = compiled.totalSteps * stepW;
  const svgH = totalPitches * rowH;
  const scalePcs = new Set(getScalePitchClasses(project.keyRoot, project.mode));
  const barWidth = 16 * stepW;
  const chordToneSets = compiled.resolvedChords.map((rc) => new Set(rc.pitchClasses));
  const halfChordToneSets = (compiled.resolvedHalfChords ?? []).map((rc) =>
    rc ? new Set(rc.pitchClasses) : null
  );
  const halfBarWidth = 8 * stepW;
  const totalBars = compiled.resolvedChords.length;
  const normalizedLoop = normalizeLoopRange(opts.loopRange, totalBars);
  const activeBar =
    activeStep >= 0 && activeStep < compiled.totalSteps ? Math.floor(activeStep / 16) : -1;
  const coachCompare = opts.coachCompare ?? null;
  const hasCoachDiff = Boolean(
    coachCompare &&
      (coachCompare.changedChordBars.length > 0 || coachCompare.ghostNotes.length > 0)
  );
  const changedChordMap = new Map(
    (coachCompare?.changedChordBars ?? []).map((item) => [item.bar, item])
  );

  let keysHtml = '';
  let gridRows = '';
  let chordHighlights = '';
  for (let midi = maxMidi; midi >= minMidi; midi--) {
    const pc = wrapPc(midi);
    const white = isWhiteKey(midi);
    const inScale = scalePcs.has(pc);
    const rowIdx = maxMidi - midi;
    const y = rowIdx * rowH;
    keysHtml += `
      <div class="pr-key ${white ? 'white' : 'black'}${inScale ? ' in-scale' : ''}" data-midi="${midi}" style="height:${rowH}px" title="클릭해 ${koreanNoteName(midi, true)} 미리듣기">
        <span>${koreanNoteName(midi, true)}</span>
        <span>${noteName(midi)}</span>
      </div>
    `;
    const rowFill = inScale ? (white ? 'rgba(56,189,248,0.06)' : 'rgba(56,189,248,0.03)') : 'rgba(0,0,0,0.22)';
    gridRows += `<rect x="0" y="${y}" width="${svgW}" height="${rowH}" fill="${rowFill}" />`;

    for (let b = 0; b < compiled.resolvedChords.length; b++) {
      const halfSet = halfChordToneSets[b];
      if (halfSet) {
        if (chordToneSets[b]?.has(pc)) {
          chordHighlights += `<rect x="${b * barWidth}" y="${y}" width="${halfBarWidth}" height="${rowH}" fill="rgba(52, 211, 153, 0.13)" />`;
        }
        if (halfSet.has(pc)) {
          chordHighlights += `<rect x="${b * barWidth + halfBarWidth}" y="${y}" width="${halfBarWidth}" height="${rowH}" fill="rgba(52, 211, 153, 0.13)" />`;
        }
      } else if (chordToneSets[b]?.has(pc)) {
        chordHighlights += `<rect x="${b * barWidth}" y="${y}" width="${barWidth}" height="${rowH}" fill="rgba(52, 211, 153, 0.13)" />`;
      }
    }

    gridRows += `<line x1="0" y1="${y + rowH}" x2="${svgW}" y2="${y + rowH}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
  }

  let vLines = '';
  for (let s = 0; s <= compiled.totalSteps; s++) {
    const x = s * stepW;
    const isBar = s % 16 === 0;
    const isBeat = s % 4 === 0;
    const color = isBar ? 'rgba(148,163,184,0.45)' : isBeat ? 'rgba(148,163,184,0.18)' : 'rgba(255,255,255,0.04)';
    vLines += `<line x1="${x}" y1="0" x2="${x}" y2="${svgH}" stroke="${color}" stroke-width="${isBar ? 1.5 : 1}"/>`;
  }

  const barHeaderCells = compiled.resolvedChords
    .map((rc, idx) => {
      const halfRc = compiled.resolvedHalfChords?.[idx] ?? null;
      const tones = rc.pitchClasses.map((pc) => KOREAN_SOLFEGE[pc]).join('·');
      const chordDisplay = halfRc ? `${rc.symbol} → ${halfRc.symbol}` : `${rc.symbol} (${tones})`;
      const changedChord = hasCoachDiff ? changedChordMap.get(idx) : undefined;
      const inLoop = Boolean(
        normalizedLoop && idx >= normalizedLoop.startBar && idx <= normalizedLoop.endBar
      );
      const isStart = Boolean(normalizedLoop && idx === normalizedLoop.startBar);
      const isEnd = Boolean(normalizedLoop && idx === normalizedLoop.endBar);
      const isActive = idx === activeBar;
      const cls = [
        'pr-bar-cell',
        isActive ? 'active-bar' : '',
        inLoop ? 'in-loop' : '',
        isStart ? 'loop-start' : '',
        isEnd ? 'loop-end' : '',
        changedChord ? 'coach-changed-bar' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const coachChordBadge = changedChord
        ? `<span class="pr-bar-coach-badge" title="튜터 비교 코드: ${escapeHtml(changedChord.afterSymbol)} (${escapeHtml(changedChord.afterTonesKo)})">→ ${escapeHtml(changedChord.afterSymbol)}</span>`
        : '';
      return `
        <div class="${cls}" data-bar="${idx}" style="width:${barWidth}px" title="클릭해 ${idx + 1}마디부터 재생 · 드래그로 구간 반복 지정">
          <span class="pr-bar-num"><span class="pr-bar-seek-icon">▶</span>${idx + 1}마디</span>
          <span class="pr-bar-meta">
            <strong>${chordDisplay}</strong>
            ${coachChordBadge}
            <button class="pr-bar-loop-btn${inLoop ? ' active' : ''}" data-loop-bar="${idx}" type="button" title="${idx + 1}마디 구간 반복 토글 (Shift+클릭으로 구간 확장)">↻</button>
          </span>
        </div>
      `;
    })
    .join('');

  const durationButtons = opts.showDurationPicker
    ? `
        <div class="pr-duration-group">
          <span>음표 길이</span>
          ${PRESETS.noteDurationOptions
            .map(
              (opt) =>
                `<button class="btn btn-chip${opt.steps === selectedDuration ? ' active' : ''}" data-duration="${opt.steps}" type="button">${opt.labelKo}</button>`
            )
            .join('')}
        </div>
      `
    : '';

  const toolButtons = `
    <div class="pr-tool-group" role="group" aria-label="피아노롤 편집 도구">
      <button class="btn btn-chip${toolMode === 'draw' ? ' active' : ''}" id="btn-pr-tool-draw" type="button">입력/이동</button>
      <button class="btn btn-chip${toolMode === 'select' ? ' active' : ''}" id="btn-pr-tool-select" type="button">범위 선택</button>
    </div>
  `;

  const jumpChunks: Array<{ startBar: number; label: string }> = [];
  if (totalBars > 4) {
    for (let start = 0; start < totalBars; start += 4) {
      const end = Math.min(totalBars, start + 4);
      jumpChunks.push({ startBar: start, label: `${start + 1}~${end}` });
    }
  }
  const jumpButtons =
    jumpChunks.length > 0
      ? `
        <div class="pr-jump-group" role="group" aria-label="4마디 빠른 점프">
          <span>이동</span>
          ${jumpChunks
            .map(
              (chunk) =>
                `<button class="btn btn-chip" data-jump-bar="${chunk.startBar}" type="button" title="${chunk.label}마디로 스크롤 이동">${chunk.label}</button>`
            )
            .join('')}
        </div>
      `
      : '';

  const zoomButtons = `
    <div class="pr-zoom-group" role="group" aria-label="피아노롤 확대 배율">
      <span>배율</span>
      ${PRESETS.pianoRoll.zoomLevels
        .map(
          (z) =>
            `<button class="btn btn-chip${z.id === zoomId ? ' active' : ''}" data-pr-zoom="${z.id}" type="button">${z.labelKo}</button>`
        )
        .join('')}
    </div>
  `;

  const loopBadgeHtml = normalizedLoop
    ? `
        <span class="pr-loop-badge">
          <span>구간 반복: ${
            normalizedLoop.startBar === normalizedLoop.endBar
              ? `${normalizedLoop.startBar + 1}마디`
              : `${normalizedLoop.startBar + 1}~${normalizedLoop.endBar + 1}마디`
          }</span>
          <button class="btn btn-chip" id="btn-clear-loop" type="button">반복 해제</button>
        </span>
      `
    : '';

  const coachBadgeHtml = hasCoachDiff
    ? `
        <span class="pr-coach-badge">
          <span>튜터 비교 표시 중</span>
          <button class="btn btn-chip" id="btn-hide-coach-compare" type="button">비교 숨기기</button>
        </span>
      `
    : '';

  const visualDiff = opts.visualDiff ?? null;
  const hasVisualDiff = Boolean(visualDiff?.hasAnyChange);
  const visualDiffBadgeHtml =
    hasVisualDiff && visualDiff
      ? `
        <span class="pr-diff-badge${visualDiff.mode === 'preview' ? ' is-preview' : ''}">
          <span>${visualDiff.label ? `${escapeHtml(visualDiff.label)}: ` : ''}${escapeHtml(visualDiff.summaryText)}</span>
          <button class="btn btn-chip" id="btn-hide-visual-diff" type="button">${visualDiff.mode === 'preview' ? '미리보기 닫기' : '비교 숨기기'}</button>
        </span>
      `
      : '';

  let coachBarTints = '';
  if (hasCoachDiff && coachCompare) {
    for (const c of coachCompare.changedChordBars) {
      if (c.bar >= 0 && c.bar < totalBars) {
        coachBarTints += `<rect class="pr-coach-bar-tint" x="${c.bar * barWidth}" y="0" width="${barWidth}" height="${svgH}" pointer-events="none"/>`;
      }
    }
  }

  const labelFontSize = Math.max(10, Math.round(rowH * 0.5));
  const labelOffsetY = Math.round(rowH * 0.62);
  const trackNotes = getTrackNotesFromCompiled(compiled, track);
  let noteRects = '';
  for (const n of trackNotes) {
    if (n.midi < minMidi || n.midi > maxMidi) continue;
    const rowIdx = maxMidi - n.midi;
    const x = n.step * stepW + 1;
    const y = rowIdx * rowH + 2;
    const w = Math.max(stepW - 2, n.duration * stepW - 2);
    const h = rowH - 4;
    const handleW = computeHandleWidth(w, touchSized);
    const gripX = x + w - Math.max(3.5, Math.min(6, handleW * 0.45));
    const fill =
      track === 'chords'
        ? '#a78bfa'
        : track === 'bass'
          ? '#f59e0b'
          : track === 'pad'
            ? '#2dd4bf'
            : noteRoleColor(n.role ?? 'passing');
    const label = n.duration >= 2 ? koreanNoteName(n.midi) : '';
    const isSelected = Boolean(opts.selectedIds?.has(n.id));
    const isDiffAdded = track === 'melody' && Boolean(visualDiff?.addedMelodyIds.has(n.id));
    const isDiffChanged = track === 'melody' && Boolean(visualDiff?.changedMelodyIds.has(n.id));
    const diffClass = isDiffAdded ? ' is-diff-added' : isDiffChanged ? ' is-diff-changed' : '';
    noteRects += `
      <g class="pr-note${isSelected ? ' selected' : ''}${diffClass}" data-note-id="${n.id}">
        <rect class="pr-note-body" x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="#08111f" stroke-width="1"/>
        <text class="pr-note-label" x="${x + 5}" y="${y + labelOffsetY}" font-size="${labelFontSize}" font-weight="700" fill="#06121f" pointer-events="none">${label}</text>
        <rect class="pr-note-resize" data-note-id="${n.id}" x="${x + w - handleW}" y="${y}" width="${handleW}" height="${h}" rx="2"/>
        <line class="pr-note-grip" x1="${gripX}" y1="${y + 4}" x2="${gripX}" y2="${y + h - 4}" stroke="rgba(255,255,255,0.65)" stroke-width="1.2" stroke-linecap="round" pointer-events="none"/>
      </g>
    `;
  }

  let ghostNoteRects = '';
  if (hasVisualDiff && visualDiff && track === 'melody') {
    for (const r of visualDiff.removedMelodyNotes) {
      if (r.midi < minMidi || r.midi > maxMidi) continue;
      const rowIdx = maxMidi - r.midi;
      const x = r.step * stepW + 1;
      const y = rowIdx * rowH + 2;
      const w = Math.max(stepW - 2, r.duration * stepW - 2);
      const h = rowH - 4;
      const label = r.duration >= 2 ? koreanNoteName(r.midi) : '';
      ghostNoteRects += `
        <g class="pr-diff-removed-note" pointer-events="none">
          <rect class="pr-diff-removed-body" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>
          <text class="pr-diff-removed-label" x="${x + 5}" y="${y + labelOffsetY}" font-size="${labelFontSize}" font-weight="700" pointer-events="none">${escapeHtml(label)}</text>
        </g>
      `;
    }
  }
  if (hasCoachDiff && coachCompare) {
    for (const g of coachCompare.ghostNotes) {
      if (g.midi < minMidi || g.midi > maxMidi) continue;
      const rowIdx = maxMidi - g.midi;
      const x = g.step * stepW + 1;
      const y = rowIdx * rowH + 2;
      const w = Math.max(stepW - 2, g.duration * stepW - 2);
      const h = rowH - 4;
      const label = g.duration >= 2 ? g.label : '';
      ghostNoteRects += `
        <g class="pr-ghost-note" data-bar="${g.bar}" pointer-events="none">
          <rect class="pr-ghost-body" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>
          <text class="pr-ghost-label" x="${x + 5}" y="${y + labelOffsetY}" font-size="${labelFontSize}" font-weight="700" pointer-events="none">${escapeHtml(label)}</text>
        </g>
      `;
    }
  }

  let loopOverlay = '';
  if (normalizedLoop) {
    const win = loopRangeToStepRange(normalizedLoop, compiled.totalSteps);
    const startX = win.startStep * stepW;
    const endX = win.endStep * stepW;
    if (startX > 0) {
      loopOverlay += `<rect class="pr-loop-dim" x="0" y="0" width="${startX}" height="${svgH}" pointer-events="none"/>`;
    }
    if (endX < svgW) {
      loopOverlay += `<rect class="pr-loop-dim" x="${endX}" y="0" width="${svgW - endX}" height="${svgH}" pointer-events="none"/>`;
    }
    loopOverlay += `<line class="pr-loop-bound" x1="${startX}" y1="0" x2="${startX}" y2="${svgH}" pointer-events="none"/>`;
    loopOverlay += `<line class="pr-loop-bound" x1="${endX}" y1="0" x2="${endX}" y2="${svgH}" pointer-events="none"/>`;
  }

  const visiblePlayhead = activeStep >= 0 && activeStep < compiled.totalSteps;
  const playheadX = visiblePlayhead ? activeStep * stepW : 0;
  const playhead = `<line class="pr-playhead" x1="${playheadX}" y1="0" x2="${playheadX}" y2="${svgH}" stroke="#fbbf24" stroke-width="2" visibility="${visiblePlayhead ? 'visible' : 'hidden'}"/>`;

  const ghostLegendHtml = hasCoachDiff
    ? `<span class="legend-item"><span class="swatch swatch-ghost"></span>튜터 예시 (고스트)</span>`
    : '';
  const diffLegendHtml =
    hasVisualDiff && track === 'melody'
      ? `<span class="legend-item"><span class="swatch swatch-diff-added"></span>새 음표 (테두리)</span>
         <span class="legend-item"><span class="swatch swatch-diff-changed"></span>이동·변경 음표 (테두리)</span>
         <span class="legend-item"><span class="swatch swatch-diff-removed"></span>이전 위치 (점선)</span>`
      : '';
  const selCount = opts.selectedIds?.size ?? 0;
  const hasClipboard = Boolean(sharedClipboard && sharedClipboard.items.length > 0);
  const hasNotes = trackNotes.length > 0;
  const selectionBarHtml = `
    <div class="pr-selection-bar" id="pr-selection-bar"${selCount > 0 || hasClipboard || toolMode === 'select' ? '' : ' hidden'}>
      <span class="pr-selection-count" id="pr-selection-count">선택 ${selCount}개</span>
      <button class="btn btn-chip" id="btn-pr-select-all" type="button" title="전체 선택 (Ctrl+A)"${!hasNotes ? ' disabled' : ''}>전체</button>
      <button class="btn btn-chip" id="btn-pr-step-left" type="button" title="한 칸 앞으로 (←)"${selCount === 0 ? ' disabled' : ''}>◀</button>
      <button class="btn btn-chip" id="btn-pr-step-right" type="button" title="한 칸 뒤로 (→)"${selCount === 0 ? ' disabled' : ''}>▶</button>
      <button class="btn btn-chip" id="btn-pr-pitch-down" type="button" title="반음 내리기 (↓)"${selCount === 0 ? ' disabled' : ''}>↓반음</button>
      <button class="btn btn-chip" id="btn-pr-pitch-up" type="button" title="반음 올리기 (↑)"${selCount === 0 ? ' disabled' : ''}>↑반음</button>
      <button class="btn btn-chip" id="btn-pr-dur-down" type="button" title="음표 길이 줄이기"${selCount === 0 ? ' disabled' : ''}>길이-</button>
      <button class="btn btn-chip" id="btn-pr-dur-up" type="button" title="음표 길이 늘리기"${selCount === 0 ? ' disabled' : ''}>길이+</button>
      <button class="btn btn-chip" id="btn-pr-oct-down" type="button" title="1옥타브 내리기 (Shift+↓)"${selCount === 0 ? ' disabled' : ''}>-1옥타브</button>
      <button class="btn btn-chip" id="btn-pr-oct-up" type="button" title="1옥타브 올리기 (Shift+↑)"${selCount === 0 ? ' disabled' : ''}>+1옥타브</button>
      <button class="btn btn-chip" id="btn-pr-copy" type="button" title="복사 (Ctrl+C)"${selCount === 0 ? ' disabled' : ''}>복사</button>
      <button class="btn btn-chip" id="btn-pr-paste" type="button" title="붙여넣기 (Ctrl+V)"${!hasClipboard ? ' disabled' : ''}>붙여넣기</button>
      <button class="btn btn-chip" id="btn-pr-duplicate" type="button" title="바로 뒤에 복제 (Ctrl+D)"${selCount === 0 ? ' disabled' : ''}>복제</button>
      <button class="btn btn-chip" id="btn-pr-delete" type="button" title="삭제 (Del)"${selCount === 0 ? ' disabled' : ''}>삭제</button>
      <button class="btn btn-chip" id="btn-pr-clear-sel" type="button" title="선택 해제 (Esc)"${selCount === 0 ? ' disabled' : ''}>해제</button>
    </div>
  `;

  const velocityBarsHtml = trackNotes
    .filter((n) => n.midi >= minMidi && n.midi <= maxMidi)
    .map((n) => {
      const pct = Math.max(12, Math.min(100, Math.round(n.velocity * 100)));
      const x = n.step * stepW + 2;
      const w = Math.max(8, stepW - 4);
      const fill =
        track === 'chords'
          ? '#a78bfa'
          : track === 'bass'
            ? '#f59e0b'
            : track === 'pad'
              ? '#2dd4bf'
              : noteRoleColor(n.role ?? 'passing');
      return `
        <div class="pr-vel-col" data-vel-note-id="${n.id}" style="left:${x}px;width:${w}px;" title="세기 ${pct}% (드래그해 조절)">
          <div class="pr-vel-bar" style="height:${pct}%;background:${fill};"></div>
        </div>
      `;
    })
    .join('');

  return `
    <div class="pianoroll-wrap${hasCoachDiff && opts.coachCompareActive ? ' coach-comparing' : ''}">
      <div class="pianoroll-toolbar">
        ${trackTabsHtml}
        <div class="legend">
          <span class="legend-item"><span class="swatch" style="background:#34d399"></span>코드톤 (안정)</span>
          <span class="legend-item"><span class="swatch" style="background:#38bdf8"></span>음계/경과음 (자연스러움)</span>
          <span class="legend-item"><span class="swatch" style="background:#fb7185"></span>충돌음 (코치 주의)</span>
          ${ghostLegendHtml}
          ${diffLegendHtml}
        </div>
        <div class="controls-row pr-controls-row">
          ${toolButtons}
          ${durationButtons}
          ${jumpButtons}
          ${zoomButtons}
          ${loopBadgeHtml}
          ${coachBadgeHtml}
          ${visualDiffBadgeHtml}
        </div>
        ${selectionBarHtml}
        <span class="kb-hint">마디 클릭: 이동 · 마디 드래그/↻: 구간 반복 · 빈 칸 클릭: 추가 / 드래그: 다중 선택 · Shift+클릭: 선택 추가 · 드래그: 이동 (Alt: 복사) · Ctrl+C/V/X/D · 방향키: 이동</span>
        <span class="touch-hint">빈 칸 탭: 추가 · 스와이프: 스크롤 · 음표 드래그: 이동 · 더블탭: 삭제 · 범위 선택: 다중 선택</span>
      </div>
      <div class="pr-container">
        <div class="pr-keys-col">
          <div class="pr-keys-corner">음높이</div>
          <div class="pr-keys">${keysHtml}</div>
          <div class="pr-vel-corner">세기</div>
        </div>
        <div class="pr-grid-scroll">
          <div class="pr-bar-header" style="width:${svgW}px">${barHeaderCells}</div>
          <svg class="pr-svg${toolMode === 'select' ? ' pr-tool-select' : ''}" data-step-w="${stepW}" data-row-h="${rowH}" tabindex="0" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
            ${gridRows}
            ${chordHighlights}
            ${coachBarTints}
            ${vLines}
            ${noteRects}
            ${ghostNoteRects}
            ${loopOverlay}
            <rect class="pr-marquee" visibility="hidden" pointer-events="none"/>
            ${playhead}
          </svg>
          <div class="pr-velocity-lane" id="pr-velocity-lane" style="width:${svgW}px">${velocityBarsHtml}</div>
        </div>
      </div>
    </div>
  `;
}

function wireDrumSequencerEvents(
  container: HTMLElement,
  project: SongProject,
  callbacks: LayerCallbacks
): void {
  const ensureCustomDrums = (): DrumStepPattern =>
    project.customDrums
      ? {
          kicks: [...project.customDrums.kicks],
          snares: [...project.customDrums.snares],
          hats: [...project.customDrums.hats],
          claps: [...project.customDrums.claps],
          fillEnabled: project.customDrums.fillEnabled,
          fillSteps: project.customDrums.fillSteps?.map((f) => ({ ...f })),
        }
      : buildDefaultDrumPattern(project.blocks.grooveId);

  container.querySelectorAll<HTMLButtonElement>('[data-audition-drum]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.auditionDrum as DrumKind;
      callbacks.onAuditionDrum?.(kind);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-drum-kind]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.drumKind as DrumKind;
      const step = Number(btn.dataset.drumStep);
      const next = cloneProject(project);
      const pat = ensureCustomDrums();
      const key =
        kind === 'kick' ? 'kicks' : kind === 'snare' ? 'snares' : kind === 'hat' ? 'hats' : 'claps';
      const idx = pat[key].indexOf(step);
      if (idx >= 0) {
        pat[key].splice(idx, 1);
      } else {
        pat[key].push(step);
        pat[key].sort((a, b) => a - b);
        callbacks.onAuditionDrum?.(kind);
      }
      next.customDrums = pat;
      callbacks.onProjectChange(next);
    });
  });

  container.querySelector('#chk-drum-fill')?.addEventListener('change', (e) => {
    const next = cloneProject(project);
    const pat = ensureCustomDrums();
    pat.fillEnabled = (e.target as HTMLInputElement).checked;
    next.customDrums = pat;
    callbacks.onProjectChange(next);
  });

  container.querySelectorAll<HTMLButtonElement>('[data-fill-kind]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.fillKind as DrumKind;
      const step = Number(btn.dataset.fillStep);
      const next = cloneProject(project);
      const pat = ensureCustomDrums();
      const list = pat.fillSteps ? [...pat.fillSteps] : [];
      const existingIdx = list.findIndex((f) => f.kind === kind && f.step === step);
      if (existingIdx >= 0) {
        list.splice(existingIdx, 1);
      } else {
        list.push({ kind, step });
        callbacks.onAuditionDrum?.(kind);
      }
      pat.fillSteps = list;
      next.customDrums = pat;
      callbacks.onProjectChange(next);
    });
  });

  container.querySelector('#btn-drum-reset')?.addEventListener('click', () => {
    const next = cloneProject(project);
    next.customDrums = undefined;
    callbacks.onProjectChange(next);
  });
}

function wireL3Events(
  container: HTMLElement,
  project: SongProject,
  compiled: CompiledSong,
  callbacks: LayerCallbacks,
  metrics: PianoRollMetrics = resolvePianoRollMetrics(PRESETS.pianoRoll.defaultDesktopZoomId, false),
  onRerenderView?: () => void
): void {
  detachContainerKeyHandler(container);
  const activeTrack = getL3Track(container);

  container.querySelectorAll<HTMLButtonElement>('[data-l3-track]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextTrack = btn.dataset.l3Track as L3EditTrack;
      if (nextTrack === activeTrack) return;
      containerL3TrackMap.set(container, nextTrack);
      containerSelectionMap.delete(container);
      onRerenderView?.();
    });
  });

  if (activeTrack === 'drums') {
    wireDrumSequencerEvents(container, project, callbacks);
    return;
  }

  const trackNotes = getTrackNotesFromCompiled(compiled, activeTrack);
  const selectedIds = pruneSelectionForTrack(container, compiled, activeTrack);
  const toolMode = getToolMode(container);
  const { minMidi, maxMidi, stepW, rowH } = metrics;

  const tryCapturePointer = (target: Element | null, pointerId: number): void => {
    if (!target || typeof (target as HTMLElement).setPointerCapture !== 'function') return;
    try {
      (target as HTMLElement).setPointerCapture(pointerId);
    } catch {
      // 합성 포인터 이벤트 등 캡처를 지원하지 않는 환경은 무시한다.
    }
  };

  const tryReleasePointer = (target: Element | null, pointerId: number): void => {
    if (!target || typeof (target as HTMLElement).releasePointerCapture !== 'function') return;
    try {
      if (
        typeof (target as HTMLElement).hasPointerCapture !== 'function' ||
        (target as HTMLElement).hasPointerCapture(pointerId)
      ) {
        (target as HTMLElement).releasePointerCapture(pointerId);
      }
    } catch {
      // 이미 해제된 포인터 캡처는 무시한다.
    }
  };

  container.querySelector('#btn-unbake')?.addEventListener('click', () => {
    const next = cloneProject(project);
    if (activeTrack === 'chords') {
      next.bakedChords = undefined;
    } else if (activeTrack === 'bass') {
      next.bakedBass = undefined;
    } else if (activeTrack === 'pad') {
      next.bakedPad = undefined;
    } else {
      next.baked = false;
      next.bakedMelody = [];
    }
    callbacks.onProjectChange(next);
  });

  container.querySelector('#btn-pr-tool-draw')?.addEventListener('click', () => {
    if (getToolMode(container) === 'draw') return;
    containerToolModeMap.set(container, 'draw');
    onRerenderView?.();
  });

  container.querySelector('#btn-pr-tool-select')?.addEventListener('click', () => {
    if (getToolMode(container) === 'select') return;
    containerToolModeMap.set(container, 'select');
    onRerenderView?.();
  });

  container.querySelectorAll<HTMLButtonElement>('[data-pr-zoom]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextZoom = btn.dataset.prZoom;
      if (!nextZoom || nextZoom === metrics.zoomId) return;
      containerZoomMap.set(container, nextZoom);
      onRerenderView?.();
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-jump-bar]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const startBar = Number(btn.dataset.jumpBar);
      if (!Number.isFinite(startBar)) return;
      const scrollEl = container.querySelector<HTMLElement>('.pr-grid-scroll');
      if (scrollEl) {
        scrollEl.scrollLeft = Math.max(0, startBar * 16 * stepW);
      }
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-duration]').forEach((btn) => {
    btn.addEventListener('click', () => {
      callbacks.onSelectDuration(Number(btn.dataset.duration));
    });
  });

  container.querySelectorAll<HTMLElement>('.pr-key').forEach((el) => {
    el.addEventListener('click', () => {
      callbacks.onAuditionPitch(Number(el.dataset.midi));
    });
  });

  const totalBars = compiled.resolvedChords.length;

  container.querySelector('#btn-clear-loop')?.addEventListener('click', () => {
    callbacks.onLoopRangeChange?.(null);
  });

  container.querySelector('#btn-hide-coach-compare')?.addEventListener('click', () => {
    callbacks.onDismissCoachCompare?.();
  });

  container.querySelector('#btn-hide-visual-diff')?.addEventListener('click', () => {
    callbacks.onClearVisualDiff?.();
  });

  container.querySelectorAll<HTMLButtonElement>('[data-loop-bar]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const barIdx = Number(btn.dataset.loopBar);
      const nextRange = selectLoopBarRange(
        callbacks.loopRange ?? null,
        barIdx,
        totalBars,
        e.shiftKey
      );
      callbacks.onLoopRangeChange?.(nextRange);
    });
  });

  const barHeader = container.querySelector<HTMLElement>('.pr-bar-header');
  if (barHeader && totalBars > 0) {
    const resolveBarFromPointer = (clientX: number, target?: EventTarget | null): number => {
      const headerRect = barHeader.getBoundingClientRect();
      if (headerRect.width > 0) {
        const barW = headerRect.width / totalBars;
        const idx = Math.floor((clientX - headerRect.left) / barW);
        return Math.max(0, Math.min(totalBars - 1, idx));
      }
      const cell = (target as Element | null)?.closest<HTMLElement>('.pr-bar-cell[data-bar]');
      if (cell) {
        return Math.max(0, Math.min(totalBars - 1, Number(cell.dataset.bar)));
      }
      return 0;
    };

    const setPreviewRange = (startBar: number | null, endBar: number | null): void => {
      barHeader.querySelectorAll<HTMLElement>('.pr-bar-cell[data-bar]').forEach((cell) => {
        const idx = Number(cell.dataset.bar);
        const active =
          startBar !== null && endBar !== null && idx >= startBar && idx <= endBar;
        cell.classList.toggle('loop-preview', active);
      });
    };

    barHeader.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const targetEl = e.target as Element | null;
      if (targetEl?.closest('.pr-bar-loop-btn')) return;

      e.preventDefault();
      const anchorBar = resolveBarFromPointer(e.clientX, e.target);
      let hoverBar = anchorBar;
      let draggedAcrossBars = false;
      let cancelled = false;

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKeyDown);
        setPreviewRange(null, null);
      };

      const onMove = (ev: PointerEvent) => {
        const nextBar = resolveBarFromPointer(ev.clientX, ev.target);
        if (nextBar !== anchorBar) {
          draggedAcrossBars = true;
        }
        if (draggedAcrossBars) {
          hoverBar = nextBar;
          setPreviewRange(Math.min(anchorBar, hoverBar), Math.max(anchorBar, hoverBar));
        }
      };

      const onCancel = () => {
        cancelled = true;
        cleanup();
      };

      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') {
          onCancel();
        }
      };

      const onUp = (ev: PointerEvent) => {
        cleanup();
        if (cancelled) return;
        if (draggedAcrossBars) {
          callbacks.onLoopRangeChange?.({
            startBar: Math.min(anchorBar, hoverBar),
            endBar: Math.max(anchorBar, hoverBar),
          });
          return;
        }
        if (e.shiftKey || ev.shiftKey) {
          const nextRange = selectLoopBarRange(
            callbacks.loopRange ?? null,
            anchorBar,
            totalBars,
            true
          );
          callbacks.onLoopRangeChange?.(nextRange);
          return;
        }
        nextPasteStep = anchorBar * 16;
        callbacks.onSeekBar?.(anchorBar);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKeyDown);
    });
  }

  const svg = container.querySelector<SVGSVGElement>('.pr-svg');
  if (!svg) return;

  const bounds = { minMidi, maxMidi };
  let lastClickNoteId: string | null = null;
  let lastClickAt = 0;
  let deletedInUpNoteId: string | null = null;
  let isPointerInteracting = false;

  const getBaseNotes = (): NoteEvent[] =>
    trackNotes.map((n) => ({
      id: n.id,
      midi: n.midi,
      step: n.step,
      duration: n.duration,
      velocity: n.velocity,
      origin: n.origin,
    }));

  const syncSelectionUi = (): void => {
    svg.querySelectorAll<SVGGElement>('.pr-note').forEach((el) => {
      const id = el.dataset.noteId;
      el.classList.toggle('selected', Boolean(id && selectedIds.has(id)));
    });

    const hasClipboard = Boolean(sharedClipboard && sharedClipboard.items.length > 0);
    const count = selectedIds.size;
    const hasNotes = trackNotes.length > 0;
    const bar = container.querySelector<HTMLElement>('#pr-selection-bar');
    if (bar) {
      bar.hidden = count === 0 && !hasClipboard && toolMode !== 'select';
    }
    const countEl = container.querySelector<HTMLElement>('#pr-selection-count');
    if (countEl) {
      countEl.textContent = `선택 ${count}개`;
    }
    const setDisabled = (selector: string, disabled: boolean) => {
      const btn = container.querySelector<HTMLButtonElement>(selector);
      if (btn) btn.disabled = disabled;
    };
    setDisabled('#btn-pr-select-all', !hasNotes);
    setDisabled('#btn-pr-step-left', count === 0);
    setDisabled('#btn-pr-step-right', count === 0);
    setDisabled('#btn-pr-pitch-down', count === 0);
    setDisabled('#btn-pr-pitch-up', count === 0);
    setDisabled('#btn-pr-dur-down', count === 0);
    setDisabled('#btn-pr-dur-up', count === 0);
    setDisabled('#btn-pr-copy', count === 0);
    setDisabled('#btn-pr-paste', !hasClipboard);
    setDisabled('#btn-pr-duplicate', count === 0);
    setDisabled('#btn-pr-oct-down', count === 0);
    setDisabled('#btn-pr-oct-up', count === 0);
    setDisabled('#btn-pr-delete', count === 0);
    setDisabled('#btn-pr-clear-sel', count === 0);
  };

  const commitNotes = (nextNotes: NoteEvent[], nextSelection?: Iterable<string>): void => {
    if (nextSelection && nextSelection !== selectedIds) {
      const nextList = Array.from(nextSelection);
      selectedIds.clear();
      for (const id of nextList) {
        selectedIds.add(id);
      }
    }
    const next = cloneProject(project);
    if (activeTrack === 'chords') {
      next.bakedChords = nextNotes;
    } else if (activeTrack === 'bass') {
      next.bakedBass = nextNotes;
    } else if (activeTrack === 'pad') {
      next.bakedPad = nextNotes;
    } else {
      next.bakedMelody = nextNotes;
      next.baked = true;
    }
    callbacks.onProjectChange(next);
  };

  // 하단 Velocity(음표 세기) 편집 레인 드래그/클릭 이벤트
  const velLane = container.querySelector<HTMLElement>('#pr-velocity-lane');
  if (velLane) {
    velLane.querySelectorAll<HTMLElement>('.pr-vel-col').forEach((col) => {
      col.addEventListener('pointerdown', (e) => {
        const noteId = col.dataset.velNoteId;
        if (!noteId) return;
        e.preventDefault();
        const barEl = col.querySelector<HTMLElement>('.pr-vel-bar');
        let latestVel = 0.8;
        const applyVelFromY = (clientY: number) => {
          const rect = velLane.getBoundingClientRect();
          const h = Math.max(1, rect.height);
          const ratio = 1 - (clientY - rect.top) / h;
          latestVel = Math.max(0.15, Math.min(1, Math.round(ratio * 20) / 20));
          if (barEl) {
            barEl.style.height = `${Math.round(latestVel * 100)}%`;
          }
        };
        applyVelFromY(e.clientY);

        const onMove = (ev: PointerEvent) => {
          applyVelFromY(ev.clientY);
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          const nextNotes = getBaseNotes().map((n) =>
            n.id === noteId ? { ...n, velocity: latestVel, origin: 'user' as const } : n
          );
          commitNotes(nextNotes);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      });
    });
  }

  const selectAllNotes = (): void => {
    selectedIds.clear();
    for (const n of trackNotes) {
      selectedIds.add(n.id);
    }
    syncSelectionUi();
  };

  const deleteSelected = (): void => {
    if (selectedIds.size === 0) return;
    const targetIds = new Set(selectedIds);
    selectedIds.clear();
    commitNotes(deletePianoRollNotes(getBaseNotes(), targetIds));
  };

  const copySelected = (): NoteClipboard | null => {
    const clip = copyPianoRollNotes(getBaseNotes(), selectedIds);
    if (!clip) return null;
    sharedClipboard = clip;
    nextPasteStep = clip.sourceEndStep < compiled.totalSteps ? clip.sourceEndStep : 0;
    syncSelectionUi();
    return clip;
  };

  const cutSelected = (): void => {
    const clip = copySelected();
    if (!clip) return;
    deleteSelected();
  };

  const pasteClipboard = (): void => {
    if (!sharedClipboard) return;
    const targetStep =
      nextPasteStep !== null && nextPasteStep >= 0 && nextPasteStep < compiled.totalSteps
        ? nextPasteStep
        : 0;
    const prefix = `m_paste_${Date.now()}_${++pasteSeq}`;
    const res = pastePianoRollNotes(
      getBaseNotes(),
      sharedClipboard,
      targetStep,
      compiled.totalSteps,
      bounds,
      prefix,
      0,
      true
    );
    if (res.pastedIds.length === 0) return;
    nextPasteStep = res.endStep < compiled.totalSteps ? res.endStep : 0;
    commitNotes(res.notes, res.pastedIds);
  };

  const duplicateSelected = (): void => {
    if (selectedIds.size === 0) return;
    const prefix = `m_dup_${Date.now()}_${++pasteSeq}`;
    const res = duplicatePianoRollNotes(
      getBaseNotes(),
      selectedIds,
      compiled.totalSteps,
      bounds,
      prefix,
      true
    );
    if (res.pastedIds.length === 0) return;
    nextPasteStep = res.endStep < compiled.totalSteps ? res.endStep : 0;
    commitNotes(res.notes, res.pastedIds);
  };

  const nudgeSelected = (deltaStep: number, deltaMidi: number): void => {
    if (selectedIds.size === 0) return;
    const baseNotes = getBaseNotes();
    const clamped = clampGroupDelta(
      baseNotes,
      selectedIds,
      deltaStep,
      deltaMidi,
      compiled.totalSteps,
      bounds
    );
    if (clamped.deltaStep === 0 && clamped.deltaMidi === 0) return;
    if (clamped.deltaMidi !== 0) {
      const anchor = baseNotes.find((n) => selectedIds.has(n.id));
      if (anchor) {
        callbacks.onAuditionPitch(anchor.midi + clamped.deltaMidi);
      }
    }
    const moved = movePianoRollNotes(
      baseNotes,
      selectedIds,
      clamped.deltaStep,
      clamped.deltaMidi,
      compiled.totalSteps,
      bounds,
      true
    );
    commitNotes(moved, selectedIds);
  };

  const adjustSelectedDuration = (deltaSteps: number): void => {
    if (selectedIds.size === 0) return;
    const baseNotes = getBaseNotes();
    const adjusted = adjustPianoRollNotesDuration(
      baseNotes,
      selectedIds,
      deltaSteps,
      compiled.totalSteps,
      true
    );
    const unchanged =
      adjusted.length === baseNotes.length &&
      adjusted.every((n, idx) => n.duration === baseNotes[idx]?.duration);
    if (unchanged) return;
    commitNotes(adjusted, selectedIds);
  };

  syncSelectionUi();

  container.querySelector('#btn-pr-select-all')?.addEventListener('click', () => selectAllNotes());
  container.querySelector('#btn-pr-step-left')?.addEventListener('click', () => nudgeSelected(-1, 0));
  container.querySelector('#btn-pr-step-right')?.addEventListener('click', () => nudgeSelected(1, 0));
  container.querySelector('#btn-pr-pitch-down')?.addEventListener('click', () => nudgeSelected(0, -1));
  container.querySelector('#btn-pr-pitch-up')?.addEventListener('click', () => nudgeSelected(0, 1));
  container.querySelector('#btn-pr-dur-down')?.addEventListener('click', () => adjustSelectedDuration(-1));
  container.querySelector('#btn-pr-dur-up')?.addEventListener('click', () => adjustSelectedDuration(1));
  container.querySelector('#btn-pr-copy')?.addEventListener('click', () => copySelected());
  container.querySelector('#btn-pr-paste')?.addEventListener('click', () => pasteClipboard());
  container.querySelector('#btn-pr-duplicate')?.addEventListener('click', () => duplicateSelected());
  container.querySelector('#btn-pr-oct-down')?.addEventListener('click', () => nudgeSelected(0, -12));
  container.querySelector('#btn-pr-oct-up')?.addEventListener('click', () => nudgeSelected(0, 12));
  container.querySelector('#btn-pr-delete')?.addEventListener('click', () => deleteSelected());
  container.querySelector('#btn-pr-clear-sel')?.addEventListener('click', () => {
    selectedIds.clear();
    syncSelectionUi();
  });

  svg.addEventListener('dblclick', (e) => {
    const targetEl = e.target as Element | null;
    if (targetEl?.closest('.pr-note-resize')) return;
    const noteGroup = targetEl?.closest<SVGGElement>('.pr-note') ?? null;
    const noteId = noteGroup?.getAttribute('data-note-id');
    if (!noteId) return;
    if (deletedInUpNoteId === noteId) {
      deletedInUpNoteId = null;
      return;
    }
    if (!trackNotes.some((n) => n.id === noteId)) return;
    selectedIds.delete(noteId);
    commitNotes(deletePianoRollNote(getBaseNotes(), noteId));
  });

  svg.addEventListener('contextmenu', (e) => {
    const targetEl = e.target as Element | null;
    const noteGroup = targetEl?.closest<SVGGElement>('.pr-note') ?? null;
    const noteId = noteGroup?.getAttribute('data-note-id');
    if (!noteId) return;
    e.preventDefault();
    if (selectedIds.size > 1 && selectedIds.has(noteId)) {
      deleteSelected();
      return;
    }
    if (!trackNotes.some((n) => n.id === noteId)) return;
    selectedIds.delete(noteId);
    commitNotes(deletePianoRollNote(getBaseNotes(), noteId));
  });

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (handledKeyEvents.has(e)) return;
    if (!svg.isConnected || svg.closest('[hidden]')) return;
    const targetEl = e.target as HTMLElement | null;
    const tag = targetEl?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || targetEl?.isContentEditable) {
      return;
    }
    if (isPointerInteracting) return;

    const mod = e.ctrlKey || e.metaKey;
    const lower = e.key.toLowerCase();

    if (mod && !e.altKey) {
      if (lower === 'a') {
        handledKeyEvents.add(e);
        e.preventDefault();
        selectAllNotes();
        return;
      }
      if (lower === 'c' && selectedIds.size > 0) {
        handledKeyEvents.add(e);
        e.preventDefault();
        copySelected();
        return;
      }
      if (lower === 'x' && selectedIds.size > 0) {
        handledKeyEvents.add(e);
        e.preventDefault();
        cutSelected();
        return;
      }
      if (lower === 'v' && sharedClipboard) {
        handledKeyEvents.add(e);
        e.preventDefault();
        pasteClipboard();
        return;
      }
      if (lower === 'd' && selectedIds.size > 0) {
        handledKeyEvents.add(e);
        e.preventDefault();
        duplicateSelected();
        return;
      }
    }

    if (!mod && !e.altKey) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        handledKeyEvents.add(e);
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (e.key === 'Escape' && selectedIds.size > 0) {
        handledKeyEvents.add(e);
        e.preventDefault();
        selectedIds.clear();
        syncSelectionUi();
        return;
      }
      if (selectedIds.size > 0) {
        if (e.key === 'ArrowUp') {
          handledKeyEvents.add(e);
          e.preventDefault();
          nudgeSelected(0, e.shiftKey ? 12 : 1);
          return;
        }
        if (e.key === 'ArrowDown') {
          handledKeyEvents.add(e);
          e.preventDefault();
          nudgeSelected(0, e.shiftKey ? -12 : -1);
          return;
        }
        if (e.key === 'ArrowLeft') {
          handledKeyEvents.add(e);
          e.preventDefault();
          nudgeSelected(e.shiftKey ? -4 : -1, 0);
          return;
        }
        if (e.key === 'ArrowRight') {
          handledKeyEvents.add(e);
          e.preventDefault();
          nudgeSelected(e.shiftKey ? 4 : 1, 0);
          return;
        }
      }
    }
  };

  svg.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keydown', handleKeyDown);
  activeKeyHandlers.set(container, handleKeyDown);

  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;

    const targetEl = e.target as Element | null;
    const resizeEl = targetEl?.closest('.pr-note-resize') ?? null;
    const noteGroup = targetEl?.closest<SVGGElement>('.pr-note') ?? null;
    const baseNotes = getBaseNotes();
    const touchPointer = isTouchPointer(e);
    const dragThresholdPx = touchPointer
      ? PRESETS.pianoRoll.touchDragThresholdPx
      : PRESETS.pianoRoll.mouseDragThresholdPx;

    // 경우 A: 빈 칸 인터랙션 (터치 입력 모드는 네이티브 스크롤 우선, 마우스/선택 모드는 마키 다중 선택)
    if (!noteGroup) {
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const startRect = svg.getBoundingClientRect();

      if (toolMode === 'draw' && touchPointer) {
        const scrollEl = container.querySelector<HTMLElement>('.pr-grid-scroll');
        const startScrollLeft = scrollEl?.scrollLeft ?? 0;
        const startScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
        let scrolled = false;
        let cancelled = false;

        const cleanup = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onCancel);
        };

        const onMove = (ev: PointerEvent) => {
          if (scrolled) return;
          const dist = Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY);
          const curScrollLeft = scrollEl?.scrollLeft ?? 0;
          const curScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
          if (
            dist >= dragThresholdPx ||
            Math.abs(curScrollLeft - startScrollLeft) >= 4 ||
            Math.abs(curScrollY - startScrollY) >= 4
          ) {
            scrolled = true;
          }
        };

        const onCancel = () => {
          cancelled = true;
          cleanup();
        };

        const onUp = () => {
          cleanup();
          if (cancelled || scrolled) return;
          selectedIds.clear();
          syncSelectionUi();

          const x = startClientX - startRect.left;
          const y = startClientY - startRect.top;
          const step = Math.max(0, Math.min(compiled.totalSteps - 1, Math.floor(x / stepW)));
          const row = Math.floor(y / rowH);
          const midi = maxMidi - row;
          if (midi < minMidi || midi > maxMidi) return;

          callbacks.onAuditionPitch(midi);
          const added = addPianoRollNote(baseNotes, {
            id: `m_user_${Date.now()}_${step}_${midi}`,
            midi,
            step,
            duration: callbacks.selectedDuration,
            totalSteps: compiled.totalSteps,
            bounds,
            poly: true,
          });
          commitNotes(added);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
        return;
      }

      e.preventDefault();
      svg.focus({ preventScroll: true });
      if (touchPointer) tryCapturePointer(svg, e.pointerId);
      const additive = e.shiftKey || e.ctrlKey || e.metaKey || toolMode === 'select';
      const initialSelection = new Set(selectedIds);
      const marqueeEl = svg.querySelector<SVGRectElement>('.pr-marquee');
      const totalRows = maxMidi - minMidi + 1;
      let hasMarquee = false;
      let cancelled = false;
      isPointerInteracting = true;

      const toSvgCoords = (clientX: number, clientY: number, curRect: DOMRect) => ({
        x: Math.max(0, Math.min(compiled.totalSteps * stepW, clientX - curRect.left)),
        y: Math.max(0, Math.min(totalRows * rowH, clientY - curRect.top)),
      });

      const cleanup = () => {
        isPointerInteracting = false;
        if (touchPointer) tryReleasePointer(svg, e.pointerId);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onMarqueeKeyDown);
        if (marqueeEl) marqueeEl.setAttribute('visibility', 'hidden');
      };

      const onMove = (ev: PointerEvent) => {
        if (!hasMarquee) {
          if (Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) < dragThresholdPx) {
            return;
          }
          hasMarquee = true;
        }
        const curRect = svg.getBoundingClientRect();
        const p1 = toSvgCoords(startClientX, startClientY, curRect);
        const p2 = toSvgCoords(ev.clientX, ev.clientY, curRect);
        const x1 = Math.min(p1.x, p2.x);
        const x2 = Math.max(p1.x, p2.x);
        const y1 = Math.min(p1.y, p2.y);
        const y2 = Math.max(p1.y, p2.y);

        if (marqueeEl) {
          marqueeEl.setAttribute('x', String(x1));
          marqueeEl.setAttribute('y', String(y1));
          marqueeEl.setAttribute('width', String(Math.max(1, x2 - x1)));
          marqueeEl.setAttribute('height', String(Math.max(1, y2 - y1)));
          marqueeEl.setAttribute('visibility', 'visible');
        }

        const minStep = Math.max(0, Math.min(compiled.totalSteps - 1, Math.floor(x1 / stepW)));
        const maxStep = Math.max(
          0,
          Math.min(compiled.totalSteps - 1, Math.floor(Math.max(x1, x2 - 0.01) / stepW))
        );
        const hiRow = Math.max(0, Math.min(totalRows - 1, Math.floor(y1 / rowH)));
        const loRow = Math.max(
          0,
          Math.min(totalRows - 1, Math.floor(Math.max(y1, y2 - 0.01) / rowH))
        );
        const minHitMidi = maxMidi - loRow;
        const maxHitMidi = maxMidi - hiRow;

        const hitIds = selectNotesInMarquee(baseNotes, minStep, maxStep, minHitMidi, maxHitMidi);
        selectedIds.clear();
        if (additive) {
          for (const id of initialSelection) selectedIds.add(id);
        }
        for (const id of hitIds) selectedIds.add(id);
        syncSelectionUi();
      };

      const onCancel = () => {
        cancelled = true;
        cleanup();
        selectedIds.clear();
        for (const id of initialSelection) selectedIds.add(id);
        syncSelectionUi();
      };

      const onMarqueeKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          onCancel();
        }
      };

      const onUp = () => {
        cleanup();
        if (cancelled || hasMarquee) return;
        selectedIds.clear();
        syncSelectionUi();

        if (toolMode === 'select') return;

        const x = startClientX - startRect.left;
        const y = startClientY - startRect.top;
        const step = Math.max(0, Math.min(compiled.totalSteps - 1, Math.floor(x / stepW)));
        const row = Math.floor(y / rowH);
        const midi = maxMidi - row;
        if (midi < minMidi || midi > maxMidi) return;

        callbacks.onAuditionPitch(midi);
        const added = addPianoRollNote(baseNotes, {
          id: `m_user_${Date.now()}_${step}_${midi}`,
          midi,
          step,
          duration: callbacks.selectedDuration,
          totalSteps: compiled.totalSteps,
          bounds,
          poly: true,
        });
        commitNotes(added);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onMarqueeKeyDown);
      return;
    }

    const noteId = noteGroup.getAttribute('data-note-id');
    const targetNote = trackNotes.find((n) => n.id === noteId);
    if (!targetNote) return;

    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const playheadEl = svg.querySelector('.pr-playhead');
    const raiseNoteOrder = (el: SVGGElement) => {
      if (playheadEl) svg.insertBefore(el, playheadEl);
      else svg.appendChild(el);
    };

    // 경우 B: 오른쪽 끝 핸들 드래그 -> 길이 조절
    if (resizeEl) {
      const maxDuration = computeMaxResizeDuration(baseNotes, targetNote.id, compiled.totalSteps, true);
      let curDuration = targetNote.duration;
      isPointerInteracting = true;
      if (touchPointer) tryCapturePointer(resizeEl, e.pointerId);

      noteGroup.classList.add('resizing');
      svg.classList.add('pr-resizing');
      raiseNoteOrder(noteGroup);

      const cleanup = () => {
        isPointerInteracting = false;
        if (touchPointer) tryReleasePointer(resizeEl, e.pointerId);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKeyDown);
        noteGroup.classList.remove('resizing');
        svg.classList.remove('pr-resizing');
      };

      const onMove = (ev: PointerEvent) => {
        const curRect = svg.getBoundingClientRect();
        const rawEndStep = Math.round((ev.clientX - curRect.left) / stepW);
        const nextDuration = Math.max(1, Math.min(maxDuration, rawEndStep - targetNote.step));
        if (nextDuration !== curDuration) {
          curDuration = nextDuration;
          const liveRole = computeLiveRole(compiled, project, targetNote.step, targetNote.midi, curDuration);
          applyNoteGroupGeometry(noteGroup, targetNote.step, targetNote.midi, curDuration, liveRole, metrics);
        }
      };

      const onCancel = () => {
        cleanup();
        applyNoteGroupGeometry(
          noteGroup,
          targetNote.step,
          targetNote.midi,
          targetNote.duration,
          targetNote.role ?? 'passing',
          metrics
        );
      };

      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') {
          onCancel();
        }
      };

      const onUp = () => {
        cleanup();
        if (curDuration !== targetNote.duration) {
          commitNotes(
            resizePianoRollNote(baseNotes, targetNote.id, curDuration, compiled.totalSteps, true),
            selectedIds
          );
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKeyDown);
      return;
    }

    // 경우 C: 음표 본체 드래그 -> 단일/다중 이동(Alt: 복사 이동), Shift/Ctrl/선택모드 탭 -> 토글, 클릭 -> 선택/미리듣기, 더블클릭 -> 삭제
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const toggleModifier = e.shiftKey || e.ctrlKey || e.metaKey || toolMode === 'select';
    const dragIds = selectedIds.has(targetNote.id) ? new Set(selectedIds) : new Set([targetNote.id]);
    const dragNotes = trackNotes.filter((n) => dragIds.has(n.id));
    const dragGroups = new Map<string, SVGGElement>();
    for (const dn of dragNotes) {
      const g = svg.querySelector<SVGGElement>(`.pr-note[data-note-id="${dn.id}"]`);
      if (g) dragGroups.set(dn.id, g);
    }

    const pointerStartStep = Math.floor((e.clientX - rect.left) / stepW);
    const grabStepOffset = Math.max(
      0,
      Math.min(Math.max(0, targetNote.duration - 1), pointerStartStep - targetNote.step)
    );
    let hasDragged = false;
    let curDeltaStep = 0;
    let curDeltaMidi = 0;
    isPointerInteracting = true;
    if (touchPointer) tryCapturePointer(noteGroup, e.pointerId);

    const cleanup = () => {
      isPointerInteracting = false;
      if (touchPointer) tryReleasePointer(noteGroup, e.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKeyDown);
      for (const g of dragGroups.values()) {
        g.classList.remove('dragging');
      }
      svg.classList.remove('pr-dragging');
    };

    const restoreDragGeometry = () => {
      for (const dn of dragNotes) {
        const g = dragGroups.get(dn.id);
        if (g) {
          applyNoteGroupGeometry(g, dn.step, dn.midi, dn.duration, dn.role ?? 'passing', metrics);
        }
      }
    };

    const onMove = (ev: PointerEvent) => {
      if (!hasDragged) {
        if (Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) < dragThresholdPx) {
          return;
        }
        hasDragged = true;
        if (!selectedIds.has(targetNote.id)) {
          selectedIds.clear();
          selectedIds.add(targetNote.id);
          syncSelectionUi();
        }
        for (const g of dragGroups.values()) {
          g.classList.add('dragging');
          raiseNoteOrder(g);
        }
        svg.classList.add('pr-dragging');
      }

      const curRect = svg.getBoundingClientRect();
      const pointerStep = Math.floor((ev.clientX - curRect.left) / stepW);
      const pointerRow = Math.floor((ev.clientY - curRect.top) / rowH);
      const targetStep = Math.max(0, Math.min(compiled.totalSteps - 1, pointerStep - grabStepOffset));
      const targetMidi = Math.max(minMidi, Math.min(maxMidi, maxMidi - pointerRow));

      const clamped = clampGroupDelta(
        baseNotes,
        dragIds,
        targetStep - targetNote.step,
        targetMidi - targetNote.midi,
        compiled.totalSteps,
        bounds
      );

      if (clamped.deltaMidi !== curDeltaMidi) {
        callbacks.onAuditionPitch(targetNote.midi + clamped.deltaMidi);
      }

      if (clamped.deltaStep !== curDeltaStep || clamped.deltaMidi !== curDeltaMidi) {
        curDeltaStep = clamped.deltaStep;
        curDeltaMidi = clamped.deltaMidi;
        for (const dn of dragNotes) {
          const g = dragGroups.get(dn.id);
          if (!g) continue;
          const ns = dn.step + curDeltaStep;
          const nm = dn.midi + curDeltaMidi;
          const previewDur = Math.max(1, Math.min(dn.duration, compiled.totalSteps - ns));
          const liveRole = computeLiveRole(compiled, project, ns, nm, previewDur);
          applyNoteGroupGeometry(g, ns, nm, previewDur, liveRole, metrics);
        }
      }
    };

    const onCancel = () => {
      cleanup();
      restoreDragGeometry();
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        onCancel();
      }
    };

    const onUp = (ev: PointerEvent) => {
      cleanup();
      if (!hasDragged) {
        svg.focus({ preventScroll: true });
        if (toggleModifier) {
          if (selectedIds.has(targetNote.id)) {
            selectedIds.delete(targetNote.id);
          } else {
            selectedIds.add(targetNote.id);
            callbacks.onAuditionPitch(targetNote.midi);
          }
          lastClickNoteId = null;
          syncSelectionUi();
          return;
        }
        const now = Date.now();
        if (lastClickNoteId === targetNote.id && now - lastClickAt <= 350) {
          lastClickNoteId = null;
          deletedInUpNoteId = targetNote.id;
          selectedIds.delete(targetNote.id);
          commitNotes(deletePianoRollNote(baseNotes, targetNote.id));
          return;
        }
        selectedIds.clear();
        selectedIds.add(targetNote.id);
        syncSelectionUi();
        callbacks.onAuditionPitch(targetNote.midi);
        lastClickNoteId = targetNote.id;
        lastClickAt = now;
        return;
      }

      if (curDeltaStep !== 0 || curDeltaMidi !== 0) {
        if (e.altKey || ev.altKey) {
          const clip = copyPianoRollNotes(baseNotes, dragIds);
          if (clip) {
            const targetStart = clip.sourceStartStep + curDeltaStep;
            const prefix = `m_alt_${Date.now()}_${++pasteSeq}`;
            const res = pastePianoRollNotes(
              baseNotes,
              clip,
              targetStart,
              compiled.totalSteps,
              bounds,
              prefix,
              curDeltaMidi,
              true
            );
            if (res.pastedIds.length > 0) {
              commitNotes(res.notes, res.pastedIds);
              return;
            }
          }
          restoreDragGeometry();
          return;
        }

        const moved = movePianoRollNotes(
          baseNotes,
          dragIds,
          curDeltaStep,
          curDeltaMidi,
          compiled.totalSteps,
          bounds,
          true
        );
        commitNotes(moved, dragIds);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown);
  });
}
