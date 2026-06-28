import type { AdventureModule } from '../adventure/types.js';
import { listAdventureRuns } from '../campaign/adventureRun.js';
import type {
  CharacterChronicleRecord,
  CharacterChronicleStore,
} from '../character/characterChronicle.js';
import { createSqliteCharacterSheetStore } from '../character/characterSheetStore.js';
import { listClosedArcSummaries } from '../memory/campaignArc.js';
import type {
  ArcSummaryRecord,
  CampaignBibleRecord,
  SessionRecapRecord,
} from '../memory/summary.js';
import { selectAlwaysOnMemory } from '../memory/summary.js';
import type { Db } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import {
  CharacterResolutionError,
  resolveActingCharacterId,
} from '../state/activeCharacter.js';
import {
  type CampaignActor,
  type EncounterCombatant,
  listCampaignActors,
  listCombatants,
} from '../state/encounterCombatants.js';
import type {
  AbilityScores,
  CharacterConditionEntry,
  InventoryItemProperties,
} from '../state/liveStateSchema.js';
import {
  validateAbilityScoresJson,
  validateConditionsJson,
  validateInventoryPropertiesJson,
} from '../state/liveStateSchema.js';
import type { PartyMember } from '../state/party.js';
import { listParty } from '../state/party.js';
import type { AdventureContextSlice } from './adventureContext.js';
import {
  buildAdventureContextSlice,
  renderAdventureContextSlice,
} from './adventureContext.js';
import type { SceneLogRecord } from './scene.js';
import { countSceneLog, getOpenScene, listSceneLogWindow } from './scene.js';

/**
 * Bounded Context Assembler (E5).
 *
 * Builds the per-turn prompt from a deliberately bounded slice — campaign
 * bible, current arc summary, recent session recap(s), the full structured
 * state snapshot, and the current scene's bounded live transcript tail. Older
 * turn history is excluded by construction: closed scenes live in
 * scene_summary, and omitted current-scene entries can be retrieved via the
 * `memory_drilldown` tool. Slices stay compact so the stable head of the
 * prompt is friendly to provider prompt caching.
 */

const DEFAULT_RECENT_SESSION_LIMIT = 5;
const DEFAULT_SCENE_TRANSCRIPT_LIMIT = 12;

/** JSON codecs for the JSON-backed state columns the assembler reads. */
const plotFlagValueColumn = jsonColumn<unknown>('plot_flags.value_json');
const abilityScoresColumn = jsonColumn<unknown>(
  'character.ability_scores_json',
);
const conditionsColumn = jsonColumn<unknown>('character.conditions_json');
const inventoryPropertiesColumn = jsonColumn<unknown>(
  'inventory.properties_json',
);

/**
 * Resolves an immutable adventure module by id for context assembly. The module
 * source lives outside the per-turn DB (it is read-only authored content loaded
 * from a pack), so the assembler cannot read it directly; the caller supplies
 * this resolver to bind a campaign's active run id to its module source. Return
 * `undefined` when the module is unavailable — the run is then skipped rather
 * than failing the turn.
 */
export type AdventureModuleResolver = (
  moduleId: string,
) => AdventureModule | undefined;

export interface ContextAssemblyInput {
  db: Db;
  campaignId: string;
  sessionId: string;
  playerInput: string;
  /** How many recent session recaps to inline. Default 5. */
  recentSessionLimit?: number;
  /** How many current-scene transcript entries to inline. Default 12. */
  sceneTranscriptLimit?: number;
  /**
   * PC whose sheet is rendered as the turn subject. Defaults to the active
   * character (`meta.active_character_id`) when omitted.
   */
  actingCharacterId?: string;
  /**
   * Optional resolver for active adventure-module source. When provided, the
   * assembler builds a bounded module context slice for each ACTIVE adventure
   * run whose module resolves. When omitted (the default), no module context is
   * assembled and campaigns without adventure runs are unaffected.
   */
  resolveAdventureModule?: AdventureModuleResolver;
  /**
   * Optional registry-backed character chronicle source. When present and the
   * acting campaign sheet is linked to a global character, portable
   * player-visible/dm-only records are rendered as character memory, separate
   * from campaign canon.
   */
  characterChronicle?: CharacterChronicleStore;
}

