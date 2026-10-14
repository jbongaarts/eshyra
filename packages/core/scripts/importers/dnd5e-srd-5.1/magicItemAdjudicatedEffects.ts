/**
 * Faithful-or-absent withholding of magic-item effects (eshyra-o9bd.19.4.5.8;
 * bd memory magic-item-faithful-or-absent).
 *
 * A typed `mechanics.effects` member must state the printed predicate exactly
 * or not exist. Where the vocabulary cannot carry the printed predicate
 * (a conditional reward that the effect list would project as an unconditional
 * passive, a repeat-save/immunity/early-end lifecycle, an outcome-conditional
 * cost), the family producers may still draft the candidate effect, but this
 * table withholds it: the effect leaves `mechanics.effects`, every reference to
 * it is removed, and its readiness clause becomes `adjudicated-by-design`
 * carrying a verbatim span of the item's printed description so the DM model
 * interprets the printed text itself. The compiler fails loudly when a span is
 * not a verbatim substring of the description or a named effect/clause cannot
 * be found, so drift in a producer cannot silently resurrect a typed claim.
 *
 * Scope: `mechanics.effects` members only. Operations, activation, state
 * machines, economies, grants and containment belong to eshyra-o9bd.19.4.6;
 * this module only removes references to an effect it withholds.
 */
import type {
  ItemClauseExpectation,
  MagicItemFamilyProjection,
} from './magicItemCompiler.js';
import type { MagicItemExtraction } from './types.js';

interface WithheldEffect {
  readonly kind: 'withhold';
  readonly effectId: string;
  readonly sourceText: string;
  readonly note: string;
}

/** The producer withholds one typed field of a kept effect (a claim the field
 * vocabulary cannot condition, such as a cost owed only if the creature is
 * slain); the printed clause becomes a new adjudicated clause. The named
 * effect must exist, and must not still carry the withheld field. */
interface WithheldEffectField {
  readonly kind: 'drop-field';
  readonly effectId: string;
  readonly field: string;
  readonly clauseId: string;
  readonly sourceText: string;
  readonly note: string;
}

type AdjudicatedEffectSpec = WithheldEffect | WithheldEffectField;

const STUDY_NOTE =
  'The ability-score increase is a one-time reward that occurs only after the printed study-and-practice period completes; it is not a standing passive modifier, so the DM model applies it from the printed text when the reader completes the period.';

const study = (
  effectId: string,
  ability: string,
): readonly AdjudicatedEffectSpec[] => [
  {
    kind: 'withhold',
    effectId,
    sourceText: `If you spend 48 hours over a period of 6 days or fewer studying the book’s contents and practicing its guidelines, your ${ability} score increases by 2, as does your maximum for that score.`,
    note: STUDY_NOTE,
  },
];

const SPECS: ReadonlyMap<string, readonly AdjudicatedEffectSpec[]> = new Map([
  [
    'Manual of Bodily Health',
    study(
      'm2-manual-of-bodily-health-constitution-score-increase',
      'Constitution',
    ),
  ],
  [
    'Manual of Gainful Exercise',
    study('m2-manual-of-gainful-exercise-strength-score-increase', 'Strength'),
  ],
  [
    'Manual of Quickness of Action',
    study(
      'm2-manual-of-quickness-of-action-dexterity-score-increase',
      'Dexterity',
    ),
  ],
  [
    'Tome of Clear Thought',
    study(
      'm2-tome-of-clear-thought-intelligence-score-increase',
      'Intelligence',
    ),
  ],
  [
    'Tome of Leadership and Influence',
    study(
      'm2-tome-of-leadership-and-influence-charisma-score-increase',
      'Charisma',
    ),
  ],
  [
    'Tome of Understanding',
    study('m2-tome-of-understanding-wisdom-score-increase', 'Wisdom'),
  ],
  [
    'Figurine of Wondrous Power',
    [
      {
        kind: 'withhold',
        effectId: 'c2-residual-goat-terror-aura',
        sourceText:
          'In addition, the goat radiates a 30-foot-radius aura of terror while you are riding it. Any creature hostile to you that starts its turn in the aura must succeed on a DC 15 Wisdom saving throw or be frightened of the goat for 1 minute, or until the goat reverts to figurine form. The frightened creature can repeat the saving throw at the end of each of its turns, ending the effect on itself on a success. Once it successfully saves against the effect, a creature is immune to the goat’s aura for the next 24 hours.',
        note: 'The aura carries a reversion cutoff, an end-of-turn repeat save, and a 24-hour per-creature immunity after a successful save; the typed effect vocabulary cannot state those exceptions, so the model interprets the printed aura.',
      },
    ],
  ],
  [
    'Dimensional Shackles',
    [
      {
        kind: 'withhold',
        effectId: 'c2-residual-dimensional-movement-block',
        sourceText:
          'In addition to serving as mundane manacles, the shackles prevent a creature bound by them from using any method of extradimensional movement, including teleportation or travel to a different plane of existence. They don’t prevent the creature from passing through an interdimensional portal.',
        note: 'The printed restriction binds the shackled creature, not the wearer or user; the typed immunity vocabulary can only state a bearer immunity, so the model interprets the printed restriction and its portal exception.',
      },
    ],
  ],
  [
    'Ring of X-ray Vision',
    [
      {
        kind: 'withhold',
        effectId: 'c2-residual-xray-exhaustion',
        sourceText:
          'Whenever you use the ring again before taking a long rest, you must succeed on a DC 15 Constitution saving throw or gain one level of exhaustion.',
        note: 'The safe-use counter permits reuse after its one risk-free use; the printed save and exhaustion risk remain with the DM, as required by the soft-limit cost contract.',
      },
    ],
  ],
  [
    'Nine Lives Stealer',
    [
      {
        kind: 'drop-field',
        effectId: 'c2-slay-on-critical-payload',
        field: 'chargeCost',
        clauseId: 'slay-on-critical-charge-loss',
        sourceText: 'The sword loses 1 charge if the creature is slain.',
        note: 'The charge is lost only when the creature is slain, not when the saving throw succeeds; the typed payload cannot condition a cost on its own outcome, so the model applies the printed charge loss.',
      },
    ],
  ],
]);

