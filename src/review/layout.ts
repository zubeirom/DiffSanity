import type { DiffLine } from '../shared/types';

/** How a diff is shown: one column (the default), or the old and new file side by side. */
export type DiffLayout = 'unified' | 'split';

export const LAYOUT_STORAGE_KEY = 'diffsanity.layout';

/** One row of the split view, as indexes into the diff's lines. Either side can be empty. */
export interface SplitRow {
  old?: number;
  new?: number;
}

/**
 * Pairs diff lines into split-view rows. Unchanged lines appear on both sides. Within a change,
 * deleted lines sit next to the added lines that replace them, and the shorter side is padded with empty rows.
 */
export function splitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index].type === 'context') {
      rows.push({ old: index, new: index });
      index++;
      continue;
    }
    const deletions: number[] = [];
    const additions: number[] = [];
    for (; index < lines.length && lines[index].type !== 'context'; index++) {
      (lines[index].type === 'deletion' ? deletions : additions).push(index);
    }
    for (let pair = 0; pair < Math.max(deletions.length, additions.length); pair++) {
      const row: SplitRow = {};
      if (pair < deletions.length) row.old = deletions[pair];
      if (pair < additions.length) row.new = additions[pair];
      rows.push(row);
    }
  }
  return rows;
}

export function parseLayout(value: string | null | undefined): DiffLayout {
  return value === 'split' ? 'split' : 'unified';
}

/** Like the theme, the layout is kept in the extension's localStorage and shared by all review tabs. */
export function loadLayout(storage: Pick<Storage, 'getItem'> = localStorage): DiffLayout {
  try {
    return parseLayout(storage.getItem(LAYOUT_STORAGE_KEY));
  } catch {
    return 'unified';
  }
}

export function saveLayout(layout: DiffLayout, storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage): void {
  try {
    if (layout === 'unified') storage.removeItem(LAYOUT_STORAGE_KEY);
    else storage.setItem(LAYOUT_STORAGE_KEY, layout);
  } catch {
    // Storage can be unavailable; the choice then only lasts for this tab.
  }
}
