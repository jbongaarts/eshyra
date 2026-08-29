/**
 * A synthetic add-on pack that supplies a starting-wealth table.
 *
 * The bundled SRD 5.1 pack provides none: SRD 5.1 has no starting-wealth text,
 * so the table the importer used to emit was compiler-authored PHB content
 * wearing an SRD source line (ADR 0020 blocker B4, eshyra-o9bd.19.2.1.1). This
 * fixture exists to prove the starting-wealth *mechanism* was disabled by data
 * rather than deleted — a licensed supplement re-enables it.
 *
 * Every value here is invented. The formulas and multipliers deliberately do
 * NOT match the PHB table: reproducing those numbers in a test would leave the
 * unsupported content in the repo under a new name, which is precisely what the
 * bead forbids. The pack carries its own synthetic license, never the SRD's
 * CC-BY-4.0 attribution block.
 */

import type {
  RulesPack,
  RulesPackCharacterResolver,
  RulesPackLicense,
  RulesRecord,
} from '../../src/internal.js';
import {
  createRulesPackCharacterResolver,
  getBundledDnd5eSrdPack,
  resolveRulesStack,
} from '../../src/internal.js';

const SYNTHETIC_LICENSE: RulesPackLicense = {
  licenseClass: 'open',
  licenseName: 'Synthetic test license',
  attributionText: 'Test-only invented data. Not derived from any source.',
  requiresAttribution: false,
  commercialUseAllowed: true,
  hostedUseAllowed: true,
  redistributionAllowed: true,
  publicSharingAllowed: true,
  derivativeAllowed: true,
  containsUserSuppliedText: false,
  containsTrademarkedSettingMaterial: false,
  sourceMaterialDescription: 'Invented test values; no external rules text.',
  provenancePolicy:
    'Every record names the synthetic fixture that authored it.',
  outputRestrictions: 'Test fixture; not for redistribution as game content.',
};

/**
 * Invented rows. `Monk` intentionally has no multiplier so the bare-`NdN` form
 * stays covered, and no row repeats a PHB formula/multiplier pair.
 */
const SYNTHETIC_ROWS: readonly (readonly [string, string])[] = [
  ['Barbarian', '1d3 × 7 gp'],
  ['Bard', '1d3 × 7 gp'],
  ['Cleric', '1d3 × 7 gp'],
  ['Druid', '1d3 × 7 gp'],
  ['Fighter', '2d2 × 3 gp'],
  ['Monk', '1d3 gp'],
  ['Paladin', '1d3 × 7 gp'],
  ['Ranger', '1d3 × 7 gp'],
  ['Rogue', '1d3 × 7 gp'],
  ['Sorcerer', '1d3 × 7 gp'],
  ['Warlock', '1d3 × 7 gp'],
  ['Wizard', '2d2 × 3 gp'],
];

const TABLE: RulesRecord = {
  systemId: 'dnd5e-srd',
  kind: 'table',
  key: 'table:starting-wealth-by-class',
  name: 'Starting Wealth by Class',
  data: {
    columns: ['Class', 'Starting Wealth'],
    rows: SYNTHETIC_ROWS.map((row) => [...row]),
  },
  source: 'Synthetic test supplement',
  license: SYNTHETIC_LICENSE,
  provenance: {
    sourceRef: 'synthetic:starting-wealth-supplement',
    note: 'Invented test values; not extracted from any published source.',
  },
};

export const SYNTHETIC_STARTING_WEALTH_PACK: RulesPack = {
  meta: {
    packId: 'rules:test-starting-wealth-supplement',
    title: 'Synthetic starting-wealth supplement',
    description:
      'Test-only add-on supplying an invented starting-wealth table so the ' +
      'creation path can be exercised without SRD-unsupported content.',
    role: 'addon',
    systemId: 'dnd5e-srd',
    version: '1.0.0',
    order: 1,
    compatibleBaseSystems: [{ systemId: 'dnd5e-srd', versions: ['5.1'] }],
    license: SYNTHETIC_LICENSE,
    source: {
      sourceTitle: 'Synthetic test supplement',
      sourceVersion: '1.0.0',
      sourceIdentity: 'synthetic:starting-wealth-supplement',
      recordProvenancePolicy:
        'Every record names the synthetic fixture that authored it.',
    },
  },
  records: [TABLE],
};

/** A resolver over the bundled SRD pack plus the synthetic supplement. */
export function getSyntheticStartingWealthResolver(): RulesPackCharacterResolver {
  return createRulesPackCharacterResolver(
    resolveRulesStack({
      base: getBundledDnd5eSrdPack(),
      addons: [SYNTHETIC_STARTING_WEALTH_PACK],
    }),
  );
}
