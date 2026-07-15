import { assertSupportedCharacterBuild } from '../character/characterBuild.js';
import { createSqliteCharacterSheetStore } from '../character/characterSheetStore.js';
import { getBundledDnd5eCharacterResolver } from '../character/rulesPackResolver.js';
import { type DiceRoll, rollDice } from '../orchestrator/dice.js';
import type { Rng } from '../orchestrator/rng.js';
import { type Db, withTransaction } from '../persistence/db.js';
import { expireElapsedWorldEffects } from './activeEffects.js';
import { adjustHp, expireTemporaryHp, type LifeState } from './hpLifecycle.js';
import { mutateState } from './mutateState.js';
import { restoreSpellSlots } from './spellSlots.js';
import { resetUsage } from './usageCounters.js';

export type RestKind = 'short' | 'long';
export interface RestContext {
  provenance: string;
  sessionId: string;
  at: string;
}
export interface AdvanceWorldTimeInput extends RestContext {
  campaignId: string;
  minutes: number;
  inGameTimeLabel?: string;
}
export interface WorldClock {
  elapsedMinutes: number;
  inGameTime?: string;
}

export interface RestQualification {
  readonly durationMinutes: number;
  readonly sleepMinutes: number;
  readonly lightActivityMinutes: number;
  readonly strenuousInterruptionMinutes: number;
  readonly strenuousActivity: boolean;
  readonly foodAndDrink: boolean;
}
export interface CompleteRestInput extends RestContext {
  campaignId: string;
  restId: string;
  participants: readonly string[];
  qualification: RestQualification;
  rng?: Rng;
}
export interface HitDicePool {
  characterId: string;
  dieFaces: number;
  diceMaximum: number;
  diceUsed: number;
  diceRemaining: number;
  provenance: string;
  updatedAt: string;
}
export interface SpendHitDieInput extends RestContext {
  campaignId: string;
  restId: string;
  characterId: string;
  rng: Rng;
}

export class RestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestError';
  }
}

function int(value: unknown, label: string, min = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < min)
    throw new RestError(`${label} must be a nonnegative safe integer`);
  return value as number;
}
function clock(db: Db): WorldClock {
  const row = db
    .prepare('SELECT elapsed_minutes, in_game_time FROM clock WHERE id = 1')
    .get() as { elapsed_minutes?: number; in_game_time: string } | undefined;
  if (!row) throw new RestError('campaign clock is missing');
  const elapsedMinutes = row.elapsed_minutes ?? 0;
  int(elapsedMinutes, 'clock elapsed_minutes');
  return { elapsedMinutes, inGameTime: row.in_game_time || undefined };
}

/** The only operation that advances the structured world timeline. */
export function advanceWorldTime(
  db: Db,
  input: AdvanceWorldTimeInput,
): WorldClock {
  return withTransaction(db, (txn) => {
    const minutes = int(input.minutes, 'minutes', 1);
    const before = clock(txn);
    const next = before.elapsedMinutes + minutes;
    if (!Number.isSafeInteger(next))
      throw new RestError('world clock would exceed safe integer range');
    mutateState(txn, {
      target: 'clock',
      field: 'elapsed_minutes',
      op: 'set',
      value: next,
      ...input,
    });
    if (input.inGameTimeLabel !== undefined)
      mutateState(txn, {
        target: 'clock',
        field: 'in_game_time',
        op: 'set',
        value: input.inGameTimeLabel,
        ...input,
      });
    expireElapsedWorldEffects(txn, {
      campaignId: input.campaignId,
      elapsedMinutes: next,
      provenance: input.provenance,
      sessionId: input.sessionId,
      at: input.at,
    });
    return {
      elapsedMinutes: next,
      inGameTime: input.inGameTimeLabel ?? before.inGameTime,
    };
  });
}

