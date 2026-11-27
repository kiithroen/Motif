import type { CoachVisualDiff } from '../core/coachPatch';
import type { CompiledSong } from '../core/compiler';
import type { NoteEvent, SongProject } from '../core/model';
import type { LoopBarRange } from '../core/playbackControl';
import type { SongVisualDiff } from '../core/songDiff';
import { NOTE_NAMES_SHARP } from '../core/theory';

export interface MiniPianoRollOptions {
  collapsed?: boolean;
  loopRange?: LoopBarRange | null;
  visualDiff?: SongVisualDiff | null;
  coachCompare?: CoachVisualDiff | null;
  coachCompareActive?: boolean;
}

export interface MiniPianoRollCallbacks {
  onToggleCollapse?: () => void;
  onClearDiff?: () => void;
  onOpenL3?: () => void;
  onSeekBar?: (bar: number) => void;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function computePitchBounds(
  compiled: CompiledSong,
  visualDiff?: SongVisualDiff | null,
  coachCompare?: CoachVisualDiff | null
): { minMidi: number; maxMidi: number } {
  const midis: number[] = [];
  for (const n of compiled.melody) midis.push(n.midi);
  for (const n of compiled.chords) midis.push(n.midi);
  for (const n of compiled.bass) midis.push(n.midi);
  if (visualDiff) {
    for (const n of visualDiff.removedMelodyNotes) midis.push(n.midi);
  }
  if (coachCompare) {
    for (const g of coachCompare.ghostNotes) midis.push(g.midi);
  }
  if (midis.length === 0) {
    return { minMidi: 48, maxMidi: 84 };
  }
  let minMidi = Math.min(...midis) - 2;
  let maxMidi = Math.max(...midis) + 2;
  if (maxMidi - minMidi < 18) {
    const pad = Math.ceil((18 - (maxMidi - minMidi)) / 2);
    minMidi -= pad;
    maxMidi += pad;
  }
  return {
    minMidi: Math.max(24, minMidi),
    maxMidi: Math.min(108, maxMidi),
  };
}

function renderMiniSvgContent(
  compiled: CompiledSong,
  activeStep: number,
  opts: MiniPianoRollOptions
): { svgHtml: string; vbW: number; vbH: number } {
  const bars = Math.max(1, compiled.resolvedChords.length);
  const stepW = bars >= 16 ? 5 : 8;
  const vbW = compiled.totalSteps * stepW;
  const headerH = 18;
  const drumStripH = 10;
  const bodyH = 224;
  const vbH = headerH + bodyH + drumStripH;
  const barW = 16 * stepW;

  const { minMidi, maxMidi } = computePitchBounds(compiled, opts.visualDiff, opts.coachCompare);
  const pitchSpan = Math.max(1, maxMidi - minMidi + 1);
  const noteH = Math.max(4, Math.min(11, bodyH / pitchSpan));
  const midiToY = (midi: number): number => {
    const ratio = (maxMidi - midi) / pitchSpan;
    return headerH + ratio * (bodyH - noteH);
  };

  const diff = opts.visualDiff ?? null;
  const coachCompare = opts.coachCompare ?? null;
  const coachChordSet = new Set((coachCompare?.changedChordBars ?? []).map((c) => c.bar));
  const activeBar =
    activeStep >= 0 && activeStep < compiled.totalSteps ? Math.floor(activeStep / 16) : -1;

  let barsBg = '';
  for (let b = 0; b < bars; b++) {
    const x = b * barW;
    const isChordChanged = diff?.changedChordBars.has(b) || coachChordSet.has(b);
    const isAccompChanged = diff?.changedAccompBars.has(b) ?? false;
    const isInLoop =
      opts.loopRange && b >= opts.loopRange.startBar && b <= opts.loopRange.endBar;
    const isActive = b === activeBar;

    let fill = b % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.12)';
    if (isChordChanged) fill = 'rgba(245, 158, 11, 0.14)';
    else if (isAccompChanged) fill = 'rgba(56, 189, 248, 0.10)';
    else if (isInLoop) fill = 'rgba(52, 211, 153, 0.07)';

    const rc = compiled.resolvedChords[b];
    const halfRc = compiled.resolvedHalfChords?.[b];
    const chordText = halfRc ? `${rc?.symbol ?? ''}·${halfRc.symbol}` : rc?.symbol ?? '';

    barsBg += `
      <rect class="mini-pr-bar-bg${isActive ? ' active-bar' : ''}" data-mini-bar="${b}" x="${x}" y="0" width="${barW}" height="${vbH}" fill="${fill}" />
      <line x1="${x}" y1="0" x2="${x}" y2="${vbH}" stroke="rgba(255,255,255,0.12)" stroke-width="1" />
      <text x="${x + 4}" y="12" font-size="9.5" font-weight="700" fill="${isChordChanged ? '#fbbf24' : '#94a3b8'}" pointer-events="none">${b + 1} ${escapeHtml(chordText)}</text>
    `;
  }

