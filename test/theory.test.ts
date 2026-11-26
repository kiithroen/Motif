import { describe, expect, it } from 'vitest';
import {
  classifyPitch,
  getGuitarDiagram,
  getScalePitchClasses,
  koreanNoteName,
  noteName,
  resolveChord,
  snapToScale,
} from '../src/core/theory';

describe('music theory helpers', () => {
  it('maps midi numbers to note names and korean solfege', () => {
    expect(noteName(60)).toBe('C4');
    expect(koreanNoteName(60, true)).toBe('도4');
    expect(koreanNoteName(64)).toBe('미');
    expect(koreanNoteName(67)).toBe('솔');
  });

  it('builds C major and A minor scales correctly', () => {
    expect(getScalePitchClasses(0, 'major')).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(getScalePitchClasses(9, 'minor')).toEqual([9, 11, 0, 2, 4, 5, 7]);
  });

  it('resolves diatonic and modal borrowed degrees plus guitar voicings', () => {
    const ivMinor = resolveChord('iv', 0, 'major');
    expect(ivMinor.symbol).toBe('Fm');
    expect(ivMinor.pitchClasses).toEqual([5, 8, 0]);

    const fiveSeven = resolveChord('V7', 0, 'major');
    expect(fiveSeven.symbol).toBe('G7');
    expect(fiveSeven.pitchClasses).toEqual([7, 11, 2, 5]);

    const diagC = getGuitarDiagram(resolveChord('I', 0, 'major'));
    expect(diagC.frets).toHaveLength(6);
    expect(diagC.frets).toEqual([-1, 3, 2, 0, 1, 0]);
  });

  it('classifies chord tones vs strong-beat semitone clashes', () => {
    const cMaj = resolveChord('I', 0, 'major'); // C E G (0,4,7)
    expect(classifyPitch(64, cMaj, 0, 'major', 0, 4)).toBe('chord_tone'); // E
    expect(classifyPitch(65, cMaj, 0, 'major', 0, 4)).toBe('clash'); // F against E on strong beat
    expect(classifyPitch(62, cMaj, 0, 'major', 2, 2)).toBe('passing'); // D weak 8th passing
    expect(snapToScale(61, 0, 'major')).toBe(60);
  });
});
