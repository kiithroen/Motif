import { PRESETS, type TrackKey, type TrackVolumes } from './model';

export interface LoopBarRange {
  startBar: number;
  endBar: number;
}

export interface StepRange {
  startStep: number;
  endStep: number;
}

export interface TrackMuteState {
  melody: boolean;
  chords: boolean;
  bass: boolean;
  drums: boolean;
}

export interface MetronomeState {
  enabled: boolean;
  autoActivated: boolean;
}

const TRACK_KEYS: readonly TrackKey[] = ['melody', 'chords', 'bass', 'drums'];

/**
 * 프리셋 기본값으로 트랙별 볼륨 상태를 생성한다.
 */
export function createDefaultTrackVolumes(): TrackVolumes {
  const defaults = PRESETS.playback.mixer.defaults;
  return {
    melody: defaults.melody,
    chords: defaults.chords,
    bass: defaults.bass,
    drums: defaults.drums,
  };
}

/**
 * 모든 트랙이 켜진 기본 음소거 상태를 생성한다.
 */
export function createDefaultTrackMutes(): TrackMuteState {
  return {
    melody: false,
    chords: false,
    bass: false,
    drums: false,
  };
}

/**
 * 프리셋 기본값으로 메트로놈 상태를 생성한다.
 */
export function createDefaultMetronomeState(): MetronomeState {
  return {
    enabled: PRESETS.playback.metronome.defaultEnabled,
    autoActivated: false,
  };
}

/**
 * 트랙 볼륨을 프리셋 허용 범위로 클램프하고 비유한 값을 방어한다.
 */
export function clampTrackVolume(value: number): number {
  const { min, max } = PRESETS.playback.mixer;
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * 저장된 트랙 볼륨 객체를 검증하고 누락/비정상 값을 기본값으로 복원한다.
 */
export function sanitizeTrackVolumes(
  raw: Partial<Record<TrackKey, unknown>> | null | undefined
): TrackVolumes {
  const defaults = createDefaultTrackVolumes();
  if (!raw || typeof raw !== 'object') return defaults;

  const result: TrackVolumes = { ...defaults };
  for (const key of TRACK_KEYS) {
    const val = raw[key];
    if (typeof val === 'number' && Number.isFinite(val)) {
      result[key] = clampTrackVolume(val);
    }
  }
  return result;
}

/**
 * 트랙 볼륨 배율을 적용해 재생 벨로시티를 계산한다.
 */
export function scaleTrackVelocity(baseVelocity: number, trackVolume: number): number {
  if (!Number.isFinite(baseVelocity) || !Number.isFinite(trackVolume)) return 0;
  if (trackVolume <= 0 || baseVelocity <= 0) return 0;
  return Math.max(0.02, Math.min(1, baseVelocity * trackVolume));
}

/**
 * 마디 구간 반복 범위를 곡 마디 수에 맞게 정렬 및 클램프한다.
 */
export function normalizeLoopRange(
  range: LoopBarRange | null | undefined,
  totalBars: number
): LoopBarRange | null {
  if (!range || totalBars <= 0) return null;
  if (!Number.isFinite(range.startBar) || !Number.isFinite(range.endBar)) return null;
  const maxBar = Math.floor(totalBars) - 1;
  if (maxBar < 0) return null;

  const rawStart = Math.trunc(range.startBar);
  const rawEnd = Math.trunc(range.endBar);
  const startBar = Math.max(0, Math.min(maxBar, Math.min(rawStart, rawEnd)));
  const endBar = Math.max(0, Math.min(maxBar, Math.max(rawStart, rawEnd)));
  return { startBar, endBar };
}

/**
 * 곡 마디 수가 바뀔 때 기존 루프 구간을 안전하게 축소 또는 해제한다.
 */
export function clampLoopRangeOnBarResize(
  range: LoopBarRange | null | undefined,
  nextBars: number
): LoopBarRange | null {
  if (!range || nextBars <= 0) return null;
  if (!Number.isFinite(range.startBar) || !Number.isFinite(range.endBar)) return null;
  const orderedStart = Math.min(Math.trunc(range.startBar), Math.trunc(range.endBar));
  if (orderedStart >= nextBars) return null;
  return normalizeLoopRange(range, nextBars);
}

/**
 * 마디 구간을 16분음표 스텝 범위(start inclusive, end exclusive)로 변환한다.
 */
export function loopRangeToStepRange(
  range: LoopBarRange | null | undefined,
  totalSteps: number
): StepRange {
  const safeTotal = Math.max(0, Math.floor(totalSteps));
  const totalBars = Math.floor(safeTotal / 16);
  const normalized = normalizeLoopRange(range, totalBars);
  if (!normalized) {
    return { startStep: 0, endStep: safeTotal };
  }
  const startStep = normalized.startBar * 16;
  const endStep = Math.min(safeTotal, (normalized.endBar + 1) * 16);
  return { startStep, endStep };
}

/**
 * 마디 루프 버튼 클릭이나 Shift 확장에 따라 다음 루프 구간을 계산한다.
 */
export function selectLoopBarRange(
  current: LoopBarRange | null,
  barIdx: number,
  totalBars: number,
  extend: boolean
): LoopBarRange | null {
  if (totalBars <= 0 || !Number.isFinite(barIdx)) return null;
  const bar = Math.max(0, Math.min(Math.floor(totalBars) - 1, Math.trunc(barIdx)));
  const normCurrent = normalizeLoopRange(current, totalBars);

  if (extend) {
    if (!normCurrent) return { startBar: bar, endBar: bar };
    return {
      startBar: Math.min(normCurrent.startBar, bar),
      endBar: Math.max(normCurrent.endBar, bar),
    };
  }

  if (normCurrent && normCurrent.startBar === bar && normCurrent.endBar === bar) {
    return null;
  }
  return { startBar: bar, endBar: bar };
}

/**
 * 드럼 음소거 상태 변화에 맞춰 메트로놈 자동 활성화/복구를 처리한다.
 */
export function applyDrumMuteToMetronome(
  state: MetronomeState,
  nextDrumsMuted: boolean,
  autoOnDrumMute = PRESETS.playback.metronome.autoWhenDrumsMuted
): MetronomeState {
  if (nextDrumsMuted) {
    if (autoOnDrumMute && !state.enabled) {
      return { enabled: true, autoActivated: true };
    }
    return { ...state };
  }
  if (state.autoActivated) {
    return { enabled: false, autoActivated: false };
  }
  return { ...state };
}

/**
 * 사용자가 메트로놈을 수동 토글할 때 자동 활성화 플래그를 해제하고 상태를 전환한다.
 */
export function toggleMetronomeManual(state: MetronomeState): MetronomeState {
  return {
    enabled: !state.enabled,
    autoActivated: false,
  };
}

/**
 * 주어진 16분음표 스텝이 메트로놈 클릭 및 마디 강박인지 판정한다.
 */
export function isMetronomeBeat(step: number): { trigger: boolean; accent: boolean } {
  const safe = Math.trunc(step);
  if (safe < 0 || !Number.isFinite(step)) {
    return { trigger: false, accent: false };
  }
  return {
    trigger: safe % 4 === 0,
    accent: safe % 16 === 0,
  };
}
