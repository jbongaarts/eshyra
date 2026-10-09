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
} from '../rules/boundedProcedures.js';
import { resolveCharacterId } from './activeCharacter.js';
import {
  type CampaignRulesPackResolver,
  lookupStrictCampaignRecord,
} from './campaignRecordLookup.js';
import {
  classResourceBindingsFor,
  classResourceCapacity,
} from './classResources.js';
import {
  addCreatedSpellSlot,
  expendSpellSlotAtLevel,
  type SpellSlotCounter,
  SpellSlotError,
} from './spellSlots.js';
import {
  restoreUsage,
  spendUsage,
  type UsageCounter,
} from './usageCounters.js';

export const FONT_OF_MAGIC_KEY = 'feature:sorcerer:font-of-magic';
const SORCERER_CLASS = 'class:sorcerer';
const SORCERY_POINTS_ABILITY = 'sorcery-points';
const SORCERY_POINTS_COUNTER = 'ability:sorcery-points';

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
      input.resolveRulesPack,
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
    const binding = classResourceBindingsFor(SORCERER_CLASS)[0];
    const capacity =
      binding === undefined
        ? undefined
        : classResourceCapacity(binding, classRow.record);
    if (capacity?.kind !== 'count') {
      throw new FlexibleCastingError(
        `the class table gives no sorcery points at level ${sheet.level}`,
      );
    }
    const max = capacity.value;
    const counter = txnDb
      .prepare(
        `SELECT uses_used FROM entity_usage_counter
         WHERE campaign_id = ? AND owner_kind = 'character' AND owner_ref = ?
           AND counter_key = ?`,
      )
      .get(input.campaignId, characterId, SORCERY_POINTS_COUNTER) as
      | { uses_used: number }
      | undefined;
    const currentPoints = Math.max(
      0,
      max - Math.min(counter?.uses_used ?? 0, max),
    );

    const mutation = {
      provenance: input.provenance,
      sessionId: input.sessionId,
      at: input.at,
    };
    const slotContext = { ...mutation, characterId, resolver };
    const usage = {
      ...mutation,
      campaignId: input.campaignId,
      owner: { kind: 'character' as const, ref: characterId },
      ability: SORCERY_POINTS_ABILITY,
      ...(input.resolveRulesPack === undefined
        ? {}
        : { resolveRulesPack: input.resolveRulesPack }),
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

function pointsOf(counter: UsageCounter): {
  remaining: number;
  max: number;
} {
  return { remaining: counter.usesRemaining, max: counter.usesMax };
}
