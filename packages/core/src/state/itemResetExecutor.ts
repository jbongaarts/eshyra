import { rollDice } from '../orchestrator/dice.js';
import type { Rng } from '../orchestrator/rng.js';
import type { Db } from '../persistence/db.js';
import type { MagicItemDurationSpec } from '../rules/magicItemMechanics.js';
import { effectiveMagicItemMechanics } from '../rules/magicItemVariants.js';
import type { CampaignRulesPackResolver } from './campaignRecordLookup.js';
import { lookupStrictCampaignRecord } from './campaignRecordLookup.js';
import {
  type DestroyedItemAttunementEvidence,
  destroyInventoryItem,
} from './inventoryLifecycle.js';
import {
  type ItemInstanceState,
  readItemState,
  resolveEconomyMax,
  validateItemStateForRecord,
  validatePackRef,
  writeItemState,
} from './itemState.js';
import {
  type ItemStateTimer,
  ItemTimerError,
  resolveItemStateTimers,
} from './itemTimers.js';

type Obj = Record<string, unknown>;

export interface ItemResetExecutorContext {
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
  readonly rng?: Rng;
  readonly resolveRulesPack?: CampaignRulesPackResolver;
}

export interface ItemResetEvidence {
  readonly instanceId: string;
  readonly packRef: string;
  readonly economy: string;
  readonly event: string;
  readonly boundaryElapsedMinutes: number;
  readonly previousRemaining: number;
  readonly restored: number;
  readonly remaining: number;
  readonly maximum: number;
  readonly amount: number | 'all';
  readonly roll?: {
    readonly notation: string;
    readonly rolls: readonly number[];
    readonly total: number;
  };
}

export interface ItemTimerResolutionEvidence {
  readonly instanceId: string;
  readonly packRef: string;
  readonly from: string;
  readonly to: string;
  readonly deadlineElapsedMinutes: number;
  readonly timer: ItemStateTimer;
  readonly effects: readonly unknown[];
  readonly attunementsEnded?: readonly DestroyedItemAttunementEvidence[];
}

export interface ItemClockEventResolution {
  readonly itemResets: readonly ItemResetEvidence[];
  readonly itemTimerResolutions: readonly ItemTimerResolutionEvidence[];
}

interface ItemRow {
  readonly id: string;
  readonly pack_ref: string;
  readonly variant_id: string | null;
}

interface ResolvedItem {
  readonly row: ItemRow;
  readonly packRef: string;
  readonly variantId: string | undefined;
  readonly record: NonNullable<
    ReturnType<typeof lookupStrictCampaignRecord>
  >['record'];
  readonly stack: NonNullable<
    ReturnType<typeof lookupStrictCampaignRecord>
  >['stack'];
  readonly mechanics: Obj;
}

interface ResolvedAmount {
  readonly amount: number;
  readonly roll?: {
    readonly notation: string;
    readonly rolls: readonly number[];
    readonly total: number;
  };
}

export class ItemResetExecutorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItemResetExecutorError';
  }
}

function object(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ItemResetExecutorError(`${path} must be an object`);
  return value as Obj;
}

function unsupported(
  packRef: string,
  economyId: string,
  entry: unknown,
): never {
  throw new ItemResetExecutorError(
    `${packRef} economy '${economyId}' declares unsupported reset shape ${JSON.stringify(entry)}`,
  );
}

function resetEntries(packRef: string, economyId: string, economy: Obj): Obj[] {
  if (economy.reset === undefined) return [];
  if (!Array.isArray(economy.reset))
    throw new ItemResetExecutorError(
      `${packRef} economy '${economyId}' reset must be an array`,
    );
  return economy.reset.map((entry) =>
    object(entry, `${packRef}.economies.${economyId}.reset[]`),
  );
}

