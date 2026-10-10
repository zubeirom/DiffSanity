// Zips the built extension (dist/) for upload to the Chrome Web Store and Microsoft Edge Add-ons.
// Run through `npm run package`, which builds first.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { zipSync } from 'fflate';

const distDir = 'dist';
const releaseDir = 'release';

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)])),
  );
  return nested.flat();
}

const manifest = JSON.parse(await readFile(join(distDir, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (manifest.version !== pkg.version) {
  console.error(`Version mismatch: manifest.json is ${manifest.version}, package.json is ${pkg.version}. Bump both.`);
  process.exit(1);
}

const files = {};
for (const file of await listFiles(distDir)) {
  // Store paths use forward slashes, with manifest.json at the zip root.
  files[relative(distDir, file).split(sep).join('/')] = await readFile(file);
}

await mkdir(releaseDir, { recursive: true });
const output = join(releaseDir, `diffsanity-${manifest.version}.zip`);
await writeFile(output, zipSync(files, { level: 9 }));
console.log(`Packaged ${Object.keys(files).length} files into ${output}`);
