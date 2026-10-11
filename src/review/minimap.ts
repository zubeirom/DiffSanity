import type { DiffLine } from '../shared/types';

/** Largest minimap height per line, so short files are not stretched into giant blocks. */
const MAX_SCALE = 3;
const MIN_VIEWPORT_HEIGHT = 6;
/** Width of the change ruler on the right edge, drawn with a minimum height so single-line changes stay visible. */
const RULER_WIDTH = 4;
const MIN_RULER_MARK = 2;
/** Review threads are marked on the left edge. */
const COMMENT_MARK_WIDTH = 3;

/** Minimap pixels per file line: the whole file fits in the track, capped at `MAX_SCALE`. */
export function minimapScale(lineCount: number, trackHeight: number): number {
  if (lineCount <= 0 || trackHeight <= 0) return MAX_SCALE;
  return Math.min(MAX_SCALE, trackHeight / lineCount);
}

/** Viewport indicator position, in minimap pixels. */
export function viewportRect(
  scrollTop: number,
  clientHeight: number,
  lineHeight: number,
  scale: number,
  lineCount: number,
): { top: number; height: number } {
  const contentHeight = lineCount * scale;
  const height = Math.min(Math.max((clientHeight / lineHeight) * scale, MIN_VIEWPORT_HEIGHT), Math.max(contentHeight, MIN_VIEWPORT_HEIGHT));
  const top = Math.min((scrollTop / lineHeight) * scale, Math.max(0, contentHeight - height));
  return { top: Math.max(0, top), height };
}

/** Scroll offset that puts the viewport indicator's top at `minimapTop`. */
export function scrollTopForMinimapY(minimapTop: number, lineHeight: number, scale: number): number {
  return Math.max(0, (minimapTop / scale) * lineHeight);
}

interface Palette {
  text: string;
  addition: string;
  deletion: string;
  additionBackground: string;
  deletionBackground: string;
  comment: string;
}

function readPalette(element: HTMLElement): Palette {
  const style = getComputedStyle(element);
  const get = (name: string) => style.getPropertyValue(name).trim();
  return {
    text: get('--ds-minimap-text'),
    addition: get('--ds-minimap-add'),
    deletion: get('--ds-minimap-del'),
    additionBackground: get('--ds-minimap-add-bg'),
    deletionBackground: get('--ds-minimap-del-bg'),
    comment: get('--ds-minimap-comment'),
  };
}

/**
 * Canvas minimap of the whole file. The canvas is only redrawn on resize/theme changes;
 * scrolling just moves the viewport indicator element.
 */
export class Minimap {
  private readonly canvas = document.createElement('canvas');
  private readonly viewport = document.createElement('div');
  private readonly resizeObserver = new ResizeObserver(() => this.draw());
  private scale = MAX_SCALE;
  private frame = 0;
  private dragOffset: number | null = null;
  private threadLines: readonly number[] = [];

  constructor(
    private readonly host: HTMLElement,
    private readonly scroller: HTMLElement,
    private readonly lines: readonly DiffLine[],
    private readonly lineHeight: number,
  ) {
    this.viewport.className = 'ds-minimap-viewport';
    host.replaceChildren(this.canvas, this.viewport);
    host.addEventListener('pointerdown', this.onPointerDown);
    host.addEventListener('pointermove', this.onPointerMove);
    host.addEventListener('pointerup', this.onPointerUp);
    host.addEventListener('pointercancel', this.onPointerUp);
    scroller.addEventListener('scroll', this.scheduleViewportUpdate, { passive: true });
    this.resizeObserver.observe(host);
    this.draw();
  }

  /** Redraws everything, e.g. after a theme change. */
  draw(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    this.scale = minimapScale(this.lines.length, height);
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    const context = this.canvas.getContext('2d');
    if (context) {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      this.paint(context, width, height);
    }
    this.updateViewport();
  }

