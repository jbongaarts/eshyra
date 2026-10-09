// Flexible Casting (eshyra-09co.1): sorcery points <-> spell slots against
// the real bundled pack's curated Font of Magic procedure.

import { describe, expect, it } from 'vitest';
import type {
  CampaignRulesPackResolver,
  CharacterSheet,
  RulesPack,
} from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  createSqliteCharacterSheetStore,
  FlexibleCastingError,
  flexibleCasting,
  getBundledDnd5eSrdPack,
  mutateState,
  readSpellSlots,
  restoreSpellSlots,
  restoreUsage,
  spendSpellSlot,
  spendUsage,
  writeCampaignRulesBinding,
} from '../src/internal.js';
import { bareDb, DEFAULT_TEST_SESSION_ID } from './support/db.js';

const AT = '2026-07-11T12:00:00.000Z';
const CTX = {
  provenance: 'test:flexible-casting',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: AT,
};
const CAMPAIGN = 'campaign-1';

function sheet(classKey: string, name: string, level: number): CharacterSheet {
  const score = { base: 10, final: 10, modifier: 0 } as const;
  const save = { modifier: 0, proficient: false } as const;
  return {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    rulesPackId: 'rules:dnd5e-srd-5.1',
    recipeId: 'dnd5e-srd-character',
    creationMode: 'test',
    level,
    identity: { name: 'Flex Tester' },
    class: { key: classKey, name },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores: {
      strength: score,
      dexterity: score,
      constitution: score,
      intelligence: score,
      wisdom: score,
      charisma: score,
    },
    proficiencyBonus: 2,
    maxHitPoints: 8,
    savingThrows: {
      strength: save,
      dexterity: save,
      constitution: save,
      intelligence: save,
      wisdom: save,
      charisma: save,
    },
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: [],
    spells: [],
    metadata: { createdAt: AT },
  } as CharacterSheet;
}

function setup(classKey: string, name: string, level: number) {
  const db = bareDb();
  createSqliteCharacterSheetStore(db).save(
    'pc-1',
    sheet(classKey, name, level),
  );
  mutateState(db, {
    target: 'character',
    field: 'level',
    op: 'set',
    value: level,
    ...CTX,
  });
  db.prepare('UPDATE character SET name = ? WHERE id = ?').run(
    'Flex Tester',
    'pc-1',
  );
  return db;
}

const sorcerer3 = () => setup('class:sorcerer', 'Sorcerer', 3);
const flex = (
  db: ReturnType<typeof bareDb>,
  operation: 'create-slot' | 'convert-slot',
  slotLevel: number,
) =>
  flexibleCasting(db, { campaignId: CAMPAIGN, operation, slotLevel, ...CTX });

