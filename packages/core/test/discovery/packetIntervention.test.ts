import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  Db,
  DiscoveryMeasurements,
  DiscoveryShadowEvidence,
  ModelClient,
  ModelCompleteInput,
  ModelCompleteResult,
  RunTurnInput,
} from '../../src/internal.js';
import {
  createDefaultToolRegistry,
  getTurnTrace,
  measureAcceptedStateEffect,
  measureDiscovery,
  measureRuntimeDiscovery,
  openScene,
  projectDiscoveryTrace,
  readDiscoveryShadowEvidence,
  renderContextPacketMessage,
  runDiscoveryStages,
  runTurn,
} from '../../src/internal.js';
import type {
  DiagnosticFixture,
  FixtureExecution,
} from '../diagnostics/index.js';
import { DIAGNOSTIC_FIXTURES } from '../diagnostics/index.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from '../support/db.js';
import { installJhptCampaignRules } from './support/jhptCampaignRules.js';
import { installProbeCampaignState } from './support/runtimeCampaignState.js';
import { RUNTIME_REACH } from './support/runtimeReach.js';
import {
  installScenarioBinding,
  moduleForFixture,
  scenarioForFixture,
} from './support/scenario.js';

/**
 * W10 (`eshyra-o9bd.19.12`, dispatch `eshyra-o9bd.19.12.4`) permanent evidence
 * for context-packet INTERVENTION: design sections 7.2, 7.3, 12.3, 13.1, 13.2
 * and 13.3.
 *
 * This suite changes nothing about the seam (`eshyra-o9bd.19.12.3`). For every
 * authored fixture execution it runs TWO real turns on two freshly seeded
 * databases with the same scripted model, the same (absent) auditor and the
 * same seed: a BASELINE in `shadow` mode, then the INTERVENTION in `intervene`
 * mode. Every measurement is read back out of SQLite via
 * `readDiscoveryShadowEvidence`/`getTurnTrace`, never from an in-memory
 * capture, because the durable record is the thing design section 12.3
 * actually delivers.
 *
 * Design section 13.3: "No phase is accepted on the basis that nothing
 * failed." Every check below either asserts an explicit pinned value or
 * reports how many things it actually checked, so an empty or vacuous check
 * set cannot read as green.
 */

const TURN = 'w11-discovery-turn';
const AT = '2026-05-20T10:00:00.000Z';
const NARRATION = 'You weigh the situation.';

interface SeenModel extends ModelClient {
  readonly seen: readonly ModelCompleteInput[];
}

/** Replays structured provider results, for the native tool transport. */
class StructuredScriptedModel implements SeenModel {
  private index = 0;
  readonly seen: ModelCompleteInput[] = [];
  constructor(private readonly results: readonly ModelCompleteResult[]) {}
  complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    this.seen.push(input);
    const result = this.results[this.index] ?? { text: NARRATION };
    this.index += 1;
    return Promise.resolve(result);
  }
}

class ScriptedModel implements SeenModel {
  private index = 0;
  readonly seen: ModelCompleteInput[] = [];
  constructor(private readonly replies: readonly string[] = [NARRATION]) {}
  complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    this.seen.push(input);
    const reply = this.replies[this.index] ?? NARRATION;
    this.index += 1;
    return Promise.resolve({ text: reply });
  }
}

const toolCall = (tool: string, args: unknown): string =>
  ['```tool_call', JSON.stringify({ tool, args }), '```'].join('\n');

function seedCampaign(): Db {
  const db = freshDbWithSession();
  openScene(db, {
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    sceneId: 'scene-0',
    title: 'The approach',
    at: '2026-05-20T09:00:00.000Z',
  });
  return db;
}

function turnInput(playerInput: string): RunTurnInput {
  return {
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: TURN,
    playerInput,
    seed: 42,
    at: AT,
  };
}

/** Shadow/intervention evidence as it was persisted, re-read from SQLite. */
function recordedEvidence(db: Db): DiscoveryShadowEvidence | undefined {
  return readDiscoveryShadowEvidence(
    getTurnTrace(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      sessionId: DEFAULT_TEST_SESSION_ID,
      turnId: TURN,
    })?.discoveryShadow,
  );
}

function requireTrace(
  evidence: DiscoveryShadowEvidence | undefined,
): NonNullable<DiscoveryShadowEvidence['trace']> {
  if (evidence?.trace === undefined)
    throw new Error(
      `shadow capture recorded no trace: ${JSON.stringify(evidence?.failure)}`,
    );
  return evidence.trace;
}

