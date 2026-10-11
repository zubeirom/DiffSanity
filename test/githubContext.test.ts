import { describe, expect, it } from 'vitest';
import {
  extractRevisionsFromText,
  fromReviewSearch,
  isAllowedOrigin,
  isPullRequestFilesPage,
  parsePullRequestUrl,
  parseRenamedPath,
  pullRequestFilesUrl,
  rawFileUrl,
  toPullRequestFiles,
  toReviewSearch,
} from '../src/shared/githubContext';
import type { ReviewRequest } from '../src/shared/types';

const BASE = '8571e6fd2f04a40dc0341c05897b93ff132b06f8';
const HEAD = 'dc73b1a01be8002c3b3c764a1fb4840d05562094';
const OTHER = 'a'.repeat(40);

describe('parsePullRequestUrl', () => {
  it('parses owner, repo and number from any PR tab', () => {
    expect(parsePullRequestUrl('https://github.com/microsoft/vscode/pull/340793/files#diff-abc')).toEqual({
      owner: 'microsoft',
      repo: 'vscode',
      pr: 340793,
    });
    expect(parsePullRequestUrl('https://github.com/o/r/pull/7')).toEqual({ owner: 'o', repo: 'r', pr: 7 });
  });

  it('rejects non-PR URLs', () => {
    expect(parsePullRequestUrl('https://github.com/o/r/issues/7')).toBeNull();
    expect(parsePullRequestUrl('https://github.com/o/r')).toBeNull();
  });
});

describe('isPullRequestFilesPage', () => {
  it('accepts the classic and new files routes', () => {
    expect(isPullRequestFilesPage('https://github.com/o/r/pull/1/files')).toBe(true);
    expect(isPullRequestFilesPage('https://github.com/o/r/pull/1/files/abc..def')).toBe(true);
    expect(isPullRequestFilesPage('https://github.com/o/r/pull/1/changes')).toBe(true);
  });

  it('rejects other PR tabs', () => {
    expect(isPullRequestFilesPage('https://github.com/o/r/pull/1')).toBe(false);
    expect(isPullRequestFilesPage('https://github.com/o/r/pull/1/commits')).toBe(false);
  });
});

describe('extractRevisionsFromText', () => {
  it('prefers a selected commit range over the merge base', () => {
    const text = `data-url="/x?base_commit_oid=${OTHER}&start_commit_oid=${BASE}&end_commit_oid=${HEAD}"`;
    expect(extractRevisionsFromText(text)).toEqual({ baseSha: BASE, headSha: HEAD });
  });

  it('falls back to the merge base and blob links', () => {
    const text = `?base_commit_oid=${BASE}" <a href="/o/r/blob/${HEAD}/src/a.ts">`;
    expect(extractRevisionsFromText(text)).toEqual({ baseSha: BASE, headSha: HEAD });
  });

  it('reads embedded JSON keys but never the base branch tip', () => {
    expect(extractRevisionsFromText(`{"baseRefOid":"${OTHER}"}`).baseSha).toBeUndefined();
    expect(extractRevisionsFromText(`{"baseCommitOid":"${BASE}","headOid":"${HEAD}"}`)).toEqual({
      baseSha: BASE,
      headSha: HEAD,
    });
  });

  it('returns nothing for unrelated text', () => {
    expect(extractRevisionsFromText('no commits here')).toEqual({ baseSha: undefined, headSha: undefined });
  });
});

describe('parseRenamedPath', () => {
  it('splits GitHub rename notation', () => {
    expect(parseRenamedPath('src/dnd.ts → src/dataTransfer.ts')).toEqual({
      oldPath: 'src/dnd.ts',
      path: 'src/dataTransfer.ts',
    });
  });

  it('splits the screen-reader wording of the React view', () => {
    expect(parseRenamedPath('src/dnd.ts renamed to src/dataTransfer.ts')).toEqual({
      oldPath: 'src/dnd.ts',
      path: 'src/dataTransfer.ts',
    });
  });

  it('ignores plain paths', () => {
    expect(parseRenamedPath('src/a.ts')).toBeNull();
    expect(parseRenamedPath('→ b')).toBeNull();
  });
});