function resolvePool(
  db: Db,
  characterId: string,
  ctx: RestContext,
): HitDicePool {
  const sheet = createSqliteCharacterSheetStore(db).load(characterId);
  if (!sheet)
    throw new RestError(`no canonical character sheet for '${characterId}'`);
  const resolver = getBundledDnd5eCharacterResolver();
  assertSupportedCharacterBuild(sheet, { operation: 'Hit Dice', resolver });
  const live = db
    .prepare('SELECT level FROM character WHERE id = ?')
    .get(characterId) as { level: number } | undefined;
  if (!live || live.level !== sheet.level)
    throw new RestError(
      `character '${characterId}' live level disagrees with canonical sheet`,
    );
  const cls = resolver.resolveClass(sheet.class.key);
  if (!cls.ok) throw new RestError(cls.message);
  const faces = cls.record.hitDie;
  if (![6, 8, 10, 12].includes(faces))
    throw new RestError(`illegal Hit Die faces '${faces}'`);
  const existing = db
    .prepare(
      'SELECT die_faces, dice_maximum, dice_used FROM character_hit_dice WHERE character_id = ?',
    )
    .get(characterId) as
    | { die_faces: number; dice_maximum: number; dice_used: number }
    | undefined;
  if (
    existing &&
    (existing.die_faces !== faces ||
      existing.dice_used < 0 ||
      existing.dice_used > existing.dice_maximum)
  )
    throw new RestError(`malformed Hit Dice pool for '${characterId}'`);
  const maximum = sheet.level;
  const used = existing?.dice_used ?? 0;
  if (used > maximum)
    throw new RestError(`Hit Dice spent exceeds capacity for '${characterId}'`);
  db.prepare(`INSERT INTO character_hit_dice(character_id, die_faces, dice_maximum, dice_used, provenance, session_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(character_id) DO UPDATE SET die_faces=excluded.die_faces, dice_maximum=excluded.dice_maximum, provenance=excluded.provenance, session_id=excluded.session_id, updated_at=excluded.updated_at`).run(
    characterId,
    faces,
    maximum,
    used,
    ctx.provenance,
    ctx.sessionId,
    ctx.at,
  );
  return {
    characterId,
    dieFaces: faces,
    diceMaximum: maximum,
    diceUsed: used,
    diceRemaining: maximum - used,
    provenance: ctx.provenance,
    updatedAt: ctx.at,
  };
}
export function readHitDice(
  db: Db,
  characterId: string,
  ctx: RestContext,
): HitDicePool {
  return withTransaction(db, (txn) => resolvePool(txn, characterId, ctx));
}

function participants(ids: readonly string[]): string[] {
  const unique = [...new Set(ids)];
  if (
    unique.length === 0 ||
    unique.some((id) => typeof id !== 'string' || id.length === 0)
  )
    throw new RestError('participants must be a non-empty unique list');
  return unique.sort();
}
const QUALIFICATION_KEYS = new Set([
  'durationMinutes',
  'sleepMinutes',
  'lightActivityMinutes',
  'strenuousInterruptionMinutes',
  'strenuousActivity',
  'foodAndDrink',
]);

function normalizeQualification(value: unknown): RestQualification {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new RestError('qualification must be an object');
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw))
    if (!QUALIFICATION_KEYS.has(key))
      throw new RestError(`unknown qualification property '${key}'`);
  const numberField = (key: string, required: boolean): number => {
    const value = raw[key];
    if (value === undefined && !required) return 0;
    return int(value, `qualification.${key}`);
  };
  const boolField = (key: string): boolean => {
    const value = raw[key];
    if (value === undefined) return false;
    if (typeof value !== 'boolean')
      throw new RestError(`qualification.${key} must be boolean`);
    return value;
  };
  return {
    durationMinutes: numberField('durationMinutes', true),
    sleepMinutes: numberField('sleepMinutes', false),
    lightActivityMinutes: numberField('lightActivityMinutes', false),
    strenuousInterruptionMinutes: numberField(
      'strenuousInterruptionMinutes',
      false,
    ),
    strenuousActivity: boolField('strenuousActivity'),
    foodAndDrink: boolField('foodAndDrink'),
  };
}

