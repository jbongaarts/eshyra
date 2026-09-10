import { describe, expect, it } from 'vitest';
import {
  deriveDiscoveryTrace,
  measureDiscovery,
  projectDiscoveryTrace,
  runDiscoveryStages,
} from '../../src/internal.js';
import { DIAGNOSTIC_FIXTURES } from '../diagnostics/index.js';
import { freshDbWithSession } from '../support/db.js';
import { installJhptCampaignRules } from './support/jhptCampaignRules.js';
import {
  installRepeatedTraversalCampaign,
  REPEATED_TRAVERSAL,
  REPEATED_TRAVERSAL_INPUT,
  REPEATED_TRAVERSAL_STATE_FIELDS,
} from './support/repeatedTraversal.js';
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
      // The synthetic traversal is candidate STATE. It is not an event, and a
      // derivation that manufactured one from it would be reinstating the lossy
      // equivalence this design removed: the stage's traversal list is the
      // producer's own event history, unchanged by a state edit.
      expect(derived.expansion.traversals).toEqual(live.expansion.traversals);
      expect(derived.expansion.traversals).not.toContainEqual(
        gained.expansion.outputsProduced.find(
          (item) => item.candidateKey === key,
        )?.traversals[0],
      );
    } finally {
      db.close();
    }
  });
});

/**
 * The state/event distinction, on real mechanics.
 *
 * This is the case the corpus does not contain and the previous derivation
 * could not represent: a typed relationship that fires in expansion pass 1 and
 * fires AGAIN in campaign-rule expansion, having already been carried into the
 * second pass. The old rule — "the stage traversed what newly appeared on the
 * candidate stream" — reports the second execution as nothing at all, because
 * cumulative state is identical before and after it.
 *
 * The chain is built out of the real producers (`runDiscoveryStages`, the real
 * typed-link expansion, and a house rule written through jhpt's own writer),
 * not hand-assembled arrays, so it also proves the promotion path that produces
 * the state actually exists.
 */
describe('a traversal that fires in both expansion passes', () => {
  it('survives as an event in each stage that fired it', () => {
    const db = freshDbWithSession();
    try {
      const campaign = installRepeatedTraversalCampaign(db);
      const live = runDiscoveryStages({
        db,
        scenario: {
          playerInput: REPEATED_TRAVERSAL_INPUT,
          stateFields: REPEATED_TRAVERSAL_STATE_FIELDS,
        },
        campaignPosition: campaign.campaignPosition,
        campaignRuleSeam: campaign.seam,
      });

      // Non-vacuity, in the order the mechanism runs.
      expect(live.expansion.traversals).toContainEqual(REPEATED_TRAVERSAL);
      expect(live.ruleExpansion.outcome).toBe('ran');
      const promoted = live.ruleJoin.outputsProduced.find(
        (item) => item.candidateKey === REPEATED_TRAVERSAL.sourceRecordKey,
      );
      expect(promoted?.routes.map((route) => route.routeClass)).toContain(
        'campaign-rule',
      );

      // The load-bearing precondition: BEFORE the second pass, both endpoints
      // already carry the relationship. A set difference over the candidate
      // stream therefore has nothing to report, which is exactly why the old
      // derivation lost the event.
      for (const key of [
        REPEATED_TRAVERSAL.sourceRecordKey,
        REPEATED_TRAVERSAL.targetRecordKey,
      ])
        expect(
          live.ruleJoin.outputsProduced.find(
            (item) => item.candidateKey === key,
          )?.traversals,
        ).toContainEqual(REPEATED_TRAVERSAL);

      // ... and the second pass fired it anyway.
      expect(live.ruleExpansion.traversals).toContainEqual(REPEATED_TRAVERSAL);

      const projected = JSON.parse(
        JSON.stringify(projectDiscoveryTrace(live)),
      ) as ReturnType<typeof projectDiscoveryTrace>;
      expect(projected.expansion.traversalEvents).toEqual(
        live.expansion.traversals,
      );
      expect(projected.ruleExpansion.traversalEvents).toEqual(
        live.ruleExpansion.traversals,
      );
      expect(projected.ruleExpansion.traversalEvents).toContainEqual(
        REPEATED_TRAVERSAL,
      );

      const derived = deriveDiscoveryTrace(projected);
      expect(derived.expansion.traversals).toContainEqual(REPEATED_TRAVERSAL);
      expect(derived.ruleExpansion.traversals).toContainEqual(
        REPEATED_TRAVERSAL,
      );

      // M4 asks which declared traversals FIRED. Both stages did.
      expect(
        measureDiscovery(projected, {
          requiredRelationshipExpansion: [REPEATED_TRAVERSAL],
        }).m4[0].result,
      ).toBe('fired');
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
          const projected = JSON.parse(
            JSON.stringify(projectDiscoveryTrace(live)),
          ) as ReturnType<typeof projectDiscoveryTrace>;

          // The canonical decisions and events are COPIES. Expected comes from
          // the live producer trace, never from a second call of the
          // projection — a projection compared against itself proves nothing
          // about whether it recorded what the run did.
          const roundTrip = (value: unknown) =>
            JSON.parse(JSON.stringify(value)) as unknown;
          expect(
            projected.retention.dispositions,
            'retention.dispositions',
          ).toEqual(roundTrip(live.retention.dispositions));
          expect(projected.packet.decisions, 'packet.decisions').toEqual(
            roundTrip(live.packet.decisions),
          );
          expect(
            projected.expansion.traversalEvents,
            'expansion.traversalEvents',
          ).toEqual(roundTrip(live.expansion.traversals));
          expect(
            projected.ruleExpansion.traversalEvents,
            'ruleExpansion.traversalEvents',
          ).toEqual(roundTrip(live.ruleExpansion.traversals));

          const derived = deriveDiscoveryTrace(projected);

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