export const MAGIC_ITEM_ADJUDICATED_EFFECT_ITEMS: readonly string[] =
  Object.freeze([...SPECS.keys()]);

/** Effect ids withheld from `mechanics.effects`, per item name. */
export function withheldMagicItemEffectIds(
  itemName: string,
): readonly string[] {
  return (SPECS.get(itemName) ?? [])
    .filter((spec) => spec.kind === 'withhold')
    .map((spec) => spec.effectId);
}

function fail(item: MagicItemExtraction, message: string): never {
  throw new Error(
    `magic-item adjudicated effects: ${JSON.stringify(item.name)} ${message}`,
  );
}

/** Remove every reference to a withheld effect id from operation / state
 * machine `effects` arrays (an emptied array is omitted: effect lists are
 * non-empty by contract). Reference-only edits; the owning blocks stay with
 * eshyra-o9bd.19.4.6. */
function stripEffectReferences(
  value: unknown,
  effectIds: ReadonlySet<string>,
): unknown {
  if (Array.isArray(value))
    return value.map((entry) => stripEffectReferences(entry, effectIds));
  if (typeof value !== 'object' || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (
      key === 'effects' &&
      Array.isArray(child) &&
      child.every((entry) => typeof entry === 'string')
    ) {
      const kept = (child as string[]).filter((id) => !effectIds.has(id));
      if (kept.length > 0) result[key] = kept;
      continue;
    }
    result[key] = stripEffectReferences(child, effectIds);
  }
  return result;
}

/** Apply the faithful-or-absent table to one item's un-namespaced family
 * projections. Items outside the table are returned unchanged. */
export function applyAdjudicatedMagicItemEffects(
  item: MagicItemExtraction,
  projections: readonly MagicItemFamilyProjection[],
): readonly MagicItemFamilyProjection[] {
  const specs = SPECS.get(item.name);
  if (specs === undefined) return projections;
  let result = [...projections];
  const withheld = new Set<string>();
  for (const spec of specs) {
    if (!item.description.includes(spec.sourceText))
      fail(
        item,
        `sourceText for ${spec.effectId} is not a verbatim span of the printed description`,
      );
    const owner = result.findIndex((projection) =>
      (projection.mechanics.effects ?? []).some(
        (effect) => effect.id === spec.effectId,
      ),
    );
    if (owner < 0) fail(item, `names unknown effect ${spec.effectId}`);
    const adjudicated = {
      adjudicated: true as const,
      note: spec.note,
      sourceText: spec.sourceText,
    };
    if (spec.kind === 'drop-field') {
      result = result.map((projection, index) => {
        if (index !== owner) return projection;
        const carrier = (projection.mechanics.effects ?? []).find(
          (effect) => effect.id === spec.effectId,
        );
        if (carrier !== undefined && spec.field in carrier)
          fail(item, `effect ${spec.effectId} still carries ${spec.field}`);
        const clause: ItemClauseExpectation = {
          id: spec.clauseId,
          tag: 'C2',
          representation: adjudicated,
        };
        return {
          ...projection,
          clauses: [...projection.clauses, clause],
        };
      });
      continue;
    }
    withheld.add(spec.effectId);
    let clauseFound = false;
    result = result.map((projection) => {
      const clauses = projection.clauses.map((clause) => {
        const representation = clause.representation;
        if (
          'block' in representation &&
          representation.block === 'effects' &&
          representation.effectId === spec.effectId
        ) {
          clauseFound = true;
          const { engineHooks: _hooks, ...rest } = clause;
          return { ...rest, representation: adjudicated };
        }
        return clause;
      });
      return { ...projection, clauses };
    });
    if (!clauseFound)
      fail(
        item,
        `effect ${spec.effectId} has no effects-block readiness clause`,
      );
  }
  if (withheld.size === 0) return result;
  return result.map((projection) => {
    const { effects, ...otherMechanics } = projection.mechanics;
    const kept = (effects ?? []).filter(
      (effect) => effect.id === undefined || !withheld.has(effect.id),
    );
    const mechanics = stripEffectReferences(
      otherMechanics,
      withheld,
    ) as typeof projection.mechanics;
    return {
      ...projection,
      mechanics: kept.length > 0 ? { ...mechanics, effects: kept } : mechanics,
    };
  });
}
