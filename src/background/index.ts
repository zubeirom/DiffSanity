import { toReviewSearch } from '../shared/githubContext';
import type { Message, ReviewRequest } from '../shared/types';

/** Review page URL. The source tab is added so the review can return to it and fetch through it. */
function reviewUrl(request: ReviewRequest, sourceTab?: chrome.tabs.Tab): string {
  return chrome.runtime.getURL(`review.html?${toReviewSearch({ ...request, sourceTabId: sourceTab?.id })}`);
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  switch (message.type) {
    case 'diffsanity:reviewUrl':
      sendResponse(reviewUrl(message.request, sender.tab));
      return false;
    case 'diffsanity:open': {
      const sourceTab = sender.tab;
      void chrome.tabs.create({
        url: reviewUrl(message.request, sourceTab),
        active: !message.background,
        index: sourceTab ? sourceTab.index + 1 : undefined,
        openerTabId: sourceTab?.id,
      });
      return false;
    }
    default:
      return false;
  }
});