export interface CharacterSnapshot {
  id: string;
  name: string | undefined;
  ancestry: string | undefined;
  className: string | undefined;
  level: number;
  hpCurrent: number;
  hpMax: number;
  abilityScores: AbilityScores;
  conditions: readonly CharacterConditionEntry[];
  role: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  location: string | undefined;
  properties: InventoryItemProperties;
}

export interface ClockSnapshot {
  inGameTime: string;
  currentLocationId: string | undefined;
}

export interface StateSnapshot {
  character: CharacterSnapshot;
  inventory: InventoryItem[];
  combatants: EncounterCombatant[];
  campaignActors: CampaignActor[];
  plotFlags: Record<string, unknown>;
  clock: ClockSnapshot;
}

export interface RecentSceneEvidence {
  tier: 'scene_fact';
  source: 'scene_log';
  sceneId: string;
  turnId: string;
  seq: number;
  summary: string;
}

export interface AssembledSceneRef {
  sceneId: string;
  title: string;
}

export interface AssembledContext {
  campaignId: string;
  sessionId: string;
  /** Compact status of every party member (PCs first, then companions). */
  party: PartyMember[];
  campaignBible: CampaignBibleRecord | undefined;
  /** All closed arc summaries in sequence_no ASC order. */
  arcSummaries: ArcSummaryRecord[];
  recentSessionRecaps: SessionRecapRecord[];
  omittedSessionCount: number;
  drilldownAvailable: boolean;
  state: StateSnapshot;
  scene: AssembledSceneRef | undefined;
  sceneTranscript: SceneLogRecord[];
  sceneTranscriptOmittedCount: number;
  recentSceneEvidence: RecentSceneEvidence[];
  characterChronicle: CharacterChronicleRecord[];
  /**
   * Bounded context slices for the campaign's active adventure runs. Empty when
   * no resolver was supplied, the campaign has no active runs, or none of those
   * runs' modules resolved.
   */
  adventures: AdventureContextSlice[];
  playerInput: string;
}

interface CharacterRow {
  id: string;
  name: string | null;
  ancestry: string | null;
  class_name: string | null;
  level: number;
  hp_current: number;
  hp_max: number;
  ability_scores_json: string;
  conditions_json: string;
  role: string;
}

interface InventoryRow {
  id: string;
  name: string;
  quantity: number;
  location: string | null;
  properties_json: string;
}

interface ClockRow {
  in_game_time: string;
  current_location_id: string | null;
}

interface KeyedJsonRow {
  key: string;
  value_json: string;
}

export function readStateSnapshot(
  db: Db,
  activeCharacterId?: string,
  campaignId?: string,
): StateSnapshot {
  const charId = resolveActingCharacterId(db, activeCharacterId);
  const character = db
    .prepare(
      `SELECT id, name, ancestry, class_name, level, hp_current, hp_max,
              ability_scores_json, conditions_json, role
       FROM character WHERE id = ?`,
    )
    .get(charId) as CharacterRow | undefined;
  if (character === undefined) {
    throw new CharacterResolutionError(
      `active character '${charId}' has no character row`,
    );
  }

  const inventoryRows = db
    .prepare(
      `SELECT id, name, quantity, location, properties_json
       FROM inventory
       WHERE character_id = ?
       ORDER BY id`,
    )
    .all(charId) as InventoryRow[];

  const clock = db
    .prepare('SELECT in_game_time, current_location_id FROM clock WHERE id = 1')
    .get() as ClockRow;

  const plotFlagRows = db
    .prepare('SELECT key, value_json FROM plot_flags ORDER BY key')
    .all() as KeyedJsonRow[];

  const plotFlags: Record<string, unknown> = {};
  for (const row of plotFlagRows) {
    plotFlags[row.key] = plotFlagValueColumn.decode(row.value_json);
  }

  const rawAbilityScores = abilityScoresColumn.decode(
    character.ability_scores_json,
  );
  const rawConditions = conditionsColumn.decode(character.conditions_json);

  return {
    character: {
      id: character.id,
      name: character.name ?? undefined,
      ancestry: character.ancestry ?? undefined,
      className: character.class_name ?? undefined,
      level: character.level,
      hpCurrent: character.hp_current,
      hpMax: character.hp_max,
      abilityScores: validateAbilityScoresJson(
        rawAbilityScores,
        'character.ability_scores_json',
      ),
      conditions: validateConditionsJson(
        rawConditions,
        'character.conditions_json',
      ),
      role: character.role,
    },
    inventory: inventoryRows.map((row) => {
      const rawProperties = inventoryPropertiesColumn.decode(
        row.properties_json,
      );
      return {
        id: row.id,
        name: row.name,
        quantity: row.quantity,
        location: row.location ?? undefined,
        properties: validateInventoryPropertiesJson(
          rawProperties,
          `inventory[${row.id}].properties_json`,
        ),
      };
    }),
    combatants: campaignId === undefined ? [] : listCombatants(db, campaignId),
    campaignActors:
      campaignId === undefined ? [] : listCampaignActors(db, campaignId),
    plotFlags,
    clock: {
      inGameTime: clock.in_game_time,
      currentLocationId: clock.current_location_id ?? undefined,
    },
  };
}

