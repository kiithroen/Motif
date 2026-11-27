import { type CompiledSong } from './compiler';
import { PRESETS, type SongProject, cloneProject } from './model';
import {
  getScalePitchClasses,
  koreanNoteName,
  nearestChordTone,
  noteName,
  resolveChord,
  snapToScale,
  wrapPc,
} from './theory';

export type IssueKind =
  | 'clash'
  | 'out_of_scale'
  | 'narrow_range'
  | 'excessive_leaps'
  | 'monotone_rhythm'
  | 'no_breathing_room'
  | 'weak_cadence';

export interface DiagnosisIssue {
  id: string;
  kind: IssueKind;
  severity: 'warn' | 'tip';
  title: string;
  explanation: string;
  bar: number;
  affectedNoteIds: string[];
  applyFix: (project: SongProject) => SongProject;
}

export interface DiagnosisReport {
  score: number;
  summary: string;
  issues: DiagnosisIssue[];
}

function getEditableMelody(compiled: CompiledSong, project: SongProject) {
  const src = project.baked && project.bakedMelody.length > 0 ? project.bakedMelody : compiled.melody;
  return src.map((n) => ({ ...n, origin: n.origin ?? ('base' as const) }));
}

export function analyzeSong(compiled: CompiledSong, project: SongProject): DiagnosisReport {
  const th = PRESETS.analyzerThresholds;
  const melody = compiled.melody;
  const issues: DiagnosisIssue[] = [];
  const scalePcs = new Set(getScalePitchClasses(project.keyRoot, project.mode));

  // 1. 강박/긴 음가 화성 충돌 (clash) 검사
  const clashNotes = melody.filter((n) => n.role === 'clash');
  if (clashNotes.length > 0) {
    const first = clashNotes[0];
    const bar = Math.floor(first.step / 16);
    const chord = compiled.resolvedChords[bar];
    const fixedPitch = nearestChordTone(first.midi, chord, 60, 84);
    const affectedIds = clashNotes.map((n) => n.id);
    issues.push({
      id: 'issue_clash',
      kind: 'clash',
      severity: 'warn',
      bar: bar + 1,
      title: `${bar + 1}마디 화음 충돌음 ${clashNotes.length}개`,
      explanation: `${bar + 1}마디 ${chord.symbol}(${chord.koreanRoot}) 반주와 ${koreanNoteName(first.midi)}(${noteName(first.midi)}) 음이 어긋나 부딪힌다. 가까운 코드 구성음 ${koreanNoteName(fixedPitch)}(${noteName(fixedPitch)})로 옮기면 자연스럽게 어울린다.`,
      affectedNoteIds: affectedIds,
      applyFix: (proj) => {
        const next = cloneProject(proj);
        const notes = getEditableMelody(compiled, next);
        const set = new Set(affectedIds);
        next.bakedMelody = notes.map((n) => {
          if (!set.has(n.id)) return n;
          const b = Math.min(compiled.resolvedChords.length - 1, Math.floor(n.step / 16));
          return { ...n, midi: nearestChordTone(n.midi, compiled.resolvedChords[b], 60, 84), origin: 'user' };
        });
        next.baked = true;
        return next;
      },
    });
  }

  // 2. 스케일 이탈음(불협화음이 아니며 현재 코드 구성음도 아닌 음계 밖 음) 검사
  const outNotes = melody.filter(
    (n) => !scalePcs.has(wrapPc(n.midi)) && n.role !== 'clash' && n.role !== 'chord_tone'
  );
  if (outNotes.length > 0) {
    const first = outNotes[0];
    const bar = Math.floor(first.step / 16);
    const fixed = snapToScale(first.midi, project.keyRoot, project.mode, 60, 84);
    const affectedIds = outNotes.map((n) => n.id);
    issues.push({
      id: 'issue_out_of_scale',
      kind: 'out_of_scale',
      severity: 'tip',
      bar: bar + 1,
      title: `${bar + 1}마디 음계 밖 음표 ${outNotes.length}개`,
      explanation: `${koreanNoteName(first.midi)}(${noteName(first.midi)}) 음이 현재 키 음계를 벗어났다. 의도한 임시표가 아니라면 ${koreanNoteName(fixed)}(${noteName(fixed)})로 맞추는 편이 안정적이다.`,
      affectedNoteIds: affectedIds,
      applyFix: (proj) => {
        const next = cloneProject(proj);
        const notes = getEditableMelody(compiled, next);
        const set = new Set(affectedIds);
        next.bakedMelody = notes.map((n) =>
          set.has(n.id) ? { ...n, midi: snapToScale(n.midi, proj.keyRoot, proj.mode, 60, 84), origin: 'user' } : n
        );
        next.baked = true;
        return next;
      },
    });
  }

  // 3. 음역 폭 및 잦은 큰 도약 검사
  if (melody.length >= 2) {
    const midis = melody.map((n) => n.midi);
    const span = Math.max(...midis) - Math.min(...midis);
    if (span < th.minRangeSemitones) {
      issues.push({
        id: 'issue_narrow_range',
        kind: 'narrow_range',
        severity: 'tip',
        bar: 1,
        title: `음역이 좁음 (${span}반음)`,
        explanation: `멜로디가 몇 개 음에만 머물러 평탄하게 들린다. 클라이맥스 마디 음정을 4~5도 올려 주면 굴곡이 살아난다.`,
        affectedNoteIds: melody.slice(Math.floor(melody.length / 2)).map((n) => n.id),
        applyFix: (proj) => {
          const next = cloneProject(proj);
          const notes = getEditableMelody(compiled, next);
          const midIdx = Math.floor(notes.length / 2);
          next.bakedMelody = notes.map((n, idx) =>
            idx >= midIdx && idx < notes.length - 1
              ? { ...n, midi: snapToScale(Math.min(84, n.midi + 5), proj.keyRoot, proj.mode, 60, 84), origin: 'user' }
              : n
          );
          next.baked = true;
          return next;
        },
      });
    }

    let largeLeaps = 0;
    const leapIds: string[] = [];
    for (let i = 1; i < melody.length; i++) {
      if (Math.abs(melody[i].midi - melody[i - 1].midi) >= th.largeLeapSemitones) {
        largeLeaps++;
        leapIds.push(melody[i].id);
      }
    }
    const leapRatio = largeLeaps / (melody.length - 1);
    if (leapRatio > th.maxLargeLeapRatio && leapIds.length > 0) {
      const firstBar = Math.floor(melody.find((n) => n.id === leapIds[0])!.step / 16) + 1;
      issues.push({
        id: 'issue_leaps',
        kind: 'excessive_leaps',
        severity: 'tip',
        bar: firstBar,
        title: `큰 음정 도약이 잦음 (${largeLeaps}회)`,
        explanation: `음표들이 한 번에 ${th.largeLeapSemitones}반음 이상 자주 뛰어 부르기 어렵다. 도약한 음을 앞 음 근처 코드톤으로 당기면 흐름이 매끄러워진다.`,
        affectedNoteIds: leapIds,
        applyFix: (proj) => {
          const next = cloneProject(proj);
          const notes = getEditableMelody(compiled, next);
          for (let i = 1; i < notes.length; i++) {
            const diff = notes[i].midi - notes[i - 1].midi;
            if (Math.abs(diff) >= th.largeLeapSemitones) {
              const step = diff > 0 ? notes[i].midi - 12 : notes[i].midi + 12;
              const clamped = Math.max(60, Math.min(84, step));
              const b = Math.min(compiled.resolvedChords.length - 1, Math.floor(notes[i].step / 16));
              notes[i].midi = nearestChordTone(clamped, compiled.resolvedChords[b], 60, 84);
              notes[i].origin = 'user';
            }
          }
          next.bakedMelody = notes;
          next.baked = true;
          return next;
        },
      });
    }
  }

  // 4. 단조로운 리듬 · 쉼표 부족 검사
  if (melody.length >= 4) {
    const durCounts = new Map<number, number>();
    let soundSteps = 0;
    for (const n of melody) {
      durCounts.set(n.duration, (durCounts.get(n.duration) ?? 0) + 1);
      soundSteps += n.duration;
    }
    const maxDurCount = Math.max(...durCounts.values());
    const sameRatio = maxDurCount / melody.length;
    const restRatio = Math.max(0, 1 - soundSteps / compiled.totalSteps);

    if (sameRatio > th.maxSameDurationRatio) {
      issues.push({
        id: 'issue_monotone',
        kind: 'monotone_rhythm',
        severity: 'tip',
        bar: 2,
        title: '리듬 길이가 단조로움',
        explanation: `거의 모든 음표 길이가 똑같아 기계적으로 들릴 수 있다. 짝수 마디 끝음 길이를 늘려 숨 고르는 구간을 넣으면 좋다.`,
        affectedNoteIds: melody.filter((_, i) => i % 2 === 1).map((n) => n.id),
        applyFix: (proj) => {
          const next = cloneProject(proj);
          const notes = getEditableMelody(compiled, next).sort(
            (a, b) => a.step - b.step || a.midi - b.midi
          );
          for (let i = 0; i < notes.length; i++) {
            const cur = notes[i];
            const bar = Math.floor(cur.step / 16);
            if (bar % 2 === 1 && cur.step % 16 >= 8) {
              const targetDur = Math.min(
                compiled.totalSteps - cur.step,
                Math.max(4, cur.duration * 2)
              );
              if (targetDur > cur.duration) {
                cur.duration = targetDur;
                cur.origin = 'user';
                while (i + 1 < notes.length && notes[i + 1].step < cur.step + targetDur) {
                  notes.splice(i + 1, 1);
                }
              }
            }
          }

          const checkMonotone = (list: typeof notes): boolean => {
            if (list.length < 4) return false;
            const counts = new Map<number, number>();
            for (const n of list) counts.set(n.duration, (counts.get(n.duration) ?? 0) + 1);
            return Math.max(...counts.values()) / list.length > th.maxSameDurationRatio;
          };

          if (checkMonotone(notes)) {
            for (let i = 1; i < notes.length && checkMonotone(notes); i += 2) {
              const cur = notes[i];
              if (cur.duration > 1) {
                cur.duration = Math.max(1, Math.floor(cur.duration / 2));
                cur.origin = 'user';
              } else {
                const targetDur = Math.min(compiled.totalSteps - cur.step, 2);
                if (targetDur > cur.duration) {
                  cur.duration = targetDur;
                  cur.origin = 'user';
                  while (i + 1 < notes.length && notes[i + 1].step < cur.step + targetDur) {
                    notes.splice(i + 1, 1);
                  }
                }
              }
            }
          }

          next.bakedMelody = notes;
          next.baked = true;
          return next;
        },
      });
    } else if (restRatio < th.minRestRatio) {
      issues.push({
        id: 'issue_no_rest',
        kind: 'no_breathing_room',
        severity: 'tip',
        bar: project.bars,
        title: '쉼표(여백)가 부족함',
        explanation: `음표가 빈틈없이 꽉 차 있어 귀가 쉴 틈이 적다. 마디 끝 음 길이를 줄여 여백을 남기면 프레이즈가 또렷해진다.`,
        affectedNoteIds: [melody[melody.length - 1].id],
        applyFix: (proj) => {
          const next = cloneProject(proj);
          const notes = getEditableMelody(compiled, next).sort(
            (a, b) => a.step - b.step || a.midi - b.midi
          );
          const targetRestSteps = Math.ceil(compiled.totalSteps * th.minRestRatio);
          const currentSound = notes.reduce((acc, n) => acc + n.duration, 0);
          let deficit = targetRestSteps - Math.max(0, compiled.totalSteps - currentSound);

          const orderedIndices = [
            ...notes.map((_, idx) => idx).filter((idx) => notes[idx].step % 16 >= 8).reverse(),
            ...notes.map((_, idx) => idx).filter((idx) => notes[idx].step % 16 < 8).reverse(),
          ];

          for (const idx of orderedIndices) {
            if (deficit <= 0) break;
            const n = notes[idx];
            if (n.duration > 1) {
              const nextDur = Math.max(1, Math.floor(n.duration / 2));
              deficit -= n.duration - nextDur;
              n.duration = nextDur;
              n.origin = 'user';
            }
          }

          if (deficit > 0) {
            const removeIds = new Set<string>();
            for (const idx of orderedIndices) {
              if (deficit <= 0 || notes.length - removeIds.size <= 1) break;
              const n = notes[idx];
              removeIds.add(n.id);
              deficit -= n.duration;
            }
            next.bakedMelody = notes.filter((n) => !removeIds.has(n.id));
          } else {
            next.bakedMelody = notes;
          }
          next.baked = true;
          return next;
        },
      });
    }
  }

  // 5. 마지막 음 종지감 검사
  if (melody.length > 0) {
    const last = melody[melody.length - 1];
    const tonic = resolveChord('I', project.keyRoot, project.mode);
    const stablePcs = new Set([tonic.rootPc, tonic.pitchClasses[1]]);
    if (!stablePcs.has(wrapPc(last.midi))) {
      let resolvedMidi = last.midi;
      let bestDist = Infinity;
      for (let m = 60; m <= 84; m++) {
        if (wrapPc(m) === tonic.rootPc && Math.abs(m - last.midi) < bestDist) {
          resolvedMidi = m;
          bestDist = Math.abs(m - last.midi);
        }
      }
      issues.push({
        id: 'issue_cadence',
        kind: 'weak_cadence',
        severity: 'tip',
        bar: project.bars,
        title: `마지막 마디가 끝맺지 않고 열려 있음`,
        explanation: `마지막 음이 ${koreanNoteName(last.midi)}(${noteName(last.midi)})라 다음을 기다리는 느낌이 남는다. 곡의 으뜸음 ${koreanNoteName(resolvedMidi)}(${noteName(resolvedMidi)})로 끝내면 깔끔하게 마무리된다.`,
        affectedNoteIds: [last.id],
        applyFix: (proj) => {
          const next = cloneProject(proj);
          const notes = getEditableMelody(compiled, next);
          const endIdx = notes.length - 1;
          notes[endIdx] = { ...notes[endIdx], midi: resolvedMidi, origin: 'user' };
          next.bakedMelody = notes;
          next.baked = true;
          return next;
        },
      });
    }
  }

  const penalty = issues.reduce((acc, it) => acc + (it.severity === 'warn' ? 18 : 8), 0);
  const score = Math.max(40, Math.min(100, 100 - penalty));
  const summary =
    issues.length === 0
      ? '화성·리듬·종지 균형이 모두 안정적이다.'
      : `조언 ${issues.length}건이 있다. 수정안을 먼저 들어보고 적용할 수 있다.`;

  return { score, summary, issues };
}
