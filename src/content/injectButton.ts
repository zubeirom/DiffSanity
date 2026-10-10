import { findFileHeaders, type FileHeader } from './github';

const BUTTON_CLASS = 'diffsanity-button';

const ICON = `<svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M2.75 1h10.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1Zm0 1.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25H10V2.5Zm8.75 0v11h1.75a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM4 4.75A.75.75 0 0 1 4.75 4h3.5a.75.75 0 0 1 0 1.5h-3.5A.75.75 0 0 1 4 4.75ZM4.75 7h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1 0-1.5Zm0 3h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1 0-1.5Zm7.5-6a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1a.5.5 0 0 1 .5-.5Zm0 4a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2a.5.5 0 0 1 .5-.5Z"/></svg>`;

export type OpenHandler = (file: FileHeader, event: MouseEvent) => void;

function createButton(file: FileHeader, onOpen: OpenHandler): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = BUTTON_CLASS;
  button.title = 'Open in DiffSanity';
  button.setAttribute('aria-label', `Open ${file.path} in DiffSanity`);
  button.innerHTML = `${ICON}<span>DiffSanity</span>`;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    // Re-read the header at click time: GitHub may have re-rendered it since injection.
    const current = findFileHeaders(document).find((candidate) => candidate.header.contains(button));
    onOpen(current ?? file, event);
  });
  return button;
}

/** Adds a DiffSanity button to every file header that does not have one yet. Safe to call repeatedly. */
export function injectButtons(onOpen: OpenHandler, root: ParentNode = document): number {
  let injected = 0;
  for (const file of findFileHeaders(root)) {
    if (file.header.querySelector(`.${BUTTON_CLASS}`)) continue;
    file.target.insertAdjacentElement(file.position, createButton(file, onOpen));
    injected++;
  }
  return injected;
}
