// Generate sha256sums.txt for all release artifacts under dist-release/.
//
// Usage:
//   node scripts/release/generate-checksums.mjs [--out <dir>]
// Default <dir>: dist-release/
//
// Output: dist-release/sha256sums.txt with one line per archive/metadata file:
//   <sha256hex>  <filename>

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function parseArgs(argv) {
  const opts = { out: join(root, 'dist-release') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') {
      i += 1;
      opts.out = resolve(argv[i]);
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return opts;
}

function sha256hex(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(opts.out)) {
    throw new Error(
      `output directory not found: ${opts.out} -- run npm run release:build first`,
    );
  }

  const files = readdirSync(opts.out)
    .filter(
      (f) => f.endsWith('.tar.gz') || f.endsWith('.zip') || f.endsWith('.json'),
    )
    .sort();

  if (files.length === 0) {
    throw new Error(`no release artifacts found in ${opts.out}`);
  }

  const lines = files.map((f) => {
    const hash = sha256hex(join(opts.out, f));
    return `${hash}  ${basename(f)}`;
  });

  const outPath = join(opts.out, 'sha256sums.txt');
  writeFileSync(outPath, `${lines.join('\n')}\n`);
  console.log(`\nWrote ${lines.length} checksum(s) to ${outPath}`);
  for (const line of lines) {
    console.log(`  ${line}`);
  }
}

main();
