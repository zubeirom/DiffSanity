# DiffSanity privacy policy

_Last updated: 10 October 2026_

DiffSanity is a browser extension that opens a GitHub pull request file in a focused review tab.

## Summary

DiffSanity has no backend server, no analytics, no tracking and no accounts. The developer receives **no data** from you. The only data it handles is **website content**: the pull request content it reads from GitHub to show you the file. That content is processed only inside your browser and is never sold, shared or sent anywhere except back to GitHub.

## What DiffSanity reads

To show a file, the extension reads data **directly from GitHub, inside your browser**:

| Site | Why |
| --- | --- |
| `github.com`, `<enterprise>.ghe.com` | Adds the DiffSanity button to pull request pages, reads the file's diff and review comments from the page, and hands new comments back to GitHub's own comment box. Also downloads the full old and new versions of the file. |
| `raw.githubusercontent.com` | Where github.com serves those file downloads from. |
| `api.github.com` | Looks up which commits a public github.com pull request compares when the page does not say. |

These requests use your existing GitHub session in the browser, the same as visiting GitHub yourself. Nothing is sent anywhere else.

## What DiffSanity stores

Only your colour theme choice, kept in the extension's local browser storage on your device. Removing the extension deletes it.

## Comments

DiffSanity never posts anything by itself. When you write a comment, it is placed into GitHub's own comment box on the pull request page, and you submit it there.

## Contact

Questions or concerns: open an issue at <https://github.com/zubeirom/DiffSanity/issues>.
