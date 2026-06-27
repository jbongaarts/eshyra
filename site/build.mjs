#!/usr/bin/env node

// Static-site build for eshyra.app.
//
// This produces `site/dist/` from `site/src/`, and assembles the downloadable
// D&D 5e SRD 5.1 rules-pack bundle from the committed rules-pack data. The
// rules pack is CC BY 4.0 (redistribution explicitly allowed); the surrounding
// Eshyra application code is NOT bundled or referenced here. Everything written
// to `dist/` is derived only from `site/src/` and the CC BY rules-pack data.
//
// Dependency-free on purpose: uses only Node built-ins plus the `zip` CLI
// (present on GitHub Actions ubuntu runners and standard dev machines). The
// site has its own release cycle and is intentionally not wired into the npm
// workspaces or the application build.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const srcDir = join(here, 'src');
const distDir = join(here, 'dist');
const downloadsDir = join(distDir, 'downloads');

const packDir = join(
  repoRoot,
  'packages',
  'core',
  'data',
  'rules-packs',
  'rules__dnd5e-srd-5.1',
);
const manifestPath = join(packDir, 'manifest.json');
const recordsPath = join(packDir, 'records.json');

const ZIP_NAME = 'eshyra-srd-5.1-rules-pack.zip';

function log(message) {
  process.stdout.write(`[site:build] ${message}\n`);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function assetVersion() {
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return buildDate;
  }
}

// --- Read source data ------------------------------------------------------

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const records = JSON.parse(readFileSync(recordsPath, 'utf8'));
if (!Array.isArray(records)) {
  throw new Error('Expected rules-pack records.json to be a JSON array.');
}

const kindCounts = new Map();
for (const record of records) {
  const kind = record.kind ?? 'unknown';
  kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
}
const kindsSorted = [...kindCounts.entries()].sort(
  (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
);

const attributionText = manifest.license.attributionText;
const sourceTitle = manifest.source.sourceTitle;
const sourceUrl = manifest.source.sourceUrl;
const sourceHash = manifest.source.sourceHash;
const sourceDate = manifest.source.sourceDate;
const buildDate = new Date().toISOString().slice(0, 10);

// --- Assemble the downloadable bundle --------------------------------------

rmSync(distDir, { recursive: true, force: true });
mkdirSync(downloadsDir, { recursive: true });

const bundleStaging = join(distDir, '.bundle-staging');
const bundleRoot = join(bundleStaging, 'eshyra-srd-5.1-rules-pack');
mkdirSync(bundleRoot, { recursive: true });

cpSync(manifestPath, join(bundleRoot, 'manifest.json'));
cpSync(recordsPath, join(bundleRoot, 'records.json'));

const bundleAttribution = [
  'D&D 5e SRD 5.1 — structured rules pack',
  '',
  'This bundle is a structured, machine-friendly representation of the System',
  'Reference Document 5.1, extracted by the deterministic importer in the',
  'Eshyra project. It is reference data derived from CC BY 4.0 source material.',
  'It is NOT original game content and NOT an endorsement by Wizards of the',
  'Coast.',
  '',
  'REQUIRED ATTRIBUTION (Creative Commons Attribution 4.0 International):',
  '',
  attributionText,
  '',
  'License: https://creativecommons.org/licenses/by/4.0/legalcode',
  `Source: ${sourceTitle} — ${sourceUrl}`,
  `Source SHA-256: ${sourceHash}`,
  `Source date: ${sourceDate}`,
  '',
  'When you redistribute these records or derivatives, preserve the attribution',
  'text above.',
  '',
  'Project: https://github.com/jbongaarts/eshyra',
  '',
].join('\n');
writeFileSync(join(bundleRoot, 'ATTRIBUTION.txt'), bundleAttribution);

const bundleReadme = [
  '# D&D 5e SRD 5.1 — structured rules pack',
  '',
  `- Records: ${records.length}`,
  `- Record kinds: ${kindsSorted.length}`,
  '- License: Creative Commons Attribution 4.0 International (CC BY 4.0)',
  `- Source: ${sourceTitle} (${sourceDate})`,
  '',
  '## Files',
  '',
  '- `manifest.json` — pack metadata, license, and source provenance.',
  '- `records.json` — a JSON array of rules records. Each record carries',
  '  `systemId`, `kind`, `key`, `name`, `data`, `source`, `license`, and',
  '  `provenance` naming the SRD location it was extracted from.',
  '- `ATTRIBUTION.txt` — the required CC BY 4.0 attribution notice.',
  '',
  'See ATTRIBUTION.txt before redistributing.',
  '',
].join('\n');
writeFileSync(join(bundleRoot, 'README.md'), bundleReadme);

// --- Zip the bundle (deterministic; `zip` CLI) -----------------------------

const zipPath = join(downloadsDir, ZIP_NAME);
log('creating rules-pack zip...');
execFileSync('zip', ['-r', '-q', '-X', zipPath, 'eshyra-srd-5.1-rules-pack'], {
  cwd: bundleStaging,
});
rmSync(bundleStaging, { recursive: true, force: true });

const zipBuffer = readFileSync(zipPath);
const zipHash = sha256(zipBuffer);
const zipBytes = statSync(zipPath).size;
writeFileSync(
  join(downloadsDir, `${ZIP_NAME}.sha256`),
  `${zipHash}  ${ZIP_NAME}\n`,
);
log(`bundle: ${ZIP_NAME} (${formatBytes(zipBytes)}, sha256 ${zipHash})`);

// --- Copy static assets and render the landing page ------------------------

cpSync(srcDir, distDir, {
  recursive: true,
  filter: (source) => !source.endsWith('.tmpl'),
});

const kindsRows = kindsSorted
  .map(
    ([kind, count]) =>
      `        <tr><td>${escapeHtml(kind)}</td><td>${count}</td></tr>`,
  )
  .join('\n');

const replacements = {
  RECORD_COUNT: String(records.length),
  KIND_COUNT: String(kindsSorted.length),
  KINDS_ROWS: kindsRows,
  ZIP_NAME,
  ZIP_SIZE: formatBytes(zipBytes),
  ZIP_SHA256: zipHash,
  SOURCE_DATE: sourceDate,
  SOURCE_HASH: sourceHash,
  BUILD_DATE: buildDate,
  ASSET_VERSION: assetVersion(),
};

let html = readFileSync(join(srcDir, 'index.html.tmpl'), 'utf8');
for (const [key, value] of Object.entries(replacements)) {
  html = html.replaceAll(`{{${key}}}`, value);
}
const leftover = html.match(/\{\{[A-Z_]+\}\}/);
if (leftover) {
  throw new Error(`Unsubstituted template placeholder: ${leftover[0]}`);
}
writeFileSync(join(distDir, 'index.html'), html);

log(`done -> ${distDir}`);
