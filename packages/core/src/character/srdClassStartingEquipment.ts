/**
 * Source-backed class starting-equipment oracle (eshyra-b69j.12.3).
 *
 * Character creation now reads generated pack metadata. These authored,
 * SRD-cited constants remain only as regression oracles so tests can assert that
 * importer-generated `startingEquipment.entries` stay faithful to the source
 * prose. Runtime code must not source starting equipment from this file.
 */

import {
  type StartingEquipmentGrant as ResolvedEquipmentGrant,
  resolveStartingEquipmentGrants,
} from './srdStartingEquipmentGrants.js';

export type { ResolvedEquipmentGrant };

/** One labelled option within a choose-one starting-equipment group. */
export interface StartingEquipmentOption {
  /** The SRD's `(a)`/`(b)`/`(c)` marker, without parentheses. */
  readonly label: string;
  /** The option's items, verbatim from the SRD with the marker stripped. */
  readonly text: string;
  /** Typed deterministic grants resolved from `text` (eshyra-ngcj.3). */
  readonly grants: readonly ResolvedEquipmentGrant[];
}

/** A "choose one of …" starting-equipment group. */
export interface StartingEquipmentChoice {
  readonly kind: 'choice';
  /** The options; the player chooses exactly one. */
  readonly options: readonly StartingEquipmentOption[];
  /** Verbatim pack entry line this group was authored from. */
  readonly sourceText: string;
}

/** A fixed starting-equipment grant (no choice). */
export interface StartingEquipmentGrant {
  readonly kind: 'fixed';
  /** The granted items, verbatim from the SRD. */
  readonly text: string;
  /** Verbatim pack entry line this grant was authored from. */
  readonly sourceText: string;
  /** Typed deterministic grants resolved from `text` (eshyra-ngcj.3). */
  readonly grants: readonly ResolvedEquipmentGrant[];
}

/** One starting-equipment entry: a choose-one group or a fixed grant. */
export type StartingEquipmentEntry =
  | StartingEquipmentChoice
  | StartingEquipmentGrant;

/** The structured starting-equipment oracle for one class. */
export interface ClassStartingEquipment {
  /** Entries in SRD order, mirroring the frozen pack's `entries` array. */
  readonly entries: readonly StartingEquipmentEntry[];
}

/** Build a choose-one group from `[label, text]` option pairs. */
function choice(
  sourceText: string,
  ...options: readonly (readonly [string, string])[]
): StartingEquipmentChoice {
  return {
    kind: 'choice',
    options: options.map(([label, text]) => ({
      label,
      text,
      grants: resolveStartingEquipmentGrants(text),
    })),
    sourceText,
  };
}

/** Build a fixed grant. `sourceText` defaults to `text` when not given. */
function fixed(
  text: string,
  sourceText: string = text,
): StartingEquipmentGrant {
  return {
    kind: 'fixed',
    text,
    sourceText,
    grants: resolveStartingEquipmentGrants(text),
  };
}

/**
 * Structured starting equipment per class, keyed by the frozen pack's canonical
 * `class:<slug>` record key. Source: D&D 5e SRD 5.1, each class's Equipment
 * section — the same prose carried verbatim in each entry's `sourceText` (which
 * deep-equals the pack's `startingEquipment.entries`). Curly apostrophes match
 * the pack's extracted text.
 */
const CLASS_STARTING_EQUIPMENT: Readonly<
  Record<string, ClassStartingEquipment>
