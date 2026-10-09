// Long-rest spell preparation (eshyra-odpc).
//
// SRD 5.1: a cleric, druid, paladin or wizard "can change [their] list of
// prepared spells when [they] finish a long rest". This module is the model's
// only path for changing `sheet.spellcasting.prepared` outside level-up.
//
// Gate: `restId` must be a COMPLETED LONG rest whose participants include the
// character, and the world clock must still equal that rest's
// `end_elapsed_minutes` (the same window rule as `spendRestHitDie`). Time spent
// preparing is treated as part of finishing the rest, so it does not advance
// the clock. Repeated calls inside the window replace the list (last wins).
// Preparation is refused while combat is active.
//
// Count limit and option set come from `evaluatePreparationBasis`, the same
// computation level-up uses (class formula, class list at castable levels,
// wizard: spellbook only), evaluated at the sheet's CURRENT ability score and
// class level.
//
// Always-prepared spells (domain / oath / circle) are recomputed from the pack
// on every preparation into `spellcasting.alwaysPrepared`: subclass
// `spellTableRefs` -> `subclassSpellGrants` rows with `level <= class level`.
// They never count against the limit and cannot be selected. A spell name that
// does not resolve fails the whole operation closed. Circle of the Land uses
// only the table matching the recorded land pick; with no pick recorded no
// circle spells are set and the result carries `alwaysPreparedUnresolved`.
//
// Out of scope (follow-up): refreshing `alwaysPrepared` at level-up and
// creation; no progression-ledger event is written (its kinds are
// xp/milestone/level-up only).

import { type Db, withTransaction } from '../persistence/db.js';
import {
  DEFAULT_DND5E_SRD_BINDING,
  readCampaignRulesBinding,
} from '../rules/binding.js';
import { assertSupportedCharacterBuild } from './characterBuild.js';
import {
  assertSheetMatchesPack,
  createSqliteCharacterSheetStore,
} from './characterSheetStore.js';
import type { AbilityScoreName } from './creation.js';
import type {
  CharacterSheet,
  CharacterSpellcasting,
} from './finalizeCharacter.js';
import {
  effectiveSpellcasting,
  evaluatePreparationBasis,
  spellsUnion,
} from './levelUpSpells.js';
import {
  getBundledDnd5eCharacterResolver,
  type RulesPackCharacterResolver,
} from './rulesPackResolver.js';

export class SpellPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpellPreparationError';
  }
}

export interface PrepareSpellsInput {
  readonly campaignId: string;
  readonly characterId: string;
  readonly restId: string;
  /** Spell names or `spell:` refs; 1..limit distinct class spells. */
  readonly spellRefs: readonly string[];
  readonly resolver?: RulesPackCharacterResolver;
}

export interface PrepareSpellsResult {
  readonly characterId: string;
  readonly restId: string;
  readonly classKey: string;
  readonly classLevel: number;
  /** Maximum number of chosen (non-always-prepared) spells. */
  readonly limit: number;
  readonly prepared: readonly string[];
  readonly previouslyPrepared: readonly string[];
  readonly alwaysPrepared: readonly string[];
  /** Why subclass spells could not be determined, when they could not. */
  readonly alwaysPreparedUnresolved?: string;
}

const LAND_FEATURE_REF = 'feature:circle-of-the-land:circle-spells';

interface AlwaysPrepared {
  readonly refs: readonly string[];
  readonly unresolved?: string;
}

function alwaysPreparedFor(
  sheet: CharacterSheet,
  resolver: RulesPackCharacterResolver,
): AlwaysPrepared {
  if (sheet.subclass === undefined) return { refs: [] };
  const sub = resolver.resolveSubclassSpellTables(sheet.subclass.key);
  if (!sub.ok) {
    throw new SpellPreparationError(
      `cannot read '${sheet.subclass.key}' spell tables: ${sub.message}`,
    );
  }
  let tables = sub.record;
  let unresolved: string | undefined;
  if (tables.length > 1) {
    const land = sheet.featureChoices
      ?.filter(
        (c) => c.featureRef === LAND_FEATURE_REF && c.choiceId === 'land',
      )
      .at(-1)?.optionIds[0];
    const slug = land?.startsWith('land:') ? land.slice('land:'.length) : '';
    const want = `table:${sheet.subclass.key.replace(/^subclass:/, '')}-${slug}`;
    const match =
      sheet.subclass.key === 'subclass:circle-of-the-land' && slug !== ''
        ? tables.filter((t) => t.tableRef === want)
        : [];
    if (match.length !== 1) {
      unresolved =
        sheet.subclass.key === 'subclass:circle-of-the-land'
          ? 'No Circle of the Land terrain pick is recorded on the sheet, so the always-prepared circle spells cannot be determined.'
          : `Subclass '${sheet.subclass.key}' has several spell tables and no rule selects one.`;
      tables = [];
    } else {
      tables = match;
    }
  }
  const refs: string[] = [];
  for (const table of tables) {
    for (const row of table.rows) {
      if (row.level > sheet.level) continue;
      for (const name of row.spells) {
        const spell = resolver.resolveSpell(name);
        if (!spell.ok) {
          throw new SpellPreparationError(
            `always-prepared spell '${name}' (${table.tableRef}) does not resolve to a pack spell`,
          );
        }
        if (!refs.includes(spell.record.key)) refs.push(spell.record.key);
      }
    }
  }
  return { refs, ...(unresolved !== undefined ? { unresolved } : {}) };
}

/**
 * Set a prepared caster's prepared list after a long rest. Atomic: any refusal
 * leaves the sheet untouched.
 */
