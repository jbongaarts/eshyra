/**
 * Manual verification command for the committed D&D 5e SRD 5.1 rules pack.
 *
 * Runs the 0m9.5 importer against the vendored SRD 5.1 PDF into a temp
 * directory, then diffs the regenerated pack against the committed canonical
 * pack at `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`. The run
 * passes `SRD_5_1_COVERAGE_RULES`, so the source-structure coverage gate
 * (eshyra-4a7.1) is enforced — an unaccounted source structure makes the
 * importer throw (exit 2) — and the regenerated `source-inventory.json` +
 * `source-coverage.json` artifacts are byte-diffed against the committed
 * copies under the same exact-match contract as `records.json` (exit 1 on
 * drift).
 *
 * Per the 0m9.6 design, the importer is treated as a one-shot construction
 * tool, not as a generator that runs on every PR. This command is the
 * operator-facing way to answer "does the committed pack still match what the
 * importer would produce today?" — invoked when importer/parser/source/schema
 * code changes, or as part of the canonical-regen PR.
 *
 * Usage:
 *
 *   npm run verify:dnd5e-srd-pack
 *
 * Exit codes:
 *   0  importer output equals the committed pack (no diff).
 *   1  importer ran and loaded but produced a diff against the committed pack.
 *   2  verification could not produce a meaningful diff — e.g. importer
 *      failure, pack-loading/validation failure, missing PDF.
 *
 * Steady state (loreweaver-1pw): the committed pack is the canonical importer
 * output from the vendored SRD 5.1 PDF, so this command exits 0. A nonzero exit
 * means drift — importer/parser code, the vendored PDF, the rules
 * schemas/audit code, or the lockfile changed the importer's output without a
 * matching regeneration of the committed pack (exit 1), or the importer/pack
 * load failed outright (exit 2). The path-gated
 * `.github/workflows/srd-importer-reproducibility.yml` runs this command and
 * fails the PR check on any nonzero exit. To intentionally change pack content,
 * regenerate the committed pack, review the diff, update the srdGeneratedPack
 * baselines, and commit the regenerated pack in the same PR.
 *
 * The script also prints the source PDF SHA-256 and the per-kind counts so an
 * intentional regeneration PR can paste them into the PR description (see
 * `packages/core/scripts/importers/dnd5e-srd-5.1/README.md`).
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  diffHasChanges,
  diffPacks,
  formatDiffReport,
  loadRulesPackFromDirectory,
  RulesPackError,
} from '../../src/internal.js';
import {
  EXPECTED_SRD_5_1_BACKGROUND_NAMES,
  EXPECTED_SRD_5_1_CREATURE_NAMES,
  EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES,
  EXPECTED_SRD_5_1_NPC_NAMES,
  EXPECTED_SRD_5_1_RULE_KEYS,
  EXPECTED_SRD_5_1_STAT_BLOCK_NAMES,
  EXPECTED_SRD_5_1_TABLE_NAMES,
  EXPECTED_SRD_5_1_TRAP_NAMES,
  MIN_EXPECTED_SRD_5_1_CLASSES,
  MIN_EXPECTED_SRD_5_1_FEATURES,
  MIN_EXPECTED_SRD_5_1_MAGIC_ITEMS,
  MIN_EXPECTED_SRD_5_1_SUBCLASSES,
  runImporter,
  SRD_5_1_STAT_BLOCK_CONTAINING_ITEMS,
} from '../importers/dnd5e-srd-5.1/index.js';
import { SRD_5_1_COVERAGE_RULES } from '../importers/dnd5e-srd-5.1/sourceInventoryCoverage.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const VENDORED_PDF = resolve(
  REPO_ROOT,
  'packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf',
);
const COMMITTED_PACK_DIR = resolve(
  REPO_ROOT,
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1',
);

async function main(): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'verify-dnd5e-srd-pack-'));
  try {
    console.log(`Vendored PDF: ${VENDORED_PDF}`);
    console.log(`Committed pack: ${COMMITTED_PACK_DIR}`);
    console.log(`Regenerated pack (tmp): ${tmpDir}`);
    console.log('');

    let result: Awaited<ReturnType<typeof runImporter>>;
    try {
      result = await runImporter({
        pdfPath: VENDORED_PDF,
        outDir: tmpDir,
        expectedCreatureNames: EXPECTED_SRD_5_1_CREATURE_NAMES,
        expectedNpcNames: EXPECTED_SRD_5_1_NPC_NAMES,
        expectedTrapNames: EXPECTED_SRD_5_1_TRAP_NAMES,
        expectedMagicItemNames: EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES,
        expectedStatBlockNames: EXPECTED_SRD_5_1_STAT_BLOCK_NAMES,
        statBlockContainingItems: SRD_5_1_STAT_BLOCK_CONTAINING_ITEMS,
        expectedRuleKeys: EXPECTED_SRD_5_1_RULE_KEYS,
        expectedTableNames: EXPECTED_SRD_5_1_TABLE_NAMES,
        expectedBackgroundNames: EXPECTED_SRD_5_1_BACKGROUND_NAMES,
        minClassCount: MIN_EXPECTED_SRD_5_1_CLASSES,
        minSubclassCount: MIN_EXPECTED_SRD_5_1_SUBCLASSES,
        minFeatureCount: MIN_EXPECTED_SRD_5_1_FEATURES,
        minMagicItemCount: MIN_EXPECTED_SRD_5_1_MAGIC_ITEMS,
        sourceCoverageRules: SRD_5_1_COVERAGE_RULES,
      });
    } catch (cause) {
      console.error(`importer failed: ${(cause as Error).message}`);
      process.exit(2);
    }

    const c = result.counts;
    console.log(`Source PDF SHA-256: ${result.sourceHash}`);
    console.log(
      `Importer counts: ${c.spells} spells, ${c.creatures} creatures, ${c.npcs} NPCs, ${c.classes} classes, ${c.subclasses} subclasses, ${c.features} features, ${c.conditions} conditions, ${c.feats} feats, ${c.hazards} hazards, ${c.traps} traps, ${c.actions} actions, ${c.rules} rules, ${c.tables} tables, ${c.equipment} equipment, ${c.magicItems} magic items, ${c.ancestries} ancestries, ${c.backgrounds} backgrounds`,
    );
    console.log('');

    let committed: ReturnType<typeof loadRulesPackFromDirectory>;
    let regenerated: ReturnType<typeof loadRulesPackFromDirectory>;
    try {
      committed = loadRulesPackFromDirectory(COMMITTED_PACK_DIR);
      regenerated = loadRulesPackFromDirectory(tmpDir);
    } catch (cause) {
      if (cause instanceof RulesPackError) {
        console.error(`pack failed validation: ${cause.message}`);
      } else {
        console.error(`failed to load pack: ${(cause as Error).message}`);
      }
      process.exit(2);
    }

    const diff = diffPacks(committed, regenerated);
    process.stdout.write(formatDiffReport(diff));

    if (diffHasChanges(diff)) {
      console.log('');
      console.log(
        'verify:dnd5e-srd-pack: committed pack differs from importer output.',
      );
      process.exit(1);
    }

    // Source-coverage artifacts (eshyra-4a7.1): the regenerated
    // source-inventory.json + source-coverage.json + source-region-ledger.json
    // must match the committed copies byte-for-byte — the same exact-match
    // contract records.json has.
    // Drift means an importer/extractor/rule change altered the source
    // accounting without a matching artifact regeneration.
    let artifactsDrifted = false;
    for (const artifact of [
      'source-inventory.json',
      'source-coverage.json',
      'source-region-ledger.json',
    ]) {
      let committedText: string;
      try {
        committedText = readFileSync(
          join(COMMITTED_PACK_DIR, artifact),
          'utf8',
        );
      } catch (cause) {
        console.error(
          `committed ${artifact} could not be read: ${(cause as Error).message}`,
        );
        process.exit(2);
      }
      const regeneratedText = readFileSync(join(tmpDir, artifact), 'utf8');
      if (committedText === regeneratedText) {
        console.log(`${artifact}: matches regenerated output exactly.`);
      } else {
        console.log(
          `${artifact}: DIFFERS from regenerated output. Regenerate the canonical pack (npm run import:dnd5e-srd -- --out ${COMMITTED_PACK_DIR}), review the artifact diff, and commit it alongside the change that caused it.`,
        );
        artifactsDrifted = true;
      }
    }
    if (artifactsDrifted) {
      console.log('');
      console.log(
        'verify:dnd5e-srd-pack: committed source-coverage artifacts differ from importer output.',
      );
      process.exit(1);
    }

    console.log('');
    console.log(
      'verify:dnd5e-srd-pack: committed pack matches importer output exactly.',
    );
    process.exit(0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
