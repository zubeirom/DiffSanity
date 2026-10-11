/** What a block of the diffstat bar shows. */
export type DiffstatBlock = 'addition' | 'deletion' | 'neutral';

/** Number of blocks in the bar, as on GitHub. */
export const DIFFSTAT_BLOCKS = 5;

/**
 * Splits the diffstat bar between additions and deletions in proportion to the changed lines.
 * A side with any changes always gets at least one block, so a small change never disappears.
 */
export function diffstatBlocks(additions: number, deletions: number): DiffstatBlock[] {
  const total = additions + deletions;
  if (total <= 0) return Array<DiffstatBlock>(DIFFSTAT_BLOCKS).fill('neutral');
  let added = Math.round((additions / total) * DIFFSTAT_BLOCKS);
  if (additions > 0) added = Math.max(added, 1);
  if (deletions > 0) added = Math.min(added, DIFFSTAT_BLOCKS - 1);
  return Array.from({ length: DIFFSTAT_BLOCKS }, (_, index) => (index < added ? 'addition' : 'deletion'));
}
