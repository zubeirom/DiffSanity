import { toReviewSearch } from '../shared/githubContext';
import type { Message } from '../shared/types';

chrome.runtime.onMessage.addListener((message: Message, sender) => {
  if (message.type !== 'diffsanity:open') return false;

  const sourceTab = sender.tab;
  const request = { ...message.request, sourceTabId: sourceTab?.id };
  void chrome.tabs.create({
    url: chrome.runtime.getURL(`review.html?${toReviewSearch(request)}`),
    active: !message.background,
    index: sourceTab ? sourceTab.index + 1 : undefined,
    openerTabId: sourceTab?.id,
  });
  return false;
});
