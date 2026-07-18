import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAGIC_ITEM_ENTITY_GRANT_NAMES,
  MAGIC_ITEM_ENTITY_GRANT_REFERENCES,
  projectMagicItemEntityGrants,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemEntityGrants.js';
import type { MagicItemExtraction } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import type { RulesRecord } from '../../../src/rules/types.js';

const records = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
    ),
    'utf8',
  ),
) as RulesRecord[];
const magicItems = records.filter((record) => record.kind === 'magic-item');
const recordKeys = new Set(records.map((record) => record.key));

function extraction(record: RulesRecord): MagicItemExtraction {
  const data = record.data as Record<string, unknown>;
  return {
    name: record.name,
    itemType: data.itemType as string,
    rarity: data.rarity as string,
    requiresAttunement: data.requiresAttunement as boolean,
    description: data.description as string,
    sourcePage: record.provenance?.pageStart ?? 1,
    variants: data.variants as MagicItemExtraction['variants'],
  };
}

function named(name: string): MagicItemExtraction {
  const record = magicItems.find((candidate) => candidate.name === name);
  if (record === undefined) throw new Error(`missing fixture item ${name}`);
  return extraction(record);
}

function grantBlock(name: string): Record<string, unknown> {
  const projection = projectMagicItemEntityGrants(named(name));
  if (projection?.mechanics.entityGrant === undefined) {
    throw new Error(`missing entity grant for ${name}`);
  }
  return projection.mechanics.entityGrant as unknown as Record<string, unknown>;
}

function grants(name: string): readonly Record<string, unknown>[] {
  return grantBlock(name).grants as readonly Record<string, unknown>[];
}

