import type { DiffLine, FileDiff } from '../shared/types';
import { splitRows, type DiffLayout, type SplitRow } from './layout';
import { escapeHtml } from './syntax';

/** Fixed row height in CSS px. Every row has exactly this height, so row index ↔ pixel offset is exact. */
export const LINE_HEIGHT = 20;
const CHUNK_SIZE = 200;
const TAB_SIZE = 4;

export interface HighlightedSources {
  /** Per-line HTML of the old file, indexed by `oldLineNumber - 1`. */
  old: string[] | null;
  /** Per-line HTML of the new file, indexed by `newLineNumber - 1`. */
  new: string[] | null;
}

type Side = 'old' | 'new';
const SIDES: readonly Side[] = ['old', 'new'];

const ROW_CLASS: Record<DiffLine['type'], string> = {
  context: 'ds-line',
  addition: 'ds-line ds-add',
  deletion: 'ds-line ds-del',
};
const SIGN: Record<DiffLine['type'], string> = { context: ' ', addition: '+', deletion: '−' };
/** Shown where the other side of the split view has lines and this side has none. */
const FILLER_ROW = '<div class="ds-line ds-filler"><span class="ds-gutter"></span></div>';

/** The side a line belongs to: deletions are old-file lines, everything else is shown from the new file. */
function sideOf(line: DiffLine): Side {
  return line.type === 'deletion' ? 'old' : 'new';
}

function codeHtml(line: DiffLine, side: Side, sources: HighlightedSources): string {
  const number = side === 'old' ? line.oldLineNumber : line.newLineNumber;
  return (number !== undefined ? sources[side]?.[number - 1] : undefined) ?? escapeHtml(line.content);
}

function unifiedRowHtml(line: DiffLine, sources: HighlightedSources): string {
  return (
    `<div class="${ROW_CLASS[line.type]}">` +
    `<span class="ds-gutter"><span class="ds-num">${line.oldLineNumber ?? ''}</span>` +
    `<span class="ds-num">${line.newLineNumber ?? ''}</span>` +
    `<span class="ds-sign" aria-hidden="true">${SIGN[line.type]}</span></span>` +
    `<span class="ds-text">${codeHtml(line, sideOf(line), sources)}</span></div>`
  );
}

function splitRowHtml(line: DiffLine | undefined, side: Side, sources: HighlightedSources): string {
  if (!line) return FILLER_ROW;
  const number = side === 'old' ? line.oldLineNumber : line.newLineNumber;
  return (
    `<div class="${ROW_CLASS[line.type]}">` +
    `<span class="ds-gutter"><span class="ds-num">${number ?? ''}</span>` +
    `<span class="ds-sign" aria-hidden="true">${SIGN[line.type]}</span></span>` +
    `<span class="ds-text">${codeHtml(line, side, sources)}</span></div>`
  );
}

/** Rows grouped in chunks that the browser can skip while they are off screen. */
function chunksHtml<T>(items: readonly T[], rowHtml: (item: T) => string): string {
  const chunks: string[] = [];
  for (let start = 0; start < items.length; start += CHUNK_SIZE) {
    const slice = items.slice(start, start + CHUNK_SIZE);
    chunks.push(
      `<div class="ds-chunk" style="contain-intrinsic-block-size:${slice.length * LINE_HEIGHT}px">` +
        slice.map(rowHtml).join('') +
        '</div>',
    );
  }
  return chunks.join('');
}

function rowElement(container: Element, row: number): HTMLElement | undefined {
  return container.children[Math.floor(row / CHUNK_SIZE)]?.children[row % CHUNK_SIZE] as HTMLElement | undefined;
}

/** Keeps the horizontal scroll position of all `elements` the same, whichever one the user scrolls. */
function syncHorizontalScroll(elements: readonly HTMLElement[]): void {
  for (const source of elements) {
    source.addEventListener(
      'scroll',
      () => {
        for (const other of elements) {
          if (other !== source && other.scrollLeft !== source.scrollLeft) other.scrollLeft = source.scrollLeft;
        }
      },
      { passive: true },
    );
  }
}

/** Visual width of a line in columns, expanding tabs. */
export function columnWidth(text: string): number {
  let columns = 0;
  for (const char of text) columns = char === '\t' ? columns + TAB_SIZE - (columns % TAB_SIZE) : columns + 1;
  return columns;
}

export interface RenderedDiff {
  readonly layout: DiffLayout;
  /** Number of rows. In the split view a deletion and the addition next to it share a row. */
  readonly rowCount: number;
  /** Row of each diff line. */
  readonly rowOfLine: readonly number[];
  scrollToLine(index: number, align?: 'start' | 'center'): void;
  /** The diff line in the top row of the viewport, to keep the place when the layout changes. */
  topLine(): number;
  /** Row element of a diff line. Unchanged lines in the split view use the new side. */
  row(index: number): HTMLElement | undefined;
  /** The diff line and its row element at a viewport point, or undefined outside the diff and on empty rows. */
  lineAt(clientX: number, clientY: number): { index: number; row: HTMLElement } | undefined;
}

/**
 * Renders the diff into `scroller`, as one column or side by side. Rows are grouped in chunks using
 * `content-visibility: auto` so off-screen chunks are skipped by the browser while their text stays searchable with Ctrl+F.
 */
