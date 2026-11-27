import guitarChordsRaw from '../data/guitarChords.json';

export type ScaleMode = 'major' | 'minor';

export type DegreeSymbol = 'I' | 'ii' | 'iii' | 'IV' | 'iv' | 'V' | 'V7' | 'vi' | 'vii°';

export type ChordQuality = 'major' | 'minor' | 'dom7' | 'dim';

export type HarmonicRole = 'chord_tone' | 'scale_tension' | 'passing' | 'clash';

export interface ResolvedChord {
  degree: DegreeSymbol;
  rootPc: number;
  quality: ChordQuality;
  symbol: string;
  koreanRoot: string;
  pitchClasses: number[];
  voicingMidi: number[];
  bassMidi: number;
}

export interface GuitarChordDiagram {
  symbol: string;
  frets: number[];
  baseFret: number;
}

const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const KOREAN_SOLFEGE = ['도', '도#', '레', '레#', '미', '파', '파#', '솔', '솔#', '라', '라#', '시'] as const;

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const;
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10] as const;

interface DegreeSpec {
  offsetMajor: number;
  offsetMinor: number;
  qualityMajor: ChordQuality;
  qualityMinor: ChordQuality;
}

const DEGREE_SPECS: Record<DegreeSymbol, DegreeSpec> = {
  I: { offsetMajor: 0, offsetMinor: 0, qualityMajor: 'major', qualityMinor: 'minor' },
  ii: { offsetMajor: 2, offsetMinor: 2, qualityMajor: 'minor', qualityMinor: 'dim' },
  iii: { offsetMajor: 4, offsetMinor: 3, qualityMajor: 'minor', qualityMinor: 'major' },
  IV: { offsetMajor: 5, offsetMinor: 5, qualityMajor: 'major', qualityMinor: 'minor' },
  iv: { offsetMajor: 5, offsetMinor: 5, qualityMajor: 'minor', qualityMinor: 'minor' },
  V: { offsetMajor: 7, offsetMinor: 7, qualityMajor: 'major', qualityMinor: 'major' },
  V7: { offsetMajor: 7, offsetMinor: 7, qualityMajor: 'dom7', qualityMinor: 'dom7' },
  vi: { offsetMajor: 9, offsetMinor: 8, qualityMajor: 'minor', qualityMinor: 'major' },
  'vii°': { offsetMajor: 11, offsetMinor: 10, qualityMajor: 'dim', qualityMinor: 'major' },
};

const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dom7: [0, 4, 7, 10],
  dim: [0, 3, 6],
};

const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  major: '',
  minor: 'm',
  dom7: '7',
  dim: 'dim',
};

const GUITAR_CHORDS = guitarChordsRaw as Record<string, { frets: number[]; baseFret: number }>;

export function wrapPc(midiOrPc: number): number {
  return ((midiOrPc % 12) + 12) % 12;
}