  private paint(context: CanvasRenderingContext2D, width: number, height: number): void {
    const palette = readPalette(this.host);
    const scale = this.scale;
    const codeWidth = width - RULER_WIDTH - 6;
    const rowHeight = Math.max(scale * 0.8, Math.min(scale, 1));
    context.clearRect(0, 0, width, height);

    // Change backgrounds first, then "code shape" bars, then the ruler on top.
    this.lines.forEach((line, index) => {
      if (line.type === 'context') return;
      context.fillStyle = line.type === 'addition' ? palette.additionBackground : palette.deletionBackground;
      context.fillRect(0, index * scale, width - RULER_WIDTH, Math.max(scale, 1));
    });

    const charWidth = Math.max(codeWidth / 120, 0.5);
    this.lines.forEach((line, index) => {
      const indent = line.content.length - line.content.trimStart().length;
      const length = line.content.trim().length;
      if (!length) return;
      context.fillStyle =
        line.type === 'addition' ? palette.addition : line.type === 'deletion' ? palette.deletion : palette.text;
      const x = 2 + Math.min(indent, 60) * charWidth;
      context.fillRect(x, index * scale, Math.min(length * charWidth, codeWidth - x), rowHeight);
    });

    this.lines.forEach((line, index) => {
      if (line.type === 'context') return;
      context.fillStyle = line.type === 'addition' ? palette.addition : palette.deletion;
      context.fillRect(width - RULER_WIDTH, index * scale, RULER_WIDTH, Math.max(scale, MIN_RULER_MARK));
    });

    context.fillStyle = palette.comment;
    for (const index of this.threadLines) {
      context.fillRect(0, index * scale, COMMENT_MARK_WIDTH, Math.max(scale, COMMENT_MARK_WIDTH));
    }
  }

  /** Marks the lines that have review threads on GitHub. */
  setThreadLines(indices: readonly number[]): void {
    this.threadLines = indices;
    this.draw();
  }

  private readonly scheduleViewportUpdate = () => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.updateViewport();
    });
  };

  private updateViewport(): void {
    const { top, height } = viewportRect(
      this.scroller.scrollTop,
      this.scroller.clientHeight,
      this.lineHeight,
      this.scale,
      this.lines.length,
    );
    this.viewport.style.transform = `translateY(${top}px)`;
    this.viewport.style.height = `${height}px`;
  }

  private pointerY(event: PointerEvent): number {
    return event.clientY - this.host.getBoundingClientRect().top;
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const y = this.pointerY(event);
    const { top, height } = viewportRect(this.scroller.scrollTop, this.scroller.clientHeight, this.lineHeight, this.scale, this.lines.length);
    // Grabbing the indicator keeps the grab point; clicking elsewhere centres the viewport there.
    this.dragOffset = y >= top && y <= top + height ? y - top : height / 2;
    this.host.setPointerCapture(event.pointerId);
    this.host.classList.add('ds-dragging');
    this.scrollTo(y);
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (this.dragOffset !== null) this.scrollTo(this.pointerY(event));
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    if (this.dragOffset === null) return;
    this.dragOffset = null;
    this.host.releasePointerCapture(event.pointerId);
    this.host.classList.remove('ds-dragging');
  };

  private scrollTo(y: number): void {
    this.scroller.scrollTop = scrollTopForMinimapY(y - (this.dragOffset ?? 0), this.lineHeight, this.scale);
  }

  /** Stops listening and clears the minimap, e.g. before another file is shown. */
  destroy(): void {
    this.resizeObserver.disconnect();
    this.host.removeEventListener('pointerdown', this.onPointerDown);
    this.host.removeEventListener('pointermove', this.onPointerMove);
    this.host.removeEventListener('pointerup', this.onPointerUp);
    this.host.removeEventListener('pointercancel', this.onPointerUp);
    this.host.classList.remove('ds-dragging');
    this.scroller.removeEventListener('scroll', this.scheduleViewportUpdate);
    cancelAnimationFrame(this.frame);
    this.host.replaceChildren();
  }
}