function durationMinutes(
  value: unknown,
  packRef: string,
  economyId: string,
  rng: Rng | undefined,
): ResolvedAmount {
  const duration = object(
    value,
    `${packRef}.economies.${economyId}.reset duration`,
  );
  if (!['minute', 'hour', 'day'].includes(String(duration.unit)))
    unsupported(packRef, economyId, value);
  const amount =
    typeof duration.amount === 'number'
      ? { amount: duration.amount }
      : (() => {
          if (typeof duration.amount !== 'string' || rng === undefined)
            throw new ItemResetExecutorError(
              `${packRef} economy '${economyId}' reset duration ${JSON.stringify(value)} needs seeded RNG`,
            );
          const roll = rollDice(duration.amount, rng);
          return {
            amount: roll.total,
            roll: {
              notation: roll.notation,
              rolls: roll.rolls,
              total: roll.total,
            },
          };
        })();
  const multiplier =
    duration.unit === 'minute' ? 1 : duration.unit === 'hour' ? 60 : 1_440;
  const minutes = amount.amount * multiplier;
  if (!Number.isSafeInteger(minutes) || minutes <= 0)
    throw new ItemResetExecutorError(
      `${packRef} economy '${economyId}' reset duration is invalid`,
    );
  return { ...amount, amount: minutes };
}

function resetAmount(
  entry: Obj,
  packRef: string,
  economyId: string,
  state: ItemInstanceState,
  economy: Obj,
  rng: Rng | undefined,
): { requested: number | 'all'; roll?: ResolvedAmount['roll'] } {
  const raw = entry.amount;
  if (raw === 'all') return { requested: 'all' };
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw <= 0)
      unsupported(packRef, economyId, entry);
    return { requested: raw };
  }
  if (typeof raw === 'string') {
    if (rng === undefined)
      throw new ItemResetExecutorError(
        `${packRef} economy '${economyId}' reset amount ${raw} needs seeded RNG`,
      );
    const roll = rollDice(raw, rng);
    return {
      requested: roll.total,
      roll: { notation: roll.notation, rolls: roll.rolls, total: roll.total },
    };
  }
  if (raw !== undefined && typeof raw === 'object') {
    if (economy.kind !== 'budget' || entry.at !== 'per-period')
      unsupported(packRef, economyId, entry);
    const budget = object(
      economy.budget,
      `${packRef}.economies.${economyId}.budget`,
    );
    const increment = object(
      budget.increment,
      `${packRef}.economies.${economyId}.budget.increment`,
    );
    const resolved = durationAmount(raw, packRef, economyId, rng);
    const incrementAmount = increment.amount;
    if (typeof incrementAmount !== 'number')
      unsupported(packRef, economyId, entry);
    const totalTicks = durationTicks(raw, resolved.amount, packRef, economyId);
    const incrementTicks = durationTicks(
      increment,
      incrementAmount,
      packRef,
      economyId,
    );
    if (totalTicks % incrementTicks !== 0)
      unsupported(packRef, economyId, entry);
    return {
      requested: totalTicks / incrementTicks,
      ...(resolved.roll === undefined ? {} : { roll: resolved.roll }),
    };
  }
  // `state` is deliberately part of this signature: it prevents callers from
  // accidentally implementing a second budget/max source in the future.
  void state;
  unsupported(packRef, economyId, entry);
}

function durationAmount(
  value: unknown,
  packRef: string,
  economyId: string,
  rng: Rng | undefined,
): ResolvedAmount {
  const duration = object(value, `${packRef}.economies.${economyId}.amount`);
  if (!['round', 'minute', 'hour', 'day'].includes(String(duration.unit)))
    unsupported(packRef, economyId, value);
  if (typeof duration.amount === 'number') {
    if (!Number.isSafeInteger(duration.amount) || duration.amount <= 0)
      unsupported(packRef, economyId, value);
    return { amount: duration.amount };
  }
  if (typeof duration.amount !== 'string' || rng === undefined)
    throw new ItemResetExecutorError(
      `${packRef} economy '${economyId}' reset amount ${JSON.stringify(value)} needs seeded RNG`,
    );
  const roll = rollDice(duration.amount, rng);
  return {
    amount: roll.total,
    roll: { notation: roll.notation, rolls: roll.rolls, total: roll.total },
  };
}

function durationTicks(
  value: unknown,
  amount: number,
  packRef: string,
  economyId: string,
): number {
  const duration = object(value, `${packRef}.economies.${economyId}.duration`);
  const ticksByUnit: Record<string, number> = {
    round: 1,
    minute: 10,
    hour: 600,
    day: 14_400,
  };
  const multiplier = ticksByUnit[String(duration.unit)];
  if (multiplier === undefined) unsupported(packRef, economyId, value);
  const ticks = amount * multiplier;
  if (!Number.isSafeInteger(ticks) || ticks <= 0)
    unsupported(packRef, economyId, value);
  return ticks;
}

