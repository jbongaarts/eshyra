import {
  EncounterCombatantError,
  type JoinCombatCreatureInput,
  joinCombat,
} from '../state/encounterCombatants.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';
import { ACTOR_ITEM_SCHEMA, parseActors } from './toolStartEncounter.js';

function parseCreatures(value: unknown): JoinCombatCreatureInput[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const creatures: JoinCombatCreatureInput[] = [];
  for (const item of value) {
    const rec = asRecord(item);
    if (
      rec === undefined ||
      typeof rec.rulesRef !== 'string' ||
      rec.rulesRef === '' ||
      typeof rec.side !== 'string' ||
      rec.side === ''
    )
      return undefined;
    if (
      rec.count !== undefined &&
      !(Number.isInteger(rec.count) && (rec.count as number) >= 1)
    )
      return undefined;
    for (const k of ['faction', 'displayLabel', 'placement'] as const)
      if (rec[k] !== undefined && typeof rec[k] !== 'string') return undefined;
    creatures.push({
      rulesRef: rec.rulesRef,
      side: rec.side,
      ...(typeof rec.count === 'number' ? { count: rec.count } : {}),
      ...(typeof rec.faction === 'string' ? { faction: rec.faction } : {}),
      ...(typeof rec.displayLabel === 'string'
        ? { displayLabel: rec.displayLabel }
        : {}),
      ...(typeof rec.placement === 'string'
        ? { placement: rec.placement }
        : {}),
    });
  }
  return creatures;
}

export const joinCombatTool: Tool = {
  name: 'join_combat',
  mutates: true,
  description:
    "Admit creatures into the campaign's ACTIVE combat instance (a summon cast mid-combat, reinforcements, a late arrival). Refused when no instance is active (start_encounter opens one). args: { creatures?: [{ rulesRef, count?, side, faction?, displayLabel?, placement? }], actors?: [...] } with at least one entry; side is required on every entry. creatures are instance-only combatants taking hit points, armor class and heads from the creature record (rulesRef must resolve as a creature). actors are persistent campaign actors admitted under the same rules as start_encounter (an absent actor needs hpCurrent above 0 and is a new manifestation; a bonded absent actor returns only through recast_bonded_summon; a pocketed actor is recalled with transition_bonded_summon); an actor already in this combat (alive, dead or otherwise) is refused. The whole call is atomic: any invalid entry writes nothing. Initiative and turn order stay narrated: a joiner gets its turn budget from its first begin_turn. To record a summon's effect afterwards, call start_effect with the returned combatant ids (actors[].combatantId; campaignActorId for durable summons). Returns { combatInstance, joined: [combatants] }.",
  inputSchema: {
    type: 'object',
    properties: {
      creatures: {
        type: 'array',
        description:
          'Instance-only creatures to add, from creature records. count > 1 numbers the labels.',
        items: {
          type: 'object',
          properties: {
            rulesRef: { type: 'string', minLength: 1 },
            count: { type: 'integer', minimum: 1 },
            side: { type: 'string', minLength: 1 },
            faction: { type: 'string', minLength: 1 },
            displayLabel: { type: 'string', minLength: 1 },
            placement: { type: 'string', minLength: 1 },
          },
          required: ['rulesRef', 'side'],
          additionalProperties: false,
        },
      },
      actors: {
        type: 'array',
        description:
          'Persistent campaign actors to add to the active combat. side is required.',
        items: { ...ACTOR_ITEM_SCHEMA, required: ['actorId', 'side'] },
      },
    },
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined) {
      return err('invalid_args', 'join_combat requires an object');
    }
    const creatures = parseCreatures(a.creatures);
    if (creatures === undefined) {
      return err(
        'invalid_args',
        'join_combat creatures are invalid (each needs rulesRef and side; count an integer >= 1)',
      );
    }
    const actors = parseActors(a.actors);
    if (a.actors !== undefined && actors === undefined) {
      return err('invalid_args', 'join_combat actors are invalid');
    }
    if (creatures.length + (actors?.length ?? 0) === 0) {
      return err(
        'invalid_args',
        'join_combat requires at least one creature or actor',
      );
    }
    try {
      return ok(
        joinCombat(ctx.db, {
          campaignId: ctx.campaignId,
          creatures,
          ...(actors === undefined ? {} : { actors }),
          resolveRulesPack: ctx.resolveRulesPack,
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        }),
      );
    } catch (e) {
      if (e instanceof EncounterCombatantError) {
        return err('combatant_error', e.message);
      }
      throw e;
    }
  },
};
