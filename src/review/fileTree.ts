import type { PullRequestFile } from '../shared/types';
import { STATUS_LABELS, STATUS_LETTERS } from './fileStatus';

/** A node of the changed-files tree. */
export type FileTreeNode =
  | { kind: 'directory'; name: string; path: string; children: FileTreeNode[] }
  | { kind: 'file'; name: string; file: PullRequestFile };

interface Directory {
  name: string;
  path: string;
  directories: Map<string, Directory>;
  files: PullRequestFile[];
}

const FILTER_DELAY_MS = 100;

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

function toNodes(directory: Directory): FileTreeNode[] {
  const directories = [...directory.directories.values()]
    .sort((a, b) => compareNames(a.name, b.name))
    .map(toDirectoryNode);
  const files = directory.files
    .map((file): FileTreeNode => ({ kind: 'file', name: baseName(file.path), file }))
    .sort((a, b) => compareNames(a.name, b.name));
  return [...directories, ...files];
}

/** Merges chains of directories that only contain one directory, as GitHub does (`src/vs/editor`). */
function toDirectoryNode(directory: Directory): FileTreeNode {
  let current = directory;
  let name = directory.name;
  while (!current.files.length && current.directories.size === 1) {
    current = current.directories.values().next().value!;
    name += `/${current.name}`;
  }
  return { kind: 'directory', name, path: current.path, children: toNodes(current) };
}

/** Groups files into folders: folders first, then files, each sorted by name. */
export function buildFileTree(files: readonly PullRequestFile[]): FileTreeNode[] {
  const root: Directory = { name: '', path: '', directories: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let directory = root;
    for (const part of parts.slice(0, -1)) {
      let child = directory.directories.get(part);
      if (!child) {
        child = { name: part, path: directory.path ? `${directory.path}/${part}` : part, directories: new Map(), files: [] };
        directory.directories.set(part, child);
      }
      directory = child;
    }
    directory.files.push(file);
  }
  return toNodes(root);
}

/** Files in the order the tree shows them, top to bottom. */
export function treeOrder(nodes: readonly FileTreeNode[]): PullRequestFile[] {
  return nodes.flatMap((node) => (node.kind === 'file' ? [node.file] : treeOrder(node.children)));
}

/** True when a file matches the filter text (a case-insensitive part of its path). */
export function matchesFilter(file: PullRequestFile, filter: string): boolean {
  const query = filter.trim().toLowerCase();
  return !query || file.path.toLowerCase().includes(query) || !!file.oldPath?.toLowerCase().includes(query);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  created.className = className;
  if (text !== undefined) created.textContent = text;
  return created;
}

const SEARCH_ICON =
  'M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z';
const FOLDER_ICON =
  'M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z';

/** A 16-unit Octicon-style icon. */
function icon(path: string, size: number): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(namespace, 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}

function describeFile(file: PullRequestFile): string {
  const lines = [file.oldPath ? `${file.oldPath} → ${file.path}` : file.path];
  if (file.status) lines.push(STATUS_LABELS[file.status]);
  if (file.additions !== undefined && file.deletions !== undefined) lines.push(`+${file.additions} −${file.deletions}`);
  return lines.join('\n');
}

/**
 * Sidebar list of the pull request's changed files, shown as a folder tree like GitHub's.
 * Keyboard: arrow keys move between rows, Left/Right fold folders, Enter opens a file.
 */
export class FileTree {
  private readonly filterInput = element('input', 'ds-files-filter');
  private readonly count = element('span', 'ds-files-count');
  private readonly tree = element('ul', 'ds-tree');
  private readonly empty = element('p', 'ds-files-empty', 'No files match this filter.');
  private readonly byPath: Map<string, PullRequestFile>;
  private readonly collapsed = new Set<string>();
  private shown: PullRequestFile[] = [];
  private activePath: string | undefined;
  private filterTimer: number | undefined;

