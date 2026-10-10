// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractPageRevisions, findFileHeaders, readLineInfo, resolveTheme, revealLine } from '../src/content/github';
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

// React diff rows: keys on the code cell, threads rendered inside it.
const REACT_LINES = `
<meta name="user-login" content="octocat">
<div id="diff-abc">
  <table><tbody>
    <tr class="diff-line-row"><td data-line-number="1"></td><td data-line-number="1"></td>
      <td class="diff-text-cell" tabindex="-1" data-line-anchor="diff-abcR1">ctx</td></tr>
    <tr class="diff-line-row"><td data-line-number="2"></td><td></td>
      <td class="diff-text-cell" tabindex="-1" data-line-anchor="diff-abcL2">old</td></tr>
    <tr class="diff-line-row"><td></td><td data-line-number="2"></td>
      <td class="diff-text-cell" tabindex="-1" data-line-anchor="diff-abcR2">new
        <div data-inline-markers><div data-marker-id="7" data-first-marker></div><div data-marker-id="8"></div></div></td></tr>
  </tbody></table>
</div>
<div id="diff-abcd"><table><tbody><tr><td data-line-anchor="diff-abcdR9"></td></tr></tbody></table></div>`;

// Classic diff rows: keys on the number cells, threads in the following row.
const CLASSIC_LINES = `
<div id="diff-abc">
  <table><tbody>
    <tr><td id="diff-abcL5" data-line-number="5"></td><td id="diff-abcR5" data-line-number="5"></td>
      <td class="blob-code"><button class="js-add-line-comment">+</button>ctx</td></tr>
    <tr class="inline-comments"><td><turbo-frame id="review-thread-or-comment-id-1"></turbo-frame>
      <turbo-frame id="review-thread-or-comment-id-2"></turbo-frame></td></tr>
    <tr><td id="diff-abcL6" data-line-number="6"></td><td></td><td class="blob-code">old</td></tr>
  </tbody></table>
</div>`;

describe('readLineInfo', () => {
  it('reads React lines and threads of one file', () => {
    document.body.innerHTML = REACT_LINES;
    expect(readLineInfo('diff-abc')).toEqual({ canComment: true, lines: ['R1', 'L2', 'R2'], threads: { R2: 2 } });
  });

  it('reads classic lines and threads', () => {
    document.body.innerHTML = CLASSIC_LINES;
    expect(readLineInfo('diff-abc')).toEqual({ canComment: false, lines: ['L5', 'R5', 'L6'], threads: { R5: 2 } });
  });

  it('returns nothing for files that are not rendered or invalid anchors', () => {
    document.body.innerHTML = REACT_LINES;
    expect(readLineInfo('diff-zzz').lines).toEqual([]);
    expect(readLineInfo('diff-abc"]').lines).toEqual([]);
  });
});

describe('revealLine', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('opens the React comment box, which only appears once the line is focused', async () => {
    document.body.innerHTML = REACT_LINES;
    const cell = document.querySelector<HTMLElement>('[data-line-anchor="diff-abcL2"]')!;
    const onComment = vi.fn();
    cell.addEventListener('focus', () => {
      const button = document.createElement('button');
      button.dataset.addCommentButton = 'true';
      button.addEventListener('click', onComment);
      cell.append(button);
    });

    await expect(revealLine('diff-abc', 'L2', true)).resolves.toEqual({ found: true, commentBoxOpened: true });
    expect(cell.closest('tr')!.scrollIntoView).toHaveBeenCalled();
    expect(onComment).toHaveBeenCalledOnce();
  });

  it('opens the classic comment box from a line-number cell', async () => {
    document.body.innerHTML = CLASSIC_LINES;
    const onComment = vi.fn();
    document.querySelector('.js-add-line-comment')!.addEventListener('click', onComment);
    await expect(revealLine('diff-abc', 'R5', true)).resolves.toEqual({ found: true, commentBoxOpened: true });
    expect(onComment).toHaveBeenCalledOnce();
  });

  it('only scrolls when no comment is wanted', async () => {
    document.body.innerHTML = CLASSIC_LINES;
    const onComment = vi.fn();
    document.querySelector('.js-add-line-comment')!.addEventListener('click', onComment);
    await expect(revealLine('diff-abc', 'R5', false)).resolves.toEqual({ found: true, commentBoxOpened: false });
    expect(onComment).not.toHaveBeenCalled();
  });

  it('gives up when GitHub offers no comment button', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = REACT_LINES;
      const result = revealLine('diff-abc', 'R1', true);
      await vi.advanceTimersByTimeAsync(1100);
      await expect(result).resolves.toEqual({ found: true, commentBoxOpened: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports lines that are not rendered', async () => {
    document.body.innerHTML = REACT_LINES;
    await expect(revealLine('diff-abc', 'R40', true)).resolves.toEqual({ found: false, commentBoxOpened: false });
    await expect(revealLine('diff-abc', 'X1', true)).resolves.toEqual({ found: false, commentBoxOpened: false });
  });
});
