# Store listing

Copy-paste text and assets for the [Chrome Web Store](https://chrome.google.com/webstore/devconsole) and [Microsoft Edge Add-ons](https://partner.microsoft.com/dashboard/microsoftedge). Upload the zip from `npm run package` (`release/diffsanity-<version>.zip`) to both.

## Basics

| Field | Value |
| --- | --- |
| Name | DiffSanity |
| Summary (≤132 chars; comes from `manifest.json`) | Bring sanity back to GitHub diffs. Review a pull request file with full context, syntax highlighting and a minimap. |
| Category | Developer Tools |
| Language | English |
| Homepage / support URL | https://github.com/zubeirom/DiffSanity |
| Privacy policy URL | https://zubeirom.github.io/DiffSanity/PRIVACY.html |

## Description

```text
Bring sanity back to GitHub diffs.

GitHub's "Files changed" view shows small slices of each file, which makes it hard to understand a change in context. DiffSanity adds a button to every file header in a pull request. Click it to open that file in a focused review tab, the way Azure DevOps shows it:

• The whole file as one unified diff, so every change is read in context
• Syntax highlighting for common languages
• A minimap of the full file with additions, deletions and comments; click or drag to jump
• Every changed file in a list on the left, like GitHub's, so you can move through the whole pull request without leaving the tab
• Existing review conversations shown inline
• Write a comment on any changed line; DiffSanity hands it to GitHub's own comment box, so nothing is posted without you
• Colour themes: Match GitHub, GitHub Light / Dark, and Azure DevOps Dark / Light

Private by design: everything runs in your browser using your existing GitHub session. No servers, no tracking, no accounts.

Works on github.com and GitHub Enterprise Cloud (GHE.com) pull requests, in both the classic and the new review experience.
```

## Privacy practices (Chrome "Privacy" tab)

**Single purpose**

```text
DiffSanity opens a file from a GitHub pull request in a focused review tab that shows the whole file as one diff, with syntax highlighting, a minimap and GitHub's review comments, so reviewers can read each change in context.
```

**Host permission justification**

```text
github.com and *.ghe.com (GitHub Enterprise Cloud): adds the DiffSanity button to pull request pages, reads the diff and existing review comments from the page, downloads the full old and new versions of the file, and places new comments into GitHub's own comment box (nothing is posted automatically). *.ghe.com is needed because each enterprise has its own subdomain.
raw.githubusercontent.com: where github.com serves those file downloads from.
api.github.com: looks up which commits a public pull request compares, only when the page itself does not include them.
All requests go only to GitHub, directly from the user's browser, using their existing GitHub session. No data is collected or sent anywhere else.
```

**Remote code:** No, I am not using remote code. All scripts are bundled in the package.

**Data usage:** tick only **Website content** (the PR content is read and processed locally; Chrome requires declaring that). Leave everything else unticked. Certify all three statements (not sold, not used for unrelated purposes, not used for creditworthiness).

## Edge-specific

- **Account type:** Individual (sign in with a personal Microsoft account).
- **Notes for certification** (optional):

  ```text
  To test: open any public pull request, e.g. https://github.com/vercel/next.js/pulls, go to "Files changed" and click the brain icon in a file header.
  ```

## Assets (in this folder)

| File | Use |
| --- | --- |
| `screenshot-1-github.png` … `screenshot-5-comments.png` (1280×800, full bleed) | Screenshots, both stores, in this order |
| `promo-small-440x280.png` | Chrome small promo tile (required); Edge small promotional tile |
| `promo-marquee-1400x560.png` | Chrome marquee; Edge large promotional tile (optional) |
| `logo-300.png` | Edge extension logo (Chrome uses `icons/icon-128.png` from the zip) |
