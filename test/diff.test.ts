import { describe, expect, it } from 'vitest';
import { computeFileDiff, findChangeBlocks, splitLines } from '../src/review/diff';

const diff = (oldContent: string, newContent: string) =>
  computeFileDiff({ filename: 'a.ts', oldContent, newContent });

describe('splitLines', () => {
  it('normalises line endings and ignores the final newline', () => {
    expect(splitLines('a\r\nb\rc\n')).toEqual(['a', 'b', 'c']);
    expect(splitLines('a\n\n')).toEqual(['a', '']);
    expect(splitLines('')).toEqual([]);
  });
});

describe('computeFileDiff', () => {
  it('numbers lines on both sides', () => {
    const result = diff('a\nb\nc\n', 'a\nB\nc\nd\n');
    expect(result.lines).toEqual([
      { type: 'context', oldLineNumber: 1, newLineNumber: 1, content: 'a' },
      { type: 'deletion', oldLineNumber: 2, content: 'b' },
      { type: 'addition', newLineNumber: 2, content: 'B' },
      { type: 'context', oldLineNumber: 3, newLineNumber: 3, content: 'c' },
      { type: 'addition', newLineNumber: 4, content: 'd' },
    ]);
    expect(result).toMatchObject({ additions: 2, deletions: 1, approximate: false });
  });

  it('shows deletions before additions within a change', () => {
    const types = diff('x\n1\n2\ny\n', 'x\n3\n4\ny\n').lines.map((line) => line.type);
    expect(types).toEqual(['context', 'deletion', 'deletion', 'addition', 'addition', 'context']);
  });

  it('handles added, deleted and empty files', () => {
    expect(diff('', 'a\nb\n')).toMatchObject({ additions: 2, deletions: 0 });
    expect(diff('a\nb\n', '')).toMatchObject({ additions: 0, deletions: 2 });
    expect(diff('', '').lines).toEqual([]);
  });

  it('treats CRLF-only changes as unchanged', () => {
    expect(diff('a\r\nb\r\n', 'a\nb\n')).toMatchObject({ additions: 0, deletions: 0 });
  });

  it('falls back to a full replacement when the diff times out', () => {
    const oldContent = Array.from({ length: 4000 }, (_, i) => `old ${i}`).join('\n');
    const newContent = Array.from({ length: 4000 }, (_, i) => (i % 2 ? `new ${i}` : `old ${i}`)).join('\n');
    const result = computeFileDiff({ filename: 'a', oldContent, newContent }, 0);
    expect(result.approximate).toBe(true);
    expect(result.deletions).toBe(4000);
    expect(result.additions).toBe(4000);
  });
});

describe('findChangeBlocks', () => {
  it('groups consecutive changed lines', () => {
    const { lines } = diff('a\nb\nc\nd\ne\n', 'a\nB\nc\nD\nE\n');
    expect(findChangeBlocks(lines)).toEqual([
      { start: 1, end: 3 },
      { start: 4, end: 8 },
    ]);
  });
});
