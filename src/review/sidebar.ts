/** Width and visibility of the file sidebar, remembered across review tabs like the theme. */
// A new key, because the old one also held widths saved by plain clicks on the edge,
// which kept the old 300px default after the default grew.
const WIDTH_KEY = 'diffsanity.sidebarWidth.v2';
const LEGACY_WIDTH_KEY = 'diffsanity.sidebarWidth';
const HIDDEN_KEY = 'diffsanity.sidebarHidden';
const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 160;
/** The diff keeps at least this share of the window. */
const MAX_WIDTH_SHARE = 0.6;

/** Keeps a sidebar width usable for the current window width. */
export function clampSidebarWidth(width: number, windowWidth: number): number {
  if (!Number.isFinite(width)) return DEFAULT_WIDTH;
  return Math.round(Math.max(MIN_WIDTH, Math.min(width, windowWidth * MAX_WIDTH_SHARE)));
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; the setting then only lasts for this tab.
  }
}

/**
 * Shows the sidebar, lets the user drag `resizer` to resize it (double-click resets it)
 * and `toggle` to hide it.
 */
export function setupSidebar(sidebar: HTMLElement, resizer: HTMLElement, toggle: HTMLButtonElement): void {
  const setWidth = (width: number) => {
    sidebar.style.width = `${clampSidebarWidth(width, window.innerWidth)}px`;
  };
  const setHidden = (hidden: boolean) => {
    sidebar.hidden = hidden;
    resizer.hidden = hidden;
    toggle.setAttribute('aria-expanded', String(!hidden));
    toggle.title = hidden ? 'Show changed files' : 'Hide changed files';
  };

  write(LEGACY_WIDTH_KEY, null);
  setWidth(Number(read(WIDTH_KEY) ?? DEFAULT_WIDTH));
  toggle.hidden = false;
  setHidden(read(HIDDEN_KEY) === 'true');

  toggle.addEventListener('click', () => {
    setHidden(!sidebar.hidden);
    write(HIDDEN_KEY, sidebar.hidden ? 'true' : null);
  });

  let resized = false;
  resizer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resized = false;
    resizer.setPointerCapture(event.pointerId);
    resizer.classList.add('ds-dragging');
  });
  resizer.addEventListener('pointermove', (event) => {
    if (!resizer.hasPointerCapture(event.pointerId)) return;
    resized = true;
    setWidth(event.clientX - sidebar.getBoundingClientRect().left);
  });
  const stop = (event: PointerEvent) => {
    if (!resizer.hasPointerCapture(event.pointerId)) return;
    resizer.releasePointerCapture(event.pointerId);
    resizer.classList.remove('ds-dragging');
    if (resized) write(WIDTH_KEY, String(sidebar.getBoundingClientRect().width));
  };
  resizer.addEventListener('pointerup', stop);
  resizer.addEventListener('pointercancel', stop);
  resizer.addEventListener('dblclick', () => {
    write(WIDTH_KEY, null);
    setWidth(DEFAULT_WIDTH);
  });
}
