/**
 * Moving between the review tab and the GitHub tab it was opened from, for hand-offs to GitHub's own UI.
 */
import type { Message } from '../shared/types';

/** Brings the GitHub tab to the front and sends it a message; `undefined` when the tab is gone or does not answer. */
export async function sendToSourceTab<T>(sourceTabId: number, message: Message): Promise<T | undefined> {
  try {
    const source = await chrome.tabs.update(sourceTabId, { active: true });
    if (source) await chrome.windows.update(source.windowId, { focused: true });
    return await chrome.tabs.sendMessage(sourceTabId, message);
  } catch {
    // The tab is closed, or runs a content script from before an extension reload.
    return undefined;
  }
}

/** Brings this review tab back to the front, e.g. to explain why a hand-off failed. */
export async function focusReviewTab(): Promise<void> {
  const current = await chrome.tabs.getCurrent();
  if (current?.id === undefined) return;
  await chrome.tabs.update(current.id, { active: true });
  await chrome.windows.update(current.windowId, { focused: true });
}
