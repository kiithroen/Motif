import {
  PRESETS,
  type ChordInstrument,
  type ChordSlot,
  type DrumEvent,
  type L1Blocks,
  type L2Chain,
  type ModifierId,
  type NoteEvent,
  type SongProject,
  buildChordsFromProgression,
  buildDefaultModifiers,
  cloneProject,
} from './model';
import {
  classifyPitch,
  getScaleMidiNotes,
  nearestChordTone,
  resolveChord,
  snapToScale,
  type HarmonicRole,
  type ResolvedChord,
} from './theory';

export interface AnnotatedMelodyNote extends NoteEvent {
  role: HarmonicRole;
}

export interface CompiledSong {
  bars: number;
  totalSteps: number;
  resolvedChords: ResolvedChord[];
  chords: NoteEvent[];
  bass: NoteEvent[];
  drums: DrumEvent[];
  melody: AnnotatedMelodyNote[];
}

export interface ModifierDiff {
  modifierId: ModifierId;
  changedCount: number;
  addedCount: number;
  removedCount: number;
  before: CompiledSong;
  after: CompiledSong;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function unpackBlocksToChain(blocks: L1Blocks, bars: 4 | 8, existingModifiers?: L2Chain['modifiers']): L2Chain {
  return {
    chords: buildChordsFromProgression(blocks.progressionId, bars),
    modifiers: existingModifiers ? existingModifiers.map((m) => ({ ...m })) : buildDefaultModifiers(),
  };
}

function effectiveChordSlots(project: SongProject): ChordSlot[] {
  const slots = project.chain.chords.slice(0, project.bars).map((c) => ({ ...c }));
  while (slots.length < project.bars) {
    slots.push({ bar: slots.length, degree: 'I' });
  }

  const borrowMod = project.chain.modifiers.find((m) => m.id === 'modal_borrow');
  if (borrowMod?.enabled && borrowMod.amount >= 0.25) {
    // IV 슬롯이 있으면 마지막 IV 를 iv 로, 없으면 4번째(인덱스 3) 마디를 iv 로 바꾼다.
    let targetIdx = -1;
    for (let i = slots.length - 1; i >= 0; i--) {
      if (slots[i].degree === 'IV') {
        targetIdx = i;
        break;
      }
    }
    if (targetIdx < 0 && slots.length >= 4) targetIdx = 3;
    if (targetIdx >= 0) {
      slots[targetIdx].degree = 'iv';
    }
  }
  return slots;
}

function sampleContour(points: number[], tNorm: number): number {
  if (points.length === 0) return 0.5;
  const clamped = Math.max(0, Math.min(1, tNorm));
  const scaled = clamped * (points.length - 1);
  const lo = Math.floor(scaled);
  const hi = Math.min(points.length - 1, lo + 1);
  const frac = scaled - lo;
  return points[lo] * (1 - frac) + points[hi] * frac;
}

function generateBaseMelody(project: SongProject, resolvedChords: ResolvedChord[]): NoteEvent[] {
  const rng = mulberry32(project.seed * 997 + project.keyRoot * 31 + (project.mode === 'minor' ? 7 : 3));
  const contour = PRESETS.contours.find((c) => c.id === project.blocks.contourId) ?? PRESETS.contours[0];
  const scaleNotes = getScaleMidiNotes(project.keyRoot, project.mode, 60, 81);
  const totalSteps = project.bars * 16;

  // density 에 따라 기본 리듬 패턴(8분/점8분/4분)을 조합한다.
  const density = Math.max(0.1, Math.min(1, project.blocks.density));
  const energy = Math.max(0.1, Math.min(1, project.blocks.energy));
  const notes: NoteEvent[] = [];
  let seq = 0;

  for (let bar = 0; bar < project.bars; bar++) {
    const chord = resolvedChords[bar];
    const barOffset = bar * 16;
    const candidateSteps =
      density >= 0.72
        ? [0, 2, 4, 6, 8, 10, 12, 14]
        : density >= 0.42
          ? [0, 4, 6, 8, 12, 14]
          : [0, 4, 8, 12];

    const activeSteps: number[] = [];
    for (const s of candidateSteps) {
      const keepProb = s === 0 || s === 8 ? 0.94 : 0.48 + density * 0.42;
      if (rng() <= keepProb) {
        activeSteps.push(s);
      }
    }
    if (activeSteps.length === 0) activeSteps.push(0, 8);

    for (let i = 0; i < activeSteps.length; i++) {
      const localStep = activeSteps[i];
      const nextStep = i + 1 < activeSteps.length ? activeSteps[i + 1] : 16;
      const maxDur = Math.max(2, nextStep - localStep);
      const rawDur = maxDur >= 4 && rng() < 0.35 ? 4 : Math.min(maxDur, 2);
      const globalStep = barOffset + localStep;
      const norm = globalStep / Math.max(1, totalSteps - 1);
      const targetHeight = sampleContour(contour.points, norm);

      // scaleNotes 중에서 targetHeight 에 맞는 중심 음고를 고르고 강박은 코드톤으로 맞춘다.
      const idx = Math.min(scaleNotes.length - 1, Math.max(0, Math.round(targetHeight * (scaleNotes.length - 1))));
      let pitch = scaleNotes[idx] ?? 64;
      const jitter = Math.round((rng() - 0.5) * 3);
      pitch = scaleNotes[Math.min(scaleNotes.length - 1, Math.max(0, idx + jitter))] ?? pitch;

      if (localStep === 0 || localStep === 8 || rng() < 0.55) {
        pitch = nearestChordTone(pitch, chord, 60, 81);
      }

      notes.push({
        id: `m_base_${seq++}`,
        midi: pitch,
        step: globalStep,
        duration: rawDur,
        velocity: Math.min(0.95, 0.62 + energy * 0.25 + (localStep % 8 === 0 ? 0.08 : 0)),
        origin: 'base',
      });
    }
  }
  return notes;
}

function sortAndTrimOverlaps(notes: NoteEvent[], totalSteps: number): NoteEvent[] {
  const sorted = [...notes]
    .filter((n) => n.step >= 0 && n.step < totalSteps)
    .sort((a, b) => a.step - b.step || a.midi - b.midi);

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    const limit = next && next.step > cur.step ? next.step : totalSteps;
    cur.duration = Math.max(1, Math.min(cur.duration, limit - cur.step));
  }
  return sorted;
}

