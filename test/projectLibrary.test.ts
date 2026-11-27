import { describe, expect, it } from 'vitest';
import { PRESETS, createDefaultProject } from '../src/core/model';
import {
  buildBackupFilename,
  createInitialLibrary,
  createSongSlot,
  deleteSongSlot,
  duplicateSongSlot,
  generateNextUntitledName,
  generateUniqueSlotName,
  getActiveSlot,
  importBackupIntoLibrary,
  parseBackupJson,
  renameSongSlot,
  sanitizeLibraryState,
  sanitizeSlotName,
  sanitizeSongProject,
  selectSongSlot,
  serializeLibraryBackup,
  serializeSongBackup,
  updateActiveSlotProject,
} from '../src/core/projectLibrary';

describe('projectLibrary slot management and legacy migration', () => {
  it('migrates legacy single project into the initial slot when library key is absent', () => {
    const legacy = createDefaultProject();
    legacy.keyRoot = 7;
    legacy.bars = 8;
    legacy.bpm = PRESETS.library.bpmMax;

    const lib = sanitizeLibraryState(null, legacy, '2026-11-27T00:00:00.000Z');
    expect(lib.version).toBe(PRESETS.library.schemaVersion);
    expect(lib.slots).toHaveLength(1);
    expect(lib.slots[0].name).toBe(PRESETS.library.defaultSlotName);
    expect(getActiveSlot(lib).project.keyRoot).toBe(7);
    expect(getActiveSlot(lib).project.bars).toBe(8);
  });

  it('creates, duplicates, renames, switches, and deletes slots with deep-clone isolation', () => {
    let lib = createInitialLibrary(null, '2026-11-27T01:00:00.000Z');
    const firstId = lib.activeSlotId;

    const created = createSongSlot(lib, { nowIso: '2026-11-27T01:05:00.000Z' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    lib = created.library;
    expect(lib.slots).toHaveLength(2);
    expect(created.slot.name).toBe(`${PRESETS.library.untitledPrefix} 2`);
    expect(lib.activeSlotId).toBe(created.slot.id);

    const editedProject = createDefaultProject();
    editedProject.keyRoot = 4;
    editedProject.baked = true;
    editedProject.bakedMelody = [
      { id: 'n1', midi: 64, step: 0, duration: 4, velocity: 0.8, origin: 'user' },
    ];
    lib = updateActiveSlotProject(lib, editedProject, '2026-11-27T01:06:00.000Z');

    const duplicated = duplicateSongSlot(lib, created.slot.id, '2026-11-27T01:07:00.000Z');
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    lib = duplicated.library;
    expect(lib.slots).toHaveLength(3);
    expect(duplicated.slot.name).toBe(`${created.slot.name} ${PRESETS.library.duplicateSuffix}`);

    // 복제본을 수정해도 원본 슬롯 데이터는 변하지 않는다.
    const mutatedDup = createDefaultProject();
    mutatedDup.keyRoot = 9;
    lib = updateActiveSlotProject(lib, mutatedDup, '2026-11-27T01:08:00.000Z');
    const originalSlot = lib.slots.find((s) => s.id === created.slot.id)!;
    expect(originalSlot.project.keyRoot).toBe(4);
    expect(originalSlot.project.bakedMelody).toHaveLength(1);

    lib = renameSongSlot(lib, firstId, '  메인   아이디어  ', '2026-11-27T01:09:00.000Z');
    expect(lib.slots.find((s) => s.id === firstId)?.name).toBe('메인 아이디어');

    lib = selectSongSlot(lib, firstId);
    expect(lib.activeSlotId).toBe(firstId);

    const deleted = deleteSongSlot(lib, duplicated.slot.id);
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    lib = deleted.library;
    expect(lib.slots).toHaveLength(2);

    const deletedFirst = deleteSongSlot(lib, firstId);
    expect(deletedFirst.ok).toBe(true);
    if (!deletedFirst.ok) return;
    lib = deletedFirst.library;
    expect(lib.slots).toHaveLength(1);

    // 마지막 1개 슬롯은 삭제할 수 없다.
    const lastDelete = deleteSongSlot(lib, lib.activeSlotId);
    expect(lastDelete.ok).toBe(false);
  });

  it('enforces maxSlots limit from presets and generates bounded unique names', () => {
    let lib = createInitialLibrary();
    for (let i = 1; i < PRESETS.library.maxSlots; i++) {
      const res = createSongSlot(lib);
      expect(res.ok).toBe(true);
      if (res.ok) lib = res.library;
    }
    expect(lib.slots).toHaveLength(PRESETS.library.maxSlots);

    const overflow = createSongSlot(lib);
    expect(overflow.ok).toBe(false);

    const dupOverflow = duplicateSongSlot(lib, lib.activeSlotId);
    expect(dupOverflow.ok).toBe(false);

    const longName = '가'.repeat(PRESETS.library.maxNameLength + 15);
    expect(sanitizeSlotName(longName, 'fallback')).toHaveLength(PRESETS.library.maxNameLength);
    expect(sanitizeSlotName('   ', '기본')).toBe('기본');

    const unique = generateUniqueSlotName('스케치', ['스케치', '스케치 (2)']);
    expect(unique).toBe('스케치 (3)');
    expect(generateNextUntitledName(['스케치 1', '스케치 2'])).toBe(`${PRESETS.library.untitledPrefix} 3`);
  });
});

describe('projectLibrary sanitization and JSON backup', () => {
  it('rejects structurally broken inputs and clamps out-of-range project fields', () => {
    expect(sanitizeSongProject(null).ok).toBe(false);
    expect(sanitizeSongProject({ blocks: {} }).ok).toBe(false);

    const malformed = {
      keyRoot: 99,
      mode: 'phrygian',
      bars: 6,
      bpm: PRESETS.library.bpmMax + 80,
      seed: -5,
      melodyInstrument: 'synth',
      activeLayer: 'L9',
      blocks: {
        progressionId: 'unknown_prog',
        grooveId: 'unknown_groove',
        contourId: 'unknown_contour',
        energy: 2.5,
        density: -1,
      },
      chain: {
        chords: [{ bar: 0, degree: 'INVALID' }],
        modifiers: [{ id: 'motif_repeat', enabled: false, amount: 3 }],
      },
      baked: true,
      bakedMelody: [
        { id: 'dup', midi: PRESETS.library.midiMax + 30, step: 999, duration: 50, velocity: 2, origin: 'user' },
        { id: 'dup', midi: PRESETS.library.midiMin - 10, step: -3, duration: 0, velocity: 0 },
        { id: 'bad', midi: 'NaN', step: 0 },
      ],
    };

    const res = sanitizeSongProject(malformed);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.project.keyRoot).toBe(11);
    expect(res.project.mode).toBe(PRESETS.defaults.mode);
    expect(res.project.bars).toBe(PRESETS.defaults.bars);
    expect(res.project.bpm).toBe(PRESETS.library.bpmMax);
    expect(res.project.seed).toBe(1);
    expect(res.project.blocks.progressionId).toBe(PRESETS.defaults.progressionId);
    expect(res.project.blocks.energy).toBe(1);
    expect(res.project.blocks.density).toBe(0);
    expect(res.project.chain.chords).toHaveLength(res.project.bars);
    expect(res.project.chain.modifiers).toHaveLength(PRESETS.modifiers.length);
    expect(res.project.bakedMelody).toHaveLength(2);
    expect(res.project.bakedMelody[0].id).not.toBe(res.project.bakedMelody[1].id);
    expect(res.project.bakedMelody[0].midi).toBe(PRESETS.library.midiMin);
    expect(res.project.bakedMelody[0].step).toBe(0);
    expect(res.project.bakedMelody[0].velocity).toBe(0.05);
    expect(res.project.bakedMelody[1].midi).toBe(PRESETS.library.midiMax);
    expect(res.project.bakedMelody[1].step).toBe(res.project.bars * 16 - 1);
    expect(res.project.bakedMelody[1].duration).toBe(1);
  });

  it('round-trips single song, full library, and raw project JSON backups', () => {
    let lib = createInitialLibrary(null, '2026-11-27T02:00:00.000Z');
    lib = renameSongSlot(lib, lib.activeSlotId, '첫 번째 곡');
    const proj2 = createDefaultProject();
    proj2.keyRoot = 5;
    proj2.bars = 8;
    const second = createSongSlot(lib, { name: '두 번째 곡', project: proj2 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    lib = second.library;

    const singleJson = serializeSongBackup(getActiveSlot(lib));
    const parsedSingle = parseBackupJson(singleJson);
    expect(parsedSingle.ok).toBe(true);
    if (parsedSingle.ok) {
      expect(parsedSingle.kind).toBe('motif-song');
      expect(parsedSingle.slots[0].project.keyRoot).toBe(5);
      expect(parsedSingle.slots[0].project.bars).toBe(8);
    }

    const libJson = serializeLibraryBackup(lib);
    const targetLib = createInitialLibrary();
    const importedLib = importBackupIntoLibrary(targetLib, libJson);
    expect(importedLib.ok).toBe(true);
    if (importedLib.ok) {
      expect(importedLib.importedCount).toBe(2);
      expect(importedLib.library.slots).toHaveLength(3);
      expect(getActiveSlot(importedLib.library).project.keyRoot).toBe(5);
    }

    const rawProject = createDefaultProject();
    rawProject.keyRoot = 2;
    const rawImport = importBackupIntoLibrary(targetLib, JSON.stringify(rawProject));
    expect(rawImport.ok).toBe(true);
    if (rawImport.ok) {
      expect(rawImport.importedCount).toBe(1);
      expect(getActiveSlot(rawImport.library).name).toBe(PRESETS.library.importedDefaultName);
      expect(getActiveSlot(rawImport.library).project.keyRoot).toBe(2);
    }
  });

  it('rejects malformed JSON and caps imports at maxSlots', () => {
    const lib = createInitialLibrary();
    expect(parseBackupJson('{broken').ok).toBe(false);
    expect(parseBackupJson(JSON.stringify({ format: 'other' })).ok).toBe(false);

    let nearFull = createInitialLibrary();
    for (let i = 1; i < PRESETS.library.maxSlots - 1; i++) {
      const res = createSongSlot(nearFull);
      if (res.ok) nearFull = res.library;
    }

    let sourceLib = createInitialLibrary();
    const extra = createSongSlot(sourceLib, { name: '추가 곡' });
    if (extra.ok) sourceLib = extra.library;
    const backupJson = serializeLibraryBackup(sourceLib);

    const partial = importBackupIntoLibrary(nearFull, backupJson);
    expect(partial.ok).toBe(true);
    if (partial.ok) {
      expect(partial.importedCount).toBe(1);
      expect(partial.skippedCount).toBe(1);
      expect(partial.library.slots).toHaveLength(PRESETS.library.maxSlots);

      const fullReject = importBackupIntoLibrary(partial.library, serializeSongBackup(lib.slots[0]));
      expect(fullReject.ok).toBe(false);
    }

    expect(buildBackupFilename('내 곡:/test?*', 'song')).toBe('내_곡__test.motif.json');
    expect(buildBackupFilename('backup all', 'library')).toBe('backup_all.json');
  });
});
