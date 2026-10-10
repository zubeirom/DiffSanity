import { isPullRequestFilesPage, parsePullRequestUrl } from '../shared/githubContext';
import type { FetchTextResponse, Message, ReviewRequest } from '../shared/types';
import { extractPageRevisions, resolveTheme, type FileHeader } from './github';
import { injectButtons } from './injectButton';
import { closeReviewModal, openReviewModal } from './modal';

const SCAN_DELAY_MS = 150;
let scanTimer: number | undefined;

/** Opens the review in a modal, or in a background tab on Ctrl/⌘-click. */
async function openReview(file: FileHeader, event: MouseEvent): Promise<void> {
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
  try {
    if (event.ctrlKey || event.metaKey) {
      const message: Message = { type: 'diffsanity:open', request, background: true };
      await chrome.runtime.sendMessage(message);
    } else {
      const message: Message = { type: 'diffsanity:reviewUrl', request };
      const url = (await chrome.runtime.sendMessage(message)) as string;
      openReviewModal(url, `${file.path} · DiffSanity`);
    }
  } catch (error) {
    // Happens when the extension was reloaded while this page stayed open.
    console.warn('[DiffSanity] Could not open review. Reload the page and try again.', error);
  }
}

function scan(): void {
  scanTimer = undefined;
  if (isPullRequestFilesPage(location.href)) injectButtons((file, event) => void openReview(file, event));
  else closeReviewModal();
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

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type !== 'diffsanity:fetchText') return false;
  fetchText(message.url).then(sendResponse);
  return true;
});

// GitHub navigates client-side (Turbo / React router) and renders diffs progressively,
// so DOM mutations are the reliable signal; navigation events just make it snappier.
new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('turbo:load', scheduleScan);
window.addEventListener('popstate', scheduleScan);
scan();
