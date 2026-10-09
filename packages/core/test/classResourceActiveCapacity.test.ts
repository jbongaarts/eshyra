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
  completeLongRest,
  completeShortRest,
  createDefaultToolRegistry,
  createSeededRng,
  createSqliteCharacterSheetStore,
  getBundledDnd5eSrdPack,
  readSpentUsageCounters,
  resetUsage,
  writeCampaignRulesBinding,
} from '../src/internal.js';
import { bareDb, DEFAULT_TEST_SESSION_ID } from './support/db.js';

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