export function assembleContext(input: ContextAssemblyInput): AssembledContext {
  const recentSessionLimit =
    input.recentSessionLimit ?? DEFAULT_RECENT_SESSION_LIMIT;
  const sceneTranscriptLimit =
    input.sceneTranscriptLimit ?? DEFAULT_SCENE_TRANSCRIPT_LIMIT;
  if (sceneTranscriptLimit < 0) {
    throw new Error('sceneTranscriptLimit must be non-negative');
  }

  const alwaysOn = selectAlwaysOnMemory(input.db, {
    campaignId: input.campaignId,
    recentSessionLimit,
  });

  const arcSummaries = listClosedArcSummaries(input.db, {
    campaignId: input.campaignId,
  });

  const openScene = getOpenScene(input.db, {
    campaignId: input.campaignId,
    sessionId: input.sessionId,
  });

  const sceneKey =
    openScene === undefined
      ? undefined
      : {
          campaignId: input.campaignId,
          sessionId: input.sessionId,
          sceneId: openScene.sceneId,
        };
  const sceneTranscript =
    sceneKey === undefined
      ? []
      : listSceneLogWindow(input.db, {
          ...sceneKey,
          limit: sceneTranscriptLimit,
        });
  const sceneTranscriptOmittedCount =
    sceneKey === undefined
      ? 0
      : Math.max(0, countSceneLog(input.db, sceneKey) - sceneTranscript.length);
  const recentSceneEvidence = buildRecentSceneEvidence(sceneTranscript);

  const state = readStateSnapshot(
    input.db,
    input.actingCharacterId,
    input.campaignId,
  );

  const adventures = assembleAdventureContext(
    input.db,
    input.campaignId,
    state.clock.currentLocationId,
    input.resolveAdventureModule,
  );
  const characterChronicle = assembleCharacterChronicle(
    input.db,
    state.character.id,
    input.characterChronicle,
  );

  return {
    campaignId: input.campaignId,
    sessionId: input.sessionId,
    party: listParty(input.db),
    campaignBible: alwaysOn.campaignBible,
    arcSummaries,
    recentSessionRecaps: alwaysOn.recentSessionRecaps.filter(
      (r): r is SessionRecapRecord => r !== undefined,
    ),
    omittedSessionCount: alwaysOn.omittedSessionCount,
    drilldownAvailable:
      alwaysOn.drilldownAvailable || sceneTranscriptOmittedCount > 0,
    state,
    scene:
      openScene === undefined
        ? undefined
        : { sceneId: openScene.sceneId, title: openScene.title },
    sceneTranscript,
    sceneTranscriptOmittedCount,
    recentSceneEvidence,
    characterChronicle,
    adventures,
    playerInput: input.playerInput,
  };
}

function assembleCharacterChronicle(
  db: Db,
  characterId: string,
  chronicle: CharacterChronicleStore | undefined,
): CharacterChronicleRecord[] {
  if (chronicle === undefined) {
    return [];
  }
  const globalCharacterId =
    createSqliteCharacterSheetStore(db).load(characterId)?.metadata
      .globalCharacterId;
  if (globalCharacterId === undefined) {
    return [];
  }
  return chronicle
    .listRecords(globalCharacterId)
    .filter(
      (record) =>
        record.portability === 'portable' && record.visibility !== 'private',
    );
}

function buildRecentSceneEvidence(
  sceneTranscript: readonly SceneLogRecord[],
): RecentSceneEvidence[] {
  return sceneTranscript
    .filter((entry) => entry.role === 'dm')
    .map((entry) => ({
      tier: 'scene_fact',
      source: 'scene_log',
      sceneId: entry.sceneId,
      turnId: entry.turnId,
      seq: entry.seq,
      summary: compactSceneEvidence(entry.content),
    }));
}

