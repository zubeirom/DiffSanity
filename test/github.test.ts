// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractPageRevisions,
  extractPullRequestFiles,
  findFileHeaders,
  openApproval,
  readLineInfo,
  resolveTheme,
  revealFile,
  revealLine,
} from '../src/content/github';
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
  <div class="d-flex flex-shrink-0"><button>Collapse file</button></div>
  <div class="d-flex DiffFileHeader-module__file-path-section--y">
    <h3 class="DiffFileHeader-module__file-name--x"><a href="#diff-ddd">lib/util.py</a></h3>
    <button>Copy file name</button>
    <button data-file-path="lib/util.py">Expand all lines</button>
  </div>
</div>`;

// Trimmed from a live React header for an added file: no `[data-file-path]` button, and GitHub wraps the name in U+200E marks.
const REACT_ADDED = `
<div class="DiffFileHeader-module__diff-file-header__UuNN4">
  <div class="d-flex flex-shrink-0"><button aria-labelledby="_r_g3_"></button></div>
  <div class="d-flex px-1 flex-items-center overflow-hidden DiffFileHeader-module__file-path-section__ZcmB1">
    <h3 class="DiffFileHeader-module__file-name__VVXpg"><a class="Link--primary" href="#diff-eee"><code>\u200Esrc/OfficeAgent/TokenSource.cs\u200E</code></a></h3>
    <button aria-labelledby="_r_g6_"></button>
  </div>
</div>`;

// Trimmed from a live React header for a renamed file: the visible names are shortened, the full text is for screen readers.
const REACT_RENAMED = `
<div class="DiffFileHeader-module__diff-file-header__UuNN4">
  <div class="d-flex px-1 flex-items-center overflow-hidden DiffFileHeader-module__file-path-section__ZcmB1">
    <h3 class="DiffFileHeader-module__file-name__VVXpg"><a class="Link--primary" href="#diff-fff"><code>
      <span aria-hidden="true">\u200E…/BusinessDetector.cs\u200E → \u200E…/AuthoredDetector.cs\u200E</span>
      <span class="sr-only">runtime/Startup/BusinessDetector.cs renamed to runtime/Startup/AuthoredDetector.cs</span>
    </code></a></h3>
    <button data-file-path="runtime/Startup/AuthoredDetector.cs">Expand all lines</button>
  </div>
</div>`;

// Trimmed from the live React page's embedded data; \`diffContents\` only covers the files GitHub preloaded.
function reactEmbeddedData(pr: number): string {
  const route = {
    pullRequest: { number: pr },
    diffSummaries: [
      { path: 'src/app.ts', pathDigest: 'aaa', changeType: 'MODIFIED', linesAdded: 3, linesDeleted: 1 },
      { path: 'src/new.ts', pathDigest: 'bbb', changeType: 'RENAMED', linesAdded: 0, linesDeleted: 0 },
      { path: 'runtime/Startup/AuthoredDetector.cs', pathDigest: 'fff', changeType: 'RENAMED', linesAdded: 4, linesDeleted: 2 },
      { path: 'gone.txt', pathDigest: 'ccc', changeType: 'REMOVED', linesAdded: 0, linesDeleted: 7 },
    ],
    diffContents: [{ path: 'src/new.ts', oldTreeEntry: { path: 'src/old.ts' }, newTreeEntry: { path: 'src/new.ts' } }],
  };
  return `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
    payload: { pullRequestsChangesRoute: route },
  })}</script>`;
}

// Trimmed from the live classic \`<file-tree>\` sidebar.
const CLASSIC_TREE = `
<file-tree>
  <ul>
    <li data-tree-entry-type="directory"><span data-filterable-item-text hidden>src</span></li>
    <li id="file-tree-item-diff-aaa" data-tree-entry-type="file" data-file-deleted="false">
      <a href="#diff-aaa"><svg class="octicon octicon-diff-modified"></svg><span data-filterable-item-text hidden>src/app.ts</span>app.ts</a>
    </li>
    <li id="file-tree-item-diff-bbb" data-tree-entry-type="file" data-file-deleted="false">
      <a href="#diff-bbb"><svg class="octicon octicon-diff-renamed"></svg><span data-filterable-item-text hidden>src/dataTransfer.ts</span>dataTransfer.ts</a>
    </li>
    <li id="file-tree-item-diff-ccc" data-tree-entry-type="file" data-file-deleted="true">
      <a href="#diff-ccc"><svg class="octicon octicon-diff-removed"></svg><span data-filterable-item-text hidden>old.txt</span>old.txt</a>
    </li>
  </ul>
