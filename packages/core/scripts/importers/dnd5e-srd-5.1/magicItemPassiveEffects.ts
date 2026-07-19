/**
 * Magic-item passive-modifier projection (eshyra-o9bd.18.7.7.5): the M2
 * ("passive character-rule modifiers") and M3 ("movement, senses & environmental
 * adaptation") clause families from
 * `docs/audits/dnd5e-srd-5.1-final/2026-07-06-o9bd-18-7-7-3-magic-item-mechanics-inventory.md`
 * §2/§4. Exact membership: the 23 M2 rows + 38 M3 rows (58 unique items, 3
 * tagged both) enumerated there.
 *
 * Split-owner rule: an item's description often carries clauses owned by
 * sibling beads (C1 charges/economies, C2 combat bonuses, M5 state machines,
 * M7 curses, M9 spell storage, M11 inter-item interactions). This module
 * extracts ONLY the M2/M3-tagged clauses for each item; other clause types on
 * the same record are intentionally left unmodeled here.
 *
 * Ioun Stone, Ring of Elemental Command, and Crystal Ball carry mutually
 * exclusive inline variants. `parseMagicItems` lifts all 20 named variants
 * into structured children; this module projects their M2/M3 clauses onto
 * those 21 children only, never onto the shared parent record.
 *
 * Each entry's extractor asserts the source phrase it depends on is present
 * (via `must`) so drift in a future re-import fails the import instead of
 * silently emitting stale data.
 */

import type { MagicItemEffect } from '../../../src/rules/magicItemMechanics.js';
import {
  aggregateMagicItemFamilyProjections,
  type ItemClauseExpectation,
  type MagicItemFamilyProjection,
} from './magicItemCompiler.js';
import { compact } from './mechanicsProjections.js';
import type { MagicItemExtraction, MagicItemVariant } from './types.js';

type Mechanics = Record<string, unknown>;

function must(
  text: string,
  pattern: RegExp,
  itemName: string,
): RegExpExecArray {
  const match = pattern.exec(text);
  if (match === null) {
    throw new Error(
      `magic-item M2/M3 projection: expected pattern ${pattern} not found in "${itemName}" description`,
    );
  }
  return match;
}

/** No M2/M3-tagged items remain deferred after inline variant structuring. */
export const MAGIC_ITEM_M2_M3_DEFERRED: ReadonlyMap<string, string> = new Map();

type Extractor = (text: string, itemName: string) => readonly MagicItemEffect[];

type VariantExtractor = (
  text: string,
  parentName: string,
  variantName: string,
) => readonly MagicItemEffect[];

const M2_DIRECT_NAMES = [
  'Amulet of Health',
  'Belt of Dwarvenkind',
  'Belt of Giant Strength',
  'Berserker Axe',
  'Bracers of Archery',
  'Demon Armor',
  'Elven Chain',
  'Gauntlets of Ogre Power',
  'Hammer of Thunderbolts',
  'Headband of Intellect',
  'Manual of Bodily Health',
  'Manual of Gainful Exercise',
  'Manual of Quickness of Action',
  'Periapt of Wound Closure',
  'Potion of Giant Strength',
  'Ring of Regeneration',
  'Robe of the Archmagi',
  'Sun Blade',
  'Tome of Clear Thought',
  'Tome of Leadership and Influence',
  'Tome of Understanding',
] as const;

const M3_DIRECT_NAMES = [
  'Boots of Speed',
  'Boots of Striding and Springing',
  'Boots of the Winterlands',
  'Broom of Flying',
  'Carpet of Flying',
  'Cloak of Arachnida',
  'Cloak of the Bat',
  'Cloak of the Manta Ray',
  'Dragon Scale Mail',
  'Gem of Seeing',
  'Gloves of Swimming and Climbing',
  'Goggles of Night',
  'Helm of Telepathy',
  'Horseshoes of a Zephyr',
  'Horseshoes of Speed',
  'Lantern of Revealing',
  'Necklace of Adaptation',
  'Potion of Climbing',
  'Potion of Flying',
  'Potion of Water Breathing',
  'Ring of Feather Falling',
  'Ring of Free Action',
  'Ring of Swimming',
  'Ring of Warmth',
  'Ring of Water Walking',
  'Ring of X-ray Vision',
  'Robe of Eyes',
  'Rod of Alertness',
  'Rod of Lordly Might',
  'Slippers of Spider Climbing',
  'Wand of Enemy Detection',
  'Wand of Secrets',
  'Winged Boots',
  'Wings of Flying',
] as const;

export const MAGIC_ITEM_M2_NAMES = Object.freeze([
  ...M2_DIRECT_NAMES,
  'Ioun Stone',
  'Ring of Elemental Command',
]);

export const MAGIC_ITEM_M3_NAMES = Object.freeze([
  'Belt of Dwarvenkind',
  ...M3_DIRECT_NAMES,
  'Ioun Stone',
  'Ring of Elemental Command',
  'Crystal Ball',
]);

