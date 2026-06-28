import { beforeEach, describe, expect, it } from 'vitest';
import { ABILITY_SCORE_NAMES } from '../src/character/abilities.js';
import type { AbilityScoreName } from '../src/character/creation.js';
import type {
  CharacterSheet,
  FinalizedAbilityScore,
} from '../src/character/finalizeCharacter.js';
import {
  CharacterChronicleStoreError,
  createCharacterChronicleStore,
  createCharacterRegistryStore,
  type Db,
  DND5E_SRD_PACK_ID,
  DND5E_SRD_SYSTEM_ID,
  ensureCharacterRegistrySchema,
  openDatabase,
} from '../src/internal.js';

const AT_1 = '2026-06-28T04:40:00.000Z';
const AT_2 = '2026-06-28T04:41:00.000Z';

function makeSheet(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const abilityScores = {} as Record<AbilityScoreName, FinalizedAbilityScore>;
  const savingThrows = {} as CharacterSheet['savingThrows'];
  for (const name of ABILITY_SCORE_NAMES) {
    abilityScores[name] = { base: 10, final: 10, modifier: 0 };
    savingThrows[name] = { modifier: 0, proficient: false };
  }
  return {
    schemaVersion: 1,
    system: DND5E_SRD_SYSTEM_ID,
    rulesPackId: DND5E_SRD_PACK_ID,
    recipeId: 'dnd5e-srd-character',
    creationMode: 'test',
    level: 1,
    identity: { name: 'Mira' },
    class: { key: 'class:fighter', name: 'Fighter' },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores,
    proficiencyBonus: 2,
    maxHitPoints: 12,
    savingThrows,
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: ['Common'],
    spells: [],
    metadata: { createdAt: AT_1 },
    ...overrides,
  };
}

function source(overrides = {}) {
  return {
    campaignId: 'campaign-a',
    sessionId: 'session-1',
    turnId: 'turn-7',
    sceneId: 'scene-lantern',
    at: AT_1,
    ...overrides,
  };
}

