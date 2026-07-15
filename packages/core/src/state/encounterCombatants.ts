import type { AdventureModule } from '../adventure/types.js';
import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import {
  DEFAULT_DND5E_SRD_BINDING,
  readCampaignRulesBinding,
} from '../rules/binding.js';
import { getBundledDnd5eSrdPack } from '../rules/bundledSrdPack.js';
import { lookupRulesRecord } from '../rules/lookup.js';
import { PATHFINDER2E_REMASTER_RULES_PACK } from '../rules/pathfinder2eRemaster.js';
import { resolveRulesStack } from '../rules/stack.js';
import type { RulesPack, RulesRecord } from '../rules/types.js';
// Function-level circular dependency with activeEffects.ts (which mutates
// combatants through updateCombatant during effect cleanup): safe because
// both sides only reference each other inside function bodies, never during
// module evaluation. The reaction lives here, not in the tool wrapper, so
// EVERY updateCombatant caller gets the atomic incapacitation invariant.
import {
  anyConditionImpliesIncapacitated,
  applyCombatClosureToEffects,
  breakCombatantConcentration,
} from './activeEffects.js';
import type { CharacterConditionEntry, JsonValue } from './liveStateSchema.js';
import { closeOpenShortRestRecoveryWindows } from './rest.js';

export type CombatInstanceStatus =
  | 'active'
  | 'completed'
  | 'abandoned'
  | 'fled'
  | 'interrupted';

export type ActorKind = 'npc' | 'creature' | 'monster' | 'companion' | 'other';
export type ActorSourceKind =
  | 'module_npc'
  | 'module_creature'
  | 'encounter_instance'
  | 'campaign_created';
export type ActorStatus =
  | 'alive'
  | 'dead'
  | 'unconscious'
  | 'escaped'
  | 'inactive'
  | 'unknown';
export type CombatantIdentityKind =
  | 'encounter_instance'
  | 'module_npc'
  | 'module_creature'
  | 'campaign_actor';
export type CombatantStatus =
  | 'alive'
  | 'dead'
  | 'unconscious'
  | 'escaped'
  | 'inactive';

export interface CombatInstance {
  readonly campaignId: string;
  readonly combatInstanceId: string;
  readonly sourceEncounterId: string | undefined;
  readonly sourceRunId: string | undefined;
  readonly status: CombatInstanceStatus;
  readonly locationId: string | undefined;
  readonly sessionId: string;
  readonly openedAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | undefined;
}

export interface CampaignActor {
  readonly campaignId: string;
  readonly actorId: string;
  readonly displayName: string;
  readonly actorKind: ActorKind;
  readonly sourceKind: ActorSourceKind;
  readonly sourceRef: string | undefined;
  readonly rulesRef: string | undefined;
  readonly hpCurrent: number | undefined;
  readonly hpMax: number | undefined;
  readonly conditions: readonly CharacterConditionEntry[];
  readonly status: ActorStatus;
  readonly currentLocationId: string | undefined;
  readonly state: Record<string, JsonValue>;
}

export interface EncounterCombatant {
  readonly campaignId: string;
  readonly combatInstanceId: string;
  readonly sourceEncounterId: string | undefined;
  readonly combatantId: string;
  readonly identityKind: CombatantIdentityKind;
  readonly identityRef: string | undefined;
  readonly displayLabel: string;
  readonly rulesRef: string;
  readonly side: string;
  readonly faction: string | undefined;
  readonly hpCurrent: number;
  readonly hpMax: number;
  readonly ac: number | undefined;
  readonly conditions: readonly CharacterConditionEntry[];
  readonly status: CombatantStatus;
  readonly locationId: string | undefined;
  readonly placement: string | undefined;
}