function compactSceneEvidence(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length <= 280 ? compact : `${compact.slice(0, 277)}...`;
}

/**
 * Build bounded context slices for the campaign's ACTIVE adventure runs. A run
 * whose module the resolver cannot supply is skipped (logged by omission) rather
 * than failing the turn. Returns an empty array when no resolver is supplied.
 */
function assembleAdventureContext(
  db: Db,
  campaignId: string,
  currentLocationId: string | undefined,
  resolve: AdventureModuleResolver | undefined,
): AdventureContextSlice[] {
  if (resolve === undefined) {
    return [];
  }
  const slices: AdventureContextSlice[] = [];
  for (const run of listAdventureRuns(db, { campaignId })) {
    if (run.status !== 'active') {
      continue;
    }
    const module = resolve(run.moduleId);
    if (module === undefined) {
      continue;
    }
    slices.push(buildAdventureContextSlice(module, run, { currentLocationId }));
  }
  return slices;
}

function renderParty(party: PartyMember[], actingId: string): string {
  return party
    .map((m) => {
      const who = m.name ?? m.id;
      const descriptor = [m.ancestry, m.className].filter(Boolean).join(' ');
      const identity = descriptor.length > 0 ? `${who} (${descriptor})` : who;
      const tags: string[] = [];
      if (m.role !== 'pc') {
        tags.push(m.role);
      }
      if (m.id === actingId) {
        tags.push('acting');
      } else if (m.isActive) {
        tags.push('active');
      }
      const tagText = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
      const conditions =
        m.conditions.length > 0
          ? `, conditions: ${m.conditions.map((c) => c.id).join(', ')}`
          : '';
      return `- ${identity} — L${m.level}, HP ${m.hpCurrent}/${m.hpMax}${conditions}${tagText}`;
    })
    .join('\n');
}

function renderState(state: StateSnapshot): string {
  const c = state.character;
  const lines = [
    `Character: ${c.name ?? '(unnamed)'} — ${c.ancestry ?? '?'} ${
      c.className ?? '?'
    }, level ${c.level}, HP ${c.hpCurrent}/${c.hpMax}`,
  ];
  if (c.conditions.length > 0) {
    lines.push(`Conditions: ${JSON.stringify(c.conditions)}`);
  }
  if (state.inventory.length > 0) {
    lines.push(
      `Inventory: ${state.inventory
        .map((i) => `${i.name} x${i.quantity}`)
        .join(', ')}`,
    );
  } else {
    lines.push('Inventory: (empty)');
  }
  if (state.combatants.length > 0) {
    lines.push('Active combatants:');
    for (const combatant of state.combatants) {
      const ac = combatant.ac === undefined ? '' : `, AC ${combatant.ac}`;
      const conditions =
        combatant.conditions.length === 0
          ? ''
          : `, conditions: ${combatant.conditions.map((entry) => entry.id).join(', ')}`;
      const location =
        combatant.locationId === undefined ? '' : ` @ ${combatant.locationId}`;
      const placement =
        combatant.placement === undefined
          ? ''
          : `, placement: ${combatant.placement}`;
      const identity =
        combatant.identityRef === undefined
          ? ''
          : `, identity: ${combatant.identityRef}`;
      lines.push(
        `- ${combatant.combatantId}: ${combatant.displayLabel} [${combatant.status}], ${combatant.side}, HP ${combatant.hpCurrent}/${combatant.hpMax}${ac}${conditions}${location}${placement}${identity}, combat: ${combatant.combatInstanceId}`,
      );
    }
  }
  if (state.campaignActors.length > 0) {
    lines.push('Persistent actors:');
    for (const actor of state.campaignActors) {
      const rules =
        actor.rulesRef === undefined ? '' : `, rules: ${actor.rulesRef}`;
      const hp =
        actor.hpCurrent === undefined || actor.hpMax === undefined
          ? ''
          : `, HP ${actor.hpCurrent}/${actor.hpMax}`;
      const conditions =
        actor.conditions.length === 0
          ? ''
          : `, conditions: ${actor.conditions.map((entry) => entry.id).join(', ')}`;
      const location =
        actor.currentLocationId === undefined
          ? ''
          : ` @ ${actor.currentLocationId}`;
      lines.push(
        `- ${actor.actorId}: ${actor.displayName} [${actor.status}], ${actor.actorKind}${rules}${hp}${conditions}${location}`,
      );
    }
  }
  const flagKeys = Object.keys(state.plotFlags);
  if (flagKeys.length > 0) {
    lines.push(`Plot flags: ${JSON.stringify(state.plotFlags)}`);
  }
  lines.push(
    `Clock: ${state.clock.inGameTime || '(unset)'}${
      state.clock.currentLocationId ? ` @ ${state.clock.currentLocationId}` : ''
    }`,
  );
  return lines.join('\n');
}

