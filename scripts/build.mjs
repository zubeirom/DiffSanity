import { spawn } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { context, build } from 'esbuild';

const watch = process.argv.includes('--watch');
const outdir = 'dist';
// The CLI package only exports package.json, so its binary is found next to it.
const tailwindCli = join(dirname(createRequire(import.meta.url).resolve('@tailwindcss/cli/package.json')), 'dist/index.mjs');

const options = {
  entryPoints: {
    content: 'src/content/index.ts',
    background: 'src/background/index.ts',
    review: 'src/review/reviewPage.ts',
  },
  outdir,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
};

async function copyStatic() {
  await mkdir(outdir, { recursive: true });
  await Promise.all([
    cp('manifest.json', `${outdir}/manifest.json`),
    cp('review.html', `${outdir}/review.html`),
    cp('styles/github.css', `${outdir}/github.css`),
    cp('icons', `${outdir}/icons`, { recursive: true }),
  ]);
}

/** Compiles the review page's Tailwind stylesheet; in watch mode it keeps rebuilding in the background. */
function buildReviewCss() {
  const args = [tailwindCli, '-i', 'styles/review.css', '-o', `${outdir}/review.css`, watch ? '--watch' : '--minify'];
  const child = spawn(process.execPath, args, { stdio: watch ? 'inherit' : ['ignore', 'ignore', 'inherit'] });
  if (watch) return Promise.resolve();
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Tailwind exited with code ${code}`))));
  });
}

await rm(outdir, { recursive: true, force: true });
await copyStatic();
await buildReviewCss();

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching for changes (static files are copied once; rerun to refresh them)…');
} else {
  await build(options);
}
