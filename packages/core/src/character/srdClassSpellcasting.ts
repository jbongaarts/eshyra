/**
 * Source-backed per-class spellcasting overlay (eshyra-b69j.12.2).
 *
 * Level-1 spellcasting *counts* are already structured on the class progression
 * rows (`class.data.progression[level==1].spellcasting` =
 * `{cantripsKnown, spellsKnown?, slots}`). Two mechanically required facts are
 * not: (1) the spellcasting *ability* per class (Wizard = Intelligence,
 * Cleric = Wisdom, Bard = Charisma, …), which gates spell save DC / spell attack
 * (deferred by eshyra-b69j.6) and the prepared-caster counts; and (2) the
 * prepared-caster spell counts and the Wizard's starting spellbook size — both
 * formulas living only in the `feature:<class>:spellcasting` prose. In the
 * frozen pack that prose is in fact truncated to a one-line flavor intro, so the
 * ability and the formulas are not recoverable from pack data at all.
 *
 * The `rules:dnd5e-srd-5.1` pack is a frozen, hash-pinned, signed-off artifact
 * (`docs/audits/dnd5e-srd-5.1-final/`; guard via
 * `npm run verify:dnd5e-srd-freeze`), so the gap is NOT filled by re-running the
 * importer or regenerating the pack — that would require a thaw + re-audit.
 * Instead this module is the sanctioned deterministic, consumer-side metadata
 * overlay described in
 * `docs/design/character-creation-level1-metadata-inventory.md` and the same
 * pattern as the ancestry overlay (`srdAncestryAbilityScoreIncreases.ts`,
 * eshyra-b69j.12.1): an authored, SRD-cited table keyed by the frozen `class:*`
 * record keys. It mutates nothing in the pack; it is ordinary character-creation
 * code (not importer-fix-protocol work). Every entry's `sourceText` is the
 * verbatim D&D 5e SRD 5.1 spellcasting prose it was authored from.
 *
 * The table covers every SRD class with a spellcasting/Pact Magic feature.
 * Paladin and Ranger carry a spellcasting ability but do not cast at level 1
 * (their progression rows grant no level-1 cantrips, spells, or slots), so the
 * overlay states the fact while consumers gate level-1 behavior on the
 * progression row, never on overlay membership.
 */

import type { AbilityScoreName } from './creation.js';
import type { ResolvedClassData } from './rulesPackResolver.js';

/**
 * How a class fields its level-1 spells:
 *   - `known` — a fixed number of spells is known (the `spellsKnown` count on
 *     the progression row); the player picks exactly that many.
 *   - `prepared` — the class prepares a daily list whose size is a formula of
 *     the spellcasting ability modifier + class level (Wizard prepares from its
 *     spellbook; Cleric/Druid from the whole class list).
 */
export type SpellPreparation = 'known' | 'prepared';

/** The structured spellcasting overlay for one class. */
export interface ClassSpellcasting {
  /** The ability that powers the class's spells (spell save DC / attack). */
  readonly ability: AbilityScoreName;
  /** Whether the class knows a fixed spell count or prepares a daily list. */
  readonly preparation: SpellPreparation;
  /**
   * Wizard only: the number of level-1 spells the starting spellbook holds at
   * character creation (the concrete level-1 spell pick for a Wizard). Other
   * prepared casters know their whole list and have no creation-time spellbook.
   */
  readonly spellbookStartingSpells?: number;
  /** Verbatim D&D 5e SRD 5.1 spellcasting prose this overlay was authored from. */
  readonly sourceText: string;
}

/**
 * Structured spellcasting per class, keyed by the frozen pack's canonical
 * `class:<slug>` record key. Source: D&D 5e SRD 5.1, each class's Spellcasting
 * (or Warlock Pact Magic) feature — the same prose carried verbatim in
 * `sourceText`.
 */