function requireRuntime(
  evidence: DiscoveryShadowEvidence | undefined,
): NonNullable<DiscoveryShadowEvidence['runtime']> {
  if (evidence?.runtime === undefined)
    throw new Error('shadow evidence recorded no runtime observations');
  return evidence.runtime;
}

function fixtureFor(probeId: string): DiagnosticFixture {
  const fixture = DIAGNOSTIC_FIXTURES.find((item) => item.probeId === probeId);
  if (fixture === undefined) throw new Error(`missing fixture ${probeId}`);
  return fixture;
}

/**
 * The span of one candidate's own block: from its heading to the next
 * candidate's heading, or to the end of the text for the last candidate.
 * Mirrors `packetMessage.test.ts`'s helper of the same name, applied here to
 * the DELIVERED message rather than an offline-only render.
 */
function candidateSpan(text: string, candidateKey: string): string {
  const heading = `## Candidate ${candidateKey}\n`;
  const start = text.indexOf(heading);
  if (start < 0) throw new Error(`no rendered block for ${candidateKey}`);
  const next = text.indexOf('\n## Candidate ', start + heading.length);
  return next < 0 ? text.slice(start) : text.slice(start, next);
}

function occurrences(text: string, needle: string): number {
  if (needle.length === 0)
    throw new Error('occurrences() requires a non-empty needle');
  let count = 0;
  let index = text.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * The injected remainder of an intervention message, given the base message
 * an `off`/`shadow` run of the SAME turn produced. Additive delivery (design
 * section 12.3) means this slice is exactly the rendered packet text.
 */
function packetPortion(baseMessage: string, deliveredMessage: string): string {
  if (!deliveredMessage.startsWith(baseMessage))
    throw new Error(
      'the delivered message does not carry the base message as an exact prefix',
    );
  const remainder = deliveredMessage.slice(baseMessage.length);
  if (!remainder.startsWith('\n\n'))
    throw new Error(
      'the injected remainder is not joined the way renderContextMessage joins its own sections',
    );
  return remainder.slice(2);
}

/**
 * E10's gate: the same check every fixture below is proven NOT to trip, and
 * that the forced-overflow case below is proven TO trip. A must-consider
 * overflow fails the probe (design section 6.3); this function IS that
 * failure, not a description of it.
 */
function assertProbePassesM6(
  measurements: Pick<DiscoveryMeasurements, 'm6'>,
): void {
  if (measurements.m6.overflowed)
    throw new Error(
      `probe fails its M6 gate: must-consider overflow of ${measurements.m6.overflow
        .map((item) => item.candidateKey)
        .join(', ')}`,
    );
}

/**
 * E12's structural check: no field anywhere in a per-probe report claims
 * coverage, readiness, completeness, a score, or a rate (design section
 * 13.2). `ambiguityCoverage` (M5) is the one pre-existing production field
 * whose NAME contains "coverage": it names which seam-query SCOPE
 * (`all-active` vs `requested-ambiguities`) a stage used, a categorical
 * descriptor, never a numeric completeness figure. It is named here
 * explicitly, rather than silently excluded from the scan, and the test below
 * separately asserts its value is exactly that enum so the exception cannot
 * quietly widen into hiding a real violation.
 */
const FORBIDDEN_FIELD_PATTERN =
  /coverage|readiness|completeness|\bscore\b|\brate\b/iu;
const KNOWN_NON_SCORE_FIELDS = new Set(['ambiguityCoverage']);

/**
 * Containers whose OWN keys are DATA (a rules-pack record key, a retry
 * cause), not schema field names -- M1, M2 and M3 are `Record<targetRef,
 * ...>` and M11's `byCause` is `Record<cause, count>`. A real D&D record key
 * such as `feature:fighter:ability-score-improvement` legitimately contains
 * the substring "score"; only the enclosing key is exempted here, never the
 * schema fields nested inside its value, which are checked again one level
 * down.
 */
const DYNAMIC_KEY_CONTAINERS = new Set(['m1', 'm2', 'm3', 'byCause']);

function collectForbiddenFieldPaths(
  value: unknown,
  path: string,
  hits: string[],
  skipKeyCheck = false,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectForbiddenFieldPaths(item, `${path}[${index}]`, hits);
    });
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (
        !skipKeyCheck &&
        FORBIDDEN_FIELD_PATTERN.test(key) &&
        !KNOWN_NON_SCORE_FIELDS.has(key)
      )
        hits.push(`${path}.${key}`);
      collectForbiddenFieldPaths(
        item,
        `${path}.${key}`,
        hits,
        DYNAMIC_KEY_CONTAINERS.has(key),
      );
    }
  }
}