function applyModifierPipeline(
  baseNotes: NoteEvent[],
  project: SongProject,
  resolvedChords: ResolvedChord[]
): NoteEvent[] {
  const totalSteps = project.bars * 16;
  let notes = baseNotes.map((n) => ({ ...n }));
  const modMap = new Map(project.chain.modifiers.map((m) => [m.id, m]));

  // 1. motif_repeat: 1마디 리듬/음정 윤곽을 2~3마디(및 5~7마디)로 동기 반복 변주한다.
  const motif = modMap.get('motif_repeat');
  if (motif?.enabled && motif.amount > 0.1 && project.bars >= 2) {
    const bar0 = notes.filter((n) => n.step < 16);
    if (bar0.length >= 2) {
      const targetBars = project.bars === 8 ? [1, 2, 4, 5, 6] : [1, 2];
      const thresholdBars = Math.max(1, Math.round(targetBars.length * motif.amount));
      const applyTo = new Set(targetBars.slice(0, thresholdBars));
      const kept = notes.filter((n) => !applyTo.has(Math.floor(n.step / 16)));
      const anchor = bar0[0].midi;
      let mSeq = 0;

      for (const b of applyTo) {
        const chord = resolvedChords[b];
        const barBaseStep = b * 16;
        const barRootTarget = nearestChordTone(anchor + (b % 2 === 1 ? 2 : -1), chord, 60, 81);
        for (const src of bar0) {
          const offsetFromAnchor = src.midi - anchor;
          const desired = snapToScale(barRootTarget + offsetFromAnchor, project.keyRoot, project.mode, 60, 83);
          const localStep = src.step;
          const midi = localStep % 8 === 0 ? nearestChordTone(desired, chord, 60, 83) : desired;
          kept.push({
            id: `m_motif_${b}_${mSeq++}`,
            midi,
            step: barBaseStep + localStep,
            duration: src.duration,
            velocity: src.velocity,
            origin: 'modifier',
          });
        }
      }
      notes = sortAndTrimOverlaps(kept, totalSteps);
    }
  }

  // 2. syncopation: 강도 비율에 맞춰 일부 8분 정박(step%8===4)을 반 박자(-2스텝) 앞으로 당긴다.
  const sync = modMap.get('syncopation');
  if (sync?.enabled && sync.amount > 0.1) {
    const occupied = new Set(notes.map((n) => n.step));
    const stride = sync.amount >= 0.7 ? 1 : 2;
    let count = 0;
    notes = notes.map((n) => {
      const local = n.step % 16;
      if ((local === 4 || local === 12) && n.step >= 2 && !occupied.has(n.step - 2)) {
        if (count++ % stride === 0) {
          occupied.delete(n.step);
          occupied.add(n.step - 2);
          return { ...n, step: n.step - 2, origin: 'modifier' };
        }
      }
      return n;
    });
    notes = sortAndTrimOverlaps(notes, totalSteps);
  }

  // 3. passing_tones: 4반음 이상 도약 구간에 2스텝 이상 빈자리가 있으면 중간 경과음을 넣는다.
  const passing = modMap.get('passing_tones');
  if (passing?.enabled && passing.amount > 0.15) {
    const additions: NoteEvent[] = [];
    const maxInsert = Math.max(1, Math.round(project.bars * 2 * passing.amount));
    let inserted = 0;
    for (let i = 0; i < notes.length - 1 && inserted < maxInsert; i++) {
      const a = notes[i];
      const b = notes[i + 1];
      const gap = b.step - a.step;
      const pitchDiff = Math.abs(b.midi - a.midi);
      if (gap >= 4 && pitchDiff >= 4 && pitchDiff <= 9) {
        const midPitch = snapToScale(Math.round((a.midi + b.midi) / 2), project.keyRoot, project.mode, 60, 84);
        if (midPitch !== a.midi && midPitch !== b.midi) {
          const insertStep = b.step - 2;
          if (insertStep > a.step) {
            a.duration = Math.min(a.duration, insertStep - a.step);
            additions.push({
              id: `m_pass_${inserted++}`,
              midi: midPitch,
              step: insertStep,
              duration: 2,
              velocity: Math.max(0.45, a.velocity - 0.12),
              origin: 'modifier',
            });
          }
        }
      }
    }
    if (additions.length > 0) {
      notes = sortAndTrimOverlaps([...notes, ...additions], totalSteps);
    }
  }

  // 4. octave_lift: 후반 절반 마디 멜로디를 한 옥타브(강도 낮으면 5도) 올려 클라이맥스를 만든다.
  const lift = modMap.get('octave_lift');
  if (lift?.enabled && lift.amount > 0.1) {
    const halfStep = Math.floor(project.bars / 2) * 16;
    const semitones = lift.amount >= 0.5 ? 12 : 7;
    notes = notes.map((n) => {
      if (n.step >= halfStep) {
        const shifted = n.midi + semitones <= 84 ? n.midi + semitones : n.midi;
        return { ...n, midi: shifted, origin: shifted !== n.midi ? 'modifier' : n.origin };
      }
      return n;
    });
  }

  // 5. cadence_resolve: 마지막 음을 곡의 으뜸음(도) 또는 3음(미)으로 안정 착지시킨다.
  const cad = modMap.get('cadence_resolve');
  if (cad?.enabled && cad.amount > 0.1 && notes.length > 0) {
    const last = notes[notes.length - 1];
    const tonic = resolveChord('I', project.keyRoot, project.mode);
    const targetPc = cad.amount >= 0.5 ? tonic.rootPc : tonic.pitchClasses[1];
    let best = last.midi;
    let bestDist = Infinity;
    for (let m = 60; m <= 84; m++) {
      if (((m % 12) + 12) % 12 === targetPc) {
        const d = Math.abs(m - last.midi);
        if (d < bestDist) {
          best = m;
          bestDist = d;
        }
      }
    }
    notes[notes.length - 1] = {
      ...last,
      midi: best,
      duration: Math.min(totalSteps - last.step, Math.max(4, last.duration)),
      origin: 'modifier',
    };
  }

  return sortAndTrimOverlaps(notes, totalSteps);
}