export function noteName(midi: number, withOctave = true): string {
  const pc = wrapPc(midi);
  const name = NOTE_NAMES_SHARP[pc];
  if (!withOctave) return name;
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

export function koreanNoteName(midi: number, withOctave = false): string {
  const pc = wrapPc(midi);
  const solfege = KOREAN_SOLFEGE[pc];
  if (!withOctave) return solfege;
  const octave = Math.floor(midi / 12) - 1;
  return `${solfege}${octave}`;
}

export function isWhiteKey(midi: number): boolean {
  const pc = wrapPc(midi);
  return pc === 0 || pc === 2 || pc === 4 || pc === 5 || pc === 7 || pc === 9 || pc === 11;
}

export function getScalePitchClasses(keyRoot: number, mode: ScaleMode): number[] {
  const intervals = mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  return intervals.map((step) => wrapPc(keyRoot + step));
}

export function getScaleMidiNotes(keyRoot: number, mode: ScaleMode, minMidi: number, maxMidi: number): number[] {
  const pcs = new Set(getScalePitchClasses(keyRoot, mode));
  const out: number[] = [];
  for (let m = minMidi; m <= maxMidi; m++) {
    if (pcs.has(wrapPc(m))) out.push(m);
  }
  return out;
}

export function snapToScale(midi: number, keyRoot: number, mode: ScaleMode, minMidi = 48, maxMidi = 88): number {
  const candidates = getScaleMidiNotes(keyRoot, mode, minMidi, maxMidi);
  let best = candidates[0] ?? midi;
  let bestDist = Math.abs(best - midi);
  for (const c of candidates) {
    const d = Math.abs(c - midi);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

export function resolveChord(degree: DegreeSymbol, keyRoot: number, mode: ScaleMode): ResolvedChord {
  const spec = DEGREE_SPECS[degree];
  const offset = mode === 'major' ? spec.offsetMajor : spec.offsetMinor;
  const quality = mode === 'major' ? spec.qualityMajor : spec.qualityMinor;
  const rootPc = wrapPc(keyRoot + offset);
  const symbol = `${NOTE_NAMES_SHARP[rootPc]}${QUALITY_SUFFIX[quality]}`;
  const koreanRoot = KOREAN_SOLFEGE[rootPc];
  const intervals = QUALITY_INTERVALS[quality];
  const pitchClasses = intervals.map((iv) => wrapPc(rootPc + iv));

  // 화음이 C3~G4 부근에 겹쳐 깔끔히 울리도록 클로즈드 보이싱을 구성한다.
  const baseRoot = 48 + rootPc;
  const voicingBase = baseRoot > 57 ? baseRoot - 12 : baseRoot;
  const voicingMidi = intervals.map((iv) => voicingBase + iv);
  const bassMidi = 36 + rootPc > 46 ? 24 + rootPc : 36 + rootPc;

  return {
    degree,
    rootPc,
    quality,
    symbol,
    koreanRoot,
    pitchClasses,
    voicingMidi,
    bassMidi,
  };
}

const SHARP_TO_FLAT_ROOT: Record<string, string> = {
  'C#': 'Db',
  'D#': 'Eb',
  'F#': 'Gb',
  'G#': 'Ab',
  'A#': 'Bb',
};

export function getGuitarDiagram(chord: ResolvedChord): GuitarChordDiagram {
  const exact = GUITAR_CHORDS[chord.symbol];
  if (exact) {
    return { symbol: chord.symbol, frets: [...exact.frets], baseFret: exact.baseFret };
  }

  const sharpRoot = NOTE_NAMES_SHARP[chord.rootPc];
  const flatRoot = SHARP_TO_FLAT_ROOT[sharpRoot];
  if (flatRoot) {
    const flatSymbol = `${flatRoot}${QUALITY_SUFFIX[chord.quality]}`;
    const flatMatch = GUITAR_CHORDS[flatSymbol];
    if (flatMatch) {
      return { symbol: chord.symbol, frets: [...flatMatch.frets], baseFret: flatMatch.baseFret };
    }
  }

  if (chord.quality !== 'dim') {
    const baseSymbol = `${sharpRoot}${chord.quality === 'minor' ? 'm' : ''}`;
    const fallback = GUITAR_CHORDS[baseSymbol];
    if (fallback) {
      return { symbol: chord.symbol, frets: [...fallback.frets], baseFret: fallback.baseFret };
    }
    if (flatRoot) {
      const flatBaseSymbol = `${flatRoot}${chord.quality === 'minor' ? 'm' : ''}`;
      const flatFallback = GUITAR_CHORDS[flatBaseSymbol];
      if (flatFallback) {
        return { symbol: chord.symbol, frets: [...flatFallback.frets], baseFret: flatFallback.baseFret };
      }
    }
  }

  if (chord.quality === 'dim') {
    // 5번줄(A2, pc=9) 기준 무버블 감3화음 폼(R-b5-R-b3)을 계산한다.
    const shift = wrapPc(chord.rootPc - 9);
    const frets = [-1, shift, shift + 1, shift + 2, shift + 1, -1];
    return {
      symbol: chord.symbol,
      frets,
      baseFret: shift <= 2 ? 1 : shift,
    };
  }

  // 6번줄(E2, pc=4) 바레 코드 형태로 자동 계산한다.
  const shift = wrapPc(chord.rootPc - 4) || 12;
  const shape =
    chord.quality === 'minor'
      ? [0, 2, 2, 0, 0, 0]
      : chord.quality === 'dom7'
        ? [0, 2, 0, 1, 0, 0]
        : [0, 2, 2, 1, 0, 0];
  return {
    symbol: chord.symbol,
    frets: shape.map((f) => f + shift),
    baseFret: Math.max(1, shift),
  };
}

export function classifyPitch(
  midi: number,
  chord: ResolvedChord,
  _keyRoot: number,
  _mode: ScaleMode,
  stepInBar: number,
  duration: number
): HarmonicRole {
  const pc = wrapPc(midi);
  if (chord.pitchClasses.includes(pc)) return 'chord_tone';

  // 코드 구성음과 반음(1 또는 11)으로 부딪히는 음은 강박·긴 음가에서 불협화음(clash)으로 본다.
  const clashesChord = chord.pitchClasses.some((cp) => {
    const diff = Math.abs(cp - pc);
    return diff === 1 || diff === 11;
  });
  const isStrongBeat = stepInBar % 4 === 0;
  if (clashesChord && (isStrongBeat || duration >= 3)) {
    return 'clash';
  }

  return duration <= 2 && !isStrongBeat ? 'passing' : 'scale_tension';
}

export function nearestChordTone(midi: number, chord: ResolvedChord, minMidi = 55, maxMidi = 84): number {
  const pcs = new Set(chord.pitchClasses);
  let best = midi;
  let bestDist = Infinity;
  for (let m = minMidi; m <= maxMidi; m++) {
    if (!pcs.has(wrapPc(m))) continue;
    const d = Math.abs(m - midi);
    if (d < bestDist) {
      best = m;
      bestDist = d;
    }
  }
  return best;
}

export { NOTE_NAMES_SHARP, KOREAN_SOLFEGE };
