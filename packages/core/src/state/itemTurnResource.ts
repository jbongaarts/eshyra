/**
 * Which turn resource a magic-item operation spends (eshyra-olc5.9, bd memory
 * magic-item-faithful-or-absent; capability contract in eshyra-olc5).
 *
 * Operation: given one pack-bound item operation, decide -- from TYPED pack
 * fields only -- which of the acting participant's turn resources `use_item`
 * must spend in structured combat, so the DM cannot also bill it by hand.
 *
 * Inputs (pack fields, never prose):
 *   - `operation.activation.cost`: 'action' | 'bonus-action' | 'reaction' are
 *     spendable; 'free' and 'consume' spend nothing automatically.
 *   - the operation's `castSpell` effects carrying a single typed `spellRef`.
 *     Its record's `castingTime` is the cost only when no activation cost is
 *     typed (action / bonus action / reaction casting times; anything longer
 *     is DM-adjudicated and spends nothing).
 *
 * Exclusions / residual DM interpretation: an operation with no typed cost and
 * no bound spell spends nothing (DM-adjudicated activation). A `castSpell`
 * effect that lists `spellRefs` (a DM-selected spell, e.g. Necklace of Prayer
 * Beads) or names a spell under another key binds no `spellRef`, so the
 * bonus-action-spell rule for that cast is DM-adjudicated.
 *
 * Fail-closed: a typed activation cost that DIFFERS from the bound spell's
 * casting time is a contradiction. It is refused unless the pack row is in
 * {@link PRINTED_CASTING_TIME_OVERRIDES}, the reviewed set of rows whose
 * printed item text explicitly changes the casting time. An action that
 * merely expends charges to cast does not change the spell's normal casting
 * time. More than one distinct bound `spellRef` on one operation is ambiguous
 * and refused.
 */

export type ItemTurnResource = 'action' | 'bonus_action' | 'reaction';

export type ItemTurnResourceNotSpentReason =
  | 'not-in-combat'
  | 'free-activation'
  | 'consumed-item'
  | 'casting-time-dm-adjudicated';

export type ItemTurnResourcePlan =
  /** The operation carries neither a typed activation cost nor a bound spell. */
  | { readonly kind: 'absent' }
  | {
      readonly kind: 'not-spent';
      readonly reason: ItemTurnResourceNotSpentReason;
      readonly spellRef?: string;
      readonly castingTime?: string;
    }
  | {
      readonly kind: 'spend';
      readonly resource: ItemTurnResource;
      readonly source: 'activation-cost' | 'spell-casting-time';
      readonly spellRef?: string;
      /** Set when the printed activation overrides the bound spell's casting
       *  time (a reviewed {@link PRINTED_CASTING_TIME_OVERRIDES} row). */
      readonly castingTimeOverride?: {
        readonly spellRef: string;
        readonly castingTime: string;
      };
      /** The effect lists several candidate spells chosen at play time. */
      readonly spellSelectedByDm?: true;
    };

export class ItemTurnResourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItemTurnResourceError';
  }
}

/**
 * Pack rows (`<item key>#<operation id>`) whose typed activation cost differs
 * from the bound spell's casting time AND whose printed item text explicitly
 * changes that casting time. Evidence is the activation census
 * (magicItemActivationCensus.json costSentence) for each row:
 *   - elemental-gem break-gem: "When you use an action to break the gem, an
 *     elemental is summoned as if you had cast the conjure elemental spell"
 *   - ring-of-jumping cast-jump: "you can cast the jump spell from it as a
 *     bonus action"
 * A contradiction NOT in this set fails closed. A test asserts this set equals
 * exactly the contradictions computed from the bundled pack.
 */
export const PRINTED_CASTING_TIME_OVERRIDES: ReadonlySet<string> = new Set([
  'magic-item:elemental-gem#break-gem',
  'magic-item:ring-of-jumping#cast-jump',
]);

const COST_TO_RESOURCE: Readonly<Record<string, ItemTurnResource>> = {
  action: 'action',
  'bonus-action': 'bonus_action',
  reaction: 'reaction',
};

/** The turn resource a spell's printed casting time spends, or undefined when
 *  it is not one of action / bonus action / reaction (longer times, or the
 *  alternative "1 action or 8 hours"). */
