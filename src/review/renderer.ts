import type { DiffLine, FileDiff } from '../shared/types';
import { escapeHtml } from './syntax';

/** Fixed row height in CSS px. Every row has exactly this height, so line index ↔ pixel offset is exact. */
export const LINE_HEIGHT = 20;
const CHUNK_SIZE = 200;
const TAB_SIZE = 4;

export interface HighlightedSources {
  /** Per-line HTML of the old file, indexed by `oldLineNumber - 1`. */
  old: string[] | null;
  /** Per-line HTML of the new file, indexed by `newLineNumber - 1`. */
  new: string[] | null;
}

const ROW_CLASS: Record<DiffLine['type'], string> = {
  context: 'ds-line',
  addition: 'ds-line ds-add',
  deletion: 'ds-line ds-del',
};
const SIGN: Record<DiffLine['type'], string> = { context: ' ', addition: '+', deletion: '−' };

function codeHtml(line: DiffLine, sources: HighlightedSources): string {
  const highlighted =
    line.type === 'deletion'
      ? sources.old?.[line.oldLineNumber! - 1]
      : sources.new?.[line.newLineNumber! - 1];
  return highlighted ?? escapeHtml(line.content);
}

function rowHtml(line: DiffLine, sources: HighlightedSources): string {
  return (
    `<div class="${ROW_CLASS[line.type]}">` +
    `<span class="ds-gutter"><span class="ds-num">${line.oldLineNumber ?? ''}</span>` +
    `<span class="ds-num">${line.newLineNumber ?? ''}</span>` +
    `<span class="ds-sign" aria-hidden="true">${SIGN[line.type]}</span></span>` +
    `<span class="ds-text">${codeHtml(line, sources)}</span></div>`
  );
}

/** Visual width of a line in columns, expanding tabs. */
export function columnWidth(text: string): number {
  let columns = 0;
  for (const char of text) columns = char === '\t' ? columns + TAB_SIZE - (columns % TAB_SIZE) : columns + 1;
  return columns;
}

export interface RenderedDiff {
  scrollToLine(index: number, align?: 'start' | 'center'): void;
  /** Row element of a diff line. */
  row(index: number): HTMLElement | undefined;
  /** Index of the diff line at a viewport Y coordinate, or -1 outside the diff. */
  lineAt(clientY: number): number;
}

/**
 * Renders the unified diff into `scroller`. Rows are grouped in chunks using `content-visibility: auto`
 * so off-screen chunks are skipped by the browser while their text stays searchable with Ctrl+F.
 */
export function renderDiff(scroller: HTMLElement, diff: FileDiff, sources: HighlightedSources): RenderedDiff {
  const lastOld = diff.lines.reduce((max, line) => Math.max(max, line.oldLineNumber ?? 0), 0);
  const lastNew = diff.lines.reduce((max, line) => Math.max(max, line.newLineNumber ?? 0), 0);
  const digits = String(Math.max(lastOld, lastNew, 1)).length;
  const maxColumns = diff.lines.reduce((max, line) => Math.max(max, columnWidth(line.content)), 0);

  const code = document.createElement('div');
  code.className = 'ds-code';
  code.style.setProperty('--ds-line-height', `${LINE_HEIGHT}px`);
  code.style.setProperty('--ds-digits', String(digits));
  // Chunks use paint containment, so the code area must be explicitly as wide as the longest line.
  code.style.setProperty('--ds-columns', String(maxColumns));
  code.style.tabSize = String(TAB_SIZE);

  const chunks: string[] = [];
  for (let start = 0; start < diff.lines.length; start += CHUNK_SIZE) {
    const slice = diff.lines.slice(start, start + CHUNK_SIZE);
    chunks.push(
      `<div class="ds-chunk" style="contain-intrinsic-block-size:${slice.length * LINE_HEIGHT}px">` +
        slice.map((line) => rowHtml(line, sources)).join('') +
        '</div>',
    );
  }
  code.innerHTML = chunks.join('');
  scroller.replaceChildren(code);

  return {
    scrollToLine(index, align = 'start') {
      const offset = align === 'center' ? (scroller.clientHeight - LINE_HEIGHT) / 2 : 0;
      scroller.scrollTop = Math.max(0, index * LINE_HEIGHT - offset);
    },
    row(index) {
      return code.children[Math.floor(index / CHUNK_SIZE)]?.children[index % CHUNK_SIZE] as HTMLElement | undefined;
    },
    lineAt(clientY) {
      const index = Math.floor((clientY - code.getBoundingClientRect().top) / LINE_HEIGHT);
      return index >= 0 && index < diff.lines.length ? index : -1;
    },
  };
}
