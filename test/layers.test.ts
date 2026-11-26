import { describe, expect, it } from 'vitest';
import { computeFollowScrollLeft } from '../src/ui/layers';

describe('computeFollowScrollLeft', () => {
  it('keeps scrollLeft unchanged while playhead stays inside viewport', () => {
    expect(computeFollowScrollLeft(200, 0, 800, 1280)).toBe(0);
    expect(computeFollowScrollLeft(500, 100, 800, 1280)).toBe(100);
  });

  it('turns page forward when playhead reaches right margin', () => {
    // clientWidth=800, scrollWidth=2560, rightMargin=min(80, 120)=80 -> threshold=720, leftMargin=40
    const next = computeFollowScrollLeft(740, 0, 800, 2560);
    expect(next).toBe(700);
  });

  it('resets scrollLeft toward 0 when playhead loops back before scrollLeft', () => {
    expect(computeFollowScrollLeft(0, 480, 800, 1280)).toBe(0);
    expect(computeFollowScrollLeft(20, 480, 800, 1280)).toBe(0);
  });

  it('clamps to maxScroll near the end of an 8-bar track', () => {
    // scrollWidth=2560, clientWidth=800 -> maxScroll=1760
    expect(computeFollowScrollLeft(2480, 1000, 800, 2560)).toBe(1760);
  });

  it('does not scroll when content fits within viewport', () => {
    expect(computeFollowScrollLeft(700, 0, 1000, 800)).toBe(0);
  });
});
