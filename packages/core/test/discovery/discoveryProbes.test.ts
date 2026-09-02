import { describe, expect, it } from 'vitest';
import { measureDiscovery, runDiscoveryStages } from '../../src/internal.js';
import type {
  DiagnosticTarget,
  TypedRelationshipExpectation,
} from '../diagnostics/index.js';
import { DIAGNOSTIC_FIXTURES } from '../diagnostics/index.js';
import { freshDbWithSession } from '../support/db.js';
import {
  ASSERTIONS,
  assertGuardExists,
  FACT_EVIDENCE,
} from './support/factEvidence.js';
import {
  declaredBindingLabels,
  installScenarioBinding,
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

/**
 * Packet semantics the accepted design requires by name, expressed as typed
 * expectations because they are NOT machine-checkable as `requiredRetainedFacts`
 * prose. Design section 7.2 names both worked examples: the Acid Breath
 * projection omits the success branch and the area, and Fireball has no typed
 * area despite its prose. Asserting only that `m9.missing` is empty let those
 * requirements pass while the packet never disclosed them.
 */
const REQUIRED_PROJECTION_LIMITS: Readonly<
  Record<
    string,
    readonly { candidateKey: string; kind: string; evidencePath?: string }[]
  >
> = {
  P3: [
    {
      candidateKey: 'creature:adult-black-dragon',
      kind: 'success-branch',
      evidencePath: '/data/actions/5/mechanics/saves',
    },
    { candidateKey: 'creature:adult-black-dragon', kind: 'area' },
  ],
  P4: [{ candidateKey: 'spell:fireball', kind: 'area' }],
};

/** Authored-module authority metadata that must survive into the packet. */
const REQUIRED_ADVENTURE_PROVENANCE: Readonly<
  Record<string, { sourceRef: string; licenseClass: string }>
> = {
  P9: {
    sourceRef: 'first-party:hollow-beneath-emberfall',
    licenseClass: 'original',
  },
};

const STAGES = [
  'signals',
  'candidates',
  'expansion',
  'rule-join',
  'campaign-rule-expansion',
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
          const moduleJson = moduleForFixture(fixture);
          const rulesPackResolver = installScenarioBinding(fixture, db);
          const trace = runDiscoveryStages({
            db,
            rulesPackResolver,
            scenario: scenarioForFixture(fixture, execution, moduleJson),
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
            // Each statement-only requirement carries its declared evidence
            // surface. One without an entry lands in m9.indeterminate and
            // fails the probe, so a field-9 requirement can never go unproven
            // while M9 reads green.
            requiredFacts: (Array.isArray(fixture.requiredRetainedFacts)
              ? fixture.requiredRetainedFacts
              : []
            ).map((fact, index) => ({
              ...fact,
              classification: FACT_EVIDENCE[`${fixture.probeId}[${index}]`],
            })),
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

          // Every statement-only requirement is classified, and every
          // classification that names an assertion actually runs it.
          expect(
            measurements.m9.indeterminate.map((fact) => fact.statement),
            `${label} has field-9 requirements with no declared evidence surface`,
          ).toEqual([]);
          for (const entry of measurements.m9.classified) {
            assertGuardExists(entry.classification);
            const { kind, assertionId } = entry.classification;
            if (kind === 'packet-semantic' || kind === 'substrate-fact') {
              expect(
                assertionId,
                `${label} ${kind} requirement names no assertion`,
              ).toBeDefined();
              const assertion = ASSERTIONS[assertionId as string];
              expect(
                assertion,
                `${label} names missing assertion ${assertionId}`,
              ).toBeDefined();
              assertion({
                trace,
                candidate: (key) =>
                  trace.packet.packet.candidates.find(
                    (item) => item.identity.key === key,
                  ),
                playerInput: fixture.playerInput,
                moduleJson: moduleJson as Record<string, unknown> | undefined,
              });
            }
          }
          for (const required of REQUIRED_PROJECTION_LIMITS[fixture.probeId] ??
            []) {
            const candidate = trace.packet.packet.candidates.find(
              (item) => item.identity.key === required.candidateKey,
            );
            const note = candidate?.projectionLimits.find(
              (item) =>
                item.kind === required.kind &&
                (required.evidencePath === undefined ||
                  item.evidence.path === required.evidencePath),
            );
            expect(
              note,
              `${label} packet omits the required ${required.kind} disclosure for ${required.candidateKey}`,
            ).toBeDefined();
            if (required.evidencePath !== undefined)
              expect(note?.evidence.path).toBe(required.evidencePath);
            expect(note?.preservedProse.length ?? 0).toBeGreaterThan(0);
          }

          const provenance = REQUIRED_ADVENTURE_PROVENANCE[fixture.probeId];
          if (provenance !== undefined) {
            const authored = trace.packet.packet.candidates.filter(
              (item) => item.identity.kind === 'adventure-entity',
            );
            expect(authored.length).toBeGreaterThan(0);
            for (const item of authored) {
              expect(item.provenance.sourceRef).toBe(provenance.sourceRef);
              expect(
                (item.provenance.license as { licenseClass?: string } | null)
                  ?.licenseClass,
              ).toBe(provenance.licenseClass);
            }
          }

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
