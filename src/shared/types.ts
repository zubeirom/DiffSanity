/** Change status of a file within a pull request. */
export type FileStatus = 'added' | 'deleted' | 'renamed' | 'modified';

export type Theme = 'light' | 'dark';

/** Everything the review page needs to reconstruct the review of one file. */
export interface ReviewRequest {
  /** Origin of the GitHub instance, e.g. `https://github.com`. Explicit so GitHub Enterprise can be added later. */
  origin: string;
  owner: string;
  repo: string;
  pr: number;
  /** Path of the file at the head revision. */
  path: string;
  /** Path at the base revision when the file was renamed. */
  oldPath?: string;
  status?: FileStatus;
  /** Commit the diff starts from (merge base, or the start of a selected commit range). */
  baseSha?: string;
  /** Commit the diff ends at. */
  headSha?: string;
  /** GitHub's `diff-<hash>` anchor of the file, used to link back to it. */
  anchor?: string;
  theme?: Theme;
  /** Tab the review was opened from; used to return to it and as a fetch fallback. */
  sourceTabId?: number;
}

export interface Revisions {
  baseSha?: string;
  headSha?: string;
}

export type DiffLineType = 'context' | 'addition' | 'deletion';

export interface DiffLine {
  type: DiffLineType;
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface FileDiff {
  filename: string;
  oldFilename?: string;
  oldContent: string;
  newContent: string;
  lines: DiffLine[];
  additions: number;
  deletions: number;
  /** True when the diff algorithm gave up and the file is shown as fully replaced. */
  approximate: boolean;
}

/** Messages exchanged between the content script, background worker and review page. */
export type Message =
  | { type: 'diffsanity:open'; request: ReviewRequest; background: boolean }
  | { type: 'diffsanity:reviewUrl'; request: ReviewRequest }
  | { type: 'diffsanity:fetchText'; url: string };

/** `postMessage` from the review page, when shown in a modal, to the GitHub page hosting it. */
export type FrameMessage =
  | { type: 'diffsanity:frame'; action: 'close' }
  | { type: 'diffsanity:frame'; action: 'maximize'; maximized: boolean };

export interface FetchTextResponse {
  ok: boolean;
  status: number;
  text?: string;
}
