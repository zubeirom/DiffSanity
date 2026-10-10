// End-to-end check against real public pull requests, using Playwright's bundled Chromium
// (branded Chrome no longer allows loading unpacked extensions from the command line).
// Usage: npm run build && npm run e2e
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const EXTENSION = path.resolve('dist');
const SCREENSHOTS = path.resolve('docs', 'screenshots');
const MANY_FILES_PR = 'https://github.com/microsoft/vscode/pull/340793';
const RENAME_PR = 'https://github.com/microsoft/vscode/pull/248252';
const COMMENTS_PR = 'https://github.com/vercel/next.js/pull/99968';
const COMMENTS_FILE = 'turbopack-node/js/src/child_process/index.ts';

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name}\n    ${String(error?.message ?? error).split('\n')[0]}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function openReview(context, page, buttonSelector = '.diffsanity-button') {
  const [review] = await Promise.all([context.waitForEvent('page'), page.locator(buttonSelector).first().click()]);
  await review.waitForSelector('.ds-line, .ds-message[data-kind="error"]', { timeout: 30_000 });
  return review;
}

const profile = await mkdtemp(path.join(tmpdir(), 'diffsanity-e2e-'));
await mkdir(SCREENSHOTS, { recursive: true });
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', // full Chromium in new headless mode, which supports extensions
  viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
});

