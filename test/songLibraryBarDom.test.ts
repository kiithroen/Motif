// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESETS, createDefaultProject } from '../src/core/model';
import { createInitialLibrary, createSongSlot } from '../src/core/projectLibrary';
import {
  type SongLibraryCallbacks,
  type SongLibraryUiState,
  renderSongLibraryBar,
} from '../src/ui/songLibraryBar';

function makeCallbacks(): SongLibraryCallbacks {
  return {
    onSelectSlot: vi.fn(),
    onCreateSlot: vi.fn(),
    onDuplicateSlot: vi.fn(),
    onRenameSlot: vi.fn(),
    onRequestDeleteSlot: vi.fn(),
    onConfirmDeleteSlot: vi.fn(),
    onCancelDeleteSlot: vi.fn(),
    onToggleDrawer: vi.fn(),
    onExportSong: vi.fn(),
    onExportLibrary: vi.fn(),
    onImportJsonText: vi.fn(),
    onImportError: vi.fn(),
    onDismissNotice: vi.fn(),
  };
}

function makeUiState(overrides: Partial<SongLibraryUiState> = {}): SongLibraryUiState {
  return {
    drawerOpen: false,
    confirmDeleteSlotId: null,
    notice: null,
    ...overrides,
  };
}

describe('songLibraryBar DOM rendering and interactions', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="lib-mount"></div>';
    container = document.getElementById('lib-mount')!;
  });

  it('disables delete when only one slot exists and triggers create, duplicate, rename, and export', () => {
    const lib = createInitialLibrary(createDefaultProject(), '2026-11-27T00:00:00.000Z');
    const callbacks = makeCallbacks();

    renderSongLibraryBar(container, lib, makeUiState(), callbacks);

    expect(container.querySelector('.song-library-count')?.textContent).toContain(
      `1/${PRESETS.library.maxSlots}`
    );
    expect(container.querySelector<HTMLButtonElement>('#btn-slot-delete')?.disabled).toBe(true);

    const nameInput = container.querySelector<HTMLInputElement>('#inp-song-name')!;
    expect(nameInput.maxLength).toBe(PRESETS.library.maxNameLength);
    nameInput.value = '밤산책 스케치';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(callbacks.onRenameSlot).toHaveBeenCalledWith(lib.activeSlotId, '밤산책 스케치');

    container.querySelector<HTMLButtonElement>('#btn-slot-new')!.click();
    expect(callbacks.onCreateSlot).toHaveBeenCalledTimes(1);

    container.querySelector<HTMLButtonElement>('#btn-slot-duplicate')!.click();
    expect(callbacks.onDuplicateSlot).toHaveBeenCalledWith(lib.activeSlotId);

    container.querySelector<HTMLButtonElement>('#btn-export-song')!.click();
    expect(callbacks.onExportSong).toHaveBeenCalledWith(lib.activeSlotId);

    container.querySelector<HTMLButtonElement>('#btn-export-library')!.click();
    expect(callbacks.onExportLibrary).toHaveBeenCalledTimes(1);
  });

  it('handles slot selection, two-step delete confirmation, drawer cards, and notice dismissal', () => {
    let lib = createInitialLibrary(createDefaultProject(), '2026-11-27T00:00:00.000Z');
    const second = createSongSlot(lib, { name: '<script>alert(1)</script>후렴 아이디어' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    lib = second.library;

    const callbacks = makeCallbacks();

    renderSongLibraryBar(
      container,
      lib,
      makeUiState({
        drawerOpen: true,
        confirmDeleteSlotId: lib.activeSlotId,
        notice: { kind: 'info', text: '<b>백업 완료</b>' },
      }),
      callbacks
    );

    // XSS 문자열은 HTML 태그가 아니라 텍스트로 이스케이프된다.
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('.song-library-notice')?.textContent).toContain('<b>백업 완료</b>');

    const selectEl = container.querySelector<HTMLSelectElement>('#sel-song-slot')!;
    selectEl.value = lib.slots[0].id;
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    expect(callbacks.onSelectSlot).toHaveBeenCalledWith(lib.slots[0].id);

    container.querySelector<HTMLButtonElement>('#btn-slot-delete-confirm')!.click();
    expect(callbacks.onConfirmDeleteSlot).toHaveBeenCalledWith(lib.activeSlotId);

    container.querySelector<HTMLButtonElement>('#btn-slot-delete-cancel')!.click();
    expect(callbacks.onCancelDeleteSlot).toHaveBeenCalledTimes(1);

    container.querySelector<HTMLButtonElement>('#btn-notice-dismiss')!.click();
    expect(callbacks.onDismissNotice).toHaveBeenCalledTimes(1);

    container.querySelector<HTMLButtonElement>(`[data-slot-select="${lib.slots[0].id}"]`)!.click();
    expect(callbacks.onSelectSlot).toHaveBeenCalledWith(lib.slots[0].id);

    container.querySelector<HTMLButtonElement>(`[data-slot-duplicate="${lib.slots[0].id}"]`)!.click();
    expect(callbacks.onDuplicateSlot).toHaveBeenCalledWith(lib.slots[0].id);
  });

  it('reads selected JSON file and forwards content to onImportJsonText', async () => {
    const lib = createInitialLibrary();
    const callbacks = makeCallbacks();

    renderSongLibraryBar(container, lib, makeUiState(), callbacks);

    const fileInput = container.querySelector<HTMLInputElement>('#inp-import-json')!;
    const file = new File(['{"format":"motif-song"}'], 'song.motif.json', {
      type: 'application/json',
    });
    Object.defineProperty(fileInput, 'files', {
      value: [file],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => {
      expect(callbacks.onImportJsonText).toHaveBeenCalledWith('{"format":"motif-song"}');
    });
  });
});
