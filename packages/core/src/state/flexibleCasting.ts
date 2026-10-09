// Flexible Casting (SRD sorcerer, Font of Magic): deterministic conversion
// between sorcery points and spell slots (eshyra-09co.1).
//
// The cost table, maximum slot level, and point ceiling come from the bound
// pack's curated `resource-conversion` procedure and are evaluated by
// `executeBoundedProcedure`; this module only gathers the live inputs (points
// left, available slots) and applies the resulting transition in one
// transaction. It does not consume the bonus action — the DM tracks that with
// the turn-resource tool in combat.

import { createSqliteCharacterSheetStore } from '../character/characterSheetStore.js';
import { createRulesPackCharacterResolver } from '../character/rulesPackResolver.js';
import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import {
  BoundedProcedureError,
  executeBoundedProcedure,
  resourceConversionMaximum,
} from '../rules/boundedProcedures.js';
import { resolveCharacterId } from './activeCharacter.js';
import {
  type CampaignRulesPackResolver,
  lookupStrictCampaignRecord,
  memoizeCampaignRulesPackResolver,
} from './campaignRecordLookup.js';
import {
  addCreatedSpellSlot,
  expendSpellSlotAtLevel,
  type SpellSlotCounter,
  SpellSlotError,
} from './spellSlots.js';
import {
  readBoundClassResourceBalance,
  restoreUsage,
  spendUsage,
  type UsageCounter,
} from './usageCounters.js';

export const FONT_OF_MAGIC_KEY = 'feature:sorcerer:font-of-magic';
const SORCERER_CLASS = 'class:sorcerer';
const SORCERY_POINTS_ABILITY = 'sorcery-points';

export type FlexibleCastingOperation = 'create-slot' | 'convert-slot';

export interface FlexibleCastingInput {
  readonly campaignId: string;
  readonly characterId?: string;
  readonly operation: FlexibleCastingOperation;
  readonly slotLevel: number;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
  readonly resolveRulesPack?: CampaignRulesPackResolver;
}

export interface FlexibleCastingResult {
  readonly operation: FlexibleCastingOperation;
  readonly slotLevel: number;
  /** Signed change to the sorcery-point pool. */
  readonly pointDelta: number;
  readonly sorceryPoints: { readonly remaining: number; readonly max: number };
  readonly slot: SpellSlotCounter;
  /** Action the SRD requires; the DM tracks it, this tool does not. */
  readonly actionCost: string;
  readonly createdSlotExpires?: string;
}

export class FlexibleCastingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlexibleCastingError';
  }
}

