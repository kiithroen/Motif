import type { CompiledSong } from './compiler';
import type { ChordInstrument, DrumKind, SongProject } from './model';

const PPQ = 480;
const TICKS_PER_STEP = PPQ / 4; // 16분음표 1스텝 = 120틱

const DRUM_NOTE: Record<DrumKind, number> = {
  kick: 36,
  snare: 38,
  hat: 42,
  clap: 39,
};

function writeVarLen(value: number): number[] {
  let v = value >>> 0;
  const bytes = [v & 0x7f];
  while ((v >>= 7) > 0) {
    bytes.push((v & 0x7f) | 0x80);
  }
  return bytes.reverse();
}

function uint32BE(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function uint16BE(n: number): number[] {
  return [(n >>> 8) & 0xff, n & 0xff];
}

interface RawMidiEvent {
  tick: number;
  bytes: number[];
}

function eventOrder(bytes: number[]): number {
  const status = bytes[0] ?? 0;
  if (status === 0xff) return 0; // Meta event (e.g. tempo)
  const hi = status & 0xf0;
  if (hi === 0xc0) return 1; // Program Change
  if (hi === 0x80 || (hi === 0x90 && (bytes[2] ?? 0) === 0)) return 2; // Note Off
  if (hi === 0x90) return 3; // Note On
  return 4;
}

function encodeTrack(events: RawMidiEvent[]): number[] {
  const sorted = [...events].sort((a, b) =>
    a.tick !== b.tick ? a.tick - b.tick : eventOrder(a.bytes) - eventOrder(b.bytes)
  );
  const data: number[] = [];
  let prevTick = 0;
  for (const ev of sorted) {
    const delta = Math.max(0, ev.tick - prevTick);
    data.push(...writeVarLen(delta), ...ev.bytes);
    prevTick = ev.tick;
  }
  // End of Track
  data.push(0x00, 0xff, 0x2f, 0x00);
  return [0x4d, 0x54, 0x72, 0x6b, ...uint32BE(data.length), ...data];
}

function buildNoteTrack(
  notes: Array<{ midi: number; step: number; duration: number; velocity: number }>,
  channel: number,
  extraEvents: RawMidiEvent[] = []
): number[] {
  const events: RawMidiEvent[] = [...extraEvents];
  for (const n of notes) {
    const start = Math.round(n.step * TICKS_PER_STEP);
    const end = Math.max(start + 20, Math.round((n.step + n.duration) * TICKS_PER_STEP));
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity * 127)));
    const pitch = Math.max(0, Math.min(127, Math.round(n.midi)));
    events.push({ tick: start, bytes: [0x90 | channel, pitch, vel] });
    events.push({ tick: end, bytes: [0x80 | channel, pitch, 0] });
  }
  return encodeTrack(events);
}

export function exportToMidi(
  compiled: CompiledSong,
  project: SongProject,
  chordInstrument: ChordInstrument = 'piano'
): Uint8Array {
  const usPerBeat = Math.round(60_000_000 / Math.max(40, Math.min(240, project.bpm)));
  const tempoBytes = [(usPerBeat >>> 16) & 0xff, (usPerBeat >>> 8) & 0xff, usPerBeat & 0xff];

  const melodyProgram = project.melodyInstrument === 'guitar' ? 24 : 0; // 24 Nylon Guitar / 0 Acoustic Grand Piano
  const melodyTrack = buildNoteTrack(compiled.melody, 0, [
    { tick: 0, bytes: [0xff, 0x51, 0x03, ...tempoBytes] },
    { tick: 0, bytes: [0xc0, melodyProgram] },
  ]);

  const chordProgram = chordInstrument === 'guitar' ? 24 : 0; // 24 Nylon Guitar / 0 Acoustic Grand Piano
  const chordTrack = buildNoteTrack(compiled.chords, 1, [
    { tick: 0, bytes: [0xc1, chordProgram] },
  ]);

  const bassTrack = buildNoteTrack(compiled.bass, 2, [
    { tick: 0, bytes: [0xc2, 33] }, // Finger Bass
  ]);

  const drumTrack = buildNoteTrack(
    compiled.drums.map((d) => ({
      midi: DRUM_NOTE[d.kind],
      step: d.step,
      duration: 1,
      velocity: d.velocity,
    })),
    9
  );

  const header = [
    0x4d, 0x54, 0x68, 0x64, // MThd
    0x00, 0x00, 0x00, 0x06,
    ...uint16BE(1), // Format 1
    ...uint16BE(4), // 4 tracks
    ...uint16BE(PPQ),
  ];

  return new Uint8Array([...header, ...melodyTrack, ...chordTrack, ...bassTrack, ...drumTrack]);
}
