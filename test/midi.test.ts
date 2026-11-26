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
});
