import { describe, expect, it } from 'vitest';
import {
  deriveDiscoveryTrace,
  projectDiscoveryTrace,
  runDiscoveryStages,
} from '../../src/internal.js';
import { DIAGNOSTIC_FIXTURES } from '../diagnostics/index.js';
import { freshDbWithSession } from '../support/db.js';
import { installJhptCampaignRules } from './support/jhptCampaignRules.js';
import {
  installScenarioBinding,
  moduleForFixture,
  scenarioForFixture,
} from './support/scenario.js';

/**
 * The derivation is faithful to the producer.
 *
 * The durable record now stores canonical facts only, and every summary M1-M11
 * reports is derived from them. That removes the class of defect where two
 * stored claims about one fact drift apart — but it moves the burden here: the
 * derivation must reproduce what the run actually did, or the measurements are
 * wrong in a new way.
 *
 * So this compares the DERIVED summaries against the producer's own live
 * `DiscoveryTrace` — which still records them directly and is not what gets
 * persisted — across the whole diagnostic corpus. The live trace is the
 * independent authority here: nothing in the derivation reads it.
 *
 * `discoveryProbes.test.ts` is the second half of this proof. Its M1-M9
 * assertions were written against the producer's stored summaries and now run
 * entirely on derived ones, unchanged.
 */
describe('derived accounting follows section 12.1 identity', () => {
  it('classifies a traversal gained without a route as modified', () => {
    // The corpus happens never to produce this shape, so it is pinned
    // directly: routes alone would report the mutation as untouched
    // pass-through, which section 12.1 names as the reason identity is not
    // route-only.
    const db = freshDbWithSession();
    try {
      const fixture = DIAGNOSTIC_FIXTURES[0];
      const rules = installJhptCampaignRules(
        db,
        fixture,
        fixture.executions[0],
      );
      const live = runDiscoveryStages({
        db,
        scenario: scenarioForFixture(fixture, fixture.executions[0]),
        campaignPosition: rules.campaignPosition,
        campaignRuleSeam: rules.seam,
      });
      const projected = projectDiscoveryTrace(live);
      const source = projected.candidates.outputsProduced;
      if (source.length === 0) throw new Error('no candidate to mutate');
      const key = source[0].candidateKey;
      const gained = {
        ...projected,
        expansion: {
          ...projected.expansion,
          outputsProduced: source.map((item) =>
            item.candidateKey === key
              ? {
                  ...item,
                  traversals: [
                    {
                      sourceRecordKey: key,
                      linkField: 'test',
                      relation: 'test',
                      targetRecordKey: 'rule:test',
                    },
                  ],
                }
              : item,
          ),
        },
      };
      const derived = deriveDiscoveryTrace(gained);
      expect(derived.expansion.modified).toContain(key);
      expect(derived.expansion.carriedForward).not.toContain(key);
      expect(derived.expansion.traversals).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});

describe('derived summaries reproduce the producer', () => {
  for (const fixture of DIAGNOSTIC_FIXTURES)
    for (const execution of fixture.executions) {
      const label = `${fixture.probeId}/${execution.executionId}`;
      it(`${label} derives what the run recorded`, () => {
        const db = freshDbWithSession();
        try {
          const rulesPackResolver = installScenarioBinding(fixture, db);
          const rules = installJhptCampaignRules(
            db,
            fixture,
            execution,
            rulesPackResolver,
          );
          const live = runDiscoveryStages({
            db,
            scenario: scenarioForFixture(
              fixture,
              execution,
              moduleForFixture(fixture),
            ),
            campaignPosition: rules.campaignPosition,
            campaignRuleSeam: rules.seam,
            ...(rulesPackResolver === undefined ? {} : { rulesPackResolver }),
          });
          // Through the durable shape and back, exactly as a persisted row.
          const derived = deriveDiscoveryTrace(
            JSON.parse(
              JSON.stringify(projectDiscoveryTrace(live)),
            ) as ReturnType<typeof projectDiscoveryTrace>,
          );

          for (const key of [
            'signals',
            'candidates',
            'expansion',
            'ruleJoin',
            'ruleExpansion',
            'lateRuleJoin',
            'dedup',
            'retention',
            'packet',
          ] as const) {
            const recorded = live[key];
            const computed = derived[key];
            expect([...computed.produced].sort(), `${key}.produced`).toEqual(
              [...recorded.produced].sort(),
            );
            expect([...computed.modified].sort(), `${key}.modified`).toEqual(
              [...recorded.modified].sort(),
            );
            expect(
              [...computed.carriedForward].sort(),
              `${key}.carriedForward`,
            ).toEqual([...recorded.carriedForward].sort());
            expect(computed.failedToRun, `${key}.failedToRun`).toBe(
              recorded.failedToRun,
            );
          }

          for (const key of ['expansion', 'ruleExpansion'] as const)
            expect(derived[key].traversals, `${key}.traversals`).toEqual(
              live[key].traversals,
            );

          for (const key of ['ruleJoin', 'lateRuleJoin'] as const) {
            const recorded = live[key];
            const computed = derived[key];
            for (const field of [
              'requestedRuleRecordKeys',
              'requestedAmbiguityIds',
              'returnedRuleIdentities',
              'returnedAmbiguityIds',
              'placedRuleIdentities',
              'unplacedRuleIdentities',
              'surfacedCandidateKeys',
              'resolvedAmbiguityIds',
            ] as const)
              expect([...computed[field]].sort(), `${key}.${field}`).toEqual(
                [...recorded[field]].sort(),
              );
            expect(computed.placedRules, `${key}.placedRules`).toEqual(
              recorded.placedRules,
            );
            expect(computed.ruleQueryExecuted).toBe(recorded.ruleQueryExecuted);
            expect(computed.rulingQueryExecuted).toBe(
              recorded.rulingQueryExecuted,
            );
            expect(computed.rulingQueryScope).toBe(recorded.rulingQueryScope);
            expect(
              [...computed.unresolvedAmbiguityIds].sort(),
              `${key}.unresolvedAmbiguityIds`,
            ).toEqual(
              [
                ...recorded.unresolvedAmbiguities
                  .map((item) => item.id)
                  .filter((id): id is string => typeof id === 'string'),
              ].sort(),
            );
          }

          expect(derived.retention.dropped).toEqual(live.retention.dropped);
          expect(derived.retention.overflow).toEqual(live.retention.overflow);
          expect(derived.retention.overflowed).toBe(live.retention.overflowed);
          expect(derived.packet.packet.bytes).toBe(live.packet.packet.bytes);
          expect(derived.packet.byteOverflow).toEqual(live.packet.byteOverflow);
          expect(derived.packet.byteBudgetExceeded).toBe(
            live.packet.byteBudgetExceeded,
          );
          expect(derived.packet.dropped).toEqual(live.packet.dropped);
          expect(derived.packet.packet.projectionLimitNotes).toEqual(
            live.packet.packet.projectionLimitNotes,
          );
          expect([...derived.unexpandedPromotions].sort()).toEqual(
            [...live.unexpandedPromotions].sort(),
          );
          expect(derived.stageOrder).toEqual(live.stageOrder);
        } finally {
          db.close();
        }
      });
    }
});