  constructor(
    host: HTMLElement,
    private readonly files: readonly PullRequestFile[],
    private readonly onSelect: (file: PullRequestFile) => void,
  ) {
    this.byPath = new Map(files.map((file) => [file.path, file]));
    this.filterInput.type = 'search';
    this.filterInput.placeholder = 'Filter files…';
    this.filterInput.setAttribute('aria-label', 'Filter changed files');
    this.filterInput.addEventListener('input', this.onFilterInput);
    this.filterInput.addEventListener('keydown', this.onFilterKeyDown);
    this.tree.setAttribute('role', 'tree');
    this.tree.setAttribute('aria-label', 'Changed files');
    this.tree.addEventListener('click', this.onClick);
    this.tree.addEventListener('keydown', this.onKeyDown);

    const title = element('h2', 'ds-files-title', 'Files changed');
    title.append(this.count);
    const search = element('div', 'ds-files-search');
    search.append(icon(SEARCH_ICON, 14), this.filterInput);
    const head = element('div', 'ds-files-head');
    head.append(title, search);
    host.replaceChildren(head, this.tree, this.empty);
    this.render();
  }

  /** Highlights the file under review and makes sure its row is visible. */
  setActive(path: string): void {
    this.activePath = path;
    let unfolded = false;
    for (const folder of this.collapsed) {
      if (path.startsWith(`${folder}/`)) unfolded = this.collapsed.delete(folder) || unfolded;
    }
    if (unfolded) this.render();
    for (const row of this.tree.querySelectorAll<HTMLElement>('.ds-tree-file')) {
      const active = row.dataset.path === path;
      row.setAttribute('aria-selected', String(active));
      if (active) row.scrollIntoView({ block: 'nearest' });
    }
    this.updateTabStop();
  }

  /** The file before or after `path` in the tree, among the files the filter shows. */
  neighbour(path: string, step: 1 | -1): PullRequestFile | undefined {
    const index = this.shown.findIndex((file) => file.path === path);
    return index < 0 ? undefined : this.shown[index + step];
  }

  private render(): void {
    const filter = this.filterInput.value;
    const nodes = buildFileTree(this.files.filter((file) => matchesFilter(file, filter)));
    this.shown = treeOrder(nodes);
    this.tree.replaceChildren(...nodes.map((node) => this.renderNode(node, 1, !!filter.trim())));
    const total = this.files.length;
    this.count.textContent = this.shown.length === total ? String(total) : `${this.shown.length} of ${total}`;
    this.count.title = `${this.shown.length} of ${total} file${total === 1 ? '' : 's'} shown`;
    this.empty.hidden = this.shown.length > 0;
    this.tree.hidden = !this.empty.hidden;
    for (const row of this.tree.querySelectorAll<HTMLElement>('.ds-tree-file')) {
      row.setAttribute('aria-selected', String(row.dataset.path === this.activePath));
    }
    this.updateTabStop();
  }

  private renderNode(node: FileTreeNode, level: number, filtering: boolean): HTMLLIElement {
    const item = element('li', 'ds-tree-item');
    item.setAttribute('role', 'none');
    const row = element('button', 'ds-tree-row');
    row.type = 'button';
    row.tabIndex = -1;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(level));
    row.style.setProperty('--ds-tree-level', String(level - 1));
    item.append(row);

    if (node.kind === 'file') {
      const { file } = node;
      row.classList.add('ds-tree-file');
      row.dataset.path = file.path;
      row.title = describeFile(file);
      const status = element('span', 'ds-tree-status', file.status ? STATUS_LETTERS[file.status] : '');
      if (file.status) {
        status.dataset.status = file.status;
        status.title = STATUS_LABELS[file.status];
      }
      row.append(status, element('span', 'ds-tree-name', node.name));
      if (file.additions !== undefined && file.deletions !== undefined) {
        const delta = element('span', 'ds-tree-delta');
        delta.setAttribute('aria-hidden', 'true');
        if (file.additions) delta.append(element('span', 'ds-tree-delta-add', `+${file.additions}`));
        if (file.deletions) delta.append(element('span', 'ds-tree-delta-del', `−${file.deletions}`));
        row.append(delta);
      }
      return item;
    }