function qualificationJson(q: RestQualification): string {
  return JSON.stringify(normalizeQualification(q));
}
function readLife(
  db: Db,
  id: string,
): { hp: number; max: number; life: LifeState; temp: number } {
  const row = db
    .prepare(
      'SELECT hp_current hp, hp_max max, life_state life, hp_temp temp FROM character WHERE id = ?',
    )
    .get(id) as
    | { hp: number; max: number; life: LifeState; temp: number }
    | undefined;
  if (!row) throw new RestError(`participant '${id}' does not exist`);
  return row;
}

function applyExhaustion(
  db: Db,
  id: string,
  eligible: boolean,
  input: RestContext,
): unknown {
  const row = db
    .prepare('SELECT conditions_json FROM character WHERE id = ?')
    .get(id) as { conditions_json: string };
  let conditions: Array<Record<string, unknown>>;
  try {
    conditions = JSON.parse(row.conditions_json) as Array<
      Record<string, unknown>
    >;
  } catch {
    throw new RestError(`malformed conditions for '${id}'`);
  }
  const index = conditions.findIndex(
    (condition) =>
      condition.id === 'exhaustion' || condition.id === 'exhausted',
  );
  if (index < 0 || !eligible) return { changed: false };
  const level = conditions[index]?.level;
  if (
    !Number.isInteger(level) ||
    (level as number) < 1 ||
    (level as number) > 6
  )
    throw new RestError(`malformed exhaustion state for '${id}'`);
  const next = [...conditions];
  if (level === 1) next.splice(index, 1);
  else next[index] = { ...conditions[index], level: (level as number) - 1 };
  mutateState(db, {
    target: 'character',
    id,
    field: 'conditions_json',
    op: 'set',
    value: next,
    ...input,
  });
  return {
    changed: true,
    from: level,
    to: level === 1 ? 0 : (level as number) - 1,
  };
}

function validateQualification(kind: RestKind, q: RestQualification): void {
  int(q.durationMinutes, 'durationMinutes');
  if (kind === 'short') {
    if (q.durationMinutes < 60 || q.strenuousActivity)
      throw new RestError(
        'short rest requires 60 minutes without strenuous activity',
      );
    return;
  }
  if (
    q.durationMinutes < 480 ||
    q.sleepMinutes < 360 ||
    q.lightActivityMinutes > 120 ||
    q.strenuousInterruptionMinutes >= 60
  )
    throw new RestError('long rest qualification failed');
}