function validateResetShape(
  packRef: string,
  economyId: string,
  economy: Obj,
  entry: Obj,
): void {
  const at = entry.at;
  const allowed = new Set([
    'dawn',
    'dusk',
    'short-rest',
    'long-rest',
    'hour',
    'days',
    'per-period',
  ]);
  if (typeof at !== 'string' || !allowed.has(at))
    unsupported(packRef, economyId, entry);
  if (
    at === 'dawn' ||
    at === 'dusk' ||
    at === 'short-rest' ||
    at === 'long-rest'
  ) {
    if (
      at === 'short-rest' || at === 'long-rest'
        ? entry.amount !== 'all'
        : entry.amount !== 'all' && typeof entry.amount !== 'string'
    )
      unsupported(packRef, economyId, entry);
    if (
      entry.days !== undefined ||
      entry.period !== undefined ||
      entry.onlyIfUnused !== undefined
    )
      unsupported(packRef, economyId, entry);
    return;
  }
  if (at === 'hour' || at === 'days') {
    if (
      entry.amount !== 'all' ||
      (at === 'days' &&
        (!Number.isSafeInteger(entry.days) || (entry.days as number) < 1)) ||
      (at === 'hour' && entry.days !== undefined) ||
      entry.period !== undefined ||
      entry.onlyIfUnused !== undefined
    )
      unsupported(packRef, economyId, entry);
    const cooldown =
      economy.cooldown === undefined
        ? undefined
        : object(economy.cooldown, `${packRef}.economies.${economyId}.cooldown`)
            .duration;
    if (cooldown !== undefined) {
      const duration = object(
        cooldown,
        `${packRef}.economies.${economyId}.cooldown.duration`,
      );
      if (
        (at === 'hour' && duration.unit !== 'hour') ||
        (at === 'days' && duration.unit !== 'day')
      )
        unsupported(packRef, economyId, entry);
      if (
        at === 'days' &&
        typeof duration.amount === 'number' &&
        duration.amount !== entry.days
      )
        unsupported(packRef, economyId, entry);
    }
    return;
  }
  if (
    economy.kind !== 'budget' ||
    entry.amount === undefined ||
    typeof entry.amount !== 'object' ||
    entry.period === undefined ||
    typeof entry.onlyIfUnused !== 'boolean' ||
    entry.onlyIfUnused !== true ||
    entry.days !== undefined
  )
    unsupported(packRef, economyId, entry);
  object(entry.amount, `${packRef}.economies.${economyId}.reset.amount`);
  const period = object(
    entry.period,
    `${packRef}.economies.${economyId}.reset.period`,
  );
  if (typeof period.amount !== 'number') unsupported(packRef, economyId, entry);
  durationAmount(entry.period, packRef, economyId, undefined);
}

function resolveItem(
  db: Db,
  row: ItemRow,
  resolver: CampaignRulesPackResolver | undefined,
): ResolvedItem {
  const packRef = validatePackRef(row.pack_ref, 'inventory.pack_ref');
  const hit = lookupStrictCampaignRecord(db, 'magic-item', packRef, resolver);
  if (hit === undefined)
    throw new ItemResetExecutorError(
      `inventory packRef '${packRef}' does not resolve in the active campaign rules stack`,
    );
  const mechanics = effectiveMagicItemMechanics(
    hit.record,
    row.variant_id ?? undefined,
  );
  return {
    row,
    packRef,
    variantId: row.variant_id ?? undefined,
    record: hit.record,
    stack: hit.stack,
    mechanics: (mechanics ?? {}) as unknown as Obj,
  };
}

function rowsForItems(db: Db, participants?: readonly string[]): ItemRow[] {
  const participantFilter =
    participants === undefined
      ? ''
      : ` AND i.character_id IN (${participants.map(() => '?').join(',')})`;
  return db
    .prepare(
      `SELECT i.id, i.pack_ref, i.variant_id
       FROM item_state s JOIN inventory i ON i.id=s.inventory_id
       WHERE i.pack_ref IS NOT NULL${participantFilter}
       ORDER BY i.id`,
    )
    .all(...(participants ?? [])) as ItemRow[];
}

