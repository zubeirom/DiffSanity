import { describe, expect, it } from 'vitest';
import { escapeHtml, highlightLines, languageForPath, tokensToLines } from '../src/review/syntax';

describe('languageForPath', () => {
  it('maps extensions case-insensitively', () => {
    expect(languageForPath('src/App.TSX')).toBe('tsx');
    expect(languageForPath('Makefile')).toBeUndefined();
  });
});

describe('escapeHtml', () => {
  it('escapes markup', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});

describe('tokensToLines', () => {
  it('splits tokens that span lines', () => {
    expect(tokensToLines([{ type: 'comment', content: '/* a\nb */', alias: undefined } as never, ' x'])).toEqual([
      '<span class="token comment">/* a</span>',
      '<span class="token comment">b */</span> x',
    ]);
  });
});

describe('highlightLines', () => {
  it('returns one HTML line per source line, preserving multi-line context', () => {
    const lines = ['const a = 1; /* start', 'still comment */', 'let b = "<b>";'];
    const html = highlightLines(lines, 'x.ts')!;
    expect(html).toHaveLength(3);
    expect(html[1]).toContain('token comment');
    expect(html[2]).toContain('&lt;b&gt;');
    expect(html[2]).not.toContain('<b>');
  });

  it('keeps empty lines aligned', () => {
    expect(highlightLines(['a', '', 'b'], 'x.js')).toHaveLength(3);
  });

  it('returns null for unknown languages', () => {
    expect(highlightLines(['x'], 'file.unknownext')).toBeNull();
  });
});
