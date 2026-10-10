import { fromReviewSearch, pullRequestFilesUrl } from '../shared/githubContext';
import type { FileStatus, FrameMessage, Message, ReviewRequest } from '../shared/types';
import { computeFileDiff, findChangeBlocks, splitLines } from './diff';
import { loadFileContents, LoadError } from './fileSource';
import { Minimap } from './minimap';
import { LINE_HEIGHT, renderDiff } from './renderer';
import { highlightLines } from './syntax';

/** Lines of context kept above the first change when the file opens. */
const CONTEXT_ABOVE_FIRST_CHANGE = 4;

/** True when shown in the modal on the GitHub page rather than in its own tab. */
const embedded = window.parent !== window;

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector} in review.html`);
  return found;
}

function applyTheme(request: ReviewRequest | null, onChange: () => void): void {
  const root = document.documentElement;
  if (request?.theme) {
    root.dataset.theme = request.theme;
    return;
  }
  const query = matchMedia('(prefers-color-scheme: dark)');
  const update = () => {
    root.dataset.theme = query.matches ? 'dark' : 'light';
    onChange();
  };
  query.addEventListener('change', update);
  root.dataset.theme = query.matches ? 'dark' : 'light';
}

/** Returns to the GitHub tab DiffSanity was opened from, falling back to navigating this tab. */
async function backToGitHub(request: ReviewRequest): Promise<void> {
  if (request.sourceTabId !== undefined) {
    try {
      const source = await chrome.tabs.update(request.sourceTabId, { active: true });
      if (source) {
        await chrome.windows.update(source.windowId, { focused: true });
        const current = await chrome.tabs.getCurrent();
        if (current?.id !== undefined) await chrome.tabs.remove(current.id);
        return;
      }
    } catch {
      // The source tab is gone.
    }
  }
  location.href = pullRequestFilesUrl(request);
}

/** Modal toolbar: full screen toggle, open in a tab, close. The GitHub page owns the dialog itself. */
function setUpModalActions(request: ReviewRequest): void {
  const post = (message: FrameMessage) => window.parent.postMessage(message, request.origin);
  const close = () => post({ type: 'diffsanity:frame', action: 'close' });

  // GitHub refuses to be framed, so links must navigate the GitHub tab rather than this frame.
  const base = document.createElement('base');
  base.target = '_top';
  document.head.append(base);

  element('#ds-back').hidden = true;
  element('#ds-window-actions').hidden = false;

  const maximize = element<HTMLButtonElement>('#ds-maximize');
  maximize.addEventListener('click', () => {
    const maximized = maximize.getAttribute('aria-pressed') !== 'true';
    maximize.setAttribute('aria-pressed', String(maximized));
    maximize.title = maximized ? 'Exit full screen' : 'Full screen';
    maximize.setAttribute('aria-label', maximize.title);
    post({ type: 'diffsanity:frame', action: 'maximize', maximized });
  });

  element('#ds-new-tab').addEventListener('click', () => {
    const message: Message = { type: 'diffsanity:open', request, background: false };
    chrome.runtime.sendMessage(message).then(close, (error: unknown) => console.error('[DiffSanity]', error));
  });

  element('#ds-close').addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented) close();
  });
}

function setUpBackLink(request: ReviewRequest): void {
  const back = element<HTMLAnchorElement>('#ds-back');
  back.href = pullRequestFilesUrl(request);
  back.addEventListener('click', (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    void backToGitHub(request);
  });
}

function renderHeader(request: ReviewRequest): void {
  if (embedded) setUpModalActions(request);
  else setUpBackLink(request);

  const slash = request.path.lastIndexOf('/');
  element('#ds-dir').textContent = slash >= 0 ? request.path.slice(0, slash + 1) : '';
  element('#ds-name').textContent = request.path.slice(slash + 1);
  if (request.oldPath && request.oldPath !== request.path) {
    const renamed = element('#ds-renamed');
    renamed.textContent = `renamed from ${request.oldPath}`;
    renamed.hidden = false;
  }

  const pr = element<HTMLAnchorElement>('#ds-pr');
  pr.textContent = `${request.owner}/${request.repo} #${request.pr}`;
  pr.href = pullRequestFilesUrl({ ...request, anchor: undefined });
  document.title = `${request.path.slice(slash + 1)} · DiffSanity`;
}

function renderStats(additions: number, deletions: number, status: FileStatus, base: string, head: string): void {
  element('#ds-additions').textContent = `+${additions}`;
  element('#ds-deletions').textContent = `−${deletions}`;
  if (status === 'added' || status === 'deleted') {
    const badge = element('#ds-status');
    badge.textContent = status;
    badge.hidden = false;
  }
  element('#ds-revisions').textContent = `${base.slice(0, 7)} → ${head.slice(0, 7)}`;
  element('#ds-revisions').title = `Base ${base}\nHead ${head}`;
}

function showMessage(text: string, kind: 'loading' | 'error' | 'info'): void {
  const message = element('#ds-message');
  message.textContent = text;
  message.dataset.kind = kind;
  message.hidden = false;
}

async function main(): Promise<void> {
  const request = fromReviewSearch(location.search);
  let minimap: Minimap | undefined;
  applyTheme(request, () => minimap?.draw());
  if (!request) {
    showMessage('This DiffSanity link is incomplete. Open a file from a pull request\'s "Files changed" tab.', 'error');
    return;
  }
  renderHeader(request);

  showMessage('Loading file…', 'loading');
  try {
    const contents = await loadFileContents(request);
    const diff = computeFileDiff({
      filename: request.path,
      oldFilename: request.oldPath,
      oldContent: contents.oldContent,
      newContent: contents.newContent,
    });
    renderStats(diff.additions, diff.deletions, contents.status, contents.revisions.baseSha, contents.revisions.headSha);

    const scroller = element('#ds-scroller');
    const rendered = renderDiff(scroller, diff, {
      old: highlightLines(splitLines(contents.oldContent), request.oldPath ?? request.path),
      new: highlightLines(splitLines(contents.newContent), request.path),
    });
    element('#ds-message').hidden = true;
    if (diff.approximate) showMessage('This file changed too much to diff precisely; it is shown as fully replaced.', 'info');
    if (!diff.lines.length) showMessage('This file is empty.', 'info');

    minimap = new Minimap(element('#ds-minimap'), scroller, diff.lines, LINE_HEIGHT);
    const firstChange = findChangeBlocks(diff.lines)[0];
    if (firstChange) rendered.scrollToLine(Math.max(0, firstChange.start - CONTEXT_ABOVE_FIRST_CHANGE));
    scroller.focus({ preventScroll: true });
  } catch (error) {
    const text = error instanceof LoadError ? error.message : 'Something went wrong while loading this file.';
    if (!(error instanceof LoadError)) console.error('[DiffSanity]', error);
    showMessage(text, 'error');
  }
}

void main();