describe('Flexible Casting', () => {
  it('creates a slot for its pack cost, refuses an unaffordable repeat, and spends created slots first', () => {
    const db = sorcerer3();
    const created = flex(db, 'create-slot', 1);
    expect(created).toMatchObject({
      pointDelta: -2,
      sorceryPoints: { remaining: 1, max: 3 },
      slot: { spellLevel: 1, created: true, slotsMax: 1, slotsUsed: 0 },
      actionCost: 'bonus-action',
      createdSlotExpires: 'long-rest',
    });
    expect(() => flex(db, 'create-slot', 1)).toThrow(/requires 2 points/);
    expect(() => flex(db, 'create-slot', 6)).toThrow(FlexibleCastingError);

    const listed = readSpellSlots(db);
    expect(listed.filter((slot) => slot.created)).toHaveLength(1);
    expect(
      listed.filter((slot) => !slot.created && slot.spellLevel === 1),
    ).toHaveLength(1);

    const cast = spendSpellSlot(db, { spellLevel: 1, ...CTX });
    expect(cast.counter).toMatchObject({ created: true, slotsUsed: 1 });
    const next = spendSpellSlot(db, { spellLevel: 1, ...CTX });
    expect(next.counter.created).toBeUndefined();
    db.close();
  });

  it('removes created slots at a long rest but not a short rest', () => {
    const db = sorcerer3();
    flex(db, 'create-slot', 1);
    restoreSpellSlots(db, { event: 'short_rest', ...CTX });
    expect(readSpellSlots(db).some((slot) => slot.created)).toBe(true);
    const rest = restoreSpellSlots(db, { event: 'long_rest', ...CTX });
    expect(rest.expiredCreated).toHaveLength(1);
    expect(readSpellSlots(db).some((slot) => slot.created)).toBe(false);
    db.close();
  });

  it('refuses converting past the point maximum, then restores points once room exists', () => {
    const db = sorcerer3();
    expect(() => flex(db, 'convert-slot', 2)).toThrow(
      /exceeds the resource maximum/,
    );
    // Nothing was expended by the refused conversion.
    expect(
      readSpellSlots(db).find((slot) => slot.spellLevel === 2)?.slotsUsed ?? 0,
    ).toBe(0);
    spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: { kind: 'character' },
      ability: 'sorcery-points',
      uses: 2,
      ...CTX,
    });
    const converted = flex(db, 'convert-slot', 2);
    expect(converted).toMatchObject({
      pointDelta: 2,
      sorceryPoints: { remaining: 3, max: 3 },
      slot: { spellLevel: 2, slotsUsed: 1 },
    });
    db.close();
  });

  it('refuses non-sorcerers and level 1 sorcerers', () => {
    const wizard = setup('class:wizard', 'Wizard', 5);
    expect(() => flex(wizard, 'create-slot', 1)).toThrow(/not a sorcerer/);
    wizard.close();
    const novice = setup('class:sorcerer', 'Sorcerer', 1);
    expect(() => flex(novice, 'create-slot', 1)).toThrow(/level 2/);
    novice.close();
  });

  it('runs through the flexible_casting tool by character name', () => {
    const db = sorcerer3();
    const context = {
      db,
      rng: createSeededRng(1),
      campaignId: CAMPAIGN,
      sessionId: DEFAULT_TEST_SESSION_ID,
      turnId: 'turn-1',
      at: AT,
    };
    const registry = createDefaultToolRegistry();
    const result = registry.invoke(
      'flexible_casting',
      { operation: 'create-slot', slotLevel: 1, character: 'Flex Tester' },
      context,
    );
    expect(result).toMatchObject({
      ok: true,
      data: { pointDelta: -2, slot: { created: true } },
    });
    expect(
      registry.invoke(
        'flexible_casting',
        { operation: 'create-slot', slotLevel: 6 },
        context,
      ),
    ).toMatchObject({ ok: false, code: 'flexible_casting_error' });
    db.close();
  });
});

function counterRows(db: ReturnType<typeof bareDb>) {
  return db
    .prepare(
      `SELECT counter_key, uses_max, uses_used, reset_kind, source
       FROM entity_usage_counter WHERE owner_ref = 'pc-1' ORDER BY counter_key`,
    )
    .all();
}

function seedLegacy(
  db: ReturnType<typeof bareDb>,
  rows: readonly { key: string; max: number; used: number }[],
) {
  for (const row of rows) {
    db.prepare(
      `INSERT INTO entity_usage_counter(
         campaign_id, owner_kind, owner_ref, counter_key, display_name,
         uses_max, uses_used, reset_kind, source, provenance, session_id,
         updated_at)
       VALUES (?, 'character', 'pc-1', ?, 'Font of Magic', ?, ?, 'long_rest',
         'declared', 'test:legacy', ?, ?)`,
    ).run(CAMPAIGN, row.key, row.max, row.used, DEFAULT_TEST_SESSION_ID, AT);
  }
}

describe('Flexible Casting counter-owner invariants', () => {
  // The same economy (`used` of 3 points spent) in canonical, alias-only, and
  // duplicate legacy form must give the same balance, legality, and slot
  // effect, and end as exactly one canonical record counter.
  const representations = (used: number) => ({
    canonical: [{ key: 'ability:sorcery-points', max: 3, used }],
    'alias-only': [{ key: 'ability:font-of-magic', max: 9, used }],
    duplicate: [
      { key: 'ability:font-of-magic', max: 9, used },
      { key: 'ability:sorcery-points', max: 3, used: Math.max(0, used - 1) },
    ],
  });
  for (const operation of ['create-slot', 'convert-slot'] as const) {
    // create needs 2 points left (1 spent); convert needs room (2 spent).
    const used = operation === 'create-slot' ? 1 : 2;
    for (const [name, rows] of Object.entries(representations(used))) {
      it(`${name} legacy counters behave identically for ${operation}`, () => {
        const db = sorcerer3();
        seedLegacy(db, rows);
        const result =
          operation === 'create-slot'
            ? flex(db, 'create-slot', 1)
            : flex(db, 'convert-slot', 2);
        expect(result).toMatchObject(
          operation === 'create-slot'
            ? {
                pointDelta: -2,
                sorceryPoints: { remaining: 0, max: 3 },
                slot: { spellLevel: 1, created: true },
              }
            : {
                pointDelta: 2,
                sorceryPoints: { remaining: 3, max: 3 },
                slot: { spellLevel: 2, slotsUsed: 1 },
              },
        );
        const after = counterRows(db);
        expect(after).toHaveLength(1);
        expect(after[0]).toMatchObject({
          counter_key: 'ability:sorcery-points',
          uses_max: 3,
          reset_kind: 'long_rest',
          source: 'record',
          uses_used: operation === 'create-slot' ? 3 : 0,
        });
        db.close();
      });
    }
  }
});

