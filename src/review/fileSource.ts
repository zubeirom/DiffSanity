import { extractPullRequestFiles } from '../content/github';
import { extractRevisionsFromText, pullRequestFilesUrl, rawFileUrl, toPullRequestFileList } from '../shared/githubContext';
import type {
  FetchTextResponse,
  FileStatus,
  Message,
  PullRequestFile,
  PullRequestFileList,
  ReviewRequest,
  Revisions,
} from '../shared/types';

export class LoadError extends Error {}

export interface FileContents {
  oldContent: string;
  newContent: string;
  status: FileStatus;
  revisions: Required<Revisions>;
}

/**
 * Fetches a GitHub URL. The review page's own request carries the user's GitHub session (the extension
 * has host permissions); if that is refused, the request is retried from the GitHub tab DiffSanity was opened from.
 */
async function fetchText(url: string, sourceTabId?: number): Promise<FetchTextResponse> {
  let status = 0;
  try {
    const response = await fetch(url, { credentials: 'include' });
    if (response.ok) return { ok: true, status: response.status, text: await response.text() };
    status = response.status;
  } catch {
    // Network/CORS failure; fall through to the tab fallback.
  }
  if (sourceTabId !== undefined) {
    try {
      const message: Message = { type: 'diffsanity:fetchText', url };
      const response = (await chrome.tabs.sendMessage(sourceTabId, message)) as FetchTextResponse | undefined;
      if (response?.ok) return response;
    } catch {
      // Source tab closed or navigated away from GitHub.
    }
  }
  return { ok: false, status };
}

async function fetchJson<T>(url: string): Promise<T | undefined> {
  try {
    const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
    return response.ok ? ((await response.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** Fills in missing commits: first from the PR page itself, then from github.com's public REST API (public repos only; GHE.com has no anonymous API). */
async function resolveRevisions(request: ReviewRequest): Promise<Required<Revisions>> {
  let revisions: Revisions = { baseSha: request.baseSha, headSha: request.headSha };

  if (!revisions.baseSha || !revisions.headSha) {
    const page = await fetchText(pullRequestFilesUrl({ ...request, anchor: undefined }), request.sourceTabId);
    if (page.text) {
      const fromPage = extractRevisionsFromText(page.text);
      revisions = { baseSha: revisions.baseSha ?? fromPage.baseSha, headSha: revisions.headSha ?? fromPage.headSha };
    }
  }

  if ((!revisions.baseSha || !revisions.headSha) && request.origin === 'https://github.com') {
    const api = `https://api.github.com/repos/${encodeURIComponent(request.owner)}/${encodeURIComponent(request.repo)}`;
    const pull = await fetchJson<{ base: { sha: string }; head: { sha: string } }>(`${api}/pulls/${request.pr}`);
    if (pull) {
      const compare = await fetchJson<{ merge_base_commit: { sha: string } }>(`${api}/compare/${pull.base.sha}...${pull.head.sha}`);
      revisions = {
        baseSha: revisions.baseSha ?? compare?.merge_base_commit.sha ?? pull.base.sha,
        headSha: revisions.headSha ?? pull.head.sha,
      };
    }
  }

  if (!revisions.baseSha || !revisions.headSha) {
    throw new LoadError('Could not determine which commits this pull request compares. Reload the GitHub page and try again.');
  }
  return { baseSha: revisions.baseSha, headSha: revisions.headSha };
}

const NO_FILES: PullRequestFileList = { files: [], complete: false };

/** Asks the GitHub tab DiffSanity was opened from for the changed files it shows. No files when it cannot answer. */
export async function listSourceTabFiles(request: ReviewRequest): Promise<PullRequestFileList> {
  const { owner, repo, pr, sourceTabId } = request;
  if (sourceTabId === undefined) return NO_FILES;
  try {
    const message: Message = { type: 'diffsanity:listFiles', pullRequest: { owner, repo, pr } };
    return toPullRequestFileList(await chrome.tabs.sendMessage(sourceTabId, message));
  } catch {
    // The tab is closed, or runs a content script from before an extension reload.
    return NO_FILES;
  }
}

/**
 * Lists every changed file of the pull request. The GitHub tab DiffSanity was opened from is asked first. When it
 * lacks GitHub's full list (e.g. it reached "Files changed" without a page load), the page is fetched instead,
 * keeping the old paths of renamed files that the tab rendered.
 */
export async function loadPullRequestFiles(request: ReviewRequest): Promise<PullRequestFile[]> {
  const fromTab = await listSourceTabFiles(request);
  if (fromTab.complete) return fromTab.files;
  const page = await fetchText(pullRequestFilesUrl({ ...request, anchor: undefined }), request.sourceTabId);
  const fetched = page.text
    ? extractPullRequestFiles(new DOMParser().parseFromString(page.text, 'text/html'), request.pr)
    : NO_FILES;
  if (!fetched.complete) return fromTab.files.length ? fromTab.files : fetched.files;
  const oldPaths = new Map(fromTab.files.map((file) => [file.path, file.oldPath]));
  return fetched.files.map((file) => ({ ...file, oldPath: file.oldPath ?? oldPaths.get(file.path) }));
}

function looksBinary(text: string): boolean {
  return text.slice(0, 8000).includes('\u0000');
}

/** Retrieves the full old and new versions of the file under review. */
export async function loadFileContents(request: ReviewRequest): Promise<FileContents> {
  if (request.status === 'renamed' && !request.oldPath) {
    throw new LoadError('GitHub has not said yet where this file was renamed from. Scroll to it on the GitHub tab, then open it again.');
  }
  const revisions = await resolveRevisions(request);
  const { origin, owner, repo, sourceTabId } = request;
  const oldPath = request.oldPath ?? request.path;

  const [oldFile, newFile] = await Promise.all([
    request.status === 'added'
      ? undefined
      : fetchText(rawFileUrl(origin, owner, repo, revisions.baseSha, oldPath), sourceTabId),
    request.status === 'deleted'
      ? undefined
      : fetchText(rawFileUrl(origin, owner, repo, revisions.headSha, request.path), sourceTabId),
  ]);

  const oldMissing = !oldFile?.ok;
  const newMissing = !newFile?.ok;
  if (oldMissing && newMissing) {
    const status = oldFile?.status || newFile?.status;
    throw new LoadError(
      `Could not load ${request.path}${status ? ` (HTTP ${status})` : ''}. ` +
        'For private repositories, make sure you are signed in to GitHub in this browser.',
    );
  }

  const oldContent = oldFile?.text ?? '';
  const newContent = newFile?.text ?? '';
  if (looksBinary(oldContent) || looksBinary(newContent)) {
    throw new LoadError('This is a binary file. DiffSanity only shows text files.');
  }

  // A file missing on one side means it was added or deleted (GitHub only exposes "deleted" in the DOM).
  const status: FileStatus = oldMissing ? 'added' : newMissing ? 'deleted' : (request.status ?? 'modified');
  return { oldContent, newContent, status, revisions };
}
