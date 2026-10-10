// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeReviewModal, openReviewModal } from '../src/content/modal';

const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnop';

beforeAll(() => {
  vi.stubGlobal('chrome', { runtime: { getURL: (path: string) => `${EXTENSION_ORIGIN}/${path}` } });
  // jsdom implements <dialog> only partially.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

afterEach(() => closeReviewModal());

const dialogs = () => document.querySelectorAll<HTMLDialogElement>('dialog.diffsanity-modal');

function postFromFrame(data: unknown, origin = EXTENSION_ORIGIN): void {
  const frame = document.querySelector('dialog.diffsanity-modal iframe') as HTMLIFrameElement;
  window.dispatchEvent(new MessageEvent('message', { data, origin, source: frame.contentWindow }));
}

describe('review modal', () => {
  it('shows the review page in a modal dialog', () => {
    openReviewModal(`${EXTENSION_ORIGIN}/review.html?x=1`, 'a.ts · DiffSanity');
    const [dialog] = dialogs();
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('iframe')?.src).toBe(`${EXTENSION_ORIGIN}/review.html?x=1`);
  });

  it('replaces an open modal instead of stacking', () => {
    openReviewModal(`${EXTENSION_ORIGIN}/review.html?x=1`, 'a');
    openReviewModal(`${EXTENSION_ORIGIN}/review.html?x=2`, 'b');
    expect(dialogs()).toHaveLength(1);
    expect(dialogs()[0].getAttribute('aria-label')).toBe('b');
  });

  it("ignores a replaced dialog's late close event", () => {
    openReviewModal(`${EXTENSION_ORIGIN}/review.html?x=1`, 'a');
    const first = dialogs()[0];
    openReviewModal(`${EXTENSION_ORIGIN}/review.html?x=2`, 'b');
    first.dispatchEvent(new Event('close'));
    expect(dialogs()).toHaveLength(1);
  });

  it('closes on request from the review frame', () => {
    openReviewModal(`${EXTENSION_ORIGIN}/review.html`, 'a');
    postFromFrame({ type: 'diffsanity:frame', action: 'close' });
    expect(dialogs()).toHaveLength(0);
  });

  it('ignores messages from other origins', () => {
    openReviewModal(`${EXTENSION_ORIGIN}/review.html`, 'a');
    postFromFrame({ type: 'diffsanity:frame', action: 'close' }, 'https://github.com');
    postFromFrame({ type: 'something-else' });
    expect(dialogs()).toHaveLength(1);
  });

  it('toggles full screen', () => {
    openReviewModal(`${EXTENSION_ORIGIN}/review.html`, 'a');
    postFromFrame({ type: 'diffsanity:frame', action: 'maximize', maximized: true });
    expect(dialogs()[0].classList.contains('diffsanity-modal-maximized')).toBe(true);
    postFromFrame({ type: 'diffsanity:frame', action: 'maximize', maximized: false });
    expect(dialogs()[0].classList.contains('diffsanity-modal-maximized')).toBe(false);
  });

  it('closes when the backdrop is clicked, but not for clicks inside', () => {
    openReviewModal(`${EXTENSION_ORIGIN}/review.html`, 'a');
    dialogs()[0].querySelector('iframe')!.click();
    expect(dialogs()).toHaveLength(1);
    dialogs()[0].click();
    expect(dialogs()).toHaveLength(0);
  });
});
