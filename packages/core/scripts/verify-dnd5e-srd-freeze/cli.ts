/**
 * Freeze guard for the audited D&D 5e SRD 5.1 artifact (eshyra-ixcd).
 *
 * Enforces two policies:
 *
 *   1. Hash policy — the committed frozen files must match the hashes recorded
 *      in `docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json`. Fails with
 *      a clear diff-style message if any file is missing or hash-mismatched.
 *
 *   2. Thaw-note policy — when a base ref is supplied (via --base or the
 *      GITHUB_BASE_REF env var in GitHub Actions), any changed frozen path
 *      requires an active thaw note committed in the same diff under
 *      `docs/audits/dnd5e-srd-5.1-final/thaw-notes/`.
 *
 * The hash check always runs. The thaw-note check runs only when a base ref
 * is resolvable. A PR that passes the thaw-note check (i.e. has a thaw note)
 * still runs the full hash check — the reviewer must also update the freeze
 * manifest and audit evidence consistently.
 *
 * Usage:
 *
 *   npm run verify:dnd5e-srd-freeze
 *   npm run verify:dnd5e-srd-freeze -- --base origin/main
 *
 * Exit codes:
 *   0  all checks passed.
 *   1  one or more checks failed.
 *   2  script could not run (manifest missing, git failure, etc.).
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkHashes,
  checkThawPolicy,
  type FreezeManifest,
  getChangedFiles,
} from './freeze.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const MANIFEST_REL = 'docs/audits/dnd5e-srd-5.1-final/freeze-manifest.json';
const MANIFEST_PATH = join(REPO_ROOT, MANIFEST_REL);

function parseArgs(): { base?: string } {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--base');
  return idx !== -1 && args[idx + 1] !== undefined
    ? { base: args[idx + 1] }
    : {};
}

async function main(): Promise<void> {
  const { base } = parseArgs();

  let manifest: FreezeManifest;
  try {
    manifest = JSON.parse(
      readFileSync(MANIFEST_PATH, 'utf8'),
    ) as FreezeManifest;
  } catch (cause) {
    console.error(
      `verify:dnd5e-srd-freeze: cannot load freeze manifest: ${(cause as Error).message}`,
    );
    process.exit(2);
  }

  console.log(`Artifact : ${manifest.artifactName}`);
  console.log(`Status   : ${manifest.status}`);
  console.log(`Commit   : ${manifest.auditedCommit}`);
  console.log('');

  let anyFailed = false;

  // --- Thaw-note check (only when a base ref is known) --------------------

  const ciBase = process.env.GITHUB_BASE_REF;
  const effectiveBase =
    base ??
    (ciBase !== undefined && ciBase !== '' ? `origin/${ciBase}` : undefined);

  if (effectiveBase !== undefined) {
    console.log(`Changed-path check (base: ${effectiveBase})`);

    let changedFiles: string[];
    try {
      changedFiles = getChangedFiles(effectiveBase);
    } catch (cause) {
      console.error(
        `verify:dnd5e-srd-freeze: git diff failed: ${(cause as Error).message}`,
      );
      process.exit(2);
    }

    const thaw = checkThawPolicy(changedFiles);

    if (thaw.protectedPathsChanged.length === 0) {
      console.log('  no protected paths changed — check passed.');
    } else {
      console.log(
        `  protected paths changed (${thaw.protectedPathsChanged.length}):`,
      );
      for (const p of thaw.protectedPathsChanged) {
        console.log(`    ${p}`);
      }

      if (thaw.hasActiveThawNote) {
        console.log(
          `  active thaw note(s) found (${thaw.thawNotesAdded.length}):`,
        );
        for (const n of thaw.thawNotesAdded) {
          console.log(`    ${n}`);
        }
        console.log(
          '  changed-path check: PASSED (thaw note present; hash check still required)',
        );
      } else {
        console.log('');
        console.log('  changed-path check: FAILED');
        console.log('');
        console.log(
          '  The SRD 5.1 artifact is frozen. Intentional changes require a thaw note',
        );
        console.log('  committed in the same PR under:');
        console.log(
          '    docs/audits/dnd5e-srd-5.1-final/thaw-notes/<date>-<reason>.md',
        );
        console.log('');
        console.log('  See the template at:');
        console.log(
          '    docs/audits/dnd5e-srd-5.1-final/thaw-notes/TEMPLATE.md',
        );
        anyFailed = true;
      }
    }
    console.log('');
  }

  // --- Hash check (always runs) -------------------------------------------

  console.log(
    `Hash check (${manifest.files.length} files, algorithm: ${manifest.hashAlgorithm})`,
  );
  const hashResult = checkHashes(manifest, REPO_ROOT);

  if (hashResult.passed) {
    console.log(`  all ${manifest.files.length} hashes match — check passed.`);
  } else {
    console.log('');
    console.log('  D&D SRD 5.1 frozen artifact hash mismatch:');
    for (const f of hashResult.failures) {
      console.log(`    ${f.path}`);
      if (f.reason === 'missing') {
        console.log('      reason: file is missing');
      } else {
        console.log(`      expected: ${f.expected}`);
        console.log(`      actual:   ${f.actual}`);
      }
    }
    console.log('');
    console.log('  hash check: FAILED');
    console.log('');
    console.log(
      '  The SRD 5.1 artifact is frozen. If this change is intentional:',
    );
    console.log(
      '    1. Add a thaw note under docs/audits/dnd5e-srd-5.1-final/thaw-notes/',
    );
    console.log('    2. Update freeze-manifest.json with the new hashes.');
    console.log('    3. Update audit/provenance evidence consistently.');
    anyFailed = true;
  }

  process.exit(anyFailed ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(2);
});
