import { fromReviewSearch, pullRequestFilesUrl, toReviewSearch } from '../shared/githubContext';
import type {
  FileDiff,
  FileStatus,
  Message,
  OpenApprovalResponse,
  PullRequestFile,
  PullRequestRef,
  ReviewRequest,
  Revisions,
  Theme,
} from '../shared/types';
import { GitHubComments } from './comments';
import { computeFileDiff, findChangeBlocks, splitLines } from './diff';
import { diffstatBlocks } from './diffstat';
import { STATUS_LABELS, statusIcon } from './fileStatus';
import { buildFileTree, FileTree, treeOrder } from './fileTree';
import {
  listSourceTabFiles,
  loadFileContents,
  loadPullRequestFiles,
  LoadError,
  lookUpMissingStatuses,
  type FileContents,
} from './fileSource';
import { octicon } from './icons';
import { loadLayout, parseLayout, saveLayout, type DiffLayout } from './layout';
import { Minimap } from './minimap';
import { LINE_HEIGHT, renderDiff, type HighlightedSources, type RenderedDiff } from './renderer';
import { setupSidebar } from './sidebar';
import { focusReviewTab, sendToSourceTab } from './sourceTab';
import { highlightLines } from './syntax';
import {
  loadThemeChoice,
  parseThemeChoice,
  resolveThemeId,
  saveThemeChoice,
  THEME_STORAGE_KEY,
  THEMES,
  type ThemeChoice,
} from './themes';

/** Lines of context kept above the first change when the file opens. */
const CONTEXT_ABOVE_FIRST_CHANGE = 4;
/** Time GitHub gets to render a file it was scrolled to before its lines are read for comments. */
const GITHUB_RENDER_DELAY_MS = 1500;
/** GitHub only says where a file was renamed from once it rendered it, so the GitHub tab is asked a few times. */
const RENAME_LOOKUP_ATTEMPTS = 5;
const RENAME_LOOKUP_DELAY_MS = 400;
/** Widths (% of the code area) of the placeholder lines shown while a file loads. */
const SKELETON_LINE_WIDTHS = [32, 54, 46, 0, 28, 61, 70, 38, 0, 44, 57, 24];
/** Gap between a menu and the button that opens it, in px. */
const MENU_OFFSET = 6;
const CHECK_ICON =
  'M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z';

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector} in review.html`);
  return found;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Places a popover menu under the right edge of its button and focuses its selected item when it opens. */
function setupMenu(button: HTMLButtonElement, menu: HTMLElement): void {
  menu.addEventListener('toggle', () => {
    const open = menu.matches(':popover-open');
    button.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const rect = button.getBoundingClientRect();
    menu.style.top = `${rect.bottom + MENU_OFFSET}px`;
    menu.style.right = `${document.documentElement.clientWidth - rect.right}px`;
    menu.querySelector<HTMLInputElement>('input:checked')?.focus();
  });
}

function themeOption(choice: ThemeChoice, label: string): HTMLLabelElement {
  const option = document.createElement('label');
  option.className = 'ds-menu-item';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'ds-theme';
  input.value = choice;
  input.className = 'sr-only';
  const check = octicon(CHECK_ICON, 16);
  check.classList.add('ds-menu-check');
  option.append(input, check, label);
  return option;
}

/** Applies the saved colour theme, offers the theme menu, and keeps every open review tab in sync. */
function setupTheme(request: ReviewRequest | null, onChange: () => void): void {
  const root = document.documentElement;
  const button = element<HTMLButtonElement>('#ds-theme-button');
  const options = element('#ds-theme-options');
  const query = matchMedia('(prefers-color-scheme: dark)');
  const githubTheme = (): Theme => request?.theme ?? (query.matches ? 'dark' : 'light');
  const labels = new Map<ThemeChoice, string>([['auto', 'Match GitHub'], ...THEMES.map((theme) => [theme.id, theme.label] as const)]);
  let choice = loadThemeChoice();

  const apply = () => {
    root.dataset.theme = resolveThemeId(choice, githubTheme());
    for (const input of options.querySelectorAll<HTMLInputElement>('input')) input.checked = input.value === choice;
    button.title = `Colour theme: ${labels.get(choice)}`;
    onChange();
  };
  options.replaceChildren(...[...labels].map(([id, label]) => themeOption(id, label)));
  // The menu stays open, so themes can be tried one after another.
  options.addEventListener('change', (event) => {
    choice = parseThemeChoice((event.target as HTMLInputElement).value);
    saveThemeChoice(choice);
    apply();
  });
  setupMenu(button, element('#ds-theme-menu'));
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
  renamed.textContent = renamed.hidden ? '' : `from ${file.oldPath}`;
  renderStatus(file.status);
  element('#ds-additions').textContent = '';
  element('#ds-deletions').textContent = '';
  element('#ds-diffstat').replaceChildren();
  document.title = `${name} · DiffSanity`;
}

/** Shows whether the file is new, modified, deleted or renamed. Hidden until the status is known. */
function renderStatus(status: FileStatus | undefined): void {
  const pill = element('#ds-status');
  pill.hidden = !status;
  pill.replaceChildren(...(status ? [statusIcon(status, 12), STATUS_LABELS[status]] : []));
  if (status) pill.dataset.status = status;
  else delete pill.dataset.status;
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
  renderStatus(contents.status);
}

/** Tooltip of the pull request link, with the commits being compared once they are known. */
function pullRequestTitle({ owner, repo, pr }: PullRequestRef, { baseSha, headSha }: Revisions): string {
  const title = `Pull request ${owner}/${repo} #${pr} on GitHub`;
  return baseSha && headSha ? `${title}\nComparing ${baseSha.slice(0, 7)} → ${headSha.slice(0, 7)}` : title;
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

