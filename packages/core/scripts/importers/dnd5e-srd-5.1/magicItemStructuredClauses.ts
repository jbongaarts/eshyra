import type { RulesRecord } from '../../../src/rules/types.js';
import type {
  ItemClauseExpectation,
  MagicItemFamilyProjection,
} from './magicItemCompiler.js';
import type { MagicItemExtraction } from './types.js';

/**
 * Exact S-profile from the reviewed 240-item inventory. Values are the
 * already-emitted structured references that constitute the clause evidence.
 */
export const MAGIC_ITEM_STRUCTURED_TABLE_REFS = Object.freeze(
  new Map<string, readonly string[]>([
    ['Apparatus of the Crab', ['table:apparatus-of-the-crab-levers']],
    ['Armor of Resistance', ['table:armor-of-resistance']],
    ['Bag of Beans', ['table:bag-of-beans']],
    [
      'Bag of Tricks',
      [
        'table:gray-bag-of-tricks',
        'table:rust-bag-of-tricks',
        'table:tan-bag-of-tricks',
      ],
    ],
    ['Belt of Giant Strength', ['table:belt-of-giant-strength']],
    ['Carpet of Flying', ['table:carpet-of-flying']],
    [
      'Cube of Force',
      ['table:cube-of-force-charges-lost', 'table:cube-of-force-faces'],
    ],
    ['Deck of Illusions', ['table:deck-of-illusions']],
    ['Deck of Many Things', ['table:deck-of-many-things']],
    ['Dragon Scale Mail', ['table:dragon-scale-mail']],
    ['Efreeti Bottle', ['table:efreeti-bottle']],
    ['Elemental Gem', ['table:elemental-gem']],
    ['Feather Token', ['table:feather-token']],
    ['Horn of Valhalla', ['table:horn-of-valhalla']],
    ['Iron Flask', ['table:iron-flask']],
    ['Manual of Golems', ['table:manual-of-golems']],
    ['Necklace of Prayer Beads', ['table:necklace-of-prayer-beads']],
    ['Potion of Giant Strength', ['table:potion-of-giant-strength']],
    ['Potion of Healing', ['table:potions-of-healing']],
    ['Potion of Resistance', ['table:potion-of-resistance']],
    ['Ring of Resistance', ['table:ring-of-resistance']],
    ['Ring of Shooting Stars', ['table:ring-of-shooting-stars']],
    ['Robe of Useful Items', ['table:robe-of-useful-items']],
    ['Spell Scroll', ['table:spell-scroll']],
    ['Sphere of Annihilation', ['table:sphere-of-annihilation']],
    ['Staff of Power', ['table:staff-of-power']],
    ['Staff of the Magi', ['table:staff-of-the-magi']],
    ['Wand of Wonder', ['table:wand-of-wonder']],
  ]),
);

export const MAGIC_ITEM_STRUCTURED_ATTUNEMENT_REQUIREMENTS = Object.freeze(
  new Map<string, string>([
    ['Dwarven Thrower', 'by a dwarf'],
    ['Holy Avenger', 'by a paladin'],
    ['Necklace of Prayer Beads', 'by a cleric, druid, or paladin'],
    ['Pearl of Power', 'by a spellcaster'],
    ['Ring of Shooting Stars', 'outdoors at night'],
    ['Robe of the Archmagi', 'by a sorcerer, warlock, or wizard'],
    [
      'Staff of Charming',
      'by a bard, cleric, druid, sorcerer, warlock, or wizard',
    ],
    ['Staff of Fire', 'by a druid, sorcerer, warlock, or wizard'],
    ['Staff of Frost', 'by a druid, sorcerer, warlock, or wizard'],
    ['Staff of Healing', 'by a bard, cleric, or druid'],
    ['Staff of Power', 'by a sorcerer, warlock, or wizard'],
    [
      'Staff of Swarming Insects',
      'by a bard, cleric, druid, sorcerer, warlock, or wizard',
    ],
    ['Staff of the Magi', 'by a sorcerer, warlock, or wizard'],
    ['Staff of the Python', 'by a cleric, druid, or warlock'],
    ['Staff of the Woodlands', 'by a druid'],
    ['Staff of Withering', 'by a cleric, druid, or warlock'],
    ['Talisman of Pure Good', 'by a creature of good alignment'],
    ['Talisman of Ultimate Evil', 'by a creature of evil alignment'],
    ['Wand of Binding', 'by a spellcaster'],
    ['Wand of Fireballs', 'by a spellcaster'],
    ['Wand of Lightning Bolts', 'by a spellcaster'],
    ['Wand of Paralysis', 'by a spellcaster'],
    ['Wand of Polymorph', 'by a spellcaster'],
    ['Wand of the War Mage, +1, +2, or +3', 'by a spellcaster'],
    ['Wand of Web', 'by a spellcaster'],
    ['Wand of Wonder', 'by a spellcaster'],
  ]),
);

