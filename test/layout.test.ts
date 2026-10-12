// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { computeFileDiff } from '../src/review/diff';
import { LAYOUT_STORAGE_KEY, loadLayout, parseLayout, saveLayout, splitRows } from '../src/review/layout';
import { minimapSpans } from '../src/review/minimap';
import { renderDiff } from '../src/review/renderer';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

// Line 2 is replaced by two lines, line 4 is deleted.
const DIFF = computeFileDiff({
  filename: 'a.ts',
  oldContent: 'one\ntwo\nthree\nfour\nfive\n',
  newContent: 'one\nTWO\nTWO more\nthree\nfive\n',
});
const NO_SOURCES = { old: null, new: null };

describe('splitRows', () => {
  it('shows unchanged lines on both sides and pairs replaced lines', () => {
    const rows = splitRows(DIFF.lines).map((row) => ({
      old: row.old === undefined ? undefined : DIFF.lines[row.old].content,
      new: row.new === undefined ? undefined : DIFF.lines[row.new].content,
    }));
    expect(rows).toEqual([
      { old: 'one', new: 'one' },
      { old: 'two', new: 'TWO' },
      { old: undefined, new: 'TWO more' },
      { old: 'three', new: 'three' },
      { old: 'four', new: undefined },
      { old: 'five', new: 'five' },
    ]);
  });

  it('places every line exactly once', () => {
    const placed = splitRows(DIFF.lines).flatMap((row) => {
      const sides = row.old === row.new ? [row.old] : [row.old, row.new];
      return sides.filter((index) => index !== undefined);
    });
    expect(placed.sort((a, b) => a! - b!)).toEqual(DIFF.lines.map((_, index) => index));
  });
});

describe('layout choice', () => {
  it('defaults to one column', () => {
    expect(parseLayout('split')).toBe('split');
    expect(parseLayout('sideways')).toBe('unified');
    expect(parseLayout(null)).toBe('unified');
  });

  it('remembers side by side, and forgets it when going back', () => {
    const storage = memoryStorage();
    expect(loadLayout(storage)).toBe('unified');
    saveLayout('split', storage);
    expect(storage.values.get(LAYOUT_STORAGE_KEY)).toBe('split');
    expect(loadLayout(storage)).toBe('split');
    saveLayout('unified', storage);
    expect(storage.values.has(LAYOUT_STORAGE_KEY)).toBe(false);
  });
});

describe('renderDiff', () => {
  it('draws one row per line in one column', () => {
    const scroller = document.createElement('div');
    const rendered = renderDiff(scroller, DIFF, NO_SOURCES);
    expect(rendered.rowCount).toBe(DIFF.lines.length);
    expect(scroller.querySelectorAll('.ds-line')).toHaveLength(DIFF.lines.length);
    expect(scroller.querySelector('.ds-pane')).toBeNull();
  });

  it('draws the old file on the left and the new file on the right', () => {
    const scroller = document.createElement('div');
    const rendered = renderDiff(scroller, DIFF, NO_SOURCES, 'split');
    const [left, right] = [...scroller.querySelectorAll('.ds-pane-content')];
    expect(rendered.rowCount).toBe(6);
    expect(left.querySelectorAll('.ds-line')).toHaveLength(6);
    expect(right.querySelectorAll('.ds-line')).toHaveLength(6);
    expect(left.querySelector('.ds-add')).toBeNull();
    expect(right.querySelector('.ds-del')).toBeNull();
    expect(left.querySelectorAll('.ds-filler')).toHaveLength(1);
    expect(right.querySelectorAll('.ds-filler')).toHaveLength(1);
    expect(scroller.querySelectorAll('.ds-hscroll-track')).toHaveLength(2);
  });

  it('finds lines by row and side in the split view', () => {
    const scroller = document.createElement('div');
    const rendered = renderDiff(scroller, DIFF, NO_SOURCES, 'split');
    const [left, right] = [...scroller.querySelectorAll('.ds-pane-content')];
    const deleted = DIFF.lines.findIndex((line) => line.content === 'four');
    const unchanged = DIFF.lines.findIndex((line) => line.content === 'three');
    expect(rendered.rowOfLine[deleted]).toBe(4);
    expect(left.contains(rendered.row(deleted)!)).toBe(true);
    expect(right.contains(rendered.row(unchanged)!)).toBe(true);

    // jsdom lays everything out at 0, so x < 0 is the left pane and rows are 20px from the top.
    expect(rendered.lineAt(-1, 4 * 20 + 5)?.index).toBe(deleted);
    expect(rendered.lineAt(0, 4 * 20 + 5)).toBeUndefined();
    expect(rendered.lineAt(0, 3 * 20)?.index).toBe(unchanged);
    expect(rendered.lineAt(0, 6 * 20)).toBeUndefined();
  });
});

describe('minimapSpans', () => {
  it('uses the whole width in one column', () => {
    expect(minimapSpans('deletion', false, 100)).toEqual([[0, 100]]);
  });

  it('puts old lines left and new lines right side by side', () => {
    expect(minimapSpans('deletion', true, 100)).toEqual([[0, 50]]);
    expect(minimapSpans('addition', true, 100)).toEqual([[50, 50]]);
    expect(minimapSpans('context', true, 100)).toEqual([
      [0, 50],
      [50, 50],
    ]);
  });
});
