import { describe, expect, it } from 'vitest';
import { mapLineInfo } from '../src/review/comments';
import type { DiffLine } from '../src/shared/types';

const LINES: DiffLine[] = [
  { type: 'context', oldLineNumber: 1, newLineNumber: 1, content: 'a' },
  { type: 'deletion', oldLineNumber: 2, content: 'b' },
  { type: 'addition', newLineNumber: 2, content: 'B' },
  { type: 'context', oldLineNumber: 3, newLineNumber: 3, content: 'c' },
  { type: 'context', oldLineNumber: 4, newLineNumber: 4, content: 'd' },
];

describe('mapLineInfo', () => {
  it('maps the lines GitHub renders to diff line indices, preferring new-file keys', () => {
    const targets = mapLineInfo(LINES, { canComment: true, lines: ['L1', 'R1', 'L2', 'R2', 'L3'], threads: {} });
    expect(targets.canComment).toBe(true);
    expect([...targets.keys]).toEqual([
      [0, 'R1'],
      [1, 'L2'],
      [2, 'R2'],
      [3, 'L3'],
    ]);
  });

  it('leaves lines outside GitHub’s diff without a target', () => {
    const targets = mapLineInfo(LINES, { canComment: true, lines: ['R2'], threads: {} });
    expect([...targets.keys.keys()]).toEqual([2]);
  });

  it('does not confuse old and new line numbers', () => {
    // R2 is the added line, not the deleted old line 2.
    const targets = mapLineInfo(LINES, { canComment: false, lines: ['R2'], threads: { R2: 1 } });
    expect([...targets.threads]).toEqual([[2, 1]]);
  });

  it('places threads by either key and ignores threads on lines it cannot link to', () => {
    const targets = mapLineInfo(LINES, {
      canComment: false,
      lines: ['R1', 'R3', 'L3', 'R4'],
      threads: { R3: 1, L3: 2, R4: 1, R99: 5 },
    });
    expect([...targets.threads]).toEqual([
      [3, 3],
      [4, 1],
    ]);
  });
});