    // Folders stay open while filtering, so every match is visible.
    const open = filtering || !this.collapsed.has(node.path);
    row.classList.add('ds-tree-folder');
    row.dataset.folder = node.path;
    row.title = node.path;
    row.setAttribute('aria-expanded', String(open));
    row.append(element('span', 'ds-tree-chevron'), icon(FOLDER_ICON, 14), element('span', 'ds-tree-name', node.name));
    const group = element('ul', 'ds-tree-group');
    group.setAttribute('role', 'group');
    group.hidden = !open;
    group.append(...node.children.map((child) => this.renderNode(child, level + 1, filtering)));
    item.append(group);
    return item;
  }

  /** Only one row is in the Tab order: the active file, or else the first row. */
  private updateTabStop(): void {
    const rows = this.visibleRows();
    const stop = rows.find((row) => row.getAttribute('aria-selected') === 'true') ?? rows[0];
    for (const row of rows) row.tabIndex = row === stop ? 0 : -1;
  }

  private visibleRows(): HTMLElement[] {
    return [...this.tree.querySelectorAll<HTMLElement>('.ds-tree-row')].filter((row) => !row.closest('[hidden]'));
  }

  private toggleFolder(row: HTMLElement, open: boolean): void {
    const folder = row.dataset.folder;
    if (!folder || row.getAttribute('aria-expanded') === String(open)) return;
    if (open) this.collapsed.delete(folder);
    else this.collapsed.add(folder);
    row.setAttribute('aria-expanded', String(open));
    const group = row.nextElementSibling as HTMLElement | null;
    if (group) group.hidden = !open;
  }

  private focusRow(row: HTMLElement | undefined): void {
    if (!row) return;
    for (const other of this.tree.querySelectorAll<HTMLElement>('.ds-tree-row')) other.tabIndex = -1;
    row.tabIndex = 0;
    row.focus();
  }

  private readonly onClick = (event: MouseEvent) => {
    const row = (event.target as Element).closest<HTMLElement>('.ds-tree-row');
    if (!row) return;
    if (row.dataset.folder) {
      this.toggleFolder(row, row.getAttribute('aria-expanded') !== 'true');
      return;
    }
    const file = this.byPath.get(row.dataset.path ?? '');
    if (file) this.onSelect(file);
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const row = (event.target as Element).closest<HTMLElement>('.ds-tree-row');
    if (!row || event.altKey || event.ctrlKey || event.metaKey) return;
    const rows = this.visibleRows();
    const index = rows.indexOf(row);
    const expanded = row.getAttribute('aria-expanded');
    switch (event.key) {
      case 'ArrowDown':
        this.focusRow(rows[index + 1]);
        break;
      case 'ArrowUp':
        this.focusRow(rows[index - 1]);
        break;
      case 'Home':
        this.focusRow(rows[0]);
        break;
      case 'End':
        this.focusRow(rows[rows.length - 1]);
        break;
      case 'ArrowRight':
        if (expanded === 'false') this.toggleFolder(row, true);
        else if (expanded === 'true') this.focusRow(rows[index + 1]);
        break;
      case 'ArrowLeft':
        if (expanded === 'true') this.toggleFolder(row, false);
        else this.focusRow(row.closest('.ds-tree-group')?.previousElementSibling as HTMLElement | undefined);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  private readonly onFilterInput = () => {
    window.clearTimeout(this.filterTimer);
    this.filterTimer = window.setTimeout(() => this.render(), FILTER_DELAY_MS);
  };

  private readonly onFilterKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.focusRow(this.visibleRows()[0]);
    } else if (event.key === 'Escape' && this.filterInput.value) {
      event.preventDefault();
      this.filterInput.value = '';
      this.render();
    }
  };
}