const ADDON_ID = 'rules:test-sorcery-points-addon';

function installSorceryPointsAddon(
  db: ReturnType<typeof bareDb>,
  level3Max: number,
): CampaignRulesPackResolver {
  const base = getBundledDnd5eSrdPack();
  const clone = (key: string) => {
    const record = base.records.find((r) => r.key === key);
    if (record === undefined) throw new Error(`missing ${key}`);
    const copy = structuredClone(record);
    copy.overrides = [`${base.meta.packId}/${key}`];
    return copy;
  };
  const sorcerer = clone('class:sorcerer');
  const levels = (sorcerer.data as { progression: { level: number }[] })
    .progression;
  const row = levels.find((l) => l.level === 3) as unknown as {
    advancement: { kind: string; resource?: string; value?: number }[];
  };
  const progression = row.advancement.find(
    (a) => a.kind === 'resourceProgression' && a.resource === 'sorceryPoints',
  );
  if (progression === undefined) throw new Error('no sorceryPoints row');
  progression.value = level3Max;
  const font = clone('feature:sorcerer:font-of-magic');
  const procedure = (
    font.data as {
      mechanics: {
        procedures: {
          pool: { maximumByLevel: { level: number; maximum: number }[] };
        }[];
      };
    }
  ).mechanics.procedures[0];
  const entry = procedure?.pool.maximumByLevel.find((m) => m.level === 3);
  if (entry === undefined) throw new Error('no level 3 maximum');
  entry.maximum = level3Max;
  const addon: RulesPack = {
    meta: {
      ...base.meta,
      packId: ADDON_ID,
      title: 'Test sorcery points add-on',
      description: 'Overrides the level 3 sorcery point maximum.',
      role: 'addon',
      version: '1.0.0',
      order: 1,
      compatibleBaseSystems: [
        { systemId: base.meta.systemId, versions: [base.meta.version] },
      ],
    },
    records: [sorcerer, font],
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
    resolvedAt: AT,
  });
  return (ref) => (ref.packId === ADDON_ID ? addon : undefined);
}

describe('Flexible Casting honors the bound sorcery-point maximum', () => {
  for (const bound of [2, 4]) {
    it(`persists and reports a bound maximum of ${bound} (bundled is 3), with no spend past exhaustion`, () => {
      const db = sorcerer3();
      const resolveRulesPack = installSorceryPointsAddon(db, bound);
      const opts = { campaignId: CAMPAIGN, ...CTX, resolveRulesPack };
      const created = flexibleCasting(db, {
        ...opts,
        operation: 'create-slot',
        slotLevel: 1,
      });
      expect(created.sorceryPoints).toEqual({
        remaining: bound - 2,
        max: bound,
      });
      expect(counterRows(db)).toMatchObject([
        { uses_max: bound, uses_used: 2, source: 'record' },
      ]);
      const spend = (uses: number) =>
        spendUsage(db, {
          campaignId: CAMPAIGN,
          owner: { kind: 'character' },
          ability: 'sorcery-points',
          uses,
          resolveRulesPack,
          ...CTX,
        });
      if (bound > 2) spend(bound - 2);
      expect(() => spend(1)).toThrow(/no uses of/);

      // Converting a slot back is bounded by the same bound maximum.
      const converted = flexibleCasting(db, {
        ...opts,
        operation: 'convert-slot',
        slotLevel: 2,
      });
      expect(converted.sorceryPoints.max).toBe(bound);
      expect(converted.sorceryPoints.remaining).toBe(2);
      db.close();
    });
  }

  it('fails closed rather than falling back to bundled capacity when the binding cannot resolve', () => {
    const db = sorcerer3();
    installSorceryPointsAddon(db, 2);
    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: { kind: 'character' },
        ability: 'sorcery-points',
        resolveRulesPack: () => undefined,
        ...CTX,
      }),
    ).toThrow(/cannot resolve/);
    expect(counterRows(db)).toHaveLength(0);
    db.close();
  });
});