/**
 * Render the assembled context into the user-message text handed to the model.
 * The DM system prompt is supplied separately by the orchestrator.
 */
export function renderContextMessage(ctx: AssembledContext): string {
  const sections: string[] = [];

  if (ctx.campaignBible !== undefined) {
    const bible = ctx.campaignBible;
    const facts = [
      ...bible.worldFacts.map((e) => `- world: ${e.text}`),
      ...bible.majorNpcs.map((e) => `- npc: ${e.text}`),
      ...bible.factions.map((e) => `- faction: ${e.text}`),
      ...bible.openThreads.map((e) => `- thread: ${e.text}`),
    ];
    if (facts.length > 0) {
      sections.push(`## Campaign Bible\n${facts.join('\n')}`);
    }
  }

  if (ctx.arcSummaries.length > 0) {
    sections.push(
      `## Arc Summaries\n${ctx.arcSummaries.map((a) => `- ${a.summary}`).join('\n')}`,
    );
  }

  if (ctx.recentSessionRecaps.length > 0) {
    sections.push(
      `## Recent Sessions\n${ctx.recentSessionRecaps
        .map((r) => `- ${r.recap}`)
        .join('\n')}`,
    );
  }
  if (ctx.drilldownAvailable) {
    sections.push(
      `_${ctx.omittedSessionCount} older session(s) omitted — use memory_drilldown to retrieve them._`,
    );
  }

  if (ctx.party.length > 1) {
    sections.push(
      `## Party\n${renderParty(ctx.party, ctx.state.character.id)}`,
    );
  }

  if (ctx.characterChronicle.length > 0) {
    sections.push(
      `## Character Chronicle\nThese are the acting character's memories or attachments from prior play, not objective campaign canon.\n${ctx.characterChronicle
        .map(renderChronicleRecord)
        .join('\n')}`,
    );
  }

  sections.push(`## Game State\n${renderState(ctx.state)}`);

  if (ctx.adventures.length > 0) {
    const body = ctx.adventures.map(renderAdventureContextSlice).join('\n\n');
    sections.push(
      `## Adventure Module (DM-only)\nGuidance from the active authored scenario; campaign truth above overrides it where they conflict. Do not narrate DM-only details verbatim.\n\n${body}`,
    );
  }

  if (ctx.scene !== undefined) {
    const transcript =
      ctx.sceneTranscript.length > 0
        ? ctx.sceneTranscript
            .map(
              (e) => `${e.role === 'player' ? 'Player' : 'DM'}: ${e.content}`,
            )
            .join('\n')
        : '(no turns yet)';
    const firstSeq = ctx.sceneTranscript[0]?.seq ?? 'null';
    const omitted =
      ctx.sceneTranscriptOmittedCount > 0
        ? [
            `\n(${ctx.sceneTranscriptOmittedCount} earlier current-scene entries omitted;`,
            'use memory_drilldown with target "scene_log",',
            `sceneId "${ctx.scene.sceneId}", and beforeSeq ${firstSeq} to retrieve them.)`,
          ].join(' ')
        : '';
    sections.push(
      `## Current Scene: ${ctx.scene.title}\n${transcript}${omitted}`,
    );
  } else {
    sections.push('## Current Scene\n(no scene open)');
  }

  sections.push(`## Player Input\n${ctx.playerInput}`);

  return sections.join('\n\n');
}

function renderChronicleRecord(record: CharacterChronicleRecord): string {
  const source = `source campaign ${record.source.campaignId}${
    record.source.sessionId ? `, session ${record.source.sessionId}` : ''
  }`;
  return `- ${record.truthStatus}: ${record.text} (${source})`;
}
