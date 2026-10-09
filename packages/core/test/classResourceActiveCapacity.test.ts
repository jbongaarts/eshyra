// Active-capacity invariant (eshyra-09co.7): for a pack-bound class resource
// the ACTIVE campaign class table owns maximum/reset/source, and reset_usage,
// rests and the context counter reader report that maximum for stale canonical
// and alias counters.

import { describe, expect, it } from 'vitest';
import type {
  CampaignRulesPackResolver,
  CharacterSheet,
  RulesPack,
} from '../src/internal.js';
import {
  assembleContext,
  completeLongRest,
  completeShortRest,
  createDefaultToolRegistry,
  createSeededRng,
  createSqliteCharacterSheetStore,
  formatCampaignPosition,
  getBundledDnd5eSrdPack,
  readSpentUsageCounters,
  resetUsage,
  spendUsage,
  writeCampaignRulesBinding,
} from '../src/internal.js';
import {
  bareDb,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const AT = '2026-07-11T12:00:00.000Z';
const CTX = {
  provenance: 'test:active-capacity',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: AT,
};
const CAMPAIGN = 'campaign-1';

interface Resource {
  readonly name: string;
  readonly classKey: string;
  readonly resource: string;
  readonly canonical: string;
  readonly alias: string;
  readonly reset: 'long_rest' | 'short_or_long_rest';
}
const RESOURCES: readonly Resource[] = [
  {
    name: 'Sorcery Points',
    classKey: 'class:sorcerer',
    resource: 'sorceryPoints',
    canonical: 'ability:sorcery-points',
    alias: 'ability:font-of-magic',
    reset: 'long_rest',
  },
  {
    name: 'Ki',
    classKey: 'class:monk',
    resource: 'kiPoints',
    canonical: 'ability:ki',
    alias: 'ability:ki-points',
    reset: 'short_or_long_rest',
  },
  {
    name: 'Rage',
    classKey: 'class:barbarian',
    resource: 'rages',
    canonical: 'ability:rage',
    alias: 'ability:rages',
    reset: 'long_rest',
  },
];

function sheet(classKey: string): CharacterSheet {
  const score = { base: 10, final: 10, modifier: 0 } as const;
  const save = { modifier: 0, proficient: false } as const;
  return {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    rulesPackId: 'rules:dnd5e-srd-5.1',
    recipeId: 'dnd5e-srd-character',
    creationMode: 'test',
    level: 3,
    identity: { name: 'Cap Tester' },
    class: { key: classKey, name: classKey },
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

function setup(res: Resource) {
  const db = bareDb();
  createSqliteCharacterSheetStore(db).save('pc-1', sheet(res.classKey));
  db.prepare(
    'UPDATE character SET name = ?, level = 3, hp_current = 8, hp_max = 8 WHERE id = ?',
  ).run('Cap Tester', 'pc-1');
  return db;
}

const ADDON_ID = 'rules:test-class-resource-addon';

/** Class-table-only add-on: level 3 resource maximum becomes `max`. */
function installClassAddon(
  db: ReturnType<typeof bareDb>,
  res: Resource,
  max: number,
): CampaignRulesPackResolver {
  const base = getBundledDnd5eSrdPack();
  const record = base.records.find((r) => r.key === res.classKey);
  if (record === undefined) throw new Error('missing class');
  const copy = structuredClone(record);
  copy.overrides = [`${base.meta.packId}/${res.classKey}`];
  const row = (
    copy.data as {
      progression: {
        level: number;
        advancement: { kind: string; resource?: string; value?: number }[];
      }[];
    }
  ).progression.find((l) => l.level === 3);
  const progression = row?.advancement.find(
    (a) => a.kind === 'resourceProgression' && a.resource === res.resource,
  );
  if (progression === undefined) throw new Error('no resource row');
  progression.value = max;
  const addon: RulesPack = {
    meta: {
      ...base.meta,
      packId: ADDON_ID,
      title: 'Test class resource add-on',
      description: 'Overrides a level 3 class resource maximum.',
      role: 'addon',
      version: '1.0.0',
      order: 1,
      compatibleBaseSystems: [
        { systemId: base.meta.systemId, versions: [base.meta.version] },
      ],
    },
    records: [copy],
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

function seed(
  db: ReturnType<typeof bareDb>,
  key: string,
  resetKind: string,
  used: number,
) {
  db.prepare(
    `INSERT INTO entity_usage_counter(
       campaign_id, owner_kind, owner_ref, counter_key, display_name,
       uses_max, uses_used, reset_kind, source, provenance, session_id,
       updated_at)
     VALUES (?, 'character', 'pc-1', ?, 'Stale', 3, ?, ?, 'declared',
       'test:stale', ?, ?)`,
  ).run(CAMPAIGN, key, used, resetKind, DEFAULT_TEST_SESSION_ID, AT);
}

function rows(db: ReturnType<typeof bareDb>) {
  return db
    .prepare(
      `SELECT counter_key, uses_max, uses_used, reset_kind, source
       FROM entity_usage_counter WHERE owner_ref = 'pc-1'`,
    )
    .all();
}

const LONG = {
  durationMinutes: 480,
  sleepMinutes: 360,
  lightActivityMinutes: 0,
  strenuousInterruptionMinutes: 0,
  foodAndDrink: false,
};

type Entry = { usesMax: number; usesRemaining: number; counterKey?: string };

describe('reset_usage and rests report and persist the active class-table maximum', () => {
  for (const res of RESOURCES) {
    for (const key of [res.canonical, res.alias]) {
      for (const active of [2, 4]) {
        const label = `${res.name} stale ${key} (3) vs active ${active}`;
        const expectPersisted = (db: ReturnType<typeof bareDb>) =>
          expect(rows(db)).toEqual([
            {
              counter_key: res.canonical,
              uses_max: active,
              uses_used: 0,
              reset_kind: res.reset,
              source: 'record',
            },
          ]);

        it(`resetUsage: ${label}`, () => {
          const db = setup(res);
          const resolveRulesPack = installClassAddon(db, res, active);
          seed(db, key, 'long_rest', 1);
          const result = resetUsage(db, {
            campaignId: CAMPAIGN,
            event: 'long_rest',
            owner: { kind: 'character', ref: 'pc-1' },
            resolveRulesPack,
            ...CTX,
          });
          expect(result.reset).toMatchObject([
            { usesMax: active, usesUsed: 0, usesRemaining: active },
          ]);
          expectPersisted(db);
          db.close();
        });

        it(`party-wide resetUsage (no owner): ${label}`, () => {
          const db = setup(res);
          const resolveRulesPack = installClassAddon(db, res, active);
          seed(db, key, 'long_rest', 1);
          const result = resetUsage(db, {
            campaignId: CAMPAIGN,
            event: 'long_rest',
            resolveRulesPack,
            ...CTX,
          });
          expect(result.reset).toMatchObject([{ usesMax: active }]);
          expectPersisted(db);
          db.close();
        });

        it(`reset_usage tool: ${label}`, () => {
          const db = setup(res);
          const resolveRulesPack = installClassAddon(db, res, active);
          seed(db, key, 'long_rest', 1);
          const out = createDefaultToolRegistry().invoke(
            'reset_usage',
            { event: 'long_rest' },
            {
              db,
              rng: createSeededRng(1),
              campaignId: CAMPAIGN,
              sessionId: DEFAULT_TEST_SESSION_ID,
              turnId: 'turn-1',
              at: AT,
              resolveRulesPack,
            },
          ) as { ok: boolean; data: { reset: Entry[] } };
          expect(out.ok).toBe(true);
          expect(out.data.reset).toMatchObject([{ usesMax: active }]);
          expectPersisted(db);
          db.close();
        });

        it(`completeLongRest: ${label}`, () => {
          const db = setup(res);
          const resolveRulesPack = installClassAddon(db, res, active);
          seed(db, key, 'long_rest', 1);
          const result = completeLongRest(db, {
            campaignId: CAMPAIGN,
            restId: 'rest-1',
            participants: ['pc-1'],
            qualification: LONG,
            resolveRulesPack,
            ...CTX,
          }) as { usageReset: Record<string, Entry[]> };
          expect(result.usageReset['pc-1']).toMatchObject([
            { usesMax: active, usesRemaining: active },
          ]);
          expectPersisted(db);
          db.close();
        });

        if (res.reset === 'short_or_long_rest') {
          it(`completeShortRest: ${label}`, () => {
            const db = setup(res);
            const resolveRulesPack = installClassAddon(db, res, active);
            seed(db, key, 'long_rest', 1);
            const result = completeShortRest(db, {
              campaignId: CAMPAIGN,
              restId: 'rest-1',
              participants: ['pc-1'],
              qualification: { durationMinutes: 60, strenuousActivity: false },
              resolveRulesPack,
              ...CTX,
            }) as { usageReset: Record<string, Entry[]> };
            expect(result.usageReset['pc-1']).toMatchObject([
              { usesMax: active, usesRemaining: active },
            ]);
            expectPersisted(db);
            db.close();
          });
        }
      }
    }
  }
});

describe('context counter reader reports the active maximum', () => {
  for (const res of RESOURCES) {
    it(`${res.name}: stale stored maximum 3 reads as the active maximum`, () => {
      const db = setup(res);
      const resolveRulesPack = installClassAddon(db, res, 2);
      seed(db, res.alias, 'long_rest', 3);
      expect(
        readSpentUsageCounters(db, CAMPAIGN, resolveRulesPack),
      ).toMatchObject([{ usesMax: 2, usesUsed: 2, usesRemaining: 0 }]);
      db.close();
    });
  }
});

function rowsOf(db: ReturnType<typeof bareDb>) {
  return db
    .prepare('SELECT * FROM entity_usage_counter ORDER BY counter_key')
    .all();
}

/** Class-table-only add-on that REMOVES the level 3 resource progression. */
function installNoneAddon(
  db: ReturnType<typeof bareDb>,
  res: Resource,
): CampaignRulesPackResolver {
  const resolver = installClassAddon(db, res, 1);
  const addon = resolver({
    systemId: getBundledDnd5eSrdPack().meta.systemId,
    packId: ADDON_ID,
    version: '1.0.0',
  } as never) as RulesPack;
  const data = addon.records[0]?.data as {
    progression: {
      level: number;
      advancement: { kind: string; resource?: string }[];
    }[];
  };
  const row = data.progression.find((l) => l.level === 3);
  if (row === undefined) throw new Error('no level 3');
  row.advancement = row.advancement.filter(
    (a) => !(a.kind === 'resourceProgression' && a.resource === res.resource),
  );
  return resolver;
}

describe('assembleContext keeps a non-bundled binding usable across a spend', () => {
  for (const res of RESOURCES) {
    it(`${res.name}: before and after spendUsage, showing the active capacity`, () => {
      const db = freshDbWithSession();
      createSqliteCharacterSheetStore(db).save('pc-1', sheet(res.classKey));
      db.prepare(
        'UPDATE character SET name = ?, level = 3, hp_current = 8, hp_max = 8 WHERE id = ?',
      ).run('Cap Tester', 'pc-1');
      const resolveRulesPack = installClassAddon(db, res, 4);
      const ctxInput = {
        db,
        campaignId: CAMPAIGN,
        actingCharacterId: 'pc-1',
        campaignPosition: formatCampaignPosition({
          sessionId: DEFAULT_TEST_SESSION_ID,
          turnId: 'turn-1',
          ordinal: 1,
        }),
        sessionId: DEFAULT_TEST_SESSION_ID,
        playerInput: 'continue',
        resolveRulesPack,
      };
      expect(() => assembleContext(ctxInput)).not.toThrow();
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: { kind: 'character', ref: 'pc-1' },
        ability: res.name,
        resolveRulesPack,
        ...CTX,
      });
      const after = assembleContext(ctxInput);
      expect(after.state.spentUsageCounters).toMatchObject([
        { usesMax: 4, usesUsed: 1 },
      ]);
      db.close();
    });
  }
});

describe('read projection agrees with the owner without writing', () => {
  for (const res of RESOURCES) {
    const shapes: [string, [string, string, number][]][] = [
      ['canonical', [[res.canonical, 'long_rest', 1]]],
      ['alias-only', [[res.alias, 'short_rest', 2]]],
      [
        'duplicate legacy',
        [
          [res.alias, 'short_rest', 3],
          [res.canonical, 'long_rest', 1],
        ],
      ],
    ];
    for (const [shape, seeds] of shapes) {
      it(`${res.name} ${shape}: finite capacity`, () => {
        const readDb = setup(res);
        const ownerDb = setup(res);
        const resolver = installClassAddon(readDb, res, 4);
        installClassAddon(ownerDb, res, 4);
        for (const [k, r, u] of seeds) {
          seed(readDb, k, r, u);
          seed(ownerDb, k, r, u);
        }
        const before = rowsOf(readDb);
        const read = readSpentUsageCounters(readDb, CAMPAIGN, resolver);
        expect(rowsOf(readDb)).toEqual(before);
        // Owner: long-rest reset persists the canonical row.
        resetUsage(ownerDb, {
          campaignId: CAMPAIGN,
          event: 'dawn',
          resolveRulesPack: resolver,
          ...CTX,
        });
        const owner = ownerDb
          .prepare(
            'SELECT counter_key, uses_max, reset_kind, source FROM entity_usage_counter',
          )
          .all();
        expect(read).toHaveLength(1);
        expect(owner).toHaveLength(1);
        expect({
          counter_key: read[0]?.counterKey,
          uses_max: read[0]?.usesMax,
          reset_kind: read[0]?.resetKind,
          source: read[0]?.source,
        }).toEqual(owner[0]);
        expect(read[0]?.usesUsed).toBe(
          Math.min(Math.max(...seeds.map((x) => x[2])), 4),
        );
        readDb.close();
        ownerDb.close();
      });
    }

    it(`${res.name}: none capacity is not advertised`, () => {
      const db = setup(res);
      const resolver = installNoneAddon(db, res);
      seed(db, res.alias, 'long_rest', 2);
      const before = rowsOf(db);
      expect(readSpentUsageCounters(db, CAMPAIGN, resolver)).toEqual([]);
      expect(rowsOf(db)).toEqual(before);
      db.close();
    });

    it(`${res.name}: unlimited capacity is not shown as a finite pool`, () => {
      // Barbarian 20 only; other classes have no unlimited tier.
      if (res.resource !== 'rages') return;
      const db = setup(res);
      db.prepare('UPDATE character SET level = 20 WHERE id = ?').run('pc-1');
      const store = createSqliteCharacterSheetStore(db);
      store.save('pc-1', {
        ...sheet(res.classKey),
        level: 20,
      } as CharacterSheet);
      seed(db, res.canonical, 'long_rest', 3);
      expect(readSpentUsageCounters(db, CAMPAIGN)).toEqual([]);
      db.close();
    });
  }
});

describe('a none-capacity bound resource is never refilled or reported', () => {
  for (const res of RESOURCES) {
    for (const key of [res.canonical, res.alias]) {
      it(`${res.name} ${key}: resetUsage and completeLongRest`, () => {
        const db = setup(res);
        const resolveRulesPack = installNoneAddon(db, res);
        seed(db, key, 'long_rest', 1);
        const before = rowsOf(db);
        const result = resetUsage(db, {
          campaignId: CAMPAIGN,
          event: 'long_rest',
          owner: { kind: 'character', ref: 'pc-1' },
          resolveRulesPack,
          ...CTX,
        });
        expect(result.reset).toEqual([]);
        expect(rowsOf(db)).toEqual(before);
        const rest = completeLongRest(db, {
          campaignId: CAMPAIGN,
          restId: 'rest-1',
          participants: ['pc-1'],
          qualification: LONG,
          resolveRulesPack,
          ...CTX,
        }) as { usageReset: Record<string, Entry[]> };
        expect(rest.usageReset['pc-1']).toEqual([]);
        expect(rowsOf(db)).toEqual(before);
        db.close();
      });
    }
  }
});
