import { withTransaction } from '../persistence/db.js';
import {
  ActionEconomyError,
  setSurprisedInTransaction,
  type TurnParticipantInput,
} from '../state/actionEconomy.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const setSurprisedTool: Tool = {
  name: 'set_surprised',
  mutates: true,
  description:
    'Derive and record which participants are surprised at the start of the active combat instance from passive comparisons. For each observer, any noticed hider means that observer is not surprised; an observer who noticed none is surprised. First roll each hider’s Stealth with roll_retained_check, then compare it with every opposing observer using resolve_retained_check passive, and pass all resulting comparison ids here. If neither side tries to be stealthy, there is no surprise; do not call this tool. The engine enforces loss of the surprised participant’s first turn and begin_turn clears the flag when that turn ends. args: { comparisonIds: string[] }.',
  inputSchema: {
    type: 'object',
    properties: {
      comparisonIds: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', minLength: 1 },
      },
    },
    required: ['comparisonIds'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      !Array.isArray(a.comparisonIds) ||
      a.comparisonIds.length === 0 ||
      !a.comparisonIds.every((id) => typeof id === 'string' && id.length > 0)
    )
      return err(
        'invalid_args',
        'set_surprised requires { comparisonIds: non-empty string[] }',
      );
    const comparisonIds = a.comparisonIds as string[];
    if (new Set(comparisonIds).size !== comparisonIds.length)
      return err('invalid_args', 'comparisonIds must be unique');
    try {
      return withTransaction(ctx.db, (txnDb) => {
        const instance = txnDb
          .prepare(
            `SELECT combat_instance_id FROM combat_instance WHERE campaign_id = ? AND status = 'active'`,
          )
          .get(ctx.campaignId) as { combat_instance_id: string } | undefined;
        if (instance === undefined)
          return err('turn_budget_error', 'no combat instance is active');
        const rows = txnDb
          .prepare(`SELECT c.comparison_id, c.retained_check_id, c.observer_label,
      c.observer_kind, c.observer_ref, c.noticed, r.combat_instance_id, r.status, r.label
      FROM retained_check_comparison c
      JOIN retained_check r ON r.campaign_id = c.campaign_id AND r.retained_check_id = c.retained_check_id
      WHERE c.campaign_id = ? AND c.comparison_id IN (${comparisonIds.map(() => '?').join(',')}) AND c.mode = 'passive'`)
          .all(ctx.campaignId, ...comparisonIds) as Array<{
          comparison_id: string;
          retained_check_id: string;
          observer_label: string;
          observer_kind: 'character' | 'combatant' | null;
          observer_ref: string | null;
          noticed: number;
          combat_instance_id: string | null;
          status: string;
          label: string;
        }>;
        if (rows.length !== comparisonIds.length)
          return err(
            'invalid_comparisons',
            'every comparison id must identify a passive comparison in this campaign',
          );
        if (
          rows.some(
            (row) =>
              row.status !== 'active' ||
              // A hider usually rolls Stealth while sneaking up, before the
              // encounter starts; a check from another encounter is stale.
              (row.combat_instance_id !== null &&
                row.combat_instance_id !== instance.combat_instance_id),
          )
        )
          return err(
            'invalid_comparisons',
            'all comparisons must come from active retained checks rolled before or during the active combat instance',
          );
        if (
          rows.some(
            (row) => row.observer_kind === null || row.observer_ref === null,
          )
        )
          return err(
            'missing_observer_identity',
            'every observer must have a participant identity',
          );
        for (const row of rows) {
          if (row.observer_kind === 'combatant') {
            const participant = txnDb
              .prepare(
                'SELECT 1 FROM encounter_combatant WHERE campaign_id = ? AND combat_instance_id = ? AND combatant_id = ?',
              )
              .get(
                ctx.campaignId,
                instance.combat_instance_id,
                row.observer_ref,
              );
            if (participant === undefined)
              return err(
                'invalid_observer',
                'every observer must be a participant in the active combat instance',
              );
          } else {
            const participant = txnDb
              .prepare('SELECT 1 FROM character WHERE id = ?')
              .get(row.observer_ref);
            if (participant === undefined)
              return err(
                'invalid_observer',
                'every observer must identify a campaign character participant',
              );
          }
        }
        const byHider = new Map<string, Set<string>>();
        const noticedAny = new Set<string>();
        const comparisonPairs = new Set<string>();
        for (const row of rows) {
          const observerKey = JSON.stringify([
            row.observer_kind,
            row.observer_ref,
          ]);
          const pairKey = JSON.stringify([row.retained_check_id, observerKey]);
          if (comparisonPairs.has(pairKey))
            return err(
              'duplicate_comparison',
              'each hider must have exactly one comparison per observer',
            );
          comparisonPairs.add(pairKey);
          const observers =
            byHider.get(row.retained_check_id) ?? new Set<string>();
          observers.add(observerKey);
          byHider.set(row.retained_check_id, observers);
          if (row.noticed === 1) noticedAny.add(observerKey);
        }
        const observerSets = [...byHider.values()];
        const expected = observerSets[0];
        if (
          observerSets.some(
            (observers) =>
              observers.size !== expected.size ||
              [...observers].some((id) => !expected.has(id)),
          )
        )
          return err(
            'mismatched_observer_sets',
            'each hider must be compared with the same complete observer set',
          );
        const participants: TurnParticipantInput[] = [...expected]
          .filter((key) => !noticedAny.has(key))
          .map((key) => {
            const [kind, ref] = JSON.parse(key) as [
              'character' | 'combatant',
              string,
            ];
            return { kind: kind as 'character' | 'combatant', ref };
          });
        if (participants.length === 0)
          return ok({
            combatInstanceId: instance.combat_instance_id,
            surprised: [],
          });
        return ok(
          setSurprisedInTransaction(txnDb, {
            campaignId: ctx.campaignId,
            participants,
            provenance: `model:${ctx.turnId}`,
            sessionId: ctx.sessionId,
            at: ctx.at,
          }),
        );
      });
    } catch (e) {
      if (e instanceof ActionEconomyError)
        return err('turn_budget_error', e.message);
      throw e;
    }
  },
};
