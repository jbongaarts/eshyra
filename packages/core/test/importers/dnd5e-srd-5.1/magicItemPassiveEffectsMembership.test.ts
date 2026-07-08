/**
 * Independent clause-level membership/coverage gate (eshyra-o9bd.18.7.7.5
 * PR #415 re-review): the earlier `magicItemPassiveEffectsCoverage.test.ts`
 * fixture was extracted FROM this module's own output, so it locks in
 * regressions but cannot prove the output is complete relative to the
 * source inventory. This file closes that gap with a baseline transcribed
 * ONCE, mechanically, from
 * `docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-7-3-magic-item-mechanics-inventory.md`
 * §2's master table — independent of `magicItemPassiveEffects.ts` — mirroring the
 * "reviewed clause registry, transcribed once, mechanically" pattern from the
 * PR #408 state-contract design (§5). CI never re-parses the inventory prose;
 * a change to the artifact or to importer behavior requires updating this
 * pinned baseline as a reviewed diff.
 *
 * `MAGIC_ITEM_M2_M3_CLAUSE_COUNTS` maps each of the 58 uniquely M2/M3-tagged
 * item keys to the number of individually-tagged M2/M3 clause fragments its
 * inventory row carries (owner-boundary count, not sub-fact count — e.g. a
 * single-owner row's semicolon-separated sub-facts count as one clause when
 * the row carries only one trailing tag for the whole disposition). This is a
 * lower bound: `deriveMagicItemMechanics(...).effects.length` must be at least
 * this many, catching a total omission or an under-modeled multi-clause row,
 * though it cannot by itself prove every individual condition was preserved
 * (see the coverage test's exact per-item fixtures for that).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deriveMagicItemMechanics,
  MAGIC_ITEM_M2_M3_DEFERRED,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemPassiveEffects.js';
import type { RulesRecord } from '../../../src/rules/types.js';

const PACK_DIR = join(
  process.cwd(),
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1',
);

function loadMagicItems(): readonly RulesRecord[] {
  const records = JSON.parse(
    readFileSync(join(PACK_DIR, 'records.json'), 'utf8'),
  ) as RulesRecord[];
  return records.filter((r) => r.kind === 'magic-item');
}

// Transcribed once from the mechanics inventory's master table (§2), keyed
// by the item's pack key suffix (after `magic-item:`). Deferred items (Ioun
// Stone, Ring of Elemental Command, Crystal Ball) are included for the exact
// membership check but excluded from the clause-count assertion below.
const MAGIC_ITEM_M2_M3_CLAUSE_COUNTS: Readonly<Record<string, number>> = {
  'amulet-of-health': 1,
  'belt-of-dwarvenkind': 2,
  'belt-of-giant-strength': 1,
  'berserker-axe': 1,
  'boots-of-speed': 1,
  'boots-of-striding-and-springing': 1,
  'boots-of-the-winterlands': 1,
  'bracers-of-archery': 1,
  'broom-of-flying': 1,
  'carpet-of-flying': 1,
  'cloak-of-arachnida': 1,
  'cloak-of-the-bat': 1,
  'cloak-of-the-manta-ray': 1,
  'crystal-ball': 1,
  'demon-armor': 1,
  'dragon-scale-mail': 1,
  'elven-chain': 1,
  'gauntlets-of-ogre-power': 1,
  'gem-of-seeing': 1,
  'gloves-of-swimming-and-climbing': 1,
  'goggles-of-night': 1,
  'hammer-of-thunderbolts': 1,
  'headband-of-intellect': 1,
  'helm-of-telepathy': 1,
  'horseshoes-of-a-zephyr': 1,
  'horseshoes-of-speed': 1,
  'ioun-stone': 3,
  'lantern-of-revealing': 1,
  'manual-of-bodily-health': 1,
  'manual-of-gainful-exercise': 1,
  'manual-of-quickness-of-action': 1,
  'necklace-of-adaptation': 1,
  'periapt-of-wound-closure': 1,
  'potion-of-climbing': 1,
  'potion-of-flying': 1,
  'potion-of-giant-strength': 1,
  'potion-of-water-breathing': 1,
  'ring-of-elemental-command': 2,
  'ring-of-feather-falling': 1,
  'ring-of-free-action': 1,
  'ring-of-regeneration': 1,
  'ring-of-swimming': 1,
  'ring-of-warmth': 1,
  'ring-of-water-walking': 1,
  'ring-of-x-ray-vision': 1,
  'robe-of-eyes': 1,
  'robe-of-the-archmagi': 1,
  'rod-of-alertness': 1,
  'rod-of-lordly-might': 1,
  'slippers-of-spider-climbing': 1,
  'sun-blade': 1,
  'tome-of-clear-thought': 1,
  'tome-of-leadership-and-influence': 1,
  'tome-of-understanding': 1,
  'wand-of-enemy-detection': 1,
  'wand-of-secrets': 1,
  'winged-boots': 1,
  'wings-of-flying': 1,
};

const DEFERRED_ITEM_KEYS: ReadonlySet<string> = new Set([
  'crystal-ball',
  'ioun-stone',
  'ring-of-elemental-command',
]);

describe('magic-item M2/M3 membership and clause-count gate (eshyra-o9bd.18.7.7.5)', () => {
  const magicItems = loadMagicItems();
  const nameByKey = new Map(
    magicItems.map((r) => [r.key.replace(/^magic-item:/, ''), r.name]),
  );

  it('the pinned baseline covers exactly 58 item keys, all present in the committed pack', () => {
    const keys = Object.keys(MAGIC_ITEM_M2_M3_CLAUSE_COUNTS);
    expect(new Set(keys).size).toBe(58);
    for (const key of keys) {
      expect(nameByKey.has(key), `unknown magic-item key ${key}`).toBe(true);
    }
  });

  it('the deferred set is exactly the 3 pinned keys, all inside the baseline', () => {
    expect(DEFERRED_ITEM_KEYS.size).toBe(3);
    for (const key of DEFERRED_ITEM_KEYS) {
      expect(key in MAGIC_ITEM_M2_M3_CLAUSE_COUNTS).toBe(true);
      const name = nameByKey.get(key);
      expect(name, `unknown magic-item key ${key}`).toBeDefined();
      expect(
        MAGIC_ITEM_M2_M3_DEFERRED.has(name as string),
        `${name} must be registered in MAGIC_ITEM_M2_M3_DEFERRED`,
      ).toBe(true);
    }
    expect(MAGIC_ITEM_M2_M3_DEFERRED.size).toBe(DEFERRED_ITEM_KEYS.size);
  });

  it('every non-deferred item in the baseline is modeled with at least the pinned clause count', () => {
    const shortfalls: string[] = [];
    for (const [key, expectedClauses] of Object.entries(
      MAGIC_ITEM_M2_M3_CLAUSE_COUNTS,
    )) {
      if (DEFERRED_ITEM_KEYS.has(key)) continue;
      const record = magicItems.find((r) => r.key === `magic-item:${key}`);
      expect(
        record,
        `missing magic-item:${key} in the committed pack`,
      ).toBeDefined();
      const mechanics = deriveMagicItemMechanics({
        name: (record as RulesRecord).name,
        itemType: '',
        rarity: '',
        requiresAttunement: false,
        description: ((record as RulesRecord).data as { description: string })
          .description,
        sourcePage: 1,
      });
      const actual =
        mechanics === undefined ? 0 : (mechanics.effects as unknown[]).length;
      if (actual < expectedClauses) {
        shortfalls.push(
          `${key}: expected >= ${expectedClauses} clause(s), got ${actual}`,
        );
      }
    }
    expect(shortfalls).toEqual([]);
  });
});