const M2_DIRECT = new Set<string>(M2_DIRECT_NAMES);
const M3_DIRECT = new Set<string>(M3_DIRECT_NAMES);

function slug(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function effectTag(scope: string, effect: MagicItemEffect): 'M2' | 'M3' {
  if (scope === 'Belt of Dwarvenkind')
    return effect.kind === 'sense' ? 'M3' : 'M2';
  if (scope.startsWith('Ioun Stone::'))
    return scope === 'Ioun Stone::Sustenance' ? 'M3' : 'M2';
  if (scope.startsWith('Ring of Elemental Command::'))
    return effect.kind === 'proficiency' ? 'M2' : 'M3';
  if (scope.startsWith('Crystal Ball::')) return 'M3';
  if (M2_DIRECT.has(scope)) return 'M2';
  if (M3_DIRECT.has(scope)) return 'M3';
  throw new Error(`magic-item M2/M3 projection: no tag owner for ${scope}`);
}

function semanticEffectName(effect: MagicItemEffect): string {
  const value = effect as Record<string, unknown>;
  if (effect.kind === 'abilityScoreSet')
    return `${String(value.ability)}-score-set`;
  if (effect.kind === 'abilityScoreIncrease')
    return `${(value.abilities as string[]).join('-')}-score-increase`;
  if (effect.kind === 'proficiency')
    return `proficiency-${slug(String(value.grant))}`;
  if (effect.kind === 'sense') return `sense-${slug(String(value.sense))}`;
  if (effect.kind === 'speedSet') return `${String(value.mode)}-speed`;
  if (effect.kind === 'light') return `${String(value.level)}-light`;
  if (effect.kind === 'breathes')
    return value.anyEnvironment === true
      ? 'breathe-any-environment'
      : `breathe-${(value.environments as string[]).join('-')}`;
  return slug(effect.kind);
}

function identifyEffects(
  scope: string,
  effects: readonly MagicItemEffect[],
): {
  readonly effects: readonly MagicItemEffect[];
  readonly clauses: readonly ItemClauseExpectation[];
} {
  const ids = new Set<string>();
  const identified = effects.map((effect) => {
    const tag = effectTag(scope, effect);
    const id = `${tag.toLowerCase()}-${slug(scope)}-${semanticEffectName(effect)}`;
    if (ids.has(id))
      throw new Error(
        `magic-item M2/M3 projection: duplicate semantic effect id ${id}`,
      );
    ids.add(id);
    return compactEffect({ ...effect, id });
  });
  return {
    effects: identified,
    clauses: identified.map((effect) => ({
      id: effect.id as string,
      tag: effectTag(scope, effect),
      representation: { block: 'effects', effectId: effect.id as string },
    })),
  };
}

function compactEffect(effect: MagicItemEffect): MagicItemEffect {
  return compact({ ...effect }) as MagicItemEffect;
}

const abilityStone =
  (ability: string): VariantExtractor =>
  (text, parentName, variantName) => {
    must(
      text,
      new RegExp(
        `Your ${ability[0].toUpperCase()}${ability.slice(1)} score increases by 2, to a maximum of 20`,
      ),
      `${parentName} / ${variantName}`,
    );
    return [
      {
        kind: 'abilityScoreIncrease',
        abilities: [ability],
        amount: 2,
        newMaximum: 20,
      },
    ];
  };

const ELEMENTAL_UNLOCK =
  'after you help slay an elemental from the linked plane while attuned to the ring';

const MAGIC_ITEM_M2_M3_VARIANT_EXTRACTORS: ReadonlyMap<
  string,
  VariantExtractor
> = new Map([
  ['Ioun Stone::Agility', abilityStone('dexterity')],
  ['Ioun Stone::Fortitude', abilityStone('constitution')],
  ['Ioun Stone::Insight', abilityStone('wisdom')],
  ['Ioun Stone::Intellect', abilityStone('intelligence')],
  ['Ioun Stone::Leadership', abilityStone('charisma')],
  ['Ioun Stone::Strength', abilityStone('strength')],
  [
    'Ioun Stone::Mastery',
    (text, parentName, variantName) => {
      must(
        text,
        /proficiency bonus increases by 1 while this pale green prism orbits your head/,
        `${parentName} / ${variantName}`,
      );
      return [{ kind: 'proficiencyBonusIncrease', amount: 1 }];
    },
  ],
  [
    'Ioun Stone::Regeneration',
    (text, parentName, variantName) => {
      must(
        text,
        /regain 15 hit points at the end of each hour.+provided that you have at least 1 hit point/,
        `${parentName} / ${variantName}`,
      );
      return [
        {
          kind: 'regeneration',
          hitPoints: 15,
          timing: 'end-of-each-hour',
          condition: 'provided that you have at least 1 hit point',
        },
      ];
    },
  ],
  [
    'Ioun Stone::Sustenance',
    (text, parentName, variantName) => {
      must(
        text,
        /don’t need to eat or drink while this clear spindle orbits your head/,
        `${parentName} / ${variantName}`,
      );
      return [{ kind: 'sustenance' }];
    },
  ],
  [
    'Ring of Elemental Command::Ring of Air Elemental Command',
    (text, parentName, variantName) => {
      const scopedName = `${parentName} / ${variantName}`;
      must(
        text,
        /descend 60 feet per round and take no damage from falling/,
        scopedName,
      );
      must(text, /speak and understand Auran/, scopedName);
      must(
        text,
        /flying speed equal to your walking speed and can hover/,
        scopedName,
      );
      return [
        {
          kind: 'slowFall',
          descentFeetPerRound: 60,
          noFallingDamageOnLanding: true,
        },
        { kind: 'proficiency', grant: 'speak and understand Auran' },
        {
          kind: 'speedSet',
          mode: 'fly',
          value: 'walking-speed',
          hover: true,
          condition: ELEMENTAL_UNLOCK,
        },
      ];
    },
  ],
  [
    'Ring of Elemental Command::Ring of Earth Elemental Command',
    (text, parentName, variantName) => {
      const scopedName = `${parentName} / ${variantName}`;
      must(
        text,
        /difficult terrain that is composed of rubble, rocks, or dirt as if it were normal terrain/,
        scopedName,
      );
      must(text, /speak and understand Terran/, scopedName);
      must(
        text,
        /move through solid earth or rock as if those areas were difficult terrain/,
        scopedName,
      );
      must(
        text,
        /shunted out to the nearest unoccupied space you last occupied/,
        scopedName,
      );
      return [
        {
          kind: 'ignoreDifficultTerrain',
          terrain: ['rubble', 'rocks', 'dirt'],
        },
        { kind: 'proficiency', grant: 'speak and understand Terran' },
        {
          kind: 'earthGlide',
          condition: `${ELEMENTAL_UNLOCK}; if you end your turn in solid earth or rock, you are shunted to the nearest unoccupied space you last occupied`,
        },
      ];
    },
  ],
  [
    'Ring of Elemental Command::Ring of Fire Elemental Command',
    (text, parentName, variantName) => {
      must(
        text,
        /speak and understand Ignan/,
        `${parentName} / ${variantName}`,
      );
      return [{ kind: 'proficiency', grant: 'speak and understand Ignan' }];
    },
  ],
  [
    'Ring of Elemental Command::Ring of Water Elemental Command',
    (text, parentName, variantName) => {
      const scopedName = `${parentName} / ${variantName}`;
      must(
        text,
        /stand on and walk across liquid surfaces as if they were solid ground/,
        scopedName,
      );
      must(text, /speak and understand Aquan/, scopedName);
      must(
        text,
        /breathe underwater and have a swimming speed equal to your walking speed/,
        scopedName,
      );
      return [
        { kind: 'walkOnLiquids' },
        { kind: 'proficiency', grant: 'speak and understand Aquan' },
        {
          kind: 'breathes',
          environments: ['water'],
          condition: ELEMENTAL_UNLOCK,
        },
        {
          kind: 'speedSet',
          mode: 'swim',
          value: 'walking-speed',
          condition: ELEMENTAL_UNLOCK,
        },
      ];
    },
  ],
  [
    'Crystal Ball::Crystal Ball of True Seeing',
    (text, parentName, variantName) => {
      must(
        text,
        /While scrying with the crystal ball, you have truesight with a radius of 120 feet centered on the spell’s sensor/,
        `${parentName} / ${variantName}`,
      );
      return [
        {
          kind: 'sense',
          sense: 'truesight',
          rangeFeet: 120,
          condition: 'while scrying; centered on the spell’s sensor',
        },
      ];
    },
  ],
]);

const MAGIC_ITEM_M2_M3_EXTRACTORS: ReadonlyMap<string, Extractor> = new Map<
  string,
  Extractor
>([
  [
    'Amulet of Health',
    (text, name) => {
      must(text, /Constitution score is 19 while you wear/, name);
      return [{ kind: 'abilityScoreSet', ability: 'constitution', value: 19 }];
    },
  ],
  [
    'Belt of Dwarvenkind',
    (text, name) => {
      must(text, /Constitution score increases by 2, to a maximum of 20/, name);
      must(
        text,
        /If you aren’t a dwarf, you gain the following additional benefits/,
        name,
      );
      must(text, /darkvision out to a range of 60 feet/, name);
      must(text, /speak, read, and write Dwarvish/, name);
      return [
        {
          kind: 'abilityScoreIncrease',
          abilities: ['constitution'],
          amount: 2,
          newMaximum: 20,
        },
        {
          kind: 'proficiency',
          grant: 'speak, read, and write Dwarvish',
          condition: 'if you aren’t a dwarf',
        },
        {
          kind: 'sense',
          sense: 'darkvision',
          rangeFeet: 60,
          condition: 'if you aren’t a dwarf',
        },
      ];
    },
  ],
  [
    'Belt of Giant Strength',
    (text, name) => {
      must(text, /Strength score changes to a score granted by the belt/, name);
      return [
        {
          kind: 'abilityScoreSet',
          ability: 'strength',
          tableRef: 'table:belt-of-giant-strength',
        },
      ];
    },
  ],
  [
    'Berserker Axe',
    (text, name) => {
      must(
        text,
        /hit point maximum increases by 1 for each level you have attained/,
        name,
      );
      return [{ kind: 'hitPointMaximumIncrease', perLevel: 1 }];
    },
  ],
  [
    'Bracers of Archery',
    (text, name) => {
      must(text, /proficiency with the longbow and shortbow/, name);
      return [{ kind: 'proficiency', grant: 'longbow and shortbow' }];
    },
  ],
  [
    'Demon Armor',
    (text, name) => {
      must(text, /understand and speak Abyssal/, name);
      return [{ kind: 'proficiency', grant: 'understand and speak Abyssal' }];
    },
  ],
  [
    'Elven Chain',
    (text, name) => {
      must(
        text,
        /considered proficient with this armor even if you lack proficiency with medium armor/,
        name,
      );
      return [
        {
          kind: 'proficiency',
          grant: 'this armor',
          condition:
            'considered proficient even if you lack proficiency with medium armor',
        },
      ];
    },
  ],
  [
    'Gauntlets of Ogre Power',
    (text, name) => {
      must(text, /Strength score is 19 while you wear/, name);
      return [{ kind: 'abilityScoreSet', ability: 'strength', value: 19 }];
    },
  ],
  [
    'Hammer of Thunderbolts',
    (text, name) => {
      must(
        text,
        /While you are attuned to this weapon and holding it, your Strength score increases by 4 and can exceed 20, but not 30/,
        name,
      );
      return [
        {
          kind: 'abilityScoreIncrease',
          abilities: ['strength'],
          amount: 4,
          newMaximum: 30,
          condition: 'while attuned to this weapon and holding it',
        },
      ];
    },
  ],
  [
    'Headband of Intellect',
    (text, name) => {
      must(text, /Intelligence score is 19 while you wear/, name);
      return [{ kind: 'abilityScoreSet', ability: 'intelligence', value: 19 }];
    },
  ],
  [
    'Manual of Bodily Health',
    (text, name) => {
      must(
        text,
        /Constitution score increases by 2, as does your maximum for that score/,
        name,
      );
      return [
        {
          kind: 'abilityScoreIncrease',
          abilities: ['constitution'],
          amount: 2,
          alsoIncreasesMaximum: true,
        },
      ];
    },
  ],
  [
    'Manual of Gainful Exercise',
    (text, name) => {
      must(
        text,
        /Strength score increases by 2, as does your maximum for that score/,
        name,
      );
      return [
        {
          kind: 'abilityScoreIncrease',
          abilities: ['strength'],
          amount: 2,
          alsoIncreasesMaximum: true,
        },
      ];
    },
  ],
  [
    'Manual of Quickness of Action',
    (text, name) => {
      must(
        text,
        /Dexterity score increases by 2, as does your maximum for that score/,
        name,
      );
      return [
        {
          kind: 'abilityScoreIncrease',
          abilities: ['dexterity'],
          amount: 2,
          alsoIncreasesMaximum: true,
        },
      ];
    },
  ],
  [
    'Periapt of Wound Closure',
    (text, name) => {
      must(
        text,
        /stabilize whenever you are dying at the start of your turn/,
        name,
      );
      must(
        text,
        /roll a Hit Die to regain hit points, double the number of hit points it restores/,
        name,
      );
      return [
        {
          kind: 'stabilize',
          trigger: 'start of your turn while dying',
        },
        {
          kind: 'healingMultiplier',
          multiplier: 2,
          appliesTo: 'hit-dice-spent-to-regain-hit-points',
        },
      ];
    },
  ],
  [
    'Potion of Giant Strength',
    (text, name) => {
      must(text, /Strength score changes for 1 hour/, name);
      return [
        {
          kind: 'abilityScoreSet',
          ability: 'strength',
          tableRef: 'table:potion-of-giant-strength',
          condition: 'for 1 hour',
        },
      ];
    },
  ],
  [
    'Ring of Regeneration',
    (text, name) => {
      must(text, /regain 1d6 hit points every 10 minutes/, name);
      must(text, /missing part to regrow.+after 1d6 \+ 1 days/, name);
      return [
        {
          kind: 'regeneration',
          hitDice: '1d6',
          timing: 'every-10-minutes',
          condition: 'if it has at least 1 hit point',
          limbRegrowthDays: '1d6 + 1',
          limbRegrowthCondition:
            'if you have at least 1 hit point the whole time',
        },
      ];
    },
  ],
  [
    'Robe of the Archmagi',
    (text, name) => {
      must(text, /base Armor Class is 15 \+ your Dexterity modifier/, name);
      return [
        {
          kind: 'acFormula',
          base: 15,
          abilities: ['dexterity'],
          condition: 'if you aren’t wearing armor',
        },
      ];
    },
  ],
  [
    'Sun Blade',
    (text, name) => {
      must(
        text,
        /proficient with shortswords or longswords, you are proficient with the sun blade/,
        name,
      );
      return [
        {
          kind: 'proficiency',
          grant: 'the sun blade',
          condition: 'if you are proficient with shortswords or longswords',
        },
      ];
    },
  ],
  [
    'Tome of Clear Thought',
    (text, name) => {
      must(
        text,
        /Intelligence score increases by 2, as does your maximum for that score/,
        name,
      );
      return [
        {
          kind: 'abilityScoreIncrease',
          abilities: ['intelligence'],
          amount: 2,
          alsoIncreasesMaximum: true,
        },
      ];
    },
  ],
  [
    'Tome of Leadership and Influence',
    (text, name) => {
      must(
        text,
        /Charisma score increases by 2, as does your maximum for that score/,
        name,
      );
      return [
        {
          kind: 'abilityScoreIncrease',
          abilities: ['charisma'],
          amount: 2,
          alsoIncreasesMaximum: true,
        },
      ];
    },
  ],
  [
    'Tome of Understanding',
    (text, name) => {
      must(
        text,
        /Wisdom score increases by 2, as does your maximum for that score/,
        name,
      );
      return [
        {
          kind: 'abilityScoreIncrease',
          abilities: ['wisdom'],
          amount: 2,
          alsoIncreasesMaximum: true,
        },
      ];
    },
  ],
  // --- M3: movement, senses & environmental adaptation ---
  [
    'Boots of Speed',
    (text, name) => {
      must(text, /boots double your walking speed/, name);
      return [{ kind: 'speedMultiplier', multiplier: 2 }];
    },
  ],
  [
    'Boots of Striding and Springing',
    (text, name) => {
      must(
        text,
        /walking speed becomes 30 feet, unless your walking speed is higher/,
        name,
      );
      must(
        text,
        /speed isn’t reduced if you are encumbered or wearing heavy armor/,
        name,
      );
      must(text, /jump three times the normal distance/, name);
      must(
        text,
        /can’t jump farther than your remaining movement would allow/,
        name,
      );
      return [
        { kind: 'speedSet', mode: 'walk', value: 30, floor: true },
        {
          kind: 'ignoreMovementRestriction',
          source: 'being encumbered or wearing heavy armor',
        },
        {
          kind: 'jumpDistanceMultiplier',
          multiplier: 3,
          condition:
            'you can’t jump farther than your remaining movement would allow',
        },
      ];
    },
  ],
  [
    'Boots of the Winterlands',
    (text, name) => {
      must(text, /ignore difficult terrain created by ice or snow/, name);
      must(
        text,
        /tolerate temperatures as low as −50 degrees Fahrenheit/,
        name,
      );
      must(
        text,
        /wear heavy clothes, you can tolerate temperatures as low as −100 degrees Fahrenheit/,
        name,
      );
      return [
        { kind: 'ignoreDifficultTerrain', terrain: ['ice', 'snow'] },
        {
          kind: 'temperatureTolerance',
          minimumFahrenheit: -50,
          withHeavyClothesMinimumFahrenheit: -100,
        },
      ];
    },
  ],
  [
    'Broom of Flying',
    (text, name) => {
      must(text, /flying speed of 50 feet/, name);
      must(text, /can carry up to 400 pounds/, name);
      must(
        text,
        /flying speed becomes 30 feet while carrying over 200 pounds/,
        name,
      );
      return [
        {
          kind: 'speedSet',
          mode: 'fly',
          value: 50,
          weightCapacity: {
            maximumPounds: 400,
            reducedValue: 30,
            reducedAboveWeightPounds: 200,
          },
        },
      ];
    },
  ],
  [
    'Carpet of Flying',
    (text, name) => {
      must(text, /carry up to twice the weight shown on the table/, name);
      must(
        text,
        /flies at half speed if it carries more than its normal capacity/,
        name,
      );
      return [
        {
          kind: 'speedSet',
          mode: 'fly',
          valueTableRef: 'table:carpet-of-flying',
        },
        {
          kind: 'speedMultiplier',
          multiplier: 0.5,
          threshold: { tableRef: 'table:carpet-of-flying', multiplier: 1 },
          maximumCapacity: {
            tableRef: 'table:carpet-of-flying',
            multiplier: 2,
          },
        },
      ];
    },
  ],
  [
    'Cloak of Arachnida',
    (text, name) => {
      must(text, /climbing speed equal to your walking speed/, name);
      must(
        text,
        /move up, down, and across vertical surfaces and upside down along ceilings/,
        name,
      );
      must(text, /can’t be caught in webs of any sort/, name);
      must(text, /move through webs as if they were difficult terrain/, name);
      return [
        { kind: 'speedSet', mode: 'climb', value: 'walking-speed' },
        { kind: 'climbAnywhere' },
        { kind: 'immunity', to: 'being caught in webs of any sort' },
        {
          kind: 'movementCostMultiplier',
          feetPerFoot: 2,
          terrain: ['webs'],
        },
      ];
    },
  ],
  [
    'Cloak of the Bat',
    (text, name) => {
      must(text, /use it to fly at a speed of 40 feet/, name);
      return [
        {
          kind: 'speedSet',
          mode: 'fly',
          value: 40,
          condition:
            'only in dim light or darkness, while gripping the cloak’s edges with both hands; ends if you stop gripping or leave dim light/darkness',
        },
      ];
    },
  ],
  [
    'Cloak of the Manta Ray',
    (text, name) => {
      must(
        text,
        /wearing this cloak with its hood up, you can breathe underwater, and you have a swimming speed of 60 feet/,
        name,
      );
      return [
        {
          kind: 'breathes',
          environments: ['water'],
          condition: 'while wearing the cloak with its hood up',
        },
        {
          kind: 'speedSet',
          mode: 'swim',
          value: 60,
          condition: 'while wearing the cloak with its hood up',
        },
      ];
    },
  ],
  [
    'Dragon Scale Mail',
    (text, name) => {
      must(
        text,
        /discern the distance and direction to the closest dragon within 30 miles/,
        name,
      );
      return [
        {
          kind: 'sense',
          sense: 'nearest-dragon-of-matching-type',
          rangeMiles: 30,
          condition: 'as an action; usable once per dawn',
        },
      ];
    },
  ],
  [
    'Gem of Seeing',
    (text, name) => {
      must(
        text,
        /For the next 10 minutes, you have truesight out to 120 feet when you peer through the gem/,
        name,
      );
      return [
        {
          kind: 'sense',
          sense: 'truesight',
          rangeFeet: 120,
          durationMinutes: 10,
          condition: 'while peering through the gem',
        },
      ];
    },
  ],
  [
    'Gloves of Swimming and Climbing',
    (text, name) => {
      must(text, /climbing and swimming don’t cost you extra movement/, name);
      return [
        { kind: 'climbWithoutExtraMovement' },
        { kind: 'swimWithoutExtraMovement' },
      ];
    },
  ],
  [
    'Goggles of Night',
    (text, name) => {
      must(text, /darkvision out to a range of 60 feet/, name);
      must(
        text,
        /already have darkvision, wearing the goggles increases its range by 60 feet/,
        name,
      );
      return [
        {
          kind: 'sense',
          sense: 'darkvision',
          rangeFeet: 60,
          bonusRangeFeetIfAlreadyHasSense: 60,
        },
      ];
    },
  ],
  [
    'Helm of Telepathy',
    (text, name) => {
      must(
        text,
        /use a bonus action to send a telepathic message to a creature you are focused on/,
        name,
      );
      return [
        {
          kind: 'telepathicRelay',
          requires: 'concentrating on the helm’s detect thoughts',
        },
      ];
    },
  ],
  [
    'Horseshoes of a Zephyr',
    (text, name) => {
      must(text, /floating 4 inches above the ground/, name);
      must(text, /cross or stand above nonsolid or unstable surfaces/, name);
      must(text, /leaves no tracks/, name);
      must(text, /ignores difficult terrain/, name);
      must(
        text,
        /move at normal speed for up to 12 hours a day without suffering exhaustion from a forced march/,
        name,
      );
      const allFourShoesAffixed =
        'requires all four horseshoes affixed to the hooves of a horse or similar creature';
      return [
        { kind: 'hover', heightInches: 4, condition: allFourShoesAffixed },
        {
          kind: 'walkOnLiquids',
          surfaces: 'nonsolid or unstable surfaces, such as water or lava',
          condition: allFourShoesAffixed,
        },
        { kind: 'leavesNoTracks', condition: allFourShoesAffixed },
        {
          kind: 'ignoreDifficultTerrain',
          terrain: ['all'],
          condition: allFourShoesAffixed,
        },
        {
          kind: 'immunity',
          to: 'exhaustion from a forced march',
          condition: `${allFourShoesAffixed}; for up to 12 hours per day`,
        },
      ];
    },
  ],
  [
    'Horseshoes of Speed',
    (text, name) => {
      must(text, /increase the creature’s walking speed by 30 feet/, name);
      return [
        {
          kind: 'speedBonus',
          amountFeet: 30,
          condition:
            'requires all four horseshoes affixed to the hooves of a horse or similar creature',
        },
      ];
    },
  ],
  [
    'Lantern of Revealing',
    (text, name) => {
      must(
        text,
        /burns for 6 hours on 1 pint of oil, shedding bright light in a 30-foot radius and dim light for an additional 30 feet/,
        name,
      );
      must(
        text,
        /Invisible creatures and objects are visible as long as they are in the lantern’s bright light/,
        name,
      );
      // Tolerates the known line-break dehyphenation artifact ("5- foot"
      // instead of "5-foot"; tracked separately under eshyra-o9bd.18.8) —
      // this extractor is not the place to fix that class of bug.
      must(
        text,
        /lower the hood, reducing the light to dim light in a 5-\s*foot radius/,
        name,
      );
      return [
        {
          kind: 'light',
          level: 'bright',
          radiusFeet: 30,
          dimAdditionalFeet: 30,
          condition: 'while lit; burns for 6 hours per pint of oil',
        },
        {
          kind: 'light',
          level: 'dim',
          radiusFeet: 5,
          condition: 'hood lowered (an action)',
        },
        {
          kind: 'sense',
          sense: 'reveal-invisible-in-bright-light',
          condition:
            'creatures/objects in the lantern’s bright light are visible; lowering the hood (an action) removes the bright light, so the reveal does not apply while the hood is down',
        },
      ];
    },
  ],
  [
    'Necklace of Adaptation',
    (text, name) => {
      must(text, /breathe normally in any environment/, name);
      return [{ kind: 'breathes', anyEnvironment: true }];
    },
  ],
  [
    'Potion of Climbing',
    (text, name) => {
      must(text, /climbing speed equal to your walking speed for 1 hour/, name);
      return [
        {
          kind: 'speedSet',
          mode: 'climb',
          value: 'walking-speed',
          condition: 'for 1 hour after drinking',
        },
      ];
    },
  ],
  [
    'Potion of Flying',
    (text, name) => {
      must(
        text,
        /flying speed equal to your walking speed for 1 hour and can hover/,
        name,
      );
      return [
        {
          kind: 'speedSet',
          mode: 'fly',
          value: 'walking-speed',
          hover: true,
          condition:
            'for 1 hour; if still aloft when the potion wears off, you fall unless you have another means of staying aloft',
        },
      ];
    },
  ],
  [
    'Potion of Water Breathing',
    (text, name) => {
      must(
        text,
        /breathe underwater for 1 hour after drinking this potion/,
        name,
      );
      return [
        {
          kind: 'breathes',
          environments: ['water'],
          condition: 'for 1 hour after drinking',
        },
      ];
    },
  ],
  [
    'Ring of Feather Falling',
    (text, name) => {
      must(
        text,
        /descend 60 feet per round and take no damage from falling/,
        name,
      );
      return [
        {
          kind: 'slowFall',
          descentFeetPerRound: 60,
          noFallingDamageOnLanding: true,
        },
      ];
    },
  ],
  [
    'Ring of Free Action',
    (text, name) => {
      must(text, /difficult terrain doesn’t cost you extra movement/, name);
      return [{ kind: 'ignoreDifficultTerrain', terrain: ['all'] }];
    },
  ],
  [
    'Ring of Swimming',
    (text, name) => {
      must(text, /swimming speed of 40 feet while wearing this ring/, name);
      return [{ kind: 'speedSet', mode: 'swim', value: 40 }];
    },
  ],
  [
    'Ring of Warmth',
    (text, name) => {
      must(
        text,
        /unharmed by temperatures as low as −50 degrees Fahrenheit/,
        name,
      );
      return [{ kind: 'temperatureTolerance', minimumFahrenheit: -50 }];
    },
  ],
  [
    'Ring of Water Walking',
    (text, name) => {
      must(
        text,
        /stand on and move across any liquid surface as if it were solid ground/,
        name,
      );
      return [{ kind: 'walkOnLiquids' }];
    },
  ],
  [
    'Ring of X-ray Vision',
    (text, name) => {
      must(text, /see into and through solid matter for 1 minute/, name);
      must(text, /radius of 30 feet/, name);
      return [
        {
          kind: 'sense',
          sense: 'x-ray-vision',
          rangeFeet: 30,
          durationMinutes: 1,
          detects:
            'penetrates up to 1 foot of stone, 1 inch of common metal, or up to 3 feet of wood or dirt; blocked by thicker substances or a thin sheet of lead',
        },
      ];
    },
  ],
  [
    'Robe of Eyes',
    (text, name) => {
      must(text, /lets you see in all directions/, name);
      must(text, /darkvision out to a range of 120 feet/, name);
      must(
        text,
        /see invisible creatures and objects, as well as see into the Ethereal Plane, out to a range of 120 feet/,
        name,
      );
      return [
        { kind: 'sense', sense: 'all-around-vision' },
        { kind: 'sense', sense: 'darkvision', rangeFeet: 120 },
        {
          kind: 'sense',
          sense: 'see-invisible-and-ethereal',
          rangeFeet: 120,
        },
      ];
    },
  ],
  [
    'Rod of Alertness',
    (text, name) => {
      must(
        text,
        /sense the location of any invisible hostile creature that is also in the bright light/,
        name,
      );
      return [
        {
          kind: 'sense',
          sense: 'invisible-hostile-location',
          rangeFeet: 60,
          condition:
            'while standing in the planted rod’s bright light (10-minute duration, once per dawn)',
        },
      ];
    },
  ],
  [
    'Rod of Lordly Might',
    (text, name) => {
      must(
        text,
        /gives you knowledge of your approximate depth beneath the ground or your height above it/,
        name,
      );
      must(text, /indicates magnetic north/, name);
      must(
        text,
        /Nothing happens if this function of the rod is used in a location that has no magnetic north/,
        name,
      );
      return [
        {
          kind: 'sense',
          sense: 'magnetic-north-and-depth',
          condition:
            'the magnetic-north function does nothing in a location with no magnetic north',
        },
      ];
    },
  ],
  [
    'Slippers of Spider Climbing',
    (text, name) => {
      must(
        text,
        /move up, down, and across vertical surfaces and upside down along ceilings/,
        name,
      );
      must(text, /climbing speed equal to your walking speed/, name);
      must(
        text,
        /don’t allow you to move this way on a slippery surface/,
        name,
      );
      const notOnSlipperySurfaces =
        'does not work on a slippery surface, such as one covered by ice or oil';
      return [
        {
          kind: 'speedSet',
          mode: 'climb',
          value: 'walking-speed',
          condition: notOnSlipperySurfaces,
        },
        {
          kind: 'climbAnywhere',
          condition: notOnSlipperySurfaces,
        },
      ];
    },
  ],
  [
    'Wand of Enemy Detection',
    (text, name) => {
      must(
        text,
        /know the direction of the nearest creature hostile to you within 60 feet/,
        name,
      );
      must(
        text,
        /sense the presence of hostile creatures that are ethereal, invisible, disguised, or hidden/,
        name,
      );
      must(text, /effect ends if you stop holding the wand/, name);
      return [
        {
          kind: 'sense',
          sense: 'nearest-hostile-direction',
          rangeFeet: 60,
          durationMinutes: 1,
          detects:
            'ethereal, invisible, disguised, or hidden hostile creatures, as well as those in plain sight (direction only, not distance)',
          condition: 'ends if you stop holding the wand',
        },
      ];
    },
  ],
  [
    'Wand of Secrets',
    (text, name) => {
      must(
        text,
        /secret door or trap is within 30 feet of you, the wand pulses and points at the one nearest to you/,
        name,
      );
      return [
        {
          kind: 'sense',
          sense: 'nearest-secret-door-or-trap',
          rangeFeet: 30,
        },
      ];
    },
  ],
  [
    'Winged Boots',
    (text, name) => {
      must(text, /flying speed equal to your walking speed/, name);
      must(text, /descend at a rate of 30 feet per round until you land/, name);
      return [
        { kind: 'speedSet', mode: 'fly', value: 'walking-speed' },
        {
          kind: 'slowFall',
          descentFeetPerRound: 30,
          condition:
            'if still flying when the boots’ flight duration expires, until you land',
        },
      ];
    },
  ],
  [
    'Wings of Flying',
    (text, name) => {
      must(text, /wings give you a flying speed of 60 feet/, name);
      return [
        {
          kind: 'speedSet',
          mode: 'fly',
          value: 60,
          condition:
            'for 1 hour or until the command word is repeated; a 1d12-hour cooldown applies afterward',
        },
      ];
    },
  ],
]);

/**
 * Projects the M2/M3 passive-modifier clauses for one magic item, or
 * `undefined` when the item is outside the exact M2/M3 membership (or is a
 * tracked deferral — see `MAGIC_ITEM_M2_M3_DEFERRED`).
 */
export function projectMagicItemPassiveMechanics(
  item: MagicItemExtraction,
): MagicItemFamilyProjection | undefined {
  const extractor = MAGIC_ITEM_M2_M3_EXTRACTORS.get(item.name);
  if (extractor === undefined) return undefined;
  const effects = extractor(item.description, item.name);
  if (effects.length === 0) return undefined;
  const identified = identifyEffects(item.name, effects);
  return {
    family: 'M2-M3-passives',
    mechanics: compact({
      effects: identified.effects,
    }),
    clauses: identified.clauses,
  };
}

export function deriveMagicItemMechanics(
  item: MagicItemExtraction,
): Mechanics | undefined {
  const projection = projectMagicItemPassiveMechanics(item);
  if (projection === undefined) return undefined;
  return aggregateMagicItemFamilyProjections([projection]).mechanics as
    | Mechanics
    | undefined;
}

/**
 * Projects M2/M3 effects for a structured child variant. An unlisted variant
 * has no M2/M3-owned clause (its other mechanics remain with sibling owners).
 */
export function projectMagicItemPassiveVariantMechanics(
  parentName: string,
  variant: MagicItemVariant,
): MagicItemFamilyProjection | undefined {
  const extractor = MAGIC_ITEM_M2_M3_VARIANT_EXTRACTORS.get(
    `${parentName}::${variant.name}`,
  );
  if (extractor === undefined) return undefined;
  const effects = extractor(variant.text, parentName, variant.name);
  if (effects.length === 0) return undefined;
  const identified = identifyEffects(`${parentName}::${variant.name}`, effects);
  return {
    family: 'M2-M3-passives',
    mechanics: compact({
      effects: identified.effects,
    }),
    clauses: identified.clauses,
  };
}

export function deriveMagicItemVariantMechanics(
  parentName: string,
  variant: MagicItemVariant,
): Mechanics | undefined {
  const projection = projectMagicItemPassiveVariantMechanics(
    parentName,
    variant,
  );
  if (projection === undefined) return undefined;
  return aggregateMagicItemFamilyProjections([projection]).mechanics as
    | Mechanics
    | undefined;
}
