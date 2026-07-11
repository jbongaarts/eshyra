// Durable per-entity usage counters and reset events (eshyra-2n1t.7, engine
// family F5; source: docs/audits/dnd5e-srd-5.1-final/
// 2026-07-06-o9bd-18-7-8-execution-boundary-classification.md §4).
//
// SRD 5.1 semantics, code-owned so the model can never silently violate them
// (limited-usage, charges, and the innate-spellcasting X/Day economies —
// single-owner factoring per the classification):
//
// - X/Day means X uses, regained at dawn (limited-usage). Innate
//   per-day spell groups are the same economy keyed per spell ("3/day
//   each") or shared across the group when the statblock pools them.
// - Recharge X–Y abilities have one use; at the start of each of the
//   monster's turns the DM rolls a d6 (through the `roll` tool — all dice
//   are code-owned) and the ability recharges on X–Y. It also recharges on
//   a short or long rest (limited-usage). The engine stores the threshold
//   from the record and judges the passed natural roll.
// - "Recharge after a Short or Long Rest" is one use restored by either
//   rest (limited-usage).
// - Item charges are the same counter with a partial-recharge wrinkle:
//   "regains 1d6 + 1 expended charges daily at dawn" restores a rolled
//   amount, not a full reset, so formula counters are surfaced at dawn for
//   a rolled `restoreUsage` instead of being zeroed (charges; the pack-side
//   charge data clause is eshyra-o9bd.18.7.7.1, so until it lands the DM
//   declares an item's economy on first spend after `lookup_rules`).
//
// Economy provenance is fail-closed the same way F2 treats spell timing:
// a combatant's economy is derived structurally from its creature record
// (usage.perDay, mechanics.recharge, usage.rechargeAfterRest, innate
// spellcasting per-day groups) and a declared economy is rejected where the
// record already owns one. Character abilities and item charges have no
// structured pack source yet, so their first spend requires an explicit
// declared economy (maxUses + reset) — the validated-runtime-grant pattern
// setReactionAllowance established — which is then durable.
//
// Reset events (shared vocabulary with F6/F7 per the classification): the
// turn-start recharge roll, short rest, long rest, and dawn. `resetUsage`
// applies rest/dawn events today (the DM narrates the rest) and is the
// primitive the F7 rest engine will orchestrate. A short or long rest also
// recharges Recharge X–Y abilities (SRD limited-usage). Long rests restore
// short-rest economies too; per-day economies belong to dawn, not to the
// rest itself.
//
// The legendary-action per-round economy lives with the rest of the combat
// turn budget in `actionEconomy.ts` (encounter-scoped, reset by beginTurn),
// not here: these counters are cross-session durable state.

import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { resolveCharacterId } from './activeCharacter.js';
import { lookupCampaignRecord } from './campaignRecordLookup.js';
import type { LifeState } from './hpLifecycle.js';

export type UsageOwnerKind = 'character' | 'combatant';

export interface UsageOwner {
  readonly kind: UsageOwnerKind;
  readonly ref: string;
}

/** Owner selector as tools pass it: a combatant needs its exact id, while a
 *  character ref is optional and defaults to the acting character. */
export interface UsageOwnerInput {
  readonly kind: UsageOwnerKind;
  readonly ref?: string;
}

export type UsageResetKind =
  | 'recharge_roll'
  | 'short_rest'
  | 'short_or_long_rest'
  | 'long_rest'
  | 'dawn';

export type UsageResetEvent = 'short_rest' | 'long_rest' | 'dawn';

export interface UsageCounter {
  readonly owner: UsageOwner;
  readonly ownerLabel: string;
  readonly counterKey: string;
  readonly displayName: string;
  readonly usesMax: number;
  readonly usesUsed: number;
  readonly usesRemaining: number;
  readonly resetKind: UsageResetKind;
  readonly rechargeRoll: string | undefined;
  readonly rechargeMinimum: number | undefined;
  readonly rechargeFormula: string | undefined;
  readonly source: 'record' | 'declared';
}

