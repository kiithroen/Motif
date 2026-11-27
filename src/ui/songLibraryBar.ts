import { PRESETS } from '../core/model';
import { type SavedSongSlot, type SongLibraryState, getActiveSlot } from '../core/projectLibrary';
import { NOTE_NAMES_SHARP } from '../core/theory';

export interface SongLibraryNotice {
  kind: 'info' | 'error';
  text: string;
}

export interface SongLibraryUiState {
  drawerOpen: boolean;
  confirmDeleteSlotId: string | null;
  notice: SongLibraryNotice | null;
}

export interface SongLibraryCallbacks {
  onSelectSlot: (slotId: string) => void;
  onCreateSlot: () => void;
  onDuplicateSlot: (slotId: string) => void;
  onRenameSlot: (slotId: string, name: string) => void;
  onRequestDeleteSlot: (slotId: string) => void;
  onConfirmDeleteSlot: (slotId: string) => void;
  onCancelDeleteSlot: () => void;
  onToggleDrawer: () => void;
  onExportSong: (slotId: string) => void;
  onExportLibrary: () => void;
  onImportJsonText: (jsonText: string) => void;
  onImportError: (message: string) => void;
  onDismissNotice: () => void;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatSlotMeta(slot: SavedSongSlot): string {
  const key = NOTE_NAMES_SHARP[slot.project.keyRoot] ?? 'C';
  const mode = slot.project.mode === 'major' ? '장조' : '단조';
  return `${key} ${mode} · ${slot.project.bars}마디`;
}

function formatUpdatedAt(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${min}`;
}

export function renderSongLibraryBar(
  container: HTMLElement,
  library: SongLibraryState,
  uiState: SongLibraryUiState,
  callbacks: SongLibraryCallbacks
): void {
  const activeSlot = getActiveSlot(library);
  const canDelete = library.slots.length > 1;
  const isConfirmingBarDelete = canDelete && uiState.confirmDeleteSlotId === activeSlot.id;
  const maxSlots = PRESETS.library.maxSlots;
  const maxNameLength = PRESETS.library.maxNameLength;
  const atCapacity = library.slots.length >= maxSlots;

  const slotOptionsHtml = library.slots
    .map(
      (slot) =>
        `<option value="${escapeHtml(slot.id)}"${slot.id === activeSlot.id ? ' selected' : ''}>${escapeHtml(slot.name)} (${escapeHtml(formatSlotMeta(slot))})</option>`
    )
    .join('');

  const deleteControlHtml = isConfirmingBarDelete
    ? `
      <button class="btn btn-chip btn-danger" id="btn-slot-delete-confirm" type="button">삭제 확인</button>
      <button class="btn btn-chip" id="btn-slot-delete-cancel" type="button">취소</button>
    `
    : `<button class="btn btn-chip" id="btn-slot-delete" type="button"${canDelete ? '' : ' disabled title="최소 1개 슬롯은 유지해야 합니다"'}>삭제</button>`;

  const noticeHtml = uiState.notice
    ? `
      <div class="song-library-notice ${uiState.notice.kind}" role="status">
        <span>${escapeHtml(uiState.notice.text)}</span>
        <button class="btn btn-chip" id="btn-notice-dismiss" type="button">닫기</button>
      </div>
    `
    : '';

  const drawerHtml = uiState.drawerOpen
    ? `
      <div class="song-slot-drawer" id="song-slot-drawer">
        <div class="song-slot-grid">
          ${library.slots
            .map((slot) => {
              const isActive = slot.id === activeSlot.id;
              const isConfirmingCard = canDelete && uiState.confirmDeleteSlotId === slot.id;
              const updatedLabel = formatUpdatedAt(slot.updatedAt);
              const metaText = `${formatSlotMeta(slot)} · BPM ${slot.project.bpm} · ${slot.project.activeLayer}`;
              return `
                <div class="song-slot-card${isActive ? ' active' : ''}" data-slot-card="${escapeHtml(slot.id)}">
                  <div class="song-slot-card-head">
                    <strong class="song-slot-card-title">${escapeHtml(slot.name)}</strong>
                    ${isActive ? '<span class="song-slot-badge">현재 곡</span>' : ''}
                  </div>
                  <div class="song-slot-card-meta">${escapeHtml(metaText)}${updatedLabel ? ` · ${escapeHtml(updatedLabel)}` : ''}</div>
                  <div class="song-slot-card-actions">
                    <button
                      class="btn btn-chip${isActive ? ' active' : ''}"
                      data-slot-select="${escapeHtml(slot.id)}"
                      type="button"
                      ${isActive ? 'disabled' : ''}
                    >${isActive ? '열려 있음' : '불러오기'}</button>
                    <button
                      class="btn btn-chip"
                      data-slot-duplicate="${escapeHtml(slot.id)}"
                      type="button"
                      ${atCapacity ? 'disabled' : ''}
                    >복제</button>
                    ${
                      isConfirmingCard
                        ? `
                          <button class="btn btn-chip btn-danger" data-slot-delete-confirm="${escapeHtml(slot.id)}" type="button">삭제 확인</button>
                          <button class="btn btn-chip" data-slot-delete-cancel type="button">취소</button>
                        `
                        : `<button class="btn btn-chip" data-slot-delete-req="${escapeHtml(slot.id)}" type="button"${canDelete ? '' : ' disabled'}>삭제</button>`
                    }
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
    `
    : '';

  container.innerHTML = `
    <div class="song-library-bar-main">
      <div class="song-library-left">
        <span class="song-library-count">내 스케치 (${library.slots.length}/${maxSlots})</span>
        <select class="song-slot-select" id="sel-song-slot" aria-label="저장된 곡 슬롯 선택">
          ${slotOptionsHtml}
        </select>
        <input
          class="song-name-input"
          id="inp-song-name"
          type="text"
          maxlength="${maxNameLength}"
          value="${escapeHtml(activeSlot.name)}"
          aria-label="현재 곡 이름"
          placeholder="곡 이름"
        />
      </div>
      <div class="song-library-actions">
        <button class="btn btn-chip" id="btn-slot-new" type="button"${atCapacity ? ' disabled' : ''}>+ 새 곡</button>
        <button class="btn btn-chip" id="btn-slot-duplicate" type="button"${atCapacity ? ' disabled' : ''}>복제</button>
        ${deleteControlHtml}
        <button class="btn btn-chip${uiState.drawerOpen ? ' active' : ''}" id="btn-slot-drawer" type="button">슬롯 목록</button>
        <button class="btn btn-chip" id="btn-export-song" type="button">곡 JSON 저장</button>
        <button class="btn btn-chip" id="btn-export-library" type="button">전체 백업</button>
        <button class="btn btn-chip" id="btn-import-json" type="button"${atCapacity ? ' disabled' : ''}>JSON 불러오기</button>
        <input id="inp-import-json" type="file" accept=".json,application/json" hidden />
      </div>
    </div>
    ${noticeHtml}
    ${drawerHtml}
  `;

  container.querySelector<HTMLSelectElement>('#sel-song-slot')?.addEventListener('change', (e) => {
    callbacks.onSelectSlot((e.target as HTMLSelectElement).value);
  });

  const nameInput = container.querySelector<HTMLInputElement>('#inp-song-name');
  nameInput?.addEventListener('change', () => {
    callbacks.onRenameSlot(activeSlot.id, nameInput.value);
  });
  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      nameInput.blur();
    }
  });

  container.querySelector('#btn-slot-new')?.addEventListener('click', () => {
    callbacks.onCreateSlot();
  });

  container.querySelector('#btn-slot-duplicate')?.addEventListener('click', () => {
    callbacks.onDuplicateSlot(activeSlot.id);
  });

  container.querySelector('#btn-slot-delete')?.addEventListener('click', () => {
    callbacks.onRequestDeleteSlot(activeSlot.id);
  });

  container.querySelector('#btn-slot-delete-confirm')?.addEventListener('click', () => {
    callbacks.onConfirmDeleteSlot(activeSlot.id);
  });

  container.querySelector('#btn-slot-delete-cancel')?.addEventListener('click', () => {
    callbacks.onCancelDeleteSlot();
  });

  container.querySelector('#btn-slot-drawer')?.addEventListener('click', () => {
    callbacks.onToggleDrawer();
  });

  container.querySelector('#btn-export-song')?.addEventListener('click', () => {
    callbacks.onExportSong(activeSlot.id);
  });

  container.querySelector('#btn-export-library')?.addEventListener('click', () => {
    callbacks.onExportLibrary();
  });

  const fileInput = container.querySelector<HTMLInputElement>('#inp-import-json');
  container.querySelector('#btn-import-json')?.addEventListener('click', () => {
    fileInput?.click();
  });
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    if (typeof file.text === 'function') {
      void file.text().then(
        (text) => callbacks.onImportJsonText(text),
        () => callbacks.onImportError('선택한 파일을 읽지 못했다.')
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      callbacks.onImportJsonText(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      callbacks.onImportError('선택한 파일을 읽지 못했다.');
    };
    reader.readAsText(file);
  });

  container.querySelector('#btn-notice-dismiss')?.addEventListener('click', () => {
    callbacks.onDismissNotice();
  });

  container.querySelectorAll<HTMLButtonElement>('[data-slot-select]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.slotSelect;
      if (id) callbacks.onSelectSlot(id);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-slot-duplicate]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.slotDuplicate;
      if (id) callbacks.onDuplicateSlot(id);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-slot-delete-req]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.slotDeleteReq;
      if (id) callbacks.onRequestDeleteSlot(id);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-slot-delete-confirm]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.slotDeleteConfirm;
      if (id) callbacks.onConfirmDeleteSlot(id);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-slot-delete-cancel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      callbacks.onCancelDeleteSlot();
    });
  });
}
