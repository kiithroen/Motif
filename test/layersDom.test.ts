// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compileSong } from '../src/core/compiler';
import { PRESETS, type SongProject, createDefaultProject } from '../src/core/model';
import {
  renderFocusedPianoRoll,
  renderLayerEditor,
  updatePianoRollPlayhead,
} from '../src/ui/layers';

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

  it('auditions and selects note on single body click, and deletes on double click, right click, or Delete/Backspace', () => {
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

    const noteGroup = container.querySelector<SVGGElement>('.pr-note[data-note-id="n_1"]')!;
    const body = noteGroup.querySelector<SVGRectElement>('.pr-note-body')!;

    // 1) 단순 좌클릭 -> 삭제되지 않고 선택 + 미리듣기만 수행한다.
    body.dispatchEvent(pointerEvent('pointerdown', 110, 50 + 12 * ROW_H + 10));
    window.dispatchEvent(pointerEvent('pointerup', 111, 50 + 12 * ROW_H + 10));

    expect(onProjectChange).not.toHaveBeenCalled();
    expect(onAuditionPitch).toHaveBeenCalledWith(72);
    expect(noteGroup.classList.contains('selected')).toBe(true);

    // 2) 선택된 상태에서 Delete 키 -> 삭제
    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(onProjectChange).toHaveBeenCalledTimes(1);
    expect((onProjectChange.mock.calls[0][0] as SongProject).bakedMelody.map((n) => n.id)).toEqual(['n_2']);

    // 3) Backspace 키 -> 다시 선택 후 삭제
    onProjectChange.mockClear();
    const note2Body = container.querySelector<SVGRectElement>('.pr-note[data-note-id="n_2"] .pr-note-body')!;
    note2Body.dispatchEvent(pointerEvent('pointerdown', 100 + 8 * STEP_W + 10, 50 + (PR_MAX_MIDI - 76) * ROW_H + 10));
    window.dispatchEvent(pointerEvent('pointerup', 100 + 8 * STEP_W + 10, 50 + (PR_MAX_MIDI - 76) * ROW_H + 10));
    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(onProjectChange).toHaveBeenCalledTimes(1);
    expect((onProjectChange.mock.calls[0][0] as SongProject).bakedMelody.map((n) => n.id)).toEqual(['n_1']);

    // 4) 더블클릭(dblclick) -> 삭제 (빠른 2회 클릭에 의한 중복 삭제 없이 1회만 호출)
    onProjectChange.mockClear();
    body.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(onProjectChange).toHaveBeenCalledTimes(1);
    expect((onProjectChange.mock.calls[0][0] as SongProject).bakedMelody.map((n) => n.id)).toEqual(['n_2']);

    // 5) 빠른 2회 클릭 -> pointerup 2회차에 삭제 후 이어진 dblclick 은 무시
    onProjectChange.mockClear();
    renderLayerEditor(container, project, compiled, -1, {
      selectedDuration: 2,
      onSelectDuration: vi.fn(),
      onProjectChange,
      onAuditionPitch,
      onPreviewModifier: vi.fn(),
    });
    const freshSvg = container.querySelector<SVGSVGElement>('.pr-svg')!;
    stubSvgRect(freshSvg);
    const freshBody = container.querySelector<SVGRectElement>('.pr-note[data-note-id="n_1"] .pr-note-body')!;
    freshBody.dispatchEvent(pointerEvent('pointerdown', 110, 50 + 12 * ROW_H + 10));
    window.dispatchEvent(pointerEvent('pointerup', 110, 50 + 12 * ROW_H + 10));
    freshBody.dispatchEvent(pointerEvent('pointerdown', 110, 50 + 12 * ROW_H + 10));
    window.dispatchEvent(pointerEvent('pointerup', 110, 50 + 12 * ROW_H + 10));
    freshBody.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(onProjectChange).toHaveBeenCalledTimes(1);

    // 6) 우클릭(contextmenu) -> 삭제
    onProjectChange.mockClear();
    const note2 = container.querySelector<SVGRectElement>('.pr-note[data-note-id="n_2"] .pr-note-body')!;
    const ctxEv = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    note2.dispatchEvent(ctxEv);
    expect(ctxEv.defaultPrevented).toBe(true);
    expect(onProjectChange).toHaveBeenCalledTimes(1);
    expect((onProjectChange.mock.calls[0][0] as SongProject).bakedMelody.map((n) => n.id)).toEqual(['n_1']);
  });

  it('recomputes bounding rect during drag and resize when viewport scrolls', () => {
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
    let rectLeft = 100;
    let rectTop = 50;
    svg.getBoundingClientRect = () =>
      ({
        left: rectLeft,
        top: rectTop,
        right: rectLeft + 1280,
        bottom: rectTop + 500,
        width: 1280,
        height: 500,
        x: rectLeft,
        y: rectTop,
        toJSON: () => ({}),
      }) as DOMRect;

    // 이동 중 가로/세로 스크롤이 40px/20px 발생한 경우 최신 rect 기준으로 스텝/음높이가 계산된다.
    const body = container.querySelector<SVGRectElement>('.pr-note[data-note-id="n_1"] .pr-note-body')!;
    body.dispatchEvent(pointerEvent('pointerdown', 110, 50 + 12 * ROW_H + 10));
    rectLeft = 60;
    rectTop = 30;
    const moveX = rectLeft + 3 * STEP_W + 10;
    const moveY = rectTop + (PR_MAX_MIDI - 75) * ROW_H + 10;
    window.dispatchEvent(pointerEvent('pointermove', moveX, moveY));
    window.dispatchEvent(pointerEvent('pointerup', moveX, moveY));

    expect(onProjectChange).toHaveBeenCalledTimes(1);
    const movedProj = onProjectChange.mock.calls[0][0] as SongProject;
    expect(movedProj.bakedMelody.find((n) => n.id === 'n_1')).toMatchObject({ step: 3, midi: 75 });

    // 리사이즈 중 가로 스크롤이 발생한 경우 최신 rect 기준으로 길이가 계산된다.
    onProjectChange.mockClear();
    rectLeft = 100;
    rectTop = 50;
    renderLayerEditor(container, project, compiled, -1, {
      selectedDuration: 2,
      onSelectDuration: vi.fn(),
      onProjectChange,
      onAuditionPitch: vi.fn(),
      onPreviewModifier: vi.fn(),
    });
    const svg2 = container.querySelector<SVGSVGElement>('.pr-svg')!;
    svg2.getBoundingClientRect = () =>
      ({
        left: rectLeft,
        top: rectTop,
        right: rectLeft + 1280,
        bottom: rectTop + 500,
        width: 1280,
        height: 500,
        x: rectLeft,
        y: rectTop,
        toJSON: () => ({}),
      }) as DOMRect;

    const handle = container.querySelector<SVGRectElement>('.pr-note[data-note-id="n_1"] .pr-note-resize')!;
    const handleY = 50 + 12 * ROW_H + 10;
    handle.dispatchEvent(pointerEvent('pointerdown', 100 + 4 * STEP_W - 3, handleY));
    rectLeft = 40;
    window.dispatchEvent(pointerEvent('pointermove', rectLeft + 7 * STEP_W, handleY));
    window.dispatchEvent(pointerEvent('pointerup', rectLeft + 7 * STEP_W, handleY));

    expect(onProjectChange).toHaveBeenCalledTimes(1);
    const resizedProj = onProjectChange.mock.calls[0][0] as SongProject;
    expect(resizedProj.bakedMelody.find((n) => n.id === 'n_1')?.duration).toBe(7);
  });

  it('renders all note duration options from presets data and notifies on selection', () => {
    const project = makeTestProject();
    const compiled = compileSong(project);
    const onSelectDuration = vi.fn();

    renderLayerEditor(container, project, compiled, -1, {
      selectedDuration: PRESETS.defaults.noteDurationSteps,
      onSelectDuration,
      onProjectChange: vi.fn(),
      onAuditionPitch: vi.fn(),
      onPreviewModifier: vi.fn(),
    });

    const btns = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-duration]'));
    expect(btns.map((b) => Number(b.dataset.duration))).toEqual(
      PRESETS.noteDurationOptions.map((o) => o.steps)
    );
    expect(btns.map((b) => b.textContent)).toEqual(
      PRESETS.noteDurationOptions.map((o) => o.labelKo)
    );

    btns[0]?.click();
    expect(onSelectDuration).toHaveBeenCalledWith(PRESETS.noteDurationOptions[0].steps);
  });

  it('protects L3 bakedMelody on L2 chord changes by default and allows opt-out or reset', () => {
    const project = makeTestProject();
    project.activeLayer = 'L2';
    const compiled = compileSong(project);
    const onProjectChange = vi.fn();
    const onTogglePreserveBaked = vi.fn();

    // 1) 보호 ON (기본): 코드 변경 시 baked 와 bakedMelody 가 그대로 유지된다.
    renderLayerEditor(container, project, compiled, -1, {
      selectedDuration: PRESETS.defaults.noteDurationSteps,
      preserveBakedOnChordChange: true,
      onSelectDuration: vi.fn(),
      onTogglePreserveBaked,
      onProjectChange,
      onAuditionPitch: vi.fn(),
      onPreviewModifier: vi.fn(),
    });

    expect(container.querySelector('#btn-bake')?.textContent).toContain('유지');
    const guardChk = container.querySelector<HTMLInputElement>('#chk-preserve-baked')!;
    expect(guardChk.checked).toBe(true);

    const selBar0 = container.querySelector<HTMLSelectElement>('.sel-degree[data-bar="0"]')!;
    selBar0.value = 'vi';
    selBar0.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onProjectChange).toHaveBeenCalledTimes(1);
    const keptProj = onProjectChange.mock.calls[0][0] as SongProject;
    expect(keptProj.baked).toBe(true);
    expect(keptProj.bakedMelody).toEqual(project.bakedMelody);
    expect(keptProj.chain.chords[0].degree).toBe('vi');

    // 2) L3 돌아가기 버튼 클릭 시 baked 와 bakedMelody 를 유지한 채 L3 로 전환한다.
    onProjectChange.mockClear();
    container.querySelector<HTMLButtonElement>('#btn-bake')?.click();
    expect(onProjectChange).toHaveBeenCalledTimes(1);
    const backProj = onProjectChange.mock.calls[0][0] as SongProject;
    expect(backProj.activeLayer).toBe('L3');
    expect(backProj.baked).toBe(true);
    expect(backProj.bakedMelody).toEqual(project.bakedMelody);

    // 3) 보호 체크 해제 시 콜백 호출 및 보호 OFF 상태에서 코드 변경 시 baked=false 로 전환된다.
    guardChk.checked = false;
    guardChk.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onTogglePreserveBaked).toHaveBeenCalledWith(false);

    onProjectChange.mockClear();
    renderLayerEditor(container, project, compiled, -1, {
      selectedDuration: PRESETS.defaults.noteDurationSteps,
      preserveBakedOnChordChange: false,
      onSelectDuration: vi.fn(),
      onTogglePreserveBaked,
      onProjectChange,
      onAuditionPitch: vi.fn(),
      onPreviewModifier: vi.fn(),
    });
    const selBar1 = container.querySelector<HTMLSelectElement>('.sel-degree[data-bar="1"]')!;
    selBar1.value = 'IV';
    selBar1.dispatchEvent(new Event('change', { bubbles: true }));
    const unbakedProj = onProjectChange.mock.calls[0][0] as SongProject;
    expect(unbakedProj.baked).toBe(false);
    expect(unbakedProj.chain.chords[1].degree).toBe('IV');

    // 4) 'L2 결과로 덮어쓰기' 버튼 클릭 시 baked=false 와 bakedMelody=[] 로 초기화된다.
    onProjectChange.mockClear();
    container.querySelector<HTMLButtonElement>('#btn-l2-reset-baked')?.click();
    expect(onProjectChange).toHaveBeenCalledTimes(1);
    const resetProj = onProjectChange.mock.calls[0][0] as SongProject;
    expect(resetProj.baked).toBe(false);
    expect(resetProj.bakedMelody).toEqual([]);
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

  it('seeks on bar header click, toggles/extends loop with button, and drags loop range', () => {
    const project = makeTestProject();
    const compiled = compileSong(project);
    const onSeekBar = vi.fn();
    const onLoopRangeChange = vi.fn();

    renderLayerEditor(container, project, compiled, 16, {
      selectedDuration: 2,
      loopRange: { startBar: 1, endBar: 2 },
      onSelectDuration: vi.fn(),
      onProjectChange: vi.fn(),
      onAuditionPitch: vi.fn(),
      onPreviewModifier: vi.fn(),
      onSeekBar,
      onLoopRangeChange,
    });

    const header = container.querySelector<HTMLElement>('.pr-bar-header')!;
    header.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 1280,
        bottom: 28,
        width: 1280,
        height: 28,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    // 1) 초기 렌더에서 마디 1(activeStep=16) active-bar 및 루프 표시가 반영된다.
    expect(container.querySelector('.pr-bar-cell[data-bar="1"]')?.classList.contains('active-bar')).toBe(
      true
    );
    expect(container.querySelectorAll('.pr-bar-cell.in-loop').length).toBe(2);
    expect(container.querySelector('.pr-loop-badge')?.textContent).toContain('2~3마디');

    // 2) 마디 3 헤더 클릭 -> Seek
    header.dispatchEvent(pointerEvent('pointerdown', 3 * 320 + 40, 10));
    window.dispatchEvent(pointerEvent('pointerup', 3 * 320 + 40, 10));
    expect(onSeekBar).toHaveBeenCalledWith(3);

    // 3) 루프 버튼 Shift+클릭 -> 기존 1~2마디를 0~2마디로 확장
    const loopBtn0 = container.querySelector<HTMLButtonElement>('[data-loop-bar="0"]')!;
    loopBtn0.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(onLoopRangeChange).toHaveBeenLastCalledWith({ startBar: 0, endBar: 2 });

    // 4) 반복 해제 버튼 클릭 -> null
    container.querySelector<HTMLButtonElement>('#btn-clear-loop')?.click();
    expect(onLoopRangeChange).toHaveBeenLastCalledWith(null);

    // 5) 마디 헤더 드래그 (bar 1 -> bar 3) -> { startBar: 1, endBar: 3 }
    header.dispatchEvent(pointerEvent('pointerdown', 1 * 320 + 30, 10));
    window.dispatchEvent(pointerEvent('pointermove', 3 * 320 + 30, 10));
    expect(container.querySelectorAll('.pr-bar-cell.loop-preview').length).toBe(3);
    window.dispatchEvent(pointerEvent('pointerup', 3 * 320 + 30, 10));
    expect(onLoopRangeChange).toHaveBeenLastCalledWith({ startBar: 1, endBar: 3 });

    // 6) Escape 로 헤더 드래그 취소 시 추가 호출이 없다.
    const callsBeforeEsc = onLoopRangeChange.mock.calls.length;
    header.dispatchEvent(pointerEvent('pointerdown', 0 * 320 + 30, 10));
    window.dispatchEvent(pointerEvent('pointermove', 2 * 320 + 30, 10));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.dispatchEvent(pointerEvent('pointerup', 2 * 320 + 30, 10));
    expect(onLoopRangeChange.mock.calls.length).toBe(callsBeforeEsc);

    // 7) playhead 갱신 시 active-bar 도 함께 이동한다.
    updatePianoRollPlayhead(container, 48, compiled.totalSteps);
    expect(container.querySelector('.pr-bar-cell[data-bar="1"]')?.classList.contains('active-bar')).toBe(
      false
    );
    expect(container.querySelector('.pr-bar-cell[data-bar="3"]')?.classList.contains('active-bar')).toBe(
      true
    );
  });
});