export interface UpsertCampaignActorInput {
  readonly campaignId: string;
  readonly actorId: string;
  readonly displayName: string;
  readonly actorKind: ActorKind;
  readonly sourceKind: ActorSourceKind;
  readonly sourceRef?: string;
  readonly rulesRef?: string;
  readonly hpCurrent?: number;
  readonly hpMax?: number;
  readonly conditions?: readonly CharacterConditionEntry[];
  readonly status?: ActorStatus;
  readonly currentLocationId?: string;
  readonly state?: Record<string, JsonValue>;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export interface StartEncounterActorInput {
  readonly actorId: string;
  readonly displayName?: string;
  readonly actorKind?: ActorKind;
  readonly sourceKind?: ActorSourceKind;
  readonly sourceRef?: string;
  readonly rulesRef?: string;
  readonly hpCurrent?: number;
  readonly hpMax?: number;
  readonly conditions?: readonly CharacterConditionEntry[];
  readonly status?: ActorStatus;
  readonly currentLocationId?: string;
  readonly state?: Record<string, JsonValue>;
  readonly side?: string;
  readonly faction?: string;
  readonly placement?: string;
}

export interface StartEncounterInput {
  readonly campaignId: string;
  readonly encounterId?: string;
  readonly combatInstanceId?: string;
  readonly runId?: string;
  readonly locationId?: string;
  readonly actors?: readonly StartEncounterActorInput[];
  readonly resolveAdventureModule?: (
    moduleId: string,
  ) => AdventureModule | undefined;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export interface StartEncounterResult {
  readonly started: boolean;
  readonly combatInstance: CombatInstance;
  readonly combatants: readonly EncounterCombatant[];
}

export interface CloseCombatInstanceInput {
  readonly campaignId: string;
  readonly combatInstanceId?: string;
  readonly status: Exclude<CombatInstanceStatus, 'active'>;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export interface UpdateCombatantInput {
  readonly campaignId: string;
  readonly combatantId: string;
  readonly hpDelta?: number;
  readonly addCondition?: CharacterConditionEntry;
  readonly removeCondition?: string;
  readonly status?: CombatantStatus;
  readonly locationId?: string;
  readonly placement?: string;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export interface CampaignActorMutationInput {
  readonly campaignId: string;
  readonly actorId: string;
  readonly addCondition?: CharacterConditionEntry;
  readonly removeCondition?: string;
  readonly status?: ActorStatus;
  readonly hpCurrent?: number;
  readonly hpMax?: number;
  readonly currentLocationId?: string;
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

/** Semantic actor mutation seam. It preserves unrelated durable state and
 * mirrors changes into the active projection, when one exists. */
export function updateCampaignActor(
  db: Db,
  input: CampaignActorMutationInput,
): CampaignActor {
  return withTransaction(db, (txnDb) => {
    const actor = getCampaignActor(txnDb, input.campaignId, input.actorId);
    if (actor === undefined) {
      throw new EncounterCombatantError(
        `unknown campaign actor '${input.actorId}'`,
      );
    }
    const conditions = [...actor.conditions];
    if (
      input.addCondition !== undefined &&
      !conditions.some((c) => c.id === input.addCondition?.id)
    ) {
      conditions.push(input.addCondition);
    }
    if (input.removeCondition !== undefined) {
      conditions.splice(
        0,
        conditions.length,
        ...conditions.filter((c) => c.id !== input.removeCondition),
      );
    }
    upsertCampaignActor(txnDb, {
      campaignId: input.campaignId,
      actorId: input.actorId,
      displayName: actor.displayName,
      actorKind: actor.actorKind,
      sourceKind: actor.sourceKind,
      sourceRef: actor.sourceRef,
      rulesRef: actor.rulesRef,
      hpCurrent: input.hpCurrent ?? actor.hpCurrent,
      hpMax: input.hpMax ?? actor.hpMax,
      conditions,
      status: input.status ?? actor.status,
      currentLocationId: input.currentLocationId ?? actor.currentLocationId,
      state: actor.state,
      provenance: input.provenance,
      sessionId: input.sessionId,
      at: input.at,
    });
    const projection = txnDb
      .prepare(
        `SELECT combatant_id, hp_current FROM encounter_combatant
         WHERE campaign_id = ? AND identity_kind = 'campaign_actor' AND identity_ref = ?
           AND combat_instance_id IN (SELECT combat_instance_id FROM combat_instance WHERE campaign_id = ? AND status = 'active')
         ORDER BY combatant_id LIMIT 1`,
      )
      .get(input.campaignId, input.actorId, input.campaignId) as
      | { combatant_id: string; hp_current: number }
      | undefined;
    if (projection !== undefined) {
      if (input.hpMax !== undefined) {
        txnDb
          .prepare(
            `UPDATE encounter_combatant SET hp_max = ?, provenance = ?, session_id = ?, updated_at = ?
             WHERE campaign_id = ? AND combatant_id = ?`,
          )
          .run(
            input.hpMax,
            input.provenance,
            input.sessionId,
            input.at,
            input.campaignId,
            projection.combatant_id,
          );
      }
      updateCombatant(txnDb, {
        campaignId: input.campaignId,
        combatantId: projection.combatant_id,
        ...(input.hpCurrent === undefined
          ? {}
          : { hpDelta: input.hpCurrent - projection.hp_current }),
        ...(input.addCondition === undefined
          ? {}
          : { addCondition: input.addCondition }),
        ...(input.removeCondition === undefined
          ? {}
          : { removeCondition: input.removeCondition }),
        ...(input.status === undefined || input.status === 'unknown'
          ? {}
          : { status: input.status }),
        ...(input.currentLocationId === undefined
          ? {}
          : { locationId: input.currentLocationId }),
        provenance: input.provenance,
        sessionId: input.sessionId,
        at: input.at,
      });
    }
    const updated = getCampaignActor(txnDb, input.campaignId, input.actorId);
    if (updated === undefined) {
      throw new EncounterCombatantError('campaign actor update failed');
    }
    return updated;
  });
}

export function ensureCampaignActorFromCombatant(
  db: Db,
  input: {
    campaignId: string;
    combatantId: string;
    actorId: string;
    provenance: string;
    sessionId: string;
    at: string;
  },
): CampaignActor {
  const combatant = readCombatant(db, input.campaignId, input.combatantId);
  if (combatant === undefined)
    throw new EncounterCombatantError(
      `unknown combatant '${input.combatantId}'`,
    );
  const existing = getCampaignActor(db, input.campaignId, input.actorId);
  if (
    existing !== undefined &&
    existing.rulesRef !== undefined &&
    existing.rulesRef !== combatant.rulesRef
  ) {
    throw new EncounterCombatantError(
      `campaign actor '${input.actorId}' has incompatible rules reference`,
    );
  }
  return upsertCampaignActor(db, {
    campaignId: input.campaignId,
    actorId: input.actorId,
    displayName: existing?.displayName ?? combatant.displayLabel,
    actorKind: existing?.actorKind ?? 'creature',
    sourceKind: existing?.sourceKind ?? 'campaign_created',
    sourceRef: existing?.sourceRef,
    rulesRef: combatant.rulesRef,
    hpCurrent: combatant.hpCurrent,
    hpMax: combatant.hpMax,
    conditions: combatant.conditions,
    status: combatant.status,
    currentLocationId: combatant.locationId,
    state: existing?.state,
    provenance: input.provenance,
    sessionId: input.sessionId,
    at: input.at,
  });
}

export interface UpdateCombatantResult {
  readonly combatant: EncounterCombatant;
  readonly syncedActor: CampaignActor | undefined;
  readonly previousHp: number;
  readonly hpDelta: number | undefined;
  readonly conditionAdded: boolean;
  readonly conditionRemoved: boolean;
  /** Set when this update downed or removed the combatant while it was
   *  concentrating: the F3 break + owned-projection cleanup happened in
   *  this transaction ('owner-removed' = transitioned to inactive). */
  readonly concentrationBroken?: {
    readonly effectId: string;
    readonly displayName: string;
    readonly cause: 'incapacitated' | 'dead' | 'owner-removed';
  };
}

export class EncounterCombatantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncounterCombatantError';
  }
}

interface AdventureRunRow {
  readonly run_id: string;
  readonly module_id: string;
}

interface CombatInstanceRow {
  readonly campaign_id: string;
  readonly combat_instance_id: string;
  readonly source_encounter_id: string | null;
  readonly source_run_id: string | null;
  readonly status: string;
  readonly location_id: string | null;
  readonly session_id: string;
  readonly opened_at: string;
  readonly updated_at: string;
  readonly closed_at: string | null;
}

interface ActorRow {
  readonly campaign_id: string;
  readonly actor_id: string;
  readonly display_name: string;
  readonly actor_kind: string;
  readonly source_kind: string;
  readonly source_ref: string | null;
  readonly rules_ref: string | null;
  readonly hp_current: number | null;
  readonly hp_max: number | null;
  readonly conditions_json: string;
  readonly status: string;
  readonly current_location_id: string | null;
  readonly state_json: string;
}

interface CombatantRow {
  readonly campaign_id: string;
  readonly combat_instance_id: string;
  readonly source_encounter_id: string | null;
  readonly combatant_id: string;
  readonly identity_kind: string;
  readonly identity_ref: string | null;
  readonly display_label: string;
  readonly rules_ref: string;
  readonly side: string;
  readonly faction: string | null;
  readonly hp_current: number;
  readonly hp_max: number;
  readonly ac: number | null;
  readonly conditions_json: string;
  readonly status: string;
  readonly location_id: string | null;
  readonly placement: string | null;
}

function rowToCombatInstance(row: CombatInstanceRow): CombatInstance {
  return {
    campaignId: row.campaign_id,
    combatInstanceId: row.combat_instance_id,
    sourceEncounterId: row.source_encounter_id ?? undefined,
    sourceRunId: row.source_run_id ?? undefined,
    status: row.status as CombatInstanceStatus,
    locationId: row.location_id ?? undefined,
    sessionId: row.session_id,
    openedAt: row.opened_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at ?? undefined,
  };
}

function rowToActor(row: ActorRow): CampaignActor {
  return {
    campaignId: row.campaign_id,
    actorId: row.actor_id,
    displayName: row.display_name,
    actorKind: row.actor_kind as ActorKind,
    sourceKind: row.source_kind as ActorSourceKind,
    sourceRef: row.source_ref ?? undefined,
    rulesRef: row.rules_ref ?? undefined,
    hpCurrent: row.hp_current ?? undefined,
    hpMax: row.hp_max ?? undefined,
    conditions: JSON.parse(row.conditions_json) as CharacterConditionEntry[],
    status: row.status as ActorStatus,
    currentLocationId: row.current_location_id ?? undefined,
    state: JSON.parse(row.state_json) as Record<string, JsonValue>,
  };
}

function rowToCombatant(row: CombatantRow): EncounterCombatant {
  return {
    campaignId: row.campaign_id,
    combatInstanceId: row.combat_instance_id,
    sourceEncounterId: row.source_encounter_id ?? undefined,
    combatantId: row.combatant_id,
    identityKind: row.identity_kind as CombatantIdentityKind,
    identityRef: row.identity_ref ?? undefined,
    displayLabel: row.display_label,
    rulesRef: row.rules_ref,
    side: row.side,
    faction: row.faction ?? undefined,
    hpCurrent: row.hp_current,
    hpMax: row.hp_max,
    ac: row.ac ?? undefined,
    conditions: JSON.parse(row.conditions_json) as CharacterConditionEntry[],
    status: row.status as CombatantStatus,
    locationId: row.location_id ?? undefined,
    placement: row.placement ?? undefined,
  };
}

function slug(value: string): string {
  const normalized = value.toLowerCase();
  let start = 0;
  let prefixEnd = 0;
  while (prefixEnd < normalized.length) {
    const code = normalized.charCodeAt(prefixEnd);
    if (code < 97 || code > 122) break;
    prefixEnd += 1;
  }
  if (prefixEnd > 0 && normalized[prefixEnd] === ':') {
    start = prefixEnd + 1;
  }

  let result = '';
  let pendingSeparator = false;
  for (let i = start; i < normalized.length; i += 1) {
    const code = normalized.charCodeAt(i);
    const isDigit = code >= 48 && code <= 57;
    const isAsciiLetter = code >= 97 && code <= 122;
    if (isDigit || isAsciiLetter) {
      if (pendingSeparator && result.length > 0) {
        result += '-';
      }
      result += normalized[i];
      pendingSeparator = false;
    } else {
      pendingSeparator = true;
    }
  }

  return result || 'combat';
}

function displayNameFromRulesRef(rulesRef: string): string {
  return slug(rulesRef)
    .split('-')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function bundledRulesPacks(): readonly RulesPack[] {
  return [getBundledDnd5eSrdPack(), PATHFINDER2E_REMASTER_RULES_PACK];
}

function campaignBasePack(db: Db): RulesPack {
  const binding = readCampaignRulesBinding(db) ?? DEFAULT_DND5E_SRD_BINDING;
  const pack = bundledRulesPacks().find(
    (candidate) => candidate.meta.packId === binding.base.packId,
  );
  return pack ?? getBundledDnd5eSrdPack();
}

function lookupCreatureRecord(
  db: Db,
  rulesRef: string,
): RulesRecord | undefined {
  const pack = campaignBasePack(db);
  const result = lookupRulesRecord(resolveRulesStack({ base: pack }), {
    kind: 'creature',
    ref: rulesRef,
  });
  return result.ok ? result.record : undefined;
}

/**
 * Read a creature's base armor class. SRD packs since eshyra-o9bd.18.6 model
 * `armorClass` as a structured `{ value, … }` statline object; older/other
 * packs may still carry a bare integer, so both shapes are accepted (mirrors
 * `readCreatureHp`).
 */
function readCreatureAc(record: RulesRecord | undefined): number | undefined {
  const data = record?.data;
  if (typeof data !== 'object' || data === null) return undefined;
  const ac = (data as Record<string, unknown>).armorClass;
  if (typeof ac === 'number' && Number.isInteger(ac)) return ac;
  if (typeof ac !== 'object' || ac === null) return undefined;
  const value = (ac as Record<string, unknown>).value;
  return typeof value === 'number' && Number.isInteger(value)
    ? value
    : undefined;
}

function readCreatureHp(record: RulesRecord | undefined): number {
  const data = record?.data;
  if (typeof data !== 'object' || data === null) return 1;
  const hp = (data as Record<string, unknown>).hitPoints;
  if (typeof hp === 'number' && Number.isInteger(hp) && hp >= 0) return hp;
  if (typeof hp !== 'object' || hp === null) return 1;
  const value = (hp as Record<string, unknown>).value;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 1;
}

function activeInstance(db: Db, campaignId: string) {
  const row = db
    .prepare(
      `SELECT campaign_id, combat_instance_id, source_encounter_id,
              source_run_id, status, location_id, session_id, opened_at,
              updated_at, closed_at
       FROM combat_instance
       WHERE campaign_id = ? AND status = 'active'
       ORDER BY opened_at DESC
       LIMIT 1`,
    )
    .get(campaignId) as CombatInstanceRow | undefined;
  return row === undefined ? undefined : rowToCombatInstance(row);
}

function requireNoActiveInstance(db: Db, campaignId: string) {
  const active = activeInstance(db, campaignId);
  if (active !== undefined) {
    throw new EncounterCombatantError(
      `combat instance '${active.combatInstanceId}' is already active; close or interrupt it before starting another`,
    );
  }
}

function nextCombatInstanceId(
  db: Db,
  campaignId: string,
  sourceEncounterId: string | undefined,
): string {
  const base = `ci-${slug(sourceEncounterId ?? 'combat')}`;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM combat_instance
       WHERE campaign_id = ? AND combat_instance_id LIKE ?`,
    )
    .get(campaignId, `${base}-%`) as { n: number };
  return `${base}-${row.n + 1}`;
}

function readActiveAdventureRuns(
  db: Db,
  campaignId: string,
  runId: string | undefined,
): AdventureRunRow[] {
  const sql =
    runId === undefined
      ? `SELECT run_id, module_id
         FROM adventure_run
         WHERE campaign_id = ? AND status = 'active'
         ORDER BY run_id`
      : `SELECT run_id, module_id
         FROM adventure_run
         WHERE campaign_id = ? AND run_id = ? AND status = 'active'
         ORDER BY run_id`;
  return (
    runId === undefined
      ? db.prepare(sql).all(campaignId)
      : db.prepare(sql).all(campaignId, runId)
  ) as AdventureRunRow[];
}

function findEncounterInActiveRun(db: Db, input: StartEncounterInput) {
  if (input.encounterId === undefined) return undefined;
  if (input.resolveAdventureModule === undefined) {
    throw new EncounterCombatantError(
      'start_encounter requires an active adventure module resolver',
    );
  }
  for (const run of readActiveAdventureRuns(
    db,
    input.campaignId,
    input.runId,
  )) {
    const module = input.resolveAdventureModule(run.module_id);
    const encounter = module?.encounters.find(
      (e) => e.id === input.encounterId,
    );
    if (module !== undefined && encounter !== undefined) {
      return { run, encounter };
    }
  }
  throw new EncounterCombatantError(
    `encounter '${input.encounterId}' was not found in an active adventure run`,
  );
}

export function getCampaignActor(
  db: Db,
  campaignId: string,
  actorId: string,
): CampaignActor | undefined {
  const row = db
    .prepare(
      `SELECT campaign_id, actor_id, display_name, actor_kind, source_kind,
              source_ref, rules_ref, hp_current, hp_max, conditions_json,
              status, current_location_id, state_json
       FROM campaign_actor
       WHERE campaign_id = ? AND actor_id = ?`,
    )
    .get(campaignId, actorId) as ActorRow | undefined;
  return row === undefined ? undefined : rowToActor(row);
}

export function upsertCampaignActor(
  db: Db,
  input: UpsertCampaignActorInput,
): CampaignActor {
  db.prepare(
    `INSERT INTO campaign_actor(
       campaign_id, actor_id, display_name, actor_kind, source_kind, source_ref,
       rules_ref, hp_current, hp_max, conditions_json, status,
       current_location_id, state_json, provenance, session_id, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, actor_id) DO UPDATE SET
       display_name = excluded.display_name,
       actor_kind = excluded.actor_kind,
       source_kind = excluded.source_kind,
       source_ref = excluded.source_ref,
       rules_ref = excluded.rules_ref,
       hp_current = excluded.hp_current,
       hp_max = excluded.hp_max,
       conditions_json = excluded.conditions_json,
       status = excluded.status,
       current_location_id = excluded.current_location_id,
       state_json = excluded.state_json,
       provenance = excluded.provenance,
       session_id = excluded.session_id,
       updated_at = excluded.updated_at`,
  ).run(
    input.campaignId,
    input.actorId,
    input.displayName,
    input.actorKind,
    input.sourceKind,
    input.sourceRef ?? null,
    input.rulesRef ?? null,
    input.hpCurrent ?? null,
    input.hpMax ?? null,
    JSON.stringify(input.conditions ?? []),
    input.status ?? 'unknown',
    input.currentLocationId ?? null,
    JSON.stringify(input.state ?? {}),
    input.provenance,
    input.sessionId,
    input.at,
  );
  const actor = getCampaignActor(db, input.campaignId, input.actorId);
  if (actor === undefined) {
    throw new EncounterCombatantError('campaign actor upsert failed');
  }
  return actor;
}

export function listCombatantsForInstance(
  db: Db,
  campaignId: string,
  combatInstanceId: string,
): EncounterCombatant[] {
  const rows = db
    .prepare(
      `SELECT campaign_id, combat_instance_id, source_encounter_id,
              combatant_id, identity_kind, identity_ref, display_label,
              rules_ref, side, faction, hp_current, hp_max, ac,
              conditions_json, status, location_id, placement
       FROM encounter_combatant
       WHERE campaign_id = ? AND combat_instance_id = ?
       ORDER BY combatant_id`,
    )
    .all(campaignId, combatInstanceId) as CombatantRow[];
  return rows.map(rowToCombatant);
}

export function listCombatants(
  db: Db,
  campaignId: string,
): EncounterCombatant[] {
  const active = activeInstance(db, campaignId);
  return active === undefined
    ? []
    : listCombatantsForInstance(db, campaignId, active.combatInstanceId);
}

export function listCampaignActors(
  db: Db,
  campaignId: string,
): CampaignActor[] {
  const rows = db
    .prepare(
      `SELECT campaign_id, actor_id, display_name, actor_kind, source_kind,
              source_ref, rules_ref, hp_current, hp_max, conditions_json,
              status, current_location_id, state_json
       FROM campaign_actor
       WHERE campaign_id = ?
       ORDER BY actor_id`,
    )
    .all(campaignId) as ActorRow[];
  return rows.map(rowToActor);
}

function insertCombatant(
  db: Db,
  input: {
    campaignId: string;
    combatInstanceId: string;
    sourceEncounterId: string | undefined;
    combatantId: string;
    identityKind: CombatantIdentityKind;
    identityRef?: string;
    displayLabel: string;
    rulesRef: string;
    side: string;
    faction?: string;
    hpCurrent: number;
    hpMax: number;
    ac?: number;
    conditions?: readonly CharacterConditionEntry[];
    status: CombatantStatus;
    locationId?: string;
    placement?: string;
    provenance: string;
    sessionId: string;
    at: string;
  },
) {
  db.prepare(
    `INSERT INTO encounter_combatant(
       campaign_id, combat_instance_id, source_encounter_id, combatant_id,
       identity_kind, identity_ref, display_label, rules_ref, side, faction,
       hp_current, hp_max, ac, conditions_json, status, location_id, placement,
       provenance, session_id, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.campaignId,
    input.combatInstanceId,
    input.sourceEncounterId ?? null,
    input.combatantId,
    input.identityKind,
    input.identityRef ?? null,
    input.displayLabel,
    input.rulesRef,
    input.side,
    input.faction ?? null,
    input.hpCurrent,
    input.hpMax,
    input.ac ?? null,
    JSON.stringify(input.conditions ?? []),
    input.status,
    input.locationId ?? null,
    input.placement ?? null,
    input.provenance,
    input.sessionId,
    input.at,
  );
}

export function startEncounter(
  db: Db,
  input: StartEncounterInput,
): StartEncounterResult {
  return withTransaction(db, (txnDb) => startEncounterInTxn(txnDb, input));
}

function startEncounterInTxn(
  db: Db,
  input: StartEncounterInput,
): StartEncounterResult {
  closeOpenShortRestRecoveryWindows(db, input.campaignId);
  requireNoActiveInstance(db, input.campaignId);
  const source = findEncounterInActiveRun(db, input);
  const combatInstanceId =
    input.combatInstanceId ??
    nextCombatInstanceId(db, input.campaignId, input.encounterId);
  const sourceRunId = input.runId ?? source?.run.run_id;
  const locationId = input.locationId ?? source?.encounter.locationId;

  db.prepare(
    `INSERT INTO combat_instance(
       campaign_id, combat_instance_id, source_encounter_id, source_run_id,
       status, location_id, provenance, session_id, opened_at, updated_at,
       closed_at
     )
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NULL)`,
  ).run(
    input.campaignId,
    combatInstanceId,
    input.encounterId ?? null,
    sourceRunId ?? null,
    locationId ?? null,
    input.provenance,
    input.sessionId,
    input.at,
    input.at,
  );

  let ordinal = 1;
  for (const creature of source?.encounter.creatures ?? []) {
    const record = lookupCreatureRecord(db, creature.rulesRef);
    const hpMax = readCreatureHp(record);
    const ac = readCreatureAc(record);
    const baseId = slug(creature.rulesRef);
    const baseLabel =
      record?.name ?? displayNameFromRulesRef(creature.rulesRef);
    for (let i = 0; i < creature.count; i += 1) {
      insertCombatant(db, {
        campaignId: input.campaignId,
        combatInstanceId,
        sourceEncounterId: input.encounterId,
        combatantId: `${combatInstanceId}-${baseId}-${ordinal}`,
        identityKind: 'encounter_instance',
        displayLabel: creature.count > 1 ? `${baseLabel} ${i + 1}` : baseLabel,
        rulesRef: creature.rulesRef,
        side: 'enemy',
        faction: creature.role,
        hpCurrent: hpMax,
        hpMax,
        ac,
        status: 'alive',
        locationId,
        placement: creature.role,
        provenance: input.provenance,
        sessionId: input.sessionId,
        at: input.at,
      });
      ordinal += 1;
    }
  }

  for (const actorInput of input.actors ?? []) {
    const existing = getCampaignActor(db, input.campaignId, actorInput.actorId);
    const rulesRef = actorInput.rulesRef ?? existing?.rulesRef;
    if (rulesRef === undefined) {
      throw new EncounterCombatantError(
        `actor '${actorInput.actorId}' needs rulesRef for combat projection`,
      );
    }
    const record = lookupCreatureRecord(db, rulesRef);
    const baselineHp = readCreatureHp(record);
    const hpMax = actorInput.hpMax ?? existing?.hpMax ?? baselineHp;
    const hpCurrent = actorInput.hpCurrent ?? existing?.hpCurrent ?? hpMax;
    const conditions = actorInput.conditions ?? existing?.conditions ?? [];
    const actor = upsertCampaignActor(db, {
      campaignId: input.campaignId,
      actorId: actorInput.actorId,
      displayName:
        actorInput.displayName ??
        existing?.displayName ??
        record?.name ??
        displayNameFromRulesRef(rulesRef),
      actorKind: actorInput.actorKind ?? existing?.actorKind ?? 'creature',
      sourceKind:
        actorInput.sourceKind ?? existing?.sourceKind ?? 'campaign_created',
      sourceRef: actorInput.sourceRef ?? existing?.sourceRef,
      rulesRef,
      hpCurrent,
      hpMax,
      conditions,
      status: actorInput.status ?? existing?.status ?? 'alive',
      currentLocationId:
        actorInput.currentLocationId ??
        existing?.currentLocationId ??
        locationId,
      state: actorInput.state ?? existing?.state,
      provenance: input.provenance,
      sessionId: input.sessionId,
      at: input.at,
    });
    insertCombatant(db, {
      campaignId: input.campaignId,
      combatInstanceId,
      sourceEncounterId: input.encounterId,
      combatantId: `${combatInstanceId}-${slug(actor.actorId)}`,
      identityKind: 'campaign_actor',
      identityRef: actor.actorId,
      displayLabel: actor.displayName,
      rulesRef,
      side: actorInput.side ?? 'enemy',
      faction: actorInput.faction,
      hpCurrent: actor.hpCurrent ?? hpMax,
      hpMax: actor.hpMax ?? hpMax,
      ac: readCreatureAc(record),
      conditions: actor.conditions,
      status:
        actorInput.status === undefined &&
        (actor.status === 'escaped' ||
          actor.status === 'inactive' ||
          actor.status === 'unknown')
          ? 'alive'
          : actor.status === 'unknown'
            ? 'alive'
            : actor.status,
      locationId: actor.currentLocationId ?? locationId,
      placement: actorInput.placement,
      provenance: input.provenance,
      sessionId: input.sessionId,
      at: input.at,
    });
  }

  const combatInstance = activeInstance(db, input.campaignId);
  if (combatInstance === undefined) {
    throw new EncounterCombatantError('combat instance failed to start');
  }
  return {
    started: true,
    combatInstance,
    combatants: listCombatantsForInstance(
      db,
      input.campaignId,
      combatInstance.combatInstanceId,
    ),
  };
}

export function closeCombatInstance(
  db: Db,
  input: CloseCombatInstanceInput,
): CombatInstance {
  // One transaction covers the F3 closure boundary and the status flip: a
  // closed instance can never be committed while live effect state still
  // points at its combatants (F3 mutation audit §7). The effect reactions
  // run FIRST, while the combatants are still mutable.
  return withTransaction(db, (txnDb) => closeCombatInstanceInTxn(txnDb, input));
}

function closeCombatInstanceInTxn(
  db: Db,
  input: CloseCombatInstanceInput,
): CombatInstance {
  const instance =
    input.combatInstanceId === undefined
      ? activeInstance(db, input.campaignId)
      : readCombatInstance(db, input.campaignId, input.combatInstanceId);
  if (instance === undefined) {
    throw new EncounterCombatantError('no matching active combat instance');
  }
  if (instance.status !== 'active') {
    throw new EncounterCombatantError(
      `combat instance '${instance.combatInstanceId}' is ${instance.status} and cannot be reactivated or closed again`,
    );
  }
  applyCombatClosureToEffects(db, input.campaignId, instance.combatInstanceId, {
    provenance: input.provenance,
    sessionId: input.sessionId,
    at: input.at,
  });
  db.prepare(
    `UPDATE combat_instance
     SET status = ?, provenance = ?, session_id = ?, updated_at = ?, closed_at = ?
     WHERE campaign_id = ? AND combat_instance_id = ? AND status = 'active'`,
  ).run(
    input.status,
    input.provenance,
    input.sessionId,
    input.at,
    input.at,
    input.campaignId,
    instance.combatInstanceId,
  );
  const closed = readCombatInstance(
    db,
    input.campaignId,
    instance.combatInstanceId,
  );
  if (closed === undefined) {
    throw new EncounterCombatantError(
      'combat instance disappeared during close',
    );
  }
  return closed;
}

/**
 * The campaign's currently active combat instance, or `undefined` when no
 * combat is active. A read-only wrapper over the private active-instance lookup,
 * exposed so callers outside the encounter engine (e.g. the resume
 * conflict-resolution UX, eshyra-lupf.14.4) can warn before mutating a character
 * mid-combat.
 */
export function getActiveCombatInstance(
  db: Db,
  campaignId: string,
): CombatInstance | undefined {
  return activeInstance(db, campaignId);
}

export function readCombatInstance(
  db: Db,
  campaignId: string,
  combatInstanceId: string,
): CombatInstance | undefined {
  const row = db
    .prepare(
      `SELECT campaign_id, combat_instance_id, source_encounter_id,
              source_run_id, status, location_id, session_id, opened_at,
              updated_at, closed_at
       FROM combat_instance
       WHERE campaign_id = ? AND combat_instance_id = ?`,
    )
    .get(campaignId, combatInstanceId) as CombatInstanceRow | undefined;
  return row === undefined ? undefined : rowToCombatInstance(row);
}

function validCombatantIdsMessage(db: Db, campaignId: string): string {
  const ids = listCombatants(db, campaignId).map((c) => c.combatantId);
  return ids.length > 0
    ? `Valid active combatant ids: ${ids.join(', ')}.`
    : 'No active combatants are currently instantiated.';
}

function readCombatant(
  db: Db,
  campaignId: string,
  combatantId: string,
): EncounterCombatant | undefined {
  const row = db
    .prepare(
      `SELECT campaign_id, combat_instance_id, source_encounter_id,
              combatant_id, identity_kind, identity_ref, display_label,
              rules_ref, side, faction, hp_current, hp_max, ac,
              conditions_json, status, location_id, placement
       FROM encounter_combatant
       WHERE campaign_id = ? AND combatant_id = ?`,
    )
    .get(campaignId, combatantId) as CombatantRow | undefined;
  return row === undefined ? undefined : rowToCombatant(row);
}

export function updateCombatant(
  db: Db,
  input: UpdateCombatantInput,
): UpdateCombatantResult {
  // One transaction covers the combatant write, the actor sync, AND the F3
  // concentration reaction below: a combatant can never be committed as
  // down/dead while its concentration cleanup is lost or partial.
  return withTransaction(db, (txnDb) => updateCombatantInTxn(txnDb, input));
}

function updateCombatantInTxn(
  db: Db,
  input: UpdateCombatantInput,
): UpdateCombatantResult {
  const current = readCombatant(db, input.campaignId, input.combatantId);
  if (current === undefined) {
    throw new EncounterCombatantError(
      `unknown combatant '${input.combatantId}'. ${validCombatantIdsMessage(
        db,
        input.campaignId,
      )}`,
    );
  }
  const instance = readCombatInstance(
    db,
    input.campaignId,
    current.combatInstanceId,
  );
  if (instance?.status !== 'active') {
    throw new EncounterCombatantError(
      `combatant '${input.combatantId}' belongs to inactive combat instance '${current.combatInstanceId}'`,
    );
  }
  if (input.hpDelta !== undefined && !Number.isInteger(input.hpDelta)) {
    throw new EncounterCombatantError(
      'hpDelta must be an integer when provided',
    );
  }
  const previousHp = current.hpCurrent;
  const nextHp =
    input.hpDelta === undefined
      ? current.hpCurrent
      : Math.max(0, Math.min(current.hpMax, current.hpCurrent + input.hpDelta));
  const conditions = [...current.conditions];
  let conditionAdded = false;
  let conditionRemoved = false;
  if (input.addCondition !== undefined) {
    if (
      typeof input.addCondition.id !== 'string' ||
      input.addCondition.id.length === 0
    ) {
      throw new EncounterCombatantError('addCondition.id must be non-empty');
    }
    if (!conditions.some((c) => c.id === input.addCondition?.id)) {
      conditions.push(input.addCondition);
      conditionAdded = true;
    }
  }
  if (input.removeCondition !== undefined) {
    const before = conditions.length;
    const remaining = conditions.filter((c) => c.id !== input.removeCondition);
    conditionRemoved = remaining.length !== before;
    conditions.splice(0, conditions.length, ...remaining);
  }
  const status =
    input.status ??
    (nextHp === 0
      ? 'dead'
      : current.status === 'dead'
        ? 'alive'
        : current.status);
  const locationId = input.locationId ?? current.locationId;
  const placement = input.placement ?? current.placement;

  db.prepare(
    `UPDATE encounter_combatant
     SET hp_current = ?, conditions_json = ?, status = ?, location_id = ?,
         placement = ?, provenance = ?, session_id = ?, updated_at = ?
     WHERE campaign_id = ? AND combatant_id = ?`,
  ).run(
    nextHp,
    JSON.stringify(conditions),
    status,
    locationId ?? null,
    placement ?? null,
    input.provenance,
    input.sessionId,
    input.at,
    input.campaignId,
    input.combatantId,
  );

  let syncedActor: CampaignActor | undefined;
  if (
    current.identityKind === 'campaign_actor' &&
    current.identityRef !== undefined
  ) {
    const existing = getCampaignActor(
      db,
      input.campaignId,
      current.identityRef,
    );
    syncedActor = upsertCampaignActor(db, {
      campaignId: input.campaignId,
      actorId: current.identityRef,
      displayName: existing?.displayName ?? current.displayLabel,
      actorKind: existing?.actorKind ?? 'creature',
      sourceKind: existing?.sourceKind ?? 'campaign_created',
      sourceRef: existing?.sourceRef,
      rulesRef: existing?.rulesRef ?? current.rulesRef,
      hpCurrent: nextHp,
      hpMax: current.hpMax,
      conditions,
      status,
      currentLocationId: locationId,
      state: existing?.state,
      provenance: input.provenance,
      sessionId: input.sessionId,
      at: input.at,
    });
  }

  // F3 reaction (same-transaction, mirroring hpLifecycle's character hook):
  // a combatant that goes down — 0 HP, an explicit dead/unconscious status,
  // or a newly applied condition whose structured record implies
  // `incapacitated` (paralyzed, stunned, …) — is incapacitated, which breaks
  // its concentration and cleans up the effect's owned projections
  // atomically with this write. Transition-gated on both sides so an
  // already-incapacitated combatant (by any route) triggers nothing further.
  const wasDown =
    current.hpCurrent === 0 ||
    current.status === 'dead' ||
    current.status === 'unconscious' ||
    current.status === 'inactive';
  const isDown =
    nextHp === 0 ||
    status === 'dead' ||
    status === 'unconscious' ||
    status === 'inactive';
  const wasIncapacitated =
    wasDown ||
    anyConditionImpliesIncapacitated(
      db,
      current.conditions.map((c) => c.id),
    );
  const isIncapacitated =
    isDown ||
    anyConditionImpliesIncapacitated(
      db,
      conditions.map((c) => c.id),
    );
  let concentrationBroken: UpdateCombatantResult['concentrationBroken'];
  if (!wasIncapacitated && isIncapacitated) {
    const broken = breakCombatantConcentration(
      db,
      input.campaignId,
      input.combatantId,
      status === 'dead'
        ? 'dead'
        : status === 'inactive'
          ? 'owner-removed'
          : 'incapacitated',
      {
        provenance: input.provenance,
        sessionId: input.sessionId,
        at: input.at,
      },
    );
    if (broken.broken && broken.effectId !== undefined) {
      concentrationBroken = {
        effectId: broken.effectId,
        displayName: broken.displayName ?? broken.effectId,
        cause:
          status === 'dead'
            ? 'dead'
            : status === 'inactive'
              ? 'owner-removed'
              : 'incapacitated',
      };
    }
  }

  const combatant = readCombatant(db, input.campaignId, input.combatantId);
  if (combatant === undefined) {
    throw new EncounterCombatantError('combatant disappeared during update');
  }
  return {
    combatant,
    syncedActor,
    previousHp,
    hpDelta: input.hpDelta,
    conditionAdded,
    conditionRemoved,
    ...(concentrationBroken === undefined ? {} : { concentrationBroken }),
  };
}
