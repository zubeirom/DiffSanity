import type { FileStatus, PullRequestFile, PullRequestFileList, PullRequestRef, ReviewRequest, Revisions, Theme } from './types';

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

/** GitHub writes renames as `old/path → new/path`, or `old/path renamed to new/path` for screen readers. */
const RENAME_SEPARATOR = /\s*→\s*|\s+renamed to\s+/;

/** Splits GitHub's rename notation into the old and new path. */
export function parseRenamedPath(text: string): { oldPath: string; path: string } | null {
  const parts = text.split(RENAME_SEPARATOR).map((part) => part.trim());
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

function isStatus(value: unknown): value is FileStatus {
  return STATUSES.includes(value as FileStatus);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function optionalCount(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : undefined;
}

/** Validates a file list received from another part of the extension, dropping malformed entries. */
export function toPullRequestFiles(value: unknown): PullRequestFile[] {
  if (!Array.isArray(value)) return [];
  const files: PullRequestFile[] = [];
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const path = optionalString(item.path);
    if (!path) continue;
    files.push({
      path,
      oldPath: optionalString(item.oldPath),
      status: isStatus(item.status) ? item.status : undefined,
      anchor: optionalString(item.anchor),
      additions: optionalCount(item.additions),
      deletions: optionalCount(item.deletions),
    });
  }
  return files;
}

/** Validates a file list received from another part of the extension. */
export function toPullRequestFileList(value: unknown): PullRequestFileList {
  const list = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return { files: toPullRequestFiles(list.files), complete: list.complete === true };
}

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
  const status = params.get('status');
  const theme = params.get('theme');
  const sourceTabId = Number(params.get('sourceTabId'));

  return {
    origin,
    owner,
    repo,
    pr,
    path,
    oldPath: params.get('oldPath') ?? undefined,
    status: isStatus(status) ? status : undefined,
    baseSha: optionalSha('baseSha'),
    headSha: optionalSha('headSha'),
    anchor: params.get('anchor') ?? undefined,
    theme: theme === 'dark' || theme === 'light' ? (theme as Theme) : undefined,
    sourceTabId: Number.isInteger(sourceTabId) && sourceTabId > 0 ? sourceTabId : undefined,
  };
}

/** GitHub Enterprise Cloud with data residency: one subdomain per enterprise, e.g. `https://octocorp.ghe.com`. */
const GHE_COM_ORIGIN = /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.ghe\.com$/;

/**
 * Origins DiffSanity runs on and fetches from: github.com and GHE.com. Keep in sync with the manifest.
 * Self-hosted GitHub Enterprise Server would need runtime host permissions, as its domains are not known up front.
 */
export function isAllowedOrigin(origin: string): boolean {
  return origin === 'https://github.com' || GHE_COM_ORIGIN.test(origin);
}
