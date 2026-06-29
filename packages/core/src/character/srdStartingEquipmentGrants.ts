/**
 * Deterministic class starting-equipment grant resolver (eshyra-ngcj.3).
 *
 * The frozen pack carried each class's starting equipment as prose option text
 * ("a greataxe", "any martial melee weapon", "Leather armor, two daggers, and
 * thieves' tools"). A character-creation flow cannot grant inventory from that
 * without parsing prose. This module resolves every distinct SRD 5.1 class
 * starting-equipment phrase into typed, machine-readable grants:
 *
 *   - a FIXED item → a stable `equipment:<slug>` ref plus an explicit quantity
 *     (and an optional `condition` for "(if proficient)" provisos);
 *   - an OPEN choice ("any simple weapon", "an arcane focus") → a typed
 *     `filter` naming the selectable class, plus the quantity.
 *
 * The mapping is an exhaustive, source-backed table keyed by the verbatim SRD
 * phrase (the same text carried in the pack's `startingEquipment.entries`), so
 * resolution is deterministic and auditable — never inferred from a model. A
 * phrase absent from the table throws, so a new/edited entry fails closed rather
 * than silently dropping a grant.
 *
 * This single resolver is shared by the importer (`creationFacts.ts`) and the
 * regression oracle (`srdClassStartingEquipment.ts`) so the generated pack and
 * the oracle cannot drift.
 */

/** The selectable equipment class for an open starting-equipment choice. */
export type StartingEquipmentFilterSelect =
  | 'weapon'
  | 'arcane-focus'
  | 'druidic-focus'
  | 'holy-symbol'
  | 'musical-instrument';

/** A fixed grant of a specific equipment record. */
export interface StartingEquipmentItemGrant {
  readonly kind: 'item';
  /** Stable equipment record key, e.g. `equipment:greataxe`. */
  readonly ref: string;
  /** Explicit count (a bundle record like `equipment:arrows-20` counts as 1). */
  readonly quantity: number;
  /** SRD proviso, e.g. "if proficient" (Cleric warhammer / chain mail). */
  readonly condition?: string;
}

/** An open choice resolved to a typed filter over the equipment catalog. */
export interface StartingEquipmentFilterGrant {
  readonly kind: 'filter';
  readonly select: StartingEquipmentFilterSelect;
  readonly quantity: number;
  /** Weapon proficiency class; present only when `select === 'weapon'`. */
  readonly weaponCategory?: 'simple' | 'martial';
  /** Weapon range; present only when `select === 'weapon'`. */
  readonly weaponRange?: 'melee' | 'ranged';
}

export type StartingEquipmentGrant =
  | StartingEquipmentItemGrant
  | StartingEquipmentFilterGrant;

/** Thrown when a starting-equipment phrase has no typed resolution. */
export class StartingEquipmentGrantError extends Error {
  constructor(text: string) {
    super(
      `No typed starting-equipment grant for phrase ${JSON.stringify(text)}. ` +
        'Add it to STARTING_EQUIPMENT_GRANTS with source-backed evidence.',
    );
    this.name = 'StartingEquipmentGrantError';
  }
}

function item(
  slug: string,
  quantity = 1,
  condition?: string,
): StartingEquipmentItemGrant {
  return {
    kind: 'item',
    ref: `equipment:${slug}`,
    quantity,
    ...(condition !== undefined ? { condition } : {}),
  };
}

function weapon(
  quantity: number,
  weaponCategory?: 'simple' | 'martial',
  weaponRange?: 'melee' | 'ranged',
): StartingEquipmentFilterGrant {
  return {
    kind: 'filter',
    select: 'weapon',
    quantity,
    ...(weaponCategory !== undefined ? { weaponCategory } : {}),
    ...(weaponRange !== undefined ? { weaponRange } : {}),
  };
}

function focus(
  select: Exclude<StartingEquipmentFilterSelect, 'weapon'>,
  quantity = 1,
): StartingEquipmentFilterGrant {
  return { kind: 'filter', select, quantity };
}

/**
 * Every distinct SRD 5.1 class starting-equipment phrase (option text or fixed
 * grant text) mapped to its typed grants. Keys are verbatim, including curly
 * apostrophes, so they match the pack's `startingEquipment.entries` exactly.
 * Compound phrases ("Leather armor, longbow, and 20 arrows") resolve to one
 * grant per item, in SRD order.
 */