function expectedEffectFor(execution: FixtureExecution): {
  readonly expectation: 'none' | 'effect';
  readonly operations: readonly {
    tool: string;
    args?: Record<string, unknown>;
  }[];
} {
  const declared = execution.expectedDeterministicStateEffect;
  if (declared.kind === 'none') return { expectation: 'none', operations: [] };
  return {
    expectation: 'effect',
    operations: declared.operations.map((operation) => ({
      tool: operation.tool,
      ...(operation.args === undefined ? {} : { args: operation.args }),
    })),
  };
}

/**
 * P8 is the one execution whose fixture declares a real deterministic state
 * effect (Amendment D, design section 11.2); every other execution declares
 * none. Driving the SAME scripted `use_item` call for both the baseline and
 * intervention runs is what makes M12 comparable across them.
 */
function scriptFor(fixture: DiagnosticFixture): {
  readonly model: () => SeenModel;
  readonly toolProtocol?: 'fenced' | 'native';
} {
  if (fixture.probeId === 'P8')
    return {
      model: () =>
        new ScriptedModel([
          `I fire it.\n${toolCall('use_item', {
            instanceId: 'ammunition-stack-1',
            operationId: 'hit-target',
          })}`,
          NARRATION,
        ]),
      toolProtocol: 'fenced',
    };
  return { model: () => new ScriptedModel() };
}

interface ExecutionRun {
  readonly db: Db;
  readonly model: SeenModel;
  readonly evidence: DiscoveryShadowEvidence | undefined;
  readonly message: string;
}

async function runExecution(
  fixture: DiagnosticFixture,
  execution: FixtureExecution,
  discoveryMode: 'off' | 'shadow' | 'intervene',
  scriptOverride?: {
    readonly model: () => SeenModel;
    readonly toolProtocol?: 'fenced' | 'native';
  },
): Promise<ExecutionRun> {
  const db = seedCampaign();
  const rulesPackResolver = installScenarioBinding(fixture, db);
  installJhptCampaignRules(db, fixture, execution, rulesPackResolver);
  const runtimeState = installProbeCampaignState(fixture, db);
  const script = scriptOverride ?? scriptFor(fixture);
  const model = script.model();
  const result = await runTurn(
    {
      db,
      model,
      registry: createDefaultToolRegistry(),
      discoveryMode,
      ...(rulesPackResolver === undefined
        ? {}
        : { resolveRulesPack: rulesPackResolver }),
      ...runtimeState,
    },
    {
      ...turnInput(fixture.playerInput),
      ...(script.toolProtocol === undefined
        ? {}
        : { toolProtocol: script.toolProtocol }),
    },
  );
  if (!result.ok)
    throw new Error(
      `turn failed for ${fixture.probeId}/${execution.executionId} under '${discoveryMode}': ${String(result.error)}`,
    );
  const sent = model.seen[0]?.messages[0];
  if (sent === undefined)
    throw new Error(
      `the model saw no messages for ${fixture.probeId}/${execution.executionId} under '${discoveryMode}'`,
    );
  return { db, model, evidence: recordedEvidence(db), message: sent.content };
}

/**
 * Pinned M9 fact counts (field 9, design amendment 11.1), per execution
 * label. Every fixture's `requiredRetainedFacts` array length, counted once
 * from the corpus and pinned here so a corpus edit that silently drops a fact
 * changes this number rather than passing unnoticed.
 */
const PINNED_M9_MEASURED: Readonly<Record<string, number>> = {
  'P1/default': 2,
  'P2/default': 4,
  'P3/default': 3,
  'P4/default': 6,
  'P5/default': 3,
  'P6/default': 4,
  'P7/without-active-ruling': 3,
  'P7/with-active-ruling': 3,
  'P8/default': 4,
  'P9/default': 2,
  'P10/default': 2,
  'P11/default': 0,
  'P12/default': 0,
};

/**
 * E5's pinned "checked" count: of a label's field-9 `exactSubstring` facts,
 * how many target a record RUNTIME_REACH says actually reached the packet.
 * P1, P2 and P5's rule targets are lost at the `signals` stage at runtime
 * (RUNTIME_REACH), so their exactSubstring facts are correctly excluded --
 * pinning the count at zero makes that exclusion a checked fact rather than a
 * silent, unnoticed absence. P9, P11 and P12 declare no exactSubstring facts
 * at all.
 */