describe('toPullRequestFiles', () => {
  it('keeps valid fields and drops malformed entries', () => {
    expect(
      toPullRequestFiles([
        { path: 'a.ts', oldPath: 'b.ts', status: 'renamed', anchor: 'diff-1', additions: 2, deletions: 0 },
        { path: 'c.ts', status: 'unknown', additions: -1, deletions: 1.5, anchor: '' },
        { path: '' },
        null,
        'd.ts',
      ]),
    ).toEqual([
      { path: 'a.ts', oldPath: 'b.ts', status: 'renamed', anchor: 'diff-1', additions: 2, deletions: 0 },
      { path: 'c.ts' },
    ]);
  });

  it('returns nothing for values that are not lists', () => {
    expect(toPullRequestFiles(undefined)).toEqual([]);
    expect(toPullRequestFiles({ path: 'a.ts' })).toEqual([]);
  });
});

describe('URL builders', () => {
  it('encodes path segments but keeps slashes', () => {
    expect(rawFileUrl('https://github.com', 'o', 'r', HEAD, 'docs/a b#c.md')).toBe(
      `https://github.com/o/r/raw/${HEAD}/docs/a%20b%23c.md`,
    );
  });

  it('links back to the file anchor', () => {
    const ref = { origin: 'https://github.com', owner: 'o', repo: 'r', pr: 3 };
    expect(pullRequestFilesUrl(ref)).toBe('https://github.com/o/r/pull/3/files');
    expect(pullRequestFilesUrl({ ...ref, anchor: 'diff-123' })).toBe('https://github.com/o/r/pull/3/files#diff-123');
  });
});

describe('review search parameters', () => {
  const request: ReviewRequest = {
    origin: 'https://github.com',
    owner: 'microsoft',
    repo: 'vscode',
    pr: 248252,
    path: 'src/dataTransfer.ts',
    oldPath: 'src/dnd.ts',
    status: 'renamed',
    baseSha: BASE,
    headSha: HEAD,
    anchor: 'diff-abc',
    theme: 'dark',
    sourceTabId: 42,
  };

  it('round-trips a full request', () => {
    expect(fromReviewSearch(`?${toReviewSearch(request)}`)).toEqual(request);
  });

  it('omits undefined fields', () => {
    const search = toReviewSearch({ origin: request.origin, owner: 'o', repo: 'r', pr: 1, path: 'a.ts' });
    expect(search).toBe('origin=https%3A%2F%2Fgithub.com&owner=o&repo=r&pr=1&path=a.ts');
  });

  it('rejects missing fields and untrusted origins', () => {
    expect(fromReviewSearch('owner=o&repo=r&pr=1&path=a')).toBeNull();
    expect(fromReviewSearch('origin=https://github.com&owner=o&repo=r&pr=0&path=a')).toBeNull();
    expect(fromReviewSearch('origin=https://evil.example&owner=o&repo=r&pr=1&path=a')).toBeNull();
  });

  it('drops malformed optional values', () => {
    const parsed = fromReviewSearch(
      'origin=https://github.com&owner=o&repo=r&pr=1&path=a&baseSha=nope&status=weird&theme=blue&sourceTabId=-1',
    );
    expect(parsed).toMatchObject({ baseSha: undefined, status: undefined, theme: undefined, sourceTabId: undefined });
  });

  it('allows github.com and GHE.com enterprise origins only', () => {
    expect(isAllowedOrigin('https://github.com')).toBe(true);
    expect(isAllowedOrigin('https://octocorp.ghe.com')).toBe(true);
    expect(isAllowedOrigin('https://my-corp1.ghe.com')).toBe(true);

    expect(isAllowedOrigin('http://github.com')).toBe(false);
    expect(isAllowedOrigin('http://octocorp.ghe.com')).toBe(false);
    expect(isAllowedOrigin('https://ghe.com')).toBe(false);
    expect(isAllowedOrigin('https://a.b.ghe.com')).toBe(false);
    expect(isAllowedOrigin('https://-corp.ghe.com')).toBe(false);
    expect(isAllowedOrigin('https://octocorp.ghe.com:8443')).toBe(false);
    expect(isAllowedOrigin('https://octocorp.ghe.com.evil.example')).toBe(false);
    expect(isAllowedOrigin('https://github.example.com')).toBe(false);
  });

  it('accepts review requests from GHE.com', () => {
    const parsed = fromReviewSearch('origin=https%3A%2F%2Foctocorp.ghe.com&owner=o&repo=r&pr=1&path=a.ts');
    expect(parsed).toMatchObject({ origin: 'https://octocorp.ghe.com', owner: 'o', repo: 'r', pr: 1 });
    expect(fromReviewSearch('origin=https%3A%2F%2Fevil.example&owner=o&repo=r&pr=1&path=a.ts')).toBeNull();
  });
});
