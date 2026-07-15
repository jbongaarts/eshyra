// Durable spell-slot economy (eshyra-2n1t.6, engine family F4).
//
// The canonical character sheet owns the sole class and level. This module
// derives live slot capacity from that code-owned progression, then owns only
// the mutable expenditure/recovery counters. It never accepts a caller-supplied
// slot table, effective caster level, or class association: ADR 0018's shared
// single-class boundary is checked before every seed, spend, and rest reset.

import { assertSupportedCharacterBuild } from '../character/characterBuild.js';
import {
  assertSheetMatchesPack,
  createSqliteCharacterSheetStore,
} from '../character/characterSheetStore.js';
import {
  getBundledDnd5eCharacterResolver,
  type RulesPackCharacterResolver,
} from '../character/rulesPackResolver.js';
import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import {
  DEFAULT_DND5E_SRD_BINDING,
  readCampaignRulesBinding,
} from '../rules/binding.js';
import { resolveCharacterId } from './activeCharacter.js';

export type SpellSlotPoolKind = 'spellcasting' | 'pact_magic';
export type SpellSlotRestEvent = 'short_rest' | 'long_rest';

export interface SpellSlotCounter {
  readonly characterId: string;
  readonly pool: SpellSlotPoolKind;
  readonly spellLevel: number;
  readonly slotsMax: number;
  readonly slotsUsed: number;
  readonly slotsRemaining: number;
}

export interface SpellSlotMutationContext {
  readonly characterId?: string;
  readonly resolver?: RulesPackCharacterResolver;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export interface SpendSpellSlotInput extends SpellSlotMutationContext {
  /** Base level of the spell being cast; cantrips are level 0 and use no slot. */
  readonly spellLevel: number;
  /**
   * Requested slot level. When omitted, the lowest available legal level is
   * spent. A stated value makes an intentional upcast auditable; F9 owns the
   * resulting scaling transform.
   */
  readonly slotLevel?: number;
  /**
   * Validate the selected slot while the spend transaction is still open.
   * Model-facing callers never provide this; the orchestrator uses it to
   * resolve source-bound spell scaling before the counter is incremented.
   */
  readonly beforeSpend?: (selectedSlotLevel: number) => void;
}

export interface SpendSpellSlotResult {
  readonly counter: SpellSlotCounter;
  /** False for a cantrip, which is explicitly at will. */
  readonly spent: boolean;
}

export interface RestoreSpellSlotsInput extends SpellSlotMutationContext {
  readonly event: SpellSlotRestEvent;
}

export interface RestoreSpellSlotsResult {
  readonly event: SpellSlotRestEvent;
  readonly restored: readonly SpellSlotCounter[];
}

export class SpellSlotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpellSlotError';
  }
}

interface SlotRow {
  readonly character_id: string;
  readonly pool_kind: SpellSlotPoolKind;
  readonly spell_level: number;
  readonly slots_max: number;
  readonly slots_used: number;
}

interface SlotCapacity {
  readonly pool: SpellSlotPoolKind;
  readonly spellLevel: number;
  readonly slotsMax: number;
}

const SLOT_COLUMNS =
  'character_id, pool_kind, spell_level, slots_max, slots_used';

/**
 * Reconcile durable slot counters with the character's sole class progression.
 * Missing counters are seeded full; level-up capacity increases retain existing
 * expenditure, and stale counters are removed rather than silently becoming a
 * second class's pool.
 */
export function syncSpellSlots(
  db: Db,
  input: SpellSlotMutationContext,
): readonly SpellSlotCounter[] {
  return withTransaction(db, (txnDb) => {
    const characterId = resolveCharacterId(txnDb, input.characterId);
    const capacities = resolveSlotCapacities(
      txnDb,
      characterId,
      input.resolver,
    );
    reconcileSlots(txnDb, characterId, capacities, input);
    return readSlotRows(txnDb, characterId).map(rowToCounter);
  });
}

/** Read already-seeded counters without modifying state. */
export function readSpellSlots(
  db: Db,
  characterId?: string,
): readonly SpellSlotCounter[] {
  return readSlotRows(db, resolveCharacterId(db, characterId)).map(
    rowToCounter,
  );
}

