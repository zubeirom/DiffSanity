import { diffArrays } from 'diff';
import type { DiffLine, FileDiff } from '../shared/types';

/** A contiguous run of added/deleted lines, as indexes into `FileDiff.lines` (end exclusive). */
export interface ChangeBlock {
  start: number;
  end: number;
}

export interface DiffInput {
  filename: string;
  oldFilename?: string;
  oldContent: string;
  newContent: string;
}

/** Above this, the diff falls back to "everything replaced" rather than freezing the page. */
const DEFAULT_TIMEOUT_MS = 3000;

/** Splits file content into lines, normalising line endings and ignoring the final newline. */
export function splitLines(content: string): string[] {
  if (!content) return [];
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function computeFileDiff(input: DiffInput, timeoutMs = DEFAULT_TIMEOUT_MS): FileDiff {
  const oldLines = splitLines(input.oldContent);
  const newLines = splitLines(input.newContent);
  const changes = diffArrays(oldLines, newLines, { timeout: timeoutMs });

  const lines: DiffLine[] = [];
  let oldNumber = 1;
  let newNumber = 1;
  let pendingDeletions: string[] = [];
  let pendingAdditions: string[] = [];

  // Within one change, always show deletions before additions (like GitHub / Azure DevOps).
  const flush = () => {
    for (const content of pendingDeletions) lines.push({ type: 'deletion', oldLineNumber: oldNumber++, content });
    for (const content of pendingAdditions) lines.push({ type: 'addition', newLineNumber: newNumber++, content });
    pendingDeletions = [];
    pendingAdditions = [];
  };

  if (!changes) {
    pendingDeletions = oldLines;
    pendingAdditions = newLines;
  } else {
    for (const change of changes) {
      if (change.removed) pendingDeletions.push(...change.value);
      else if (change.added) pendingAdditions.push(...change.value);
      else {
        flush();
        for (const content of change.value) {
          lines.push({ type: 'context', oldLineNumber: oldNumber++, newLineNumber: newNumber++, content });
        }
      }
    }
  }
  flush();

  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.type === 'addition') additions++;
    else if (line.type === 'deletion') deletions++;
  }

  return {
    filename: input.filename,
    oldFilename: input.oldFilename,
    oldContent: input.oldContent,
    newContent: input.newContent,
    lines,
    additions,
    deletions,
    approximate: !changes,
  };
}

export function findChangeBlocks(lines: readonly DiffLine[]): ChangeBlock[] {
  const blocks: ChangeBlock[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].type === 'context') continue;
    const start = index;
    while (index + 1 < lines.length && lines[index + 1].type !== 'context') index++;
    blocks.push({ start, end: index + 1 });
  }
  return blocks;
}
