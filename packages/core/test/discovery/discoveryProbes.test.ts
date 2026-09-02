import { describe, expect, it } from 'vitest';
import { measureDiscovery, runDiscoveryStages } from '../../src/internal.js';
import type {
  DiagnosticTarget,
  TypedRelationshipExpectation,
} from '../diagnostics/index.js';
import { DIAGNOSTIC_FIXTURES } from '../diagnostics/index.js';
import { freshDbWithSession } from '../support/db.js';
import {
  declaredBindingLabels,
  moduleForFixture,
  oracleCampaignRuleSeam,
  scenarioForFixture,
} from './support/scenario.js';

/** Matches the private targetReference() convention in fixtureContract.ts. */
function targetRef(target: DiagnosticTarget): string {
  return target.targetKind === 'adventure-entity'
    ? `${target.moduleId}#${target.entityKind}:${target.entityId}`
    : target.recordKey;
}

const STAGES = [
  'signals',
  'candidates',
  'expansion',
  'rule-join',
  'dedup',
  'retention',
  'packet',
] as const;

describe('offline discovery diagnostic probes', () => {
  for (const fixture of DIAGNOSTIC_FIXTURES) {
    for (const execution of fixture.executions) {
      const label = `${fixture.probeId}/${execution.executionId}`;
      it(`${label} runs end to end with M1-M9 per stage`, () => {
        const db = freshDbWithSession();
        try {
          const trace = runDiscoveryStages({
            db,
            scenario: scenarioForFixture(
              fixture,
              execution,
              moduleForFixture(fixture),
            ),
            campaignRuleSeam: oracleCampaignRuleSeam(fixture, execution),
          });
          expect(trace.stageOrder).toEqual([...STAGES]);
          expect(trace.packet.packet.modelUsageClaim).toBeNull();

          const mustRefs = fixture.mustIncludeTargets.map(targetRef);
          const declaredTraversals: readonly TypedRelationshipExpectation[] =
            Array.isArray(fixture.requiredRelationshipExpansion)
              ? fixture.requiredRelationshipExpansion
              : [];
          const measurements = measureDiscovery(trace, {
            mustIncludeTargetRefs: mustRefs,
            mustNotIncludeTargetRefs:
              fixture.mustNotIncludeTargets.map(targetRef),
            requiredFacts: Array.isArray(fixture.requiredRetainedFacts)
              ? fixture.requiredRetainedFacts
              : [],
            // Without this the declared traversals are measured against an
            // empty list and M4 silently reports nothing for every probe.
            requiredRelationshipExpansion: declaredTraversals.map(
              (expectation) => ({
                sourceRecordKey: expectation.sourceRecordKey,
                linkField: expectation.linkField,
                relation: expectation.relation,
                targetRecordKey: expectation.targetRecordKey,
              }),
            ),
          });

          // A stage that produced nothing and recorded no loss did not pass;
          // it failed to run (design section 13.3).
          for (const stage of STAGES)
            expect(
              measurements.perStage[stage].failedToRun,
              `${label} stage ${stage} recorded no output and no loss`,
            ).toBe(false);

          // M1: every must-include target reached the packet. M2: nothing is
          // reported lost when M1 passed.
          for (const ref of mustRefs) {
            expect(measurements.m1[ref], `${label} M1 missed ${ref}`).toBe(
              true,
            );
            expect(measurements.m2[ref]).toBeNull();
          }

          // M3: no route produced at any stage is missing from the packet.
          for (const [key, counts] of Object.entries(measurements.m3)) {
            if (counts.droppedBeforePacket) continue;
            expect(counts.lost, `${label} lost routes for ${key}`).toEqual([]);
            expect(counts.inPacket).toBeGreaterThan(0);
          }

          // M4: every declared typed traversal actually fired this run.
          expect(measurements.m4.map((item) => item.result)).toEqual(
            declaredTraversals.map(() => 'fired'),
          );

          // M5: a campaign-rule or campaign-ruling route may exist only where
          // the seam actually supplied one, and every supplied rule must be
          // placed beside a governing record rather than left floating.
          const joinedRouteClasses = new Set(
            trace.packet.packet.candidates.flatMap((candidate) =>
              candidate.routes.map((route) => route.routeClass),
            ),
          );
          const seamSupplied = measurements.m5.placed.length > 0;
          for (const routeClass of ['campaign-rule', 'campaign-ruling'])
            if (joinedRouteClasses.has(routeClass as never))
              expect(
                seamSupplied,
                `${label} emitted ${routeClass} with no rule placed by the seam`,
              ).toBe(true);
          expect(
            trace.ruleJoin.losses.filter(
              (loss) => loss.reason === 'unplaced-rule',
            ),
          ).toEqual([]);

          // M6 / M7: no must-consider overflow, and every drop carries a
          // reason. Reported as counts and reasons, never as a rate.
          expect(measurements.m6.overflowed).toBe(false);
          expect(measurements.m6.allMustConsiderRetained).toBe(true);
          expect(trace.packet.byteBudgetExceeded).toBe(false);
          expect(measurements.m7.candidateCount).toBeGreaterThan(0);
          for (const drop of measurements.m7.drops)
            expect(drop.reason.length).toBeGreaterThan(0);

          // M8 / M9.
          expect(measurements.m8.forbiddenPresent).toEqual([]);
          expect(measurements.m8.unattributedPresent).toEqual([]);
          expect(measurements.m9.missing).toEqual([]);

          // Expected route classes are a lower bound; extras are legitimate
          // discovery and stay visible in the trace.
          for (const expected of execution.expectedRouteClasses) {
            const candidate = trace.packet.packet.candidates.find(
              (item) => item.identity.key === expected.targetRef,
            );
            expect(
              candidate,
              `${label} missing ${expected.targetRef}`,
            ).toBeDefined();
            for (const route of expected.routes)
              expect(
                candidate?.routes.map((item) => item.routeClass),
                `${label} ${expected.targetRef} missing route ${route}`,
              ).toContain(route);
          }

          // Anything the harness or the fixture supplied rather than
          // discovered is labelled, so an oracle-assisted pass is never read
          // as end-to-end success.
          const oracleLabels = [
            ...trace.signals.oracleSuppliedSignalLabels,
            ...declaredBindingLabels(fixture),
            ...measurements.m5.placed.map(
              (item) => `oracle-campaign-rule:${item.ruleIdentity}`,
            ),
          ];
          if (execution.oracleSignals.length > 0)
            expect(
              oracleLabels.length,
              `${label} declares oracle signals but reported none`,
            ).toBeGreaterThan(0);
          expect(
            trace.signals.stateBindings.map(
              (binding) => `scenario-state-binding:${binding.instanceId}`,
            ),
          ).toEqual(declaredBindingLabels(fixture));
        } finally {
          db.close();
        }
      });
    }
  }
});