function complete(db: Db, kind: RestKind, input: CompleteRestInput): unknown {
  return withTransaction(db, (txn) => {
    const ids = participants(input.participants);
    const normalizedQualification = normalizeQualification(input.qualification);
    validateQualification(kind, normalizedQualification);
    const existing = txn
      .prepare(
        'SELECT kind, qualification_json, status, end_elapsed_minutes FROM rest_event WHERE campaign_id = ? AND rest_id = ?',
      )
      .get(input.campaignId, input.restId) as
      | {
          kind: RestKind;
          qualification_json: string;
          status: string;
          end_elapsed_minutes: number;
        }
      | undefined;
    if (existing) {
      if (
        existing.kind !== kind ||
        existing.qualification_json !==
          qualificationJson(normalizedQualification) ||
        existing.status !== 'completed'
      )
        throw new RestError('conflicting or incomplete rest-id reuse');
      const prior = txn
        .prepare(
          'SELECT benefits_json FROM rest_event WHERE campaign_id = ? AND rest_id = ?',
        )
        .get(input.campaignId, input.restId) as { benefits_json: string };
      const priorBenefits = JSON.parse(prior.benefits_json) as {
        participants?: string[];
      };
      if (
        JSON.stringify(priorBenefits.participants ?? []) !== JSON.stringify(ids)
      )
        throw new RestError(
          'conflicting participant declaration for reused rest id',
        );
      return priorBenefits;
    }
    const activeCombat = txn
      .prepare(
        "SELECT 1 FROM combat_instance WHERE campaign_id=? AND status='active' LIMIT 1",
      )
      .get(input.campaignId);
    if (activeCombat)
      throw new RestError('cannot complete a rest while combat is active');
    const start = clock(txn);
    const end = start.elapsedMinutes + input.qualification.durationMinutes;
    const states = ids.map((id) => ({ id, ...readLife(txn, id) }));
    for (const state of states) {
      resolvePool(txn, state.id, input);
      if (kind === 'long' && (state.life === 'dead' || state.hp < 1))
        throw new RestError(
          `participant '${state.id}' cannot benefit from a long rest`,
        );
    }
    if (kind === 'long') {
      const recent = txn
        .prepare(
          `SELECT 1 FROM rest_participant p JOIN rest_event r USING(campaign_id, rest_id) WHERE p.character_id IN (${ids.map(() => '?').join(',')}) AND r.kind='long' AND r.status='completed' AND r.end_elapsed_minutes > ? AND r.end_elapsed_minutes <= ? LIMIT 1`,
        )
        .get(...ids, start.elapsedMinutes - 1440, start.elapsedMinutes);
      if (recent)
        throw new RestError(
          'a participant already benefited from a long rest within 24 in-game hours',
        );
    }
    txn
      .prepare(
        `INSERT INTO rest_event(campaign_id, rest_id, kind, start_elapsed_minutes, end_elapsed_minutes, declared_duration_minutes, qualification_json, status, provenance, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress', ?, ?, ?, ?)`,
      )
      .run(
        input.campaignId,
        input.restId,
        kind,
        start.elapsedMinutes,
        end,
        normalizedQualification.durationMinutes,
        qualificationJson(normalizedQualification),
        input.provenance,
        input.sessionId,
        input.at,
        input.at,
      );
    for (const s of states)
      txn
        .prepare(
          'UPDATE rest_participant SET short_recovery_open=0 WHERE campaign_id=? AND character_id=? AND short_recovery_open=1',
        )
        .run(input.campaignId, s.id);
    for (const s of states)
      txn
        .prepare(
          'INSERT INTO rest_participant(campaign_id, rest_id, character_id, start_hp, start_life_state, short_recovery_open) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          input.campaignId,
          input.restId,
          s.id,
          s.hp,
          s.life,
          kind === 'short' ? 1 : 0,
        );
    advanceWorldTime(txn, {
      ...input,
      minutes: normalizedQualification.durationMinutes,
    });
    const benefits = {
      kind,
      restId: input.restId,
      startElapsedMinutes: start.elapsedMinutes,
      endElapsedMinutes: end,
      participants: ids,
      hpRestored: {} as Record<string, unknown>,
      temporaryHpRemoved: {} as Record<string, unknown>,
      hitDiceRestored: {} as Record<string, unknown>,
      slotsRestored: {} as Record<string, unknown>,
      usageReset: {} as Record<string, unknown>,
      exhaustion: {} as Record<string, unknown>,
    };
    for (const s of states) {
      if (kind === 'long') {
        const healed = adjustHp(txn, s.max - s.hp, {
          ...input,
          characterId: s.id,
        });
        const temp = expireTemporaryHp(txn, { ...input, characterId: s.id });
        const pool = resolvePool(txn, s.id, input);
        const restore = Math.max(1, Math.floor(pool.diceMaximum / 2));
        const restored = Math.min(restore, pool.diceUsed);
        txn
          .prepare(
            'UPDATE character_hit_dice SET dice_used = dice_used - ?, provenance = ?, session_id = ?, updated_at = ? WHERE character_id = ?',
          )
          .run(restored, input.provenance, input.sessionId, input.at, s.id);
        benefits.hpRestored[s.id] = healed.newHp - s.hp;
        benefits.temporaryHpRemoved[s.id] = temp.previousTempHp;
        benefits.hitDiceRestored[s.id] = restored;
        benefits.slotsRestored[s.id] = restoreSpellSlots(txn, {
          ...input,
          characterId: s.id,
          event: 'long_rest',
        }).restored;
        benefits.usageReset[s.id] = resetUsage(txn, {
          ...input,
          campaignId: input.campaignId,
          event: 'long_rest',
          owner: { kind: 'character', ref: s.id },
        }).reset;
        benefits.exhaustion[s.id] = applyExhaustion(
          txn,
          s.id,
          normalizedQualification.foodAndDrink,
          input,
        );
        txn
          .prepare(
            'UPDATE rest_participant SET short_recovery_open=0 WHERE campaign_id=? AND rest_id=? AND character_id=?',
          )
          .run(input.campaignId, input.restId, s.id);
      } else {
        benefits.slotsRestored[s.id] = restoreSpellSlots(txn, {
          ...input,
          characterId: s.id,
          event: 'short_rest',
        }).restored;
        benefits.usageReset[s.id] = resetUsage(txn, {
          ...input,
          campaignId: input.campaignId,
          event: 'short_rest',
          owner: { kind: 'character', ref: s.id },
        }).reset;
      }
    }
    txn
      .prepare(
        "UPDATE rest_event SET status='completed', benefits_json=?, updated_at=? WHERE campaign_id=? AND rest_id=?",
      )
      .run(JSON.stringify(benefits), input.at, input.campaignId, input.restId);
    return benefits;
  });
}
export function completeShortRest(db: Db, input: CompleteRestInput): unknown {
  return complete(db, 'short', input);
}
export function completeLongRest(db: Db, input: CompleteRestInput): unknown {
  return complete(db, 'long', input);
}

