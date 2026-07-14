import type {
  CreateActiveEffectInput,
  EffectParticipant,
} from '../state/activeEffects.js';
import { createActiveEffect } from '../state/activeEffects.js';
import type { CharacterConditionEntry } from '../state/liveStateSchema.js';
import {
  EFFECT_DURATION_SCHEMA,
  EFFECT_PARTICIPANT_SCHEMA,
  effectToolError,
  parseEffectDuration,
  resolveEffectParticipant,
} from './toolEffectShared.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

const CLEANUP_SCHEMA = {
  type: 'string',
  enum: ['remove', 'release'],
} as const;

export const startEffectTool: Tool = {
  name: 'start_effect',
  // Writes the durable active-effect record + its projections (eshyra-dwkm).
  mutates: true,
  requiresExplicitAction: true,
  description:
    'Start a durable active effect (F3): a concentration or timed spell ' +
    'effect, condition package, curse, ward, summon control, or activated ' +
    'item power that persists across turns and must later end. The engine ' +
    'enforces the lifecycle: spell sources must resolve in the rules pack ' +
    'and their record duration/concentration bind the declaration; a new ' +
    'concentration effect deterministically ends the owner’s previous ' +
    'one (reported in the result); projected conditions are owned by the ' +
    'effect and are cleaned up exactly when it ends. Give every timer a ' +
    'quantity, unit, and anchor. Use projected condition ids unique to the ' +
    'effect (e.g. "blessed:fx-bless-1"). Do NOT use this for instantaneous ' +
    'spells — their consequences land through their own mutations.',
  inputSchema: {
    type: 'object',
    properties: {
      effectId: {
        type: 'string',
        description:
          'New unique effect id (never reused), e.g. "fx-bless-arden-1".',
        minLength: 1,
      },
      kind: {
        type: 'string',
        enum: [
          'spell-effect',
          'summoning',
          'ward',
          'curse',
          'transformation',
          'item-power',
          'condition-package',
        ],
        description:
          'Semantic family; it licenses what the effect may declare ' +
          '(e.g. only "summoning" may own linked actors; ' +
          '"condition-package" may never require concentration).',
      },
      displayName: { type: 'string', minLength: 1 },
      source: {
        type: 'object',
        description:
          'What created the effect. kind "spell" requires a resolvable ' +
          'ref (e.g. "spell:bless"); homebrew goes through kind "ruling".',
        properties: {
          kind: {
            type: 'string',
            enum: [
              'spell',
              'magic-item',
              'feature',
              'creature-trait',
              'hazard',
              'ruling',
            ],
          },
          ref: { type: 'string', minLength: 1 },
          actor: EFFECT_PARTICIPANT_SCHEMA,
        },
        required: ['kind'],
        additionalProperties: false,
      },
      concentrationOwner: {
        ...EFFECT_PARTICIPANT_SCHEMA,
        description:
          'Who concentrates on the effect. Required when the spell record ' +
          'says Concentration; forbidden when it does not.',
      },
      duration: EFFECT_DURATION_SCHEMA,
      dismissible: {
        type: 'boolean',
        description:
          'True when the rule grants voluntary dismissal (distinct from ' +
          'dropping concentration, which is always allowed).',
      },
      targets: {
        type: 'array',
        description:
          'Affected creatures/scopes; individually removable later via ' +
          'remove_effect_target.',
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['character', 'combatant', 'campaign_actor', 'scope'],
            },
            ref: { type: 'string', minLength: 1 },
          },
          required: ['kind', 'ref'],
          additionalProperties: false,
        },
      },
      conditions: {
        type: 'array',
        description:
          'Condition entries the effect projects and owns. Each is added ' +
          'to its target now and removed exactly when the effect (or that ' +
          'target) is cleaned up.',
        items: {
          type: 'object',
          properties: {
            target: EFFECT_PARTICIPANT_SCHEMA,
            condition: {
              type: 'object',
              description:
                'Condition entry ({ id, ...detail }); the id must not ' +
                'already exist on the target.',
              properties: { id: { type: 'string', minLength: 1 } },
              required: ['id'],
            },
            cleanupOnEnd: CLEANUP_SCHEMA,
            cleanupOnBreak: CLEANUP_SCHEMA,
          },
          required: ['target', 'condition'],
          additionalProperties: false,
        },
      },
      actors: {
        type: 'array',
        description:
          'Combatants the effect owns (summons/animations; kind ' +
          '"summoning" only). cleanupOnBreak "release" keeps the entity ' +
          'in play when concentration breaks (e.g. Conjure Elemental).',
        items: {
          type: 'object',
          properties: {
            combatantId: { type: 'string', minLength: 1 },
            campaignActorId: {
              type: 'string',
              minLength: 1,
              description:
                'Stable durable identity for a persistent owned creature; omit for an instance-only summon.',
            },
            cleanupOnEnd: CLEANUP_SCHEMA,
            cleanupOnBreak: CLEANUP_SCHEMA,
          },
          required: ['combatantId'],
          additionalProperties: false,
        },
      },
    },
    required: ['effectId', 'kind', 'displayName', 'source', 'duration'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined) {
      return err('invalid_args', 'start_effect requires an object argument');
    }
    const source = asRecord(a.source);
    if (source === undefined || typeof source.kind !== 'string') {
      return err('invalid_args', 'start_effect requires source.kind');
    }
    let sourceActor: EffectParticipant | undefined;
    if (source.actor !== undefined) {
      const resolved = resolveEffectParticipant(
        source.actor,
        ctx,
        'source.actor',
      );
      if ('ok' in resolved) {
        return resolved;
      }
      sourceActor = resolved;
    }
    let concentration: CreateActiveEffectInput['concentration'];
    if (a.concentrationOwner !== undefined) {
      const resolved = resolveEffectParticipant(
        a.concentrationOwner,
        ctx,
        'concentrationOwner',
      );
      if ('ok' in resolved) {
        return resolved;
      }
      concentration = { owner: resolved };
    }
    const duration = parseEffectDuration(a.duration);
    if ('ok' in duration) {
      return duration;
    }
    const targets: {
      kind: 'character' | 'combatant' | 'campaign_actor' | 'scope';
      ref: string;
    }[] = [];
    for (const rawTarget of Array.isArray(a.targets) ? a.targets : []) {
      const target = asRecord(rawTarget);
      if (
        target === undefined ||
        typeof target.kind !== 'string' ||
        typeof target.ref !== 'string'
      ) {
        return err('invalid_args', 'each target must be { kind, ref }');
      }
      if (
        target.kind === 'character' ||
        target.kind === 'combatant' ||
        target.kind === 'campaign_actor'
      ) {
        const resolved = resolveEffectParticipant(target, ctx, 'target');
        if ('ok' in resolved) {
          return resolved;
        }
        targets.push(resolved);
      } else {
        targets.push({ kind: 'scope', ref: target.ref });
      }
    }
    const conditions: NonNullable<
      CreateActiveEffectInput['conditions']
    >[number][] = [];
    for (const rawProjection of Array.isArray(a.conditions)
      ? a.conditions
      : []) {
      const projection = asRecord(rawProjection);
      const condition = asRecord(projection?.condition);
      if (projection === undefined || condition === undefined) {
        return err(
          'invalid_args',
          'each conditions entry must be { target, condition: { id, ... } }',
        );
      }
      const target = resolveEffectParticipant(
        projection.target,
        ctx,
        'condition target',
      );
      if ('ok' in target) {
        return target;
      }
      conditions.push({
        target,
        condition: condition as CharacterConditionEntry,
        ...(projection.cleanupOnEnd === 'release'
          ? { cleanupOnEnd: 'release' as const }
          : {}),
        ...(projection.cleanupOnBreak === 'release'
          ? { cleanupOnBreak: 'release' as const }
          : {}),
      });
    }
    const actors: NonNullable<CreateActiveEffectInput['actors']>[number][] = [];
    for (const rawActor of Array.isArray(a.actors) ? a.actors : []) {
      const actor = asRecord(rawActor);
      if (actor === undefined || typeof actor.combatantId !== 'string') {
        return err('invalid_args', 'each actors entry must have combatantId');
      }
      actors.push({
        combatantId: actor.combatantId,
        ...(typeof actor.campaignActorId === 'string'
          ? { campaignActorId: actor.campaignActorId }
          : {}),
        ...(actor.cleanupOnEnd === 'release'
          ? { cleanupOnEnd: 'release' as const }
          : {}),
        ...(actor.cleanupOnBreak === 'release'
          ? { cleanupOnBreak: 'release' as const }
          : {}),
      });
    }

    try {
      return ok(
        createActiveEffect(ctx.db, {
          campaignId: ctx.campaignId,
          effectId: String(a.effectId),
          kind: a.kind as CreateActiveEffectInput['kind'],
          displayName: String(a.displayName),
          source: {
            kind: source.kind as CreateActiveEffectInput['source']['kind'],
            ...(typeof source.ref === 'string' ? { ref: source.ref } : {}),
            ...(sourceActor === undefined ? {} : { actor: sourceActor }),
          },
          ...(concentration === undefined ? {} : { concentration }),
          duration,
          ...(a.dismissible === true ? { dismissible: true } : {}),
          ...(targets.length === 0 ? {} : { targets }),
          ...(conditions.length === 0 ? {} : { conditions }),
          ...(actors.length === 0 ? {} : { actors }),
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
        }),
      );
    } catch (e) {
      return effectToolError(e);
    }
  },
};