/**
 * Spend a legal slot for a spell. A cantrip (level 0) is an at-will exemption;
 * a leveled spell must consume an available slot at its own level or higher.
 */
export function spendSpellSlot(
  db: Db,
  input: SpendSpellSlotInput,
): SpendSpellSlotResult {
  if (
    !Number.isInteger(input.spellLevel) ||
    input.spellLevel < 0 ||
    input.spellLevel > 9
  ) {
    throw new SpellSlotError('spellLevel must be an integer from 0 through 9');
  }
  if (
    input.slotLevel !== undefined &&
    (!Number.isInteger(input.slotLevel) ||
      input.slotLevel < 1 ||
      input.slotLevel > 9)
  ) {
    throw new SpellSlotError('slotLevel must be an integer from 1 through 9');
  }
  if (input.spellLevel === 0) {
    if (input.slotLevel !== undefined) {
      throw new SpellSlotError('cantrips do not use a spell slot');
    }
    return withTransaction(db, (txnDb) => {
      const characterId = resolveCharacterId(txnDb, input.characterId);
      // Cantrips do not seed or mutate a slot counter, but a cast is still a
      // character-build operation. Run the entire ADR 0018 / pack / live-level
      // validation path before returning the at-will exemption.
      resolveSlotCapacities(txnDb, characterId, input.resolver);
      return {
        spent: false,
        counter: {
          characterId,
          pool: 'spellcasting',
          spellLevel: 0,
          slotsMax: 0,
          slotsUsed: 0,
          slotsRemaining: 0,
        },
      };
    });
  }
  if (input.slotLevel !== undefined && input.slotLevel < input.spellLevel) {
    throw new SpellSlotError(
      `a level ${input.spellLevel} spell requires a slot of level ${input.spellLevel} or higher`,
    );
  }

  return withTransaction(db, (txnDb) => {
    const characterId = resolveCharacterId(txnDb, input.characterId);
    const capacities = resolveSlotCapacities(
      txnDb,
      characterId,
      input.resolver,
    );
    reconcileSlots(txnDb, characterId, capacities, input);
    const candidates = readSlotRows(txnDb, characterId).filter(
      (row) =>
        row.slots_used < row.slots_max &&
        row.spell_level >= input.spellLevel &&
        (input.slotLevel === undefined || row.spell_level === input.slotLevel),
    );
    const selected = candidates.sort(
      (left, right) =>
        left.spell_level - right.spell_level ||
        left.pool_kind.localeCompare(right.pool_kind),
    )[0];
    if (selected === undefined) {
      const requested = input.slotLevel ?? input.spellLevel;
      throw new SpellSlotError(
        `no available level ${requested} or higher spell slot for a level ${input.spellLevel} spell`,
      );
    }
    input.beforeSpend?.(selected.spell_level);
    txnDb
      .prepare(
        `UPDATE character_spell_slot
         SET slots_used = slots_used + 1, provenance = ?, session_id = ?, updated_at = ?
         WHERE character_id = ? AND pool_kind = ? AND spell_level = ?`,
      )
      .run(
        input.provenance,
        input.sessionId,
        input.at,
        characterId,
        selected.pool_kind,
        selected.spell_level,
      );
    const after = readSlotRows(txnDb, characterId).find(
      (row) =>
        row.pool_kind === selected.pool_kind &&
        row.spell_level === selected.spell_level,
    );
    if (after === undefined) {
      throw new SpellSlotError('spell-slot counter disappeared during spend');
    }
    return { spent: true, counter: rowToCounter(after) };
  });
}

/**
 * Apply a rest event to one character's slots. Pact Magic restores after a
 * short or long rest; ordinary Spellcasting slots restore only after a long
 * rest. F7 calls this hook while owning rest eligibility and narration.
 */