describe('M4 magic-item entity lifecycle family projection', () => {
  it('pins the exact reviewed 17-row census with no duplicates or near misses', () => {
    expect(MAGIC_ITEM_ENTITY_GRANT_NAMES).toEqual([
      'Bag of Tricks',
      'Bowl of Commanding Water Elementals',
      'Brazier of Commanding Fire Elementals',
      'Censer of Controlling Air Elementals',
      'Stone of Controlling Earth Elementals',
      'Efreeti Bottle',
      'Elemental Gem',
      'Feather Token',
      'Figurine of Wondrous Power',
      'Horn of Valhalla',
      'Iron Flask',
      'Manual of Golems',
      'Orb of Dragonkind',
      'Pipes of the Sewers',
      'Ring of Djinni Summoning',
      'Staff of the Python',
      'Deck of Illusions',
    ]);
    expect(MAGIC_ITEM_ENTITY_GRANT_NAMES).toHaveLength(17);
    expect(new Set(MAGIC_ITEM_ENTITY_GRANT_NAMES).size).toBe(17);
    for (const name of MAGIC_ITEM_ENTITY_GRANT_NAMES) {
      const projection = projectMagicItemEntityGrants(named(name));
      expect(projection?.family, name).toBe('m4-entity-lifecycles');
      expect(projection?.clauses).toEqual([
        expect.objectContaining({
          tag: 'M4',
          representation: { block: 'entityGrant' },
        }),
      ]);
    }
    expect(
      projectMagicItemEntityGrants(named('Bag of Holding')),
    ).toBeUndefined();
    expect(
      projectMagicItemEntityGrants(named('Dancing Sword')),
    ).toBeUndefined();
  });

  it('projects the figurine family as durable identities, including the golden pair and source stat block', () => {
    expect(grantBlock('Figurine of Wondrous Power').runtimeOwner).toBe(
      'persistent-actor',
    );
    expect(grants('Figurine of Wondrous Power')).toHaveLength(11);
    expect(grants('Figurine of Wondrous Power')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ebony-fly',
          statBlockRef: 'stat-block:giant-fly',
          duration: { amount: 12, unit: 'hour' },
        }),
        expect.objectContaining({
          id: 'golden-lions',
          creatureRefs: ['creature:lion'],
          count: 2,
          duration: { amount: 1, unit: 'hour' },
          note: expect.stringContaining('separately or simultaneously'),
        }),
        expect.objectContaining({
          id: 'goat-of-traveling',
          creatureRefs: ['creature:riding-horse'],
          cooldownEconomy: 'goat-of-traveling-hour-charges',
        }),
        expect.objectContaining({
          id: 'obsidian-steed',
          creatureRefs: ['creature:nightmare'],
          control: expect.stringContaining('10% chance'),
        }),
      ]),
    );
    expect(
      grants('Figurine of Wondrous Power').find(
        (grant) => grant.id === 'goat-of-traveling',
      ),
    ).not.toHaveProperty('duration');
  });

  it('projects table-selected bag creatures without leaking live combatant state into item data', () => {
    expect(grantBlock('Bag of Tricks').runtimeOwner).toBe(
      'encounter-combatant',
    );
    expect(grants('Bag of Tricks')).toEqual([
      expect.objectContaining({
        id: 'bag-creature',
        kind: 'creature',
        tableRefs: [
          'table:gray-bag-of-tricks',
          'table:rust-bag-of-tricks',
          'table:tan-bag-of-tricks',
        ],
        revertOn: ['next-dawn', 'reduced-to-0-hit-points'],
        cooldownEconomy: 'uses',
      }),
    ]);
    expect(grants('Bag of Tricks')[0]).not.toHaveProperty('hitPoints');
    expect(grants('Bag of Tricks')[0]).not.toHaveProperty('initiative');
    expect(grants('Bag of Tricks')[0]).not.toHaveProperty('combatantId');
  });

  it('projects staff-python death destruction separately from early healing reversion', () => {
    expect(grantBlock('Staff of the Python').runtimeOwner).toBe(
      'persistent-actor',
    );
    expect(grants('Staff of the Python')).toEqual([
      expect.objectContaining({
        id: 'python-form',
        creatureRefs: ['creature:giant-constrictor-snake'],
        revertOn: ['owner-bonus-action-command', 'reduced-to-0-hit-points'],
        onEntityDeath: expect.stringContaining('staff shatters'),
        exclusiveInstance: { scope: 'item', recast: 'dismiss-existing' },
        note: expect.stringContaining(
          'Early reversion restores all hit points',
        ),
      }),
    ]);
  });

  it('projects the particular djinni with concentration, home-plane return, cooldown, and death consequence', () => {
    const djinni = grants('Ring of Djinni Summoning')[0];
    expect(djinni).toMatchObject({
      id: 'particular-djinni',
      creatureRefs: ['creature:djinni'],
      duration: { amount: 1, unit: 'hour' },
      revertOn: [
        'concentration-ended',
        'reduced-to-0-hit-points',
        'one-hour-ended',
      ],
      cooldownEconomy: 'cooldown',
      exclusiveInstance: { scope: 'item', recast: 'blocked' },
      onEntityDeath: expect.stringContaining('make the ring nonmagical'),
      note: expect.stringContaining('same particular djinni'),
    });
  });

  it('keeps deck results as harmless illusory entities, not creatures', () => {
    expect(grantBlock('Deck of Illusions').runtimeOwner).toBe(
      'illusory-entity',
    );
    expect(grants('Deck of Illusions')).toEqual([
      expect.objectContaining({
        id: 'card-illusion',
        kind: 'illusion',
        tableRefs: ['table:deck-of-illusions'],
        revertOn: ['card-moved', 'dispelled'],
        cooldownEconomy: 'cards',
        note: expect.stringContaining('never creates a creature combatant'),
      }),
    ]);
    expect(grants('Deck of Illusions')[0]).not.toHaveProperty('creatureRefs');
    expect(grants('Deck of Illusions')[0]).not.toHaveProperty('statBlockRef');
  });

  it('resolves every curated creature, stat-block, and table reference against the actual pack', () => {
    const uniqueReferences = new Set(MAGIC_ITEM_ENTITY_GRANT_REFERENCES);
    expect(uniqueReferences.size).toBeGreaterThan(20);
    for (const ref of uniqueReferences) {
      expect(recordKeys.has(ref), ref).toBe(true);
    }
  });

  it('pins source phrases carried by referenced conditional-selection tables', () => {
    const efreetiTable = records.find(
      (record) => record.key === 'table:efreeti-bottle',
    );
    const hornTable = records.find(
      (record) => record.key === 'table:horn-of-valhalla',
    );
    expect(JSON.stringify(efreetiTable?.data)).toContain(
      'After fighting for 5 rounds',
    );
    expect(JSON.stringify(efreetiTable?.data)).toContain(
      'serves you for 1 hour',
    );
    expect(JSON.stringify(efreetiTable?.data)).toContain(
      'cast the wish spell three times for you',
    );
    expect(JSON.stringify(hornTable?.data)).toContain('5d4 + 5');
    expect(JSON.stringify(hornTable?.data)).toContain(
      'Proficiency with all martial weapons',
    );
  });

  it('fails loudly on reviewed source drift before emitting stale semantics', () => {
    const ring = named('Ring of Djinni Summoning');
    expect(() =>
      projectMagicItemEntityGrants({
        ...ring,
        description: ring.description.replace(
          'summon a particular djinni',
          'summon a djinni',
        ),
      }),
    ).toThrow(/expected source phrase.*summon a particular djinni/);

    const deck = named('Deck of Illusions');
    expect(() =>
      projectMagicItemEntityGrants({
        ...deck,
        description: deck.description.replace('can do no harm', 'is harmless'),
      }),
    ).toThrow(/expected source phrase.*can do no harm/);
  });
});
