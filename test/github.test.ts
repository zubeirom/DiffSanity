// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractPageRevisions, findFileHeaders, resolveTheme } from '../src/content/github';
import { injectButtons } from '../src/content/injectButton';

const BASE = '8571e6fd2f04a40dc0341c05897b93ff132b06f8';
const HEAD = 'dc73b1a01be8002c3b3c764a1fb4840d05562094';

// Trimmed from the live classic "Files changed" markup.
const CLASSIC = `
<div id="files" class="diff-view">
  <div class="file js-file" id="diff-aaa" data-tagsearch-path="src/app.ts">
    <div class="file-header" data-path="src/app.ts" data-anchor="diff-aaa" data-file-deleted="false">
      <div class="file-info"><a title="src/app.ts" class="Link--primary" href="#diff-aaa">src/app.ts</a></div>
      <div class="file-actions"><a href="/o/r/blob/${HEAD}/src/app.ts">View file</a></div>
    </div>
  </div>
  <div class="file js-file" id="diff-bbb">
    <div class="file-header" data-path="src/dataTransfer.ts" data-anchor="diff-bbb" data-file-deleted="false">
      <div class="file-info"><a title="src/dnd.ts → src/dataTransfer.ts" class="Link--primary" href="#diff-bbb">src/dnd.ts → src/dataTransfer.ts</a></div>
    </div>
  </div>
  <div class="file js-file" id="diff-ccc">
    <div class="file-header" data-path="old.txt" data-anchor="diff-ccc" data-file-deleted="true">
      <div class="file-info"><a class="Link--primary" href="#diff-ccc">old.txt</a></div>
    </div>
  </div>
  <include-fragment data-url="/o/r/pull/1/show_partial_comparison?base_commit_oid=${BASE}&end_commit_oid=${HEAD}"></include-fragment>
</div>`;

// Shape of the React "new files changed" header.
const REACT = `
<div class="DiffFileHeader-module__diff-file-header--abc">
  <h3 class="DiffFileHeader-module__file-name--x"><a href="#diff-ddd">lib/util.py</a></h3>
  <button data-file-path="lib/util.py">Expand all lines</button>
</div>`;

beforeEach(() => {
  document.documentElement.removeAttribute('data-color-mode');
  document.body.innerHTML = '';
});

describe('findFileHeaders', () => {
  it('reads classic headers, including renames and deletions', () => {
    document.body.innerHTML = CLASSIC;
    const files = findFileHeaders();
    expect(files.map(({ path, oldPath, status, anchor }) => ({ path, oldPath, status, anchor }))).toEqual([
      { path: 'src/app.ts', oldPath: undefined, status: undefined, anchor: 'diff-aaa' },
      { path: 'src/dataTransfer.ts', oldPath: 'src/dnd.ts', status: 'renamed', anchor: 'diff-bbb' },
      { path: 'old.txt', oldPath: undefined, status: 'deleted', anchor: 'diff-ccc' },
    ]);
    expect(files[0].target.classList.contains('file-info')).toBe(true);
  });

  it('reads React headers', () => {
    document.body.innerHTML = REACT;
    const [file] = findFileHeaders();
    expect(file).toMatchObject({ path: 'lib/util.py', anchor: 'diff-ddd', position: 'afterend' });
    expect(file.target.tagName).toBe('H3');
  });

  it('ignores headings that are not file headers', () => {
    document.body.innerHTML = '<h3><a href="#readme">Readme</a></h3>';
    expect(findFileHeaders()).toEqual([]);
  });
});

describe('injectButtons', () => {
  it('adds exactly one button per file, even when called repeatedly', () => {
    document.body.innerHTML = CLASSIC + REACT;
    const onOpen = vi.fn();
    expect(injectButtons(onOpen)).toBe(4);
    expect(injectButtons(onOpen)).toBe(0);
    expect(document.querySelectorAll('.diffsanity-button')).toHaveLength(4);
  });

  it('passes the file that was clicked', () => {
    document.body.innerHTML = CLASSIC;
    const onOpen = vi.fn();
    injectButtons(onOpen);
    document.querySelectorAll<HTMLButtonElement>('.diffsanity-button')[1].click();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen.mock.calls[0][0]).toMatchObject({ path: 'src/dataTransfer.ts', oldPath: 'src/dnd.ts' });
  });
});

describe('extractPageRevisions', () => {
  it('reads commits from lazy-loaded fragment URLs', () => {
    document.body.innerHTML = CLASSIC;
    expect(extractPageRevisions()).toEqual({ baseSha: BASE, headSha: HEAD });
  });

  it('returns nothing when the page has no commit information', () => {
    document.body.innerHTML = REACT;
    expect(extractPageRevisions()).toEqual({ baseSha: undefined, headSha: undefined });
  });
});

describe('resolveTheme', () => {
  it("follows GitHub's explicit colour mode", () => {
    document.documentElement.dataset.colorMode = 'dark';
    expect(resolveTheme()).toBe('dark');
    document.documentElement.dataset.colorMode = 'light';
    expect(resolveTheme()).toBe('light');
  });

  it('follows the OS in auto mode', () => {
    document.documentElement.dataset.colorMode = 'auto';
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    expect(resolveTheme()).toBe('dark');
  });
});
