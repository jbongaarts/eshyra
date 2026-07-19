import type {
  CampaignRulesPackResolver,
  Db,
  RulesPack,
} from '../../src/internal.js';
import {
  getBundledDnd5eSrdPack,
  writeCampaignRulesBinding,
} from '../../src/internal.js';

const OVERRIDDEN_ITEM_REF = 'magic-item:ring-of-protection';

/** Install an effective-stack override that adds a curse to an uncursed item. */
export function installCursedAttunementAddon(
  db: Db,
  at: string,
): CampaignRulesPackResolver {
  const base = getBundledDnd5eSrdPack();
  const baseRecord = base.records.find(
    (record) => record.key === OVERRIDDEN_ITEM_REF,
  );
  if (baseRecord === undefined) {
    throw new Error(`missing fixture record '${OVERRIDDEN_ITEM_REF}'`);
  }
  const override = structuredClone(baseRecord);
  const data = override.data as Record<string, unknown>;
  data.mechanics = {
    ...((data.mechanics as Record<string, unknown> | undefined) ?? {}),
    curse: {
      blocksUnattune: true,
      attunement: { attachesStates: ['test-addon-curse'] },
      stateDefinitions: [
        {
          id: 'test-addon-curse',
          onset: 'attune to the overridden ring',
          note: 'test-only persistent character curse',
        },
      ],
      note: 'test-only add-on curse',
    },
  };
  override.overrides = [`${base.meta.packId}/${OVERRIDDEN_ITEM_REF}`];

  const addon: RulesPack = {
    meta: {
      ...base.meta,
      packId: 'rules:test-cursed-attunement-addon',
      title: 'Test cursed attunement add-on',
      description: 'Overrides an uncursed base item with a curse contract.',
      role: 'addon',
      version: '1.0.0',
      order: 1,
      compatibleBaseSystems: [
        { systemId: base.meta.systemId, versions: [base.meta.version] },
      ],
    },
    records: [override],
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
  return (ref) =>
    ref.packId === addon.meta.packId && ref.version === addon.meta.version
      ? addon
      : undefined;
}