export function restoreSpellSlots(
  db: Db,
  input: RestoreSpellSlotsInput,
): RestoreSpellSlotsResult {
  if (input.event !== 'short_rest' && input.event !== 'long_rest') {
    throw new SpellSlotError('event must be short_rest or long_rest');
  }
  return withTransaction(db, (txnDb) => {
    const characterId = resolveCharacterId(txnDb, input.characterId);
    const capacities = resolveSlotCapacities(
      txnDb,
      characterId,
      input.resolver,
    );
    reconcileSlots(txnDb, characterId, capacities, input);
    const pools: readonly SpellSlotPoolKind[] =
      input.event === 'long_rest'
        ? ['spellcasting', 'pact_magic']
        : ['pact_magic'];
    const spent = readSlotRows(txnDb, characterId).filter(
      (row) => row.slots_used > 0 && pools.includes(row.pool_kind),
    );
    for (const row of spent) {
      txnDb
        .prepare(
          `UPDATE character_spell_slot
           SET slots_used = 0, provenance = ?, session_id = ?, updated_at = ?
           WHERE character_id = ? AND pool_kind = ? AND spell_level = ?`,
        )
        .run(
          input.provenance,
          input.sessionId,
          input.at,
          characterId,
          row.pool_kind,
          row.spell_level,
        );
    }
    return {
      event: input.event,
      restored: spent.map((row) => rowToCounter({ ...row, slots_used: 0 })),
    };
  });
}

/** F7's explicit long-rest integration hook. */
export function restoreSpellSlotsAfterLongRest(
  db: Db,
  input: Omit<RestoreSpellSlotsInput, 'event'>,
): RestoreSpellSlotsResult {
  return restoreSpellSlots(db, { ...input, event: 'long_rest' });
}

function resolveSlotCapacities(
  db: Db,
  characterId: string,
  resolverOverride: RulesPackCharacterResolver | undefined,
): readonly SlotCapacity[] {
  const resolver = resolverOverride ?? getBundledDnd5eCharacterResolver();
  const sheet = createSqliteCharacterSheetStore(db).load(characterId);
  if (sheet === undefined) {
    throw new SpellSlotError(`no character sheet stored for '${characterId}'`);
  }
  assertSupportedCharacterBuild(sheet, {
    operation: 'spell-slot economy',
    resolver,
  });
  assertSheetMatchesPack(
    sheet,
    readCampaignRulesBinding(db) ?? DEFAULT_DND5E_SRD_BINDING,
  );
  const live = db
    .prepare('SELECT level FROM character WHERE id = ?')
    .get(characterId) as { level: number } | undefined;
  if (live === undefined || live.level !== sheet.level) {
    throw new SpellSlotError(
      `character '${characterId}' has live level state that disagrees with its sole-class sheet level`,
    );
  }
  const row = resolver.resolveClassLevel(sheet.class.key, sheet.level);
  if (!row.ok) {
    throw new SpellSlotError(
      `cannot resolve spell-slot progression for ${sheet.class.key} at level ${sheet.level}: ${row.message}`,
    );
  }
  const spellcasting = row.record.spellcasting;
  if (spellcasting === undefined) {
    return [];
  }
  const capacities: SlotCapacity[] = [];
  for (const [levelText, count] of Object.entries(spellcasting.slots ?? {})) {
    const level = Number(levelText);
    if (
      !Number.isInteger(level) ||
      level < 1 ||
      level > 9 ||
      !Number.isInteger(count) ||
      count < 1
    ) {
      throw new SpellSlotError(
        `malformed ordinary slot progression for ${sheet.class.key}`,
      );
    }
    capacities.push({
      pool: 'spellcasting',
      spellLevel: level,
      slotsMax: count,
    });
  }
  if (spellcasting.pactSlots !== undefined) {
    const { count, level } = spellcasting.pactSlots;
    if (
      !Number.isInteger(level) ||
      level < 1 ||
      level > 9 ||
      !Number.isInteger(count) ||
      count < 1
    ) {
      throw new SpellSlotError(
        `malformed Pact Magic slot progression for ${sheet.class.key}`,
      );
    }
    capacities.push({ pool: 'pact_magic', spellLevel: level, slotsMax: count });
  }
  return capacities.sort(
    (left, right) =>
      left.spellLevel - right.spellLevel || left.pool.localeCompare(right.pool),
  );
}

