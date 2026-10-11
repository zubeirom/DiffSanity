import { fromReviewSearch, pullRequestFilesUrl, toReviewSearch } from '../shared/githubContext';
import type { Message, PullRequestFile, ReviewRequest, Theme } from '../shared/types';
import { GitHubComments } from './comments';
import { computeFileDiff, findChangeBlocks, splitLines } from './diff';
import { diffstatBlocks } from './diffstat';
import { FileTree } from './fileTree';
import { listSourceTabFiles, loadFileContents, loadPullRequestFiles, LoadError, type FileContents } from './fileSource';
import { Minimap } from './minimap';
import { LINE_HEIGHT, renderDiff } from './renderer';
import { setupSidebar } from './sidebar';
import { highlightLines } from './syntax';
import { loadThemeChoice, parseThemeChoice, resolveThemeId, saveThemeChoice, THEME_STORAGE_KEY, THEMES } from './themes';

/** Lines of context kept above the first change when the file opens. */
const CONTEXT_ABOVE_FIRST_CHANGE = 4;
/** Time GitHub gets to render a file it was scrolled to before its lines are read for comments. */
const GITHUB_RENDER_DELAY_MS = 1500;
/** GitHub only says where a file was renamed from once it rendered it, so the GitHub tab is asked a few times. */
const RENAME_LOOKUP_ATTEMPTS = 5;
const RENAME_LOOKUP_DELAY_MS = 400;
/** Widths (% of the code area) of the placeholder lines shown while a file loads. */
const SKELETON_LINE_WIDTHS = [32, 54, 46, 0, 28, 61, 70, 38, 0, 44, 57, 24];

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector} in review.html`);
  return found;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Applies the saved colour theme, offers the picker, and keeps every open review tab in sync. */
function setupTheme(request: ReviewRequest | null, onChange: () => void): void {
  const root = document.documentElement;
  const picker = element<HTMLSelectElement>('#ds-theme');
  const query = matchMedia('(prefers-color-scheme: dark)');
  const githubTheme = (): Theme => request?.theme ?? (query.matches ? 'dark' : 'light');
  let choice = loadThemeChoice();

  const apply = () => {
    root.dataset.theme = resolveThemeId(choice, githubTheme());
    picker.value = choice;
    onChange();
  };
  picker.replaceChildren(
    new Option('Match GitHub', 'auto'),
    ...THEMES.map((theme) => new Option(theme.label, theme.id)),
  );
  picker.addEventListener('change', () => {
    choice = parseThemeChoice(picker.value);
    saveThemeChoice(choice);
    apply();
  });
  // Fired in other review tabs when the choice changes in one of them.
  window.addEventListener('storage', (event) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    choice = loadThemeChoice();
    apply();
  });
  query.addEventListener('change', apply);
  apply();
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

function renderFileHeader(file: PullRequestFile): void {
  const slash = file.path.lastIndexOf('/');
  const name = file.path.slice(slash + 1);
  element('#ds-dir').textContent = slash >= 0 ? file.path.slice(0, slash + 1) : '';
  element('#ds-name').textContent = name;
  const renamed = element('#ds-renamed');
  renamed.hidden = !file.oldPath || file.oldPath === file.path;
  renamed.textContent = renamed.hidden ? '' : `renamed from ${file.oldPath}`;
  element('#ds-status').hidden = true;
  element('#ds-additions').textContent = '';
  element('#ds-deletions').textContent = '';
  element('#ds-diffstat').replaceChildren();
  document.title = `${name} · DiffSanity`;
}

function renderStats(additions: number, deletions: number, contents: FileContents): void {
  element('#ds-additions').textContent = `+${additions}`;
  element('#ds-deletions').textContent = `−${deletions}`;
  element('#ds-diffstat').replaceChildren(
    ...diffstatBlocks(additions, deletions).map((kind) => {
      const block = document.createElement('span');
      block.className = 'ds-diffstat-block';
      block.dataset.kind = kind;
      return block;
    }),
  );
  const badge = element('#ds-status');
  badge.hidden = contents.status !== 'added' && contents.status !== 'deleted';
  badge.textContent = badge.hidden ? '' : contents.status;
  badge.dataset.status = contents.status;
  const { baseSha, headSha } = contents.revisions;
  element('#ds-revisions').textContent = `${baseSha.slice(0, 7)} → ${headSha.slice(0, 7)}`;
  element('#ds-revisions').title = `Base ${baseSha}\nHead ${headSha}`;
}

function showMessage(text: string, kind: 'loading' | 'error' | 'info'): void {
  const message = element('#ds-message');
  message.textContent = text;
  message.dataset.kind = kind;
  message.hidden = false;
}

function hideMessage(): void {
  element('#ds-message').hidden = true;
}

/** Placeholder lines shown in the code area while a file loads. */
function loadingSkeleton(): HTMLElement {
  const skeleton = document.createElement('div');
  skeleton.className = 'ds-skeleton';
  skeleton.setAttribute('aria-hidden', 'true');
  for (const width of SKELETON_LINE_WIDTHS) {
    const line = document.createElement('span');
    line.style.width = `${width}%`;
    skeleton.append(line);
  }
  return skeleton;
}

function fileOf(request: ReviewRequest): PullRequestFile {
  return { path: request.path, oldPath: request.oldPath, status: request.status, anchor: request.anchor };
}

function isSameFile(a: PullRequestFile, b: PullRequestFile): boolean {
  return (!!a.anchor && a.anchor === b.anchor) || a.path === b.path;
}

/** Everything that belongs to the file on screen and must be undone before showing another one. */
interface ShownFile {
  path: string;
  minimap: Minimap;
  comments?: GitHubComments;
}

/**
 * The review tab: one file at a time, with the pull request's other changed files in a sidebar.
 * Contents are cached per file and the scroll position is kept, so switching back and forth is instant.
 */
class ReviewPage {
  private readonly scroller = element('#ds-scroller');
  private readonly contents = new Map<string, Promise<FileContents>>();
  private readonly scrollTops = new Map<string, number>();
  private file: PullRequestFile;
  private shown: ShownFile | undefined;
  private tree: FileTree | undefined;
  /** Bumped on every file switch, so a slow load cannot overwrite the file the user moved on to. */
  private loadToken = 0;

  constructor(private session: ReviewRequest) {
    this.file = fileOf(session);
    const back = element<HTMLAnchorElement>('#ds-back');
    back.href = pullRequestFilesUrl(session);
    back.addEventListener('click', (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      void backToGitHub(this.request(this.file));
    });
    const pr = element<HTMLAnchorElement>('#ds-pr');
    element('#ds-pr-repo').textContent = `${session.owner}/${session.repo}`;
    element('#ds-pr-number').textContent = `#${session.pr}`;
    pr.title = `Pull request ${session.owner}/${session.repo} #${session.pr} on GitHub`;
    pr.href = pullRequestFilesUrl({ ...session, anchor: undefined });
    document.addEventListener('keydown', this.onKeyDown);
  }

  /** Redraws theme-dependent canvases. */
  redraw(): void {
    this.shown?.minimap.draw();
  }

  /** Shows the file the tab was opened for, then lists the pull request's other files next to it. */
  async start(): Promise<void> {
    const first = this.show(this.file);
    const files = await loadPullRequestFiles(this.session);
    const index = files.findIndex((file) => isSameFile(file, this.file));
    if (index >= 0) files[index] = { ...files[index], oldPath: files[index].oldPath ?? this.file.oldPath };
    else files.unshift(this.file);
    if (files.length > 1) {
      this.tree = new FileTree(element('#ds-sidebar'), files, (file) => void this.show(file));
      this.tree.setActive(this.file.path);
      setupSidebar(element('#ds-sidebar'), element('#ds-resizer'), element<HTMLButtonElement>('#ds-sidebar-toggle'));
    }
    await first;
  }

  private request(file: PullRequestFile): ReviewRequest {
    return { ...this.session, path: file.path, oldPath: file.oldPath, status: file.status, anchor: file.anchor };
  }

  private async show(file: PullRequestFile): Promise<void> {
    const token = ++this.loadToken;
    this.hideFile();
    this.file = file;
    renderFileHeader(file);
    this.tree?.setActive(file.path);
    const request = this.request(file);
    history.replaceState(null, '', `?${toReviewSearch(request)}`);
    element<HTMLAnchorElement>('#ds-back').href = pullRequestFilesUrl(request);
    const revealed = this.revealOnGitHub(file);

    showMessage('Loading file…', 'loading');
    this.scroller.replaceChildren(loadingSkeleton());
    try {
      const resolved = await this.withOldPath(file, () => token !== this.loadToken);
      const contents = await this.load(this.request(resolved));
      if (token !== this.loadToken) return;
      this.render(resolved, contents, revealed);
    } catch (error) {
      if (token !== this.loadToken) return;
      const text = error instanceof LoadError ? error.message : 'Something went wrong while loading this file.';
      if (!(error instanceof LoadError)) console.error('[DiffSanity]', error);
      this.scroller.replaceChildren();
      showMessage(text, 'error');
    }
  }

  private load(request: ReviewRequest): Promise<FileContents> {
    let contents = this.contents.get(request.path);
    if (!contents) {
      contents = loadFileContents(request).then((loaded) => {
        // Later files skip looking up the commits again.
        this.session = { ...this.session, ...loaded.revisions };
        return loaded;
      });
      contents.catch(() => this.contents.delete(request.path));
      this.contents.set(request.path, contents);
    }
    return contents;
  }

  /** A renamed file's old path, asked from the GitHub tab while GitHub renders it there. */
  private async withOldPath(file: PullRequestFile, cancelled: () => boolean): Promise<PullRequestFile> {
    if (file.status !== 'renamed' || file.oldPath) return file;
    for (let attempt = 0; attempt < RENAME_LOOKUP_ATTEMPTS && !cancelled(); attempt++) {
      await delay(RENAME_LOOKUP_DELAY_MS);
      const oldPath = (await listSourceTabFiles(this.session)).find((listed) => isSameFile(listed, file))?.oldPath;
      if (oldPath) {
        const resolved = { ...file, oldPath };
        if (this.file === file && !cancelled()) {
          this.file = resolved;
          renderFileHeader(resolved);
        }
        return resolved;
      }
    }
    return file;
  }

  /** Scrolls the GitHub tab to the file, so "Back to GitHub" lands there and GitHub loads its lines for comments. */
  private async revealOnGitHub(file: PullRequestFile): Promise<boolean> {
    const { owner, repo, pr, sourceTabId } = this.session;
    if (sourceTabId === undefined || !file.anchor) return false;
    try {
      const message: Message = { type: 'diffsanity:revealFile', pullRequest: { owner, repo, pr }, anchor: file.anchor };
      return (await chrome.tabs.sendMessage(sourceTabId, message)) === true;
    } catch {
      return false;
    }
  }

  private render(file: PullRequestFile, contents: FileContents, revealed: Promise<boolean>): void {
    const diff = computeFileDiff({
      filename: file.path,
      oldFilename: file.oldPath,
      oldContent: contents.oldContent,
      newContent: contents.newContent,
    });
    renderStats(diff.additions, diff.deletions, contents);
    const rendered = renderDiff(this.scroller, diff, {
      old: highlightLines(splitLines(contents.oldContent), file.oldPath ?? file.path),
      new: highlightLines(splitLines(contents.newContent), file.path),
    });
    hideMessage();
    if (diff.approximate) showMessage('This file changed too much to diff precisely; it is shown as fully replaced.', 'info');
    if (!diff.lines.length) showMessage('This file is empty.', 'info');

    const minimap = new Minimap(element('#ds-minimap'), this.scroller, diff.lines, LINE_HEIGHT);
    const request = this.request(file);
    const { sourceTabId, anchor } = request;
    const comments =
      sourceTabId !== undefined && anchor
        ? new GitHubComments({ ...request, sourceTabId, anchor }, diff.lines, this.scroller, rendered, minimap, (text) =>
            showMessage(text, 'info'),
          )
        : undefined;
    this.shown = { path: file.path, minimap, comments };
    // GitHub may still be rendering the file it was just scrolled to; read its lines again once it is likely done.
    void revealed.then(async (ok) => {
      if (!ok) return;
      await delay(GITHUB_RENDER_DELAY_MS);
      if (this.shown?.comments === comments) await comments?.refresh();
    });

    const saved = this.scrollTops.get(file.path);
    const firstChange = findChangeBlocks(diff.lines)[0];
    if (saved !== undefined) this.scroller.scrollTop = saved;
    else if (firstChange) rendered.scrollToLine(Math.max(0, firstChange.start - CONTEXT_ABOVE_FIRST_CHANGE));
    if (!this.scroller.contains(document.activeElement) && !element('#ds-sidebar').contains(document.activeElement)) {
      this.scroller.focus({ preventScroll: true });
    }
  }

  private hideFile(): void {
    if (!this.shown) return;
    this.scrollTops.set(this.shown.path, this.scroller.scrollTop);
    this.shown.comments?.destroy();
    this.shown.minimap.destroy();
    this.shown = undefined;
    this.scroller.replaceChildren();
  }

  /** Alt+↓ / Alt+↑ open the next / previous changed file. */
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!this.tree || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    // Alt+↓ opens a <select>'s list; leave form fields alone.
    if ((event.target as Element).closest('input, select, textarea')) return;
    event.preventDefault();
    const next = this.tree.neighbour(this.file.path, event.key === 'ArrowDown' ? 1 : -1);
    if (next) void this.show(next);
  };
}

function main(): void {
  const request = fromReviewSearch(location.search);
  let page: ReviewPage | undefined;
  setupTheme(request, () => page?.redraw());
  if (!request) {
    showMessage('This DiffSanity link is incomplete. Open a file from a pull request\'s "Files changed" tab.', 'error');
    return;
  }
  page = new ReviewPage(request);
  void page.start();
}

main();