export function spendRestHitDie(db: Db, input: SpendHitDieInput): unknown {
  return withTransaction(db, (txn) => {
    const row = txn
      .prepare(
        "SELECT 1 FROM rest_event r JOIN rest_participant p USING(campaign_id, rest_id) WHERE r.campaign_id=? AND r.rest_id=? AND r.kind='short' AND r.status='completed' AND p.character_id=? AND p.short_recovery_open=1",
      )
      .get(input.campaignId, input.restId, input.characterId);
    if (!row)
      throw new RestError(
        'short-rest recovery window is closed or character was not a participant',
      );
    const pool = resolvePool(txn, input.characterId, input);
    if (pool.diceRemaining < 1) throw new RestError('no Hit Dice remain');
    const state = readLife(txn, input.characterId);
    if (state.life === 'dead')
      throw new RestError('dead characters cannot spend Hit Dice');
    const roll: DiceRoll = rollDice(`1d${pool.dieFaces}`, input.rng);
    const modifier =
      createSqliteCharacterSheetStore(txn).load(input.characterId)
        ?.abilityScores.constitution.modifier ?? 0;
    const raw = Math.max(0, roll.natural + modifier);
    const healed = adjustHp(txn, raw, {
      ...input,
      characterId: input.characterId,
    });
    txn
      .prepare(
        'UPDATE character_hit_dice SET dice_used=dice_used+1, provenance=?, session_id=?, updated_at=? WHERE character_id=?',
      )
      .run(input.provenance, input.sessionId, input.at, input.characterId);
    return {
      restId: input.restId,
      characterId: input.characterId,
      visibility: 'player_visible',
      category: 'hit_die',
      reason: `Hit Die recovery during short rest ${input.restId}`,
      dice: roll.notation,
      rolls: roll.rolls,
      kept: roll.kept,
      keptIndices: roll.keptIndices,
      dropped: roll.dropped,
      droppedIndices: roll.droppedIndices,
      modifier: roll.modifier,
      total: roll.total,
      rollEvidence: roll,
      constitutionModifier: modifier,
      constitutionSource: 'canonical character sheet',
      rawHealing: raw,
      hpRestored: healed.newHp - state.hp,
      hpBefore: state.hp,
      hpAfter: healed.newHp,
      hitDiceRemaining: pool.diceRemaining - 1,
    };
  });
}
export function finishShortRestRecovery(
  db: Db,
  campaignId: string,
  restId: string,
  _ctx: RestContext,
): void {
  withTransaction(db, (txn) => {
    const r = txn
      .prepare(
        'UPDATE rest_participant SET short_recovery_open=0 WHERE campaign_id=? AND rest_id=? AND short_recovery_open=1',
      )
      .run(campaignId, restId);
    if (r.changes === 0)
      throw new RestError('no open short-rest recovery window');
  });
}
