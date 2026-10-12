import type { FileStatus } from '../shared/types';

/** Plain words for a file's change status, shown in the header pill and sidebar tooltips. */
export const STATUS_LABELS: Record<FileStatus, string> = {
  added: 'New file',
  deleted: 'Deleted',
  renamed: 'Renamed',
  modified: 'Modified',
};

/** One-letter status shown next to each file in the sidebar, as in GitHub and VS Code. */
export const STATUS_LETTERS: Record<FileStatus, string> = { added: 'A', deleted: 'D', renamed: 'R', modified: 'M' };