try {
  const page = context.pages()[0] ?? (await context.newPage());

  console.log('Pull request with many files');
  await page.goto(`${MANY_FILES_PR}/files`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.diffsanity-button', { timeout: 30_000 });

  await check('one button per file header', async () => {
    await page.waitForTimeout(1500); // let lazy-loaded files arrive
    const headers = await page.locator('.file-header[data-path]').count();
    const buttons = await page.locator('.diffsanity-button').count();
    assert(headers > 1 && headers === buttons, `${buttons} buttons for ${headers} headers`);
  });
  await page.locator('.file-header[data-path]').first().screenshot({ path: path.join(SCREENSHOTS, 'github-button.png') });

  const review = await openReview(context, page);
  await check('review page renders the whole file with changes', async () => {
    const lines = await review.locator('.ds-line').count();
    const changes = await review.locator('.ds-add, .ds-del').count();
    assert(lines > changes && changes > 0, `${lines} lines, ${changes} changed`);
    assert((await review.title()).endsWith('· DiffSanity'), `title "${await review.title()}"`);
  });
  await check('line numbers on both sides', async () => {
    const numbers = await review.locator('.ds-line:not(.ds-add):not(.ds-del) .ds-num').first().textContent();
    assert(numbers === '1' || Number(numbers) > 0, `first number "${numbers}"`);
  });
  await check('syntax highlighting', async () => {
    assert((await review.locator('.ds-text .token').count()) > 0, 'no tokens');
  });
  await check('minimap click scrolls the file', async () => {
    const scroller = review.locator('#ds-scroller');
    const minimap = await review.locator('#ds-minimap').boundingBox();
    const before = await scroller.evaluate((el) => el.scrollTop);
    await review.mouse.click(minimap.x + minimap.width / 2, minimap.y + minimap.height * 0.9);
    const after = await scroller.evaluate((el) => el.scrollTop);
    const max = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight);
    assert(max === 0 || after !== before, `scrollTop ${before} → ${after}`);
    await scroller.evaluate((el) => (el.scrollTop = 0));
  });
  await review.screenshot({ path: path.join(SCREENSHOTS, 'review-light.png') });

  await check('dark theme', async () => {
    const dark = await context.newPage();
    const url = new URL(review.url());
    url.searchParams.set('theme', 'dark');
    await dark.goto(url.href);
    await dark.waitForSelector('.ds-line');
    const background = await dark.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert(background === 'rgb(13, 17, 23)', `background ${background}`);
    await dark.screenshot({ path: path.join(SCREENSHOTS, 'review-dark.png') });
    await dark.close();
  });

  await check('"Back to GitHub" returns to the PR tab and closes the review', async () => {
    await Promise.all([review.waitForEvent('close'), review.locator('#ds-back').click()]);
  });

  await check('large file renders quickly and the minimap bottom reaches the end', async () => {
    const extensionId = new URL(context.serviceWorkers()[0].url()).host;
    const large = await context.newPage();
    const params = new URLSearchParams({
      origin: 'https://github.com',
      owner: 'microsoft',
      repo: 'vscode',
      pr: '340793',
      path: 'src/vs/editor/common/model/textModel.ts',
      baseSha: '8571e6fd2f04a40dc0341c05897b93ff132b06f8',
      headSha: 'dc73b1a01be8002c3b3c764a1fb4840d05562094',
    });
    const started = Date.now();
    await large.goto(`chrome-extension://${extensionId}/review.html?${params}`);
    await large.waitForSelector('.ds-line', { timeout: 30_000 });
    const elapsed = Date.now() - started;
    const lines = await large.locator('.ds-line').count();
    assert(lines > 2000, `only ${lines} lines`);
    assert(elapsed < 5000, `took ${elapsed} ms`);
    const minimap = await large.locator('#ds-minimap').boundingBox();
    await large.mouse.click(minimap.x + minimap.width / 2, minimap.y + minimap.height - 1);
    const remaining = await large.locator('#ds-scroller').evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
    assert(remaining < 2, `${remaining}px left to scroll`);
    console.log(`    (${lines} lines in ${elapsed} ms)`);
    await large.close();
  });

  console.log('Client-side navigation');
  await check('buttons appear after navigating Conversation → Files changed', async () => {
    await page.goto(MANY_FILES_PR, { waitUntil: 'load' });
    await page.evaluate(() => (window.__diffsanityMarker = true));
    // The tab is ignored until GitHub's React app hydrates, so retry the click until navigation starts.
    for (let attempt = 0; attempt < 10 && !page.url().includes('/files'); attempt++) {
      await page.locator('a[href$="/pull/340793/files"]').first().click();
      await page.waitForTimeout(1000);
    }
    await page.waitForSelector('.diffsanity-button', { timeout: 30_000 });
    const sameDocument = await page.evaluate(() => window.__diffsanityMarker === true);
    console.log(`    (${sameDocument ? 'client-side' : 'full document'} navigation)`);
  });

  await check('buttons follow DOM updates and client-side URL changes', async () => {
    await page.goto(`${MANY_FILES_PR}/files`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.diffsanity-button', { timeout: 30_000 });
    // Simulate GitHub rendering a new file header after a client-side navigation to another tab and back.
    const addFile = (name) =>
      page.evaluate((name) => {
        const file = document.querySelector('.file-header[data-path]').closest('.file').cloneNode(true);
        file.querySelector('.diffsanity-button')?.remove();
        file.querySelector('.file-header').dataset.path = name;
        document.querySelector('.file').parentElement.append(file);
      }, name);
    await page.evaluate(() => history.pushState(null, '', location.pathname.replace(/\/files$/, '')));
    await addFile('conversation-tab.txt');
    await page.waitForTimeout(500);
    assert(
      (await page.locator('.file-header[data-path="conversation-tab.txt"] .diffsanity-button').count()) === 0,
      'button injected outside the Files changed tab',
    );
    await page.evaluate(() => history.pushState(null, '', `${location.pathname}/files`));
    await addFile('lazy-loaded.txt');
    await page.locator('.file-header[data-path="lazy-loaded.txt"] .diffsanity-button').waitFor({ timeout: 2000 });
  });

  console.log('Renamed file');
  await page.goto(`${RENAME_PR}/files`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.diffsanity-button', { timeout: 30_000 });
  await check('rename shows the old path and diffs against it', async () => {
    const renamed = await openReview(context, page, '.diffsanity-button[aria-label*="dataTransfer"]');
    const label = await renamed.locator('#ds-renamed').textContent();
    assert(label?.includes('renamed from'), `label "${label}"`);
    assert((await renamed.locator('.ds-line:not(.ds-add)').count()) > 0, 'no unchanged lines: old path not loaded');
    await renamed.close();
  });

  console.log('Review comments (signed out, classic view)');
  await page.goto(`${COMMENTS_PR}/files`, { waitUntil: 'domcontentloaded' });
  await page.locator(`.diffsanity-button[aria-label*="${COMMENTS_FILE}"]`).waitFor({ timeout: 60_000 });
  const commented = await openReview(context, page, `.diffsanity-button[aria-label*="${COMMENTS_FILE}"]`);
  await check("thread markers match GitHub's review threads", async () => {
    await commented.locator('.ds-thread-marker').first().waitFor({ timeout: 10_000 });
    const titles = await commented.locator('.ds-thread-marker').evaluateAll((markers) => markers.map((m) => m.title));
    assert(
      titles.some((title) => title.includes('line 71')) && titles.some((title) => title.includes('line 84')),
      `markers: ${titles.join(' | ')}`,
    );
  });
  await check('signed-out users get no comment button', async () => {
    await commented.locator('.ds-add').first().hover();
    assert((await commented.locator('.ds-comment-add').count()) === 0, '"+" shown while signed out');
  });
  await check('a thread marker scrolls GitHub to the conversation', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await commented.locator('.ds-thread-marker').first().click();
    await page.waitForFunction((file) => {
      const anchor = document.querySelector(`.file-header[data-path$="${file}"]`)?.dataset.anchor;
      const top = document.getElementById(`${anchor}R71`)?.getBoundingClientRect().top ?? -1;
      return top > 0 && top < innerHeight;
    }, COMMENTS_FILE, { timeout: 5000 });
  });
  await commented.close();

  console.log('GitHub dark mode');
  await check('button is readable in dark mode', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`${MANY_FILES_PR}/files`, { waitUntil: 'domcontentloaded' });
    const button = page.locator('.diffsanity-button').first();
    await button.waitFor({ timeout: 30_000 });
    await button.scrollIntoViewIfNeeded();
    const color = await button.evaluate((el) => getComputedStyle(el).backgroundColor);
    assert(color !== 'rgb(255, 255, 255)', `background ${color}`);
    await page.locator('.file-header[data-path]').first().screenshot({ path: path.join(SCREENSHOTS, 'github-button-dark.png') });
  });
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${SCREENSHOTS}`);
process.exitCode = failed ? 1 : 0;