const STARTING_EQUIPMENT_GRANTS: Readonly<
  Record<string, readonly StartingEquipmentGrant[]>
> = {
  // --- compound fixed grants ---
  '10 darts': [item('dart', 10)],
  'A longbow and a quiver of 20 arrows': [item('longbow'), item('arrows-20')],
  'A shield and a holy symbol': [item('shield'), focus('holy-symbol')],
  'A spellbook': [item('spellbook')],
  'An explorer’s pack and four javelins': [
    item('explorers-pack'),
    item('javelin', 4),
  ],
  'Chain mail and a holy symbol': [item('chain-mail'), focus('holy-symbol')],
  'Leather armor and a dagger': [item('leather'), item('dagger')],
  'Leather armor, an explorer’s pack, and a druidic focus': [
    item('leather'),
    item('explorers-pack'),
    focus('druidic-focus'),
  ],
  'Leather armor, any simple weapon, and two daggers': [
    item('leather'),
    weapon(1, 'simple'),
    item('dagger', 2),
  ],
  'Leather armor, two daggers, and thieves’ tools': [
    item('leather'),
    item('dagger', 2),
    item('thieves-tools'),
  ],
  'Two daggers': [item('dagger', 2)],
  'leather armor, longbow, and 20 arrows': [
    item('leather'),
    item('longbow'),
    item('arrows-20'),
  ],
  // --- single fixed items ---
  'a burglar’s pack': [item('burglars-pack')],
  'a component pouch': [item('component-pouch')],
  'a dagger': [item('dagger')],
  'a diplomat’s pack': [item('diplomats-pack')],
  'a dungeoneer’s pack': [item('dungeoneers-pack')],
  'a greataxe': [item('greataxe')],
  'a light crossbow and 20 bolts': [
    item('crossbow-light'),
    item('crossbow-bolts-20'),
  ],
  'a longsword': [item('longsword')],
  'a lute': [item('lute')],
  'a mace': [item('mace')],
  'a priest’s pack': [item('priests-pack')],
  'a quarterstaff': [item('quarterstaff')],
  'a rapier': [item('rapier')],
  'a scholar’s pack': [item('scholars-pack')],
  'a scimitar': [item('scimitar')],
  'a shortbow and quiver of 20 arrows': [item('shortbow'), item('arrows-20')],
  'a shortsword': [item('shortsword')],
  // The SRD prints "(if proficient)" — preserve it as a structured condition.
  'a warhammer (if proficient)': [item('warhammer', 1, 'if proficient')],
  // Druids use non-metal shields; the SRD's only shield record stands in.
  'a wooden shield': [item('shield')],
  'an entertainer’s pack': [item('entertainers-pack')],
  'an explorer’s pack': [item('explorers-pack')],
  'chain mail': [item('chain-mail')],
  'chain mail (if proficient)': [item('chain-mail', 1, 'if proficient')],
  'five javelins': [item('javelin', 5)],
  'leather armor': [item('leather')],
  'scale mail': [item('scale-mail')],
  'two handaxes': [item('handaxe', 2)],
  'two shortswords': [item('shortsword', 2)],
  // --- combined fixed + filter ---
  'a martial weapon and a shield': [weapon(1, 'martial'), item('shield')],
  // --- open filters ---
  'an arcane focus': [focus('arcane-focus')],
  'any martial melee weapon': [weapon(1, 'martial', 'melee')],
  'any other musical instrument': [focus('musical-instrument')],
  'any simple melee weapon': [weapon(1, 'simple', 'melee')],
  'any simple weapon': [weapon(1, 'simple')],
  'two martial weapons': [weapon(2, 'martial')],
  'two simple melee weapons': [weapon(2, 'simple', 'melee')],
};

/**
 * Resolve a starting-equipment phrase to its typed grants. Throws
 * `StartingEquipmentGrantError` if the phrase has no source-backed entry.
 */
export function resolveStartingEquipmentGrants(
  text: string,
): readonly StartingEquipmentGrant[] {
  const grants = STARTING_EQUIPMENT_GRANTS[text];
  if (grants === undefined) throw new StartingEquipmentGrantError(text);
  return grants.map((grant) => ({ ...grant }));
}

/** The set of distinct phrases the resolver covers (for tests/audits). */
export function startingEquipmentGrantPhrases(): readonly string[] {
  return Object.keys(STARTING_EQUIPMENT_GRANTS);
}