export interface UsageMutationContext {
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

/** Economy declaration for abilities/items the pack does not structure:
 *  required on the first spend, rejected once the counter exists and always
 *  rejected where the creature record owns the economy. */
export interface DeclaredUsageEconomy {
  readonly maxUses: number;
  readonly reset: UsageResetKind;
  /** Required when reset is 'recharge_roll': recharge on rolls >= this. */
  readonly rechargeMinimum?: number;
  /** Partial dawn recharge, e.g. "1d6+1" (charges); only with reset 'dawn'. */
  readonly rechargeFormula?: string;
}

export interface SpendUsageInput extends UsageMutationContext {
  readonly campaignId: string;
  readonly owner: UsageOwnerInput;
  /** Ability/feature/spell name as the statblock prints it (e.g. "Fire
   *  Breath", "misty step"). Omitted only for item-charge spends. */
  readonly ability?: string;
  /** Inventory item id for item-charge spends (owner must be a character
   *  holding the item). */
  readonly itemId?: string;
  /** Uses/charges expended (default 1; wands can spend several at once). */
  readonly uses?: number;
  readonly declared?: DeclaredUsageEconomy;
}

export interface SpendUsageResult {
  readonly counter: UsageCounter;
  /** Set when the spend consumed the last use: how the ability comes back. */
  readonly depletedHint?: string;
}

export interface RestoreUsageInput extends UsageMutationContext {
  readonly campaignId: string;
  readonly owner: UsageOwnerInput;
  readonly ability?: string;
  readonly itemId?: string;
  /** Natural recharge-die result (rolled via the `roll` tool) for a
   *  recharge_roll counter. Mutually exclusive with `amount`. */
  readonly roll?: number;
  /** Uses/charges regained (e.g. the rolled "1d6 + 1" dawn recharge, or a
   *  DM ruling). Mutually exclusive with `roll`. */
  readonly amount?: number;
}

export interface RestoreUsageResult {
  readonly counter: UsageCounter;
  /** For roll mode: whether the recharge threshold was met. */
  readonly recharged?: boolean;
  readonly rechargeThreshold?: string;
}

export interface ResetUsageInput extends UsageMutationContext {
  readonly campaignId: string;
  readonly event: UsageResetEvent;
  /** Narrow the reset to one owner. Default scope: rests reset every
   *  character-owned counter (the party rests; a monster's rest is recorded
   *  by scoping to it); dawn resets every owner's per-day counters. */
  readonly owner?: UsageOwnerInput;
}

export interface ResetUsageResult {
  readonly event: UsageResetEvent;
  /** Counters restored to full by this event. */
  readonly reset: readonly UsageCounter[];
  /** Dawn counters with a partial-recharge formula: not zeroed — the DM
   *  rolls the formula via `roll` and applies it with restoreUsage. */
  readonly needsRolledRestore: readonly UsageCounter[];
}

export class UsageCounterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageCounterError';
  }
}

const RESET_KINDS: readonly UsageResetKind[] = [
  'recharge_roll',
  'short_rest',
  'short_or_long_rest',
  'long_rest',
  'dawn',
];

/** Which stored reset kinds each reset event restores. Rests also recharge
 *  Recharge X–Y abilities (SRD limited-usage); dawn owns per-day economies. */
const EVENT_RESETS: Readonly<
  Record<UsageResetEvent, readonly UsageResetKind[]>
> = {
  short_rest: ['recharge_roll', 'short_rest', 'short_or_long_rest'],
  long_rest: ['recharge_roll', 'short_rest', 'short_or_long_rest', 'long_rest'],
  dawn: ['dawn'],
};

interface CounterRow {
  readonly owner_kind: UsageOwnerKind;
  readonly owner_ref: string;
  readonly counter_key: string;
  readonly display_name: string;
  readonly uses_max: number;
  readonly uses_used: number;
  readonly reset_kind: UsageResetKind;
  readonly recharge_roll: string | null;
  readonly recharge_minimum: number | null;
  readonly recharge_formula: string | null;
  readonly source: 'record' | 'declared';
}

const COUNTER_COLUMNS = `owner_kind, owner_ref, counter_key, display_name,
       uses_max, uses_used, reset_kind, recharge_roll, recharge_minimum,
       recharge_formula, source`;

function rowToCounter(row: CounterRow, ownerLabel: string): UsageCounter {
  return {
    owner: { kind: row.owner_kind, ref: row.owner_ref },
    ownerLabel,
    counterKey: row.counter_key,
    displayName: row.display_name,
    usesMax: row.uses_max,
    usesUsed: row.uses_used,
    usesRemaining: row.uses_max - row.uses_used,
    resetKind: row.reset_kind,
    rechargeRoll: row.recharge_roll ?? undefined,
    rechargeMinimum: row.recharge_minimum ?? undefined,
    rechargeFormula: row.recharge_formula ?? undefined,
    source: row.source,
  };
}

/** Normalize an ability/spell name for matching: parentheticals like
 *  "(Recharge 5–6)" or "(3/Day)" are display metadata, not identity. */
function normalizeAbilityName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function spellRefSlug(ref: string): string {
  return ref.replace(/^spell:/, '');
}

function spellDisplayName(ref: string): string {
  return spellRefSlug(ref).replace(/-/g, ' ');
}

/** A structurally derived economy from a creature record, or the reason no
 *  counter applies. */
type DerivedEconomy =
  | {
      readonly kind: 'economy';
      readonly counterKey: string;
      readonly displayName: string;
      readonly usesMax: number;
      readonly resetKind: UsageResetKind;
      readonly rechargeRoll?: string;
      readonly rechargeMinimum?: number;
    }
  | { readonly kind: 'at-will'; readonly name: string }
  | { readonly kind: 'legendary'; readonly name: string }
  | { readonly kind: 'unlimited'; readonly name: string }
  | { readonly kind: 'none' };

interface RecordEntry {
  readonly name?: unknown;
  readonly mechanics?: unknown;
}

function asRecordObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function entryLists(data: Record<string, unknown>): {
  entries: RecordEntry[];
  legendaryEntries: RecordEntry[];
} {
  const entries: RecordEntry[] = [];
  for (const listKey of ['traits', 'actions', 'reactions'] as const) {
    const list = data[listKey];
    if (Array.isArray(list)) {
      entries.push(...(list as RecordEntry[]));
    }
  }
  const legendary = asRecordObject(data.legendaryActions);
  const legendaryEntries = Array.isArray(legendary?.entries)
    ? (legendary.entries as RecordEntry[])
    : [];
  return { entries, legendaryEntries };
}

/** Collect every innate-spellcasting block anywhere in a record's data. */
function collectInnateSpellcasting(
  value: unknown,
  found: Record<string, unknown>[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectInnateSpellcasting(item, found);
    }
    return;
  }
  const record = asRecordObject(value);
  if (record === undefined) {
    return;
  }
  if (record.mode === 'innate' && Array.isArray(record.groups)) {
    found.push(record);
    return;
  }
  for (const nested of Object.values(record)) {
    collectInnateSpellcasting(nested, found);
  }
}

function economyFromEntryMechanics(
  entryName: string,
  mechanics: Record<string, unknown>,
): DerivedEconomy | undefined {
  const slug = normalizeAbilityName(entryName);
  const usage = asRecordObject(mechanics.usage);
  if (usage !== undefined && typeof usage.perDay === 'number') {
    return {
      kind: 'economy',
      counterKey: slug,
      displayName: `${entryName.replace(/\s*\([^)]*\)\s*$/, '')} (${usage.perDay}/Day)`,
      usesMax: usage.perDay,
      resetKind: 'dawn',
    };
  }
  const recharge = asRecordObject(mechanics.recharge);
  if (
    recharge !== undefined &&
    typeof recharge.minimum === 'number' &&
    typeof recharge.roll === 'string'
  ) {
    return {
      kind: 'economy',
      counterKey: slug,
      displayName: entryName,
      usesMax: 1,
      resetKind: 'recharge_roll',
      rechargeRoll: recharge.roll,
      rechargeMinimum: recharge.minimum,
    };
  }
  if (usage !== undefined && typeof usage.rechargeAfterRest === 'string') {
    return {
      kind: 'economy',
      counterKey: slug,
      displayName: entryName,
      usesMax: 1,
      resetKind:
        usage.rechargeAfterRest === 'long-rest'
          ? 'long_rest'
          : 'short_or_long_rest',
    };
  }
  return undefined;
}

/**
 * Derive the requested ability's usage economy from a creature record.
 * Matches statblock entries by normalized name, then innate-spellcasting
 * per-day groups by spell name/ref (each-spell counters, or one shared
 * counter when the group is pooled).
 */
export function deriveUsageEconomy(
  data: unknown,
  abilityName: string,
): DerivedEconomy {
  const record = asRecordObject(data);
  if (record === undefined) {
    return { kind: 'none' };
  }
  const requested = normalizeAbilityName(abilityName);
  if (requested.length === 0) {
    return { kind: 'none' };
  }

  const { entries, legendaryEntries } = entryLists(record);
  for (const entry of entries) {
    if (
      typeof entry.name !== 'string' ||
      normalizeAbilityName(entry.name) !== requested
    ) {
      continue;
    }
    const mechanics = asRecordObject(entry.mechanics);
    const economy =
      mechanics === undefined
        ? undefined
        : economyFromEntryMechanics(entry.name, mechanics);
    if (economy !== undefined) {
      return economy;
    }
    return { kind: 'unlimited', name: entry.name };
  }
  for (const entry of legendaryEntries) {
    if (
      typeof entry.name !== 'string' ||
      normalizeAbilityName(entry.name) !== requested
    ) {
      continue;
    }
    return { kind: 'legendary', name: entry.name };
  }

  const innateBlocks: Record<string, unknown>[] = [];
  collectInnateSpellcasting(record, innateBlocks);
  for (const block of innateBlocks) {
    for (const groupValue of block.groups as unknown[]) {
      const group = asRecordObject(groupValue);
      if (group === undefined || !Array.isArray(group.spells)) {
        continue;
      }
      const refs: string[] = [];
      let matched = false;
      for (const spellValue of group.spells) {
        const spell = asRecordObject(spellValue);
        const ref = typeof spell?.ref === 'string' ? spell.ref : undefined;
        if (ref === undefined) {
          continue;
        }
        refs.push(ref);
        if (
          normalizeAbilityName(spellRefSlug(ref)) === requested ||
          normalizeAbilityName(ref) === requested
        ) {
          matched = true;
        }
      }
      if (!matched) {
        continue;
      }
      if (group.frequency === 'at-will') {
        return { kind: 'at-will', name: abilityName };
      }
      if (group.frequency !== 'per-day' || typeof group.uses !== 'number') {
        return { kind: 'unlimited', name: abilityName };
      }
      const matchedRef = refs.find(
        (ref) =>
          normalizeAbilityName(spellRefSlug(ref)) === requested ||
          normalizeAbilityName(ref) === requested,
      ) as string;
      if (group.each === true) {
        return {
          kind: 'economy',
          counterKey: `innate:${matchedRef}`,
          displayName: `Innate: ${spellDisplayName(matchedRef)} (${group.uses}/Day)`,
          usesMax: group.uses,
          resetKind: 'dawn',
        };
      }
      const sorted = refs.map(spellRefSlug).sort();
      return {
        kind: 'economy',
        counterKey: `innate:group:${sorted.join('+')}`,
        displayName: `Innate: ${refs.map(spellDisplayName).join(', ')} (shared ${group.uses}/Day)`,
        usesMax: group.uses,
        resetKind: 'dawn',
      };
    }
  }

  return { kind: 'none' };
}

