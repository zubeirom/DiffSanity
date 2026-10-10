import { cp, mkdir, rm } from 'node:fs/promises';
import { context, build } from 'esbuild';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

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
    cp('styles/review.css', `${outdir}/review.css`),
    cp('icons', `${outdir}/icons`, { recursive: true }),
  ]);
}

await rm(outdir, { recursive: true, force: true });
await copyStatic();

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching for changes (static files are copied once; rerun to refresh them)…');
} else {
  await build(options);
}
