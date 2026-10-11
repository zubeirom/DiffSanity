/**
 * Everything DiffSanity knows about GitHub's "Files changed" DOM lives in this module.
 * When GitHub changes its markup, this should be the only file that needs fixing.
 *
 * Two diff views are supported:
 * - classic (server-rendered): `.file-header[data-path][data-anchor]`
 * - React ("new files changed experience"): `h3 > a[href^="#diff-"]` inside `DiffFileHeader-module__*`
 */
import { extractRevisionsFromText, parseRenamedPath, toPullRequestFiles } from '../shared/githubContext';
import type {
  FileStatus,
  GitHubLineInfo,
  GoToLineResponse,
  OpenApprovalResponse,
  PullRequestFile,
  Revisions,
  Theme,
} from '../shared/types';

export interface FileHeader {
  /** Root of the file header; used for idempotency checks. */
  header: HTMLElement;
  /** Where the DiffSanity button is placed, relative to `target`. */
  target: HTMLElement;
  position: InsertPosition;
  path: string;
  oldPath?: string;
  status?: FileStatus;
  anchor?: string;
}

const CLASSIC_HEADER = '.file-header[data-path]';
const REACT_FILE_LINK = 'h3 a[href^="#diff-"]';
const REACT_HEADER = '[class*="DiffFileHeader-module__diff-file-header"]';
const SCREEN_READER_TEXT = '.sr-only';
/** Invisible direction marks (e.g. U+200E) GitHub wraps around file names so they read left to right. */
const BIDI_MARKS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** Text as the user sees it: without invisible direction marks, which are not part of a file path. */
function visibleText(text: string | null | undefined): string {
  return (text ?? '').replace(BIDI_MARKS, '').trim();
}

function anchorFromHref(link: HTMLAnchorElement | null): string | undefined {
  const hash = link?.getAttribute('href') ?? '';
  return hash.startsWith('#diff-') ? hash.slice(1) : undefined;
}

function classicHeader(header: HTMLElement): FileHeader | null {
  const target = header.querySelector<HTMLElement>('.file-info');
  const path = header.dataset.path;
  if (!target || !path) return null;

  const link = target.querySelector<HTMLAnchorElement>('a[href^="#diff-"]');
  const renamed = parseRenamedPath(visibleText(link?.getAttribute('title') ?? link?.textContent));
  const deleted = header.dataset.fileDeleted === 'true';
  return {
    header,
    target,
    position: 'beforeend',
    path,
    oldPath: renamed?.oldPath,
    status: deleted ? 'deleted' : renamed ? 'renamed' : undefined,
    anchor: header.dataset.anchor ?? anchorFromHref(link),
  };
}

function reactHeader(link: HTMLAnchorElement): FileHeader | null {
  const heading = link.closest('h3');
  if (!heading) return null;
  const header = heading.closest<HTMLElement>(REACT_HEADER) ?? heading.parentElement;
  if (!header) return null;

  // Only some headers have a `[data-file-path]` button (e.g. added files have none), so the link text is the fallback.
  // Renamed files show shortened names to sighted users and the full `old renamed to new` text to screen readers.
  const text = visibleText((link.querySelector(SCREEN_READER_TEXT) ?? link).textContent);
  const renamed = parseRenamedPath(text);
  const path = header.querySelector<HTMLElement>('[data-file-path]')?.dataset.filePath ?? renamed?.path ?? text;
  if (!path) return null;
  return {
    header,
    // The heading's parent holds the file name and GitHub's icon buttons (copy, expand); join that group.
    target: heading.parentElement ?? heading,
    position: heading.parentElement ? 'beforeend' : 'afterend',
    path,
    oldPath: renamed?.oldPath,
    status: renamed ? 'renamed' : undefined,
    anchor: anchorFromHref(link),
  };
}

/** Finds every changed-file header currently rendered on the page. */
export function findFileHeaders(root: ParentNode = document): FileHeader[] {
  const headers: FileHeader[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(CLASSIC_HEADER)) {
    const header = classicHeader(element);
    if (header) headers.push(header);
  }
  for (const link of root.querySelectorAll<HTMLAnchorElement>(REACT_FILE_LINK)) {
    if (link.closest(CLASSIC_HEADER)) continue;
    const header = reactHeader(link);
    if (header) headers.push(header);
  }
  return headers;
}

/*
 * The full file list. File headers alone are not enough: GitHub only renders some of them on large pull requests.
 * - React: the page's embedded JSON (`react-app.embeddedData`) lists every file under `diffSummaries`;
 *   the anchor is `diff-<pathDigest>`. Old paths of renames are only in the (partial) `diffContents`.
 * - classic: the `<file-tree>` sidebar lists every file, with a status octicon.
 * Old paths of renamed files come from the rendered headers when the list does not have them.
 */