const STAT_BLOCK_REFS = new Map<string, readonly string[]>([
  ['Deck of Many Things', ['stat-block:avatar-of-death']],
  ['Figurine of Wondrous Power', ['stat-block:giant-fly']],
]);

const FIGURINE_VARIANTS = [
  'Bronze Griffon',
  'Ebony Fly',
  'Golden Lions',
  'Ivory Goats',
  'Marble Elephant',
  'Obsidian Steed',
  'Onyx Dog',
  'Serpentine Owl',
  'Silver Raven',
] as const;

export const MAGIC_ITEM_STRUCTURED_NAMES = Object.freeze(
  [
    ...new Set([
      ...MAGIC_ITEM_STRUCTURED_TABLE_REFS.keys(),
      ...MAGIC_ITEM_STRUCTURED_ATTUNEMENT_REQUIREMENTS.keys(),
      ...STAT_BLOCK_REFS.keys(),
      'Figurine of Wondrous Power',
    ]),
  ].sort(),
);

function clause(
  itemName: string,
  field: string,
  suffix: string,
  ref?: string,
): ItemClauseExpectation {
  return {
    id: `S:${itemName}:${suffix}`,
    tag: 'S',
    representation: {
      block: 'structuredField',
      field,
      ...(ref === undefined ? {} : { ref }),
    },
  };
}

/** Project reviewed S evidence from the final, table-linked record. */
export function projectMagicItemStructuredClauses(
  record: RulesRecord,
): MagicItemFamilyProjection | undefined {
  if (!MAGIC_ITEM_STRUCTURED_NAMES.includes(record.name)) return undefined;
  const clauses: ItemClauseExpectation[] = [];
  for (const ref of MAGIC_ITEM_STRUCTURED_TABLE_REFS.get(record.name) ?? []) {
    clauses.push(clause(record.name, 'tableRefs', `table:${ref}`, ref));
  }
  const attunement = MAGIC_ITEM_STRUCTURED_ATTUNEMENT_REQUIREMENTS.get(
    record.name,
  );
  if (attunement !== undefined) {
    clauses.push(clause(record.name, 'requiresAttunement', 'requires'));
    clauses.push(
      clause(
        record.name,
        'attunementRequirement',
        `requirement:${attunement}`,
        attunement,
      ),
    );
  }
  for (const ref of STAT_BLOCK_REFS.get(record.name) ?? []) {
    clauses.push(
      clause(record.name, 'statBlockRefs', `stat-block:${ref}`, ref),
    );
  }
  if (record.name === 'Figurine of Wondrous Power') {
    for (const variant of FIGURINE_VARIANTS) {
      clauses.push(
        clause(record.name, 'variants', `variant:${variant}`, variant),
      );
    }
  }
  return { family: 's-existing-structure', mechanics: {}, clauses };
}

const ORB_RANDOM_PROPERTIES_PHRASE =
  'Random Properties. An Orb of Dragonkind has the following random properties:';

/** The inventory's sole source-level design block. */
export function projectMagicItemDesignBlockedClause(
  item: MagicItemExtraction,
): MagicItemFamilyProjection | undefined {
  if (item.name !== 'Orb of Dragonkind') return undefined;
  if (!item.description.includes(ORB_RANDOM_PROPERTIES_PHRASE)) {
    throw new Error(
      `magic-item DB projection: expected source phrase ${JSON.stringify(ORB_RANDOM_PROPERTIES_PHRASE)} not found in ${JSON.stringify(item.name)}`,
    );
  }
  return {
    family: 'db-source-gaps',
    mechanics: {},
    clauses: [
      {
        id: 'DB:Orb of Dragonkind:artifact-random-properties',
        tag: 'DB',
        representation: {
          designBlocked: true,
          reason:
            'The SRD 5.1 pack contains no minor/major beneficial or detrimental artifact-property tables; these properties require GM-supplied content.',
        },
      },
    ],
  };
}
