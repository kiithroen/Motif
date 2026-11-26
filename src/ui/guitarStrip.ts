import type { ResolvedChord } from '../core/theory';
import { getGuitarDiagram } from '../core/theory';

function buildChordDiagramSvg(chord: ResolvedChord): string {
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
  onAuditionChord: (chord: ResolvedChord) => void
): void {
  container.innerHTML = chords
    .map((ch, idx) => {
      const activeCls = idx === activeBar ? ' active' : '';
      return `
        <button class="chord-card${activeCls}" data-bar="${idx}" type="button" title="클릭해 ${ch.symbol} 코드 소리 듣기">
          <div class="chord-meta">
            <span class="chord-bar">${idx + 1}마디</span>
            <span class="chord-symbol">${ch.symbol}</span>
            <span class="chord-solfege">음: ${ch.koreanRoot}</span>
            <span class="chord-degree-badge">${ch.degree}</span>
          </div>
          ${buildChordDiagramSvg(ch)}
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