describe('character chronicle store', () => {
  let db: Db;
  let clock = AT_1;

  beforeEach(() => {
    db = openDatabase(':memory:');
    ensureCharacterRegistrySchema(db);
    clock = AT_1;
  });

  it('round-trips chronicle records in the registry DB keyed by global character id', () => {
    const chronicle = createCharacterChronicleStore(db, () => clock);

    const record = chronicle.appendRecord({
      globalCharacterId: 'char-mira',
      category: 'relationship',
      text: 'Mira owes Tamsin a life debt.',
      source: source(),
      portability: 'portable',
      visibility: 'player-visible',
      truthStatus: 'remembered',
      relatedRefs: [
        {
          ref: 'npc:tamsin',
          scope: 'campaign',
          campaignId: 'campaign-a',
        },
      ],
    });

    expect(record).toMatchObject({
      id: 'chronicle-1',
      globalCharacterId: 'char-mira',
      category: 'relationship',
      text: 'Mira owes Tamsin a life debt.',
      portability: 'portable',
      visibility: 'player-visible',
      truthStatus: 'remembered',
      createdAt: AT_1,
      updatedAt: AT_1,
    });
    expect(chronicle.getRecord('char-mira', record.id)).toEqual(record);
    expect(chronicle.listRecords('char-mira')).toEqual([record]);
    expect(chronicle.listRecords('char-other')).toEqual([]);
  });

  it('normalizes caller-supplied chronicle record ids', () => {
    const chronicle = createCharacterChronicleStore(db, () => clock);

    const record = chronicle.appendRecord({
      id: ' custom-id ',
      globalCharacterId: 'char-mira',
      category: 'relationship',
      text: 'Mira owes Tamsin a life debt.',
      source: source(),
      portability: 'portable',
      visibility: 'player-visible',
      truthStatus: 'remembered',
      relatedRefs: [],
    });
    const fetched = chronicle.getRecord('char-mira', ' custom-id ');
    clock = AT_2;
    const updated = chronicle.updateRecord('char-mira', ' custom-id ', {
      portability: 'archived',
      at: AT_2,
    });

    expect(record.id).toBe('custom-id');
    expect(fetched).toEqual(record);
    expect(updated).toMatchObject({
      id: 'custom-id',
      portability: 'archived',
      updatedAt: AT_2,
    });
    expect(chronicle.listEvents('char-mira', ' custom-id ')).toHaveLength(2);
  });

  it('records create/update events and keeps records ordered', () => {
    const chronicle = createCharacterChronicleStore(db, () => clock);
    const first = chronicle.appendRecord({
      globalCharacterId: 'char-mira',
      category: 'campaign-participation',
      text: 'Mira survived the lantern vault.',
      source: source(),
      portability: 'portable',
      visibility: 'player-visible',
      truthStatus: 'confirmed-by-character',
      relatedRefs: [],
    });
    clock = AT_2;
    const second = chronicle.appendRecord({
      globalCharacterId: 'char-mira',
      category: 'vow',
      text: 'Mira vowed to return the lantern to Emberfall.',
      source: source({ sessionId: 'session-2', at: AT_2 }),
      portability: 'campaign-local',
      visibility: 'dm-only',
      truthStatus: 'remembered',
      relatedRefs: [],
    });
    const updated = chronicle.updateRecord('char-mira', second.id, {
      portability: 'portable',
      visibility: 'player-visible',
      at: AT_2,
    });

    expect(chronicle.listRecords('char-mira').map((entry) => entry.id)).toEqual(
      [first.id, updated.id],
    );
    expect(updated).toMatchObject({
      portability: 'portable',
      visibility: 'player-visible',
      updatedAt: AT_2,
    });
    expect(
      chronicle.listEvents('char-mira').map((event) => event.kind),
    ).toEqual(['create', 'create', 'update']);
    expect(chronicle.listEvents('char-mira', second.id)[1]).toMatchObject({
      id: 'chronicle-event-3',
      recordId: second.id,
      kind: 'update',
      changes: {
        portability: 'portable',
        visibility: 'player-visible',
      },
      occurredAt: AT_2,
    });
  });

  it('appends record batches atomically', () => {
    const chronicle = createCharacterChronicleStore(db, () => clock);

    expect(() =>
      chronicle.appendRecords([
        {
          id: 'shared-id',
          globalCharacterId: 'char-mira',
          category: 'relationship',
          text: 'Mira owes Tamsin a life debt.',
          source: source(),
          portability: 'portable',
          visibility: 'player-visible',
          truthStatus: 'remembered',
          relatedRefs: [],
        },
        {
          id: 'shared-id',
          globalCharacterId: 'char-mira',
          category: 'vow',
          text: 'Mira vowed to return the lantern.',
          source: source(),
          portability: 'portable',
          visibility: 'player-visible',
          truthStatus: 'remembered',
          relatedRefs: [],
        },
      ]),
    ).toThrow(CharacterChronicleStoreError);
    expect(chronicle.listRecords('char-mira')).toEqual([]);
    expect(chronicle.listEvents('char-mira')).toEqual([]);
  });

  it('validates required fields and constrained vocabularies', () => {
    const chronicle = createCharacterChronicleStore(db, () => clock);
    expect(() =>
      chronicle.appendRecord({
        globalCharacterId: ' ',
        category: 'relationship',
        text: 'Known by nobody.',
        source: source(),
        portability: 'portable',
        visibility: 'player-visible',
        truthStatus: 'remembered',
        relatedRefs: [],
      }),
    ).toThrow(CharacterChronicleStoreError);
    expect(() =>
      chronicle.appendRecord({
        globalCharacterId: 'char-mira',
        id: ' ',
        category: 'relationship',
        text: 'Invalid id.',
        source: source(),
        portability: 'portable',
        visibility: 'player-visible',
        truthStatus: 'remembered',
        relatedRefs: [],
      }),
    ).toThrow(CharacterChronicleStoreError);
    expect(() =>
      chronicle.appendRecord({
        globalCharacterId: 'char-mira',
        category: 'quest' as never,
        text: 'Invalid category.',
        source: source(),
        portability: 'portable',
        visibility: 'player-visible',
        truthStatus: 'remembered',
        relatedRefs: [],
      }),
    ).toThrow(CharacterChronicleStoreError);
  });

  it('keeps chronicle records separate from the mechanical CharacterSheet', () => {
    const registry = createCharacterRegistryStore(db, () => clock);
    const chronicle = createCharacterChronicleStore(db, () => clock);
    const sheet = makeSheet();
    registry.save('char-mira', sheet);

    chronicle.appendRecord({
      globalCharacterId: 'char-mira',
      category: 'subjective-knowledge',
      text: 'Mira remembers King Aldren as a betrayer.',
      source: source(),
      portability: 'portable',
      visibility: 'player-visible',
      truthStatus: 'believed',
      relatedRefs: [],
    });

    expect(registry.load('char-mira')).toEqual(sheet);
  });
});