/** Create a slot from sorcery points, or convert a slot back to points. */
export function flexibleCasting(
  db: Db,
  input: FlexibleCastingInput,
): FlexibleCastingResult {
  // One rules resolution per bound pack for the whole operation: evaluation,
  // balance reconciliation and mutation must describe the same source.
  const resolveRulesPack = memoizeCampaignRulesPackResolver(
    input.resolveRulesPack,
  );
  return withTransaction(db, (txnDb) => {
    const characterId = resolveCharacterId(txnDb, input.characterId);
    const sheet = createSqliteCharacterSheetStore(txnDb).load(characterId);
    if (sheet === undefined) {
      throw new FlexibleCastingError(
        `no character sheet stored for '${characterId}'`,
      );
    }
    if (sheet.class.key !== SORCERER_CLASS) {
      throw new FlexibleCastingError(
        'Flexible Casting is a sorcerer feature; this character is not a sorcerer',
      );
    }
    if (sheet.level < 2) {
      throw new FlexibleCastingError(
        'Flexible Casting (Font of Magic) begins at sorcerer level 2',
      );
    }
    const hit = lookupStrictCampaignRecord(
      txnDb,
      'feature',
      FONT_OF_MAGIC_KEY,
      resolveRulesPack,
    );
    if (hit === undefined) {
      throw new FlexibleCastingError(
        `the campaign rules binding has no '${FONT_OF_MAGIC_KEY}' record`,
      );
    }
    const resolver = createRulesPackCharacterResolver(hit.stack);
    const classRow = resolver.resolveClassLevel(sheet.class.key, sheet.level);
    if (!classRow.ok) {
      throw new FlexibleCastingError(
        `cannot resolve sorcerer level ${sheet.level}: ${classRow.message}`,
      );
    }
    const mutation = {
      provenance: input.provenance,
      sessionId: input.sessionId,
      at: input.at,
    };
    // Read the balance through the usage owner so legacy/alias counters are
    // adopted into the canonical record and the maximum comes from the active
    // campaign class table, exactly as spend_usage would.
    const balance = readBoundClassResourceBalance(txnDb, {
      ...mutation,
      campaignId: input.campaignId,
      characterId,
      ability: SORCERY_POINTS_ABILITY,
      ...(resolveRulesPack === undefined ? {} : { resolveRulesPack }),
    });
    if (balance === undefined) {
      throw new FlexibleCastingError(
        `the class table gives no sorcery points at level ${sheet.level}`,
      );
    }
    const currentPoints = balance.max - balance.used;
    // The procedure carries its own per-level ceiling; the active class table
    // owns the counter. If they disagree (a class-only or feature-only add-on)
    // refuse before consuming anything rather than let a conversion's declared
    // point gain be clamped or its ceiling check use the wrong economy.
    const procedureMax = resourceConversionMaximum(
      hit.record.data,
      sheet.level,
    );
    if (procedureMax !== balance.max) {
      throw new FlexibleCastingError(
        `inconsistent rules binding: the Font of Magic procedure gives ${procedureMax ?? 'no'} sorcery points at level ${sheet.level} but the active class table gives ${balance.max}; Flexible Casting is refused until the binding agrees`,
      );
    }

    const slotContext = { ...mutation, characterId, resolver };
    const usage = {
      ...mutation,
      campaignId: input.campaignId,
      owner: { kind: 'character' as const, ref: characterId },
      ability: SORCERY_POINTS_ABILITY,
      ...(resolveRulesPack === undefined ? {} : { resolveRulesPack }),
    };

    try {
      if (input.operation === 'create-slot') {
        const transition = executeBoundedProcedure(hit.record.data, {
          kind: 'create-spell-slot',
          classLevel: sheet.level,
          currentPoints,
          slotLevel: input.slotLevel,
        });
        if (transition.kind !== 'resource-transition') {
          throw new FlexibleCastingError('unexpected Flexible Casting result');
        }
        const spent = spendUsage(txnDb, {
          ...usage,
          uses: -transition.pointDelta,
        });
        if (spent.counter === undefined) {
          throw new FlexibleCastingError(
            'sorcery points are unlimited at this level; nothing to convert',
          );
        }
        assertPointChange(spent.counter, currentPoints, transition.pointDelta);
        const slot = addCreatedSpellSlot(txnDb, {
          ...slotContext,
          slotLevel: input.slotLevel,
        });
        return {
          operation: input.operation,
          slotLevel: input.slotLevel,
          pointDelta: transition.pointDelta,
          sorceryPoints: pointsOf(spent.counter),
          slot,
          actionCost: transition.actionCost,
          ...(transition.createdSlotExpires === undefined
            ? {}
            : { createdSlotExpires: transition.createdSlotExpires }),
        };
      }
      // The slot count only matters as "at least one": the evaluator needs a
      // positive integer, and availability is enforced by the expenditure.
      const transition = executeBoundedProcedure(hit.record.data, {
        kind: 'convert-spell-slot',
        classLevel: sheet.level,
        currentPoints,
        slotLevel: input.slotLevel,
        currentSlotCount: 1,
      });
      if (transition.kind !== 'resource-transition') {
        throw new FlexibleCastingError('unexpected Flexible Casting result');
      }
      const slot = expendSpellSlotAtLevel(txnDb, {
        ...slotContext,
        slotLevel: input.slotLevel,
      });
      // The evaluator's ceiling check guarantees a counter row exists here
      // (an absent counter means full points, so the conversion was refused).
      const restored = restoreUsage(txnDb, {
        ...usage,
        amount: transition.pointDelta,
      });
      assertPointChange(restored.counter, currentPoints, transition.pointDelta);
      return {
        operation: input.operation,
        slotLevel: input.slotLevel,
        pointDelta: transition.pointDelta,
        sorceryPoints: pointsOf(restored.counter),
        slot,
        actionCost: transition.actionCost,
      };
    } catch (e) {
      if (e instanceof BoundedProcedureError) {
        throw new FlexibleCastingError(e.message);
      }
      if (e instanceof SpellSlotError) {
        throw new FlexibleCastingError(e.message);
      }
      throw e;
    }
  });
}

/** Defensive: the persisted point change must equal the declared delta; throw
 *  (rolling the transaction back) rather than report a clamped conversion. */
function assertPointChange(
  counter: UsageCounter,
  before: number,
  pointDelta: number,
): void {
  if (counter.usesRemaining - before !== pointDelta) {
    throw new Error(
      `Flexible Casting persisted a point change of ${counter.usesRemaining - before}, expected ${pointDelta}`,
    );
  }
}

function pointsOf(counter: UsageCounter): {
  remaining: number;
  max: number;
} {
  return { remaining: counter.usesRemaining, max: counter.usesMax };
}
