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
// - Legacy/ad-hoc item charges use the same counter with a partial-recharge wrinkle:
//   "regains 1d6 + 1 expended charges daily at dawn" restores a rolled
//   amount, not a full reset, so formula counters are surfaced at dawn for
//   a rolled `restoreUsage` instead of being zeroed. Their charge state is
//   owned by the ITEM (owner_kind 'item', ref = inventory
//   id), not by whoever happens to hold it: a half-spent wand handed to
//   another character keeps its counter, and possession is a separate
//   check at spend/restore time.
// - The recharge die is rolled once at the START of each of the owner's
//   own turns — not rerolled on demand, and not after the ability was used
//   that turn. The counter keeps two durable window tokens for the
//   (instance, round, turns-taken) turn identity: `last_recharge_attempt`
//   refuses a second roll in the same window, and `last_spend_turn`
//   (stamped when a recharge ability is spent during the owner's own open
//   turn) refuses a roll in a window the ability was already used in —
//   so use → recharge → use inside one turn is impossible. Off-turn and
//   out-of-combat rolls are refused outright (out of combat, the ability
//   comes back on a rest).
//
// Economy provenance is fail-closed the same way F2 treats spell timing:
// a combatant's economy is derived structurally from its creature record
// (usage.perDay, mechanics.recharge, usage.rechargeAfterRest, innate
// spellcasting per-day groups) and NOTHING else — a declared economy for a
// combatant is rejected, and an ability that matches no record entry is a
// lookup error or a pack-structure gap to report, never an invitation to
// invent numbers. Character abilities and legacy/ad-hoc item charges have no
// structured pack source yet, so their first spend requires an explicit
// declared economy (maxUses + reset). Canonical pack-bound items never use
// these counters: useItem owns their readiness, semantic operation, cost, and
// item_state atomically, so accepting the same economy here would create a
// double-spend path.
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

import { createSqliteCharacterSheetStore } from '../character/characterSheetStore.js';
import {
  createRulesPackCharacterResolver,
  type ResolvedClassLevel,
} from '../character/rulesPackResolver.js';
import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { resolveCharacterId } from './activeCharacter.js';
import {
  CampaignRulesBindingResolutionError,
  type CampaignRulesPackResolver,
  lookupCampaignRecord,
  resolveStrictCampaignRulesStack,
} from './campaignRecordLookup.js';
import {
  type ClassResourceBinding,
  classResourceBindingsFor,
  classResourceCapacity,
  findClassResourceBinding,
} from './classResources.js';
import type { LifeState } from './hpLifecycle.js';
import { itemAdoptionReviewBlockMessage } from './itemAdoptionReview.js';
import {
  replaceParentheticals,
  stripTrailingParenthetical,
  trimEdgeChar,
} from './nameNormalization.js';

/** Who a counter row belongs to: an acting entity, or — for charge
 *  economies — the item itself, so charge state follows the item across
 *  possession changes. */
export type UsageOwnerKind = 'character' | 'combatant' | 'item';

export interface UsageOwner {
  readonly kind: UsageOwnerKind;
  readonly ref: string;
}

/** Owner selector as tools pass it: the acting character or combatant (a
 *  combatant needs its exact id; a character ref is optional and defaults
 *  to the acting character). Item counters are never addressed directly —
 *  they are reached via `itemId` through the holding character. */