function compileAccompaniment(
  project: SongProject,
  resolvedChords: ResolvedChord[],
  chordInstrument: ChordInstrument = 'piano'
): {
  chords: NoteEvent[];
  bass: NoteEvent[];
  drums: DrumEvent[];
} {
  const groove = PRESETS.grooves.find((g) => g.id === project.blocks.grooveId) ?? PRESETS.grooves[0];
  const pattern =
    chordInstrument === 'piano' && groove.pianoPattern ? groove.pianoPattern : groove.chordStrums;
  const chords: NoteEvent[] = [];
  const bass: NoteEvent[] = [];
  const drums: DrumEvent[] = [];

  for (let bar = 0; bar < project.bars; bar++) {
    const rc = resolvedChords[bar];
    const barStep = bar * 16;

    for (const st of pattern) {
      if (st.direction === 'arp0' || st.direction === 'arp1' || st.direction === 'arp2') {
        const idx = st.direction === 'arp0' ? 0 : st.direction === 'arp1' ? 1 : 2;
        const pitch = rc.voicingMidi[idx % rc.voicingMidi.length];
        chords.push({
          id: `c_${bar}_${st.step}_${idx}`,
          midi: pitch,
          step: barStep + st.step,
          duration: st.duration,
          velocity: st.velocity * (0.8 + project.blocks.energy * 0.25),
        });
      } else {
        const order = st.direction === 'up' ? [...rc.voicingMidi].reverse() : rc.voicingMidi;
        for (let i = 0; i < order.length; i++) {
          chords.push({
            id: `c_${bar}_${st.step}_${i}`,
            midi: order[i],
            step: barStep + st.step,
            duration: st.duration,
            velocity: Math.min(0.95, st.velocity * (0.75 + project.blocks.energy * 0.3)),
          });
        }
      }
    }

    for (const bStep of groove.bassSteps) {
      bass.push({
        id: `b_${bar}_${bStep}`,
        midi: rc.bassMidi,
        step: barStep + bStep,
        duration: 2,
        velocity: Math.min(0.95, 0.72 + project.blocks.energy * 0.2),
      });
    }

    for (const k of groove.kicks) {
      drums.push({ kind: 'kick', step: barStep + k, velocity: 0.85 });
    }
    for (const s of groove.snares) {
      drums.push({ kind: 'snare', step: barStep + s, velocity: 0.78 });
    }
    for (const h of groove.hats) {
      drums.push({ kind: 'hat', step: barStep + h, velocity: h % 4 === 0 ? 0.55 : 0.38 });
    }
  }

  return { chords, bass, drums };
}

