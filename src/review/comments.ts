/**
 * Links the review page to GitHub's own commenting. DiffSanity never posts comments itself:
 * the "+" button and thread markers switch to the GitHub tab the file was opened from and act there.
 */
import type { DiffLine, GitHubLineInfo, GoToLineResponse, Message, PullRequestRef, ReviewRequest } from '../shared/types';
import type { Minimap } from './minimap';
import type { RenderedDiff } from './renderer';
import { focusReviewTab, sendToSourceTab } from './sourceTab';

export interface CommentTargets {
  canComment: boolean;
  /** GitHub line key of every diff line that GitHub renders, by line index. */
  keys: Map<number, string>;
  /** Number of review threads, by line index. */
  threads: Map<number, number>;
}

const NO_LINE_INFO: GitHubLineInfo = { canComment: false, lines: [], threads: {} };

/** GitHub keys that may identify a line, new-file key first (GitHub's choice for unchanged lines). */
function candidateKeys(line: DiffLine): string[] {
  const keys: string[] = [];
  if (line.type !== 'deletion' && line.newLineNumber) keys.push(`R${line.newLineNumber}`);
  if (line.type !== 'addition' && line.oldLineNumber) keys.push(`L${line.oldLineNumber}`);
  return keys;
}

/** Matches what the GitHub tab shows to the lines of the full-file diff. */
export function mapLineInfo(lines: readonly DiffLine[], info: GitHubLineInfo): CommentTargets {
  const rendered = new Set(info.lines);
  const indexByKey = new Map<string, number>();
  const keys = new Map<number, string>();
  lines.forEach((line, index) => {
    const candidates = candidateKeys(line);
    for (const key of candidates) indexByKey.set(key, index);
    const key = candidates.find((candidate) => rendered.has(candidate));
    if (key) keys.set(index, key);
  });

  const threads = new Map<number, number>();
  for (const [key, count] of Object.entries(info.threads)) {
    const index = indexByKey.get(key);
    if (index !== undefined && keys.has(index)) threads.set(index, (threads.get(index) ?? 0) + count);
  }
  return { canComment: info.canComment, keys, threads };
}

function describeLine(key: string): string {
  return `${key.startsWith('L') ? 'old line' : 'line'} ${key.slice(1)}`;
}

export class GitHubComments {
  private targets: CommentTargets = mapLineInfo([], NO_LINE_INFO);
  private readonly addButton = document.createElement('button');
  private markers: HTMLElement[] = [];
  private destroyed = false;
  private readonly pullRequest: PullRequestRef;

  constructor(
    private readonly request: ReviewRequest & { sourceTabId: number; anchor: string },
    private readonly lines: readonly DiffLine[],
    private readonly scroller: HTMLElement,
    private readonly rendered: RenderedDiff,
    private readonly minimap: Minimap,
    private readonly showMessage: (text: string) => void,
  ) {
    this.pullRequest = { owner: request.owner, repo: request.repo, pr: request.pr };
    this.addButton.type = 'button';
    this.addButton.className = 'ds-comment-add';
    this.addButton.textContent = '+';
    scroller.addEventListener('mouseover', this.onMouseOver, { passive: true });
    scroller.addEventListener('mouseleave', this.onMouseLeave);
    scroller.addEventListener('click', this.onClick);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    void this.refresh();
  }

  /** Removes the buttons and listeners, e.g. before another file is shown. */
  destroy(): void {
    this.destroyed = true;
    this.scroller.removeEventListener('mouseover', this.onMouseOver);
    this.scroller.removeEventListener('mouseleave', this.onMouseLeave);
    this.scroller.removeEventListener('click', this.onClick);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.addButton.remove();
    for (const marker of this.markers) marker.remove();
    this.markers = [];
  }

  /** Re-reads the GitHub tab, e.g. after the user commented there. */
  async refresh(): Promise<void> {
    const message: Message = { type: 'diffsanity:lineInfo', pullRequest: this.pullRequest, anchor: this.request.anchor };
    let info: GitHubLineInfo | undefined;
    try {
      info = await chrome.tabs.sendMessage(this.request.sourceTabId, message);
    } catch {
      // The tab is closed, or runs a content script from before an extension reload.
    }
    if (this.destroyed) return;
    this.targets = mapLineInfo(this.lines, info ?? NO_LINE_INFO);
    this.addButton.remove();
    this.renderThreadMarkers();
  }

  private renderThreadMarkers(): void {
    for (const marker of this.markers) marker.remove();
    this.markers = [];
    for (const [index, count] of this.targets.threads) {
      const gutter = this.rendered.row(index)?.querySelector('.ds-gutter');
      if (!gutter) continue;
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'ds-thread-marker';
      marker.dataset.line = String(index);
      marker.textContent = String(count);
      marker.title = `${count} comment thread${count === 1 ? '' : 's'} on ${describeLine(this.targets.keys.get(index)!)} — view on GitHub`;
      gutter.append(marker);
      this.markers.push(marker);
    }
    this.minimap.setThreadLines([...this.targets.threads.keys()]);
  }

  private readonly onMouseOver = (event: MouseEvent) => {
    if (!this.targets.canComment) return;
    const hit = this.rendered.lineAt(event.clientX, event.clientY);
    const index = hit?.index ?? -1;
    const key = this.targets.keys.get(index);
    // Lines with threads already have a marker that leads to the conversation.
    const gutter = key && !this.targets.threads.has(index) ? hit?.row.querySelector('.ds-gutter') : null;
    if (!gutter) {
      this.addButton.remove();
      return;
    }
    if (this.addButton.parentElement === gutter) return;
    this.addButton.dataset.line = String(index);
    this.addButton.title = `Comment on ${describeLine(key!)} on GitHub`;
    gutter.append(this.addButton);
  };

  private readonly onMouseLeave = () => this.addButton.remove();

  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void this.refresh();
  };

  private readonly onClick = (event: MouseEvent) => {
    const button = (event.target as Element).closest<HTMLElement>('.ds-comment-add, .ds-thread-marker');
    if (!button || !this.scroller.contains(button)) return;
    void this.goToGitHub(Number(button.dataset.line), button === this.addButton);
  };

  private async goToGitHub(index: number, startComment: boolean): Promise<void> {
    const lineKey = this.targets.keys.get(index);
    if (!lineKey) return;
    const { sourceTabId, anchor } = this.request;
    const message: Message = { type: 'diffsanity:goToLine', pullRequest: this.pullRequest, anchor, lineKey, startComment };
    const response = await sendToSourceTab<GoToLineResponse>(sourceTabId, message);
    if (response?.found) return;

    // Come back and explain instead of leaving the user on a GitHub page where nothing happened.
    await focusReviewTab();
    this.showMessage('Could not find this line on the GitHub tab. Reload the pull request there and try again.');
    void this.refresh();
  }
}
