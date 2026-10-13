// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPullRequestFiles, lookUpMissingStatuses } from '../src/review/fileSource';
import type { FetchTextResponse, FileStatus, Message, PullRequestFile, PullRequestFileList, ReviewRequest } from '../src/shared/types';

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

  it('keeps a status the tab rendered when the fetched list lacks it', async () => {
    const page = FILES_PAGE.replace('"changeType":"MODIFIED",', '');
    stubBrowser({ files: [{ path: 'src/app.ts', status: 'modified' }], complete: false }, page);
    const files = await loadPullRequestFiles(REQUEST);
    expect(files.find((file) => file.path === 'src/app.ts')?.status).toBe('modified');
  });
});

describe('lookUpMissingStatuses', () => {
  const BASE = 'a'.repeat(40);
  const HEAD = 'b'.repeat(40);
  const WITH_REVISIONS: ReviewRequest = { ...REQUEST, baseSha: BASE, headSha: HEAD };
  /** Paths that exist at each commit. */
  const TREES: Record<string, string[]> = {
    [BASE]: ['src/app.ts', 'src/gone.ts', 'src/old.ts'],
    [HEAD]: ['src/app.ts', 'src/added.ts', 'src/new.ts'],
  };
  const FILES: PullRequestFile[] = [
    { path: 'src/app.ts' },
    { path: 'src/added.ts' },
    { path: 'src/gone.ts' },
    { path: 'src/new.ts', oldPath: 'src/old.ts' },
    { path: 'src/known.ts', status: 'modified' },
  ];

  function exists(url: string): boolean {
    const match = /\/raw\/([0-9a-f]{40})\/(.+)$/.exec(url);
    return !!match && TREES[match[1]].includes(match[2]);
  }

  /** Stubs GitHub: `page` answers the review page's own requests, `tab` the GitHub tab's (undefined: no answer). */
  function stubGitHub(page: 'public' | 'refused', tab?: 'signed-in'): { fetch: ReturnType<typeof vi.fn>; sendMessage: ReturnType<typeof vi.fn> } {
    const fetch = vi.fn(async (url: string) => {
      const ok = page === 'public' && exists(url);
      return { ok, status: ok ? 200 : 404, text: async () => '' };
    });
    const sendMessage = vi.fn(async (_tabId: number, message: Message): Promise<FetchTextResponse | undefined> => {
      if (message.type !== 'diffsanity:fetchText' || !tab) return undefined;
      const ok = exists(message.url);
      return { ok, status: ok ? 200 : 404 };
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('chrome', { tabs: { sendMessage } });
    return { fetch, sendMessage };
  }

  async function lookUp(request: ReviewRequest): Promise<Record<string, FileStatus>> {
    const found: Record<string, FileStatus> = {};
    await lookUpMissingStatuses(request, FILES, (file, status) => (found[file.path] = status));
    return found;
  }

  const EXPECTED = { 'src/app.ts': 'modified', 'src/added.ts': 'added', 'src/gone.ts': 'deleted', 'src/new.ts': 'renamed' };

  it('works out missing statuses from which commit has the file, with HEAD requests only', async () => {
    const { fetch } = stubGitHub('public');
    await expect(lookUp(WITH_REVISIONS)).resolves.toEqual(EXPECTED);
    expect(fetch).toHaveBeenCalledTimes(8);
    for (const [, init] of fetch.mock.calls as unknown as [string, RequestInit][]) expect(init.method).toBe('HEAD');
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('known.ts'), expect.anything());
  });

  it('asks the GitHub tab when the review page is refused (private repositories)', async () => {
    const { sendMessage } = stubGitHub('refused', 'signed-in');
    await expect(lookUp(WITH_REVISIONS)).resolves.toEqual(EXPECTED);
    expect(sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'diffsanity:fetchText', method: 'HEAD' }));
  });

  it('leaves the status unknown when the files cannot be reached', async () => {
    stubGitHub('refused');
    await expect(lookUp(WITH_REVISIONS)).resolves.toEqual({});
  });
});