export function compileSong(
  project: SongProject,
  chordInstrument: ChordInstrument = 'piano'
): CompiledSong {
  const totalSteps = project.bars * 16;
  const slots = effectiveChordSlots(project);
  const resolvedChords = slots.map((s) => resolveChord(s.degree, project.keyRoot, project.mode));
  const { chords, bass, drums } = compileAccompaniment(project, resolvedChords, chordInstrument);

  const rawMelody = project.baked
    ? sortAndTrimOverlaps(
        project.bakedMelody.map((n) => ({ ...n })),
        totalSteps
      )
    : applyModifierPipeline(generateBaseMelody(project, resolvedChords), project, resolvedChords);

  const melody: AnnotatedMelodyNote[] = rawMelody.map((n) => {
    const bar = Math.min(resolvedChords.length - 1, Math.floor(n.step / 16));
    const rc = resolvedChords[bar];
    return {
      ...n,
      role: classifyPitch(n.midi, rc, project.keyRoot, project.mode, n.step % 16, n.duration),
    };
  });

  return {
    bars: project.bars,
    totalSteps,
    resolvedChords,
    chords,
    bass,
    drums,
    melody,
  };
}

export function bakeProjectMelody(project: SongProject): SongProject {
  const next = cloneProject(project);
  const compiled = compileSong({ ...next, baked: false });
  next.bakedMelody = compiled.melody.map(({ role: _role, ...note }) => ({ ...note }));
  next.baked = true;
  next.activeLayer = 'L3';
  return next;
}

export function previewModifierDiff(
  project: SongProject,
  modifierId: ModifierId,
  chordInstrument: ChordInstrument = 'piano'
): ModifierDiff {
  const offProj = cloneProject(project);
  offProj.baked = false;
  offProj.chain.modifiers = offProj.chain.modifiers.map((m) =>
    m.id === modifierId ? { ...m, enabled: false } : m
  );

  const onProj = cloneProject(project);
  onProj.baked = false;
  onProj.chain.modifiers = onProj.chain.modifiers.map((m) =>
    m.id === modifierId ? { ...m, enabled: true } : m
  );

  const before = compileSong(offProj, chordInstrument);
  const after = compileSong(onProj, chordInstrument);

  const beforeMap = new Map(before.melody.map((n) => [n.step, `${n.midi}:${n.duration}`]));
  const afterMap = new Map(after.melody.map((n) => [n.step, `${n.midi}:${n.duration}`]));

  let changedCount = 0;
  let addedCount = 0;
  let removedCount = 0;

  for (const [step, sig] of afterMap) {
    const prev = beforeMap.get(step);
    if (!prev) addedCount++;
    else if (prev !== sig) changedCount++;
  }
  for (const step of beforeMap.keys()) {
    if (!afterMap.has(step)) removedCount++;
  }

  return { modifierId, changedCount, addedCount, removedCount, before, after };
}
