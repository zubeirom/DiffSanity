# Agent guide

Rules and conventions for anyone (human or AI agent) changing DiffSanity. Read this before making changes.

**What DiffSanity is:** a Chrome/Edge MV3 extension. It adds a button to each file on a GitHub pull request's *Files changed* tab and opens that file in a focused review tab (whole file as one diff, syntax highlighting, minimap, themes, GitHub comment hand-off). See [README.md](README.md) for features, the architecture diagram, the module table, how files are fetched and every GitHub selector the extension relies on. Keep those sections up to date instead of copying them here.

## Ground rules

These are product promises. Do not break them without the owner's explicit approval.

- **Never post to GitHub on the user's behalf.** DiffSanity reads GitHub and hands comments to GitHub's own comment box; the user always presses the final button.
- **Everything stays in the browser.** No backend, analytics, telemetry, accounts, OAuth or tokens. Requests go only to the hosts in `manifest.json`.
- **No remote code.** No `eval`, `new Function`, remote scripts or CDN assets. The CSP is `script-src 'self'`. Store reviews depend on this.
- **Minimal permissions.** Do not add permissions or hosts unless a feature truly needs them. If you do, update `PRIVACY.md` and the justifications in `docs/store/README.md` in the same change.
- **Supported hosts:** `https://github.com` and `https://<enterprise>.ghe.com`, checked by `isAllowedOrigin` in `src/shared/githubContext.ts`. The manifest's `*.ghe.com` pattern also matches `ghe.com` itself, so code must still check `isAllowedOrigin`. GitHub Enterprise Server (any domain) is not supported.

## Architecture rules

- **All GitHub DOM knowledge lives in `src/content/github.ts`.** If GitHub changes its markup, that file (plus the commit regexes in `src/shared/githubContext.ts`) should be the only place to fix. Update the "GitHub DOM dependencies" table in the README when selectors change.
- GitHub has **two Files changed UIs**: classic (server-rendered) and React. It also uses two URLs: `/pull/N/files` and `/pull/N/changes`. Support both, and add a test fixture for each.
- GitHub navigates client-side. The content script reacts to DOM mutations (throttled), `turbo:load` and `popstate`; injection must be **idempotent**.
- Prefer semantic attributes (`data-*`, `href` shapes, `id`s) over generated class names. If a class substring is unavoidable, have a fallback.
- `src/shared/` is pure and framework-free: URL parsing, validation, shared types. Message types live in `src/shared/types.ts` and are prefixed `diffsanity:`.
- The review page works on the normalised `FileDiff` model (`src/shared/types.ts`), not on GitHub data. Renderer, minimap and comments stay separate modules.
- Performance: no DOM node per line where avoidable (the minimap is one canvas); keep work debounced; large files (thousands of lines) must stay fast.
- CSS: classes injected into GitHub pages use the `diffsanity-` prefix and Primer CSS variables with fallbacks (`styles/github.css`). The review page is styled with Tailwind CSS v4, compiled at build time from `styles/review.css`: use utilities in `review.html` for layout, and `ds-` component classes in `@layer components` for anything reused or set from TypeScript. Colours come from the theme variables (`bg-canvas`, `text-muted`, `border-line`, …), never fixed values. Themes are `:root[data-theme="…"]` CSS variable blocks; add a theme there and in `src/review/themes.ts`.

## Code style

- TypeScript `strict` (see `tsconfig.json`); no `any`, no unused code. Match the surrounding code: 2-space indent, single quotes, semicolons.
- Small modules, pure functions where possible, so they can be unit-tested without a browser.
- Clear names and named constants (`SCAN_DELAY_MS`, `ADD_COMMENT_BUTTON`) over magic values.
- Doc comments on exported types and functions. Inline comments only to explain *why*, never to restate code.
- Handle failure quietly and safely: a GitHub DOM change should degrade to "no button" or a clear message in the review tab, never a broken GitHub page.
- Validate anything that crosses a boundary (URL query params, runtime messages, fetched content).
- Dependencies: keep them few. Runtime deps today are `diff` (jsdiff) and `prismjs` only. Tailwind is a build-time dev dependency; nothing from it runs in the extension except the compiled CSS.

## Testing

| Command | When |
| --- | --- |
| `npm run typecheck` | Every change |
| `npm test` | Every change. Vitest + jsdom, tests in `test/` |
| `npm run build` | Every change; output goes to `dist/` |
| `npm run e2e` | Any change to `src/content`, `src/review` or `manifest.json`. Runs `dist/` against live public PRs (~3 min, 21 checks) |

- Add or update unit tests with every behaviour change. DOM tests use small fixtures **trimmed from live GitHub markup** (see `test/github.test.ts`); add a fixture when GitHub's markup changes.
- `npm run e2e` overwrites `docs/screenshots/`. Revert them (`git checkout -- docs/screenshots`) unless you mean to update the README images.
- E2E is read-only. Never post comments or change anything on GitHub while testing.
- Load the unpacked `dist/` to try changes by hand. After changing `manifest.json`, **reload the extension** while it is enabled, or new host permissions are not granted.

## Docs to keep in sync

| Change | Update |
| --- | --- |
| New or changed feature | README feature list, *Tested* and *Known limitations*; store description in `docs/store/README.md` |
| GitHub selectors | README "GitHub DOM dependencies" table |
| Data, hosts or permissions | `PRIVACY.md` (and its *Last updated* date), `docs/store/README.md` justifications and privacy answers |
| Build or scripts | README *Development* table |

`PRIVACY.md` is published by GitHub Pages (repo root, `master`) at https://zubeirom.github.io/DiffSanity/PRIVACY.html, which is the URL in both stores. Do not rename or move it. Exclude non-site files (sources, scripts, build output) from Pages in `_config.yml`.

## Commits and releases

- Commit messages: short imperative summary in sentence case, no prefixes (e.g. "Support GitHub Enterprise Cloud (*.ghe.com)"). Use the body to explain *why* when it is not obvious.
- Never commit secrets, `dist/`, `release/` or scratch files (probe scripts, local screenshots of private code).
- **Every user-facing change ships as a GitHub release:**
  1. Bump `version` in **both** `manifest.json` and `package.json` (semver: minor for features, patch for fixes). The stores reject a version they have already seen, and `npm run package` fails if the two differ.
  2. Run typecheck, tests, build and (if relevant) e2e.
  3. Commit and push to `master`.
  4. `npm run package` creates `release/diffsanity-<version>.zip`.
  5. `gh release create v<version> release/diffsanity-<version>.zip --repo zubeirom/DiffSanity --title "v<version>" --notes "<what changed, in plain words>"`.
  6. Tell the owner to upload that zip to the Chrome Web Store and Edge Add-ons, and to update any listing text or justifications that changed.

## Writing style

For README, store text, release notes, UI strings and messages to the owner: plain, simple English, short sentences, no jargon, no filler. Say what something does, not how clever it is.

## Roadmap

The review tab now covers the whole pull request: a GitHub-style file list on the left switches files in place, using the existing `FileDiff` model, renderer and minimap. Build new review features on those modules rather than a parallel implementation. Next ideas (syncing GitHub's "Viewed" state, j/k change navigation, side-by-side view) are listed under *Known limitations* in the README.