  let bassRects = '';
  for (const n of compiled.bass) {
    const x = n.step * stepW;
    const w = Math.max(2, n.duration * stepW - 0.8);
    const y = midiToY(n.midi);
    bassRects += `<rect x="${x}" y="${y}" width="${w}" height="${noteH}" rx="1.2" fill="rgba(45, 212, 191, 0.35)" pointer-events="none" />`;
  }

  let chordRects = '';
  for (const n of compiled.chords) {
    const x = n.step * stepW;
    const w = Math.max(2, n.duration * stepW - 0.8);
    const y = midiToY(n.midi);
    chordRects += `<rect x="${x}" y="${y}" width="${w}" height="${noteH}" rx="1.2" fill="rgba(129, 140, 248, 0.28)" pointer-events="none" />`;
  }

  let drumRects = '';
  const drumY = headerH + bodyH + 2;
  for (const d of compiled.drums) {
    const x = d.step * stepW;
    const color =
      d.kind === 'kick' ? 'rgba(244, 114, 182, 0.7)' : d.kind === 'snare' ? 'rgba(251, 191, 36, 0.7)' : 'rgba(148, 163, 184, 0.55)';
    drumRects += `<rect x="${x}" y="${drumY}" width="${Math.max(1.8, stepW * 0.65)}" height="5" rx="1" fill="${color}" pointer-events="none" />`;
  }

  let removedRects = '';
  if (diff) {
    for (const n of diff.removedMelodyNotes) {
      const x = n.step * stepW;
      const w = Math.max(3, n.duration * stepW - 0.8);
      const y = midiToY(n.midi);
      removedRects += `<rect class="mini-pr-note-removed" x="${x}" y="${y}" width="${w}" height="${Math.max(3.5, noteH)}" rx="1.5" pointer-events="none" />`;
    }
  }
  if (coachCompare) {
    for (const g of coachCompare.ghostNotes) {
      const x = g.step * stepW;
      const w = Math.max(3, g.duration * stepW - 0.8);
      const y = midiToY(g.midi);
      removedRects += `<rect class="mini-pr-note-ghost" x="${x}" y="${y}" width="${w}" height="${Math.max(3.5, noteH)}" rx="1.5" pointer-events="none" />`;
    }
  }

  let melodyRects = '';
  for (const n of compiled.melody) {
    const x = n.step * stepW;
    const w = Math.max(3, n.duration * stepW - 0.8);
    const y = midiToY(n.midi);
    const h = Math.max(4, noteH);
    const isAdded = diff?.addedMelodyIds.has(n.id) ?? false;
    const isChanged = diff?.changedMelodyIds.has(n.id) ?? false;
    const cls = isAdded
      ? 'mini-pr-note is-added'
      : isChanged
        ? 'mini-pr-note is-changed'
        : n.role === 'clash'
          ? 'mini-pr-note is-clash'
          : 'mini-pr-note';
    melodyRects += `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" pointer-events="none" />`;
  }

  const playX = activeStep >= 0 && activeStep < compiled.totalSteps ? activeStep * stepW : 0;
  const playVis = activeStep >= 0 && activeStep < compiled.totalSteps ? 'visible' : 'hidden';

  const svgHtml = `
    <svg class="mini-pr-svg" viewBox="0 0 ${vbW} ${vbH}" preserveAspectRatio="none" data-step-w="${stepW}">
      ${barsBg}
      <line x1="0" y1="${headerH}" x2="${vbW}" y2="${headerH}" stroke="rgba(255,255,255,0.1)" stroke-width="1" />
      <line x1="0" y1="${headerH + bodyH}" x2="${vbW}" y2="${headerH + bodyH}" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
      ${bassRects}
      ${chordRects}
      ${drumRects}
      ${removedRects}
      ${melodyRects}
      <line class="mini-pr-playhead" x1="${playX}" y1="0" x2="${playX}" y2="${vbH}" stroke="#f8fafc" stroke-width="1.6" visibility="${playVis}" pointer-events="none" />
    </svg>
  `;

  return { svgHtml, vbW, vbH };
}

