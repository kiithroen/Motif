import { type CompiledSong, previewModifierDiff } from '../core/compiler';
import { PRESETS, type ModifierId, type NoteEvent, type SongProject, cloneProject } from '../core/model';
import {
  addPianoRollNote,
  computeMaxResizeDuration,
  deletePianoRollNote,
  movePianoRollNote,
  resizePianoRollNote,
} from '../core/pianoRollOps';
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
  onSelectDuration: (steps: number) => void;
  onProjectChange: (next: SongProject, options?: boolean | ProjectChangeOptions) => void;
  onAuditionPitch: (midi: number) => void;
  onPreviewModifier: (modifierId: ModifierId, after: boolean) => void;
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
  const line = container.querySelector<SVGLineElement>('.pr-playhead');
  if (!line) return;
  const visible = activeStep >= 0 && activeStep < totalSteps;
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
  onSelectDuration: (steps: number) => void;
  onProjectChange: (next: SongProject, options?: boolean | ProjectChangeOptions) => void;
  onAuditionPitch: (midi: number) => void;
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
  });
  const scrollEl = container.querySelector<HTMLElement>('.pr-grid-scroll');
  if (scrollEl && prevScrollLeft > 0) {
    scrollEl.scrollLeft = prevScrollLeft;
  }
  wireL3Events(container, project, compiled, {
    selectedDuration: options.selectedDuration,
    onSelectDuration: options.onSelectDuration,
    onProjectChange: options.onProjectChange,
    onAuditionPitch: options.onAuditionPitch,
    onPreviewModifier: () => {},
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
              ? `<button class="btn btn-primary" id="btn-bake" type="button">음표로 L3 피아노롤에 굽기 →</button>`
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
    container.innerHTML = tabsHtml + renderL2Body(project, compiled);
    wireTabs(container, project, callbacks);
    wireL2Events(container, project, callbacks);
    return;
  }

  container.innerHTML = tabsHtml + renderL3Body(project, compiled, activeStep, callbacks.selectedDuration, {
    showDurationPicker: true,
    showUnbake: false,
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
    // Main controller handles baking cleanly when missing bakedMelody
    next.baked = false;
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

function renderL2Body(project: SongProject, compiled: CompiledSong): string {
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
      const diff = previewModifierDiff(project, meta.id);
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
    <div class="l2-chords-editor">${chordSlots}</div>
    <p class="section-title">멜로디·화성 변형 체인 (켜고 끄며 차이 듣기)</p>
    <div class="modifier-list">${modCards}</div>
  `;
}

function wireL2Events(container: HTMLElement, project: SongProject, callbacks: LayerCallbacks): void {
  let workingProject = cloneProject(project);
  const modStartSnapshots = new Map<ModifierId, SongProject>();

  container.querySelectorAll<HTMLSelectElement>('.sel-degree').forEach((sel) => {
    sel.addEventListener('change', () => {
      const bar = Number(sel.dataset.bar);
      const next = cloneProject(workingProject);
      if (next.chain.chords[bar]) {
        next.chain.chords[bar].degree = sel.value as SongProject['chain']['chords'][number]['degree'];
      }
      next.baked = false;
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
  opts: { showDurationPicker: boolean; showUnbake: boolean } = { showDurationPicker: true, showUnbake: false }
): string {
  const totalPitches = PR_MAX_MIDI - PR_MIN_MIDI + 1;
  const svgW = compiled.totalSteps * STEP_W;
  const svgH = totalPitches * ROW_H;
  const scalePcs = new Set(getScalePitchClasses(project.keyRoot, project.mode));
  const barWidth = 16 * STEP_W;
  const chordToneSets = compiled.resolvedChords.map((rc) => new Set(rc.pitchClasses));

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
      return `<div class="pr-bar-cell" style="width:${barWidth}px"><span>${idx + 1}마디</span><strong>${rc.symbol} (${tones})</strong></div>`;
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

  const visiblePlayhead = activeStep >= 0 && activeStep < compiled.totalSteps;
  const playheadX = visiblePlayhead ? activeStep * STEP_W : 0;
  const playhead = `<line class="pr-playhead" x1="${playheadX}" y1="0" x2="${playheadX}" y2="${svgH}" stroke="#fbbf24" stroke-width="2" visibility="${visiblePlayhead ? 'visible' : 'hidden'}"/>`;

  return `
    <div class="pianoroll-wrap">
      <div class="pianoroll-toolbar">
        <div class="legend">
          <span class="legend-item"><span class="swatch" style="background:#34d399"></span>코드톤 (안정)</span>
          <span class="legend-item"><span class="swatch" style="background:#38bdf8"></span>음계/경과음 (자연스러움)</span>
          <span class="legend-item"><span class="swatch" style="background:#fb7185"></span>충돌음 (코치 주의)</span>
        </div>
        ${durationButtons}
        <span>빈 칸 클릭: 추가 · 음표 드래그: 이동 · 오른쪽 끝 드래그: 길이 · 클릭: 삭제 · PC 건반(A~K)</span>
      </div>
      <div class="pr-container">
        <div class="pr-keys-col">
          <div class="pr-keys-corner">음높이</div>
          <div class="pr-keys">${keysHtml}</div>
        </div>
        <div class="pr-grid-scroll">
          <div class="pr-bar-header" style="width:${svgW}px">${barHeaderCells}</div>
          <svg class="pr-svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
            ${gridRows}
            ${chordHighlights}
            ${vLines}
            ${noteRects}
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

  const svg = container.querySelector<SVGSVGElement>('.pr-svg');
  if (!svg) return;

  const DRAG_THRESHOLD_PX = 4;

  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;

    const targetEl = e.target as Element | null;
    const resizeEl = targetEl?.closest('.pr-note-resize') ?? null;
    const noteGroup = targetEl?.closest<SVGGElement>('.pr-note') ?? null;
    const baseNotes: NoteEvent[] = compiled.melody.map(({ role: _r, ...rest }) => ({ ...rest }));

    // 경우 A: 빈 칸 클릭 -> 새 음표 추가
    if (!noteGroup) {
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
        const rawEndStep = Math.round((ev.clientX - rect.left) / STEP_W);
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

    // 경우 C: 음표 본체 드래그 -> 음높이/박자 이동, 단순 클릭 -> 삭제
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

      const pointerStep = Math.floor((ev.clientX - rect.left) / STEP_W);
      const pointerRow = Math.floor((ev.clientY - rect.top) / ROW_H);
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
        const next = cloneProject(project);
        next.bakedMelody = deletePianoRollNote(baseNotes, targetNote.id);
        next.baked = true;
        callbacks.onProjectChange(next);
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