</file-tree>`;

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

  it('reads React headers and places the button after the file name icons', () => {
    document.body.innerHTML = REACT;
    const [file] = findFileHeaders();
    expect(file).toMatchObject({ path: 'lib/util.py', anchor: 'diff-ddd', position: 'beforeend' });
    expect(file.target).toBe(document.querySelector('h3')!.parentElement);
    injectButtons(() => {});
    expect(file.target.lastElementChild!.className).toBe('diffsanity-button');
  });

  it('reads the path from the link text, without invisible marks, when the header has no path attribute', () => {
    document.body.innerHTML = REACT_ADDED;
    expect(findFileHeaders()).toMatchObject([{ path: 'src/OfficeAgent/TokenSource.cs', oldPath: undefined, anchor: 'diff-eee' }]);
  });

  it('reads React renames from link text with invisible marks', () => {
    document.body.innerHTML = REACT_ADDED.replace(
      '\u200Esrc/OfficeAgent/TokenSource.cs\u200E',
      '\u200Esrc/old.cs\u200E → \u200Esrc/new.cs\u200E',
    );
    expect(findFileHeaders()).toMatchObject([{ path: 'src/new.cs', oldPath: 'src/old.cs', status: 'renamed' }]);
  });

  it('reads React renames from the screen-reader text when the visible names are shortened', () => {
    document.body.innerHTML = REACT_RENAMED;
    expect(findFileHeaders()).toMatchObject([
      { path: 'runtime/Startup/AuthoredDetector.cs', oldPath: 'runtime/Startup/BusinessDetector.cs', status: 'renamed', anchor: 'diff-fff' },
    ]);
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

describe('openApproval', () => {
  // Trimmed from the live React "Submit review" button and the "Finish your review" box it opens.
  const REACT_REVIEW_BUTTON = `
    <button data-component="Button" type="button" class="prc-Button-ButtonBase-9n-Xk ReviewMenuButton-module__ReviewMenuButton__eXO8O">
      <span class="ReviewMenuButton-module__submitTextFull__wN_rM">Submit <!-- -->review</span><span class="ReviewMenuButton-module__submitTextShort__zl992">Review</span>
    </button>`;
  const reactReviewBox = (approveDisabled: boolean) => `
    <div role="dialog" data-component="AnchoredOverlay" aria-labelledby="anchored-review-title">
      <h1 id="anchored-review-title">Finish your review</h1>
      <fieldset data-component="RadioGroup">
        <input id="r1" data-component="Radio" type="radio" value="comment" checked name="reviewEvent"><label for="r1">Comment</label>
        <input id="r2" data-component="Radio" type="radio" value="approve" name="reviewEvent" ${approveDisabled ? 'disabled' : ''}>
        <label for="r2"><span>Approve</span><span>Pull request authors can't approve their own pull requests.</span></label>
        <input id="r3" data-component="Radio" type="radio" value="request changes" name="reviewEvent"><label for="r3">Request changes</label>
      </fieldset>
      <button data-component="Button" type="button">Submit review</button>
    </div>`;
  // Shape of the classic "Review changes" menu, whose form is always in the page.
  const CLASSIC_REVIEW = `
    <details id="review-changes-modal" class="js-reviews-container">
      <summary class="btn btn-sm btn-primary">Review changes</summary>
      <form id="pull_requests_submit_review" action="/o/r/pull/1/reviews" method="post">
        <input type="radio" name="pull_request_review[event]" value="comment" checked>
        <input type="radio" name="pull_request_review[event]" value="approve">
        <input type="radio" name="pull_request_review[event]" value="reject">
        <button type="submit">Submit review</button>
      </form>
    </details>`;

  function reactPage(approveDisabled = false): void {
    document.body.innerHTML = REACT_REVIEW_BUTTON;
    document
      .querySelector('button')!
      .addEventListener('click', () => document.body.insertAdjacentHTML('beforeend', reactReviewBox(approveDisabled)));
  }

  it('opens the React review box with "Approve" selected, without submitting', async () => {
    const onSubmit = vi.fn();
    reactPage();
    document.body.addEventListener('click', (event) => {
      if ((event.target as Element).closest('[role="dialog"] button')) onSubmit();
    });
    await expect(openApproval()).resolves.toEqual({ opened: true, approveSelected: true });
    expect(document.querySelector<HTMLInputElement>('input[value="approve"]')!.checked).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('leaves "Approve" alone when GitHub disables it, e.g. for the author', async () => {
    reactPage(true);
    await expect(openApproval()).resolves.toEqual({ opened: true, approveSelected: false });
    expect(document.querySelector<HTMLInputElement>('input[value="comment"]')!.checked).toBe(true);
  });

  it('opens the classic review menu with "Approve" selected, without submitting', async () => {
    document.body.innerHTML = CLASSIC_REVIEW;
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    document.querySelector('form')!.addEventListener('submit', onSubmit);
    await expect(openApproval()).resolves.toEqual({ opened: true, approveSelected: true });
    expect(document.querySelector('details')!.open).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[value="approve"]')!.checked).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('reports pages without a review button, e.g. when signed out', async () => {
    document.body.innerHTML = '<button type="button">Viewed</button>';
    await expect(openApproval()).resolves.toEqual({ opened: false, approveSelected: false });
  });

  it('gives up when the review box does not open', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = REACT_REVIEW_BUTTON;
      const result = openApproval();
      await vi.advanceTimersByTimeAsync(2100);
      await expect(result).resolves.toEqual({ opened: false, approveSelected: false });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('extractPullRequestFiles', () => {
  it('lists every React file from the embedded data, adding old paths from rendered headers', () => {
    document.body.innerHTML = reactEmbeddedData(7) + REACT_RENAMED;
    expect(extractPullRequestFiles(document, 7)).toEqual([
      { path: 'src/app.ts', oldPath: undefined, status: 'modified', anchor: 'diff-aaa', additions: 3, deletions: 1 },
      { path: 'src/new.ts', oldPath: 'src/old.ts', status: 'renamed', anchor: 'diff-bbb', additions: 0, deletions: 0 },
      {
        path: 'runtime/Startup/AuthoredDetector.cs',
        oldPath: 'runtime/Startup/BusinessDetector.cs',
        status: 'renamed',
        anchor: 'diff-fff',
        additions: 4,
        deletions: 2,
      },
      { path: 'gone.txt', oldPath: undefined, status: 'deleted', anchor: 'diff-ccc', additions: 0, deletions: 7 },
    ]);
  });

  it('ignores embedded data of another pull request', () => {
    document.body.innerHTML = reactEmbeddedData(8) + REACT;
    expect(extractPullRequestFiles(document, 7)).toEqual([
      { path: 'lib/util.py', oldPath: undefined, status: undefined, anchor: 'diff-ddd' },
    ]);
  });

  it('lists every classic file from the file tree, adding old paths from rendered headers', () => {
    document.body.innerHTML = CLASSIC_TREE + CLASSIC;
    expect(extractPullRequestFiles(document, 1)).toEqual([
      { path: 'src/app.ts', status: 'modified', anchor: 'diff-aaa' },
      { path: 'src/dataTransfer.ts', oldPath: 'src/dnd.ts', status: 'renamed', anchor: 'diff-bbb' },
      { path: 'old.txt', oldPath: undefined, status: 'deleted', anchor: 'diff-ccc' },
    ]);
  });

  it('falls back to the rendered headers', () => {
    document.body.innerHTML = CLASSIC;
    expect(extractPullRequestFiles(document, 1).map((file) => file.path)).toEqual(['src/app.ts', 'src/dataTransfer.ts', 'old.txt']);
  });

  it('works on a fetched copy of the page', () => {
    const doc = new DOMParser().parseFromString(`<html><body>${reactEmbeddedData(7)}</body></html>`, 'text/html');
    expect(extractPullRequestFiles(doc, 7)).toHaveLength(4);
  });
});

describe('revealFile', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('scrolls to a rendered file', () => {
    document.body.innerHTML = CLASSIC;
    expect(revealFile('diff-bbb')).toBe(true);
    expect(document.getElementById('diff-bbb')!.scrollIntoView).toHaveBeenCalled();
  });

  it("follows GitHub's file-tree link to a file that is not rendered yet", () => {
    document.body.innerHTML = CLASSIC_TREE;
    const onClick = vi.fn((event: Event) => event.preventDefault());
    document.querySelector('a[href="#diff-ccc"]')!.addEventListener('click', onClick);
    expect(revealFile('diff-ccc')).toBe(true);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('reports files that are not on the page and rejects invalid anchors', () => {
    document.body.innerHTML = CLASSIC;
    expect(revealFile('diff-zzz')).toBe(false);
    expect(revealFile('diff-a"],body')).toBe(false);
  });
});