function currentElapsedMinutes(db: Db): number {
  const row = db
    .prepare('SELECT elapsed_minutes FROM clock WHERE id = 1')
    .get() as { elapsed_minutes?: number } | undefined;
  if (row === undefined || !Number.isSafeInteger(row.elapsed_minutes))
    throw new ItemResetExecutorError(
      'campaign clock elapsed_minutes is malformed',
    );
  return row.elapsed_minutes as number;
}

function resolveTable(item: ResolvedItem, ref: string) {
  const result = item.stack.recordsByKind.get('table')?.byKey.get(ref);
  return result?.record;
}

function validatedState(
  item: ResolvedItem,
  state: ItemInstanceState,
): ItemInstanceState {
  return validateItemStateForRecord(
    state,
    item.packRef,
    item.record,
    item.variantId,
    { resolveTable: (ref) => resolveTable(item, ref) },
  );
}

function canRegain(state: ItemInstanceState, economyId: string): boolean {
  const lifecycle = state.lifecycle;
  if (lifecycle === undefined) return true;
  if (lifecycle.status === 'consumed' || lifecycle.status === 'nonmagical')
    return false;
  return (
    lifecycle.pendingTerminal === undefined &&
    (state.depletions ?? []).some(
      (depletion) =>
        depletion.economyId === economyId && depletion.becomes === 'inert',
    )
  );
}

function crossedBoundaries(
  previousElapsedMinutes: number,
  elapsedMinutes: number,
  minuteOfDay: number,
): number[] {
  const firstDay = Math.floor(previousElapsedMinutes / 1_440);
  const first = firstDay * 1_440 + minuteOfDay;
  const result: number[] = [];
  for (let boundary = first; boundary <= elapsedMinutes; boundary += 1_440)
    if (boundary > previousElapsedMinutes) result.push(boundary);
  return result;
}

interface CrossedBoundary {
  readonly event: 'dawn' | 'dusk';
  readonly elapsedMinutes: number;
}

function crossedBoundaryEvents(
  previousElapsedMinutes: number,
  elapsedMinutes: number,
): CrossedBoundary[] {
  return [
    ...crossedBoundaries(previousElapsedMinutes, elapsedMinutes, 360).map(
      (boundaryElapsedMinutes) => ({
        event: 'dawn' as const,
        elapsedMinutes: boundaryElapsedMinutes,
      }),
    ),
    ...crossedBoundaries(previousElapsedMinutes, elapsedMinutes, 1_080).map(
      (boundaryElapsedMinutes) => ({
        event: 'dusk' as const,
        elapsedMinutes: boundaryElapsedMinutes,
      }),
    ),
  ].sort((a, b) => a.elapsedMinutes - b.elapsedMinutes);
}

