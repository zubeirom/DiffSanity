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
  /** Origin of the GitHub instance: `https://github.com` or a GHE.com enterprise such as `https://octocorp.ghe.com`. */
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

/** One changed file of a pull request, as GitHub lists it on the "Files changed" tab. */
export interface PullRequestFile {
  /** Path at the head revision. */
  path: string;
  /** Path at the base revision when the file was renamed. */
  oldPath?: string;
  status?: FileStatus;
  /** GitHub's `diff-<hash>` anchor of the file. */
  anchor?: string;
  additions?: number;
  deletions?: number;
}

/** A pull request's changed files, as read from one GitHub page. */
export interface PullRequestFileList {
  files: PullRequestFile[];
  /**
   * True when the page held GitHub's full file list. False when only the file headers it rendered were found
   * (e.g. after client-side navigation): files can be missing, and so can the status of added or modified ones.
   */
  complete: boolean;
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

export interface OpenApprovalResponse {
  /** True when GitHub's review box is open. */
  opened: boolean;
  /** True when "Approve" is selected in it; GitHub disables it e.g. for the pull request's author. */
  approveSelected: boolean;
}

/** Messages exchanged between the content script, background worker and review page. */
export type Message =
  | { type: 'diffsanity:open'; request: ReviewRequest; background: boolean }
  /** `HEAD` only asks whether the URL exists, without downloading it. */
  | { type: 'diffsanity:fetchText'; url: string; method?: FetchMethod }
  | { type: 'diffsanity:lineInfo'; pullRequest: PullRequestRef; anchor: string }
  | { type: 'diffsanity:goToLine'; pullRequest: PullRequestRef; anchor: string; lineKey: string; startComment: boolean }
  /** Answered with the pull request's `PullRequestFileList` (no files when the tab shows something else). */
  | { type: 'diffsanity:listFiles'; pullRequest: PullRequestRef }
  /** Scrolls the GitHub tab to a file, so it is where the user left off and GitHub loads its diff. */
  | { type: 'diffsanity:revealFile'; pullRequest: PullRequestRef; anchor: string }
  /** Opens GitHub's review box with "Approve" selected; answered with `OpenApprovalResponse`. The user submits it. */
  | { type: 'diffsanity:openApproval'; pullRequest: PullRequestRef };

export type FetchMethod = 'GET' | 'HEAD';

export interface FetchTextResponse {
  ok: boolean;
  status: number;
  text?: string;
}
