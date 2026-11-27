import { describe, expect, it } from 'vitest';
import { compileSong } from '../src/core/compiler';
import { exportToMidi } from '../src/core/midi';
import { createDefaultProject } from '../src/core/model';

describe('standard MIDI exporter', () => {
  it('writes valid MThd header and 4 MTrk chunks', () => {
    const p = createDefaultProject();
    const compiled = compileSong(p);
    const bytes = exportToMidi(compiled, p);

    const ascii = (start: number, len: number) =>
      String.fromCharCode(...bytes.slice(start, start + len));

    expect(ascii(0, 4)).toBe('MThd');
    const trackCount = (bytes[10] << 8) | bytes[11];
    expect(trackCount).toBe(4);

    let offset = 14;
    let foundTracks = 0;
    while (offset < bytes.length) {
      expect(ascii(offset, 4)).toBe('MTrk');
      const chunkLen =
        (bytes[offset + 4] << 24) |
        (bytes[offset + 5] << 16) |
        (bytes[offset + 6] << 8) |
        bytes[offset + 7];
      offset += 8 + chunkLen;
      foundTracks++;
    }
    expect(foundTracks).toBe(4);
    expect(offset).toBe(bytes.length);
  });

  it('orders Note Off before Note On on same tick and reflects chord/melody instruments', () => {
    const p = createDefaultProject();
    p.melodyInstrument = 'piano';
    p.baked = true;
    p.bakedMelody = [
      { id: 'n1', midi: 60, step: 0, duration: 4, velocity: 0.8 },
      { id: 'n2', midi: 60, step: 4, duration: 4, velocity: 0.8 },
    ];
    const compiled = compileSong(p, 'piano');
    const pianoBytes = exportToMidi(compiled, p, 'piano');
    const guitarBytes = exportToMidi(compiled, p, 'guitar');

    const getTrackData = (bytes: Uint8Array, trackIndex: number): Uint8Array => {
      let off = 14;
      for (let i = 0; i < trackIndex; i++) {
        const len =
          (bytes[off + 4] << 24) |
          (bytes[off + 5] << 16) |
          (bytes[off + 6] << 8) |
          bytes[off + 7];
        off += 8 + len;
      }
      const len =
        (bytes[off + 4] << 24) |
        (bytes[off + 5] << 16) |
        (bytes[off + 6] << 8) |
        bytes[off + 7];
      return bytes.slice(off + 8, off + 8 + len);
    };

    const melodyTrack = Array.from(getTrackData(pianoBytes, 0));
    // 멜로디 피아노 Program Change (0xC0, 0x00)
    const pcIdx = melodyTrack.findIndex((b, idx) => b === 0xc0 && melodyTrack[idx + 1] === 0x00);
    expect(pcIdx).toBeGreaterThanOrEqual(0);

    // 두 번째 음(tick 480)에서는 Note Off(0x80, 60, 0)가 Note On(0x90, 60, vel)보다 먼저 와야 한다.
    const firstOn = melodyTrack.findIndex((b, idx) => b === 0x90 && melodyTrack[idx + 1] === 60);
    const firstOff = melodyTrack.findIndex(
      (b, idx) => idx > firstOn && b === 0x80 && melodyTrack[idx + 1] === 60
    );
    const secondOn = melodyTrack.findIndex(
      (b, idx) => idx > firstOn && b === 0x90 && melodyTrack[idx + 1] === 60
    );
    expect(firstOn).toBeGreaterThanOrEqual(0);
    expect(firstOff).toBeGreaterThan(firstOn);
    expect(secondOn).toBeGreaterThan(firstOff);

    // 코드 트랙 Program Change: 건반 모드=0(Grand Piano), 기타 모드=24(Nylon Guitar)
    const chordPiano = Array.from(getTrackData(pianoBytes, 1));
    const chordGuitar = Array.from(getTrackData(guitarBytes, 1));
    expect(chordPiano.slice(0, 3)).toEqual([0x00, 0xc1, 0x00]);
    expect(chordGuitar.slice(0, 3)).toEqual([0x00, 0xc1, 24]);
  });
});
