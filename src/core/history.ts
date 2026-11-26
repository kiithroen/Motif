import { type SongProject, cloneProject } from './model';

/**
 * 프로젝트 스냅샷 기반 되돌리기/다시 실행 스택을 관리한다.
 */
export class ProjectHistory {
  private past: SongProject[] = [];
  private future: SongProject[] = [];

  constructor(private readonly maxDepth = 40) {}

  public push(snapshot: SongProject): void {
    this.past.push(cloneProject(snapshot));
    if (this.past.length > this.maxDepth) {
      this.past.shift();
    }
    this.future = [];
  }

  public undo(current: SongProject): SongProject | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(cloneProject(current));
    return cloneProject(prev);
  }

  public redo(current: SongProject): SongProject | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(cloneProject(current));
    return cloneProject(next);
  }

  public canUndo(): boolean {
    return this.past.length > 0;
  }

  public canRedo(): boolean {
    return this.future.length > 0;
  }

  public clear(): void {
    this.past = [];
    this.future = [];
  }
}