export function prepareSpellsAfterLongRest(
  db: Db,
  input: PrepareSpellsInput,
): PrepareSpellsResult {
  return withTransaction(db, (txn) => {
    const resolver = input.resolver ?? getBundledDnd5eCharacterResolver();
    const store = createSqliteCharacterSheetStore(txn);
    const sheet = store.load(input.characterId);
    if (!sheet) {
      throw new SpellPreparationError(
        `no canonical character sheet for '${input.characterId}'`,
      );
    }
    assertSupportedCharacterBuild(sheet, {
      operation: 'spell preparation',
      resolver,
    });
    assertSheetMatchesPack(
      sheet,
      readCampaignRulesBinding(txn) ?? DEFAULT_DND5E_SRD_BINDING,
    );

    // Gate: finishing a long rest, inside that rest's window.
    const rest = txn
      .prepare(
        "SELECT r.end_elapsed_minutes AS end FROM rest_event r JOIN rest_participant p USING(campaign_id, rest_id) WHERE r.campaign_id=? AND r.rest_id=? AND r.kind='long' AND r.status='completed' AND p.character_id=?",
      )
      .get(input.campaignId, input.restId, input.characterId) as
      | { end: number }
      | undefined;
    if (!rest) {
      throw new SpellPreparationError(
        `'${input.restId}' is not a completed long rest that '${input.characterId}' took part in; spells can only be prepared when finishing a long rest`,
      );
    }
    // Starting combat does not move the world clock, so the window alone would
    // let a caster re-prepare after seeing the encounter (spendRestHitDie
    // applies the same active-combat refusal).
    const activeCombat = txn
      .prepare(
        "SELECT 1 FROM combat_instance WHERE campaign_id=? AND status='active' LIMIT 1",
      )
      .get(input.campaignId);
    if (activeCombat) {
      throw new SpellPreparationError(
        'cannot prepare spells during combat; preparation happens when finishing the long rest',
      );
    }
    const now = txn
      .prepare('SELECT elapsed_minutes FROM clock WHERE id = 1')
      .get() as { elapsed_minutes?: number } | undefined;
    if ((now?.elapsed_minutes ?? 0) !== rest.end) {
      throw new SpellPreparationError(
        'the spell-preparation window closed when world time advanced past the long rest',
      );
    }

    // Eligibility: sole-class prepared caster with a structured formula.
    const cls = resolver.resolveClass(sheet.class.key);
    if (!cls.ok) throw new SpellPreparationError(cls.message);
    const preparation = cls.record.spellPreparation;
    if (
      preparation === undefined ||
      preparation.kind !== 'prepared' ||
      preparation.preparationFormula === undefined
    ) {
      throw new SpellPreparationError(
        `${cls.record.name} does not prepare spells from a list (only cleric, druid, paladin and wizard do)`,
      );
    }
    const effective = effectiveSpellcasting(sheet, cls.record, resolver);
    if (!effective.ok) throw new SpellPreparationError(effective.reason);
    const base: CharacterSpellcasting = effective.spellcasting ?? {
      cantrips: [],
    };

    const basis = evaluatePreparationBasis({
      resolver,
      classKey: sheet.class.key,
      preparation,
      level: sheet.level,
      spellbook: base.spellbook ?? [],
      modifierOf: (ability: AbilityScoreName) =>
        sheet.abilityScores[ability]?.modifier,
    });
    if (!basis.ok) throw new SpellPreparationError(basis.reason);
    if (basis.spells.length === 0) {
      throw new SpellPreparationError(
        `${cls.record.name} level ${sheet.level} has no spells available to prepare`,
      );
    }

    const always = alwaysPreparedFor(sheet, resolver);
    const options = new Set(basis.spells.map((s) => s.key));
    const chosen: string[] = [];
    for (const value of input.spellRefs) {
      const spell = resolver.resolveSpell(value);
      if (!spell.ok) {
        throw new SpellPreparationError(
          `'${value}' is not a spell in the rules pack`,
        );
      }
      const key = spell.record.key;
      if (chosen.includes(key)) {
        throw new SpellPreparationError(
          `'${spell.record.name}' is listed more than once`,
        );
      }
      if (always.refs.includes(key)) {
        throw new SpellPreparationError(
          `'${spell.record.name}' is always prepared by the character's subclass and cannot be chosen`,
        );
      }
      if (!options.has(key)) {
        throw new SpellPreparationError(
          `'${spell.record.name}' cannot be prepared (not on the ${cls.record.name} ${
            preparation.spellbookStartingSpells !== undefined
              ? 'spellbook'
              : 'list'
          } at a level you can cast)`,
        );
      }
      chosen.push(key);
    }
    if (chosen.length < 1 || chosen.length > basis.limit) {
      throw new SpellPreparationError(
        `prepare between 1 and ${basis.limit} spell(s); ${chosen.length} given`,
      );
    }

    const { alwaysPrepared: _stale, ...rest_ } = base;
    const spellcasting: CharacterSpellcasting = {
      ...rest_,
      prepared: chosen,
      ...(always.refs.length > 0 ? { alwaysPrepared: always.refs } : {}),
    };
    store.save(input.characterId, {
      ...sheet,
      spellcasting,
      spells: spellsUnion(spellcasting),
    });
    return {
      characterId: input.characterId,
      restId: input.restId,
      classKey: sheet.class.key,
      classLevel: sheet.level,
      limit: basis.limit,
      prepared: chosen,
      previouslyPrepared: base.prepared ?? [],
      alwaysPrepared: always.refs,
      ...(always.unresolved !== undefined
        ? { alwaysPreparedUnresolved: always.unresolved }
        : {}),
    };
  });
}