const PINNED_E5_CHECKED: Readonly<Record<string, number>> = {
  'P1/default': 0,
  'P2/default': 0,
  'P3/default': 1,
  'P4/default': 2,
  'P5/default': 0,
  'P6/default': 1,
  'P7/without-active-ruling': 2,
  'P7/with-active-ruling': 2,
  'P8/default': 2,
  'P9/default': 0,
  'P10/default': 1,
  'P11/default': 0,
  'P12/default': 0,
};

interface ProbeReport {
  readonly label: string;
  readonly m1: DiscoveryMeasurements['m1'];
  readonly m2: DiscoveryMeasurements['m2'];
  readonly m3: DiscoveryMeasurements['m3'];
  readonly m4: DiscoveryMeasurements['m4'];
  readonly m5: DiscoveryMeasurements['m5'];
  readonly m6: DiscoveryMeasurements['m6'];
  readonly m7: DiscoveryMeasurements['m7'];
  readonly m8: DiscoveryMeasurements['m8'];
  readonly m9: DiscoveryMeasurements['m9'];
  readonly m10: ReturnType<typeof measureRuntimeDiscovery>['m10'];
  readonly m11: ReturnType<typeof measureRuntimeDiscovery>['m11'];
  readonly m12: ReturnType<typeof measureAcceptedStateEffect>;
}

/** Every per-probe report built below, for E12's aggregate-count check. */
const PROBE_REPORTS: ProbeReport[] = [];