export function turnResourceForCastingTime(
  castingTime: string,
): ItemTurnResource | undefined {
  const normalized = castingTime.trim().toLowerCase();
  if (normalized === '1 action') return 'action';
  if (normalized === '1 bonus action') return 'bonus_action';
  if (normalized === '1 reaction' || normalized.startsWith('1 reaction,'))
    return 'reaction';
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Typed `spellRef` values of the operation's castSpell effects, plus whether
 *  a castSpell effect binds a DM-selected spell list instead. */
function boundSpells(effects: readonly unknown[]): {
  readonly spellRefs: readonly string[];
  readonly dmSelected: boolean;
} {
  const spellRefs = new Set<string>();
  let dmSelected = false;
  for (const effect of effects) {
    if (!isObject(effect) || effect.kind !== 'castSpell') continue;
    if (typeof effect.spellRef === 'string') spellRefs.add(effect.spellRef);
    else if (Array.isArray(effect.spellRefs)) dmSelected = true;
  }
  return { spellRefs: [...spellRefs], dmSelected };
}

export interface PlanItemTurnResourceInput {
  readonly itemKey: string;
  readonly operation: Readonly<Record<string, unknown>>;
  /** The operation's resolved effect records (operation-level only). */
  readonly effects: readonly unknown[];
  readonly inCombat: boolean;
  /** Spell record -> printed casting time; undefined when unresolvable. Only
   *  called in combat, when a bound spell's casting time is needed. */
  readonly castingTimeOf: (spellRef: string) => string | undefined;
  readonly overrides?: ReadonlySet<string>;
}

export function planItemTurnResource(
  input: PlanItemTurnResourceInput,
): ItemTurnResourcePlan {
  const activation = isObject(input.operation.activation)
    ? input.operation.activation
    : undefined;
  const cost =
    typeof activation?.cost === 'string' ? activation.cost : undefined;
  const bound = boundSpells(input.effects);
  const operationId = String(input.operation.id);
  if (bound.spellRefs.length > 1)
    throw new ItemTurnResourceError(
      `${input.itemKey} operation '${operationId}' binds several spells (${bound.spellRefs.join(', ')}); the turn resource cannot be derived, so use_item refuses to guess`,
    );
  const spellRef = bound.spellRefs[0];

  if (cost === 'free') return { kind: 'not-spent', reason: 'free-activation' };
  if (cost === 'consume') return { kind: 'not-spent', reason: 'consumed-item' };
  const typed = cost === undefined ? undefined : COST_TO_RESOURCE[cost];
  if (cost !== undefined && typed === undefined)
    throw new ItemTurnResourceError(
      `${input.itemKey} operation '${operationId}' has unrecognized activation cost '${cost}'`,
    );
  if (typed === undefined && spellRef === undefined) return { kind: 'absent' };
  if (!input.inCombat)
    return {
      kind: 'not-spent',
      reason: 'not-in-combat',
      ...(spellRef === undefined ? {} : { spellRef }),
    };

  let castingTime: string | undefined;
  if (spellRef !== undefined) {
    castingTime = input.castingTimeOf(spellRef);
    if (castingTime === undefined)
      throw new ItemTurnResourceError(
        `${input.itemKey} operation '${operationId}' casts '${spellRef}', which does not resolve to a spell record with a casting time in the campaign rules stack`,
      );
  }

  if (typed === undefined) {
    // No typed cost: the bound spell's ordinary casting time governs.
    const resource = turnResourceForCastingTime(castingTime ?? '');
    if (resource === undefined)
      return {
        kind: 'not-spent',
        reason: 'casting-time-dm-adjudicated',
        ...(spellRef === undefined ? {} : { spellRef }),
        ...(castingTime === undefined ? {} : { castingTime }),
      };
    return {
      kind: 'spend',
      resource,
      source: 'spell-casting-time',
      ...(spellRef === undefined ? {} : { spellRef }),
    };
  }

  let castingTimeOverride:
    | { readonly spellRef: string; readonly castingTime: string }
    | undefined;
  if (spellRef !== undefined && castingTime !== undefined) {
    if (turnResourceForCastingTime(castingTime) !== typed) {
      const row = `${input.itemKey}#${operationId}`;
      if (!(input.overrides ?? PRINTED_CASTING_TIME_OVERRIDES).has(row))
        throw new ItemTurnResourceError(
          `${input.itemKey} operation '${operationId}' prints activation '${cost}' but casts '${spellRef}' (casting time '${castingTime}'): the pack does not establish which governs, so the turn resource is not spent automatically`,
        );
      castingTimeOverride = { spellRef, castingTime };
    }
  }
  return {
    kind: 'spend',
    resource: typed,
    source: 'activation-cost',
    ...(spellRef === undefined ? {} : { spellRef }),
    ...(castingTimeOverride === undefined ? {} : { castingTimeOverride }),
    ...(bound.dmSelected && spellRef === undefined
      ? { spellSelectedByDm: true as const }
      : {}),
  };
}
