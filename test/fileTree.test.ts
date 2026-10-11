// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFileTree, FileTree, matchesFilter, treeOrder } from '../src/review/fileTree';
import { clampSidebarWidth } from '../src/review/sidebar';
import type { PullRequestFile } from '../src/shared/types';

const FILES: PullRequestFile[] = [
  { path: 'README.md', status: 'modified', additions: 3, deletions: 1 },
  { path: 'src/vs/editor/b.ts', status: 'added' },
  { path: 'src/vs/editor/a10.ts', status: 'modified' },
  { path: 'src/vs/editor/a9.ts', status: 'deleted' },
  { path: 'src/vs/base/util.ts', oldPath: 'src/vs/base/helpers.ts', status: 'renamed' },
  { path: 'test/Z.ts' },
];

function names(nodes: ReturnType<typeof buildFileTree>): unknown[] {
  return nodes.map((node) => (node.kind === 'file' ? node.name : { [node.name]: names(node.children) }));
}

describe('buildFileTree', () => {
  it('lists folders first, sorts names naturally and merges single-folder chains', () => {
    expect(names(buildFileTree(FILES))).toEqual([
      { 'src/vs': [{ base: ['util.ts'] }, { editor: ['a9.ts', 'a10.ts', 'b.ts'] }] },
      { test: ['Z.ts'] },
      'README.md',
    ]);
  });

  it('keeps the full path of merged folders', () => {
    const [src] = buildFileTree(FILES);
    expect(src).toMatchObject({ kind: 'directory', name: 'src/vs', path: 'src/vs' });
  });
});

describe('treeOrder', () => {
  it('returns files top to bottom as the tree shows them', () => {
    expect(treeOrder(buildFileTree(FILES)).map((file) => file.path)).toEqual([
      'src/vs/base/util.ts',
      'src/vs/editor/a9.ts',
      'src/vs/editor/a10.ts',
      'src/vs/editor/b.ts',
      'test/Z.ts',
      'README.md',
    ]);
  });
});

describe('matchesFilter', () => {
  it('matches any part of the path, ignoring case, including the old path of renames', () => {
    expect(matchesFilter(FILES[1], 'EDITOR/b')).toBe(true);
    expect(matchesFilter(FILES[4], 'helpers')).toBe(true);
    expect(matchesFilter(FILES[0], 'src')).toBe(false);
    expect(matchesFilter(FILES[0], '  ')).toBe(true);
  });
});

describe('FileTree', () => {
  let host: HTMLElement;
  let onSelect: ReturnType<typeof vi.fn<(file: PullRequestFile) => void>>;
  let tree: FileTree;

  const row = (path: string) => host.querySelector<HTMLElement>(`.ds-tree-file[data-path="${path}"]`)!;
  const folder = (path: string) => host.querySelector<HTMLElement>(`.ds-tree-folder[data-folder="${path}"]`)!;

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    document.body.innerHTML = '<nav></nav>';
    host = document.querySelector('nav')!;
    onSelect = vi.fn();
    tree = new FileTree(host, FILES, onSelect);
  });

  it('shows every file with its status and the file count', () => {
    expect(host.querySelectorAll('.ds-tree-file')).toHaveLength(FILES.length);
    expect(row('src/vs/base/util.ts').querySelector('.ds-tree-status')!.textContent).toBe('R');
    expect(row('test/Z.ts').querySelector('.ds-tree-status')!.textContent).toBe('');
    expect(host.querySelector('.ds-files-count')!.textContent).toBe('6');
  });

  it('shows changed line counts when they are known', () => {
    expect(row('README.md').querySelector('.ds-tree-delta')!.textContent).toBe('+3−1');
    expect(row('test/Z.ts').querySelector('.ds-tree-delta')).toBeNull();
  });

  it('opens a file when its row is clicked', () => {
    row('README.md').click();
    expect(onSelect).toHaveBeenCalledWith(FILES[0]);
  });

  it('folds folders on click and unfolds them to show the active file', () => {
    folder('src/vs/editor').click();
    expect(folder('src/vs/editor').getAttribute('aria-expanded')).toBe('false');
    expect(row('src/vs/editor/b.ts').closest('[hidden]')).not.toBeNull();
    expect(onSelect).not.toHaveBeenCalled();

    tree.setActive('src/vs/editor/b.ts');
    expect(row('src/vs/editor/b.ts').closest('[hidden]')).toBeNull();
    expect(row('src/vs/editor/b.ts').getAttribute('aria-selected')).toBe('true');
    expect(row('src/vs/editor/b.ts').tabIndex).toBe(0);
  });

  it('finds the next and previous file in tree order', () => {
    expect(tree.neighbour('src/vs/editor/b.ts', 1)?.path).toBe('test/Z.ts');
    expect(tree.neighbour('src/vs/base/util.ts', -1)).toBeUndefined();
  });

  it('filters files by path', async () => {
    vi.useFakeTimers();
    try {
      const input = host.querySelector<HTMLInputElement>('.ds-files-filter')!;
      input.value = 'editor';
      input.dispatchEvent(new Event('input'));
      await vi.advanceTimersByTimeAsync(150);
      expect([...host.querySelectorAll<HTMLElement>('.ds-tree-file')].map((file) => file.dataset.path)).toEqual([
        'src/vs/editor/a9.ts',
        'src/vs/editor/a10.ts',
        'src/vs/editor/b.ts',
      ]);
      expect(host.querySelector('.ds-files-count')!.textContent).toBe('3 of 6');
      expect(tree.neighbour('src/vs/editor/b.ts', 1)).toBeUndefined();
      expect(host.querySelector<HTMLElement>('.ds-files-empty')!.hidden).toBe(true);

      input.value = 'nothing-matches';
      input.dispatchEvent(new Event('input'));
      await vi.advanceTimersByTimeAsync(150);
      expect(host.querySelector<HTMLElement>('.ds-files-empty')!.hidden).toBe(false);
      expect(host.querySelector<HTMLElement>('.ds-tree')!.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves between rows with the arrow keys', () => {
    const first = host.querySelector<HTMLElement>('.ds-tree-row')!;
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(folder('src/vs/base'));
    folder('src/vs/base').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(folder('src/vs/base').getAttribute('aria-expanded')).toBe('false');
    folder('src/vs/base').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.activeElement).toBe(folder('src/vs'));
  });
});

describe('clampSidebarWidth', () => {
  it('keeps the sidebar between a minimum and a share of the window', () => {
    expect(clampSidebarWidth(300, 1600)).toBe(300);
    expect(clampSidebarWidth(40, 1600)).toBe(160);
    expect(clampSidebarWidth(1500, 1000)).toBe(600);
    expect(clampSidebarWidth(Number.NaN, 1000)).toBe(300);
  });
});