export interface UsageOwnerInput {
  readonly kind: 'character' | 'combatant';
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
  readonly resolveRulesPack?: CampaignRulesPackResolver;
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

/** A pack-bound class resource with no cap at this level (Barbarian 20
 *  Rage): the spend succeeded without consuming or creating a counter. */
export interface SpendUsageUnlimitedResult {
  readonly unlimited: true;
  readonly counter?: undefined;
  readonly displayName: string;
  readonly note: string;
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
  readonly last_recharge_attempt: string | null;
  readonly last_spend_turn: string | null;
  readonly source: 'record' | 'declared';
}

const COUNTER_COLUMNS = `owner_kind, owner_ref, counter_key, display_name,
       uses_max, uses_used, reset_kind, recharge_roll, recharge_minimum,
       recharge_formula, last_recharge_attempt, last_spend_turn, source`;

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
  const normalized = replaceParentheticals(name, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  return trimEdgeChar(normalized, '-');
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
      displayName: `${stripTrailingParenthetical(entryName)} (${usage.perDay}/Day)`,
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
    if (combatant.status === 'absent') {
      throw new UsageCounterError(
        `combatant '${input.ref}' is absent (out of play); its abilities spend nothing`,
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

/** Build the create-payload shared by every declared economy. */
function declaredCreate(
  displayName: string,
  declared: DeclaredUsageEconomy,
): CounterCreate {
  return {
    displayName,
    usesMax: declared.maxUses,
    resetKind: declared.reset,
    ...(declared.reset === 'recharge_roll'
      ? { rechargeRoll: 'd6', rechargeMinimum: declared.rechargeMinimum }
      : {}),
    ...(declared.rechargeFormula === undefined
      ? {}
      : { rechargeFormula: declared.rechargeFormula }),
    source: 'declared' as const,
  };
}

interface CounterCreate {
  displayName: string;
  usesMax: number;
  resetKind: UsageResetKind;
  rechargeRoll?: string;
  rechargeMinimum?: number;
  rechargeFormula?: string;
  source: 'record' | 'declared';
}

interface CounterTarget {
  /** The row's owner: the acting entity, or the item for charge counters. */
  counterOwner: UsageOwner;
  /** Label for rendering the counter (item name for item counters). */
  counterLabel: string;
  counterKey: string;
  create?: CounterCreate;
  /** Pack-bound class resource with no cap at this level. */
  unlimited?: { displayName: string };
}

/** Verify possession and name an item's charge counter: the counter is
 *  owned by the item itself (charge state follows the wand when it changes
 *  hands); the resolved character must currently hold it. */
function resolveItemCounter(
  db: Db,
  resolved: ResolvedOwner,
  itemId: string,
): { owner: UsageOwner; itemName: string } {
  if (resolved.owner.kind !== 'character') {
    throw new UsageCounterError(
      'item charges are spent by the character holding the item; pass character, not combatantId',
    );
  }
  const item = db
    .prepare(
      'SELECT name, pack_ref FROM inventory WHERE id = ? AND character_id = ?',
    )
    .get(itemId, resolved.owner.ref) as
    | { name: string; pack_ref: string | null }
    | undefined;
  if (item === undefined) {
    throw new UsageCounterError(
      `${resolved.ownerLabel} holds no inventory item '${itemId}'`,
    );
  }
  const quarantine = itemAdoptionReviewBlockMessage(db, itemId, 'usage');
  if (quarantine !== undefined) throw new UsageCounterError(quarantine);
  if (item.pack_ref !== null)
    throw new UsageCounterError(
      `inventory item '${itemId}' is bound to canonical pack item '${item.pack_ref}'; execute its declared semantic operation with use_item. spend_usage, restore_usage, and reset_usage item counters are only for legacy/ad-hoc unbound items`,
    );
  return { owner: { kind: 'item', ref: itemId }, itemName: item.name };
}

function assertResettableItemCounter(db: Db, row: CounterRow): void {
  if (row.owner_kind !== 'item') return;
  const quarantine = itemAdoptionReviewBlockMessage(
    db,
    row.owner_ref,
    'reset_usage',
  );
  if (quarantine !== undefined) throw new UsageCounterError(quarantine);
  const item = db
    .prepare('SELECT pack_ref FROM inventory WHERE id = ?')
    .get(row.owner_ref) as { pack_ref: string | null } | undefined;
  if (item !== undefined && item.pack_ref !== null)
    throw new UsageCounterError(
      `inventory item '${row.owner_ref}' is bound to canonical pack item '${item.pack_ref}'; execute its declared semantic operation with use_item. spend_usage, restore_usage, and reset_usage item counters are only for legacy/ad-hoc unbound items`,
    );
}

/** Resolve the counter a spend targets: item spends key on the item itself
 *  (with possession checked through the acting character); ability spends
 *  derive the canonical key from the creature record when one owns the
 *  economy. Returns the row identity plus, for a first spend, everything
 *  needed to create it. */
function resolveCounterTarget(
  db: Db,
  campaignId: string,
  resolved: ResolvedOwner,
  input: {
    ability?: string;
    itemId?: string;
    declared?: DeclaredUsageEconomy;
  },
  resolver?: CampaignRulesPackResolver,
): CounterTarget {
  if (input.itemId !== undefined) {
    const { owner, itemName } = resolveItemCounter(db, resolved, input.itemId);
    const counterKey = 'charges';
    const existing = readCounterRow(db, campaignId, owner, counterKey);
    if (existing !== undefined) {
      if (input.declared !== undefined) {
        throw new UsageCounterError(
          `${itemName} already has a recorded charge economy (${existing.uses_max} max, ${existing.reset_kind}); omit maxUses/reset`,
        );
      }
      return { counterOwner: owner, counterLabel: itemName, counterKey };
    }
    if (input.declared === undefined) {
      throw new UsageCounterError(
        `${itemName} has no recorded charge economy yet: look up the item via lookup_rules, then pass maxUses and reset (and rechargeFormula for partial dawn recharges like '1d6+1') on this first spend`,
      );
    }
    validateDeclaredEconomy(input.declared);
    return {
      counterOwner: owner,
      counterLabel: itemName,
      counterKey,
      create: declaredCreate(`${itemName} charges`, input.declared),
    };
  }

  if (input.ability === undefined || input.ability.trim().length === 0) {
    throw new UsageCounterError('pass ability (the statblock name) or itemId');
  }

  if (resolved.owner.kind === 'combatant') {
    // A combatant's economy comes from its rules record and nowhere else:
    // declared economies fail closed so a typo or a model-invented number
    // can never mint a counter for a creature the pack already describes.
    if (input.declared !== undefined) {
      throw new UsageCounterError(
        `${resolved.ownerLabel}'s economies derive from its rules record; declared economies (maxUses/reset) apply only to character abilities and item charges`,
      );
    }
    const record =
      resolved.rulesRef === undefined
        ? undefined
        : lookupCampaignRecord(db, 'creature', resolved.rulesRef, resolver);
    if (record === undefined) {
      throw new UsageCounterError(
        `${resolved.ownerLabel}'s rules record '${resolved.rulesRef ?? '(none)'}' does not resolve in the campaign rules stack, so no usage economy can be derived (failing closed rather than inventing one)`,
      );
    }
    const derived = deriveUsageEconomy(record.data, input.ability);
    switch (derived.kind) {
      case 'economy': {
        const existing = readCounterRow(
          db,
          campaignId,
          resolved.owner,
          derived.counterKey,
        );
        if (existing !== undefined) {
          return {
            counterOwner: resolved.owner,
            counterLabel: resolved.ownerLabel,
            counterKey: derived.counterKey,
          };
        }
        return {
          counterOwner: resolved.owner,
          counterLabel: resolved.ownerLabel,
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
        throw new UsageCounterError(
          `'${input.ability}' matches no trait, action, reaction, or innate spell in ${resolved.ownerLabel}'s rules record (${resolved.rulesRef}); check the exact statblock name via lookup_rules. If the record genuinely lacks structured usage data for this ability, that is a pack-structure gap to report — not a declared economy`,
        );
    }
  }

  const bound = resolveBoundClassResource(
    db,
    resolved,
    input.ability,
    resolver,
  );
  if (bound !== undefined) {
    return resolvePackBoundTarget(db, campaignId, resolved, input, bound);
  }

  // Character ability: no structured pack source yet, so the economy is
  // declared once (validated) and durable thereafter.
  const counterKey = `ability:${normalizeAbilityName(input.ability)}`;
  const existing = readCounterRow(db, campaignId, resolved.owner, counterKey);
  if (existing !== undefined) {
    if (input.declared !== undefined) {
      throw new UsageCounterError(
        `'${existing.display_name}' already has a recorded economy (${existing.uses_max} max, ${existing.reset_kind}); omit maxUses/reset`,
      );
    }
    return {
      counterOwner: resolved.owner,
      counterLabel: resolved.ownerLabel,
      counterKey,
    };
  }
  if (input.declared === undefined) {
    throw new UsageCounterError(
      `'${input.ability}' has no recorded usage economy for ${resolved.ownerLabel} yet: look up the feature via lookup_rules, then pass maxUses and reset on this first spend`,
    );
  }
  validateDeclaredEconomy(input.declared);
  return {
    counterOwner: resolved.owner,
    counterLabel: resolved.ownerLabel,
    counterKey,
    create: declaredCreate(input.ability, input.declared),
  };
}

interface BoundClassResource {
  readonly binding: ClassResourceBinding;
  readonly row: ResolvedClassLevel;
  readonly level: number;
}

/** The pack-bound class resource a character-ability spend names, when the
 *  character's stored canonical sheet has the binding's class and the ability
 *  name is one of its aliases. Characters without a sheet, of another class,
 *  or naming another ability keep the declared-economy path. */
function resolveBoundClassResource(
  db: Db,
  resolved: ResolvedOwner,
  ability: string,
  resolver?: CampaignRulesPackResolver,
): BoundClassResource | undefined {
  if (resolved.owner.kind !== 'character') return undefined;
  const normalized = normalizeAbilityName(ability);
  const sheet = createSqliteCharacterSheetStore(db).load(resolved.owner.ref);
  if (sheet === undefined) return undefined;
  const binding = findClassResourceBinding(sheet.class.key, normalized);
  if (binding === undefined) return undefined;
  // Capacity comes from the ACTIVE campaign rules stack (base + add-ons), never
  // a silent bundled fallback: an unresolvable binding fails closed.
  let row: ReturnType<
    ReturnType<typeof createRulesPackCharacterResolver>['resolveClassLevel']
  >;
  try {
    row = createRulesPackCharacterResolver(
      resolveStrictCampaignRulesStack(db, resolver),
    ).resolveClassLevel(sheet.class.key, sheet.level);
  } catch (e) {
    if (e instanceof CampaignRulesBindingResolutionError) {
      throw new UsageCounterError(
        `cannot resolve ${binding.displayName} capacity: ${e.message}`,
      );
    }
    throw e;
  }
  if (!row.ok) {
    throw new UsageCounterError(
      `cannot resolve ${binding.displayName} capacity for ${sheet.class.key} level ${sheet.level}: ${row.message}`,
    );
  }
  return { binding, row: row.record, level: sheet.level };
}

function resolvePackBoundTarget(
  db: Db,
  campaignId: string,
  resolved: ResolvedOwner,
  input: { declared?: DeclaredUsageEconomy },
  bound: BoundClassResource,
): CounterTarget {
  const { binding, row, level } = bound;
  if (input.declared !== undefined) {
    throw new UsageCounterError(
      `${binding.displayName} capacity derives from the class table, not a declared economy; omit maxUses/reset`,
    );
  }
  const capacity = classResourceCapacity(binding, row);
  if (capacity.kind === 'none') {
    throw new UsageCounterError(
      `${resolved.ownerLabel} has no ${binding.displayName} at level ${level} per the class table; nothing to spend`,
    );
  }
  const base = {
    counterOwner: resolved.owner,
    counterLabel: resolved.ownerLabel,
    counterKey: binding.counterKey,
  };
  if (capacity.kind === 'unlimited') {
    return { ...base, unlimited: { displayName: binding.displayName } };
  }
  // Adopt any legacy/alias counter and align it to the pack maximum.
  const reconciled = reconcileBoundCounterRows(
    db,
    campaignId,
    resolved.owner.ref,
    binding,
    capacity,
  );
  if (reconciled) return base;
  return {
    ...base,
    create: {
      displayName: binding.displayName,
      usesMax: capacity.value,
      resetKind: binding.reset,
      source: 'record',
    },
  };
}

/** The owner's duplicate rule, shared by the mutating reconciliation and the
 *  read projection: the most-spent legacy row wins, clamped to the active
 *  finite capacity. */
function mostSpentUsed(
  rows: readonly { readonly uses_used: number }[],
  capacity: number,
): number {
  return Math.min(Math.max(...rows.map((row) => row.uses_used)), capacity);
}

function boundCounterKeys(binding: ClassResourceBinding): string[] {
  return [
    binding.counterKey,
    ...binding.aliases.map((alias) => `ability:${alias}`),
  ].filter((key, index, all) => all.indexOf(key) === index);
}

/** Make every counter row for one bound resource (canonical or alias key, in
 *  the given campaign — or every campaign when `campaignId` is undefined) a
 *  single canonical `record` row at the pack maximum, preserving `uses_used`
 *  (clamped, never restored). 'unlimited' deletes the rows. Returns whether a
 *  row exists afterwards. */
function reconcileBoundCounterRows(
  db: Db,
  campaignId: string | undefined,
  characterId: string,
  binding: ClassResourceBinding,
  capacity: ReturnType<typeof classResourceCapacity>,
  ctx?: UsageMutationContext,
): boolean {
  const keys = boundCounterKeys(binding);
  const placeholders = keys.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT campaign_id, counter_key, uses_used FROM entity_usage_counter
       WHERE owner_kind = 'character' AND owner_ref = ?
         AND counter_key IN (${placeholders})
         ${campaignId === undefined ? '' : 'AND campaign_id = ?'}
       ORDER BY campaign_id, counter_key`,
    )
    .all(
      characterId,
      ...keys,
      ...(campaignId === undefined ? [] : [campaignId]),
    ) as {
    campaign_id: string;
    counter_key: string;
    uses_used: number;
  }[];
  if (rows.length === 0) return false;
  const del = db.prepare(
    `DELETE FROM entity_usage_counter
     WHERE campaign_id = ? AND owner_kind = 'character' AND owner_ref = ?
       AND counter_key = ?`,
  );
  if (capacity.kind !== 'count') {
    for (const row of rows) {
      del.run(row.campaign_id, characterId, row.counter_key);
    }
    return false;
  }
  const byCampaign = new Map<string, typeof rows>();
  for (const row of rows) {
    byCampaign.set(row.campaign_id, [
      ...(byCampaign.get(row.campaign_id) ?? []),
      row,
    ]);
  }
  for (const [campaign, group] of byCampaign) {
    // One counter per resource: the most-spent legacy row wins the used count.
    const used = mostSpentUsed(group, capacity.value);
    const canonical = group.some(
      (row) => row.counter_key === binding.counterKey,
    );
    // Drop duplicate alias rows; the canonical row (or the first alias, which
    // is rekeyed below) is the survivor.
    const survivor = canonical
      ? binding.counterKey
      : (group[0]?.counter_key ?? binding.counterKey);
    for (const row of group) {
      if (row.counter_key !== survivor) {
        del.run(campaign, characterId, row.counter_key);
      }
    }
    if (canonical) {
      db.prepare(
        `UPDATE entity_usage_counter
         SET display_name = ?, uses_max = ?, uses_used = ?, reset_kind = ?,
             recharge_roll = NULL, recharge_minimum = NULL,
             recharge_formula = NULL, source = 'record',
             provenance = COALESCE(?, provenance),
             session_id = COALESCE(?, session_id),
             updated_at = COALESCE(?, updated_at)
         WHERE campaign_id = ? AND owner_kind = 'character' AND owner_ref = ?
           AND counter_key = ?`,
      ).run(
        binding.displayName,
        capacity.value,
        used,
        binding.reset,
        ctx?.provenance ?? null,
        ctx?.sessionId ?? null,
        ctx?.at ?? null,
        campaign,
        characterId,
        binding.counterKey,
      );
    } else {
      // Rekey the (single remaining or first) alias row to the canonical key.
      db.prepare(
        `UPDATE entity_usage_counter
         SET counter_key = ?, display_name = ?, uses_max = ?, uses_used = ?,
             reset_kind = ?, recharge_roll = NULL, recharge_minimum = NULL,
             recharge_formula = NULL, source = 'record',
             provenance = COALESCE(?, provenance),
             session_id = COALESCE(?, session_id),
             updated_at = COALESCE(?, updated_at)
         WHERE campaign_id = ? AND owner_kind = 'character' AND owner_ref = ?
           AND counter_key = ?`,
      ).run(
        binding.counterKey,
        binding.displayName,
        capacity.value,
        used,
        binding.reset,
        ctx?.provenance ?? null,
        ctx?.sessionId ?? null,
        ctx?.at ?? null,
        campaign,
        characterId,
        survivor,
      );
    }
  }
  return true;
}

/**
 * Level-up reconciliation (eshyra-2llo.1): align every EXISTING pack-bound
 * class-resource counter of `characterId` (any campaign) with the pack value
 * at `row`'s level. New max = pack value; used is preserved and clamped (no
 * free restoration); 'unlimited' deletes the counter. Characters with no
 * counter are untouched — the first spend derives it. Runs inside the
 * caller's transaction.
 */
export function reconcileClassResourceCounters(
  db: Db,
  input: UsageMutationContext & {
    readonly characterId: string;
    readonly classKey: string;
    readonly row: Pick<ResolvedClassLevel, 'resources'>;
  },
): void {
  for (const binding of classResourceBindingsFor(input.classKey)) {
    const capacity = classResourceCapacity(binding, input.row);
    if (capacity.kind === 'none') continue;
    reconcileBoundCounterRows(
      db,
      undefined,
      input.characterId,
      binding,
      capacity,
      input,
    );
  }
}

function insertCounter(
  db: Db,
  campaignId: string,
  owner: UsageOwner,
  counterKey: string,
  create: CounterCreate,
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

export interface BoundClassResourceBalance {
  readonly max: number;
  readonly used: number;
}

/**
 * Read a pack-bound class resource's balance THROUGH the counter owner:
 * legacy/alias/duplicate rows are adopted into the canonical record counter
 * (most-spent wins; max/reset/source normalized to the active class table)
 * exactly as `spendUsage` does. Returns undefined when the character has no
 * such bound resource, or the table gives it no finite capacity. A missing
 * counter reads as fully unspent at the table maximum (no row is created).
 * Runs inside the caller's transaction.
 */
export function readBoundClassResourceBalance(
  db: Db,
  input: UsageMutationContext & {
    readonly campaignId: string;
    readonly characterId: string;
    readonly ability: string;
  },
): BoundClassResourceBalance | undefined {
  const resolved = resolveOwner(db, input.campaignId, {
    kind: 'character',
    ref: input.characterId,
  });
  const bound = resolveBoundClassResource(
    db,
    resolved,
    input.ability,
    input.resolveRulesPack,
  );
  if (bound === undefined) return undefined;
  const capacity = classResourceCapacity(bound.binding, bound.row);
  if (capacity.kind !== 'count') return undefined;
  reconcileBoundCounterRows(
    db,
    input.campaignId,
    input.characterId,
    bound.binding,
    capacity,
    input,
  );
  const row = readCounterRow(
    db,
    input.campaignId,
    resolved.owner,
    bound.binding.counterKey,
  );
  return {
    max: capacity.value,
    used: Math.min(row?.uses_used ?? 0, capacity.value),
  };
}

export function spendUsage(
  db: Db,
  input: SpendUsageInput,
): SpendUsageResult | SpendUsageUnlimitedResult {
  const uses = input.uses ?? 1;
  if (!Number.isInteger(uses) || uses < 1) {
    throw new UsageCounterError('uses must be a positive integer');
  }
  return withTransaction(db, (txnDb) => {
    const resolved = resolveOwner(txnDb, input.campaignId, input.owner);
    const target = resolveCounterTarget(
      txnDb,
      input.campaignId,
      resolved,
      {
        ...(input.ability === undefined ? {} : { ability: input.ability }),
        ...(input.itemId === undefined ? {} : { itemId: input.itemId }),
        ...(input.declared === undefined ? {} : { declared: input.declared }),
      },
      input.resolveRulesPack,
    );
    if (target.unlimited !== undefined) {
      return {
        unlimited: true as const,
        displayName: target.unlimited.displayName,
        note: `${target.unlimited.displayName} is unlimited at this level per the class table; nothing was consumed`,
      };
    }
    if (target.create !== undefined) {
      insertCounter(
        txnDb,
        input.campaignId,
        target.counterOwner,
        target.counterKey,
        target.create,
        input,
      );
    }
    const row = readCounterRow(
      txnDb,
      input.campaignId,
      target.counterOwner,
      target.counterKey,
    );
    if (row === undefined) {
      throw new UsageCounterError('usage counter disappeared during spend');
    }
    const remaining = row.uses_max - row.uses_used;
    if (uses > remaining) {
      const counter = rowToCounter(row, target.counterLabel);
      throw new UsageCounterError(
        remaining === 0
          ? `${resolved.ownerLabel} has no uses of '${row.display_name}' left (${row.uses_used}/${row.uses_max} spent). ${depletedHintFor(counter)}`
          : `${resolved.ownerLabel} has only ${remaining} use(s) of '${row.display_name}' left (${row.uses_used}/${row.uses_max} spent); cannot spend ${uses}`,
      );
    }
    // A recharge ability spent during the owner's own open turn stamps the
    // turn-window token: the recharge die is rolled at the START of a turn,
    // before use, so a roll later in this same window will be refused.
    const spendWindow =
      row.reset_kind === 'recharge_roll'
        ? tryCurrentOwnTurnToken(txnDb, input.campaignId, resolved.owner).token
        : undefined;
    txnDb
      .prepare(
        `UPDATE entity_usage_counter
         SET uses_used = uses_used + ?,
             last_spend_turn = COALESCE(?, last_spend_turn),
             provenance = ?, session_id = ?, updated_at = ?
         WHERE campaign_id = ? AND owner_kind = ? AND owner_ref = ?
           AND counter_key = ?`,
      )
      .run(
        uses,
        spendWindow ?? null,
        input.provenance,
        input.sessionId,
        input.at,
        input.campaignId,
        target.counterOwner.kind,
        target.counterOwner.ref,
        target.counterKey,
      );
    const after = readCounterRow(
      txnDb,
      input.campaignId,
      target.counterOwner,
      target.counterKey,
    );
    if (after === undefined) {
      throw new UsageCounterError('usage counter disappeared during spend');
    }
    const counter = rowToCounter(after, target.counterLabel);
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
  resolver?: CampaignRulesPackResolver,
  ctx?: UsageMutationContext,
): { row: CounterRow; counterOwner: UsageOwner; counterLabel: string } {
  if (ref.itemId !== undefined) {
    const { owner, itemName } = resolveItemCounter(db, resolved, ref.itemId);
    const row = readCounterRow(db, campaignId, owner, 'charges');
    if (row === undefined) {
      throw new UsageCounterError(
        `no charge counter exists for item '${ref.itemId}' (a counter appears on its first spend_usage)`,
      );
    }
    return { row, counterOwner: owner, counterLabel: itemName };
  }
  if (ref.ability === undefined || ref.ability.trim().length === 0) {
    throw new UsageCounterError('pass ability (the statblock name) or itemId');
  }
  const slug = normalizeAbilityName(ref.ability);
  // A pack-bound class resource is stored under its canonical key whichever
  // alias named it ('Ki Points' -> ability:ki, 'Rages' -> ability:rage).
  const bound = resolveBoundClassResource(db, resolved, ref.ability, resolver);
  const boundKey = bound?.binding.counterKey;
  if (bound !== undefined) {
    // Reconcile to the ACTIVE class capacity before selecting the row, so a
    // restore reports/persists the table maximum (most-spent adoption, as
    // spendUsage does) rather than a stale stored economy.
    const capacity = classResourceCapacity(bound.binding, bound.row);
    if (capacity.kind === 'none') {
      throw new UsageCounterError(
        `${resolved.ownerLabel} has no ${bound.binding.displayName} at level ${bound.level} per the class table; nothing to restore`,
      );
    }
    if (capacity.kind === 'unlimited') {
      throw new UsageCounterError(
        `${bound.binding.displayName} is unlimited at this level per the class table; nothing to restore`,
      );
    }
    reconcileBoundCounterRows(
      db,
      campaignId,
      resolved.owner.ref,
      bound.binding,
      capacity,
      ctx,
    );
  }
  const rows = listCounterRows(db, campaignId, resolved.owner);
  const matches = rows.filter(
    (row) =>
      row.counter_key === boundKey ||
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
    return {
      row: matches[0],
      counterOwner: resolved.owner,
      counterLabel: resolved.ownerLabel,
    };
  }
  const known = rows.map((row) => row.display_name).join(', ');
  throw new UsageCounterError(
    matches.length === 0
      ? `no usage counter matches '${ref.ability}' for ${resolved.ownerLabel}. Recorded counters: ${known || '(none)'}`
      : `'${ref.ability}' matches more than one counter for ${resolved.ownerLabel}: be more specific. Recorded counters: ${known}`,
  );
}

/**
 * The current own-turn window token for an acting owner — the durable
 * identity (instance, round, owner's turns_taken) both recharge-timing
 * gates compare against. `undefined` when no active combat instance has
 * this owner as its active participant (no window is open for them).
 */
function tryCurrentOwnTurnToken(
  db: Db,
  campaignId: string,
  owner: UsageOwner,
): { token: string | undefined; inCombat: boolean } {
  const instance = db
    .prepare(
      `SELECT combat_instance_id, round_number,
              active_participant_kind, active_participant_ref
       FROM combat_instance
       WHERE campaign_id = ? AND status = 'active'`,
    )
    .get(campaignId) as
    | {
        combat_instance_id: string;
        round_number: number;
        active_participant_kind: string | null;
        active_participant_ref: string | null;
      }
    | undefined;
  if (instance === undefined) {
    return { token: undefined, inCombat: false };
  }
  if (
    instance.active_participant_kind !== owner.kind ||
    instance.active_participant_ref !== owner.ref
  ) {
    return { token: undefined, inCombat: true };
  }
  const budget = db
    .prepare(
      `SELECT turns_taken FROM combat_turn_budget
       WHERE campaign_id = ? AND combat_instance_id = ?
         AND participant_kind = ? AND participant_ref = ?`,
    )
    .get(campaignId, instance.combat_instance_id, owner.kind, owner.ref) as
    | { turns_taken: number }
    | undefined;
  return {
    token: `${instance.combat_instance_id}:r${instance.round_number}:t${budget?.turns_taken ?? 0}`,
    inCombat: true,
  };
}

/**
 * The recharge die is rolled once at the start of each of the owner's own
 * turns (limited-usage), so a roll is legal only while a structured combat
 * turn is open for that owner. Returns the current turn-window token.
 */
function currentOwnTurnToken(
  db: Db,
  campaignId: string,
  owner: UsageOwner,
  ownerLabel: string,
): string {
  const { token, inCombat } = tryCurrentOwnTurnToken(db, campaignId, owner);
  if (token !== undefined) {
    return token;
  }
  if (!inCombat) {
    throw new UsageCounterError(
      `a recharge die is rolled at the start of ${ownerLabel}'s own turn in structured combat (begin_turn); outside combat the ability recharges on a rest (reset_usage)`,
    );
  }
  throw new UsageCounterError(
    `it is not ${ownerLabel}'s turn: the recharge die is rolled once at the start of its own turn (begin_turn first)`,
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
    const { row, counterOwner, counterLabel } = findCounter(
      txnDb,
      input.campaignId,
      resolved,
      {
        ...(input.ability === undefined ? {} : { ability: input.ability }),
        ...(input.itemId === undefined ? {} : { itemId: input.itemId }),
      },
      input.resolveRulesPack,
      input,
    );

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
      // Once per own turn: the attempt is legal only during the acting
      // owner's structured turn, and only once per turn window (hit or
      // miss both consume the attempt).
      const token = currentOwnTurnToken(
        txnDb,
        input.campaignId,
        resolved.owner,
        resolved.ownerLabel,
      );
      if (row.last_recharge_attempt === token) {
        throw new UsageCounterError(
          `the recharge die for '${row.display_name}' has already been rolled this turn; it is rolled once at the start of each of ${resolved.ownerLabel}'s turns`,
        );
      }
      if (row.last_spend_turn === token) {
        throw new UsageCounterError(
          `'${row.display_name}' was used during this turn; the recharge die is rolled at the START of the turn, before the ability is used — the next chance is the start of ${resolved.ownerLabel}'s next turn (or a rest)`,
        );
      }
      const threshold = row.recharge_minimum ?? faces;
      const recharged = input.roll >= threshold;
      txnDb
        .prepare(
          `UPDATE entity_usage_counter
           SET uses_used = CASE WHEN ? THEN 0 ELSE uses_used END,
               last_recharge_attempt = ?,
               provenance = ?, session_id = ?, updated_at = ?
           WHERE campaign_id = ? AND owner_kind = ? AND owner_ref = ?
             AND counter_key = ?`,
        )
        .run(
          recharged ? 1 : 0,
          token,
          input.provenance,
          input.sessionId,
          input.at,
          input.campaignId,
          counterOwner.kind,
          counterOwner.ref,
          row.counter_key,
        );
      const after = readCounterRow(
        txnDb,
        input.campaignId,
        counterOwner,
        row.counter_key,
      ) as CounterRow;
      return {
        counter: rowToCounter(after, counterLabel),
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
        counterOwner.kind,
        counterOwner.ref,
        row.counter_key,
      );
    const after = readCounterRow(
      txnDb,
      input.campaignId,
      counterOwner,
      row.counter_key,
    ) as CounterRow;
    return { counter: rowToCounter(after, counterLabel) };
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
  const itemNames = new Map(
    (
      db.prepare('SELECT id, name FROM inventory').all() as {
        id: string;
        name: string;
      }[]
    ).map((row) => [row.id, row.name]),
  );
  return (row: CounterRow): string => {
    switch (row.owner_kind) {
      case 'character':
        return characterNames.get(row.owner_ref) ?? row.owner_ref;
      case 'combatant':
        return combatantLabels.get(row.owner_ref) ?? row.owner_ref;
      case 'item':
        return itemNames.get(row.owner_ref) ?? row.owner_ref;
    }
  };
}

/** Lazily resolve the active campaign rules stack once per operation. */
function lazyActiveClassResolver(
  db: Db,
  resolver?: CampaignRulesPackResolver,
): () => ReturnType<typeof createRulesPackCharacterResolver> {
  let memo: ReturnType<typeof createRulesPackCharacterResolver> | undefined;
  return () => {
    if (memo === undefined) {
      try {
        memo = createRulesPackCharacterResolver(
          resolveStrictCampaignRulesStack(db, resolver),
        );
      } catch (e) {
        if (e instanceof CampaignRulesBindingResolutionError) {
          throw new UsageCounterError(
            `cannot resolve class resource capacity: ${e.message}`,
          );
        }
        throw e;
      }
    }
    return memo;
  };
}

/** Active-table capacity of every bound class resource of a stored character
 *  sheet (undefined when the character has no sheet or no bound resources). */
function activeBoundCapacities(
  db: Db,
  characterId: string,
  activeResolver: ReturnType<typeof lazyActiveClassResolver>,
  hasRows: (binding: ClassResourceBinding) => boolean,
):
  | {
      binding: ClassResourceBinding;
      capacity: ReturnType<typeof classResourceCapacity>;
    }[]
  | undefined {
  const sheet = createSqliteCharacterSheetStore(db).load(characterId);
  if (sheet === undefined) return undefined;
  const bindings = classResourceBindingsFor(sheet.class.key).filter(hasRows);
  if (bindings.length === 0) return undefined;
  const row = activeResolver().resolveClassLevel(sheet.class.key, sheet.level);
  if (!row.ok) {
    throw new UsageCounterError(
      `cannot resolve class resource capacity for ${sheet.class.key} level ${sheet.level}: ${row.message}`,
    );
  }
  return bindings.map((binding) => ({
    binding,
    capacity: classResourceCapacity(binding, row.record),
  }));
}

/** Characters whose class-resource counters a reset event touches: the named
 *  character, none for a combatant/item owner, else every character with a
 *  counter in the campaign. */
function reconcileScopeBoundCounters(
  db: Db,
  input: ResetUsageInput,
): Set<string> {
  // Rows of bound resources whose ACTIVE capacity is 'none': they keep their
  // historical expenditure but must never be refilled or reported as recovered.
  const unavailable = new Set<string>();
  let characterIds: string[];
  if (input.owner !== undefined) {
    const resolved = resolveOwner(db, input.campaignId, input.owner);
    characterIds =
      resolved.owner.kind === 'character' ? [resolved.owner.ref] : [];
  } else {
    characterIds = (
      db
        .prepare(
          `SELECT DISTINCT owner_ref FROM entity_usage_counter
           WHERE campaign_id = ? AND owner_kind = 'character'
           ORDER BY owner_ref`,
        )
        .all(input.campaignId) as { owner_ref: string }[]
    ).map((row) => row.owner_ref);
  }
  const activeResolver = lazyActiveClassResolver(db, input.resolveRulesPack);
  for (const characterId of characterIds) {
    const existing = new Set(
      (
        db
          .prepare(
            `SELECT counter_key FROM entity_usage_counter
             WHERE campaign_id = ? AND owner_kind = 'character' AND owner_ref = ?`,
          )
          .all(input.campaignId, characterId) as { counter_key: string }[]
      ).map((row) => row.counter_key),
    );
    const capacities = activeBoundCapacities(
      db,
      characterId,
      activeResolver,
      (binding) => boundCounterKeys(binding).some((key) => existing.has(key)),
    );
    for (const { binding, capacity } of capacities ?? []) {
      // 'none' leaves the counter alone (level-up reconciliation does the
      // same); 'count' realigns it; 'unlimited' removes it.
      if (capacity.kind === 'none') {
        for (const key of boundCounterKeys(binding)) {
          unavailable.add(unavailableKey(characterId, key));
        }
        continue;
      }
      reconcileBoundCounterRows(
        db,
        input.campaignId,
        characterId,
        binding,
        capacity,
        input,
      );
    }
  }
  return unavailable;
}

function unavailableKey(characterId: string, counterKey: string): string {
  return `${characterId}\u0000${counterKey}`;
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
      if (resolved.owner.kind === 'character') {
        // A character's rest also refreshes the items they carry.
        ownerClause = ` AND ((owner_kind = 'character' AND owner_ref = ?)
             OR (owner_kind = 'item' AND owner_ref IN
                 (SELECT id FROM inventory WHERE character_id = ?)))`;
        ownerParams.push(resolved.owner.ref, resolved.owner.ref);
      } else {
        ownerClause = ' AND owner_kind = ? AND owner_ref = ?';
        ownerParams.push(resolved.owner.kind, resolved.owner.ref);
      }
    } else if (input.event !== 'dawn') {
      // The party rests; a combatant's off-screen rest is recorded by
      // scoping the event to it. Dawn comes for everyone. Item counters
      // rest with whichever character currently holds the item.
      ownerClause = ` AND (owner_kind = 'character'
           OR (owner_kind = 'item' AND owner_ref IN
               (SELECT id FROM inventory WHERE character_id IS NOT NULL)))`;
    }

    // Reconcile pack-bound class-resource counters of the characters in scope
    // against the ACTIVE campaign class table (one stack resolution) BEFORE
    // filtering by reset kind, so the reset selects, persists and reports the
    // active maximum/reset/source for stale canonical and alias counters.
    const unavailable = reconcileScopeBoundCounters(txnDb, input);

    const placeholders = kinds.map(() => '?').join(', ');
    const candidateRows = txnDb
      .prepare(
        `SELECT ${COUNTER_COLUMNS}
         FROM entity_usage_counter
         WHERE campaign_id = ? AND uses_used > 0
           AND reset_kind IN (${placeholders})${ownerClause}
           AND NOT (
             owner_kind='item' AND EXISTS (
               SELECT 1 FROM inventory_adoption_review
               WHERE inventory_id=entity_usage_counter.owner_ref
             )
           )
         ORDER BY owner_kind, owner_ref, counter_key`,
      )
      .all(input.campaignId, ...kinds, ...ownerParams) as CounterRow[];
    const rows = candidateRows.filter(
      (row) =>
        !(
          row.owner_kind === 'character' &&
          unavailable.has(unavailableKey(row.owner_ref, row.counter_key))
        ),
    );

    const labelFor = ownerLabelMaps(txnDb, input.campaignId);
    const reset: UsageCounter[] = [];
    const needsRolledRestore: UsageCounter[] = [];
    for (const row of rows) assertResettableItemCounter(txnDb, row);
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
  resolveRulesPack?: CampaignRulesPackResolver,
): UsageCounter[] {
  const rows = db
    .prepare(
      `SELECT ${COUNTER_COLUMNS}
       FROM entity_usage_counter
       WHERE campaign_id = ? AND uses_used > 0
         AND NOT (
           owner_kind='item' AND EXISTS (
             SELECT 1 FROM inventory_adoption_review
             WHERE inventory_id=entity_usage_counter.owner_ref
           )
         )
       ORDER BY owner_kind, owner_ref, counter_key`,
    )
    .all(campaignId) as CounterRow[];
  const labelFor = ownerLabelMaps(db, campaignId);
  const projected = projectBoundClassResources(
    db,
    campaignId,
    rows,
    lazyActiveClassResolver(db, resolveRulesPack),
  );
  return projected
    .filter((row) => row.uses_used > 0)
    .map((row) => rowToCounter(row, labelFor(row)));
}

/**
 * Pure, non-mutating canonical projection of pack-bound class-resource
 * counters (eshyra-09co.9). Per character/resource it groups canonical and
 * alias rows into ONE pool exactly as `reconcileBoundCounterRows` would
 * persist: most-spent used clamped to the ACTIVE finite capacity, canonical
 * key/display name/reset/source, recharge fields cleared. Resources whose
 * active capacity is 'none' (no finite economy at this level) or 'unlimited'
 * are omitted, never shown as a finite pool. Other counters pass through
 * unchanged. Nothing is written.
 */
function projectBoundClassResources(
  db: Db,
  campaignId: string,
  rows: readonly CounterRow[],
  activeResolver: ReturnType<typeof lazyActiveClassResolver>,
): CounterRow[] {
  const sheets = createSqliteCharacterSheetStore(db);
  const everyKey = (characterId: string): Set<string> => {
    const keys = new Set<string>();
    const sheet = sheets.load(characterId);
    if (sheet === undefined) return keys;
    for (const b of classResourceBindingsFor(sheet.class.key)) {
      for (const k of boundCounterKeys(b)) keys.add(k);
    }
    return keys;
  };
  const boundKeys = new Map<string, Set<string>>();
  const characters = new Set<string>();
  for (const row of rows) {
    if (row.owner_kind !== 'character') continue;
    if (!boundKeys.has(row.owner_ref)) {
      boundKeys.set(row.owner_ref, everyKey(row.owner_ref));
    }
    if (boundKeys.get(row.owner_ref)?.has(row.counter_key)) {
      characters.add(row.owner_ref);
    }
  }
  if (characters.size === 0) return [...rows];
  const result: CounterRow[] = [];
  const handled = new Set<string>();
  for (const characterId of characters) {
    const bindings = activeBoundCapacities(
      db,
      characterId,
      activeResolver,
      () => true,
    );
    for (const { binding, capacity } of bindings ?? []) {
      const keys = boundCounterKeys(binding);
      // The group is every stored row of the resource, including rows the
      // spent-only query excluded (an unspent alias must not mask a spent one).
      const group = db
        .prepare(
          `SELECT ${COUNTER_COLUMNS} FROM entity_usage_counter
             WHERE campaign_id = ? AND owner_kind = 'character'
               AND owner_ref = ? AND counter_key IN (${keys.map(() => '?').join(', ')})
             ORDER BY counter_key`,
        )
        .all(campaignId, characterId, ...keys) as CounterRow[];
      if (group.length === 0) continue;
      for (const row of group) {
        handled.add(unavailableKey(characterId, row.counter_key));
      }
      if (capacity.kind !== 'count') continue;
      const canonical =
        group.find((row) => row.counter_key === binding.counterKey) ??
        // biome-ignore lint/style/noNonNullAssertion: group is non-empty
        group[0]!;
      result.push({
        ...canonical,
        counter_key: binding.counterKey,
        display_name: binding.displayName,
        uses_max: capacity.value,
        uses_used: mostSpentUsed(group, capacity.value),
        reset_kind: binding.reset,
        recharge_roll: null,
        recharge_minimum: null,
        recharge_formula: null,
        source: 'record',
      });
    }
  }
  for (const row of rows) {
    if (
      row.owner_kind === 'character' &&
      handled.has(unavailableKey(row.owner_ref, row.counter_key))
    ) {
      continue;
    }
    result.push(row);
  }
  return result.sort(
    (x, y) =>
      x.owner_kind.localeCompare(y.owner_kind) ||
      x.owner_ref.localeCompare(y.owner_ref) ||
      x.counter_key.localeCompare(y.counter_key),
  );
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