const REACT_EMBEDDED_DATA = 'script[type="application/json"][data-target="react-app.embeddedData"]';
const CLASSIC_TREE_FILE = 'file-tree [data-tree-entry-type="file"]';
const CLASSIC_TREE_PATH = '[data-filterable-item-text]';
const REACT_CHANGE_TYPES: Record<string, FileStatus> = {
  ADDED: 'added',
  COPIED: 'added',
  REMOVED: 'deleted',
  DELETED: 'deleted',
  RENAMED: 'renamed',
  MODIFIED: 'modified',
  CHANGED: 'modified',
};
const CLASSIC_STATUS_ICONS: [string, FileStatus][] = [
  ['.octicon-diff-added', 'added'],
  ['.octicon-diff-removed', 'deleted'],
  ['.octicon-diff-renamed', 'renamed'],
  ['.octicon-diff-modified', 'modified'],
];

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function asObjects(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(asObject).filter((item): item is JsonObject => !!item) : [];
}

function reactFileList(doc: Document, pr: number): PullRequestFile[] | null {
  for (const script of doc.querySelectorAll(REACT_EMBEDDED_DATA)) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent ?? '');
    } catch {
      continue;
    }
    const route = asObject(asObject(asObject(data)?.payload)?.pullRequestsChangesRoute);
    const summaries = asObjects(route?.diffSummaries);
    // After client-side navigation the embedded data can belong to another pull request.
    if (!route || !summaries.length || asObject(route.pullRequest)?.number !== pr) continue;

    const oldPaths = new Map<unknown, unknown>();
    for (const content of asObjects(route.diffContents)) oldPaths.set(content.path, asObject(content.oldTreeEntry)?.path);
    return toPullRequestFiles(
      summaries.map((summary) => {
        const oldPath = oldPaths.get(summary.path);
        return {
          path: summary.path,
          oldPath: oldPath !== summary.path ? oldPath : undefined,
          status: REACT_CHANGE_TYPES[String(summary.changeType)],
          anchor: typeof summary.pathDigest === 'string' ? `diff-${summary.pathDigest}` : undefined,
          additions: summary.linesAdded,
          deletions: summary.linesDeleted,
        };
      }),
    );
  }
  return null;
}

function classicFileList(doc: Document): PullRequestFile[] | null {
  const entries = [...doc.querySelectorAll<HTMLElement>(CLASSIC_TREE_FILE)];
  if (!entries.length) return null;
  return entries.flatMap((entry): PullRequestFile[] => {
    const path = visibleText(entry.querySelector(CLASSIC_TREE_PATH)?.textContent);
    if (!path) return [];
    const icon = CLASSIC_STATUS_ICONS.find(([selector]) => entry.querySelector(selector));
    const status = entry.dataset.fileDeleted === 'true' ? 'deleted' : icon?.[1];
    return [{ path, status, anchor: anchorFromHref(entry.querySelector<HTMLAnchorElement>('a[href^="#diff-"]')) }];
  });
}

/**
 * Lists every changed file of pull request `pr`, in GitHub's order. Works on the live page and on
 * a fetched copy of it. Returns an empty list when the page does not show that pull request's files.
 */
export function extractPullRequestFiles(doc: Document, pr: number): PullRequestFile[] {
  const headers = findFileHeaders(doc);
  const list = reactFileList(doc, pr) ?? classicFileList(doc);
  if (!list) {
    return headers.map(({ path, oldPath, status, anchor }) => ({ path, oldPath, status, anchor }));
  }
  const byAnchor = new Map(headers.filter((header) => header.anchor).map((header) => [header.anchor, header]));
  const byPath = new Map(headers.map((header) => [header.path, header]));
  return list.map((file) => {
    const header = (file.anchor && byAnchor.get(file.anchor)) || byPath.get(file.path);
    if (!header) return file;
    return {
      ...file,
      oldPath: file.oldPath ?? header.oldPath,
      status: file.status ?? header.status,
      anchor: file.anchor ?? header.anchor,
    };
  });
}

/**
 * Scrolls the page to a file's diff. When GitHub has not rendered that file yet (long, virtualised lists), its own
 * file-tree link is followed instead, so GitHub loads it. Returns false when the file is not on the page.
 */
export function revealFile(anchor: string, doc: Document = document): boolean {
  if (!FILE_ANCHOR.test(anchor)) return false;
  const file = doc.getElementById(anchor);
  if (file) {
    file.scrollIntoView({ block: 'start' });
    return true;
  }
  const link = doc.querySelector<HTMLElement>(`a[href="#${anchor}"]`);
  link?.click();
  return !!link;
}

