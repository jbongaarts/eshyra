/**
 * Candidate generator for the SRD 5.1 exact creature name-set baseline
 * (`EXPECTED_SRD_5_1_CREATURE_NAMES` in the importer's `index.ts`,
 * loreweaver-0m9.5.14).
 *
 * This command does NOT define the expected data and it is NOT run at test
 * time. It only proposes a *candidate* list by running the 0m9.5 importer
 * against the vendored SRD 5.1 PDF and printing the creature names it extracted.
 * A human then reviews that candidate against the SRD source (the actual
 * Monsters chapter + Appendix MM-A), and only the reviewed list is committed as
 * `EXPECTED_SRD_5_1_CREATURE_NAMES`. Once committed, that constant is a fixed,
 * checked-in regression baseline — its job is to make future parser changes
 * that silently drop, add, or rename a creature fail closed, not to re-derive
 * "expected" data from the same parser output on every run.
 *
 * Deliberately runs the importer WITHOUT `expectedCreatureNames`: the exact gate
 * is the answer this command helps a human produce, so it cannot be an input.
 * The always-on empty-result guard still applies.
 *
 * Usage:
 *
 *   npm run generate:dnd5e-srd-creature-names
 *
 * Output: the source PDF SHA-256, the candidate creature count, and a
 * ready-to-review TypeScript array literal to paste into
 * `packages/core/scripts/importers/dnd5e-srd-5.1/index.ts` after the reviewer
 * has checked it against the SRD source. Exit 0 on success, 1 on importer or
 * pack-load failure.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRulesPackFromDirectory } from '../../src/internal.js';
import { runImporter } from '../importers/dnd5e-srd-5.1/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const VENDORED_PDF = resolve(
  REPO_ROOT,
  'packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf',
);

/**
 * Returns the process exit code rather than calling `process.exit()`
 * directly, so the surrounding `finally { rmSync(tmpDir, ...) }` actually
 * runs: `process.exit()` terminates in place without unwinding the call
 * stack, so every in-`try` `process.exit()` call here used to skip its own
 * cleanup, on every invocation including the success path (eshyra-knh9 — the
 * same root cause fixed in verify-dnd5e-srd-pack/cli.ts).
 */
async function main(): Promise<number> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gen-dnd5e-srd-creature-names-'));
  try {
    console.log(`Vendored PDF: ${VENDORED_PDF}`);
    console.log(`Candidate pack (tmp): ${tmpDir}`);
    console.log('');

    let result: Awaited<ReturnType<typeof runImporter>>;
    try {
      // No expectedCreatureNames: this command generates the candidate that the
      // exact-name gate is later seeded with, so the gate cannot be an input.
      result = await runImporter({ pdfPath: VENDORED_PDF, outDir: tmpDir });
    } catch (cause) {
      console.error(`importer failed: ${(cause as Error).message}`);
      return 1;
    }

    let pack: ReturnType<typeof loadRulesPackFromDirectory>;
    try {
      pack = loadRulesPackFromDirectory(tmpDir);
    } catch (cause) {
      console.error(
        `failed to load candidate pack: ${(cause as Error).message}`,
      );
      return 1;
    }

    const names = pack.records
      .filter((record) => record.kind === 'creature')
      .map((record) => record.name)
      .sort((a, b) => a.localeCompare(b));

    console.log(`Source PDF SHA-256: ${result.sourceHash}`);
    console.log(`Candidate creature count: ${names.length}`);
    console.log('');
    console.log(
      '// Review against the SRD source before committing as EXPECTED_SRD_5_1_CREATURE_NAMES:',
    );
    console.log(
      'export const EXPECTED_SRD_5_1_CREATURE_NAMES: readonly string[] = [',
    );
    for (const name of names) {
      console.log(`  ${JSON.stringify(name)},`);
    }
    console.log('];');
    return 0;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
