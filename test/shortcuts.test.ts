// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { PC_KEYBOARD_NOTES, bindAppShortcuts } from '../src/app/shortcuts';

describe('app keyboard shortcuts', () => {
  it('handles undo, redo, space playback, and pc-keyboard note audition', () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const onTogglePlayback = vi.fn();
    const onAuditionPitch = vi.fn();
    let blocked = false;

    const cleanup = bindAppShortcuts({
      isBlocked: () => blocked,
      onUndo,
      onRedo,
      onTogglePlayback,
      onAuditionPitch,
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true }));
    expect(onUndo).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, cancelable: true }));
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true, cancelable: true })
    );
    expect(onRedo).toHaveBeenCalledTimes(2);

    const spaceEv = new KeyboardEvent('keydown', { code: 'Space', key: ' ', cancelable: true });
    window.dispatchEvent(spaceEv);
    expect(spaceEv.defaultPrevented).toBe(true);
    expect(onTogglePlayback).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', cancelable: true }));
    expect(onAuditionPitch).toHaveBeenNthCalledWith(1, PC_KEYBOARD_NOTES.a);
    expect(onAuditionPitch).toHaveBeenNthCalledWith(2, PC_KEYBOARD_NOTES.k);

    // repeat 키와 Ctrl 조합은 건반 미리듣기로 처리하지 않는다.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', repeat: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }));
    expect(onAuditionPitch).toHaveBeenCalledTimes(2);

    // 입력 요소 포커스 중에는 단축키를 막는다.
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
    expect(onTogglePlayback).toHaveBeenCalledTimes(1);

    // 코스 맵 등 차단 상태에서는 무시한다.
    blocked = true;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', cancelable: true }));
    expect(onTogglePlayback).toHaveBeenCalledTimes(1);

    // 해제 후에는 더 이상 호출되지 않는다.
    blocked = false;
    cleanup();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
