// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compileSong } from '../src/core/compiler';
import { type SongProject, createDefaultProject } from '../src/core/model';
import { renderFocusedPianoRoll, renderLayerEditor } from '../src/ui/layers';

const STEP_W = 20;
const ROW_H = 20;
const PR_MAX_MIDI = 84;

function makeTestProject(): SongProject {
  const proj = createDefaultProject();
  proj.activeLayer = 'L3';
  proj.bars = 4;
  proj.baked = true;
  proj.bakedMelody = [
    { id: 'n_1', midi: 72, step: 0, duration: 4, velocity: 0.8, origin: 'user' },
    { id: 'n_2', midi: 76, step: 8, duration: 4, velocity: 0.8, origin: 'user' },
  ];
  return proj;
}

function stubSvgRect(svg: SVGSVGElement): void {
  svg.getBoundingClientRect = () =>
    ({
      left: 100,
      top: 50,
      right: 100 + 1280,
      bottom: 50 + 500,
      width: 1280,
      height: 500,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    }) as DOMRect;
}

function pointerEvent(type: string, clientX: number, clientY: number, button = 0): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button,
  });
}

describe('L3 PianoRoll pointer interactions', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="mount"></div>';
    container = document.getElementById('mount')!;
  });

  it('renders note body and right-edge resize handle in L3 and focused views', () => {
    const project = makeTestProject();
    const compiled = compileSong(project);

    renderLayerEditor(container, project, compiled, -1, {
      selectedDuration: 2,
      onSelectDuration: vi.fn(),
      onProjectChange: vi.fn(),
      onAuditionPitch: vi.fn(),
      onPreviewModifier: vi.fn(),
    });
    expect(container.querySelectorAll('.pr-note-body').length).toBe(2);
    expect(container.querySelectorAll('.pr-note-resize').length).toBe(2);

    renderFocusedPianoRoll(container, project, compiled, -1, {
      showDurationPicker: true,
      selectedDuration: 2,
      onSelectDuration: vi.fn(),
      onProjectChange: vi.fn(),
      onAuditionPitch: vi.fn(),
    });
    expect(container.querySelectorAll('.pr-note-body').length).toBe(2);
    expect(container.querySelectorAll('.pr-note-resize').length).toBe(2);
  });

  it('moves note pitch and step when dragging body, auditioning pitch without deleting', () => {
    const project = makeTestProject();
    const compiled = compileSong(project);
    const onProjectChange = vi.fn();
    const onAuditionPitch = vi.fn();

    renderLayerEditor(container, project, compiled, -1, {
      selectedDuration: 2,
      onSelectDuration: vi.fn(),
      onProjectChange,
      onAuditionPitch,
      onPreviewModifier: vi.fn(),
    });

    const svg = container.querySelector<SVGSVGElement>('.pr-svg')!;
    stubSvgRect(svg);

    const body = container.querySelector<SVGRectElement>('.pr-note[data-note-id="n_1"] .pr-note-body')!;
    // n_1 은 step 0, midi 72 (row = 84 - 72 = 12).
    const startX = 100 + 10; // step 0 내부
    const startY = 50 + 12 * ROW_H + 10;
    body.dispatchEvent(pointerEvent('pointerdown', startX, startY));

    // step 2 (offset 0), midi 74 (row 10) 위치로 드래그한다.
    const moveX = 100 + 2 * STEP_W + 10;
    const moveY = 50 + (PR_MAX_MIDI - 74) * ROW_H + 10;
    window.dispatchEvent(pointerEvent('pointermove', moveX, moveY));
    window.dispatchEvent(pointerEvent('pointerup', moveX, moveY));

    expect(onAuditionPitch).toHaveBeenCalledWith(74);
    expect(onProjectChange).toHaveBeenCalledTimes(1);
    const updated = onProjectChange.mock.calls[0][0] as SongProject;
    expect(updated.baked).toBe(true);
    const moved = updated.bakedMelody.find((n) => n.id === 'n_1');
    expect(moved).toMatchObject({ step: 2, midi: 74, origin: 'user' });
    expect(updated.bakedMelody.length).toBe(2);
  });

  it('deletes note on simple body click without drag movement', () => {
    const project = makeTestProject();
    const compiled = compileSong(project);
    const onProjectChange = vi.fn();

    renderLayerEditor(container, project, compiled, -1, {
      selectedDuration: 2,
      onSelectDuration: vi.fn(),
      onProjectChange,
      onAuditionPitch: vi.fn(),
      onPreviewModifier: vi.fn(),
    });

    const svg = container.querySelector<SVGSVGElement>('.pr-svg')!;
    stubSvgRect(svg);

    const body = container.querySelector<SVGRectElement>('.pr-note[data-note-id="n_1"] .pr-note-body')!;
    body.dispatchEvent(pointerEvent('pointerdown', 110, 50 + 12 * ROW_H + 10));
    window.dispatchEvent(pointerEvent('pointerup', 111, 50 + 12 * ROW_H + 10));

    expect(onProjectChange).toHaveBeenCalledTimes(1);
    const updated = onProjectChange.mock.calls[0][0] as SongProject;
    expect(updated.bakedMelody.map((n) => n.id)).toEqual(['n_2']);
  });

  it('resizes note duration by dragging right-edge handle and ignores plain handle click', () => {
    const project = makeTestProject();
    const compiled = compileSong(project);
    const onProjectChange = vi.fn();

    renderLayerEditor(container, project, compiled, -1, {
      selectedDuration: 2,
      onSelectDuration: vi.fn(),
      onProjectChange,
      onAuditionPitch: vi.fn(),
      onPreviewModifier: vi.fn(),
    });

    const svg = container.querySelector<SVGSVGElement>('.pr-svg')!;
    stubSvgRect(svg);

    const handle = container.querySelector<SVGRectElement>('.pr-note[data-note-id="n_1"] .pr-note-resize')!;
    const handleY = 50 + 12 * ROW_H + 10;

    // 핸들을 움직이지 않고 클릭하면 길이나 음표 개수가 바뀌지 않는다.
    handle.dispatchEvent(pointerEvent('pointerdown', 100 + 4 * STEP_W - 3, handleY));
    window.dispatchEvent(pointerEvent('pointerup', 100 + 4 * STEP_W - 3, handleY));
    expect(onProjectChange).not.toHaveBeenCalled();

    // 핸들을 6스텝 끝까지 드래그하면 duration 이 6 으로 늘어난다.
    handle.dispatchEvent(pointerEvent('pointerdown', 100 + 4 * STEP_W - 3, handleY));
    window.dispatchEvent(pointerEvent('pointermove', 100 + 6 * STEP_W, handleY));
    window.dispatchEvent(pointerEvent('pointerup', 100 + 6 * STEP_W, handleY));

    expect(onProjectChange).toHaveBeenCalledTimes(1);
    const updated = onProjectChange.mock.calls[0][0] as SongProject;
    expect(updated.bakedMelody.find((n) => n.id === 'n_1')).toMatchObject({ duration: 6, origin: 'user' });
  });

  it('cancels drag on Escape without emitting project change', () => {
    const project = makeTestProject();
    const compiled = compileSong(project);
    const onProjectChange = vi.fn();

    renderLayerEditor(container, project, compiled, -1, {
      selectedDuration: 2,
      onSelectDuration: vi.fn(),
      onProjectChange,
      onAuditionPitch: vi.fn(),
      onPreviewModifier: vi.fn(),
    });

    const svg = container.querySelector<SVGSVGElement>('.pr-svg')!;
    stubSvgRect(svg);

    const body = container.querySelector<SVGRectElement>('.pr-note[data-note-id="n_1"] .pr-note-body')!;
    body.dispatchEvent(pointerEvent('pointerdown', 110, 50 + 12 * ROW_H + 10));
    window.dispatchEvent(pointerEvent('pointermove', 100 + 3 * STEP_W + 10, 50 + 10 * ROW_H + 10));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.dispatchEvent(pointerEvent('pointerup', 100 + 3 * STEP_W + 10, 50 + 10 * ROW_H + 10));

    expect(onProjectChange).not.toHaveBeenCalled();
  });

  it('adds a note and auditions pitch when clicking an empty grid cell', () => {
    const project = makeTestProject();
    const compiled = compileSong(project);
    const onProjectChange = vi.fn();
    const onAuditionPitch = vi.fn();

    renderFocusedPianoRoll(container, project, compiled, -1, {
      showDurationPicker: true,
      selectedDuration: 4,
      onSelectDuration: vi.fn(),
      onProjectChange,
      onAuditionPitch,
    });

    const svg = container.querySelector<SVGSVGElement>('.pr-svg')!;
    stubSvgRect(svg);

    // step 16, midi 79 (row 5) 빈 칸 클릭
    const clickX = 100 + 16 * STEP_W + 5;
    const clickY = 50 + (PR_MAX_MIDI - 79) * ROW_H + 10;
    svg.dispatchEvent(pointerEvent('pointerdown', clickX, clickY));

    expect(onAuditionPitch).toHaveBeenCalledWith(79);
    expect(onProjectChange).toHaveBeenCalledTimes(1);
    const updated = onProjectChange.mock.calls[0][0] as SongProject;
    const added = updated.bakedMelody.find((n) => n.step === 16);
    expect(added).toMatchObject({ midi: 79, duration: 4, origin: 'user' });
  });

  it('keeps L1 density and L2 modifier slider DOM intact during input drag and commits one history step on change', () => {
    const l1Proj = createDefaultProject();
    l1Proj.activeLayer = 'L1';
    const initialDensity = l1Proj.blocks.density;
    const onL1Change = vi.fn();

    renderLayerEditor(container, l1Proj, compileSong(l1Proj), -1, {
      selectedDuration: 2,
      onSelectDuration: vi.fn(),
      onProjectChange: onL1Change,
      onAuditionPitch: vi.fn(),
      onPreviewModifier: vi.fn(),
    });

    const densitySlider = container.querySelector<HTMLInputElement>('#sl-density')!;
    densitySlider.value = '0.75';
    densitySlider.dispatchEvent(new Event('input', { bubbles: true }));
    densitySlider.value = '0.85';
    densitySlider.dispatchEvent(new Event('input', { bubbles: true }));

    expect(container.querySelector('#sl-density')).toBe(densitySlider);
    expect(container.querySelector('#density-val')?.textContent).toBe('85%');
    expect(onL1Change).toHaveBeenCalledTimes(2);
    expect(onL1Change.mock.calls[0][1]).toEqual({ recompileAudioOnly: true, recordHistory: false });
    expect(onL1Change.mock.calls[1][1]).toEqual({ recompileAudioOnly: true, recordHistory: false });

    densitySlider.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onL1Change).toHaveBeenCalledTimes(3);
    expect(onL1Change.mock.calls[2][1]).toMatchObject({
      recompileAudioOnly: false,
      recordHistory: true,
    });
    expect((onL1Change.mock.calls[2][1] as { historyBase: SongProject }).historyBase.blocks.density).toBe(
      initialDensity
    );

    const l2Proj = createDefaultProject();
    l2Proj.activeLayer = 'L2';
    const onL2Change = vi.fn();
    renderLayerEditor(container, l2Proj, compileSong(l2Proj), -1, {
      selectedDuration: 2,
      onSelectDuration: vi.fn(),
      onProjectChange: onL2Change,
      onAuditionPitch: vi.fn(),
      onPreviewModifier: vi.fn(),
    });

    const modSlider = container.querySelector<HTMLInputElement>('.sl-mod[data-mod="syncopation"]')!;
    modSlider.value = '0.45';
    modSlider.dispatchEvent(new Event('input', { bubbles: true }));
    modSlider.value = '0.8';
    modSlider.dispatchEvent(new Event('input', { bubbles: true }));

    expect(container.querySelector('.sl-mod[data-mod="syncopation"]')).toBe(modSlider);
    expect(modSlider.closest('.mod-card')?.classList.contains('enabled')).toBe(true);
    expect(onL2Change).toHaveBeenCalledTimes(2);
    expect(onL2Change.mock.calls[0][1]).toEqual({ recompileAudioOnly: true, recordHistory: false });

    modSlider.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onL2Change).toHaveBeenCalledTimes(3);
    const modOpts = onL2Change.mock.calls[2][1] as {
      recompileAudioOnly: boolean;
      recordHistory: boolean;
      historyBase: SongProject;
    };
    expect(modOpts.recompileAudioOnly).toBe(false);
    expect(modOpts.recordHistory).toBe(true);
    expect(modOpts.historyBase.chain.modifiers.find((m) => m.id === 'syncopation')?.enabled).toBe(false);
  });
});
