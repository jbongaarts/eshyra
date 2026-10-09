// Flexible Casting spends the bonus action in structured combat (eshyra-cim4.1).

import { describe, expect, it } from 'vitest';
import type { AdventureModule, CharacterSheet } from '../src/internal.js';
import {
  beginTurn,
  createSqliteCharacterSheetStore,
  FlexibleCastingError,
  flexibleCasting,
  getActiveCharacterId,
  mutateState,
  readCombatTurnState,
  readSpellSlots,
  startAdventureRun,
  startEncounter,
} from '../src/internal.js';
import { makeTestAdventureModule } from './support/adventureModuleFixture.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-07-10T10:00:00.000Z';
const AT = NOW;
const CAMPAIGN = DEFAULT_TEST_CAMPAIGN_ID;
const CTX = {
  provenance: 'test:flexible-casting-combat',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: NOW,
};
const GOBLIN_1 = 'ci-enc-goblins-1-goblin-1';

function goblinModule(): AdventureModule {
  const module = makeTestAdventureModule();
  return {
    ...module,
    encounters: [
      {
        id: 'enc-goblins',
        name: 'Goblin Ambush',
        description: 'Two goblins spring from the brush.',
        creatures: [
          { rulesRef: 'creature:goblin', count: 2, role: 'ambusher' },
        ],
        locationId: 'loc-cellar',
        reward: 'A few bent copper coins.',
      },
    ],
    scenes: module.scenes.map((scene) =>
      scene.id === 'scene-cellar'
        ? { ...scene, encounterIds: ['enc-goblins'] }
        : scene,
    ),
  };
}

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

function combatSorcerer() {
  const db = freshDbWithSession();
  const module = goblinModule();
  const pcId = getActiveCharacterId(db);
  createSqliteCharacterSheetStore(db).save(
    pcId,
    sheet('class:sorcerer', 'Sorcerer', 3),
  );
  mutateState(db, {
    target: 'character',
    field: 'level',
    op: 'set',
    value: 3,
    ...CTX,
  });
  startAdventureRun(db, {
    campaignId: CAMPAIGN,
    runId: 'run-goblins',
    moduleId: module.id,
    provenance: 'test',
    sessionId: DEFAULT_TEST_SESSION_ID,
    updatedAt: NOW,
  });
  startEncounter(db, {
    campaignId: CAMPAIGN,
    encounterId: 'enc-goblins',
    resolveAdventureModule: (moduleId) =>
      moduleId === module.id ? module : undefined,
    ...CTX,
  });
  return db;
}

const PC = { kind: 'character' as const };
const flex = (
  db: ReturnType<typeof combatSorcerer>,
  operation: 'create-slot' | 'convert-slot',
  slotLevel: number,
) =>
  flexibleCasting(db, { campaignId: CAMPAIGN, operation, slotLevel, ...CTX });

describe('Flexible Casting in structured combat', () => {
  it('spends the bonus action on the sorcerer turn and refuses a second use atomically', () => {
    const db = combatSorcerer();
    const begun = beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: PC,
      ...CTX,
    });
    expect(begun.budget.bonusActionUsed).toBe(false);

    const created = flex(db, 'create-slot', 1);
    expect(created).toMatchObject({
      bonusActionSpent: true,
      pointDelta: -2,
      sorceryPoints: { remaining: 1, max: 3 },
    });
    expect(readCombatTurnState(db, CAMPAIGN)?.budgets[0]?.bonusActionUsed).toBe(
      true,
    );

    const slotsBefore = JSON.stringify(readSpellSlots(db));
    expect(() => flex(db, 'create-slot', 1)).toThrow(FlexibleCastingError);
    expect(() => flex(db, 'convert-slot', 1)).toThrow(/bonus action/i);
    expect(JSON.stringify(readSpellSlots(db))).toBe(slotsBefore);
    db.close();
  });

  it('refuses on another participant turn and changes nothing', () => {
    const db = combatSorcerer();
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: { kind: 'combatant', ref: GOBLIN_1 },
      ...CTX,
    });
    const slotsBefore = JSON.stringify(readSpellSlots(db));
    expect(() => flex(db, 'create-slot', 1)).toThrow(/not .*turn/i);
    expect(JSON.stringify(readSpellSlots(db))).toBe(slotsBefore);
    db.close();
  });

  it('refuses a convert whose bonus action is gone without restoring points', () => {
    const db = combatSorcerer();
    beginTurn(db, { campaignId: CAMPAIGN, participant: PC, ...CTX });
    flex(db, 'create-slot', 1);
    const slotsBefore = JSON.stringify(readSpellSlots(db));
    expect(() => flex(db, 'convert-slot', 1)).toThrow(FlexibleCastingError);
    expect(JSON.stringify(readSpellSlots(db))).toBe(slotsBefore);
    db.close();
  });
});
