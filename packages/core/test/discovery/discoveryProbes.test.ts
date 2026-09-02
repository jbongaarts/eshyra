import { describe, expect, it } from 'vitest';
import { measureDiscovery, runDiscoveryStages } from '../../src/internal.js';
import { DIAGNOSTIC_FIXTURES } from '../diagnostics/index.js';
import { freshDbWithSession } from '../support/db.js';
import {
  moduleForFixture,
  oracleCampaignRuleSeam,
  scenarioForFixture,
} from './support/scenario.js';

describe('offline discovery diagnostic probes', () => {
  for (const fixture of DIAGNOSTIC_FIXTURES) {
    for (const execution of fixture.executions) {
      it(`${fixture.probeId}/${execution.executionId} emits all seven stage traces`, () => {
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
          expect(trace.stageOrder).toEqual([
            'signals',
            'candidates',
            'expansion',
            'rule-join',
            'dedup',
            'retention',
            'packet',
          ]);
          expect(trace.packet.packet.modelUsageClaim).toBeNull();
          const measurements = measureDiscovery(trace, {
            mustIncludeTargetRefs: fixture.mustIncludeTargets.map((target) =>
              target.targetKind === 'adventure-entity'
                ? `${target.moduleId}#${target.entityKind}:${target.entityId}`
                : target.recordKey,
            ),
            mustNotIncludeTargetRefs: fixture.mustNotIncludeTargets.map(
              (target) => target.recordKey,
            ),
            requiredFacts: Array.isArray(fixture.requiredRetainedFacts)
              ? fixture.requiredRetainedFacts
              : [],
          });
          for (const expected of execution.expectedRouteClasses) {
            const candidate = trace.packet.packet.candidates.find(
              (item) => item.identity.key === expected.targetRef,
            );
            expect(
              candidate,
              `${fixture.probeId}/${execution.executionId} missing ${expected.targetRef}`,
            ).toBeDefined();
            for (const route of expected.routes)
              expect(
                candidate?.routes.map((item) => item.routeClass),
              ).toContain(route);
          }
          expect(measurements.m1).toEqual(
            expect.objectContaining(
              Object.fromEntries(
                fixture.mustIncludeTargets.map((target) => [
                  target.targetKind === 'adventure-entity'
                    ? `${target.moduleId}#${target.entityKind}:${target.entityId}`
                    : target.recordKey,
                  true,
                ]),
              ),
            ),
          );
          expect(measurements.m9.missing).toEqual([]);
          expect(measurements.m6.overflowed).toBe(false);
          expect(measurements.m8.forbiddenPresent).toEqual([]);
        } finally {
          db.close();
        }
      });
    }
  }
});
