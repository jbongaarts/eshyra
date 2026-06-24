import {
  CampaignOverlayLoreError,
  recordCampaignOverlayLore,
} from '../world/campaignOverlayLore.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

const kindValues = [
  'rumor',
  'clue',
  'npc_detail',
  'location_detail',
  'quest_hook',
  'threat_report',
  'scene_consequence',
  'player_created_detail',
  'other',
] as const;

const truthStatusValues = [
  'confirmed',
  'true',
  'false',
  'disproven',
  'unknown',
  'rumored',
  'reported',
  'observed',
  'believed',
  'lie',
  'exaggeration',
] as const;

const sourceValues = [
  'dm_improvised',
  'player_declared',
  'module_derived',
  'tool_result',
  'consequence',
] as const;

const scopeValues = ['scene', 'session', 'campaign'] as const;
const visibilityValues = ['player_visible', 'dm_only', 'mixed'] as const;

export const recordWorldFactTool: Tool = {
  name: 'record_world_fact',
  mutates: true,
  description:
    'Promote a consequential improvised lore fact into campaign overlay canon. ' +
    'Use for hooks, clues, NPC knowledge, reports, and player-action consequences ' +
    'that may matter later. Do not use for decorative color such as ordinary ' +
    'sensory detail, incidental props, or mood unless play made it consequential.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Optional stable lore record id.' },
      kind: { type: 'string', enum: [...kindValues] },
      subjectId: { type: 'string' },
      subjectText: {
        type: 'string',
        minLength: 1,
        description: 'Human-readable subject, e.g. "Old Renn".',
      },
      locationId: { type: 'string' },
      npcId: { type: 'string' },
      factionId: { type: 'string' },
      fact: {
        type: 'string',
        minLength: 1,
        description: 'The exact consequential fact, report, clue, or belief.',
      },
      truthStatus: { type: 'string', enum: [...truthStatusValues] },
      source: { type: 'string', enum: [...sourceValues] },
      scope: { type: 'string', enum: [...scopeValues] },
      visibility: { type: 'string', enum: [...visibilityValues] },
      supersedes: { type: 'string' },
      invalidates: { type: 'string' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Search tags such as hook, missing-cart, north-gate.',
      },
    },
    required: [
      'kind',
      'subjectText',
      'fact',
      'truthStatus',
      'source',
      'scope',
      'visibility',
    ],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined) {
      return err('invalid_args', 'record_world_fact requires an object');
    }
    try {
      const record = recordCampaignOverlayLore(ctx.db, {
        ...(typeof a.id === 'string' ? { id: a.id } : {}),
        kind: a.kind as never,
        ...(typeof a.subjectId === 'string' ? { subjectId: a.subjectId } : {}),
        subjectText: a.subjectText as string,
        ...(typeof a.locationId === 'string'
          ? { locationId: a.locationId }
          : {}),
        ...(typeof a.npcId === 'string' ? { npcId: a.npcId } : {}),
        ...(typeof a.factionId === 'string' ? { factionId: a.factionId } : {}),
        fact: a.fact as string,
        truthStatus: a.truthStatus as never,
        source: a.source as never,
        scope: a.scope as never,
        visibility: a.visibility as never,
        ...(typeof a.supersedes === 'string'
          ? { supersedes: a.supersedes }
          : {}),
        ...(typeof a.invalidates === 'string'
          ? { invalidates: a.invalidates }
          : {}),
        tags: Array.isArray(a.tags)
          ? a.tags.filter((tag): tag is string => typeof tag === 'string')
          : [],
        introducedAtTurnId: ctx.turnId,
        introducedAtSessionId: ctx.sessionId,
        provenance: `model:${ctx.turnId}`,
        at: ctx.at,
      });
      return ok({
        applied: true,
        canonTier: 'campaign_overlay_lore',
        record,
        evidence: {
          tier:
            record.kind === 'rumor' ||
            record.truthStatus === 'rumored' ||
            record.truthStatus === 'reported' ||
            record.truthStatus === 'believed'
              ? 'rumor_belief'
              : 'campaign_overlay_lore',
          id: record.id,
          truthStatus: record.truthStatus,
          summary: `${record.subjectText}: ${record.fact}`,
        },
      });
    } catch (e) {
      if (e instanceof CampaignOverlayLoreError) {
        return err('invalid_lore', e.message);
      }
      throw e;
    }
  },
};
