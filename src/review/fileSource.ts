import { extractPullRequestFiles } from '../content/github';
import { extractRevisionsFromText, pullRequestFilesUrl, rawFileUrl, toPullRequestFileList } from '../shared/githubContext';
import type {
  FetchMethod,
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
 * When both fail, the GitHub tab's HTTP status is preferred, as that request certainly had the user's session.
 */
async function fetchText(url: string, sourceTabId?: number, method: FetchMethod = 'GET'): Promise<FetchTextResponse> {
  let status = 0;
  try {
    const response = await fetch(url, { method, credentials: 'include' });
    if (response.ok) return { ok: true, status: response.status, text: method === 'GET' ? await response.text() : undefined };
    status = response.status;
  } catch {
    // Network/CORS failure; fall through to the tab fallback.
  }
  if (sourceTabId !== undefined) {
    try {
      const message: Message = { type: 'diffsanity:fetchText', url, method };
      const response = (await chrome.tabs.sendMessage(sourceTabId, message)) as FetchTextResponse | undefined;
      if (response?.ok) return response;
      if (response?.status) status = response.status;
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
 * keeping the old paths and statuses of the files the tab rendered. Statuses can still be missing; see `lookUpMissingStatuses`.
 */
export async function loadPullRequestFiles(request: ReviewRequest): Promise<PullRequestFile[]> {
  const fromTab = await listSourceTabFiles(request);
  if (fromTab.complete) return fromTab.files;
  const page = await fetchText(pullRequestFilesUrl({ ...request, anchor: undefined }), request.sourceTabId);
  const fetched = page.text
    ? extractPullRequestFiles(new DOMParser().parseFromString(page.text, 'text/html'), request.pr)
    : NO_FILES;
  if (!fetched.complete) return fromTab.files.length ? fromTab.files : fetched.files;
  const fromTabByPath = new Map(fromTab.files.map((file) => [file.path, file]));
  return fetched.files.map((file) => {
    const rendered = fromTabByPath.get(file.path);
    return { ...file, oldPath: file.oldPath ?? rendered?.oldPath, status: file.status ?? rendered?.status };
  });
}

/** Most files whose status is looked up in the commits, so a huge pull request cannot flood GitHub with requests. */
const MAX_STATUS_LOOKUPS = 500;
const STATUS_LOOKUP_CONCURRENCY = 6;

/**
 * Works out a file's status from the commits themselves: a file missing at the base was added, one missing at the
 * head was deleted. Only a 404 counts as missing, and only when the other side loaded, so a file that could not be
 * reached (signed out, network error) is never mislabelled. Undefined when it cannot be told.
 */
async function lookUpFileStatus(request: ReviewRequest & Required<Revisions>, file: PullRequestFile): Promise<FileStatus | undefined> {
  const { origin, owner, repo, baseSha, headSha, sourceTabId } = request;
  const [base, head] = await Promise.all([
    fetchText(rawFileUrl(origin, owner, repo, baseSha, file.oldPath ?? file.path), sourceTabId, 'HEAD'),
    fetchText(rawFileUrl(origin, owner, repo, headSha, file.path), sourceTabId, 'HEAD'),
  ]);
  if (base.ok && head.ok) return file.oldPath && file.oldPath !== file.path ? 'renamed' : 'modified';
  if (head.ok && base.status === 404) return 'added';
  if (base.ok && head.status === 404) return 'deleted';
  return undefined;
}

/**
 * Fills in the status of files GitHub's page did not give one (e.g. after client-side navigation), by checking which
 * side of the diff each file exists on. Files are looked up in the given order; `onStatus` is called as each is known.
 */
export async function lookUpMissingStatuses(
  request: ReviewRequest,
  files: readonly PullRequestFile[],
  onStatus: (file: PullRequestFile, status: FileStatus) => void,
): Promise<void> {
  const queue = files.filter((file) => !file.status).slice(0, MAX_STATUS_LOOKUPS);
  if (!queue.length) return;
  let revisions: Required<Revisions>;
  try {
    revisions = await resolveRevisions(request);
  } catch {
    return;
  }
  const target = { ...request, ...revisions };
  const work = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const status = await lookUpFileStatus(target, file);
      if (status) onStatus(file, status);
    }
  };
  await Promise.all(Array.from({ length: Math.min(STATUS_LOOKUP_CONCURRENCY, queue.length) }, work));
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
