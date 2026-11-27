export const PC_KEYBOARD_NOTES: Record<string, number> = {
  a: 60, // C4
  w: 61,
  s: 62,
  e: 63,
  d: 64,
  f: 65,
  t: 66,
  g: 67,
  y: 68,
  h: 69,
  u: 70,
  j: 71,
  k: 72, // C5
};

export interface ShortcutHandlers {
  isBlocked: () => boolean;
  onUndo: () => void;
  onRedo: () => void;
  onTogglePlayback: () => void;
  onAuditionPitch: (midi: number) => void;
}

export function bindAppShortcuts(
  handlers: ShortcutHandlers,
  target: Window = window
): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    if (handlers.isBlocked()) return;
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el?.isContentEditable) {
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handlers.onUndo();
        return;
      }
      if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        handlers.onRedo();
        return;
      }
    }

    if (e.code === 'Space') {
      e.preventDefault();
      handlers.onTogglePlayback();
      return;
    }

    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
      const midi = PC_KEYBOARD_NOTES[e.key.toLowerCase()];
      if (midi) {
        handlers.onAuditionPitch(midi);
      }
    }
  };

  target.addEventListener('keydown', onKeyDown);
  return () => {
    target.removeEventListener('keydown', onKeyDown);
  };
}
