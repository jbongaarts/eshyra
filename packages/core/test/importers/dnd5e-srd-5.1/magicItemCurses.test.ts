import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAGIC_ITEM_CURSE_NAMES,
  MAGIC_ITEM_CURSE_REFERENCES,
  projectMagicItemCurses,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemCurses.js';
import type { MagicItemExtraction } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import { validateMagicItemMechanics } from '../../../src/rules/magicItemMechanics.js';
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

function mechanics(name: string): Record<string, unknown> {
  const projection = projectMagicItemCurses(named(name));
  if (projection === undefined)
    throw new Error(`missing M7 projection ${name}`);
  return projection.mechanics as Record<string, unknown>;
}

function curse(name: string): Record<string, unknown> {
  return mechanics(name).curse as Record<string, unknown>;
}

function states(name: string): readonly Record<string, unknown>[] {
  return (curse(name).stateDefinitions ?? []) as readonly Record<
    string,
    unknown
  >[];
}

describe('M7 magic-item curses, oaths, and restrictions', () => {
  it('pins the exact reviewed 12-row census and fails closed on near misses', () => {
    expect(MAGIC_ITEM_CURSE_NAMES).toEqual([
      'Armor of Vulnerability',
      'Berserker Axe',
      'Demon Armor',
      'Shield of Missile Attraction',
      'Oathbow',
      'Sword of Wounding',
      'Ring of Mind Shielding',
      'Orb of Dragonkind',
      'Robe of the Archmagi',
      'Talisman of Pure Good',
      'Talisman of Ultimate Evil',
      'Deck of Many Things',
    ]);
    expect(MAGIC_ITEM_CURSE_NAMES).toHaveLength(12);
    expect(new Set(MAGIC_ITEM_CURSE_NAMES).size).toBe(12);
    for (const name of MAGIC_ITEM_CURSE_NAMES) {
      const projection = projectMagicItemCurses(named(name));
      expect(projection?.family, name).toBe('m7-curses-oaths-restrictions');
      expect(projection?.clauses.length, name).toBeGreaterThan(0);
      expect(projection?.clauses.every((entry) => entry.tag === 'M7')).toBe(
        true,
      );
      const projectedMechanics = projection?.mechanics;
      const declaredEffectIds = new Set(
        (projectedMechanics?.effects ?? []).flatMap((effect) =>
          effect.id === undefined ? [] : [effect.id],
        ),
      );
      const curseBlock = projectedMechanics?.curse;
      const requiredEffectIds = new Set([
        ...(curseBlock?.effects ?? []),
        ...(curseBlock?.stateDefinitions ?? []).flatMap(
          (definition) => definition.effects ?? [],
        ),
      ]);
      // A few M7 states bind C2 effects supplied by a sibling family. Add
      // marker stand-ins solely to exercise the canonical cross-reference
      // validator before compiler aggregation supplies the real payloads.
      const siblingEffects = [...requiredEffectIds]
        .filter((id) => !declaredEffectIds.has(id))
        .map((id) => ({ id, kind: 'hover' }));
      validateMagicItemMechanics(
        {
          ...projectedMechanics,
          ...(siblingEffects.length === 0
            ? {}
            : {
                effects: [
                  ...(projectedMechanics?.effects ?? []),
                  ...siblingEffects,
                ],
              }),
        },
        `magic-item:${name}.mechanics`,
        () => {},
      );
    }
    expect(
      projectMagicItemCurses(named('Sword of Life Stealing')),
    ).toBeUndefined();
    expect(
      projectMagicItemCurses(named('Armor of Resistance')),
    ).toBeUndefined();
  });

  it('models reveal, attachment, doff, unattune, and curse-ending constraints', () => {
    expect(curse('Armor of Vulnerability')).toMatchObject({
      revealedBy: ['spell:identify', 'attunement'],
      endedBy: ['spell:remove-curse', 'similar magic'],
    });
    expect(states('Armor of Vulnerability')[0]).toMatchObject({
      onset: 'attune to the armor',
      endsOn: [{ trigger: 'targeted-by-spell:remove-curse-or-similar-magic' }],
      note: expect.stringContaining('Removing the armor does not end'),
    });
    expect(curse('Demon Armor')).toMatchObject({
      blocksDoff: true,
      endedBy: ['spell:remove-curse', 'similar magic'],
    });
    expect(curse('Orb of Dragonkind')).toMatchObject({ blocksUnattune: true });
  });

  it('models Oathbow as one live item-instance sworn enemy with distinct death and seventh-dawn replacement rules', () => {
    expect(
      (
        mechanics('Oathbow').operations as readonly Record<string, unknown>[]
      )[0],
    ).toMatchObject({
      id: 'm7-swear-enemy',
      activation: {
        cost: 'free',
        commandWord: true,
        trigger: 'make a ranged attack with the oathbow',
      },
    });
    expect(states('Oathbow')).toEqual([
      expect.objectContaining({
        id: 'm7-oathbow-sworn-enemy',
        exclusive: {
          scope: 'item-instance',
          group: 'oathbow-sworn-enemy',
          recast: 'blocked',
        },
        endsOn: [
          {
            trigger: 'sworn-enemy-dies',
            replacementAvailable: 'next-dawn',
          },
          {
            trigger: 'seventh-dawn-after-oath',
            replacementAvailable: 'immediate',
          },
        ],
        note: expect.stringContaining('live item-instance/character links'),
      }),
    ]);
  });

  it('models stacking sword wounds, all-wounds endings, and rest-only healing ownership', () => {
    expect(states('Sword of Wounding')).toEqual([
      expect.objectContaining({
        id: 'm7-sword-wound',
        stack: {
          counterId: 'sword-wounds',
          increment: 1,
          clears: 'all',
        },
        endsOn: [
          { trigger: 'successful-operation:m7-end-wounds-save' },
          { trigger: 'successful-operation:m7-treat-wounds' },
        ],
      }),
    ]);
    const effects = mechanics('Sword of Wounding').effects as readonly Record<
      string,
      unknown
    >[];
    expect(effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'm7-wounding-healing-suppression',
          kind: 'healing',
          mode: 'rest-only',
        }),
        expect.objectContaining({
          id: 'm7-wounding-recurring-damage',
          kind: 'recurringDamage',
          dice: '1d4',
          type: 'necrotic',
        }),
      ]),
    );
    const hooks = projectMagicItemCurses(named('Sword of Wounding'))
      ?.clauses.flatMap((entry) => entry.engineHooks ?? [])
      .map((entry) => entry.engine);
    expect(new Set(hooks)).toEqual(new Set(['F5', 'F6', 'F7', 'F9']));
  });

  it('models soul occupancy and orb enslavement without storing live soul or charm state in pack data', () => {
    expect(states('Ring of Mind Shielding')[0]).toMatchObject({
      onset: 'wearer dies while ring has no housed soul',
      exclusive: {
        scope: 'item-instance',
        group: 'ring-housed-soul',
        recast: 'blocked',
      },
    });
    expect(states('Orb of Dragonkind')[0]).toMatchObject({
      onset: 'fail the DC 15 Charisma control check',
      exclusive: {
        scope: 'item-instance',
        group: 'orb-controller-state',
        recast: 'replace',
      },
      note: expect.stringContaining('contextual GM adjudication'),
    });
    expect(JSON.stringify(curse('Ring of Mind Shielding'))).not.toContain(
      'soulId',
    );
    expect(JSON.stringify(curse('Orb of Dragonkind'))).not.toContain(
      'characterId',
    );
  });

  it('keeps Euryale, Donjon, and Void as three distinct persistent character-state definitions', () => {
    expect(states('Deck of Many Things').map((entry) => entry.id)).toEqual([
      'm7-deck-euryale-curse',
      'm7-deck-donjon-imprisonment',
      'm7-deck-void-soul-trap',
    ]);
    expect(states('Deck of Many Things')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'm7-deck-euryale-curse',
          endsOn: [
            { trigger: 'god-ends-curse' },
            { trigger: 'magic-of-the-fates-card' },
          ],
        }),
        expect.objectContaining({
          id: 'm7-deck-donjon-imprisonment',
          note: expect.stringContaining('Wish reveals'),
        }),
        expect.objectContaining({
          id: 'm7-deck-void-soul-trap',
          note: expect.stringContaining('cannot restore the soul'),
        }),
      ]),
    );
  });

  it('uses globally stable distinct clause, effect, operation, and state IDs', () => {
    const idsByKind = {
      clause: new Set<string>(),
      effect: new Set<string>(),
      operation: new Set<string>(),
      state: new Set<string>(),
    };
    for (const name of MAGIC_ITEM_CURSE_NAMES) {
      const projection = projectMagicItemCurses(named(name));
      const candidatesByKind = {
        clause: projection?.clauses.map((entry) => entry.id) ?? [],
        effect: (projection?.mechanics.effects ?? []).flatMap((entry) =>
          entry.id === undefined ? [] : [entry.id],
        ),
        operation:
          projection?.mechanics.operations?.map((entry) => entry.id) ?? [],
        state: states(name).map((entry) => entry.id as string),
      };
      for (const kind of Object.keys(idsByKind) as (keyof typeof idsByKind)[]) {
        for (const id of candidatesByKind[kind]) {
          expect(idsByKind[kind].has(id), `${kind}:${id}`).toBe(false);
          idsByKind[kind].add(id);
          expect(id).toMatch(/^m7-[a-z0-9]+(?:-[a-z0-9]+)*$/);
        }
      }
    }
    expect(
      Object.values(idsByKind).reduce((sum, ids) => sum + ids.size, 0),
    ).toBeGreaterThan(50);
  });

  it('resolves every canonical rules reference', () => {
    for (const ref of MAGIC_ITEM_CURSE_REFERENCES) {
      expect(recordKeys.has(ref), ref).toBe(true);
    }
  });

  it('fails loudly when any clause source anchor drifts', () => {
    const oathbow = named('Oathbow');
    expect(() =>
      projectMagicItemCurses({
        ...oathbow,
        description: oathbow.description.replace(
          'only one such sworn enemy at a time',
          'one sworn enemy at a time',
        ),
      }),
    ).toThrow(/expected source phrase.*only one such sworn enemy/);

    const sword = named('Sword of Wounding');
    expect(() =>
      projectMagicItemCurses({
        ...sword,
        description: sword.description.replace(
          'regained only through a short or long rest',
          'regained after resting',
        ),
      }),
    ).toThrow(/expected source phrase.*short or long rest/);
  });
});