export function renderDiff(
  scroller: HTMLElement,
  diff: FileDiff,
  sources: HighlightedSources,
  layout: DiffLayout = 'unified',
): RenderedDiff {
  const lastOld = diff.lines.reduce((max, line) => Math.max(max, line.oldLineNumber ?? 0), 0);
  const lastNew = diff.lines.reduce((max, line) => Math.max(max, line.newLineNumber ?? 0), 0);
  const digits = String(Math.max(lastOld, lastNew, 1)).length;
  const maxColumns = diff.lines.reduce((max, line) => Math.max(max, columnWidth(line.content)), 0);

  const code = document.createElement('div');
  code.className = 'ds-code';
  code.dataset.layout = layout;
  code.style.setProperty('--ds-line-height', `${LINE_HEIGHT}px`);
  code.style.setProperty('--ds-digits', String(digits));
  // Chunks use paint containment, so the code area must be explicitly as wide as the longest line.
  code.style.setProperty('--ds-columns', String(maxColumns));
  code.style.tabSize = String(TAB_SIZE);

  const view = layout === 'split' ? splitView(code, diff, sources) : unifiedView(code, diff, sources);
  scroller.replaceChildren(code);

  const rowAt = (clientY: number) => Math.floor((clientY - code.getBoundingClientRect().top) / LINE_HEIGHT);
  return {
    layout,
    rowCount: view.rowCount,
    rowOfLine: view.rowOfLine,
    scrollToLine(index, align = 'start') {
      const offset = align === 'center' ? (scroller.clientHeight - LINE_HEIGHT) / 2 : 0;
      scroller.scrollTop = Math.max(0, (view.rowOfLine[index] ?? 0) * LINE_HEIGHT - offset);
    },
    topLine() {
      const row = Math.min(Math.floor(scroller.scrollTop / LINE_HEIGHT), view.rowCount - 1);
      return row >= 0 ? view.lineInRow(row, 'new') ?? view.lineInRow(row, 'old') ?? 0 : 0;
    },
    row(index) {
      const line = diff.lines[index];
      return line ? view.element(view.rowOfLine[index], sideOf(line)) : undefined;
    },
    lineAt(clientX, clientY) {
      const row = rowAt(clientY);
      if (row < 0 || row >= view.rowCount) return undefined;
      const side = view.sideAt(clientX);
      const index = view.lineInRow(row, side);
      const element = index === undefined ? undefined : view.element(row, side);
      return index === undefined || !element ? undefined : { index, row: element };
    },
  };
}

/** What `renderDiff` needs to know about a layout. */
interface LayoutView {
  rowCount: number;
  rowOfLine: number[];
  lineInRow(row: number, side: Side): number | undefined;
  element(row: number, side: Side): HTMLElement | undefined;
  sideAt(clientX: number): Side;
}

function unifiedView(code: HTMLElement, diff: FileDiff, sources: HighlightedSources): LayoutView {
  code.innerHTML = chunksHtml(diff.lines, (line) => unifiedRowHtml(line, sources));
  return {
    rowCount: diff.lines.length,
    rowOfLine: diff.lines.map((_, index) => index),
    lineInRow: (row) => (row < diff.lines.length ? row : undefined),
    element: (row) => rowElement(code, row),
    sideAt: () => 'new',
  };
}

/**
 * Two panes, old file on the left and new file on the right. Each pane scrolls sideways on its own element so its
 * gutter can stay pinned; the panes and the scrollbar pinned to the bottom of the view always move together.
 */
function splitView(code: HTMLElement, diff: FileDiff, sources: HighlightedSources): LayoutView {
  const rows: SplitRow[] = splitRows(diff.lines);
  const rowOfLine: number[] = new Array<number>(diff.lines.length);
  rows.forEach((row, index) => {
    for (const side of SIDES) {
      const line = row[side];
      if (line !== undefined) rowOfLine[line] = index;
    }
  });

  const pane = (side: Side) =>
    `<div class="ds-pane" data-side="${side}"><div class="ds-pane-content">` +
    chunksHtml(rows, (row) => splitRowHtml(row[side] === undefined ? undefined : diff.lines[row[side]], side, sources)) +
    '</div></div>';
  const track = '<div class="ds-hscroll-track"><div class="ds-hscroll-spacer"></div></div>';
  code.innerHTML = `<div class="ds-panes">${SIDES.map(pane).join('')}</div><div class="ds-hscroll" aria-hidden="true">${track}${track}</div>`;

  const contents = [...code.querySelectorAll<HTMLElement>('.ds-pane-content')];
  const newPane = code.querySelector<HTMLElement>('.ds-pane[data-side="new"]')!;
  syncHorizontalScroll([...code.querySelectorAll<HTMLElement>('.ds-pane, .ds-hscroll-track')]);
  return {
    rowCount: rows.length,
    rowOfLine,
    lineInRow: (row, side) => rows[row]?.[side],
    element: (row, side) => rowElement(contents[side === 'old' ? 0 : 1], row),
    sideAt: (clientX) => (clientX < newPane.getBoundingClientRect().left ? 'old' : 'new'),
  };
}