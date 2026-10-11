import { describe, expect, it } from 'vitest';
import { diffstatBlocks } from '../src/review/diffstat';

describe('diffstatBlocks', () => {
  it('is neutral when nothing changed', () => {
    expect(diffstatBlocks(0, 0)).toEqual(['neutral', 'neutral', 'neutral', 'neutral', 'neutral']);
  });

  it('splits blocks in proportion to the changes', () => {
    expect(diffstatBlocks(60, 40)).toEqual(['addition', 'addition', 'addition', 'deletion', 'deletion']);
    expect(diffstatBlocks(10, 0)).toEqual(Array(5).fill('addition'));
    expect(diffstatBlocks(0, 3)).toEqual(Array(5).fill('deletion'));
  });

  it('keeps at least one block for a small side', () => {
    expect(diffstatBlocks(1, 500)).toEqual(['addition', 'deletion', 'deletion', 'deletion', 'deletion']);
    expect(diffstatBlocks(500, 1)).toEqual(['addition', 'addition', 'addition', 'addition', 'deletion']);
  });
});