const CLASS_SPELLCASTING: Readonly<Record<string, ClassSpellcasting>> = {
  'class:bard': {
    ability: 'charisma',
    preparation: 'known',
    sourceText: 'Charisma is your spellcasting ability for your bard spells.',
  },
  'class:cleric': {
    ability: 'wisdom',
    preparation: 'prepared',
    sourceText:
      'You prepare the list of cleric spells that are available for you to cast, choosing from the cleric spell list. When you do so, choose a number of cleric spells equal to your Wisdom modifier + your cleric level (minimum of one spell). Wisdom is your spellcasting ability for your cleric spells.',
  },
  'class:druid': {
    ability: 'wisdom',
    preparation: 'prepared',
    sourceText:
      'You prepare the list of druid spells that are available for you to cast, choosing from the druid spell list. When you do so, choose a number of druid spells equal to your Wisdom modifier + your druid level (minimum of one spell). Wisdom is your spellcasting ability for your druid spells.',
  },
  'class:paladin': {
    // Paladin gains spellcasting at 2nd level; the ability is still Charisma.
    ability: 'charisma',
    preparation: 'prepared',
    sourceText:
      'By 2nd level, you have learned to draw on divine magic through meditation and prayer to cast spells as a cleric does. Charisma is your spellcasting ability for your paladin spells.',
  },
  'class:ranger': {
    // Ranger gains spellcasting at 2nd level; the ability is Wisdom.
    ability: 'wisdom',
    preparation: 'known',
    sourceText:
      'By the time you reach 2nd level, you have learned to use the magical essence of nature to cast spells, much as a druid does. Wisdom is your spellcasting ability for your ranger spells.',
  },
  'class:sorcerer': {
    ability: 'charisma',
    preparation: 'known',
    sourceText:
      'Charisma is your spellcasting ability for your sorcerer spells.',
  },
  'class:warlock': {
    ability: 'charisma',
    preparation: 'known',
    sourceText:
      'Charisma is your spellcasting ability for your warlock spells.',
  },
  'class:wizard': {
    ability: 'intelligence',
    preparation: 'prepared',
    spellbookStartingSpells: 6,
    sourceText:
      'At 1st level, you have a spellbook containing six 1st-level wizard spells of your choice. You prepare the list of wizard spells that are available for you to cast. To do so, choose a number of wizard spells from your spellbook equal to your Intelligence modifier + your wizard level (minimum of one spell). Intelligence is your spellcasting ability for your wizard spells.',
  },
};

/**
 * The structured spellcasting overlay for a class, looked up by its frozen
 * canonical record key (e.g. `class:wizard`), or `undefined` for a non-caster
 * (Barbarian, Fighter, Monk, Rogue) or an unmodeled class. Keyed only by
 * canonical key so it stays pinned to the frozen records and never matches on
 * mutable prose.
 */
export function getClassSpellcasting(
  classKey: string,
): ClassSpellcasting | undefined {
  return CLASS_SPELLCASTING[classKey];
}

/**
 * The number of level-1 spells a full prepared caster (Cleric, Druid, Wizard)
 * prepares: the spellcasting ability modifier + the class level (1 at creation),
 * with the SRD's minimum of one spell. This is the prepared-list size; a
 * Wizard's *spellbook* additionally holds {@link ClassSpellcasting.spellbookStartingSpells}
 * spells to prepare from.
 */
export function level1PreparedSpellCount(abilityModifier: number): number {
  return Math.max(1, abilityModifier + 1);
}

/**
 * Whether a class's level-1 progression row grants any spellcasting at level 1
 * (cantrips, spells known, or spell slots). This is the gate that separates
 * actual level-1 casters from non-casters and the half-casters (Paladin,
 * Ranger) whose spellcasting begins at level 2 — those have an overlay entry for
 * the ability fact but an empty level-1 spellcasting row.
 */
export function castsAtLevel1(classRecord: ResolvedClassData): boolean {
  const spellcasting = classRecord.level1?.spellcasting;
  if (spellcasting === undefined) {
    return false;
  }
  return (
    spellcasting.cantripsKnown !== undefined ||
    spellcasting.spellsKnown !== undefined ||
    spellcasting.slots !== undefined
  );
}

/**
 * The spellcasting ability that powers a class's spells at level 1, or
 * `undefined` when the class does not cast at level 1. Combines the source-cited
 * ability overlay with the frozen progression row's level-1 gate, so callers get
 * a spell save DC / attack ability only for real level-1 casters.
 */
export function level1SpellcastingAbility(
  classRecord: ResolvedClassData | undefined,
): AbilityScoreName | undefined {
  if (classRecord === undefined || !castsAtLevel1(classRecord)) {
    return undefined;
  }
  return getClassSpellcasting(classRecord.key)?.ability;
}
