import type { Db } from '../persistence/db.js';
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
const significanceValues = [
  'atmosphere',
  'continuity',
  'clue',
  'hook',
  'consequence',
] as const;
const visibilityValues = ['player_visible', 'dm_only', 'mixed'] as const;

export const recordWorldFactTool: Tool = {
  name: 'record_world_fact',
  mutates: true,
  description:
    'Promote improvised lore or stable continuity dressing into campaign overlay canon. ' +
    'Use significance:"consequence" for hooks, clues, NPC knowledge, reports, and player-action consequences ' +
    'that may matter later. Use significance:"continuity" for stable visible physical details ' +
    'attached to a recurring location, NPC, or object when forgetting or contradicting them would confuse play. ' +
    'Do not record transient atmosphere such as smells, wind, flickering light, dust motes, or mood.',
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
      locationId: {
        type: 'string',
        description:
          'Location id where the lore applies. If omitted, the tool attaches the current clock location when one is known.',
      },
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
      significance: {
        type: 'string',
        enum: [...significanceValues],
        description:
          'Weight of the fact: continuity for stable dressing, consequence for player-affecting lore, clue/hook for plot-significant evidence, atmosphere only for explicitly retained non-continuity color.',
      },
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
        ...resolveLocationId(a, ctx.db),
        ...(typeof a.npcId === 'string' ? { npcId: a.npcId } : {}),
        ...(typeof a.factionId === 'string' ? { factionId: a.factionId } : {}),
        fact: a.fact as string,
        truthStatus: a.truthStatus as never,
        source: a.source as never,
        scope: a.scope as never,
        ...(typeof a.significance === 'string'
          ? { significance: a.significance as never }
          : {}),
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
      const evidenceTier = overlayLoreToolTier(record);
      const canonTier =
        evidenceTier === 'continuity_dressing'
          ? 'continuity_dressing'
          : 'campaign_overlay_lore';
      return ok({
        applied: true,
        canonTier,
        record,
        evidence: {
          tier: evidenceTier,
          id: record.id,
          truthStatus: record.truthStatus,
          visibility: record.visibility,
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

function overlayLoreToolTier(record: {
  significance: string;
  kind: string;
  truthStatus: string;
}): string {
  if (record.significance === 'atmosphere') return 'decorative_color';
  if (record.significance === 'continuity') return 'continuity_dressing';
  if (
    record.kind === 'rumor' ||
    record.truthStatus === 'rumored' ||
    record.truthStatus === 'reported' ||
    record.truthStatus === 'believed'
  ) {
    return 'rumor_belief';
  }
  return 'campaign_overlay_lore';
}

function resolveLocationId(
  args: Record<string, unknown>,
  db: Db,
): { locationId?: string } {
  if (typeof args.locationId === 'string') {
    return { locationId: args.locationId };
  }
  const row = db
    .prepare('SELECT current_location_id FROM clock WHERE id = 1')
    .get() as { current_location_id: string | null } | undefined;
  if (
    row === undefined ||
    row.current_location_id === null ||
    row.current_location_id.length === 0
  ) {
    return {};
  }
  return { locationId: row.current_location_id };
}