function merge(into: Revisions, from: Revisions): Revisions {
  return { baseSha: into.baseSha ?? from.baseSha, headSha: into.headSha ?? from.headSha };
}

/**
 * Finds the commits the visible diff is computed between. Cheap, targeted sources are tried first;
 * the full document HTML is only scanned when they are insufficient.
 */
export function extractPageRevisions(doc: Document = document): Revisions {
  let revisions: Revisions = {};
  const sources = [
    ...[...doc.querySelectorAll('[data-url*="commit_oid"], [src*="commit_oid"]')].map(
      (element) => `${element.getAttribute('data-url') ?? ''} ${element.getAttribute('src') ?? ''}`,
    ),
    ...[...doc.querySelectorAll('script[type="application/json"]')].map((script) => script.textContent ?? ''),
    ...[...doc.querySelectorAll('.file-header a[href*="/blob/"]')].slice(0, 1).map((link) => link.getAttribute('href') ?? ''),
  ];
  for (const source of sources) {
    revisions = merge(revisions, extractRevisionsFromText(source));
    if (revisions.baseSha && revisions.headSha) return revisions;
  }
  return merge(revisions, extractRevisionsFromText(doc.documentElement.innerHTML));
}

/** Resolves GitHub's effective colour mode (it may differ from the OS preference). */
export function resolveTheme(doc: Document = document): Theme {
  const root = doc.documentElement;
  const mode = root.dataset.colorMode;
  if (mode === 'dark' || mode === 'light') return mode;
  // `auto` (or unknown): follow the OS, as GitHub does.
  return doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/*
 * Diff lines. Both views identify a line by `<file anchor><key>`, where the key is `R<n>` (new file)
 * or `L<n>` (old file):
 * - React: on the code cell, `td[data-line-anchor="diff-…R12"]`; threads render inside it as `[data-marker-id]`.
 * - classic: on the line-number cells, `td[id="diff-…R12"]`; threads follow the line in a `tr.inline-comments` row.
 */
const LINE_KEY = /^[LR]\d+$/;
const FILE_ANCHOR = /^diff-[\w-]+$/;
const REACT_THREAD = '[data-marker-id]';
const CLASSIC_THREAD_ROW = 'tr.inline-comments';
const CLASSIC_THREAD = '[id^="review-thread-or-comment-id-"]';
const ADD_COMMENT_BUTTON = 'button[data-add-comment-button], .js-add-line-comment';
const ADD_COMMENT_TIMEOUT_MS = 1000;

function lineSelector(anchor: string): string {
  return `[data-line-anchor^="${anchor}"], td[id^="${anchor}"]`;
}

function lineKey(cell: Element, anchor: string): string | undefined {
  const id = cell.getAttribute('data-line-anchor') ?? cell.id;
  const key = id.startsWith(anchor) ? id.slice(anchor.length) : '';
  return LINE_KEY.test(key) ? key : undefined;
}

/** Prefers the new-file key, as GitHub does for unchanged lines. */
function rowKey(row: Element, anchor: string): string | undefined {
  const keys = [...row.querySelectorAll(lineSelector(anchor))].map((cell) => lineKey(cell, anchor)).filter(Boolean);
  return keys.find((key) => key!.startsWith('R')) ?? keys[0];
}

/** Reads which lines of a file GitHub renders and where its review threads are. */
export function readLineInfo(anchor: string, doc: Document = document): GitHubLineInfo {
  const info: GitHubLineInfo = {
    canComment: !!doc.querySelector('meta[name="user-login"]')?.getAttribute('content'),
    lines: [],
    threads: {},
  };
  if (!FILE_ANCHOR.test(anchor)) return info;
  const scope = doc.getElementById(anchor) ?? doc;

  const lines = new Set<string>();
  for (const cell of scope.querySelectorAll(lineSelector(anchor))) {
    const key = lineKey(cell, anchor);
    if (key) lines.add(key);
  }
  info.lines = [...lines];

  const addThreads = (key: string | undefined, count: number) => {
    if (key && count > 0) info.threads[key] = (info.threads[key] ?? 0) + count;
  };
  const reactThreads = new Map<Element, Set<string>>();
  for (const marker of scope.querySelectorAll(REACT_THREAD)) {
    const cell = marker.closest('[data-line-anchor]');
    if (!cell) continue;
    const ids = reactThreads.get(cell) ?? new Set<string>();
    ids.add(marker.getAttribute('data-marker-id')!);
    reactThreads.set(cell, ids);
  }
  for (const [cell, ids] of reactThreads) addThreads(lineKey(cell, anchor), ids.size);
  for (const row of scope.querySelectorAll(CLASSIC_THREAD_ROW)) {
    const line = row.previousElementSibling;
    if (line) addThreads(rowKey(line, anchor), Math.max(1, row.querySelectorAll(CLASSIC_THREAD).length));
  }
  return info;
}

function waitFor<T>(find: () => T | null, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const poll = () => {
      const found = find();
      if (found || Date.now() >= deadline) resolve(found);
      else setTimeout(poll, 50);
    };
    poll();
  });
}

