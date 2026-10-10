/** Change status of a file within a pull request. */
export type FileStatus = 'added' | 'deleted' | 'renamed' | 'modified';

export type Theme = 'light' | 'dark';

export interface PullRequestRef {
  owner: string;
  repo: string;
  pr: number;
}

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

/**
 * What the GitHub tab shows of one file. Lines are identified by GitHub's keys:
 * `R12` is line 12 of the new file, `L7` is line 7 of the old file.
 */
export interface GitHubLineInfo {
  /** True when the signed-in user can add review comments on the page. */
  canComment: boolean;
  /** Keys of the lines GitHub currently renders; only these can be commented on. */
  lines: string[];
  /** Number of review threads attached to each line key. */
  threads: Record<string, number>;
}

export interface GoToLineResponse {
  /** False when the line is not rendered on the GitHub tab. */
  found: boolean;
  /** True when GitHub's comment box was opened. */
  commentBoxOpened: boolean;
}

/** Messages exchanged between the content script, background worker and review page. */
export type Message =
  | { type: 'diffsanity:open'; request: ReviewRequest; background: boolean }
  | { type: 'diffsanity:fetchText'; url: string }
  | { type: 'diffsanity:lineInfo'; pullRequest: PullRequestRef; anchor: string }
  | { type: 'diffsanity:goToLine'; pullRequest: PullRequestRef; anchor: string; lineKey: string; startComment: boolean };

export interface FetchTextResponse {
  ok: boolean;
  status: number;
  text?: string;
}
