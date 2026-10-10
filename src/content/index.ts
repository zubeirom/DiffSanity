import { isPullRequestFilesPage, parsePullRequestUrl } from '../shared/githubContext';
import type { FetchTextResponse, GitHubLineInfo, GoToLineResponse, Message, PullRequestRef, ReviewRequest } from '../shared/types';
import { extractPageRevisions, readLineInfo, resolveTheme, revealLine, type FileHeader } from './github';
import { injectButtons } from './injectButton';

const SCAN_DELAY_MS = 150;
let scanTimer: number | undefined;

function openReview(file: FileHeader, event: MouseEvent): void {
  const pullRequest = parsePullRequestUrl(location.href);
  if (!pullRequest) return;

  const request: ReviewRequest = {
    origin: location.origin,
    ...pullRequest,
    path: file.path,
    oldPath: file.oldPath,
    status: file.status,
    anchor: file.anchor,
    ...extractPageRevisions(document),
    theme: resolveTheme(document),
  };
  const message: Message = { type: 'diffsanity:open', request, background: event.ctrlKey || event.metaKey };
  chrome.runtime.sendMessage(message).catch((error: unknown) => {
    // Happens when the extension was reloaded while this page stayed open.
    console.warn('[DiffSanity] Could not open review. Reload the page and try again.', error);
  });
}

function scan(): void {
  scanTimer = undefined;
  if (isPullRequestFilesPage(location.href)) injectButtons(openReview);
}

/** Coalesces bursts of DOM mutations / navigation events into a single scan. */
function scheduleScan(): void {
  scanTimer ??= window.setTimeout(scan, SCAN_DELAY_MS);
}

/**
 * Fetches a same-origin GitHub URL with the page's session. Used by the review page as a fallback
 * when its own request is not authorised (e.g. private repositories).
 */
async function fetchText(url: string): Promise<FetchTextResponse> {
  if (!url.startsWith(`${location.origin}/`)) return { ok: false, status: 0 };
  try {
    const response = await fetch(url, { credentials: 'include' });
    return { ok: response.ok, status: response.status, text: response.ok ? await response.text() : undefined };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** True when this tab still shows the pull request a review page asks about. */
function showsPullRequest({ owner, repo, pr }: PullRequestRef): boolean {
  const current = parsePullRequestUrl(location.href);
  return (
    isPullRequestFilesPage(location.href) &&
    current?.owner.toLowerCase() === owner.toLowerCase() &&
    current.repo.toLowerCase() === repo.toLowerCase() &&
    current.pr === pr
  );
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  switch (message.type) {
    case 'diffsanity:fetchText':
      fetchText(message.url).then(sendResponse);
      return true;
    case 'diffsanity:lineInfo': {
      const info: GitHubLineInfo = showsPullRequest(message.pullRequest)
        ? readLineInfo(message.anchor)
        : { canComment: false, lines: [], threads: {} };
      sendResponse(info);
      return false;
    }
    case 'diffsanity:goToLine':
      if (!showsPullRequest(message.pullRequest)) {
        sendResponse({ found: false, commentBoxOpened: false } satisfies GoToLineResponse);
        return false;
      }
      revealLine(message.anchor, message.lineKey, message.startComment).then(sendResponse);
      return true;
    default:
      return false;
  }
});

// GitHub navigates client-side (Turbo / React router) and renders diffs progressively,
// so DOM mutations are the reliable signal; navigation events just make it snappier.
new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('turbo:load', scheduleScan);
window.addEventListener('popstate', scheduleScan);
scan();
