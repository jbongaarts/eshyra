import type { JsonSchema } from '../model/toolSchema.js';
import { withTransaction } from '../persistence/db.js';
import { evaluateCalc } from './calc.js';
import { ResolutionError, resolveD20 } from './resolution.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';
import {
  ADVANTAGE_SCHEMA,
  DISADVANTAGE_SCHEMA,
  MODIFIERS_SCHEMA,
  PROFICIENCY_SCHEMA,
  parseCheckSide,
  parseVisibility,
  VISIBILITY_SCHEMA,
} from './toolResolutionShared.js';
import {
  newId,
  PARTICIPANT_SCHEMA,
  parseParticipant,
} from './toolRetainedCheckShared.js';

const SEARCH_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    label: { type: 'string', minLength: 1, maxLength: 80 },
    participant: PARTICIPANT_SCHEMA,
    modifiers: MODIFIERS_SCHEMA,
    proficiency: PROFICIENCY_SCHEMA,
    advantage: ADVANTAGE_SCHEMA,
    disadvantage: DISADVANTAGE_SCHEMA,
  },
  required: ['label'],
  additionalProperties: false,
};
const PASSIVE_SCHEMA: JsonSchema = {
  type: 'array',
  minItems: 1,
  items: {
    type: 'object',
    properties: {
      label: { type: 'string', minLength: 1, maxLength: 80 },
      participant: PARTICIPANT_SCHEMA,
      modifier: { type: 'integer', minimum: -100, maximum: 100 },
      advantage: ADVANTAGE_SCHEMA,
      disadvantage: DISADVANTAGE_SCHEMA,
    },
    required: ['label', 'modifier'],
    additionalProperties: false,
  },
};

export const resolveRetainedCheckTool: Tool = {
  name: 'resolve_retained_check',
  mutates: true,
  description:
    'Compare an active engine-recorded check total without rerolling it. Provide exactly one search (rolls a fresh opposing ability check) or passive (computes passive scores through calc passive_score). An observer notices only when its rolled total or passive score is strictly higher than the retained total; a tie leaves the hider hidden. This tool records each comparison. Never compare totals yourself. args: { retainedCheckId, reason, visibility?, search?: { label, participant?, modifiers?, proficiency?, advantage?, disadvantage? }, passive?: [{ label, participant?, modifier, advantage?, disadvantage? }] }.',
  inputSchema: {
    type: 'object',
    properties: {
      retainedCheckId: { type: 'string', minLength: 1 },
      reason: { type: 'string', minLength: 1 },
      visibility: VISIBILITY_SCHEMA,
      search: SEARCH_SCHEMA,
      passive: PASSIVE_SCHEMA,
    },
    required: ['retainedCheckId', 'reason'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.retainedCheckId !== 'string' ||
      !a.retainedCheckId ||
      typeof a.reason !== 'string' ||
      !a.reason ||
      (a.search === undefined) === (a.passive === undefined)
    ) {
      return err(
        'invalid_args',
        'resolve_retained_check requires retainedCheckId, reason, and exactly one of search or passive',
      );
    }
    try {
      const stored = ctx.db
        .prepare(
          'SELECT * FROM retained_check WHERE campaign_id = ? AND retained_check_id = ?',
        )
        .get(ctx.campaignId, a.retainedCheckId) as
        | Record<string, unknown>
        | undefined;
      if (stored === undefined)
        return err(
          'not_found',
          'retained check was not found in this campaign',
        );
      if (stored.status !== 'active')
        return err(
          'retained_check_ended',
          'cannot compare an ended retained check',
        );
      const visibility =
        parseVisibility(a.visibility) ??
        (stored.visibility as 'player_visible' | 'dm_only');
      const comparisons = withTransaction(ctx.db, (db) => {
        const result: Record<string, unknown>[] = [];
        const add = (
          label: string,
          participant: ReturnType<typeof parseParticipant>,
          total: number,
          mode: 'search' | 'passive',
          resolution: unknown,
        ) => {
          // The passive score is the observer's check total; a tie preserves
          // the prior hidden state, so noticing requires a strictly higher total.
          const noticed = total > (stored.total as number);
          const comparisonId = newId();
          db.prepare(`INSERT INTO retained_check_comparison (
            campaign_id, comparison_id, retained_check_id, mode, observer_label,
            observer_kind, observer_ref, observer_total, noticed, resolution_json,
            provenance, session_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            ctx.campaignId,
            comparisonId,
            a.retainedCheckId,
            mode,
            label,
            participant?.kind ?? null,
            participant?.ref ?? null,
            total,
            noticed ? 1 : 0,
            JSON.stringify(resolution),
            `model:${ctx.turnId}`,
            ctx.sessionId,
            ctx.at,
          );
          result.push({
            comparisonId,
            label,
            ...(participant ? { participant } : {}),
            total,
            noticed,
            resolution,
          });
        };
        if (a.search !== undefined) {
          const search = asRecord(a.search);
          if (
            search === undefined ||
            typeof search.label !== 'string' ||
            !search.label
          )
            throw new ResolutionError('search requires a label');
          const side = parseCheckSide(search, 'resolve_retained_check search');
          const participant = parseParticipant(search.participant, ctx);
          const resolution = resolveD20(
            {
              kind: 'ability_check',
              advantage: side.advantage,
              disadvantage: side.disadvantage,
              modifiers: side.modifiers,
              ...(side.proficiency === undefined
                ? {}
                : { proficiency: side.proficiency }),
            },
            ctx.rng,
          );
          add(
            search.label,
            participant,
            resolution.total,
            'search',
            resolution,
          );
        } else if (Array.isArray(a.passive)) {
          for (const [index, raw] of a.passive.entries()) {
            const observer = asRecord(raw);
            if (
              observer === undefined ||
              typeof observer.label !== 'string' ||
              !observer.label ||
              typeof observer.modifier !== 'number' ||
              !Number.isInteger(observer.modifier)
            )
              throw new ResolutionError(
                `passive[${index}] requires label and integer modifier`,
              );
            const advantage = observer.advantage === true;
            const disadvantage = observer.disadvantage === true;
            if (
              (observer.advantage !== undefined &&
                typeof observer.advantage !== 'boolean') ||
              (observer.disadvantage !== undefined &&
                typeof observer.disadvantage !== 'boolean')
            )
              throw new ResolutionError(
                `passive[${index}] advantage/disadvantage must be boolean`,
              );
            const resolution = evaluateCalc('passive_score', {
              modifier: observer.modifier,
              advantage,
              disadvantage,
            });
            add(
              observer.label,
              parseParticipant(observer.participant, ctx),
              resolution.outputs.score as number,
              'passive',
              resolution,
            );
          }
        } else throw new ResolutionError('passive must be an array');
        return result;
      });
      return ok({
        retainedCheckId: a.retainedCheckId,
        reason: a.reason,
        visibility,
        ...(a.search === undefined ? {} : { category: 'ability_check' }),
        comparisons,
      });
    } catch (e) {
      if (e instanceof ResolutionError)
        return err('invalid_resolution', e.message);
      if (e instanceof Error) return err('invalid_args', e.message);
      throw e;
    }
  },
};