interface ResolvedOwner {
  readonly owner: UsageOwner;
  readonly ownerLabel: string;
  readonly rulesRef: string | undefined;
}

function resolveOwner(
  db: Db,
  campaignId: string,
  input: UsageOwnerInput,
): ResolvedOwner {
  if (input.kind === 'combatant') {
    if (input.ref === undefined || input.ref.length === 0) {
      throw new UsageCounterError('a combatant owner needs its ref');
    }
    const combatant = db
      .prepare(
        `SELECT display_label, status, rules_ref
         FROM encounter_combatant
         WHERE campaign_id = ? AND combatant_id = ?`,
      )
      .get(campaignId, input.ref) as
      | { display_label: string; status: string; rules_ref: string }
      | undefined;
    if (combatant === undefined) {
      throw new UsageCounterError(
        `unknown combatant '${input.ref}' in this campaign`,
      );
    }
    if (combatant.status === 'dead') {
      throw new UsageCounterError(
        `combatant '${input.ref}' is dead; its abilities spend nothing`,
      );
    }
    return {
      owner: { kind: 'combatant', ref: input.ref },
      ownerLabel: combatant.display_label,
      rulesRef: combatant.rules_ref,
    };
  }

  const charId = resolveCharacterId(db, input.ref);
  const character = db
    .prepare('SELECT name, life_state FROM character WHERE id = ?')
    .get(charId) as { name: string | null; life_state: LifeState } | undefined;
  if (character === undefined) {
    throw new UsageCounterError(`no character row exists for '${charId}'`);
  }
  if (character.life_state === 'dead') {
    throw new UsageCounterError(
      `character '${character.name ?? charId}' is dead`,
    );
  }
  return {
    owner: { kind: 'character', ref: charId },
    ownerLabel: character.name ?? charId,
    rulesRef: undefined,
  };
}

function readCounterRow(
  db: Db,
  campaignId: string,
  owner: UsageOwner,
  counterKey: string,
): CounterRow | undefined {
  return db
    .prepare(
      `SELECT ${COUNTER_COLUMNS}
       FROM entity_usage_counter
       WHERE campaign_id = ? AND owner_kind = ? AND owner_ref = ?
         AND counter_key = ?`,
    )
    .get(campaignId, owner.kind, owner.ref, counterKey) as
    | CounterRow
    | undefined;
}

function listCounterRows(
  db: Db,
  campaignId: string,
  owner: UsageOwner,
): CounterRow[] {
  return db
    .prepare(
      `SELECT ${COUNTER_COLUMNS}
       FROM entity_usage_counter
       WHERE campaign_id = ? AND owner_kind = ? AND owner_ref = ?
       ORDER BY counter_key`,
    )
    .all(campaignId, owner.kind, owner.ref) as CounterRow[];
}

function validateDeclaredEconomy(declared: DeclaredUsageEconomy): void {
  if (!Number.isInteger(declared.maxUses) || declared.maxUses < 1) {
    throw new UsageCounterError('maxUses must be a positive integer');
  }
  if (!RESET_KINDS.includes(declared.reset)) {
    throw new UsageCounterError(
      `reset must be one of: ${RESET_KINDS.join(', ')}`,
    );
  }
  if (declared.reset === 'recharge_roll') {
    if (
      !Number.isInteger(declared.rechargeMinimum) ||
      (declared.rechargeMinimum as number) < 2 ||
      (declared.rechargeMinimum as number) > 6
    ) {
      throw new UsageCounterError(
        'a recharge_roll economy needs rechargeMinimum 2-6 (recharges on that d6 result or higher)',
      );
    }
  } else if (declared.rechargeMinimum !== undefined) {
    throw new UsageCounterError(
      'rechargeMinimum applies only to a recharge_roll economy',
    );
  }
  if (declared.rechargeFormula !== undefined && declared.reset !== 'dawn') {
    throw new UsageCounterError(
      "rechargeFormula (partial recharge, e.g. '1d6+1') applies only to a dawn economy",
    );
  }
}

