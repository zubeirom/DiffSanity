import { describe, expect, it } from 'vitest';
import { minimapScale, scrollTopForMinimapY, viewportRect } from '../src/review/minimap';

const LINE = 20;

describe('minimapScale', () => {
  it('fits long files into the track', () => {
    expect(minimapScale(1000, 500)).toBe(0.5);
  });

  it('caps the scale for short files', () => {
    expect(minimapScale(10, 500)).toBe(3);
    expect(minimapScale(0, 500)).toBe(3);
  });
});

describe('viewportRect', () => {
  it('starts at the top', () => {
    expect(viewportRect(0, 400, LINE, 0.5, 1000)).toEqual({ top: 0, height: 10 });
  });

  it('reaches exactly the bottom when the file is scrolled to the end', () => {
    const scale = 0.5;
    const lines = 1000;
    const clientHeight = 400;
    const maxScroll = lines * LINE - clientHeight;
    const rect = viewportRect(maxScroll, clientHeight, LINE, scale, lines);
    expect(rect.top + rect.height).toBeCloseTo(lines * scale);
  });

  it('keeps a minimum height for huge files', () => {
    expect(viewportRect(0, 400, LINE, 0.01, 100000).height).toBe(6);
  });
});

describe('scrollTopForMinimapY', () => {
  it('inverts the viewport mapping', () => {
    const scale = 0.5;
    const top = viewportRect(4000, 400, LINE, scale, 1000).top;
    expect(scrollTopForMinimapY(top, LINE, scale)).toBe(4000);
    expect(scrollTopForMinimapY(-5, LINE, scale)).toBe(0);
  });
});
