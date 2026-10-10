import type { FileStatus, PullRequestRef, ReviewRequest, Revisions, Theme } from './types';

const PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/([^/]+))?/;
const FILES_TABS = new Set(['files', 'changes']);
const SHA = '[0-9a-f]{40}';

/** Parses `/{owner}/{repo}/pull/{number}/...` from a URL. */
export function parsePullRequestUrl(url: string | URL): PullRequestRef | null {
  const match = PULL_PATH.exec(new URL(url).pathname);
  if (!match) return null;
  return { owner: match[1], repo: match[2], pr: Number(match[3]) };
}

/** True for a PR's "Files changed" tab (classic `/files` or the newer `/changes` route). */
export function isPullRequestFilesPage(url: string | URL): boolean {
  const match = PULL_PATH.exec(new URL(url).pathname);
  return !!match && !!match[4] && FILES_TABS.has(match[4]);
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[1];
  }
  return undefined;
}

// Ordered by preference. `start_commit_oid` reflects a selected commit range, `base_commit_oid` the merge base.
// The base branch tip (`baseRefOid`) is deliberately not used: it is not what the PR diff is computed against.
const BASE_PATTERNS = [
  new RegExp(`start_commit_oid=(${SHA})\\b`),
  new RegExp(`base_commit_oid=(${SHA})\\b`),
  new RegExp(`"(?:startOid|startCommitOid|baseCommitOid|mergeBaseOid|baseOid)"\\s*:\\s*"(${SHA})"`),
  new RegExp(`base_sha=(${SHA})\\b`),
];
const HEAD_PATTERNS = [
  new RegExp(`end_commit_oid=(${SHA})\\b`),
  new RegExp(`"(?:endOid|endCommitOid|headCommitOid|headOid|headRefOid)"\\s*:\\s*"(${SHA})"`),
  new RegExp(`/blob/(${SHA})/`),
];

/** Extracts the diff's base/head commits from GitHub page HTML, attribute values or embedded JSON. */
export function extractRevisionsFromText(text: string): Revisions {
  return { baseSha: firstMatch(text, BASE_PATTERNS), headSha: firstMatch(text, HEAD_PATTERNS) };
}

/** Splits GitHub's rename notation `old/path → new/path`. */
export function parseRenamedPath(text: string): { oldPath: string; path: string } | null {
  const parts = text.split('→').map((part) => part.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { oldPath: parts[0], path: parts[1] };
}

/** URL of a file's raw contents at a revision. GitHub redirects it to an authorised raw host. */
export function rawFileUrl(origin: string, owner: string, repo: string, sha: string, path: string): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `${origin}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/raw/${sha}/${encodedPath}`;
}

export function pullRequestFilesUrl(request: Pick<ReviewRequest, 'origin' | 'owner' | 'repo' | 'pr' | 'anchor'>): string {
  const base = `${request.origin}/${encodeURIComponent(request.owner)}/${encodeURIComponent(request.repo)}/pull/${request.pr}/files`;
  return request.anchor ? `${base}#${request.anchor}` : base;
}

const STATUSES: readonly FileStatus[] = ['added', 'deleted', 'renamed', 'modified'];
const SHA_ONLY = new RegExp(`^${SHA}$`);

/** Serialises a review request into query parameters for the review page. */
export function toReviewSearch(request: ReviewRequest): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(request)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

/** Parses and validates review page query parameters. Returns null when required fields are missing. */
export function fromReviewSearch(search: string): ReviewRequest | null {
  const params = new URLSearchParams(search);
  const origin = params.get('origin');
  const owner = params.get('owner');
  const repo = params.get('repo');
  const pr = Number(params.get('pr'));
  const path = params.get('path');
  if (!origin || !owner || !repo || !path || !Number.isInteger(pr) || pr <= 0) return null;
  if (!isAllowedOrigin(origin)) return null;

  const optionalSha = (key: string) => {
    const value = params.get(key);
    return value && SHA_ONLY.test(value) ? value : undefined;
  };
  const status = params.get('status') as FileStatus | null;
  const theme = params.get('theme');
  const sourceTabId = Number(params.get('sourceTabId'));

  return {
    origin,
    owner,
    repo,
    pr,
    path,
    oldPath: params.get('oldPath') ?? undefined,
    status: status && STATUSES.includes(status) ? status : undefined,
    baseSha: optionalSha('baseSha'),
    headSha: optionalSha('headSha'),
    anchor: params.get('anchor') ?? undefined,
    theme: theme === 'dark' || theme === 'light' ? (theme as Theme) : undefined,
    sourceTabId: Number.isInteger(sourceTabId) && sourceTabId > 0 ? sourceTabId : undefined,
  };
}

/** Origins DiffSanity is allowed to fetch from. Extend here (and in the manifest) for GitHub Enterprise. */
export function isAllowedOrigin(origin: string): boolean {
  return origin === 'https://github.com';
}
