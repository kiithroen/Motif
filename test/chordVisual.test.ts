import { describe, expect, it } from 'vitest';
import { resolveChord } from '../src/core/theory';
import { buildChordVisualSvg, buildPianoChordSvg } from '../src/ui/guitarStrip';

describe('Chord visual diagrams (piano default + guitar toggle)', () => {
  it('highlights root and chord tones on 1-octave mini piano SVG', () => {
    const cMaj = resolveChord('I', 0, 'major');
    const cSvg = buildPianoChordSvg(cMaj);
    expect(cSvg).toContain('C 피아노 건반 코드');
    expect(cSvg).toContain('data-pc="0"');
    expect(cSvg).toContain('data-pc="4"');
    expect(cSvg).toContain('data-pc="7"');
    expect(cSvg).not.toContain('data-pc="5"');

    const fm = resolveChord('iv', 0, 'major'); // F(5), Ab(8), C(0)
    const fmSvg = buildPianoChordSvg(fm);
    expect(fmSvg).toContain('data-pc="5"');
    expect(fmSvg).toContain('data-pc="8"'); // 검은건반 라♭/솔#
    expect(fmSvg).toContain('data-pc="0"');

    const g7 = resolveChord('V7', 0, 'major'); // G(7), B(11), D(2), F(5)
    const g7Svg = buildPianoChordSvg(g7);
    expect(g7Svg).toContain('data-pc="7"');
    expect(g7Svg).toContain('data-pc="11"');
    expect(g7Svg).toContain('data-pc="2"');
    expect(g7Svg).toContain('data-pc="5"');
  });

  it('switches between piano keyboard and guitar diagram via buildChordVisualSvg', () => {
    const cMaj = resolveChord('I', 0, 'major');
    expect(buildChordVisualSvg(cMaj, 'piano')).toContain('피아노 건반 코드');
    expect(buildChordVisualSvg(cMaj, 'guitar')).toContain('기타 운지표');
  });
});