function economyMaximum(
  item: ResolvedItem,
  state: ItemInstanceState,
  economyId: string,
  economy: Obj,
): number {
  try {
    return resolveEconomyMax(state, economyId, economy);
  } catch (error) {
    throw new ItemResetExecutorError(
      `${item.packRef} instance '${item.row.id}' economy '${economyId}' maximum is unrecoverable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function applyReset(
  item: ResolvedItem,
  state: ItemInstanceState,
  economyId: string,
  economy: Obj,
  entry: Obj,
  event: string,
  boundaryElapsedMinutes: number,
  rng: Rng | undefined,
): { state: ItemInstanceState; evidence?: ItemResetEvidence } {
  const current = state.economies?.[economyId];
  if (current === undefined)
    throw new ItemResetExecutorError(
      `${item.packRef} instance '${item.row.id}' economy '${economyId}' has no live state`,
    );
  const amount = resetAmount(
    entry,
    item.packRef,
    economyId,
    state,
    economy,
    rng,
  );
  const maximum = economyMaximum(item, state, economyId, economy);
  const previous = current.remaining;
  const restored =
    amount.requested === 'all'
      ? maximum - previous
      : Math.max(0, Math.min(amount.requested, maximum - previous));
  const nextEconomy = {
    ...current,
    remaining: Math.min(maximum, previous + restored),
    lastReset: String(boundaryElapsedMinutes),
  };
  const nextState: ItemInstanceState = {
    ...state,
    economies: { ...(state.economies ?? {}), [economyId]: nextEconomy },
    ...(state.lifecycle?.status === 'inert' ? { lifecycle: undefined } : {}),
  };
  return {
    state: validatedState(item, nextState),
    evidence: {
      instanceId: item.row.id,
      packRef: item.packRef,
      economy: economyId,
      event,
      boundaryElapsedMinutes,
      previousRemaining: previous,
      restored,
      remaining: nextEconomy.remaining,
      maximum,
      amount: amount.requested,
      ...(amount.roll === undefined ? {} : { roll: amount.roll }),
    },
  };
}

function resetItem(
  db: Db,
  item: ResolvedItem,
  state: ItemInstanceState,
  event: string,
  boundaryElapsedMinutes: number,
  rng: Rng | undefined,
  ctx: ItemResetExecutorContext,
): {
  state: ItemInstanceState;
  evidence: ItemResetEvidence[];
  changed: boolean;
} {
  let next = state;
  const evidence: ItemResetEvidence[] = [];
  let changed = false;
  const economies = object(
    item.mechanics.economies ?? {},
    `${item.packRef}.economies`,
  );
  for (const [economyId, rawEconomy] of Object.entries(economies)) {
    const economy = object(
      rawEconomy,
      `${item.packRef}.economies.${economyId}`,
    );
    const entries = resetEntries(item.packRef, economyId, economy);
    for (const entry of entries) {
      validateResetShape(item.packRef, economyId, economy, entry);
      if (entry.at !== event) continue;
      if (!canRegain(next, economyId)) continue;
      if (
        (event === 'dawn' || event === 'dusk') &&
        next.economies?.[economyId]?.lastReset !== undefined &&
        Number(next.economies[economyId].lastReset) >= boundaryElapsedMinutes
      )
        continue;
      const applied = applyReset(
        item,
        next,
        economyId,
        economy,
        entry,
        event,
        boundaryElapsedMinutes,
        rng,
      );
      next = applied.state;
      if (applied.evidence !== undefined) evidence.push(applied.evidence);
      changed = true;
    }
  }
  if (changed) writeItemState(db, item.row.id, next, ctx);
  return { state: next, evidence, changed };
}

const ANCHORED_RESET_EVENTS = ['hour', 'days', 'per-period'] as const;
type AnchoredResetEvent = (typeof ANCHORED_RESET_EVENTS)[number];

interface DueAnchoredReset {
  readonly economyId: string;
  readonly economy: Obj;
  readonly entry: Obj;
  readonly at: AnchoredResetEvent;
  readonly dueElapsedMinutes: number;
}

function anchoredResetEvent(value: unknown): AnchoredResetEvent | undefined {
  return ANCHORED_RESET_EVENTS.includes(value as AnchoredResetEvent)
    ? (value as AnchoredResetEvent)
    : undefined;
}

/**
 * The earliest anchored reset due at or before `elapsedMinutes`. Equal
 * deadlines break on economy id so a replayed advance applies them in the same
 * order.
 */
function nextDueAnchoredReset(
  item: ResolvedItem,
  state: ItemInstanceState,
  elapsedMinutes: number,
): DueAnchoredReset | undefined {
  let earliest: DueAnchoredReset | undefined;
  const economies = object(
    item.mechanics.economies ?? {},
    `${item.packRef}.economies`,
  );
  for (const [economyId, rawEconomy] of Object.entries(economies)) {
    const economy = object(
      rawEconomy,
      `${item.packRef}.economies.${economyId}`,
    );
    for (const entry of resetEntries(item.packRef, economyId, economy)) {
      validateResetShape(item.packRef, economyId, economy, entry);
      const at = anchoredResetEvent(entry.at);
      if (at === undefined) continue;
      const current = state.economies?.[economyId];
      if (current?.availableAt === undefined) continue;
      const dueElapsedMinutes = Number(current.availableAt);
      if (!Number.isSafeInteger(dueElapsedMinutes) || dueElapsedMinutes < 0)
        throw new ItemResetExecutorError(
          `${item.packRef} instance '${item.row.id}' economy '${economyId}' availableAt is malformed`,
        );
      if (dueElapsedMinutes > elapsedMinutes) continue;
      if (!canRegain(state, economyId)) continue;
      if (
        earliest === undefined ||
        dueElapsedMinutes < earliest.dueElapsedMinutes ||
        (dueElapsedMinutes === earliest.dueElapsedMinutes &&
          economyId < earliest.economyId)
      )
        earliest = { economyId, economy, entry, at, dueElapsedMinutes };
    }
  }
  return earliest;
}

function withAvailableAt(
  state: ItemInstanceState,
  economyId: string,
  availableAt: string | undefined,
): ItemInstanceState {
  const current = state.economies?.[economyId];
  if (current === undefined) return state;
  return {
    ...state,
    economies: {
      ...(state.economies ?? {}),
      [economyId]: { ...current, availableAt },
    },
  };
}

/**
 * Apply one due anchored reset. A `per-period` economy re-anchors for its next
 * period only while it is below maximum; once full its schedule stops and the
 * next spend re-anchors it, so a long advance cannot keep firing empty resets.
 */
function applyAnchoredReset(
  db: Db,
  item: ResolvedItem,
  state: ItemInstanceState,
  due: DueAnchoredReset,
  rng: Rng | undefined,
  ctx: ItemResetExecutorContext,
): { state: ItemInstanceState; evidence?: ItemResetEvidence } {
  const { economyId, economy, entry, at, dueElapsedMinutes } = due;
  const current = state.economies?.[economyId];
  if (current === undefined)
    throw new ItemResetExecutorError(
      `${item.packRef} instance '${item.row.id}' economy '${economyId}' has no live state`,
    );
  if (
    at === 'per-period' &&
    current.remaining >= economyMaximum(item, state, economyId, economy)
  ) {
    const cleared = validatedState(
      item,
      withAvailableAt(state, economyId, undefined),
    );
    writeItemState(db, item.row.id, cleared, ctx);
    return { state: cleared };
  }
  const applied = applyReset(
    item,
    state,
    economyId,
    economy,
    entry,
    at,
    dueElapsedMinutes,
    rng,
  );
  const restored = applied.evidence;
  const nextAvailableAt =
    at === 'per-period' &&
    restored !== undefined &&
    restored.remaining < restored.maximum
      ? String(
          dueElapsedMinutes +
            durationMinutes(entry.period, item.packRef, economyId, rng).amount,
        )
      : undefined;
  const next = validatedState(
    item,
    withAvailableAt(applied.state, economyId, nextAvailableAt),
  );
  writeItemState(db, item.row.id, next, ctx);
  return {
    state: next,
    ...(restored === undefined ? {} : { evidence: restored }),
  };
}

function sameDuration(a: unknown, b: unknown): boolean {
  const left = object(a, 'timer declaration');
  const right = object(b, 'resolved timer');
  return (
    left.unit === right.unit &&
    (typeof left.amount !== 'number' || left.amount === right.amount)
  );
}

function machineTransitions(item: ResolvedItem): Obj[] {
  const machine = object(
    item.mechanics.stateMachine,
    `${item.packRef}.stateMachine`,
  );
  return Array.isArray(machine.transitions)
    ? machine.transitions.map((raw) =>
        object(raw, `${item.packRef}.stateMachine.transitions[]`),
      )
    : [];
}

function nextDueTimer(
  state: ItemInstanceState,
  elapsedMinutes: number,
): ItemStateTimer | undefined {
  return [...(state.pendingTimers ?? [])]
    .sort((a, b) => a.deadlineElapsedMinutes - b.deadlineElapsedMinutes)
    .find((candidate) => candidate.deadlineElapsedMinutes <= elapsedMinutes);
}

/**
 * Fire one due timer. Returns no state when the item was destroyed, which ends
 * that item's timeline.
 */
function applyDueTimer(
  db: Db,
  item: ResolvedItem,
  state: ItemInstanceState,
  timer: ItemStateTimer,
  ctx: ItemResetExecutorContext,
): { state?: ItemInstanceState; evidence: ItemTimerResolutionEvidence } {
  const transitions = machineTransitions(item);
  const effects = Array.isArray(item.mechanics.effects)
    ? item.mechanics.effects
    : [];
  if (timer.from !== state.machineState)
    throw new ItemResetExecutorError(
      `${item.packRef} instance '${item.row.id}' timer '${timer.from}' -> '${timer.to}' is not pending from machineState '${state.machineState}'`,
    );
  // The same state pair can be joined by both an operation transition and a
  // timer transition (Cube of Force: press-face-6 and the barrier's one
  // minute), so only timer-bearing candidates license a pending timer.
  const transition = transitions.find(
    (candidate) =>
      candidate.from === timer.from &&
      candidate.to === timer.to &&
      candidate.timer !== undefined &&
      sameDuration(candidate.timer, {
        amount: timer.amount,
        unit: timer.unit,
      }),
  );
  if (transition === undefined)
    throw new ItemResetExecutorError(
      `${item.packRef} instance '${item.row.id}' has an unlicensed pending timer ${JSON.stringify(timer)}`,
    );
  // A machine has one current state, so leaving `timer.from` cancels every
  // timer that state owned, not only the timer that fired.
  const remainingTimers = (state.pendingTimers ?? []).filter(
    (candidate) => candidate.from !== timer.from,
  );
  const declarations = transitions
    .filter(
      (candidate) =>
        candidate.from === timer.to && candidate.timer !== undefined,
    )
    .map((candidate) => ({
      to: String(candidate.to),
      timer: candidate.timer as MagicItemDurationSpec,
    }));
  let scheduled: readonly ItemStateTimer[];
  try {
    scheduled = resolveItemStateTimers(db, timer.to, declarations, ctx.rng, {
      anchorElapsedMinutes: timer.deadlineElapsedMinutes,
    });
  } catch (error) {
    if (error instanceof ItemTimerError)
      throw new ItemResetExecutorError(
        `${item.packRef} instance '${item.row.id}' ${error.message}`,
      );
    throw error;
  }
  if (
    scheduled.some(
      (entry) => entry.deadlineElapsedMinutes <= timer.deadlineElapsedMinutes,
    )
  )
    throw new ItemResetExecutorError(
      `${item.packRef} instance '${item.row.id}' state '${timer.to}' declares a timer that expires no later than the transition that entered it`,
    );
  const nextState = validatedState(item, {
    ...state,
    machineState: String(timer.to),
    pendingTimers: [...remainingTimers, ...scheduled],
  });
  const evidence: ItemTimerResolutionEvidence = {
    instanceId: item.row.id,
    packRef: item.packRef,
    from: timer.from,
    to: timer.to,
    deadlineElapsedMinutes: timer.deadlineElapsedMinutes,
    timer,
    effects: effects.filter((effect) => {
      const entry = object(effect, `${item.packRef}.effects[]`);
      return (
        Array.isArray(transition.effects) &&
        transition.effects.includes(entry.id)
      );
    }),
  };
  // A deferred destruction completes once the clock can no longer move this
  // machine — that is, when entering this state scheduled no further timer.
  // An intermediate state still runs its cascade first, and a state whose only
  // exit is an operation cannot strand the item forever, because no timer
  // would ever fire to complete the terminal.
  if (
    timer.to === 'destroyed' ||
    (nextState.lifecycle?.pendingTerminal === 'destroyed' &&
      scheduled.length === 0)
  ) {
    const destruction = destroyInventoryItem(db, item.row.id, ctx);
    return {
      evidence: {
        ...evidence,
        ...(destruction.attunementsEnded.length === 0
          ? {}
          : { attunementsEnded: destruction.attunementsEnded }),
      },
    };
  }
  writeItemState(db, item.row.id, nextState, ctx);
  return { state: nextState, evidence };
}

/**
 * Apply every event this item owes in chronological order. Dawn/dusk
 * boundaries, anchored economy deadlines, and machine timers interleave, so an
 * item destroyed at minute 1 can never first regain charges at a later dawn,
 * and `lastReset` only ever moves forward. Events landing on the same minute
 * run timers first, then anchored resets, then dawn/dusk.
 */
function resolveItemTimeline(
  db: Db,
  item: ResolvedItem,
  initialState: ItemInstanceState,
  boundaries: readonly CrossedBoundary[],
  elapsedMinutes: number,
  ctx: ItemResetExecutorContext,
): ItemClockEventResolution {
  const itemResets: ItemResetEvidence[] = [];
  const itemTimerResolutions: ItemTimerResolutionEvidence[] = [];
  let state: ItemInstanceState | undefined = initialState;
  let boundaryIndex = 0;
  while (state !== undefined) {
    const boundary = boundaries[boundaryIndex];
    const anchored = nextDueAnchoredReset(item, state, elapsedMinutes);
    const timer =
      item.mechanics.stateMachine === undefined
        ? undefined
        : nextDueTimer(state, elapsedMinutes);
    if (boundary === undefined && anchored === undefined && timer === undefined)
      break;
    const earliest = Math.min(
      boundary?.elapsedMinutes ?? Number.POSITIVE_INFINITY,
      anchored?.dueElapsedMinutes ?? Number.POSITIVE_INFINITY,
      timer?.deadlineElapsedMinutes ?? Number.POSITIVE_INFINITY,
    );
    if (timer !== undefined && timer.deadlineElapsedMinutes === earliest) {
      const applied = applyDueTimer(db, item, state, timer, ctx);
      itemTimerResolutions.push(applied.evidence);
      state = applied.state;
      continue;
    }
    if (anchored !== undefined && anchored.dueElapsedMinutes === earliest) {
      const applied = applyAnchoredReset(
        db,
        item,
        state,
        anchored,
        ctx.rng,
        ctx,
      );
      if (applied.evidence !== undefined) itemResets.push(applied.evidence);
      state = applied.state;
      continue;
    }
    if (boundary === undefined) break;
    const applied = resetItem(
      db,
      item,
      state,
      boundary.event,
      boundary.elapsedMinutes,
      ctx.rng,
      ctx,
    );
    state = applied.state;
    itemResets.push(...applied.evidence);
    boundaryIndex += 1;
  }
  return { itemResets, itemTimerResolutions };
}

export function resolveDueItemClockEvents(
  db: Db,
  input: ItemResetExecutorContext & {
    readonly campaignId: string;
    readonly previousElapsedMinutes: number;
    readonly elapsedMinutes: number;
  },
): ItemClockEventResolution {
  if (
    !Number.isSafeInteger(input.previousElapsedMinutes) ||
    !Number.isSafeInteger(input.elapsedMinutes) ||
    input.elapsedMinutes < input.previousElapsedMinutes
  )
    throw new ItemResetExecutorError('item clock event interval is malformed');
  const itemResets: ItemResetEvidence[] = [];
  const itemTimerResolutions: ItemTimerResolutionEvidence[] = [];
  const boundaries = crossedBoundaryEvents(
    input.previousElapsedMinutes,
    input.elapsedMinutes,
  );
  for (const row of rowsForItems(db)) {
    const item = resolveItem(db, row, input.resolveRulesPack);
    const rawState = readItemState(db, row.id);
    if (rawState === undefined) continue;
    const resolved = resolveItemTimeline(
      db,
      item,
      validatedState(item, rawState),
      boundaries,
      input.elapsedMinutes,
      input,
    );
    itemResets.push(...resolved.itemResets);
    itemTimerResolutions.push(...resolved.itemTimerResolutions);
  }
  return { itemResets, itemTimerResolutions };
}

export function resolveRestEventItemResets(
  db: Db,
  input: ItemResetExecutorContext & {
    readonly campaignId: string;
    readonly event: 'short-rest' | 'long-rest';
    readonly participants: readonly string[];
  },
): readonly ItemResetEvidence[] {
  const evidence: ItemResetEvidence[] = [];
  for (const row of rowsForItems(db, input.participants)) {
    const item = resolveItem(db, row, input.resolveRulesPack);
    const rawState = readItemState(db, row.id);
    if (rawState === undefined) continue;
    const state = validatedState(item, rawState);
    const applied = resetItem(
      db,
      item,
      state,
      input.event,
      currentElapsedMinutes(db),
      input.rng,
      input,
    );
    evidence.push(...applied.evidence);
  }
  return evidence;
}