/** How a depleted counter comes back, phrased for the DM. */
function depletedHintFor(counter: UsageCounter): string {
  switch (counter.resetKind) {
    case 'recharge_roll':
      return (
        `${counter.displayName} is spent: at the start of ${counter.ownerLabel}'s turns, roll ` +
        `${counter.rechargeRoll ?? 'd6'} via the roll tool and pass the natural result to restore_usage ` +
        `(recharges on ${counter.rechargeMinimum}+; also recharges on a short or long rest)`
      );
    case 'short_rest':
      return `${counter.displayName} is spent until a short rest (reset_usage)`;
    case 'short_or_long_rest':
      return `${counter.displayName} is spent until a short or long rest (reset_usage)`;
    case 'long_rest':
      return `${counter.displayName} is spent until a long rest (reset_usage)`;
    case 'dawn':
      return counter.rechargeFormula === undefined
        ? `${counter.displayName} is spent until dawn (reset_usage)`
        : `${counter.displayName} is out of charges until dawn: roll ${counter.rechargeFormula} via the roll tool and apply it with restore_usage`;
  }
}

/** Resolve the counter a spend/restore targets: item spends key on the
 *  inventory row; ability spends derive the canonical key from the creature
 *  record when one owns the economy. Returns the key plus, for a first
 *  spend, everything needed to create the row. */
function resolveCounterTarget(
  db: Db,
  campaignId: string,
  resolved: ResolvedOwner,
  input: {
    ability?: string;
    itemId?: string;
    declared?: DeclaredUsageEconomy;
  },
): {
  counterKey: string;
  create?: {
    displayName: string;
    usesMax: number;
    resetKind: UsageResetKind;
    rechargeRoll?: string;
    rechargeMinimum?: number;
    rechargeFormula?: string;
    source: 'record' | 'declared';
  };
} {
  if (input.itemId !== undefined) {
    if (resolved.owner.kind !== 'character') {
      throw new UsageCounterError(
        'item charges belong to the character holding the item; pass character, not combatantId',
      );
    }
    const item = db
      .prepare('SELECT name FROM inventory WHERE id = ? AND character_id = ?')
      .get(input.itemId, resolved.owner.ref) as { name: string } | undefined;
    if (item === undefined) {
      throw new UsageCounterError(
        `${resolved.ownerLabel} holds no inventory item '${input.itemId}'`,
      );
    }
    const counterKey = `item:${input.itemId}`;
    const existing = readCounterRow(db, campaignId, resolved.owner, counterKey);
    if (existing !== undefined) {
      if (input.declared !== undefined) {
        throw new UsageCounterError(
          `${item.name} already has a recorded charge economy (${existing.uses_max} max, ${existing.reset_kind}); omit maxUses/reset`,
        );
      }
      return { counterKey };
    }
    if (input.declared === undefined) {
      throw new UsageCounterError(
        `${item.name} has no recorded charge economy yet: look up the item via lookup_rules, then pass maxUses and reset (and rechargeFormula for partial dawn recharges like '1d6+1') on this first spend`,
      );
    }
    validateDeclaredEconomy(input.declared);
    return {
      counterKey,
      create: {
        displayName: `${item.name} charges`,
        usesMax: input.declared.maxUses,
        resetKind: input.declared.reset,
        ...(input.declared.reset === 'recharge_roll'
          ? {
              rechargeRoll: 'd6',
              rechargeMinimum: input.declared.rechargeMinimum,
            }
          : {}),
        ...(input.declared.rechargeFormula === undefined
          ? {}
          : { rechargeFormula: input.declared.rechargeFormula }),
        source: 'declared',
      },
    };
  }

  if (input.ability === undefined || input.ability.trim().length === 0) {
    throw new UsageCounterError('pass ability (the statblock name) or itemId');
  }

  if (resolved.rulesRef !== undefined) {
    const record = lookupCampaignRecord(db, 'creature', resolved.rulesRef);
    if (record !== undefined) {
      const derived = deriveUsageEconomy(record.data, input.ability);
      switch (derived.kind) {
        case 'economy': {
          if (input.declared !== undefined) {
            throw new UsageCounterError(
              `${resolved.ownerLabel}'s '${derived.displayName}' economy is owned by its rules record; omit maxUses/reset`,
            );
          }
          const existing = readCounterRow(
            db,
            campaignId,
            resolved.owner,
            derived.counterKey,
          );
          if (existing !== undefined) {
            return { counterKey: derived.counterKey };
          }
          return {
            counterKey: derived.counterKey,
            create: {
              displayName: derived.displayName,
              usesMax: derived.usesMax,
              resetKind: derived.resetKind,
              ...(derived.rechargeRoll === undefined
                ? {}
                : { rechargeRoll: derived.rechargeRoll }),
              ...(derived.rechargeMinimum === undefined
                ? {}
                : { rechargeMinimum: derived.rechargeMinimum }),
              source: 'record',
            },
          };
        }
        case 'at-will':
          throw new UsageCounterError(
            `${resolved.ownerLabel} casts '${derived.name}' at will per its record; there is no usage counter to spend`,
          );
        case 'legendary':
          throw new UsageCounterError(
            `'${derived.name}' is a legendary action: spend it via spend_turn_resource (resource legendary_action), not spend_usage`,
          );
        case 'unlimited':
          throw new UsageCounterError(
            `${resolved.ownerLabel}'s '${derived.name}' carries no usage limit in its rules record; nothing to spend`,
          );
        case 'none':
          break;
      }
    }
  }

  // No record-owned economy (character ability, or a combatant whose record
  // does not structure this ability): the declared-economy path.
  const counterKey = `ability:${normalizeAbilityName(input.ability)}`;
  const existing = readCounterRow(db, campaignId, resolved.owner, counterKey);
  if (existing !== undefined) {
    if (input.declared !== undefined) {
      throw new UsageCounterError(
        `'${existing.display_name}' already has a recorded economy (${existing.uses_max} max, ${existing.reset_kind}); omit maxUses/reset`,
      );
    }
    return { counterKey };
  }
  if (input.declared === undefined) {
    throw new UsageCounterError(
      `'${input.ability}' has no recorded usage economy for ${resolved.ownerLabel} yet: look up the feature via lookup_rules, then pass maxUses and reset on this first spend`,
    );
  }
  validateDeclaredEconomy(input.declared);
  return {
    counterKey,
    create: {
      displayName: input.ability,
      usesMax: input.declared.maxUses,
      resetKind: input.declared.reset,
      ...(input.declared.reset === 'recharge_roll'
        ? {
            rechargeRoll: 'd6',
            rechargeMinimum: input.declared.rechargeMinimum,
          }
        : {}),
      ...(input.declared.rechargeFormula === undefined
        ? {}
        : { rechargeFormula: input.declared.rechargeFormula }),
      source: 'declared',
    },
  };
}

