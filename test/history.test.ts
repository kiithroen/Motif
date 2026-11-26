import { describe, expect, it } from 'vitest';
import { ProjectHistory } from '../src/core/history';
import { createDefaultProject } from '../src/core/model';

describe('ProjectHistory', () => {
  it('supports undo, redo, and clears redo stack on new edit', () => {
    const history = new ProjectHistory(10);
    const p0 = createDefaultProject();
    const p1 = { ...createDefaultProject(), seed: 2 };
    const p2 = { ...createDefaultProject(), seed: 3 };

    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);

    history.push(p0);
    history.push(p1);
    expect(history.canUndo()).toBe(true);

    const undone1 = history.undo(p2);
    expect(undone1?.seed).toBe(2);
    expect(history.canRedo()).toBe(true);

    const undone2 = history.undo(undone1!);
    expect(undone2?.seed).toBe(1);
    expect(history.canUndo()).toBe(false);

    const redone = history.redo(undone2!);
    expect(redone?.seed).toBe(2);

    // 새 편집이 발생하면 redo 분기가 초기화된다.
    history.push(redone!);
    expect(history.canRedo()).toBe(false);
  });

  it('clones snapshots and caps depth', () => {
    const history = new ProjectHistory(2);
    const base = createDefaultProject();
    history.push(base);
    base.seed = 999; // 원본 수정이 저장된 스냅샷에 영향을 주지 않아야 한다.

    history.push({ ...createDefaultProject(), seed: 10 });
    history.push({ ...createDefaultProject(), seed: 20 });

    const r1 = history.undo({ ...createDefaultProject(), seed: 30 });
    const r2 = history.undo(r1!);
    const r3 = history.undo(r2!);

    expect(r1?.seed).toBe(20);
    expect(r2?.seed).toBe(10);
    expect(r3).toBeNull();
  });
});
