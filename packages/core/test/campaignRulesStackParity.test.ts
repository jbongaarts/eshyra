import { describe, expect, it } from 'vitest';
import {
  createDefaultToolRegistry,
  createSeededRng,
  getBundledDnd5eSrdPack,
  giveItem,
  writeCampaignRulesBinding,
} from '../src/internal.js';
import type { RulesPack, RulesRecord } from '../src/rules/types.js';
import {
  type CampaignRulesPackResolver,
  lookupCampaignRecord,
  lookupStrictCampaignRecord,
  resolveStrictCampaignRulesStack,
} from '../src/state/campaignRecordLookup.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-08-29T12:00:00.000Z';
const CREATURE_REF = 'creature:stack-warden';
const SPARK_REF = 'spell:stack-spark';
const EFFECT_REF = 'spell:stack-effect';
const RING_REF = 'magic-item:stack-ring';

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
  const spark = bundled.records.find(
    (record) => record.key === 'spell:fire-bolt',
  );
  const healingWord = bundled.records.find(
    (record) => record.key === 'spell:healing-word',
  );
  const effect = bundled.records.find(
    (record) => record.key === 'spell:mage-armor',
  );
  const ring = bundled.records.find(
    (record) => record.key === 'magic-item:ring-of-protection',
  );
  if (
    spark === undefined ||
    healingWord === undefined ||
    effect === undefined ||
    ring === undefined
  ) {
    throw new Error('missing rules-stack tool-boundary fixture');
  }
  const stackSpark = structuredClone(spark);
  stackSpark.key = SPARK_REF;
  stackSpark.name = 'Stack Spark';
  const stackEffect = structuredClone(effect);
  stackEffect.key = EFFECT_REF;
  stackEffect.name = 'Stack Effect';
  stackEffect.data = {
    ...(stackEffect.data as Record<string, unknown>),
    duration: '8 hours',
  };
  const stackRing = structuredClone(ring);
  stackRing.key = RING_REF;
  stackRing.name = 'Stack Ring';
  const base: RulesPack = {
    meta: {
      ...bundled.meta,
      packId: 'rules:test-stack-base',
      version: '1.0.0',
      role: 'base',
    },
    records: [
      {
        ...creatureRecord(source, 7, 12),
        data: {
          ...(creatureRecord(source, 7, 12).data as Record<string, unknown>),
          actions: [
            { name: 'Stack Burst', mechanics: { usage: { perDay: 1 } } },
          ],
        },
      },
      stackSpark,
      healingWord,
      stackEffect,
      stackRing,
    ],
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
        data: {
          ...(creatureRecord(source, 19, 18).data as Record<string, unknown>),
          actions: [
            { name: 'Stack Burst', mechanics: { usage: { perDay: 3 } } },
          ],
        },
        overrides: [`${first.meta.packId}/${CREATURE_REF}`],
      },
      {
        ...stackSpark,
        data: { ...(stackSpark.data as Record<string, unknown>), level: 1 },
        overrides: [`${base.meta.packId}/${SPARK_REF}`],
      },
      {
        ...stackEffect,
        data: {
          ...(stackEffect.data as Record<string, unknown>),
          duration: '1 minute',
        },
        overrides: [`${base.meta.packId}/${EFFECT_REF}`],
      },
      { ...stackRing, overrides: [`${base.meta.packId}/${RING_REF}`] },
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

    const registry = createDefaultToolRegistry();
    const context = {
      db,
      rng: createSeededRng(1),
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      sessionId: DEFAULT_TEST_SESSION_ID,
      turnId: 'stack-parity',
      at: NOW,
      resolveRulesPack: resolver,
    };
    const encounter = registry.invoke(
      'start_encounter',
      { actors: [{ actorId: 'stack-warden', rulesRef: CREATURE_REF }] },
      context,
    );
    expect(encounter).toMatchObject({
      ok: true,
      data: { combatants: [{ rulesRef: CREATURE_REF, hpMax: 19, ac: 18 }] },
    });
    const combatantId = 'ci-combat-1-stack-warden';
    expect(
      registry.invoke('begin_turn', { combatantId }, context),
    ).toMatchObject({ ok: true });
    expect(
      registry.invoke(
        'spend_turn_resource',
        {
          combatantId,
          resource: 'bonus_action',
          activity: 'cast Healing Word',
          spellRef: 'spell:healing-word',
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      registry.invoke(
        'spend_turn_resource',
        {
          combatantId,
          resource: 'action',
          activity: 'cast Stack Spark',
          spellRef: SPARK_REF,
        },
        context,
      ),
    ).toMatchObject({ ok: false, code: 'turn_budget_error' });
    expect(
      registry.invoke(
        'spend_usage',
        { combatantId, ability: 'Stack Burst' },
        context,
      ),
    ).toMatchObject({ ok: true, data: { counter: { usesMax: 3 } } });
    expect(
      registry.invoke(
        'start_effect',
        {
          effectId: 'stack-effect',
          kind: 'spell-effect',
          displayName: 'Stack Effect',
          source: { kind: 'spell', ref: EFFECT_REF },
          duration: {
            kind: 'timed',
            amount: 1,
            unit: 'minute',
            anchor: 'spell-cast',
          },
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      registry.invoke('refresh_effect', { effectId: 'stack-effect' }, context),
    ).toMatchObject({ ok: true });
    giveItem(
      db,
      { id: 'stack-ring', name: 'Stack Ring', packRef: RING_REF },
      { provenance: 'test', sessionId: DEFAULT_TEST_SESSION_ID, at: NOW },
    );
    const attuned = registry.invoke(
      'attune_item',
      { itemId: 'stack-ring', character: 'pc-1' },
      context,
    );
    if (!attuned.ok) throw new Error(attuned.message);
    db.close();
  });

  it('fails closed for unavailable and mismatched exact pack identities', () => {
    const db = freshDbWithSession();
    writeCampaignRulesBinding(db, {
      base: {
        systemId: 'dnd5e-srd',
        packId: 'rules:missing',
        version: '9.9.9',
      },
      addons: [],
      resolvedAt: NOW,
    });
    const context = {
      db,
      rng: createSeededRng(1),
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      sessionId: DEFAULT_TEST_SESSION_ID,
      turnId: 'missing-pack',
      at: NOW,
      resolveRulesPack: () => getBundledDnd5eSrdPack(),
    };
    expect(
      createDefaultToolRegistry().invoke(
        'lookup_rules',
        { kind: 'creature', ref: 'creature:goblin' },
        context,
      ),
    ).toMatchObject({ ok: false, code: 'rules_binding_error' });
    db.close();
  });
});
