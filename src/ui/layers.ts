import type { CoachVisualDiff } from '../core/coachPatch';
import { type CompiledSong, previewModifierDiff } from '../core/compiler';
import {
  PRESETS,
  type ChordInstrument,
  type ModifierId,
  type NoteEvent,
  type SongProject,
  cloneProject,
} from '../core/model';
import {
  addPianoRollNote,
  computeMaxResizeDuration,
  deletePianoRollNote,
  movePianoRollNote,
  resizePianoRollNote,
} from '../core/pianoRollOps';
import {
  type LoopBarRange,
  loopRangeToStepRange,
  normalizeLoopRange,
  selectLoopBarRange,
} from '../core/playbackControl';
import {
  type HarmonicRole,
  KOREAN_SOLFEGE,
  classifyPitch,
  getScalePitchClasses,
  isWhiteKey,
  koreanNoteName,
  noteName,
  wrapPc,
} from '../core/theory';

export interface ProjectChangeOptions {
  recompileAudioOnly?: boolean;
  recordHistory?: boolean;
  historyBase?: SongProject;
}

export interface LayerCallbacks {
  selectedDuration: number;
  chordView?: ChordInstrument;
  loopRange?: LoopBarRange | null;
  preserveBakedOnChordChange?: boolean;
  coachCompare?: CoachVisualDiff | null;
  coachCompareActive?: boolean;
  onSelectDuration: (steps: number) => void;
  onTogglePreserveBaked?: (preserve: boolean) => void;
  onProjectChange: (next: SongProject, options?: boolean | ProjectChangeOptions) => void;
  onAuditionPitch: (midi: number) => void;
  onPreviewModifier: (modifierId: ModifierId, after: boolean) => void;
  onSeekBar?: (barIdx: number) => void;
  onLoopRangeChange?: (range: LoopBarRange | null) => void;
  onDismissCoachCompare?: () => void;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const PR_MIN_MIDI = 60; // C4
const PR_MAX_MIDI = 84; // C6
const ROW_H = 20;
const STEP_W = 20;

export function computeFollowScrollLeft(
  playheadX: number,
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number
): number {
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  if (maxScroll <= 0 || clientWidth <= 0) return scrollLeft;

  const leftMargin = Math.min(STEP_W * 2, Math.floor(clientWidth * 0.1));
  const rightMargin = Math.min(STEP_W * 4, Math.floor(clientWidth * 0.15));

  if (playheadX < scrollLeft || playheadX > scrollLeft + clientWidth - rightMargin) {
    return Math.max(0, Math.min(maxScroll, playheadX - leftMargin));
  }
  return scrollLeft;
}

export function updatePianoRollPlayhead(container: HTMLElement, activeStep: number, totalSteps: number): void {
  const visible = activeStep >= 0 && activeStep < totalSteps;
  const activeBar = visible ? Math.floor(activeStep / 16) : -1;
  container.querySelectorAll<HTMLElement>('.pr-bar-cell[data-bar]').forEach((cell) => {
    cell.classList.toggle('active-bar', Number(cell.dataset.bar) === activeBar);
  });

  const line = container.querySelector<SVGLineElement>('.pr-playhead');
  if (!line) return;
  const x = visible ? activeStep * STEP_W : 0;
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
        scrollEl.scrollWidth
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
  container.innerHTML = renderL3Body(project, compiled, activeStep, options.selectedDuration, {
    showDurationPicker: options.showDurationPicker,
    showUnbake: Boolean(options.showUnbake),
    loopRange: options.loopRange,
  });
  const scrollEl = container.querySelector<HTMLElement>('.pr-grid-scroll');
  if (scrollEl && prevScrollLeft > 0) {
    scrollEl.scrollLeft = prevScrollLeft;
  }
  wireL3Events(container, project, compiled, {
    selectedDuration: options.selectedDuration,
    loopRange: options.loopRange,
    onSelectDuration: options.onSelectDuration,
    onProjectChange: options.onProjectChange,
    onAuditionPitch: options.onAuditionPitch,
    onPreviewModifier: () => {},
    onSeekBar: options.onSeekBar,
    onLoopRangeChange: options.onLoopRangeChange,
  });
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

  if (layer === 'L1') {
    container.innerHTML = tabsHtml + renderL1Body(project);
    wireTabs(container, project, callbacks);
    wireL1Events(container, project, callbacks);
    return;
  }

  if (layer === 'L2') {
    const chordView = callbacks.chordView ?? 'piano';
    container.innerHTML =
      tabsHtml + renderL2Body(project, compiled, preserveBakedOnChordChange, chordView);
    wireTabs(container, project, callbacks);
    wireL2Events(container, project, callbacks, preserveBakedOnChordChange);
    return;
  }

  container.innerHTML = tabsHtml + renderL3Body(project, compiled, activeStep, callbacks.selectedDuration, {
    showDurationPicker: true,
    showUnbake: false,
    loopRange: callbacks.loopRange,
    coachCompare: callbacks.coachCompare,
    coachCompareActive: callbacks.coachCompareActive,
  });
  const scrollEl = container.querySelector<HTMLElement>('.pr-grid-scroll');
  if (scrollEl && prevScrollLeft > 0) {
    scrollEl.scrollLeft = prevScrollLeft;
  }
  wireTabs(container, project, callbacks);
  wireL3Events(container, project, compiled, callbacks);
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
      callbacks.onProjectChange(next);
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
      callbacks.onProjectChange(next);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-contour]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = cloneProject(workingProject);
      next.blocks.contourId = btn.dataset.contour!;
      next.baked = false;
      workingProject = cloneProject(next);
      callbacks.onProjectChange(next);
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

function renderL2Body(
  project: SongProject,
  compiled: CompiledSong,
  preserveBakedOnChordChange: boolean,
  chordView: ChordInstrument = 'piano'
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

  const chordSlots = project.chain.chords
    .slice(0, project.bars)
    .map((slot, idx) => {
      const rc = compiled.resolvedChords[idx];
      const opts = PRESETS.availableDegrees
        .map((deg) => `<option value="${deg}"${deg === slot.degree ? ' selected' : ''}>${deg}</option>`)
        .join('');
      return `
        <div class="l2-chord-slot">
          <span>${idx + 1}마디 (${rc?.symbol ?? ''})</span>
          <select class="sel-degree" data-bar="${idx}">${opts}</select>
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
    <p class="section-title">마디별 코드 도수 직접 바꾸기 (L1 진행이 펼쳐진 상태)</p>
    ${bakedGuardHtml}
    <div class="l2-chords-editor">${chordSlots}</div>
    <p class="section-title">멜로디·화성 변형 체인 (켜고 끄며 차이 듣기)</p>
    <div class="modifier-list">${modCards}</div>
  `;
}

function wireL2Events(
  container: HTMLElement,
  project: SongProject,
  callbacks: LayerCallbacks,
  preserveBakedOnChordChange: boolean
): void {
  let workingProject = cloneProject(project);
  let preserveBaked = preserveBakedOnChordChange;
  const modStartSnapshots = new Map<ModifierId, SongProject>();

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
        next.chain.chords[bar].degree = sel.value as SongProject['chain']['chords'][number]['degree'];
      }
      const keepBaked = Boolean(workingProject.baked && workingProject.bakedMelody.length > 0 && preserveBaked);
      if (!keepBaked) {
        next.baked = false;
      }
      workingProject = cloneProject(next);
      callbacks.onProjectChange(next);
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
      callbacks.onProjectChange(next);
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

function computeHandleWidth(noteWidth: number): number {
  return Math.min(8, Math.max(6, Math.floor(noteWidth * 0.35)));
}

function applyNoteGroupGeometry(
  group: SVGGElement,
  step: number,
  midi: number,
  duration: number,
  role: HarmonicRole
): void {
  const rowIdx = PR_MAX_MIDI - midi;
  const x = step * STEP_W + 1;
  const y = rowIdx * ROW_H + 2;
  const w = Math.max(STEP_W - 2, duration * STEP_W - 2);
  const h = ROW_H - 4;
  const handleW = computeHandleWidth(w);
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
    label.setAttribute('y', String(y + 12));
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
    grip.setAttribute('x1', String(x + w - 3.5));
    grip.setAttribute('y1', String(y + 4));
    grip.setAttribute('x2', String(x + w - 3.5));
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
  const bar = Math.max(0, Math.min(compiled.resolvedChords.length - 1, Math.floor(step / 16)));
  const rc = compiled.resolvedChords[bar];
  return rc ? classifyPitch(midi, rc, project.keyRoot, project.mode, step % 16, duration) : 'passing';
}

function renderL3Body(
  project: SongProject,
  compiled: CompiledSong,
  activeStep: number,
  selectedDuration: number,
  opts: {
    showDurationPicker: boolean;
    showUnbake: boolean;
    loopRange?: LoopBarRange | null;
    coachCompare?: CoachVisualDiff | null;
    coachCompareActive?: boolean;
  } = { showDurationPicker: true, showUnbake: false }
): string {
  const totalPitches = PR_MAX_MIDI - PR_MIN_MIDI + 1;
  const svgW = compiled.totalSteps * STEP_W;
  const svgH = totalPitches * ROW_H;
  const scalePcs = new Set(getScalePitchClasses(project.keyRoot, project.mode));
  const barWidth = 16 * STEP_W;
  const chordToneSets = compiled.resolvedChords.map((rc) => new Set(rc.pitchClasses));
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
  for (let midi = PR_MAX_MIDI; midi >= PR_MIN_MIDI; midi--) {
    const pc = wrapPc(midi);
    const white = isWhiteKey(midi);
    const inScale = scalePcs.has(pc);
    const rowIdx = PR_MAX_MIDI - midi;
    const y = rowIdx * ROW_H;
    keysHtml += `
      <div class="pr-key ${white ? 'white' : 'black'}${inScale ? ' in-scale' : ''}" data-midi="${midi}" title="클릭해 ${koreanNoteName(midi, true)} 미리듣기">
        <span>${koreanNoteName(midi, true)}</span>
        <span>${noteName(midi)}</span>
      </div>
    `;
    const rowFill = inScale ? (white ? 'rgba(56,189,248,0.06)' : 'rgba(56,189,248,0.03)') : 'rgba(0,0,0,0.22)';
    gridRows += `<rect x="0" y="${y}" width="${svgW}" height="${ROW_H}" fill="${rowFill}" />`;

    for (let b = 0; b < compiled.resolvedChords.length; b++) {
      if (chordToneSets[b]?.has(pc)) {
        chordHighlights += `<rect x="${b * barWidth}" y="${y}" width="${barWidth}" height="${ROW_H}" fill="rgba(52, 211, 153, 0.13)" />`;
      }
    }

    gridRows += `<line x1="0" y1="${y + ROW_H}" x2="${svgW}" y2="${y + ROW_H}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
  }

  let vLines = '';
  for (let s = 0; s <= compiled.totalSteps; s++) {
    const x = s * STEP_W;
    const isBar = s % 16 === 0;
    const isBeat = s % 4 === 0;
    const color = isBar ? 'rgba(148,163,184,0.45)' : isBeat ? 'rgba(148,163,184,0.18)' : 'rgba(255,255,255,0.04)';
    vLines += `<line x1="${x}" y1="0" x2="${x}" y2="${svgH}" stroke="${color}" stroke-width="${isBar ? 1.5 : 1}"/>`;
  }

  const barHeaderCells = compiled.resolvedChords
    .map((rc, idx) => {
      const tones = rc.pitchClasses.map((pc) => KOREAN_SOLFEGE[pc]).join('·');
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
            <strong>${rc.symbol} (${tones})</strong>
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

  let coachBarTints = '';
  if (hasCoachDiff && coachCompare) {
    for (const c of coachCompare.changedChordBars) {
      if (c.bar >= 0 && c.bar < totalBars) {
        coachBarTints += `<rect class="pr-coach-bar-tint" x="${c.bar * barWidth}" y="0" width="${barWidth}" height="${svgH}" pointer-events="none"/>`;
      }
    }
  }

  let noteRects = '';
  for (const n of compiled.melody) {
    if (n.midi < PR_MIN_MIDI || n.midi > PR_MAX_MIDI) continue;
    const rowIdx = PR_MAX_MIDI - n.midi;
    const x = n.step * STEP_W + 1;
    const y = rowIdx * ROW_H + 2;
    const w = Math.max(STEP_W - 2, n.duration * STEP_W - 2);
    const h = ROW_H - 4;
    const handleW = computeHandleWidth(w);
    const fill = noteRoleColor(n.role);
    const label = n.duration >= 2 ? koreanNoteName(n.midi) : '';
    noteRects += `
      <g class="pr-note" data-note-id="${n.id}">
        <rect class="pr-note-body" x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="#08111f" stroke-width="1"/>
        <text class="pr-note-label" x="${x + 5}" y="${y + 12}" font-size="10" font-weight="700" fill="#06121f" pointer-events="none">${label}</text>
        <rect class="pr-note-resize" data-note-id="${n.id}" x="${x + w - handleW}" y="${y}" width="${handleW}" height="${h}" rx="2"/>
        <line class="pr-note-grip" x1="${x + w - 3.5}" y1="${y + 4}" x2="${x + w - 3.5}" y2="${y + h - 4}" stroke="rgba(255,255,255,0.65)" stroke-width="1.2" stroke-linecap="round" pointer-events="none"/>
      </g>
    `;
  }

  let ghostNoteRects = '';
  if (hasCoachDiff && coachCompare) {
    for (const g of coachCompare.ghostNotes) {
      if (g.midi < PR_MIN_MIDI || g.midi > PR_MAX_MIDI) continue;
      const rowIdx = PR_MAX_MIDI - g.midi;
      const x = g.step * STEP_W + 1;
      const y = rowIdx * ROW_H + 2;
      const w = Math.max(STEP_W - 2, g.duration * STEP_W - 2);
      const h = ROW_H - 4;
      const label = g.duration >= 2 ? g.label : '';
      ghostNoteRects += `
        <g class="pr-ghost-note" data-bar="${g.bar}" pointer-events="none">
          <rect class="pr-ghost-body" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>
          <text class="pr-ghost-label" x="${x + 5}" y="${y + 12}" font-size="10" font-weight="700" pointer-events="none">${escapeHtml(label)}</text>
        </g>
      `;
    }
  }

  let loopOverlay = '';
  if (normalizedLoop) {
    const win = loopRangeToStepRange(normalizedLoop, compiled.totalSteps);
    const startX = win.startStep * STEP_W;
    const endX = win.endStep * STEP_W;
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
  const playheadX = visiblePlayhead ? activeStep * STEP_W : 0;
  const playhead = `<line class="pr-playhead" x1="${playheadX}" y1="0" x2="${playheadX}" y2="${svgH}" stroke="#fbbf24" stroke-width="2" visibility="${visiblePlayhead ? 'visible' : 'hidden'}"/>`;

  const ghostLegendHtml = hasCoachDiff
    ? `<span class="legend-item"><span class="swatch swatch-ghost"></span>튜터 예시 (고스트)</span>`
    : '';

  return `
    <div class="pianoroll-wrap${hasCoachDiff && opts.coachCompareActive ? ' coach-comparing' : ''}">
      <div class="pianoroll-toolbar">
        <div class="legend">
          <span class="legend-item"><span class="swatch" style="background:#34d399"></span>코드톤 (안정)</span>
          <span class="legend-item"><span class="swatch" style="background:#38bdf8"></span>음계/경과음 (자연스러움)</span>
          <span class="legend-item"><span class="swatch" style="background:#fb7185"></span>충돌음 (코치 주의)</span>
          ${ghostLegendHtml}
        </div>
        <div class="controls-row">
          ${durationButtons}
          ${loopBadgeHtml}
          ${coachBadgeHtml}
        </div>
        <span>마디 클릭: 이동 · 마디 드래그/↻: 구간 반복 · 빈 칸: 추가 · 클릭: 미리듣기 · 드래그: 이동 · 더블/우클릭·Del: 삭제 · PC 건반(A~K)</span>
      </div>
      <div class="pr-container">
        <div class="pr-keys-col">
          <div class="pr-keys-corner">음높이</div>
          <div class="pr-keys">${keysHtml}</div>
        </div>
        <div class="pr-grid-scroll">
          <div class="pr-bar-header" style="width:${svgW}px">${barHeaderCells}</div>
          <svg class="pr-svg" tabindex="0" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
            ${gridRows}
            ${chordHighlights}
            ${coachBarTints}
            ${vLines}
            ${noteRects}
            ${ghostNoteRects}
            ${loopOverlay}
            ${playhead}
          </svg>
        </div>
      </div>
    </div>
  `;
}

function wireL3Events(
  container: HTMLElement,
  project: SongProject,
  compiled: CompiledSong,
  callbacks: LayerCallbacks
): void {
  container.querySelector('#btn-unbake')?.addEventListener('click', () => {
    const next = cloneProject(project);
    next.baked = false;
    next.bakedMelody = [];
    callbacks.onProjectChange(next);
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

  const DRAG_THRESHOLD_PX = 4;
  let selectedNoteId: string | null = null;
  let lastClickNoteId: string | null = null;
  let lastClickAt = 0;
  let deletedInUpNoteId: string | null = null;

  const selectNote = (id: string | null): void => {
    selectedNoteId = id;
    svg.querySelectorAll<SVGGElement>('.pr-note').forEach((el) => {
      el.classList.toggle('selected', id !== null && el.dataset.noteId === id);
    });
  };

  const deleteNoteById = (noteId: string): void => {
    if (!compiled.melody.some((n) => n.id === noteId)) return;
    const baseNotes: NoteEvent[] = compiled.melody.map(({ role: _r, ...rest }) => ({ ...rest }));
    const next = cloneProject(project);
    next.bakedMelody = deletePianoRollNote(baseNotes, noteId);
    next.baked = true;
    if (selectedNoteId === noteId) selectedNoteId = null;
    callbacks.onProjectChange(next);
  };

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
    deleteNoteById(noteId);
  });

  svg.addEventListener('contextmenu', (e) => {
    const targetEl = e.target as Element | null;
    const noteGroup = targetEl?.closest<SVGGElement>('.pr-note') ?? null;
    const noteId = noteGroup?.getAttribute('data-note-id');
    if (!noteId) return;
    e.preventDefault();
    deleteNoteById(noteId);
  });

  svg.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNoteId) {
      e.preventDefault();
      deleteNoteById(selectedNoteId);
    }
  });

  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;

    const targetEl = e.target as Element | null;
    const resizeEl = targetEl?.closest('.pr-note-resize') ?? null;
    const noteGroup = targetEl?.closest<SVGGElement>('.pr-note') ?? null;
    const baseNotes: NoteEvent[] = compiled.melody.map(({ role: _r, ...rest }) => ({ ...rest }));

    // 경우 A: 빈 칸 클릭 -> 새 음표 추가
    if (!noteGroup) {
      selectNote(null);
      svg.focus({ preventScroll: true });
      const rect = svg.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const step = Math.max(0, Math.min(compiled.totalSteps - 1, Math.floor(x / STEP_W)));
      const row = Math.floor(y / ROW_H);
      const midi = PR_MAX_MIDI - row;
      if (midi < PR_MIN_MIDI || midi > PR_MAX_MIDI) return;

      callbacks.onAuditionPitch(midi);
      const next = cloneProject(project);
      next.bakedMelody = addPianoRollNote(baseNotes, {
        id: `m_user_${Date.now()}_${step}`,
        midi,
        step,
        duration: callbacks.selectedDuration,
        totalSteps: compiled.totalSteps,
        bounds: { minMidi: PR_MIN_MIDI, maxMidi: PR_MAX_MIDI },
      });
      next.baked = true;
      callbacks.onProjectChange(next);
      return;
    }

    const noteId = noteGroup.getAttribute('data-note-id');
    const targetNote = compiled.melody.find((n) => n.id === noteId);
    if (!targetNote) return;

    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const playheadEl = svg.querySelector('.pr-playhead');
    const raiseNoteOrder = () => {
      if (playheadEl) svg.insertBefore(noteGroup, playheadEl);
      else svg.appendChild(noteGroup);
    };

    // 경우 B: 오른쪽 끝 핸들 드래그 -> 길이 조절
    if (resizeEl) {
      const maxDuration = computeMaxResizeDuration(baseNotes, targetNote.id, compiled.totalSteps);
      let curDuration = targetNote.duration;

      noteGroup.classList.add('resizing');
      svg.classList.add('pr-resizing');
      raiseNoteOrder();

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKeyDown);
        noteGroup.classList.remove('resizing');
        svg.classList.remove('pr-resizing');
      };

      const onMove = (ev: PointerEvent) => {
        const curRect = svg.getBoundingClientRect();
        const rawEndStep = Math.round((ev.clientX - curRect.left) / STEP_W);
        const nextDuration = Math.max(1, Math.min(maxDuration, rawEndStep - targetNote.step));
        if (nextDuration !== curDuration) {
          curDuration = nextDuration;
          const liveRole = computeLiveRole(compiled, project, targetNote.step, targetNote.midi, curDuration);
          applyNoteGroupGeometry(noteGroup, targetNote.step, targetNote.midi, curDuration, liveRole);
        }
      };

      const onCancel = () => {
        cleanup();
        applyNoteGroupGeometry(
          noteGroup,
          targetNote.step,
          targetNote.midi,
          targetNote.duration,
          targetNote.role
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
          const next = cloneProject(project);
          next.bakedMelody = resizePianoRollNote(baseNotes, targetNote.id, curDuration, compiled.totalSteps);
          next.baked = true;
          callbacks.onProjectChange(next);
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKeyDown);
      return;
    }

    // 경우 C: 음표 본체 드래그 -> 음높이/박자 이동, 단순 클릭 -> 선택/미리듣기, 더블클릭 -> 삭제
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const pointerStartStep = Math.floor((e.clientX - rect.left) / STEP_W);
    const grabStepOffset = Math.max(
      0,
      Math.min(Math.max(0, targetNote.duration - 1), pointerStartStep - targetNote.step)
    );
    let hasDragged = false;
    let curStep = targetNote.step;
    let curMidi = targetNote.midi;

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKeyDown);
      noteGroup.classList.remove('dragging');
      svg.classList.remove('pr-dragging');
    };

    const onMove = (ev: PointerEvent) => {
      if (!hasDragged) {
        if (Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) < DRAG_THRESHOLD_PX) {
          return;
        }
        hasDragged = true;
        noteGroup.classList.add('dragging');
        svg.classList.add('pr-dragging');
        raiseNoteOrder();
      }

      const curRect = svg.getBoundingClientRect();
      const pointerStep = Math.floor((ev.clientX - curRect.left) / STEP_W);
      const pointerRow = Math.floor((ev.clientY - curRect.top) / ROW_H);
      const nextStep = Math.max(0, Math.min(compiled.totalSteps - 1, pointerStep - grabStepOffset));
      const nextMidi = Math.max(PR_MIN_MIDI, Math.min(PR_MAX_MIDI, PR_MAX_MIDI - pointerRow));

      if (nextMidi !== curMidi) {
        callbacks.onAuditionPitch(nextMidi);
      }

      if (nextStep !== curStep || nextMidi !== curMidi) {
        curStep = nextStep;
        curMidi = nextMidi;
        const previewDur = Math.max(1, Math.min(targetNote.duration, compiled.totalSteps - curStep));
        const liveRole = computeLiveRole(compiled, project, curStep, curMidi, previewDur);
        applyNoteGroupGeometry(noteGroup, curStep, curMidi, previewDur, liveRole);
      }
    };

    const onCancel = () => {
      cleanup();
      applyNoteGroupGeometry(
        noteGroup,
        targetNote.step,
        targetNote.midi,
        targetNote.duration,
        targetNote.role
      );
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        onCancel();
      }
    };

    const onUp = () => {
      cleanup();
      if (!hasDragged) {
        svg.focus({ preventScroll: true });
        const now = Date.now();
        if (lastClickNoteId === targetNote.id && now - lastClickAt <= 350) {
          lastClickNoteId = null;
          deletedInUpNoteId = targetNote.id;
          deleteNoteById(targetNote.id);
          return;
        }
        selectNote(targetNote.id);
        callbacks.onAuditionPitch(targetNote.midi);
        lastClickNoteId = targetNote.id;
        lastClickAt = now;
        return;
      }

      if (curStep !== targetNote.step || curMidi !== targetNote.midi) {
        const next = cloneProject(project);
        next.bakedMelody = movePianoRollNote(
          baseNotes,
          targetNote.id,
          curStep,
          curMidi,
          compiled.totalSteps,
          { minMidi: PR_MIN_MIDI, maxMidi: PR_MAX_MIDI }
        );
        next.baked = true;
        callbacks.onProjectChange(next);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown);
  });
}
