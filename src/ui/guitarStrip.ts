import type { ChordInstrument } from '../core/model';
import type { ResolvedChord } from '../core/theory';
import { getGuitarDiagram } from '../core/theory';

const PIANO_WHITE_KEYS: Array<{ pc: number; x: number }> = [
  { pc: 0, x: 0 },
  { pc: 2, x: 14 },
  { pc: 4, x: 28 },
  { pc: 5, x: 42 },
  { pc: 7, x: 56 },
  { pc: 9, x: 70 },
  { pc: 11, x: 84 },
];

const PIANO_BLACK_KEYS: Array<{ pc: number; x: number }> = [
  { pc: 1, x: 9.5 },
  { pc: 3, x: 23.5 },
  { pc: 6, x: 51.5 },
  { pc: 8, x: 65.5 },
  { pc: 10, x: 79.5 },
];

export function buildPianoChordSvg(chord: ResolvedChord): string {
  const pcs = new Set(chord.pitchClasses);
  const w = 98;
  const h = 58;

  let whiteRects = '';
  for (const k of PIANO_WHITE_KEYS) {
    const active = pcs.has(k.pc);
    const isRoot = k.pc === chord.rootPc;
    const fill = isRoot ? '#34d399' : active ? '#38bdf8' : '#dbe4f0';
    const dataAttr = active ? ` data-pc="${k.pc}"` : '';
    const dot = active
      ? `<circle cx="${k.x + 7}" cy="46" r="2.6" fill="#08111f"/>`
      : '';
    whiteRects += `<rect x="${k.x + 0.5}" y="2" width="13" height="53" rx="2" fill="${fill}" stroke="#1e293b" stroke-width="1"${dataAttr}/>${dot}`;
  }

  let blackRects = '';
  for (const k of PIANO_BLACK_KEYS) {
    const active = pcs.has(k.pc);
    const isRoot = k.pc === chord.rootPc;
    const fill = isRoot ? '#34d399' : active ? '#38bdf8' : '#162032';
    const dataAttr = active ? ` data-pc="${k.pc}"` : '';
    const dot = active
      ? `<circle cx="${k.x + 4.5}" cy="26" r="2.1" fill="#08111f"/>`
      : '';
    blackRects += `<rect x="${k.x}" y="2" width="9" height="33" rx="1.5" fill="${fill}" stroke="#0b1220" stroke-width="1"${dataAttr}/>${dot}`;
  }

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-label="${chord.symbol} 피아노 건반 코드">${whiteRects}${blackRects}</svg>`;
}

export function buildChordVisualSvg(chord: ResolvedChord, mode: ChordInstrument = 'piano'): string {
  return mode === 'guitar' ? buildChordDiagramSvg(chord) : buildPianoChordSvg(chord);
}

export function buildChordDiagramSvg(chord: ResolvedChord): string {
  const diag = getGuitarDiagram(chord);
  const w = 74;
  const h = 68;
  const xStart = 12;
  const yStart = 14;
  const stringGap = 10;
  const fretGap = 11;
  const frets = diag.frets;
  const minPos = frets.filter((f) => f > 0);
  const base = diag.baseFret > 1 ? diag.baseFret : minPos.length && Math.max(...minPos) > 4 ? Math.min(...minPos) : 1;

  let lines = '';
  for (let s = 0; s < 6; s++) {
    const x = xStart + s * stringGap;
    lines += `<line x1="${x}" y1="${yStart}" x2="${x}" y2="${yStart + fretGap * 4}" stroke="#4b5e7a" stroke-width="1"/>`;
  }
  for (let r = 0; r <= 4; r++) {
    const y = yStart + r * fretGap;
    const sw = r === 0 && base === 1 ? 2.5 : 1;
    lines += `<line x1="${xStart}" y1="${y}" x2="${xStart + stringGap * 5}" y2="${y}" stroke="#647996" stroke-width="${sw}"/>`;
  }

  let markers = '';
  for (let s = 0; s < 6; s++) {
    const f = frets[s];
    const x = xStart + s * stringGap;
    if (f < 0) {
      markers += `<text x="${x}" y="${yStart - 4}" text-anchor="middle" font-size="8" fill="#8fa1ba">x</text>`;
    } else if (f === 0) {
      markers += `<circle cx="${x}" cy="${yStart - 6}" r="2.5" fill="none" stroke="#34d399" stroke-width="1.2"/>`;
    } else {
      const rel = f - base + 1;
      if (rel >= 1 && rel <= 4) {
        const y = yStart + (rel - 0.5) * fretGap;
        markers += `<circle cx="${x}" cy="${y}" r="3.4" fill="#38bdf8"/>`;
      }
    }
  }
  const fretTag = base > 1 ? `<text x="2" y="${yStart + 9}" font-size="8" fill="#fbbf24">${base}f</text>` : '';

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-label="${chord.symbol} 기타 운지표">${fretTag}${lines}${markers}</svg>`;
}

export function renderGuitarStrip(
  container: HTMLElement,
  chords: ResolvedChord[],
  activeBar: number,
  onAuditionChord: (chord: ResolvedChord) => void,
  chordView: ChordInstrument = 'piano'
): void {
  container.innerHTML = chords
    .map((ch, idx) => {
      const activeCls = idx === activeBar ? ' active' : '';
      return `
        <button class="chord-card${activeCls}" data-bar="${idx}" type="button" title="클릭해 ${ch.symbol} 코드 소리 듣기">
          <div class="chord-meta">
            <span class="chord-bar">${idx + 1}마디</span>
            <span class="chord-symbol">${ch.symbol}</span>
            <span class="chord-degree-badge">${ch.degree}</span>
          </div>
          ${buildChordVisualSvg(ch, chordView)}
        </button>
      `;
    })
    .join('');

  container.querySelectorAll<HTMLButtonElement>('.chord-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      const bar = Number(btn.dataset.bar);
      const chord = chords[bar];
      if (chord) onAuditionChord(chord);
    });
  });
}

export function updateGuitarStripActiveBar(container: HTMLElement, activeBar: number): void {
  container.querySelectorAll<HTMLElement>('.chord-card').forEach((card) => {
    const bar = Number(card.dataset.bar);
    card.classList.toggle('active', bar === activeBar);
  });
}