> = {
  'class:barbarian': {
    entries: [
      choice(
        '(a) a greataxe or (b) any martial melee weapon',
        ['a', 'a greataxe'],
        ['b', 'any martial melee weapon'],
      ),
      choice(
        '(a) two handaxes or (b) any simple weapon',
        ['a', 'two handaxes'],
        ['b', 'any simple weapon'],
      ),
      fixed('An explorer’s pack and four javelins'),
    ],
  },
  'class:bard': {
    entries: [
      choice(
        '(a) a rapier, (b) a longsword, or (c) any simple weapon',
        ['a', 'a rapier'],
        ['b', 'a longsword'],
        ['c', 'any simple weapon'],
      ),
      choice(
        '(a) a diplomat’s pack or (b) an entertainer’s pack',
        ['a', 'a diplomat’s pack'],
        ['b', 'an entertainer’s pack'],
      ),
      choice(
        '(a) a lute or (b) any other musical instrument',
        ['a', 'a lute'],
        ['b', 'any other musical instrument'],
      ),
      fixed('Leather armor and a dagger'),
    ],
  },
  'class:cleric': {
    entries: [
      choice(
        '(a) a mace or (b) a warhammer (if proficient)',
        ['a', 'a mace'],
        ['b', 'a warhammer (if proficient)'],
      ),
      choice(
        '(a) scale mail, (b) leather armor, or (c) chain mail (if proficient)',
        ['a', 'scale mail'],
        ['b', 'leather armor'],
        ['c', 'chain mail (if proficient)'],
      ),
      choice(
        '(a) a light crossbow and 20 bolts or (b) any simple weapon',
        ['a', 'a light crossbow and 20 bolts'],
        ['b', 'any simple weapon'],
      ),
      choice(
        '(a) a priest’s pack or (b) an explorer’s pack',
        ['a', 'a priest’s pack'],
        ['b', 'an explorer’s pack'],
      ),
      fixed('A shield and a holy symbol'),
    ],
  },
  'class:druid': {
    entries: [
      choice(
        '(a) a wooden shield or (b) any simple weapon',
        ['a', 'a wooden shield'],
        ['b', 'any simple weapon'],
      ),
      choice(
        '(a) a scimitar or (b) any simple melee weapon',
        ['a', 'a scimitar'],
        ['b', 'any simple melee weapon'],
      ),
      fixed('Leather armor, an explorer’s pack, and a druidic focus'),
    ],
  },
  'class:fighter': {
    entries: [
      choice(
        '(a) chain mail or (b) leather armor, longbow, and 20 arrows',
        ['a', 'chain mail'],
        ['b', 'leather armor, longbow, and 20 arrows'],
      ),
      choice(
        '(a) a martial weapon and a shield or (b) two martial weapons',
        ['a', 'a martial weapon and a shield'],
        ['b', 'two martial weapons'],
      ),
      choice(
        '(a) a light crossbow and 20 bolts or (b) two handaxes',
        ['a', 'a light crossbow and 20 bolts'],
        ['b', 'two handaxes'],
      ),
      choice(
        '(a) a dungeoneer’s pack or (b) an explorer’s pack',
        ['a', 'a dungeoneer’s pack'],
        ['b', 'an explorer’s pack'],
      ),
    ],
  },
  'class:monk': {
    entries: [
      choice(
        '(a) a shortsword or (b) any simple weapon',
        ['a', 'a shortsword'],
        ['b', 'any simple weapon'],
      ),
      choice(
        '(a) a dungeoneer’s pack or (b) an explorer’s pack',
        ['a', 'a dungeoneer’s pack'],
        ['b', 'an explorer’s pack'],
      ),
      fixed('10 darts'),
    ],
  },
  'class:paladin': {
    entries: [
      choice(
        '(a) a martial weapon and a shield or (b) two martial weapons',
        ['a', 'a martial weapon and a shield'],
        ['b', 'two martial weapons'],
      ),
      choice(
        '(a) five javelins or (b) any simple melee weapon',
        ['a', 'five javelins'],
        ['b', 'any simple melee weapon'],
      ),
      choice(
        '(a) a priest’s pack or (b) an explorer’s pack',
        ['a', 'a priest’s pack'],
        ['b', 'an explorer’s pack'],
      ),
      fixed('Chain mail and a holy symbol'),
    ],
  },
  'class:ranger': {
    entries: [
      choice(
        '(a) scale mail or (b) leather armor',
        ['a', 'scale mail'],
        ['b', 'leather armor'],
      ),
      choice(
        '(a) two shortswords or (b) two simple melee weapons',
        ['a', 'two shortswords'],
        ['b', 'two simple melee weapons'],
      ),
      choice(
        '(a) a dungeoneer’s pack or (b) an explorer’s pack',
        ['a', 'a dungeoneer’s pack'],
        ['b', 'an explorer’s pack'],
      ),
      fixed('A longbow and a quiver of 20 arrows'),
    ],
  },
  'class:rogue': {
    entries: [
      choice(
        '(a) a rapier or (b) a shortsword',
        ['a', 'a rapier'],
        ['b', 'a shortsword'],
      ),
      choice(
        '(a) a shortbow and quiver of 20 arrows or (b) a shortsword',
        ['a', 'a shortbow and quiver of 20 arrows'],
        ['b', 'a shortsword'],
      ),
      choice(
        '(a) a burglar’s pack, (b) a dungeoneer’s pack, or (c) an explorer’s pack',
        ['a', 'a burglar’s pack'],
        ['b', 'a dungeoneer’s pack'],
        ['c', 'an explorer’s pack'],
      ),
      // The pack carries a stray "(a) " prefix on this single fixed grant (an
      // extraction artifact — the SRD has no (b) here); model it as fixed while
      // keeping sourceText verbatim so the freeze-faithfulness check still holds.
      fixed(
        'Leather armor, two daggers, and thieves’ tools',
        '(a) Leather armor, two daggers, and thieves’ tools',
      ),
    ],
  },
  'class:sorcerer': {
    entries: [
      choice(
        '(a) a light crossbow and 20 bolts or (b) any simple weapon',
        ['a', 'a light crossbow and 20 bolts'],
        ['b', 'any simple weapon'],
      ),
      choice(
        '(a) a component pouch or (b) an arcane focus',
        ['a', 'a component pouch'],
        ['b', 'an arcane focus'],
      ),
      choice(
        '(a) a dungeoneer’s pack or (b) an explorer’s pack',
        ['a', 'a dungeoneer’s pack'],
        ['b', 'an explorer’s pack'],
      ),
      fixed('Two daggers'),
    ],
  },
  'class:warlock': {
    entries: [
      choice(
        '(a) a light crossbow and 20 bolts or (b) any simple weapon',
        ['a', 'a light crossbow and 20 bolts'],
        ['b', 'any simple weapon'],
      ),
      choice(
        '(a) a component pouch or (b) an arcane focus',
        ['a', 'a component pouch'],
        ['b', 'an arcane focus'],
      ),
      choice(
        '(a) a scholar’s pack or (b) a dungeoneer’s pack',
        ['a', 'a scholar’s pack'],
        ['b', 'a dungeoneer’s pack'],
      ),
      fixed('Leather armor, any simple weapon, and two daggers'),
    ],
  },
  'class:wizard': {
    entries: [
      choice(
        '(a) a quarterstaff or (b) a dagger',
        ['a', 'a quarterstaff'],
        ['b', 'a dagger'],
      ),
      choice(
        '(a) a component pouch or (b) an arcane focus',
        ['a', 'a component pouch'],
        ['b', 'an arcane focus'],
      ),
      choice(
        '(a) a scholar’s pack or (b) an explorer’s pack',
        ['a', 'a scholar’s pack'],
        ['b', 'an explorer’s pack'],
      ),
      fixed('A spellbook'),
    ],
  },
};

/**
 * The structured starting equipment for a class, looked up by its frozen
 * canonical record key (e.g. `class:fighter`), or `undefined` for an unmodeled
 * class (e.g. a future non-SRD pack). Keyed only by canonical key so it stays
 * pinned to the frozen records and never matches on mutable prose.
 */
export function getClassStartingEquipment(
  classKey: string,
): ClassStartingEquipment | undefined {
  return CLASS_STARTING_EQUIPMENT[classKey];
}
