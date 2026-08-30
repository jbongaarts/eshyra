import { describe, expect, it } from 'vitest';
import {
  getBundledDnd5eSrdPack,
  writeCampaignRulesBinding,
} from '../src/internal.js';
import type { RulesPack, RulesRecord } from '../src/rules/types.js';
import {
  type CampaignRulesPackResolver,
  lookupCampaignRecord,
  lookupStrictCampaignRecord,
  resolveStrictCampaignRulesStack,
} from '../src/state/campaignRecordLookup.js';
import { startEncounter } from '../src/state/encounterCombatants.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-08-29T12:00:00.000Z';
const CREATURE_REF = 'creature:stack-warden';

function creatureRecord(
  source: RulesRecord,
  hitPoints: number,
  armorClass: number,
): RulesRecord {
  const record = structuredClone(source);
  record.key = CREATURE_REF;
  record.name = 'Stack Warden';
  record.data = {
    ...(record.data as Record<string, unknown>),
    hitPoints,
    armorClass,
  };
  return record;
}

function syntheticStack(): {
  readonly base: RulesPack;
  readonly addons: readonly RulesPack[];
  readonly resolver: CampaignRulesPackResolver;
} {
  const bundled = getBundledDnd5eSrdPack();
  const source = bundled.records.find(
    (record) => record.key === 'creature:goblin',
  );
  if (source === undefined) throw new Error('missing goblin fixture');
  const base: RulesPack = {
    meta: {
      ...bundled.meta,
      packId: 'rules:test-stack-base',
      version: '1.0.0',
      role: 'base',
    },
    records: [creatureRecord(source, 7, 12)],
  };
  const first: RulesPack = {
    meta: {
      ...base.meta,
      packId: 'rules:test-stack-addon-one',
      version: '1.0.0',
      role: 'addon',
      order: 1,
      compatibleBaseSystems: [
        { systemId: base.meta.systemId, versions: [base.meta.version] },
      ],
    },
    records: [
      {
        ...creatureRecord(source, 13, 14),
        overrides: [`${base.meta.packId}/${CREATURE_REF}`],
      },
    ],
  };
  const second: RulesPack = {
    meta: {
      ...first.meta,
      packId: 'rules:test-stack-addon-two',
      version: '1.0.0',
      order: 2,
      dependsOn: [first.meta.packId],
    },
    records: [
      {
        ...creatureRecord(source, 19, 18),
        overrides: [`${first.meta.packId}/${CREATURE_REF}`],
      },
    ],
  };
  const packs = [base, first, second];
  return {
    base,
    addons: [first, second],
    resolver: (binding) =>
      packs.find(
        (pack) =>
          pack.meta.systemId === binding.systemId &&
          pack.meta.packId === binding.packId &&
          pack.meta.version === binding.version,
      ),
  };
}

describe('campaign rules stack parity', () => {
  it('uses the exact ordered add-on chain for strict lookup and encounter projection', () => {
    const db = freshDbWithSession();
    const { base, addons, resolver } = syntheticStack();
    writeCampaignRulesBinding(db, {
      base: {
        systemId: base.meta.systemId,
        packId: base.meta.packId,
        version: base.meta.version,
      },
      addons: addons.map((addon) => ({
        systemId: addon.meta.systemId,
        packId: addon.meta.packId,
        version: addon.meta.version,
      })),
      resolvedAt: NOW,
    });

    const stack = resolveStrictCampaignRulesStack(db, resolver);
    const strict = lookupStrictCampaignRecord(
      db,
      'creature',
      CREATURE_REF,
      resolver,
    );
    expect(strict?.record.data).toMatchObject({
      hitPoints: 19,
      armorClass: 18,
    });
    expect(strict?.pack).toMatchObject({
      systemId: addons[1]?.meta.systemId,
      packId: addons[1]?.meta.packId,
      version: addons[1]?.meta.version,
    });
    expect(strict?.overrideChain.map(({ pack }) => pack.meta.packId)).toEqual([
      base.meta.packId,
      addons[0]?.meta.packId,
    ]);
    expect(strict?.stack.packs.map((pack) => pack.meta.packId)).toEqual([
      base.meta.packId,
      ...addons.map((addon) => addon.meta.packId),
    ]);
    expect(stack.packs).toEqual(strict?.stack.packs);
    expect(lookupCampaignRecord(db, 'creature', CREATURE_REF, resolver)).toBe(
      strict?.record,
    );

    const encounter = startEncounter(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      actors: [{ actorId: 'stack-warden', rulesRef: CREATURE_REF }],
      resolveRulesPack: resolver,
      provenance: 'test',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: NOW,
    });
    expect(encounter.combatants).toMatchObject([
      { rulesRef: CREATURE_REF, hpCurrent: 19, hpMax: 19, ac: 18 },
    ]);
    db.close();
  });
});
