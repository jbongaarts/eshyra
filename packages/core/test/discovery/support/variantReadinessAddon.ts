import type {
  CampaignRulesPackResolver,
  Db,
  RulesPack,
  RulesRecord,
} from '../../../src/internal.js';
import {
  canonicalMagicItemVariantId,
  getBundledDnd5eSrdPack,
  writeCampaignRulesBinding,
} from '../../../src/internal.js';

/**
 * A synthetic magic item whose readiness differs by variant.
 *
 * No record in the generated SRD pack has an operation whose readiness
 * outcome depends on the selected variant — verified by scanning every
 * magic-item record's operations against every declared variant — so a
 * variant control cannot be built from the corpus. This add-on supplies one,
 * following the same synthetic-override pattern P11 already uses via
 * `cursedAttunementAddon`. It exists to prove the discovery preflight gates
 * on the variant the capability route selected, exactly as `useItem` does; it
 * asserts nothing about the real SRD corpus.
 */
export const VARIANT_READINESS_PACK_ID = 'rules:test-variant-readiness-addon';
export const VARIANT_READINESS_VERSION = '1.0.0';
export const VARIANT_READINESS_ITEM_KEY = 'magic-item:test-variant-readiness';
export const VARIANT_READINESS_OPERATION = 'spend-one-use';
export const READY_VARIANT_ID = canonicalMagicItemVariantId('Ready Variant');
export const PENDING_VARIANT_ID =
  canonicalMagicItemVariantId('Pending Variant');

function variantClause(
  variantKey: string,
  readiness: 'green' | 'engine-pending',
): Record<string, unknown> {
  return {
    clauseId: `${VARIANT_READINESS_ITEM_KEY}/variant:${variantKey}/c1-uses`,
    scope: { kind: 'variant', variantKey },
    tag: 'C1',
    representation: { block: 'economies', economyId: 'uses' },
    readiness,
    ...(readiness === 'engine-pending'
      ? {
          engineHooks: [{ engine: 'F5', hook: 'magic-item-usage-recharge' }],
          missingHooks: [{ engine: 'F5', hook: 'magic-item-usage-recharge' }],
          missingEngines: ['F5'],
        }
      : {}),
  };
}

export function installVariantReadinessAddon(
  db: Db,
  at: string,
): CampaignRulesPackResolver {
  const base = getBundledDnd5eSrdPack();
  const template = base.records.find(
    (record) => record.key === 'magic-item:ammunition-1-2-or-3',
  );
  if (template === undefined)
    throw new Error('missing template magic-item record');

  const record: RulesRecord = {
    ...structuredClone(template),
    key: VARIANT_READINESS_ITEM_KEY,
    name: 'Test Variant Readiness Item',
  };
  (record as { data: unknown }).data = {
    description: 'Synthetic test item with variant-scoped readiness.',
    variants: [
      {
        id: READY_VARIANT_ID,
        name: 'Ready Variant',
        rarity: 'uncommon',
        text: 'The ready variant.',
      },
      {
        id: PENDING_VARIANT_ID,
        name: 'Pending Variant',
        rarity: 'rare',
        text: 'The engine-pending variant.',
      },
    ],
    mechanics: {
      economies: {
        uses: { kind: 'single-use', onDepleted: { loseProperty: true } },
      },
      operations: [
        {
          id: VARIANT_READINESS_OPERATION,
          cost: [{ economy: 'uses', amount: 1 }],
        },
      ],
    },
    executionReadiness: {
      source: 'derived-magic-item-clauses-v1',
      clauses: [
        variantClause(READY_VARIANT_ID, 'green'),
        variantClause(PENDING_VARIANT_ID, 'engine-pending'),
      ],
    },
  };

  const addon: RulesPack = {
    meta: {
      ...base.meta,
      packId: VARIANT_READINESS_PACK_ID,
      title: 'Test variant readiness add-on',
      description: 'Supplies a magic item whose readiness varies by variant.',
      role: 'addon',
      version: VARIANT_READINESS_VERSION,
      order: 1,
      compatibleBaseSystems: [
        { systemId: base.meta.systemId, versions: [base.meta.version] },
      ],
    },
    records: [record],
  };

  writeCampaignRulesBinding(db, {
    base: {
      systemId: base.meta.systemId,
      packId: base.meta.packId,
      version: base.meta.version,
    },
    addons: [
      {
        systemId: addon.meta.systemId,
        packId: addon.meta.packId,
        version: addon.meta.version,
      },
    ],
    resolvedAt: at,
  });

  return (binding) =>
    binding.packId === addon.meta.packId
      ? addon
      : binding.packId === base.meta.packId
        ? base
        : undefined;
}