describe('context-packet intervention (ADR 0020 Phase 3, W10, eshyra-o9bd.19.12.4)', () => {
  // E4 — provider neutrality, proven rather than asserted in prose: the SAME
  // injected packet text under the fenced-text transport and the native
  // structured-result transport.
  it('E4 — injects byte-identical packet text under both tool-call transports', async () => {
    const fixture = fixtureFor('P3');
    const execution = fixture.executions[0];
    const base = await runExecution(fixture, execution, 'off');
    const fenced = await runExecution(fixture, execution, 'intervene', {
      model: () => new ScriptedModel(),
      toolProtocol: 'fenced',
    });
    const native = await runExecution(fixture, execution, 'intervene', {
      model: () => new StructuredScriptedModel([{ text: NARRATION }]),
    });
    try {
      const fencedPacket = packetPortion(base.message, fenced.message);
      const nativePacket = packetPortion(base.message, native.message);
      expect(fencedPacket.length).toBeGreaterThan(0);
      expect(fencedPacket).toBe(nativePacket);

      for (const run of [fenced, native]) {
        const delivery = run.evidence?.delivery;
        if (delivery?.mode !== 'intervened' || !delivery.injected)
          throw new Error(
            `expected an injected intervention delivery, got ${JSON.stringify(delivery)}`,
          );
        expect(
          createHash('sha256').update(fencedPacket, 'utf8').digest('hex'),
        ).toBe(delivery.renderedSha256);
      }
    } finally {
      base.db.close();
      fenced.db.close();
      native.db.close();
    }
  });

  // E8 (positive half) — the offline harness proves the renderer CAN state a
  // positive bounded contract, using the SAME `renderContextPacketMessage`
  // that intervention injects. Proven offline rather than through a live
  // `runTurn` round trip because real campaign state carries no literal
  // `operationId` leaf for an item instance (`signals.ts` requires one to
  // fire the `capability-preflight` signal), and `installProbeCampaignState`
  // deliberately does not synthesize one -- the same "don't hand the signals
  // stage the answer it is supposed to discover" policy that already governs
  // P1/P2's documented runtime loss in RUNTIME_REACH. This is a real,
  // pre-existing Phase 2/3 boundary, recorded in this bead's completion
  // notes, not papered over here with a synthetic state field.
  it('E8 (positive half) — the offline packet states P8 as a positive bounded contract', () => {
    const fixture = fixtureFor('P8');
    const execution = fixture.executions[0];
    const db = freshDbWithSession();
    try {
      const rulesPackResolver = installScenarioBinding(fixture, db);
      const campaignRules = installJhptCampaignRules(
        db,
        fixture,
        execution,
        rulesPackResolver,
      );
      const trace = runDiscoveryStages({
        db,
        scenario: scenarioForFixture(
          fixture,
          execution,
          moduleForFixture(fixture),
        ),
        campaignRuleSeam: campaignRules.seam,
        campaignPosition: campaignRules.campaignPosition,
        ...(rulesPackResolver === undefined ? {} : { rulesPackResolver }),
      });
      const rendered = renderContextPacketMessage(trace);
      const span = candidateSpan(
        rendered.text,
        'magic-item:ammunition-1-2-or-3',
      );
      expect(span).toContain('POSITIVE BOUNDED CONTRACT');
      expect(span).toContain('operation=hit-target');
      expect(span).toContain(
        `revision=${String(execution.expectedCapabilityStatus.revision)}`,
      );
      expect(span).toContain('status=available');
      expect(span).toContain('- required inputs:');
      expect(span).toContain('- explicit exclusions:');
      expect(span).toContain('- residual DM interpretation:');
      expect(span).not.toContain('explicit exclusions: none');
    } finally {
      db.close();
    }
  });

  // E10 (second half) — the load-bearing negative case. Every execution below
  // proves `assertProbePassesM6` does NOT throw; this proves it DOES, over a
  // reduced budget that forces a real must-consider overflow.
  describe('E10 (second half) — the overflow gate actually fails a probe', () => {
    it('forces P9 to overflow under a reduced candidate budget and fails its M6 gate', () => {
      const fixture = fixtureFor('P9');
      const execution = fixture.executions[0];
      const db = freshDbWithSession();
      try {
        const rulesPackResolver = installScenarioBinding(fixture, db);
        const campaignRules = installJhptCampaignRules(
          db,
          fixture,
          execution,
          rulesPackResolver,
        );
        const trace = runDiscoveryStages({
          db,
          scenario: scenarioForFixture(
            fixture,
            execution,
            moduleForFixture(fixture),
          ),
          campaignRuleSeam: campaignRules.seam,
          campaignPosition: campaignRules.campaignPosition,
          ...(rulesPackResolver === undefined ? {} : { rulesPackResolver }),
          budget: { maxCandidates: 1 },
        });
        const rendered = renderContextPacketMessage(trace);
        const measurements = measureDiscovery(projectDiscoveryTrace(trace));

        // The measurement reports the failure, non-vacuously: a real
        // overflow, naming a real candidate with real routes.
        expect(measurements.m6.overflowed).toBe(true);
        expect(measurements.m6.overflow.length).toBeGreaterThan(0);
        expect(rendered.mustConsiderOverflow.length).toBe(
          measurements.m6.overflow.length,
        );
        for (const item of measurements.m6.overflow) {
          expect(item.candidateKey.length).toBeGreaterThan(0);
          expect(item.routes.length).toBeGreaterThan(0);
          // The delivered text discloses it: the candidate and every one of
          // its routes appear in the overflow block.
          expect(rendered.text).toContain('## Must-consider overflow');
          expect(rendered.text).toContain(item.candidateKey);
          for (const route of item.routes)
            expect(rendered.text).toContain(`route ${route.routeClass}`);
        }

        // The probe FAILS as designed: the exact gate every execution below
        // is proven not to trip now trips.
        expect(() => assertProbePassesM6(measurements)).toThrow(
          /must-consider overflow/u,
        );
      } finally {
        db.close();
      }
    });
  });

  for (const fixture of DIAGNOSTIC_FIXTURES) {
    for (const execution of fixture.executions) {
      const label = `${fixture.probeId}/${execution.executionId}`;
      it(`${label} — intervention delivers the recorded baseline packet and reports M1-M12`, async () => {
        const baseline = await runExecution(fixture, execution, 'shadow');
        const intervention = await runExecution(
          fixture,
          execution,
          'intervene',
        );
        try {
          // Baseline delivery is the honest, never-injecting shadow arm.
          expect(baseline.evidence?.delivery).toEqual({
            mode: 'observed',
            injected: false,
          });
          const delivery = intervention.evidence?.delivery;
          if (delivery?.mode !== 'intervened' || !delivery.injected)
            throw new Error(
              `expected an injected intervention delivery for ${label}, got ${JSON.stringify(delivery)}`,
            );

          // E2 + E3 — additive delivery, bound to the exact recorded trace
          // and its hash. Asserted against the model client's captured
          // ModelCompleteInput (`intervention.message`), not the trace alone.
          expect(intervention.message.startsWith(baseline.message)).toBe(true);
          const packetText = packetPortion(
            baseline.message,
            intervention.message,
          );
          expect(packetText.length).toBeGreaterThan(0);
          expect(Buffer.byteLength(packetText, 'utf8')).toBe(
            delivery.renderedBytes,
          );
          expect(
            createHash('sha256').update(packetText, 'utf8').digest('hex'),
          ).toBe(delivery.renderedSha256);
          const trace = getTurnTrace(intervention.db, {
            campaignId: DEFAULT_TEST_CAMPAIGN_ID,
            sessionId: DEFAULT_TEST_SESSION_ID,
            turnId: TURN,
          });
          expect(trace?.retrievedContext).toEqual([intervention.message]);

          // E1 — discovery itself does not change between `shadow` and
          // `intervene`: M1-M9 (and every other recorded measurement field)
          // computed from the intervention evidence deep-equal those computed
          // from the baseline evidence, and M1/M2 equal the pinned
          // RUNTIME_REACH table -- imported, not copied, so this suite and
          // shadowRuntime.test.ts cannot pin different tables.
          const targets = RUNTIME_REACH[label];
          if (targets === undefined)
            throw new Error(`no RUNTIME_REACH entry for ${label}`);
          const mustNotIncludeTargetRefs = fixture.mustNotIncludeTargets.map(
            (target) =>
              target.targetKind === 'adventure-entity'
                ? `${target.moduleId}#${target.entityKind}:${target.entityId}`
                : target.recordKey,
          );
          const requiredFacts = Array.isArray(fixture.requiredRetainedFacts)
            ? fixture.requiredRetainedFacts.map((fact) => ({
                ...(fact.targetRef === undefined
                  ? {}
                  : { targetRef: fact.targetRef }),
                ...(fact.exactSubstring === undefined
                  ? {}
                  : { exactSubstring: fact.exactSubstring }),
                ...(fact.typedPath === undefined
                  ? {}
                  : { typedPath: fact.typedPath }),
                ...(fact.expectedValue === undefined
                  ? {}
                  : { expectedValue: fact.expectedValue }),
              }))
            : [];
          const measureOptions = {
            mustIncludeTargetRefs: Object.keys(targets),
            mustNotIncludeTargetRefs,
            requiredFacts,
          };
          const baselineMeasurements = measureDiscovery(
            requireTrace(baseline.evidence),
            measureOptions,
          );
          const interventionMeasurements = measureDiscovery(
            requireTrace(intervention.evidence),
            measureOptions,
          );
          expect(interventionMeasurements).toEqual(baselineMeasurements);
          expect(interventionMeasurements.m1).toEqual(
            Object.fromEntries(
              Object.entries(targets).map(([key, lost]) => [
                key,
                lost === null,
              ]),
            ),
          );
          expect(interventionMeasurements.m2).toEqual(targets);

          // E10 (first half) — no must-consider overflow occurred, and the
          // gate that would fail the probe over one does not trip.
          expect(interventionMeasurements.m6.overflow).toEqual([]);
          expect(interventionMeasurements.m6.overflowed).toBe(false);
          expect(() =>
            assertProbePassesM6(interventionMeasurements),
          ).not.toThrow();

          // M9, reported explicitly (pinned count) rather than merely
          // non-throwing, and cross-checked against M1: a fact can be
          // "missing" only because its target never reached the packet, never
          // because source prose diverged for a target that DID reach.
          const expectedMeasured = PINNED_M9_MEASURED[label];
          if (expectedMeasured === undefined)
            throw new Error(`no pinned M9 count for ${label}`);
          expect(interventionMeasurements.m9.measured).toBe(expectedMeasured);
          expect(
            interventionMeasurements.m9.missing.every(
              (fact) =>
                fact.targetRef === undefined ||
                interventionMeasurements.m1[fact.targetRef] === false,
            ),
          ).toBe(true);

          // E5 — field-9 exactSubstring facts whose target actually reached
          // the packet must appear, unescaped, in the DELIVERED message. The
          // checked count is pinned and reported so an empty check set (P1,
          // P2, P5's lost targets; P9, P11, P12's absent exactSubstring
          // facts) reads as an explained zero, never a silent green.
          const exactSubstringFacts = requiredFacts.filter(
            (fact) => fact.exactSubstring !== undefined,
          );
          const checkedFacts = exactSubstringFacts.filter(
            (fact) =>
              fact.targetRef !== undefined &&
              interventionMeasurements.m1[fact.targetRef] === true,
          );
          const expectedChecked = PINNED_E5_CHECKED[label];
          if (expectedChecked === undefined)
            throw new Error(`no pinned E5 checked count for ${label}`);
          expect(checkedFacts.length).toBe(expectedChecked);
          for (const fact of checkedFacts)
            expect(intervention.message).toContain(
              fact.exactSubstring as string,
            );

          // E6 — both design section 7.2 worked cases, end to end in the
          // delivered text, each note between its own candidate's heading and
          // the next.
          if (label === 'P3/default') {
            const span = candidateSpan(
              intervention.message,
              'creature:adult-black-dragon',
            );
            expect(span).toContain(
              'The typed save projection omits the source success branch',
            );
            expect(span).toContain('/data/actions/5/mechanics/saves');
            expect(span).toContain(
              'The source describes an area, but no typed mechanics.area projection exists.',
            );
          }
          if (label === 'P4/default') {
            const span = candidateSpan(intervention.message, 'spell:fireball');
            expect(span).toContain(
              'The source describes an area, but no typed mechanics.area projection exists.',
            );
            expect(span.indexOf('### Projection limit')).toBeGreaterThan(
              span.indexOf('### Typed projection'),
            );
            expect(span.indexOf('### Projection limit')).toBeLessThan(
              span.indexOf('### Deterministic capability'),
            );
          }

          // E7 — P12 never launders the removed false-authority record.
          if (label === 'P12/default') {
            expect(interventionMeasurements.m8).toEqual({
              forbiddenPresent: [],
              unattributedPresent: [],
            });
            expect(intervention.message).not.toContain(
              'table:starting-wealth-by-class',
            );
          }

          // E8 (negative half) — P3's fixture declares `none-selected`. The
          // negative form and its full disclaimer are proven through the
          // LIVE delivered message, and every occurrence of the words "no
          // mechanics" / "safe to ignore" anywhere in it is proven to sit
          // inside that disclaiming sentence -- never standing alone as a
          // conclusion.
          if (label === 'P3/default') {
            const span = candidateSpan(
              intervention.message,
              'creature:adult-black-dragon',
            );
            expect(span).toContain('no capability was positively selected');
            expect(span).not.toContain('POSITIVE BOUNDED CONTRACT');
            const disclaimer =
              'This is not a claim that the record has no mechanics, is irrelevant, or is safe to ignore.';
            const disclaimerCount = occurrences(
              intervention.message,
              disclaimer,
            );
            expect(disclaimerCount).toBeGreaterThan(0);
            expect(occurrences(intervention.message, 'no mechanics')).toBe(
              disclaimerCount,
            );
            expect(occurrences(intervention.message, 'safe to ignore')).toBe(
              disclaimerCount,
            );
          }

          // E8 (documented runtime boundary) — P8's real turn cannot
          // preflight the specific operation (see the offline-proof test
          // above for why), so its LIVE delivered packet carries the same
          // negative form, pinned here as an explicit, checked fact rather
          // than a silent difference from the offline suite.
          if (label === 'P8/default') {
            const span = candidateSpan(
              intervention.message,
              'magic-item:ammunition-1-2-or-3',
            );
            expect(span).toContain('no capability was positively selected');
            expect(span).not.toContain('POSITIVE BOUNDED CONTRACT');
          }

          // E9 — campaign rules and rulings, matching what M5 reports as
          // placed, beside their governing source material.
          if (label === 'P7/with-active-ruling') {
            const placed = interventionMeasurements.m5.placed.find(
              (item) => item.governingRecordKey === 'magic-item:cube-of-force',
            );
            if (placed === undefined)
              throw new Error(
                'P7/with-active-ruling recorded no placed ruling',
              );
            const span = candidateSpan(
              intervention.message,
              'magic-item:cube-of-force',
            );
            expect(span).toContain(`identity=${placed.ruleIdentity}`);
            expect(span).toContain('kind=ruling');
            expect(span).toContain('status=');
            expect(span).toContain('scope=');
            expect(span).toContain('provenance=');
            expect(span).toContain('effective position=');
            expect(span).toContain('supersededBy=');
            expect(span).toContain('revokedPosition=');
            expect(span).toContain('- ambiguity id=');
            expect(span).toContain('selected interpretation id=');
          }
          if (label === 'P10/default') {
            const placed = interventionMeasurements.m5.placed.find(
              (item) => item.governingRecordKey === 'spell:fireball',
            );
            if (placed === undefined)
              throw new Error('P10/default recorded no placed house rule');
            const span = candidateSpan(intervention.message, 'spell:fireball');
            expect(span).toContain(`identity=${placed.ruleIdentity}`);
            expect(span).toContain('kind=house-rule');
            expect(span).toContain('status=');
            expect(span).toContain('scope=');
            expect(span).toContain('provenance=');
            expect(span).toContain('effective position=');
            expect(span).toContain('supersededBy=');
            expect(span).toContain('revokedPosition=');
          }

          // E11 — M10, M11, and M12 against the execution's own declared
          // deterministic state effect. Every execution reports M12.
          const runtimeObservations = requireRuntime(intervention.evidence);
          const runtimeMeasurements = measureRuntimeDiscovery(
            requireTrace(intervention.evidence),
            runtimeObservations,
          );
          expect(runtimeMeasurements.m11.auditorAbsent).toBe(true);
          expect(runtimeMeasurements.m11.retries).toBe(0);
          if (fixture.probeId === 'P8') {
            // Discovery runs before the model chooses a tool, so it cannot
            // anticipate the operation: M10 reports the gap, never agreement.
            expect(runtimeMeasurements.m10.comparisons).toEqual([]);
            expect(
              runtimeMeasurements.m10.runtimeInvocationsAbsentFromPacket.map(
                (item) => ({
                  tool: item.tool,
                  recordKey: item.recordKey,
                  operationId: item.operationId,
                }),
              ),
            ).toEqual([
              {
                tool: 'use_item',
                recordKey: 'magic-item:ammunition-1-2-or-3',
                operationId: 'hit-target',
              },
            ]);
          } else {
            expect(
              runtimeMeasurements.m10.comparisons.every(
                (comparison) => comparison.runtimeOutcome === 'not-invoked',
              ),
            ).toBe(true);
            expect(
              runtimeMeasurements.m10.runtimeInvocationsAbsentFromPacket,
            ).toEqual([]);
          }

          const expectedEffect = expectedEffectFor(execution);
          const stateEffect = measureAcceptedStateEffect(
            runtimeObservations,
            expectedEffect,
          );
          expect(stateEffect.agreement).toBe('agreed');
          expect(stateEffect.disagreements).toEqual([]);
          if (fixture.probeId === 'P8')
            expect(stateEffect.acceptedEffects.length).toBeGreaterThan(0);
          else expect(stateEffect.acceptedEffects).toEqual([]);

          // E12 — the explicit per-probe report, holding M1-M12, built and
          // checked structurally rather than left implicit in scattered
          // assertions above.
          const report: ProbeReport = {
            label,
            m1: interventionMeasurements.m1,
            m2: interventionMeasurements.m2,
            m3: interventionMeasurements.m3,
            m4: interventionMeasurements.m4,
            m5: interventionMeasurements.m5,
            m6: interventionMeasurements.m6,
            m7: interventionMeasurements.m7,
            m8: interventionMeasurements.m8,
            m9: interventionMeasurements.m9,
            m10: runtimeMeasurements.m10,
            m11: runtimeMeasurements.m11,
            m12: stateEffect,
          };
          PROBE_REPORTS.push(report);

          expect(intervention.evidence?.modelUsageClaim).toBeNull();
          const forbiddenFieldHits: string[] = [];
          collectForbiddenFieldPaths(report, 'report', forbiddenFieldHits);
          expect(forbiddenFieldHits).toEqual([]);
          // The one allowlisted field is exactly the categorical scope enum,
          // never silently vacuous.
          expect(report.m5.ambiguityCoverage).toMatch(
            /^(all-active|requested-ambiguities)$/u,
          );
          expect(intervention.message).not.toMatch(
            /\b(coverage|completeness|readiness score|\d+\s*%|\d+\s*of\s*\d+\s*rules)\b/iu,
          );
          expect(intervention.message).not.toMatch(
            /\bthe model (?:used|relied on|consulted)\b/iu,
          );
        } finally {
          baseline.db.close();
          intervention.db.close();
        }
      });
    }
  }

  // E12 (aggregate) — a count of probes passing is permitted; a rate over the
  // rules universe is not (design section 13.2). This runs last in file
  // order so PROBE_REPORTS holds every execution's report by the time it
  // runs.
  it('E12 (aggregate) — reports a count of probes passing, never a rate', () => {
    // 12 fixtures author 13 executions: P7 alone authors two. Pinned so a
    // corpus edit that silently drops an execution changes this number.
    expect(PROBE_REPORTS.length).toBe(13);
    const passing = PROBE_REPORTS.filter(
      (report) =>
        !report.m6.overflowed &&
        report.m8.forbiddenPresent.length === 0 &&
        report.m12.agreement === 'agreed',
    ).length;
    // Pinned EXACTLY, not bounded. `passing > 0` would still hold with twelve
    // of the thirteen regressed, which is the "nothing failed looks green"
    // reading design section 13.3 forbids. A count is only evidence when a
    // change to it fails.
    expect(passing).toBe(13);
    // The aggregate itself is checked the same way a per-probe report is: no
    // coverage/readiness/completeness/score/rate field anywhere in it.
    const hits: string[] = [];
    collectForbiddenFieldPaths(
      { passingCount: passing, totalCount: PROBE_REPORTS.length },
      'aggregate',
      hits,
    );
    expect(hits).toEqual([]);
    // M1-M12 are never summed or averaged across probes: nothing above
    // divides `passing` by `PROBE_REPORTS.length`, and this suite computes no
    // such quotient anywhere.
  });
});
