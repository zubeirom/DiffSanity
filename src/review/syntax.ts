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

/** Languages where, as in Monaco's tokenizer, every capitalised identifier is a type name. */
const TYPE_NAME_LANGUAGES = new Set(['javascript', 'typescript', 'jsx', 'tsx']);
/** Tokens whose text is not code, so capitalised words inside them are left alone. */
const NON_CODE_TOKENS = new Set(['comment', 'hashbang', 'string', 'char', 'regex', 'attr-value', 'plain-text']);
const CAPITALISED_WORD = /(?<![\w$])[A-Z][\w$]*/g;
const TYPE_NAME_CLASS = 'type-name';

function splitTypeNames(text: string): Array<string | Prism.Token> {
  const parts: Array<string | Prism.Token> = [];
  let last = 0;
  for (const match of text.matchAll(CAPITALISED_WORD)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(new Prism.Token(TYPE_NAME_CLASS, match[0]));
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * Tags capitalised identifiers with a `type-name` class: plain text is split into type-name tokens
 * and capitalised tokens (`Promise`, `String(…)`, `MAX_SIZE`) get it as an extra alias.
 * Only themes that style `.type-name` (Azure DevOps) change; others look the same.
 */
function markTypeNames(stream: Prism.TokenStream): Prism.TokenStream {
  const items = Array.isArray(stream) ? stream : [stream];
  return items.flatMap((item) => {
    if (typeof item === 'string') return splitTypeNames(item);
    if (NON_CODE_TOKENS.has(item.type)) return [item];
    if (typeof item.content !== 'string') {
      item.content = markTypeNames(item.content);
    } else if (/^[A-Z]/.test(item.content)) {
      const aliases = Array.isArray(item.alias) ? item.alias : item.alias ? [item.alias] : [];
      item.alias = [...aliases, TYPE_NAME_CLASS];
    }
    return [item];
  });
}

/**
 * Highlights a whole file (so multi-line constructs are understood) and returns HTML per line,
 * aligned with `splitLines(content)`. Returns null when the language is unknown or the file is too large.
 */
export function highlightLines(lines: readonly string[], path: string): string[] | null {
  const language = languageForPath(path);
  const grammar = language ? Prism.languages[language] : undefined;
  if (!language || !grammar) return null;
  const text = lines.join('\n');
  if (text.length > MAX_HIGHLIGHT_CHARS) return null;
  const tokens = Prism.tokenize(text, grammar);
  return tokensToLines(TYPE_NAME_LANGUAGES.has(language) ? markTypeNames(tokens) : tokens);
}
