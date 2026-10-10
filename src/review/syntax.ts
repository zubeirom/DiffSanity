import './prismSetup';
import Prism from 'prismjs';
// Order matters: components extend languages loaded before them.
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-powershell';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-sql';

/** Highlighting is skipped above this size to keep large files instant. */
const MAX_HIGHLIGHT_CHARS = 2_000_000;

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  cs: 'csharp', csx: 'csharp',
  py: 'python', pyi: 'python',
  json: 'json', jsonc: 'json',
  yml: 'yaml', yaml: 'yaml',
  md: 'markdown', markdown: 'markdown',
  css: 'css', scss: 'scss',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup', vue: 'markup',
  csproj: 'markup', props: 'markup', targets: 'markup', resx: 'markup', xaml: 'markup',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  go: 'go', java: 'java', rs: 'rust',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  sql: 'sql',
};

export function languageForPath(path: string): string | undefined {
  const name = path.split('/').pop() ?? '';
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return LANGUAGE_BY_EXTENSION[extension];
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ESCAPES[char]);
}

type TokenStream = Prism.TokenStream;

/**
 * Converts a Prism token stream into one HTML string per source line. Nested tokens are flattened
 * into a single span carrying all their classes, and tokens spanning lines are split per line.
 */
export function tokensToLines(tokens: TokenStream): string[] {
  const lines: string[] = [];
  let current = '';

  const emit = (text: string, classes: string) => {
    const parts = text.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) {
        lines.push(current);
        current = '';
      }
      if (part) current += classes ? `<span class="${classes}">${escapeHtml(part)}</span>` : escapeHtml(part);
    });
  };

  const visit = (stream: TokenStream, classes: string) => {
    if (typeof stream === 'string') return emit(stream, classes);
    if (!Array.isArray(stream)) stream = [stream];
    for (const token of stream) {
      if (typeof token === 'string') {
        emit(token, classes);
        continue;
      }
      const aliases = Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : [];
      const tokenClasses = ['token', token.type, ...aliases].join(' ');
      visit(token.content, classes ? `${classes} ${tokenClasses}` : tokenClasses);
    }
  };

  visit(tokens, '');
  lines.push(current);
  return lines;
}

/**
 * Highlights a whole file (so multi-line constructs are understood) and returns HTML per line,
 * aligned with `splitLines(content)`. Returns null when the language is unknown or the file is too large.
 */
export function highlightLines(lines: readonly string[], path: string): string[] | null {
  const language = languageForPath(path);
  const grammar = language ? Prism.languages[language] : undefined;
  if (!grammar) return null;
  const text = lines.join('\n');
  if (text.length > MAX_HIGHLIGHT_CHARS) return null;
  return tokensToLines(Prism.tokenize(text, grammar));
}