function insertCounter(
  db: Db,
  campaignId: string,
  owner: UsageOwner,
  counterKey: string,
  create: NonNullable<ReturnType<typeof resolveCounterTarget>['create']>,
  ctx: UsageMutationContext,
): void {
  db.prepare(
    `INSERT INTO entity_usage_counter(
       campaign_id, owner_kind, owner_ref, counter_key, display_name,
       uses_max, uses_used, reset_kind, recharge_roll, recharge_minimum,
       recharge_formula, source, provenance, session_id, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    campaignId,
    owner.kind,
    owner.ref,
    counterKey,
    create.displayName,
    create.usesMax,
    create.resetKind,
    create.rechargeRoll ?? null,
    create.rechargeMinimum ?? null,
    create.rechargeFormula ?? null,
    create.source,
    ctx.provenance,
    ctx.sessionId,
    ctx.at,
  );
}

export function spendUsage(db: Db, input: SpendUsageInput): SpendUsageResult {
  const uses = input.uses ?? 1;
  if (!Number.isInteger(uses) || uses < 1) {
    throw new UsageCounterError('uses must be a positive integer');
  }
  return withTransaction(db, (txnDb) => {
    const resolved = resolveOwner(txnDb, input.campaignId, input.owner);
    const target = resolveCounterTarget(txnDb, input.campaignId, resolved, {
      ...(input.ability === undefined ? {} : { ability: input.ability }),
      ...(input.itemId === undefined ? {} : { itemId: input.itemId }),
      ...(input.declared === undefined ? {} : { declared: input.declared }),
    });
    if (target.create !== undefined) {
      insertCounter(
        txnDb,
        input.campaignId,
        resolved.owner,
        target.counterKey,
        target.create,
        input,
      );
    }
    const row = readCounterRow(
      txnDb,
      input.campaignId,
      resolved.owner,
      target.counterKey,
    );
    if (row === undefined) {
      throw new UsageCounterError('usage counter disappeared during spend');
    }
    const remaining = row.uses_max - row.uses_used;
    if (uses > remaining) {
      const counter = rowToCounter(row, resolved.ownerLabel);
      throw new UsageCounterError(
        remaining === 0
          ? `${resolved.ownerLabel} has no uses of '${row.display_name}' left (${row.uses_used}/${row.uses_max} spent). ${depletedHintFor(counter)}`
          : `${resolved.ownerLabel} has only ${remaining} use(s) of '${row.display_name}' left (${row.uses_used}/${row.uses_max} spent); cannot spend ${uses}`,
      );
    }
    txnDb
      .prepare(
        `UPDATE entity_usage_counter
         SET uses_used = uses_used + ?,
             provenance = ?, session_id = ?, updated_at = ?
         WHERE campaign_id = ? AND owner_kind = ? AND owner_ref = ?
           AND counter_key = ?`,
      )
      .run(
        uses,
        input.provenance,
        input.sessionId,
        input.at,
        input.campaignId,
        resolved.owner.kind,
        resolved.owner.ref,
        target.counterKey,
      );
    const after = readCounterRow(
      txnDb,
      input.campaignId,
      resolved.owner,
      target.counterKey,
    );
    if (after === undefined) {
      throw new UsageCounterError('usage counter disappeared during spend');
    }
    const counter = rowToCounter(after, resolved.ownerLabel);
    return {
      counter,
      ...(counter.usesRemaining === 0
        ? { depletedHint: depletedHintFor(counter) }
        : {}),
    };
  });
}

/** Find the single existing counter an ability/item reference names. */
function findCounter(
  db: Db,
  campaignId: string,
  resolved: ResolvedOwner,
  ref: { ability?: string; itemId?: string },
): CounterRow {
  if (ref.itemId !== undefined) {
    const row = readCounterRow(
      db,
      campaignId,
      resolved.owner,
      `item:${ref.itemId}`,
    );
    if (row === undefined) {
      throw new UsageCounterError(
        `no charge counter exists for item '${ref.itemId}' (a counter appears on its first spend_usage)`,
      );
    }
    return row;
  }
  if (ref.ability === undefined || ref.ability.trim().length === 0) {
    throw new UsageCounterError('pass ability (the statblock name) or itemId');
  }
  const slug = normalizeAbilityName(ref.ability);
  const rows = listCounterRows(db, campaignId, resolved.owner);
  const matches = rows.filter(
    (row) =>
      row.counter_key === slug ||
      row.counter_key === `ability:${slug}` ||
      row.counter_key === `innate:spell:${slug}` ||
      normalizeAbilityName(row.display_name) === slug ||
      (row.counter_key.startsWith('innate:group:') &&
        row.counter_key
          .slice('innate:group:'.length)
          .split('+')
          .includes(slug)),
  );
  if (matches.length === 1) {
    return matches[0];
  }
  const known = rows.map((row) => row.display_name).join(', ');
  throw new UsageCounterError(
    matches.length === 0
      ? `no usage counter matches '${ref.ability}' for ${resolved.ownerLabel}. Recorded counters: ${known || '(none)'}`
      : `'${ref.ability}' matches more than one counter for ${resolved.ownerLabel}: be more specific. Recorded counters: ${known}`,
  );
}

export function restoreUsage(
  db: Db,
  input: RestoreUsageInput,
): RestoreUsageResult {
  if ((input.roll === undefined) === (input.amount === undefined)) {
    throw new UsageCounterError(
      'pass exactly one of roll (a recharge-die result) or amount (uses regained)',
    );
  }
  return withTransaction(db, (txnDb) => {
    const resolved = resolveOwner(txnDb, input.campaignId, input.owner);
    const row = findCounter(txnDb, input.campaignId, resolved, {
      ...(input.ability === undefined ? {} : { ability: input.ability }),
      ...(input.itemId === undefined ? {} : { itemId: input.itemId }),
    });

    if (input.roll !== undefined) {
      if (row.reset_kind !== 'recharge_roll') {
        throw new UsageCounterError(
          `'${row.display_name}' is not a recharge-roll ability (it resets on ${row.reset_kind.replace(/_/g, ' ')}); pass amount instead if a restore is due`,
        );
      }
      const faces = Number.parseInt(
        (row.recharge_roll ?? 'd6').replace(/^d/i, ''),
        10,
      );
      if (
        !Number.isInteger(input.roll) ||
        input.roll < 1 ||
        input.roll > faces
      ) {
        throw new UsageCounterError(
          `roll must be a natural ${row.recharge_roll ?? 'd6'} result (1-${faces}), rolled via the roll tool`,
        );
      }
      const threshold = row.recharge_minimum ?? faces;
      const recharged = input.roll >= threshold;
      if (recharged) {
        txnDb
          .prepare(
            `UPDATE entity_usage_counter
             SET uses_used = 0, provenance = ?, session_id = ?, updated_at = ?
             WHERE campaign_id = ? AND owner_kind = ? AND owner_ref = ?
               AND counter_key = ?`,
          )
          .run(
            input.provenance,
            input.sessionId,
            input.at,
            input.campaignId,
            resolved.owner.kind,
            resolved.owner.ref,
            row.counter_key,
          );
      }
      const after = readCounterRow(
        txnDb,
        input.campaignId,
        resolved.owner,
        row.counter_key,
      ) as CounterRow;
      return {
        counter: rowToCounter(after, resolved.ownerLabel),
        recharged,
        rechargeThreshold: `${threshold}-${faces} on ${row.recharge_roll ?? 'd6'}`,
      };
    }

    const amount = input.amount as number;
    if (!Number.isInteger(amount) || amount < 1) {
      throw new UsageCounterError('amount must be a positive integer');
    }
    txnDb
      .prepare(
        `UPDATE entity_usage_counter
         SET uses_used = MAX(0, uses_used - ?),
             provenance = ?, session_id = ?, updated_at = ?
         WHERE campaign_id = ? AND owner_kind = ? AND owner_ref = ?
           AND counter_key = ?`,
      )
      .run(
        amount,
        input.provenance,
        input.sessionId,
        input.at,
        input.campaignId,
        resolved.owner.kind,
        resolved.owner.ref,
        row.counter_key,
      );
    const after = readCounterRow(
      txnDb,
      input.campaignId,
      resolved.owner,
      row.counter_key,
    ) as CounterRow;
    return { counter: rowToCounter(after, resolved.ownerLabel) };
  });
}

function ownerLabelMaps(db: Db, campaignId: string) {
  const characterNames = new Map(
    (
      db.prepare('SELECT id, name FROM character').all() as {
        id: string;
        name: string | null;
      }[]
    ).map((row) => [row.id, row.name ?? row.id]),
  );
  const combatantLabels = new Map(
    (
      db
        .prepare(
          'SELECT combatant_id, display_label FROM encounter_combatant WHERE campaign_id = ?',
        )
        .all(campaignId) as {
        combatant_id: string;
        display_label: string;
      }[]
    ).map((row) => [row.combatant_id, row.display_label]),
  );
  return (row: CounterRow): string =>
    row.owner_kind === 'character'
      ? (characterNames.get(row.owner_ref) ?? row.owner_ref)
      : (combatantLabels.get(row.owner_ref) ?? row.owner_ref);
}

export function resetUsage(db: Db, input: ResetUsageInput): ResetUsageResult {
  const kinds = EVENT_RESETS[input.event];
  if (kinds === undefined) {
    throw new UsageCounterError('event must be short_rest, long_rest, or dawn');
  }
  return withTransaction(db, (txnDb) => {
    let ownerClause = '';
    const ownerParams: string[] = [];
    if (input.owner !== undefined) {
      const resolved = resolveOwner(txnDb, input.campaignId, input.owner);
      ownerClause = ' AND owner_kind = ? AND owner_ref = ?';
      ownerParams.push(resolved.owner.kind, resolved.owner.ref);
    } else if (input.event !== 'dawn') {
      // The party rests; a combatant's off-screen rest is recorded by
      // scoping the event to it. Dawn comes for everyone.
      ownerClause = " AND owner_kind = 'character'";
    }

    const placeholders = kinds.map(() => '?').join(', ');
    const rows = txnDb
      .prepare(
        `SELECT ${COUNTER_COLUMNS}
         FROM entity_usage_counter
         WHERE campaign_id = ? AND uses_used > 0
           AND reset_kind IN (${placeholders})${ownerClause}
         ORDER BY owner_kind, owner_ref, counter_key`,
      )
      .all(input.campaignId, ...kinds, ...ownerParams) as CounterRow[];

    const labelFor = ownerLabelMaps(txnDb, input.campaignId);
    const reset: UsageCounter[] = [];
    const needsRolledRestore: UsageCounter[] = [];
    for (const row of rows) {
      // A partial-recharge formula ("regains 1d6 + 1 charges daily at
      // dawn") restores a rolled amount, not a full reset.
      if (input.event === 'dawn' && row.recharge_formula !== null) {
        needsRolledRestore.push(rowToCounter(row, labelFor(row)));
        continue;
      }
      txnDb
        .prepare(
          `UPDATE entity_usage_counter
           SET uses_used = 0, provenance = ?, session_id = ?, updated_at = ?
           WHERE campaign_id = ? AND owner_kind = ? AND owner_ref = ?
             AND counter_key = ?`,
        )
        .run(
          input.provenance,
          input.sessionId,
          input.at,
          input.campaignId,
          row.owner_kind,
          row.owner_ref,
          row.counter_key,
        );
      reset.push(rowToCounter({ ...row, uses_used: 0 }, labelFor(row)));
    }
    return { event: input.event, reset, needsRolledRestore };
  });
}

/**
 * Every usage counter with at least one spent use, for the context
 * snapshot: the model needs to see what is expended (and what is waiting on
 * a recharge roll), not what is untouched.
 */
export function readSpentUsageCounters(
  db: Db,
  campaignId: string,
): UsageCounter[] {
  const rows = db
    .prepare(
      `SELECT ${COUNTER_COLUMNS}
       FROM entity_usage_counter
       WHERE campaign_id = ? AND uses_used > 0
       ORDER BY owner_kind, owner_ref, counter_key`,
    )
    .all(campaignId) as CounterRow[];
  const labelFor = ownerLabelMaps(db, campaignId);
  return rows.map((row) => rowToCounter(row, labelFor(row)));
}

/** Render one spent counter as the compact fragment the context snapshot
 *  shows the model, e.g.
 *  `Fire Breath 1/1 used (recharge 5-6 at the start of its turn, or any rest)`. */
export function formatUsageCounter(counter: UsageCounter): string {
  const resetHint = (() => {
    switch (counter.resetKind) {
      case 'recharge_roll':
        return `recharge ${counter.rechargeMinimum}-${Number.parseInt((counter.rechargeRoll ?? 'd6').replace(/^d/i, ''), 10)} at the start of its turn, or any rest`;
      case 'short_rest':
        return 'resets on a short rest';
      case 'short_or_long_rest':
        return 'resets on a short or long rest';
      case 'long_rest':
        return 'resets on a long rest';
      case 'dawn':
        return counter.rechargeFormula === undefined
          ? 'resets at dawn'
          : `regains ${counter.rechargeFormula} at dawn`;
    }
  })();
  return `${counter.displayName} ${counter.usesUsed}/${counter.usesMax} used (${resetHint})`;
}
