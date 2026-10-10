/**
 * Everything DiffSanity knows about GitHub's "Files changed" DOM lives in this module.
 * When GitHub changes its markup, this should be the only file that needs fixing.
 *
 * Two diff views are supported:
 * - classic (server-rendered): `.file-header[data-path][data-anchor]`
 * - React ("new files changed experience"): `h3 > a[href^="#diff-"]` inside `DiffFileHeader-module__*`
 */
import { extractRevisionsFromText, parseRenamedPath } from '../shared/githubContext';
import type { FileStatus, Revisions, Theme } from '../shared/types';

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

function anchorFromHref(link: HTMLAnchorElement | null): string | undefined {
  const hash = link?.getAttribute('href') ?? '';
  return hash.startsWith('#diff-') ? hash.slice(1) : undefined;
}

function classicHeader(header: HTMLElement): FileHeader | null {
  const target = header.querySelector<HTMLElement>('.file-info');
  const path = header.dataset.path;
  if (!target || !path) return null;

  const link = target.querySelector<HTMLAnchorElement>('a[href^="#diff-"]');
  const renamed = parseRenamedPath(link?.getAttribute('title') ?? link?.textContent ?? '');
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

  const renamed = parseRenamedPath(link.textContent ?? '');
  const path = header.querySelector<HTMLElement>('[data-file-path]')?.dataset.filePath ?? renamed?.path ?? link.textContent?.trim();
  if (!path) return null;
  return {
    header,
    target: heading,
    position: 'afterend',
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