export function renderMiniPianoRollHtml(
  project: SongProject,
  compiled: CompiledSong,
  activeStep: number,
  opts: MiniPianoRollOptions = {}
): string {
  const collapsed = Boolean(opts.collapsed);
  const diff = opts.visualDiff ?? null;
  const coachCompare = opts.coachCompare ?? null;
  const hasDiff = Boolean(diff?.hasAnyChange);
  const hasCoach = Boolean(
    coachCompare && (coachCompare.changedChordBars.length > 0 || coachCompare.ghostNotes.length > 0)
  );
  const keyLabel = `${NOTE_NAMES_SHARP[project.keyRoot]} ${project.mode === 'major' ? '장조' : '단조'}`;

  let diffBannerHtml = '';
  if (hasDiff && diff) {
    const prefix = diff.label ? `${escapeHtml(diff.label)}: ` : '';
    const modeClass = diff.mode === 'preview' ? ' is-preview' : ' is-applied';
    const clearLabel = diff.mode === 'preview' ? '미리보기 닫기' : '비교 지우기';
    diffBannerHtml = `
      <div class="mini-pr-diff-bar${modeClass}">
        <span class="mini-pr-diff-text">${prefix}${escapeHtml(diff.summaryText)}</span>
        <div class="mini-pr-diff-legend">
          <span class="mini-pr-leg"><i class="dot-added"></i>새/변경 음표</span>
          <span class="mini-pr-leg"><i class="dot-removed"></i>이전 위치</span>
          <button class="btn btn-chip" id="btn-mini-pr-clear-diff" type="button">${clearLabel}</button>
        </div>
      </div>
    `;
  } else if (hasCoach && coachCompare) {
    diffBannerHtml = `
      <div class="mini-pr-diff-bar is-preview">
        <span class="mini-pr-diff-text">Gemini 튜터 비교 표시 중 (코드 ${coachCompare.changedChordBars.length}마디 · 고스트 ${coachCompare.ghostNotes.length}음)</span>
        <div class="mini-pr-diff-legend">
          <span class="mini-pr-leg"><i class="dot-ghost"></i>튜터 예시</span>
        </div>
      </div>
    `;
  }

  const { svgHtml } = collapsed
    ? { svgHtml: '' }
    : renderMiniSvgContent(compiled, activeStep, opts);

  return `
    <section class="mini-pr-card${collapsed ? ' is-collapsed' : ''}" aria-label="실시간 피아노롤 미리보기">
      <div class="mini-pr-head">
        <div class="mini-pr-title-group">
          <strong class="mini-pr-title">실시간 피아노롤</strong>
          <span class="mini-pr-meta">${project.bars}마디 · ${keyLabel}</span>
        </div>
        <div class="mini-pr-actions">
          <button class="btn btn-chip" id="btn-mini-pr-open-l3" type="button">L3에서 자세히 →</button>
          <button class="btn btn-chip" id="btn-mini-pr-toggle" type="button" aria-expanded="${!collapsed}">${collapsed ? '펼치기' : '접기'}</button>
        </div>
      </div>
      ${diffBannerHtml}
      ${
        collapsed
          ? ''
          : `<div class="mini-pr-canvas-wrap" title="마디를 클릭하면 해당 마디로 이동한다">${svgHtml}</div>`
      }
    </section>
  `;
}

export function wireMiniPianoRollEvents(
  container: HTMLElement,
  callbacks: MiniPianoRollCallbacks
): void {
  container.querySelector('#btn-mini-pr-toggle')?.addEventListener('click', () => {
    callbacks.onToggleCollapse?.();
  });
  container.querySelector('#btn-mini-pr-clear-diff')?.addEventListener('click', () => {
    callbacks.onClearDiff?.();
  });
  container.querySelector('#btn-mini-pr-open-l3')?.addEventListener('click', () => {
    callbacks.onOpenL3?.();
  });
  container.querySelectorAll<SVGRectElement>('[data-mini-bar]').forEach((rect) => {
    rect.addEventListener('click', () => {
      const bar = Number(rect.dataset.miniBar);
      if (Number.isFinite(bar)) callbacks.onSeekBar?.(bar);
    });
  });
}

export function updateMiniPianoRollInPlace(
  container: HTMLElement,
  project: SongProject,
  compiled: CompiledSong,
  activeStep: number,
  opts: MiniPianoRollOptions,
  callbacks: MiniPianoRollCallbacks
): void {
  const card = container.querySelector<HTMLElement>('.mini-pr-card');
  if (!card) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = renderMiniPianoRollHtml(project, compiled, activeStep, opts);
  const nextCard = tmp.firstElementChild;
  if (!nextCard) return;
  card.replaceWith(nextCard);
  wireMiniPianoRollEvents(container, callbacks);
}

export function updateMiniPianoRollPlayhead(
  container: HTMLElement,
  activeStep: number,
  totalSteps: number
): void {
  const svg = container.querySelector<SVGSVGElement>('.mini-pr-svg');
  if (!svg) return;
  const visible = activeStep >= 0 && activeStep < totalSteps;
  const activeBar = visible ? Math.floor(activeStep / 16) : -1;
  svg.querySelectorAll<SVGRectElement>('[data-mini-bar]').forEach((rect) => {
    rect.classList.toggle('active-bar', Number(rect.dataset.miniBar) === activeBar);
  });
  const line = svg.querySelector<SVGLineElement>('.mini-pr-playhead');
  if (!line) return;
  const parsedStepW = Number(svg.dataset.stepW);
  const stepW = Number.isFinite(parsedStepW) && parsedStepW > 0 ? parsedStepW : 8;
  const x = visible ? activeStep * stepW : 0;
  line.setAttribute('x1', String(x));
  line.setAttribute('x2', String(x));
  line.setAttribute('visibility', visible ? 'visible' : 'hidden');
}

export function isSameNoteList(a: readonly NoteEvent[], b: readonly NoteEvent[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].step !== b[i].step || a[i].midi !== b[i].midi || a[i].duration !== b[i].duration) {
      return false;
    }
  }
  return true;
}