function reconcileSlots(
  db: Db,
  characterId: string,
  capacities: readonly SlotCapacity[],
  input: SpellSlotMutationContext,
): void {
  reconcilePactMagicSlot(db, characterId, capacities, input);
  const existing = readSlotRows(db, characterId);
  const expected = new Map(
    capacities.map((capacity) => [
      `${capacity.pool}:${capacity.spellLevel}`,
      capacity,
    ]),
  );
  for (const row of existing) {
    const capacity = expected.get(`${row.pool_kind}:${row.spell_level}`);
    if (capacity === undefined) {
      db.prepare(
        'DELETE FROM character_spell_slot WHERE character_id = ? AND pool_kind = ? AND spell_level = ?',
      ).run(characterId, row.pool_kind, row.spell_level);
      continue;
    }
    if (row.slots_max !== capacity.slotsMax) {
      db.prepare(
        `UPDATE character_spell_slot
         SET slots_max = ?, slots_used = MIN(slots_used, ?), provenance = ?, session_id = ?, updated_at = ?
         WHERE character_id = ? AND pool_kind = ? AND spell_level = ?`,
      ).run(
        capacity.slotsMax,
        capacity.slotsMax,
        input.provenance,
        input.sessionId,
        input.at,
        characterId,
        row.pool_kind,
        row.spell_level,
      );
    }
  }
  for (const capacity of capacities) {
    db.prepare(
      `INSERT OR IGNORE INTO character_spell_slot(
         character_id, pool_kind, spell_level, slots_max, slots_used,
         provenance, session_id, updated_at
       ) VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
    ).run(
      characterId,
      capacity.pool,
      capacity.spellLevel,
      capacity.slotsMax,
      input.provenance,
      input.sessionId,
      input.at,
    );
  }
}

/**
 * Pact Magic has exactly one pool in the single-class domain. Its slot level
 * changes with Warlock progression, but that is a capacity transformation —
 * not a rest — so an existing expenditure must move with the pool.
 */
function reconcilePactMagicSlot(
  db: Db,
  characterId: string,
  capacities: readonly SlotCapacity[],
  input: SpellSlotMutationContext,
): void {
  const desired = capacities.filter((slot) => slot.pool === 'pact_magic');
  if (desired.length > 1) {
    throw new SpellSlotError(
      `multiple Pact Magic slot levels resolved for '${characterId}'`,
    );
  }
  const existing = readSlotRows(db, characterId).filter(
    (slot) => slot.pool_kind === 'pact_magic',
  );
  if (existing.length > 1) {
    throw new SpellSlotError(
      `multiple persisted Pact Magic pools found for '${characterId}'`,
    );
  }
  const target = desired[0];
  const prior = existing[0];
  if (
    target !== undefined &&
    prior !== undefined &&
    prior.spell_level !== target.spellLevel
  ) {
    db.prepare(
      `UPDATE character_spell_slot
       SET spell_level = ?, slots_max = ?, slots_used = MIN(slots_used, ?),
           provenance = ?, session_id = ?, updated_at = ?
       WHERE character_id = ? AND pool_kind = 'pact_magic' AND spell_level = ?`,
    ).run(
      target.spellLevel,
      target.slotsMax,
      target.slotsMax,
      input.provenance,
      input.sessionId,
      input.at,
      characterId,
      prior.spell_level,
    );
  }
}

function readSlotRows(db: Db, characterId: string): SlotRow[] {
  return db
    .prepare(
      `SELECT ${SLOT_COLUMNS} FROM character_spell_slot
       WHERE character_id = ? ORDER BY spell_level, pool_kind`,
    )
    .all(characterId) as SlotRow[];
}

function rowToCounter(row: SlotRow): SpellSlotCounter {
  return {
    characterId: row.character_id,
    pool: row.pool_kind,
    spellLevel: row.spell_level,
    slotsMax: row.slots_max,
    slotsUsed: row.slots_used,
    slotsRemaining: row.slots_max - row.slots_used,
  };
}