/** A loaded file, ready to be drawn in either layout. */
interface FileView {
  file: PullRequestFile;
  diff: FileDiff;
  sources: HighlightedSources;
}

/** Everything that belongs to the file on screen and must be undone before showing another one. */
interface ShownFile {
  view: FileView;
  rendered: RenderedDiff;
  minimap: Minimap;
  comments?: GitHubComments;
}

/**
 * The review tab: one file at a time, with the pull request's other changed files in a sidebar.
 * Contents are cached per file and the reading position is kept, so switching back and forth is instant.
 */
class ReviewPage {
  private readonly scroller = element('#ds-scroller');
  private readonly contents = new Map<string, Promise<FileContents>>();
  /** Diff line at the top of the view when each file was last shown. A line, not pixels, so it survives a layout change. */
  private readonly topLines = new Map<string, number>();
  private readonly layoutButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-layout]')];
  private layout: DiffLayout = loadLayout();
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
    pr.title = pullRequestTitle(session, session);
    pr.href = pullRequestFilesUrl({ ...session, anchor: undefined });
    const approve = element<HTMLButtonElement>('#ds-approve');
    approve.hidden = session.sourceTabId === undefined;
    approve.addEventListener('click', () => void this.openApproval());
    for (const button of this.layoutButtons) {
      button.addEventListener('click', () => this.setLayout(parseLayout(button.dataset.layout)));
    }
    this.updateLayoutButtons();
    document.addEventListener('keydown', this.onKeyDown);
  }

  /** Switches between one column and side by side, keeping the reading position. */
  private setLayout(layout: DiffLayout): void {
    if (layout === this.layout) return;
    this.layout = layout;
    saveLayout(layout);
    this.updateLayoutButtons();
    const view = this.shown?.view;
    if (!view) return;
    this.hideFile();
    this.display(view, Promise.resolve(false));
  }

  private updateLayoutButtons(): void {
    for (const button of this.layoutButtons) button.setAttribute('aria-pressed', String(button.dataset.layout === this.layout));
  }

  /** Hands the approval to GitHub: its review box opens with "Approve" selected, and the user submits it there. */
  private async openApproval(): Promise<void> {
    const { owner, repo, pr, sourceTabId } = this.session;
    if (sourceTabId === undefined) return;
    const message: Message = { type: 'diffsanity:openApproval', pullRequest: { owner, repo, pr } };
    const response = await sendToSourceTab<OpenApprovalResponse>(sourceTabId, message);
    if (response?.opened) return;
    await focusReviewTab();
    showMessage(
      "Could not open GitHub's review box. Check that you are signed in, reload the pull request there and try again.",
      'info',
    );
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
      const tree = this.tree;
      void lookUpMissingStatuses(this.session, treeOrder(buildFileTree(files)), (file, status) => tree.setStatus(file.path, status));
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
        element('#ds-pr').title = pullRequestTitle(this.session, this.session);
        this.tree?.setStatus(request.path, loaded.status);
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
      const oldPath = (await listSourceTabFiles(this.session)).files.find((listed) => isSameFile(listed, file))?.oldPath;
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
    const sources: HighlightedSources = {
      old: highlightLines(splitLines(contents.oldContent), file.oldPath ?? file.path),
      new: highlightLines(splitLines(contents.newContent), file.path),
    };
    hideMessage();
    if (diff.approximate) showMessage('This file changed too much to diff precisely; it is shown as fully replaced.', 'info');
    if (!diff.lines.length) showMessage('This file is empty.', 'info');

    this.display({ file, diff, sources }, revealed);
    if (!this.scroller.contains(document.activeElement) && !element('#ds-sidebar').contains(document.activeElement)) {
      this.scroller.focus({ preventScroll: true });
    }
  }

  /** Draws a loaded file in the current layout, with its minimap and links to GitHub's comments. */
  private display(view: FileView, revealed: Promise<boolean>): void {
    const { file, diff } = view;
    const rendered = renderDiff(this.scroller, diff, view.sources, this.layout);
    const minimap = new Minimap(element('#ds-minimap'), this.scroller, diff.lines, LINE_HEIGHT, rendered);
    const request = this.request(file);
    const { sourceTabId, anchor } = request;
    const comments =
      sourceTabId !== undefined && anchor
        ? new GitHubComments({ ...request, sourceTabId, anchor }, diff.lines, this.scroller, rendered, minimap, (text) =>
            showMessage(text, 'info'),
          )
        : undefined;
    this.shown = { view, rendered, minimap, comments };
    // GitHub may still be rendering the file it was just scrolled to; read its lines again once it is likely done.
    void revealed.then(async (ok) => {
      if (!ok) return;
      await delay(GITHUB_RENDER_DELAY_MS);
      if (this.shown?.comments === comments) await comments?.refresh();
    });

    const topLine = this.topLines.get(file.path);
    const firstChange = findChangeBlocks(diff.lines)[0];
    if (topLine !== undefined) rendered.scrollToLine(topLine);
    else if (firstChange) rendered.scrollToLine(Math.max(0, firstChange.start - CONTEXT_ABOVE_FIRST_CHANGE));
  }

  private hideFile(): void {
    if (!this.shown) return;
    this.topLines.set(this.shown.view.file.path, this.shown.rendered.topLine());
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