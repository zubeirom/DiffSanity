// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPullRequestFiles } from '../src/review/fileSource';
import type { Message, PullRequestFileList, ReviewRequest } from '../src/shared/types';

const REQUEST: ReviewRequest = { origin: 'https://github.com', owner: 'o', repo: 'r', pr: 7, path: 'src/app.ts', sourceTabId: 1 };

// The "Files changed" page as fetched: its embedded data lists every file, but old paths only of preloaded files.
const FILES_PAGE = `<html><body><script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
  payload: {
    pullRequestsChangesRoute: {
      pullRequest: { number: 7 },
      diffSummaries: [
        { path: 'src/app.ts', pathDigest: 'aaa', changeType: 'MODIFIED', linesAdded: 3, linesDeleted: 1 },
        { path: 'src/added.ts', pathDigest: 'bbb', changeType: 'ADDED', linesAdded: 5, linesDeleted: 0 },
        { path: 'src/new.ts', pathDigest: 'ccc', changeType: 'RENAMED', linesAdded: 0, linesDeleted: 0 },
      ],
      diffContents: [],
    },
  },
})}</script></body></html>`;

/** The GitHub tab after client-side navigation: only rendered headers, which carry no status for most files. */
const HEADERS_ONLY: PullRequestFileList = {
  files: [
    { path: 'src/app.ts', anchor: 'diff-aaa' },
    { path: 'src/new.ts', oldPath: 'src/old.ts', status: 'renamed', anchor: 'diff-ccc' },
  ],
  complete: false,
};

function stubBrowser(tabList: PullRequestFileList, page?: string): ReturnType<typeof vi.fn> {
  const fetch = vi.fn(async () => (page === undefined ? { ok: false, status: 404 } : { ok: true, status: 200, text: async () => page }));
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('chrome', {
    tabs: { sendMessage: vi.fn(async (_tabId: number, message: Message) => (message.type === 'diffsanity:listFiles' ? tabList : undefined)) },
  });
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadPullRequestFiles', () => {
  it("uses the GitHub tab's list when it is complete", async () => {
    const complete: PullRequestFileList = { files: [{ path: 'src/app.ts', status: 'modified' }], complete: true };
    const fetch = stubBrowser(complete, FILES_PAGE);
    await expect(loadPullRequestFiles(REQUEST)).resolves.toEqual(complete.files);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches the full list when the tab only has rendered headers, keeping their old paths', async () => {
    stubBrowser(HEADERS_ONLY, FILES_PAGE);
    const files = await loadPullRequestFiles(REQUEST);
    expect(files.map(({ path, oldPath, status }) => ({ path, oldPath, status }))).toEqual([
      { path: 'src/app.ts', oldPath: undefined, status: 'modified' },
      { path: 'src/added.ts', oldPath: undefined, status: 'added' },
      { path: 'src/new.ts', oldPath: 'src/old.ts', status: 'renamed' },
    ]);
  });

  it("falls back to the tab's headers when the page cannot be fetched", async () => {
    stubBrowser(HEADERS_ONLY);
    await expect(loadPullRequestFiles(REQUEST)).resolves.toEqual(HEADERS_ONLY.files);
  });
});
