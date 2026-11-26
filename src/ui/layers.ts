import { type CompiledSong, previewModifierDiff } from '../core/compiler';
import { PRESETS, type ModifierId, type NoteEvent, type SongProject, cloneProject } from '../core/model';
import {
  getScalePitchClasses,
  isWhiteKey,
  koreanNoteName,
  noteName,
  wrapPc,
} from '../core/theory';

export interface LayerCallbacks {
  onProjectChange: (next: SongProject, recompileAudioOnly?: boolean) => void;
  onAuditionPitch: (midi: number) => void;
  onPreviewModifier: (modifierId: ModifierId, after: boolean) => void;
}

const PR_MIN_MIDI = 60; // C4
const PR_MAX_MIDI = 84; // C6
const ROW_H = 20;
const STEP_W = 20;

export function renderLayerEditor(
  container: HTMLElement,
  project: SongProject,
  compiled: CompiledSong,
  activeStep: number,
  callbacks: LayerCallbacks
): void {
  const layer = project.activeLayer;

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

  container.innerHTML = tabsHtml + renderL3Body(project, compiled, activeStep);
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
        <div class="slider-label"><span>반주 에너지</span><span>${Math.round(project.blocks.energy * 100)}%</span></div>
        <input id="sl-energy" type="range" min="0.2" max="1" step="0.05" value="${project.blocks.energy}" />
      </div>
      <div class="slider-box">
        <div class="slider-label"><span>음표 밀도 (박자 쪼개기)</span><span>${Math.round(project.blocks.density * 100)}%</span></div>
        <input id="sl-density" type="range" min="0.2" max="1" step="0.05" value="${project.blocks.density}" />
      </div>
    </div>
  `;
}

function wireL1Events(container: HTMLElement, project: SongProject, callbacks: LayerCallbacks): void {
  container.querySelectorAll<HTMLButtonElement>('[data-prog]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = cloneProject(project);
      next.blocks.progressionId = btn.dataset.prog!;
      next.baked = false;
      callbacks.onProjectChange(next);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-groove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const gId = btn.dataset.groove!;
      const preset = PRESETS.grooves.find((g) => g.id === gId);
      const next = cloneProject(project);
      next.blocks.grooveId = gId;
      if (preset) next.bpm = preset.defaultBpm;
      callbacks.onProjectChange(next);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-contour]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = cloneProject(project);
      next.blocks.contourId = btn.dataset.contour!;
      next.baked = false;
      callbacks.onProjectChange(next);
    });
  });

  container.querySelector('#sl-energy')?.addEventListener('input', (e) => {
    const next = cloneProject(project);
    next.blocks.energy = Number((e.target as HTMLInputElement).value);
    callbacks.onProjectChange(next, true);
  });

  container.querySelector('#sl-density')?.addEventListener('input', (e) => {
    const next = cloneProject(project);
    next.blocks.density = Number((e.target as HTMLInputElement).value);
    next.baked = false;
    callbacks.onProjectChange(next);
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
  container.querySelectorAll<HTMLSelectElement>('.sel-degree').forEach((sel) => {
    sel.addEventListener('change', () => {
      const bar = Number(sel.dataset.bar);
      const next = cloneProject(project);
      if (next.chain.chords[bar]) {
        next.chain.chords[bar].degree = sel.value as SongProject['chain']['chords'][number]['degree'];
      }
      next.baked = false;
      callbacks.onProjectChange(next);
    });
  });

  container.querySelectorAll<HTMLInputElement>('.chk-mod').forEach((chk) => {
    chk.addEventListener('change', () => {
      const id = chk.dataset.mod as ModifierId;
      const next = cloneProject(project);
      next.chain.modifiers = next.chain.modifiers.map((m) =>
        m.id === id ? { ...m, enabled: chk.checked } : m
      );
      next.baked = false;
      callbacks.onProjectChange(next);
    });
  });

  container.querySelectorAll<HTMLInputElement>('.sl-mod').forEach((sl) => {
    sl.addEventListener('input', () => {
      const id = sl.dataset.mod as ModifierId;
      const next = cloneProject(project);
      next.chain.modifiers = next.chain.modifiers.map((m) =>
        m.id === id ? { ...m, amount: Number(sl.value), enabled: true } : m
      );
      next.baked = false;
      callbacks.onProjectChange(next);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-prev-off]').forEach((btn) => {
    btn.addEventListener('click', () => callbacks.onPreviewModifier(btn.dataset.prevOff as ModifierId, false));
  });
  container.querySelectorAll<HTMLButtonElement>('[data-prev-on]').forEach((btn) => {
    btn.addEventListener('click', () => callbacks.onPreviewModifier(btn.dataset.prevOn as ModifierId, true));
  });
}

function renderL3Body(project: SongProject, compiled: CompiledSong, activeStep: number): string {
  const totalPitches = PR_MAX_MIDI - PR_MIN_MIDI + 1;
  const svgW = compiled.totalSteps * STEP_W;
  const svgH = totalPitches * ROW_H;
  const scalePcs = new Set(getScalePitchClasses(project.keyRoot, project.mode));

  let keysHtml = '';
  let gridRows = '';
  for (let midi = PR_MAX_MIDI; midi >= PR_MIN_MIDI; midi--) {
    const white = isWhiteKey(midi);
    const inScale = scalePcs.has(wrapPc(midi));
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

  let noteRects = '';
  for (const n of compiled.melody) {
    if (n.midi < PR_MIN_MIDI || n.midi > PR_MAX_MIDI) continue;
    const rowIdx = PR_MAX_MIDI - n.midi;
    const x = n.step * STEP_W + 1;
    const y = rowIdx * ROW_H + 2;
    const w = Math.max(STEP_W - 2, n.duration * STEP_W - 2);
    const h = ROW_H - 4;
    const fill =
      n.role === 'chord_tone'
        ? '#34d399'
        : n.role === 'clash'
          ? '#fb7185'
          : '#38bdf8';
    const label = n.duration >= 2 ? koreanNoteName(n.midi) : '';
    noteRects += `
      <g class="pr-note" data-note-id="${n.id}">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="#08111f" stroke-width="1"/>
        <text x="${x + 5}" y="${y + 12}" font-size="10" font-weight="700" fill="#06121f">${label}</text>
      </g>
    `;
  }

  const playhead =
    activeStep >= 0 && activeStep < compiled.totalSteps
      ? `<line x1="${activeStep * STEP_W}" y1="0" x2="${activeStep * STEP_W}" y2="${svgH}" stroke="#fbbf24" stroke-width="2"/>`
      : '';

  return `
    <div class="pianoroll-wrap">
      <div class="pianoroll-toolbar">
        <div class="legend">
          <span class="legend-item"><span class="swatch" style="background:#34d399"></span>코드톤 (안정)</span>
          <span class="legend-item"><span class="swatch" style="background:#38bdf8"></span>음계/경과음 (자연스러움)</span>
          <span class="legend-item"><span class="swatch" style="background:#fb7185"></span>충돌음 (코치 주의)</span>
        </div>
        <span>빈 칸 클릭: 2스텝 음 추가 · 음표 클릭: 삭제 · PC 건반(A~K): 도~높은도 연주</span>
      </div>
      <div class="pr-container">
        <div class="pr-keys">${keysHtml}</div>
        <div class="pr-grid-scroll">
          <svg class="pr-svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
            ${gridRows}
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

  container.querySelectorAll<HTMLElement>('.pr-key').forEach((el) => {
    el.addEventListener('click', () => {
      callbacks.onAuditionPitch(Number(el.dataset.midi));
    });
  });

  const svg = container.querySelector<SVGSVGElement>('.pr-svg');
  if (!svg) return;

  svg.addEventListener('click', (e) => {
    const targetEl = e.target as Element;
    const noteGroup = targetEl.closest('.pr-note');
    const next = cloneProject(project);
    const baseNotes: NoteEvent[] = next.baked
      ? next.bakedMelody
      : compiled.melody.map(({ role: _r, ...rest }) => ({ ...rest }));

    if (noteGroup) {
      const id = noteGroup.getAttribute('data-note-id');
      next.bakedMelody = baseNotes.filter((n) => n.id !== id);
      next.baked = true;
      callbacks.onProjectChange(next);
      return;
    }

    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const step = Math.max(0, Math.min(compiled.totalSteps - 1, Math.floor(x / STEP_W)));
    const row = Math.floor(y / ROW_H);
    const midi = PR_MAX_MIDI - row;
    if (midi < PR_MIN_MIDI || midi > PR_MAX_MIDI) return;

    callbacks.onAuditionPitch(midi);
    const newNote: NoteEvent = {
      id: `m_user_${Date.now()}_${step}`,
      midi,
      step,
      duration: 2,
      velocity: 0.82,
      origin: 'user',
    };
    next.bakedMelody = [...baseNotes.filter((n) => n.step !== step), newNote];
    next.baked = true;
    callbacks.onProjectChange(next);
  });
}