/**
 * Scrolls a line into view and, when asked, opens GitHub's own comment box for it.
 * React only renders the "Add comment" button for the focused or hovered line, so the line is focused first.
 */
export async function revealLine(
  anchor: string,
  key: string,
  startComment: boolean,
  doc: Document = document,
): Promise<GoToLineResponse> {
  if (!FILE_ANCHOR.test(anchor) || !LINE_KEY.test(key)) return { found: false, commentBoxOpened: false };
  const id = anchor + key;
  const cell = doc.querySelector<HTMLElement>(`[data-line-anchor="${id}"]`) ?? doc.getElementById(id);
  const row = cell?.closest('tr');
  if (!cell || !row) return { found: false, commentBoxOpened: false };

  row.scrollIntoView({ block: 'center' });
  if (!startComment) return { found: true, commentBoxOpened: false };
  cell.focus({ preventScroll: true });
  const button = await waitFor(() => row.querySelector<HTMLElement>(ADD_COMMENT_BUTTON), ADD_COMMENT_TIMEOUT_MS);
  button?.click();
  return { found: true, commentBoxOpened: !!button };
}

/*
 * Reviews. GitHub's review box offers Comment / Approve / Request changes as radio buttons:
 * - React: `input[name="reviewEvent"]`, rendered only once the "Submit review" button opens the box.
 * - classic: `input[name="pull_request_review[event]"]` inside the "Review changes" `<details>` menu, always in the page.
 */
const APPROVE_RADIO = 'input[type="radio"][value="approve"]:is([name="reviewEvent"], [name="pull_request_review[event]"])';
const REACT_REVIEW_BUTTON = 'button[class*="ReviewMenuButton-module__ReviewMenuButton"]';
const REVIEW_BUTTON_TEXT = /^(submit review|review changes)/i;
const REVIEW_BOX_TIMEOUT_MS = 2000;

function findReviewButton(doc: Document): HTMLElement | undefined {
  return (
    doc.querySelector<HTMLElement>(REACT_REVIEW_BUTTON) ??
    [...doc.querySelectorAll<HTMLElement>('button, summary')].find((element) =>
      REVIEW_BUTTON_TEXT.test(visibleText(element.textContent)),
    )
  );
}

/**
 * Opens GitHub's own review box with "Approve" selected. It never submits: the user reads it and presses
 * GitHub's "Submit review". "Approve" stays unselected when GitHub disables it, e.g. for the pull request's author.
 */
export async function openApproval(doc: Document = document): Promise<OpenApprovalResponse> {
  let radio = doc.querySelector<HTMLInputElement>(APPROVE_RADIO);
  if (!radio) {
    const button = findReviewButton(doc);
    if (!button) return { opened: false, approveSelected: false };
    button.click();
    radio = await waitFor(() => doc.querySelector<HTMLInputElement>(APPROVE_RADIO), REVIEW_BOX_TIMEOUT_MS);
    if (!radio) return { opened: false, approveSelected: false };
  }
  const menu = radio.closest('details');
  if (menu) menu.open = true;
  if (!radio.disabled && !radio.checked) radio.click();
  return { opened: true, approveSelected: radio.checked };
}

/*
 * The toolbar row above the diffs, where GitHub's review button sits:
 * - React: the "Submit review" button; DiffSanity's button goes right before it.
 * - classic: `.pr-review-tools` at the end of `.pr-toolbar`. It holds "Review changes" and is empty when signed out.
 */
const CLASSIC_REVIEW_TOOLS = '.pr-toolbar .pr-review-tools';

/** Where to place DiffSanity's pull request button. */
export interface ToolbarSlot {
  target: HTMLElement;
  position: InsertPosition;
}

/** Finds the place next to GitHub's review button for DiffSanity's pull request button, or null when there is none. */
export function findToolbarSlot(doc: Document = document): ToolbarSlot | null {
  const tools = doc.querySelector<HTMLElement>(CLASSIC_REVIEW_TOOLS);
  if (tools) return { target: tools, position: 'afterbegin' };
  const button = findReviewButton(doc);
  return button ? { target: button, position: 'beforebegin' } : null;
}
