import type { FrameMessage } from '../shared/types';

const MODAL_CLASS = 'diffsanity-modal';
const MAXIMIZED_CLASS = 'diffsanity-modal-maximized';

interface ActiveModal {
  dialog: HTMLDialogElement;
  frame: HTMLIFrameElement;
}

let active: ActiveModal | undefined;

function isFrameMessage(data: unknown): data is FrameMessage {
  return typeof data === 'object' && data !== null && (data as FrameMessage).type === 'diffsanity:frame';
}

/** `chrome-extension://<id>`, the origin of the review frame. */
function extensionOrigin(): string {
  return chrome.runtime.getURL('').replace(/\/$/, '');
}

/** Only messages from our own review frame are trusted; the page cannot forge the extension origin. */
function onFrameMessage(event: MessageEvent): void {
  if (!active || event.source !== active.frame.contentWindow) return;
  if (event.origin !== extensionOrigin() || !isFrameMessage(event.data)) return;

  if (event.data.action === 'close') closeReviewModal();
  else active.dialog.classList.toggle(MAXIMIZED_CLASS, event.data.maximized);
}

/** Closes the review modal, if one is open. Safe to call at any time. */
export function closeReviewModal(): void {
  if (!active) return;
  const { dialog } = active;
  active = undefined;
  window.removeEventListener('message', onFrameMessage);
  if (dialog.open) dialog.close();
  dialog.remove();
}

/**
 * Shows the review page in a modal `<dialog>` over GitHub. The native dialog provides focus handling,
 * Esc-to-close (while focus is on the GitHub page) and makes the page behind it inert.
 */
export function openReviewModal(url: string, title: string): void {
  closeReviewModal();

  const dialog = document.createElement('dialog');
  dialog.className = MODAL_CLASS;
  dialog.setAttribute('aria-label', title);
  const frame = document.createElement('iframe');
  frame.src = url;
  frame.title = title;
  dialog.append(frame);

  // Clicks on the backdrop target the dialog itself; clicks inside the review stay in the iframe.
  // Both handlers check ownership: `close` fires asynchronously and may arrive after a newer modal opened.
  const closeThis = () => {
    if (active?.dialog === dialog) closeReviewModal();
  };
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeThis();
  });
  dialog.addEventListener('close', closeThis);

  active = { dialog, frame };
  window.addEventListener('message', onFrameMessage);
  document.body.append(dialog);
  dialog.showModal();
}
