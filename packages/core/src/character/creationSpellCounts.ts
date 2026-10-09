/**
 * Level-1 spell-count rules for guided character creation (eshyra-eb9n.1).
 *
 * The draft stores ONE flat `selections.spells` list (cantrips and level-1
 * spells mixed). This module classifies it by spell level and reports what the
 * class requires at level 1, so the draft can gate finalization on:
 *
 *   - cantrips == `cantripsKnown` (when the class has cantrips);
 *   - known casters (bard, sorcerer, warlock): level-1 spells == `spellsKnown`;
 *   - wizard: level-1 spellbook == `spellbookStartingSpells`, plus a separate
 *     prepared list of 1..limit spells drawn from that spellbook;
 *   - cleric/druid: between 1 and the preparation limit level-1 spells,
 *     NOT counting subclass always-prepared spells.
 *
 * The preparation limit is `evaluatePreparationBasis` — the same rule as
 * long-rest preparation and level-up — so the formula cannot drift.
 */

import type { AbilityScoreName } from './creation.js';
import { evaluatePreparationBasis } from './levelUpSpells.js';
import type {
  ResolvedClassData,
  RulesPackCharacterResolver,
} from './rulesPackResolver.js';

export interface Level1SpellRequirements {
  /** Exact cantrip count, when the class has cantrips at level 1. */
  readonly cantrips?: number;
  /** Exact level-1 spell count for a known caster. */
  readonly known?: number;
  /** Exact level-1 spellbook size (wizard). */
  readonly spellbook?: number;
  /** Cleric/druid: 1..limit prepared level-1 spells (picked from the list). */
  readonly preparedFromList?: { readonly limit: number };
  /** Wizard: 1..limit prepared spells drawn from the chosen spellbook. */
  readonly wizardPrepared?: { readonly limit: number };
}

/** What the class requires at level 1; undefined entries mean "not required". */
export function level1SpellRequirements(
  classRecord: ResolvedClassData,
  abilityModifiers: Partial<Record<AbilityScoreName, number>>,
  resolver: RulesPackCharacterResolver,
): Level1SpellRequirements {
  const casting = classRecord.level1?.spellcasting;
  const casts =
    casting !== undefined &&
    (casting.cantripsKnown !== undefined ||
      casting.spellsKnown !== undefined ||
      casting.slots !== undefined ||
      casting.pactSlots !== undefined);
  if (!casts) return {};
  const preparation = classRecord.spellPreparation;
  const cantrips = casting.cantripsKnown;
  if (preparation === undefined) {
    return { ...(cantrips !== undefined ? { cantrips } : {}) };
  }
  const base = {
    ...(cantrips !== undefined ? { cantrips } : {}),
  };
  if (preparation.kind === 'known') {
    return {
      ...base,
      ...(casting.spellsKnown !== undefined
        ? { known: casting.spellsKnown }
        : {}),
    };
  }
  const limit = preparedLimit(classRecord, abilityModifiers, resolver);
  if (preparation.spellbookStartingSpells !== undefined) {
    return {
      ...base,
      spellbook: preparation.spellbookStartingSpells,
      ...(limit !== undefined ? { wizardPrepared: { limit } } : {}),
    };
  }
  return {
    ...base,
    ...(limit !== undefined ? { preparedFromList: { limit } } : {}),
  };
}

function preparedLimit(
  classRecord: ResolvedClassData,
  abilityModifiers: Partial<Record<AbilityScoreName, number>>,
  resolver: RulesPackCharacterResolver,
): number | undefined {
  const preparation = classRecord.spellPreparation;
  if (preparation === undefined) return undefined;
  const basis = evaluatePreparationBasis({
    resolver,
    classKey: classRecord.key,
    preparation,
    level: 1,
    spellbook: [],
    modifierOf: (ability) => abilityModifiers[ability],
  });
  return basis.ok ? basis.limit : undefined;
}