// A resolver nothing contracts to be stable: the add-on answers with the
// `first` pack on its first resolution and the `later` pack afterwards.
function driftingResolver(
  first: CampaignRulesPackResolver,
  later: CampaignRulesPackResolver,
): CampaignRulesPackResolver {
  let calls = 0;
  return (ref) => {
    if (ref.packId !== ADDON_ID) return undefined;
    calls += 1;
    return (calls === 1 ? first : later)(ref);
  };
}

describe('Flexible Casting pins one rules resolution per operation', () => {
  it('create-slot uses the first resolution for evaluation and spend', () => {
    const db = sorcerer3();
    const first = installSorceryPointsAddon(db, 4);
    const later = installSorceryPointsAddon(db, 2);
    const result = flexibleCasting(db, {
      campaignId: CAMPAIGN,
      operation: 'create-slot',
      slotLevel: 1,
      resolveRulesPack: driftingResolver(first, later),
      ...CTX,
    });
    expect(result.sorceryPoints).toEqual({ remaining: 2, max: 4 });
    expect(counterRows(db)).toMatchObject([{ uses_max: 4, uses_used: 2 }]);
    db.close();
  });

  it('convert-slot uses the first resolution for balance and restore', () => {
    const db = sorcerer3();
    const first = installSorceryPointsAddon(db, 4);
    const later = installSorceryPointsAddon(db, 2);
    seedLegacy(db, [{ key: 'ability:sorcery-points', max: 3, used: 2 }]);
    const result = flexibleCasting(db, {
      campaignId: CAMPAIGN,
      operation: 'convert-slot',
      slotLevel: 2,
      resolveRulesPack: driftingResolver(first, later),
      ...CTX,
    });
    expect(result.sorceryPoints).toEqual({ remaining: 4, max: 4 });
    expect(counterRows(db)).toMatchObject([{ uses_max: 4, uses_used: 0 }]);
    db.close();
  });

  it('refuses consistently (atomically) when the first resolution forbids the conversion', () => {
    const db = sorcerer3();
    const first = installSorceryPointsAddon(db, 2);
    const later = installSorceryPointsAddon(db, 4);
    seedLegacy(db, [{ key: 'ability:sorcery-points', max: 3, used: 1 }]);
    expect(() =>
      flexibleCasting(db, {
        campaignId: CAMPAIGN,
        operation: 'convert-slot',
        slotLevel: 2,
        resolveRulesPack: driftingResolver(first, later),
        ...CTX,
      }),
    ).toThrow(FlexibleCastingError);
    expect(counterRows(db)).toMatchObject([{ uses_used: 1 }]);
    db.close();
  });
});

describe('restore_usage reconciles a bound class resource to the active capacity', () => {
  const representations = {
    canonical: { key: 'ability:sorcery-points', max: 3 },
    alias: { key: 'ability:font-of-magic', max: 9 },
  };
  for (const [name, rep] of Object.entries(representations)) {
    for (const bound of [4, 2]) {
      it(`${name} counter (stored 3) restores against bound maximum ${bound}`, () => {
        const db = sorcerer3();
        const resolveRulesPack = installSorceryPointsAddon(db, bound);
        seedLegacy(db, [{ key: rep.key, max: rep.max, used: 2 }]);
        const restored = restoreUsage(db, {
          campaignId: CAMPAIGN,
          owner: { kind: 'character' },
          ability: 'sorcery-points',
          amount: 1,
          resolveRulesPack,
          ...CTX,
        });
        // Expenditure (2, clamped to the maximum) is kept, then 1 is restored.
        expect(restored.counter).toMatchObject({
          usesMax: bound,
          usesUsed: 1,
          usesRemaining: bound - 1,
        });
        expect(counterRows(db)).toMatchObject([
          {
            counter_key: 'ability:sorcery-points',
            uses_max: bound,
            uses_used: 1,
            source: 'record',
            reset_kind: 'long_rest',
          },
        ]);
        db.close();
      });
    }
  }
});
