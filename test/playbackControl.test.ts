import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/core/model';
import {
  applyDrumMuteToMetronome,
  clampLoopRangeOnBarResize,
  clampTrackVolume,
  createDefaultMetronomeState,
  createDefaultTrackVolumes,
  isMetronomeBeat,
  loopRangeToStepRange,
  normalizeLoopRange,
  sanitizeTrackVolumes,
  scaleTrackVelocity,
  selectLoopBarRange,
  toggleMetronomeManual,
} from '../src/core/playbackControl';

describe('playbackControl loop ranges', () => {
  it('normalizes reversed and out-of-bounds loop bar ranges', () => {
    expect(normalizeLoopRange(null, 4)).toBeNull();
    expect(normalizeLoopRange({ startBar: 2, endBar: 1 }, 4)).toEqual({ startBar: 1, endBar: 2 });
    expect(normalizeLoopRange({ startBar: -2, endBar: 9 }, 4)).toEqual({ startBar: 0, endBar: 3 });
    expect(normalizeLoopRange({ startBar: 0, endBar: 1 }, 0)).toBeNull();
  });

  it('clamps or clears loop range when bar count shrinks', () => {
    expect(clampLoopRangeOnBarResize({ startBar: 2, endBar: 7 }, 4)).toEqual({
      startBar: 2,
      endBar: 3,
    });
    expect(clampLoopRangeOnBarResize({ startBar: 5, endBar: 7 }, 4)).toBeNull();
  });

  it('converts loop bar range to 16-step window', () => {
    expect(loopRangeToStepRange(null, 64)).toEqual({ startStep: 0, endStep: 64 });
    expect(loopRangeToStepRange({ startBar: 1, endBar: 2 }, 64)).toEqual({
      startStep: 16,
      endStep: 48,
    });
  });

  it('toggles single bar and extends range with Shift behavior', () => {
    const b1 = selectLoopBarRange(null, 1, 4, false);
    expect(b1).toEqual({ startBar: 1, endBar: 1 });

    // 같은 단일 마디를 다시 누르면 해제된다.
    expect(selectLoopBarRange(b1, 1, 4, false)).toBeNull();

    // 다른 마디를 누르면 그 마디로 바뀐다.
    expect(selectLoopBarRange(b1, 2, 4, false)).toEqual({ startBar: 2, endBar: 2 });

    // extend=true 면 기존 범위와 새 마디를 모두 포함하도록 확장한다.
    const extendedForward = selectLoopBarRange(b1, 3, 4, true);
    expect(extendedForward).toEqual({ startBar: 1, endBar: 3 });
    expect(selectLoopBarRange(extendedForward, 0, 4, true)).toEqual({ startBar: 0, endBar: 3 });
  });
});

describe('playbackControl metronome and mixer', () => {
  it('auto-activates metronome on drum mute and restores when unmuted unless manually overridden', () => {
    const initial = createDefaultMetronomeState();
    expect(initial).toEqual({
      enabled: PRESETS.playback.metronome.defaultEnabled,
      autoActivated: false,
    });

    const onMute = applyDrumMuteToMetronome(initial, true, true);
    expect(onMute).toEqual({ enabled: true, autoActivated: true });

    const onUnmute = applyDrumMuteToMetronome(onMute, false, true);
    expect(onUnmute).toEqual({ enabled: false, autoActivated: false });

    // 수동으로 켠 상태는 드럼 음소거 해제 후에도 유지된다.
    const manualOn = toggleMetronomeManual(initial);
    expect(manualOn).toEqual({ enabled: true, autoActivated: false });
    const afterDrumCycle = applyDrumMuteToMetronome(
      applyDrumMuteToMetronome(manualOn, true, true),
      false,
      true
    );
    expect(afterDrumCycle).toEqual({ enabled: true, autoActivated: false });
  });

  it('detects quarter-note clicks and bar downbeat accents', () => {
    expect(isMetronomeBeat(0)).toEqual({ trigger: true, accent: true });
    expect(isMetronomeBeat(4)).toEqual({ trigger: true, accent: false });
    expect(isMetronomeBeat(16)).toEqual({ trigger: true, accent: true });
    expect(isMetronomeBeat(2)).toEqual({ trigger: false, accent: false });
    expect(isMetronomeBeat(-1)).toEqual({ trigger: false, accent: false });
  });

  it('clamps, sanitizes, and scales track mixer volumes from presets', () => {
    const { min, max, defaults } = PRESETS.playback.mixer;
    expect(createDefaultTrackVolumes()).toEqual(defaults);
    expect(clampTrackVolume(min - 1)).toBe(min);
    expect(clampTrackVolume(max + 1)).toBe(max);
    expect(clampTrackVolume(Number.NaN)).toBe(min);

    const sanitized = sanitizeTrackVolumes({
      melody: max + 2,
      chords: 'bad',
      bass: min - 1,
    });
    expect(sanitized).toEqual({
      melody: max,
      chords: defaults.chords,
      bass: min,
      drums: defaults.drums,
      pad: defaults.pad,
    });

    expect(scaleTrackVelocity(0.8, 0)).toBe(0);
    expect(scaleTrackVelocity(0.8, 0.5)).toBeCloseTo(0.4, 5);
    expect(scaleTrackVelocity(0.9, max)).toBe(1);
  });
});
