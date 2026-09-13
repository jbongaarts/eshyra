import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  AuditVerdict,
  DiscoveryShadowEvidence,
  ModelClient,
  ModelCompleteInput,
  ModelCompleteResult,
  RunTurnDeps,
  TurnAuditInput,
  TurnAuditor,
} from '../../src/internal.js';
import {
  captureDiscoveryShadow,
  createDefaultToolRegistry,
  getTurnTrace,
  isAcceptedStateMutation,
  measureAcceptedStateEffect,
  measureDiscovery,
  measureRuntimeDiscovery,
  NULL_CAMPAIGN_RULE_SEAM,
  openScene,
  readDiscoveryShadowEvidence,
  runTurn,
  writeCampaignRulesBinding,
} from '../../src/internal.js';
import { DIAGNOSTIC_FIXTURES } from '../diagnostics/index.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_CAMPAIGN_POSITION,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from '../support/db.js';
import { installJhptCampaignRules } from './support/jhptCampaignRules.js';
import { installProbeCampaignState } from './support/runtimeCampaignState.js';
import { CONDITIONAL_STAGES, RUNTIME_REACH } from './support/runtimeReach.js';
import { installScenarioBinding } from './support/scenario.js';

/**
 * Phase 2 permanent evidence for W9 (`eshyra-o9bd.19.11`, design section 12.2):
 * discovery observes REAL turns from the seam between `assembleContext` and
 * `renderContextMessage`, its evidence lands on the existing accepted-turn
 * trace, and every section-13 measurement through M11 is derivable from that
 * recorded evidence without re-running discovery.
 *
 * Every measurement below is read from the trace RE-READ OUT OF SQLITE, never
 * from the in-memory capture, because "derivable from the trace" is the exit
 * criterion and an in-memory object would not test it.
 *
 * Phase 2 acceptance is about the instrumentation, not about probe pass rates:
 * a probe whose runtime turn does not reach its offline target is recorded as
 * exactly that, with the stage that lost it. Design section 13.3 forbids
 * reading "nothing failed" as a pass, so the stage outcomes and the per-probe
 * M1 reach are asserted exactly rather than merely being non-empty.
 */

const TURN = 'w11-discovery-turn';
const AT = '2026-05-20T10:00:00.000Z';
const NARRATION = 'You weigh the situation.';

/** Replays structured provider results, for the native tool transport. */
class StructuredScriptedModel implements ModelClient {
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

class ScriptedModel implements ModelClient {
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

const ACCEPT: AuditVerdict = {
  verdict: 'accept',
  missingRequiredTools: [],
  missingRequiredCalls: [],
  disallowedToolCalls: [],
  reason: '',
  repairInstruction: '',
};

class ScriptedAuditor implements TurnAuditor {
  private index = 0;
  readonly modelId = 'w9-shadow-audit-test';
  readonly seen: TurnAuditInput[] = [];
  constructor(private readonly verdicts: readonly AuditVerdict[]) {}
  audit(input: TurnAuditInput): Promise<AuditVerdict> {
    this.seen.push(input);
    const verdict = this.verdicts[this.index] ?? ACCEPT;
    this.index += 1;
    return Promise.resolve(verdict);
  }
}

const toolCall = (tool: string, args: unknown): string =>
  ['```tool_call', JSON.stringify({ tool, args }), '```'].join('\n');

function seedCampaign(): ReturnType<typeof freshDbWithSession> {
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

function turnInput(playerInput: string) {
  return {
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: TURN,
    playerInput,
    seed: 42,
    at: AT,
  };
}

/** Shadow evidence as it was persisted, re-read from SQLite. */
function recordedEvidence(
  db: ReturnType<typeof freshDbWithSession>,
): DiscoveryShadowEvidence | undefined {
  return readDiscoveryShadowEvidence(
    getTurnTrace(db, {
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      sessionId: DEFAULT_TEST_SESSION_ID,
      turnId: TURN,
    })?.discoveryShadow,
  );
}

/** The recorded observations, or a hard failure — never a silent empty stand-in. */
function requireRuntime(
  evidence: DiscoveryShadowEvidence | undefined,
): NonNullable<DiscoveryShadowEvidence['runtime']> {
  if (evidence?.runtime === undefined)
    throw new Error('shadow evidence recorded no runtime observations');
  return evidence.runtime;
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

// RUNTIME_REACH and CONDITIONAL_STAGES moved to ./support/runtimeReach.js
// (eshyra-o9bd.19.12.4) so this suite and packetIntervention.test.ts import
// one shared table rather than pinning two copies that could silently
// diverge. See that module's header for the table's own rationale.

describe('runtime shadow-mode discovery (ADR 0020 Phase 2)', () => {
  /**
   * The W9 parity guarantee, ported to the mode union (W10, design section
   * 12.3), plus its complement: a parity test that passed under every mode
   * would prove nothing about the one mode that matters. `intervene` is the
   * first mode whose DM input differs from `off` AT ALL, so the second half
   * of this test is the one comparison that must fail to be meaningful.
   */
  it("leaves the DM message byte-identical under 'shadow' and does not under 'intervene'", async () => {
    const run = async (
      discoveryMode: 'off' | 'shadow' | 'intervene',
    ): Promise<{
      seen: ModelCompleteInput[];
      evidence: DiscoveryShadowEvidence | undefined;
    }> => {
      const db = seedCampaign();
      try {
        const model = new ScriptedModel();
        const deps: RunTurnDeps = {
          db,
          model,
          registry: createDefaultToolRegistry(),
          discoveryMode,
        };
        const result = await runTurn(
          deps,
          turnInput('I cast fireball at the goblin sentries.'),
        );
        expect(result.ok).toBe(true);
        return { seen: model.seen, evidence: recordedEvidence(db) };
      } finally {
        db.close();
      }
    };
    const off = await run('off');
    const shadow = await run('shadow');
    const intervene = await run('intervene');

    // Byte-for-byte over the whole model input: system prompt, tool
    // definitions and every message, not just the rendered context.
    expect(JSON.stringify(shadow.seen)).toBe(JSON.stringify(off.seen));
    expect(JSON.stringify(intervene.seen)).not.toBe(JSON.stringify(off.seen));
    // ... and the comparisons are not vacuous: 'shadow' and 'intervene' both
    // really recorded, 'off' really did not, and the delivery each recorded
    // is the honest arm for its own mode.
    expect(off.evidence).toBeUndefined();
    expect(shadow.evidence?.delivery).toEqual({
      mode: 'observed',
      injected: false,
    });
    expect(intervene.evidence?.delivery).toMatchObject({
      mode: 'intervened',
      injected: true,
    });
  });

  it('appends the rendered packet as an exact suffix, and the base message survives as an exact prefix', async () => {
    const run = async (discoveryMode: 'off' | 'intervene') => {
      const db = seedCampaign();
      try {
        const model = new ScriptedModel();
        const result = await runTurn(
          {
            db,
            model,
            registry: createDefaultToolRegistry(),
            discoveryMode,
          },
          turnInput('I cast fireball at the goblin sentries.'),
        );
        expect(result.ok).toBe(true);
        const sent = model.seen[0]?.messages[0];
        if (sent === undefined) throw new Error('the model saw no messages');
        return { message: sent.content, evidence: recordedEvidence(db) };
      } finally {
        db.close();
      }
    };
    const off = await run('off');
    const intervene = await run('intervene');

    // Additive, never rewriting (design section 12.3): the base message the
    // context assembler produced is an exact PREFIX of what the model under
    // `intervene` actually received.
    expect(intervene.message.startsWith(off.message)).toBe(true);
    const remainder = intervene.message.slice(off.message.length);
    // Joined exactly the way `renderContextMessage` joins its own sections.
    expect(remainder.startsWith('\n\n')).toBe(true);
    const packetText = remainder.slice(2);
    expect(packetText.length).toBeGreaterThan(0);

    const delivery = intervene.evidence?.delivery;
    if (delivery?.mode !== 'intervened' || !delivery.injected)
      throw new Error(
        `expected an injected intervention delivery, got ${JSON.stringify(delivery)}`,
      );
    // The remainder IS the rendered packet: bound through the identity
    // `delivery` recorded, not re-rendered independently by this test (design
    // section 12.3's requirement that the injected text is durably recorded
    // exactly once).
    expect(Buffer.byteLength(packetText, 'utf8')).toBe(delivery.renderedBytes);
    expect(createHash('sha256').update(packetText, 'utf8').digest('hex')).toBe(
      delivery.renderedSha256,
    );
  });

  it('records turn_trace.retrieved_context as the message the model actually received, not the base message', async () => {
    const db = seedCampaign();
    try {
      const model = new ScriptedModel();
      const result = await runTurn(
        {
          db,
          model,
          registry: createDefaultToolRegistry(),
          discoveryMode: 'intervene',
        },
        turnInput('I cast fireball at the goblin sentries.'),
      );
      expect(result.ok).toBe(true);
      const sent = model.seen[0]?.messages[0];
      if (sent === undefined) throw new Error('the model saw no messages');
      const trace = getTurnTrace(db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        sessionId: DEFAULT_TEST_SESSION_ID,
        turnId: TURN,
      });
      // Recording a fresh re-render of the base context here — rather than
      // this exact string — would make the trace lie about an intervention
      // turn: the DM received the injected message, not the base one.
      expect(trace?.retrievedContext).toEqual([sent.content]);
    } finally {
      db.close();
    }
  });

  /**
   * F3 (PR #543 review): `retrieved_context` on an AUDIT-RETRY turn.
   *
   * `baseUserMessage` is only every attempt's common prefix. A rejection
   * appends a corrective note, so the accepted attempt's real input is the
   * base message plus that note. Persisting the base message would leave the
   * accepted narration and tool calls describing attempt 2 while the recorded
   * input describes the pre-correction context — a trace that lies about the
   * turn, and one this PR's own comment claimed could not happen.
   *
   * The assertion binds to the string the model was ACTUALLY handed for the
   * accepted attempt (`model.seen`), never to a re-concatenation this test
   * performs, because a reconstruction here would pass even if the production
   * code reconstructed it differently.
   */
  it('records the ACCEPTED attempt input on an intervene turn that retried', async () => {
    const db = seedCampaign();
    try {
      const model = new ScriptedModel([
        'A first answer the auditor rejects.',
        'A second answer the auditor accepts.',
      ]);
      const result = await runTurn(
        {
          db,
          model,
          registry: createDefaultToolRegistry(),
          discoveryMode: 'intervene',
          auditor: new ScriptedAuditor([
            {
              verdict: 'reject',
              missingRequiredTools: ['lookup_rules'],
              missingRequiredCalls: [
                { tool: 'lookup_rules', target: 'spell:fireball' },
              ],
              disallowedToolCalls: [],
              reason: 'ruled on the spell without looking it up',
              repairInstruction: 'look the spell up first',
            },
          ]),
        },
        turnInput('I cast fireball at the goblin sentries.'),
      );
      expect(result.ok).toBe(true);

      // Two primary-DM candidates ran, and their inputs are NOT the same
      // string — otherwise this test would pass without exercising anything.
      expect(model.seen.length).toBeGreaterThanOrEqual(2);
      const first = model.seen[0]?.messages[0]?.content;
      const accepted = model.seen[1]?.messages[0]?.content;
      if (first === undefined || accepted === undefined)
        throw new Error('the model saw fewer than two candidate inputs');
      expect(accepted).not.toBe(first);
      // The retry input is the first attempt's input plus the corrective
      // note, so the first attempt's message is a strict prefix of it.
      expect(accepted.startsWith(first)).toBe(true);

      const trace = getTurnTrace(db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        sessionId: DEFAULT_TEST_SESSION_ID,
        turnId: TURN,
      });
      expect(trace?.retrievedContext).toEqual([accepted]);

      // ... and the packet binding still holds on the retry path: the
      // injected packet sits between the assembled context and the corrective
      // note, and `delivery` still fingerprints exactly it. The packet region
      // is located against a real `off`-mode render of the same turn rather
      // than by re-rendering the packet here, so this checks the production
      // text rather than restating it.
      const evidence = recordedEvidence(db);
      const delivery = evidence?.delivery;
      if (delivery?.mode !== 'intervened' || !delivery.injected)
        throw new Error(
          `expected an injected intervention delivery, got ${JSON.stringify(delivery)}`,
        );
      const bare = seedCampaign();
      let assembled: string;
      try {
        const offModel = new ScriptedModel();
        const offResult = await runTurn(
          {
            db: bare,
            model: offModel,
            registry: createDefaultToolRegistry(),
            discoveryMode: 'off',
          },
          turnInput('I cast fireball at the goblin sentries.'),
        );
        expect(offResult.ok).toBe(true);
        const seen = offModel.seen[0]?.messages[0]?.content;
        if (seen === undefined)
          throw new Error('the off-mode model saw nothing');
        assembled = seen;
      } finally {
        bare.close();
      }
      expect(first.startsWith(`${assembled}\n\n`)).toBe(true);
      const packetText = first.slice(assembled.length + 2);
      expect(Buffer.byteLength(packetText, 'utf8')).toBe(
        delivery.renderedBytes,
      );
      expect(
        createHash('sha256').update(packetText, 'utf8').digest('hex'),
      ).toBe(delivery.renderedSha256);
    } finally {
      db.close();
    }
  });

  it("under 'intervene', a capture failure injects nothing, records the honest delivery arm, and does not fail the turn", async () => {
    const db = seedCampaign();
    try {
      // A registry whose `.get` throws on its FIRST call and behaves normally
      // afterward. Discovery's B1 blocker probe (`blockerRepairs.ts`) is the
      // only caller of `tools.get('lookup_rules')` before `buildSystemPrompt`
      // walks every registered name through the same method, so this fails
      // exactly one thing: the capture's own blockers stage. Everything the
      // rest of the turn needs from the registry — `definitions()`, `list()`,
      // `invoke()` for a ScriptedModel that calls no tools at all — is
      // untouched, so a real turn can reach this failure without the turn
      // itself failing for an unrelated reason.
      const registry = createDefaultToolRegistry();
      const realGet = registry.get.bind(registry);
      let calls = 0;
      registry.get = ((name: string) => {
        calls += 1;
        if (calls === 1) throw new Error('tool registry unavailable');
        return realGet(name);
      }) as typeof realGet;

      const model = new ScriptedModel();
      const result = await runTurn(
        {
          db,
          model,
          registry,
          discoveryMode: 'intervene',
        },
        turnInput('I press on into the dark.'),
      );
      // An observation point that can abort a player's turn is worse than no
      // observation point (shadow.ts's header, applying with more force once
      // the packet is load-bearing): the turn still succeeds.
      expect(result.ok).toBe(true);
      expect(calls).toBeGreaterThan(1);
      const sent = model.seen[0]?.messages[0];
      if (sent === undefined) throw new Error('the model saw no messages');
      // Nothing was injected: the model saw exactly the base message, ending
      // in the player-input section with no appended packet section after it.
      expect(
        sent.content.endsWith('## Player Input\nI press on into the dark.'),
      ).toBe(true);
      const evidence = recordedEvidence(db);
      expect(evidence?.trace).toBeUndefined();
      expect(evidence?.failure).toEqual({
        stage: 'blockers',
        message: 'tool registry unavailable',
      });
      expect(evidence?.delivery).toMatchObject({
        mode: 'intervened',
        injected: false,
      });
      expect(
        evidence?.delivery.mode === 'intervened' && !evidence.delivery.injected
          ? evidence.delivery.reason
          : undefined,
      ).toBe('tool registry unavailable');
    } finally {
      db.close();
    }
  });

  /**
   * The parity proof, over real TOOL ROUNDS.
   *
   * Comparing the whole model-input history with shadow off and on is necessary
   * but not sufficient on its own: if an observation changed the public tool
   * result, BOTH branches would carry the same changed payload and the
   * comparison would false-green. So this suite does two independent things —
   * it compares the two branches, and `shadowCapabilityEvents.test.ts` pins the
   * public `use_item` shapes against the pre-W9 contract directly.
   *
   * A tool round is where a leak would show: `turnLoop` renders fenced results
   * into the next user message and attaches native results to it, and the
   * mechanics auditor projects the same executed calls.
   */
  describe('a real tool round is byte-identical with shadow off and on', () => {
    const AMMO = 'magic-item:ammunition-1-2-or-3';
    const GEM = 'magic-item:gem-of-brightness';

    interface Round {
      readonly label: string;
      /** Seeds the state that decides the readiness/downstream outcome. */
      readonly seed: (db: ReturnType<typeof freshDbWithSession>) => void;
      readonly call: { instanceId: string; operationId: string };
    }

    function held(
      db: ReturnType<typeof freshDbWithSession>,
      id: string,
      packRef: string,
      quantity: number,
    ): void {
      db.prepare(
        `INSERT INTO inventory(
           id, character_id, name, quantity, location, properties_json,
           pack_ref, provenance, session_id, updated_at
         ) VALUES (?, 'pc-1', ?, ?, NULL, '{}', ?, 'test:w9', ?, ?)`,
      ).run(id, `Item ${id}`, quantity, packRef, DEFAULT_TEST_SESSION_ID, AT);
    }

    const ROUNDS: readonly Round[] = [
      {
        label: 'readiness available and the tool succeeds',
        seed: (db) => {
          db.prepare(
            "UPDATE clock SET current_location_id='camp' WHERE id=1",
          ).run();
          held(db, 'ammo-1', AMMO, 20);
        },
        call: { instanceId: 'ammo-1', operationId: 'hit-target' },
      },
      {
        label: 'readiness blocked',
        seed: (db) => {
          held(db, 'gem-1', GEM, 1);
        },
        call: { instanceId: 'gem-1', operationId: 'blinding-beam' },
      },
      {
        label: 'readiness available and an unrelated downstream failure',
        seed: (db) => {
          // No campaign location: the capability reports `available` and the
          // spend then fails placing the unheld remainder.
          held(db, 'ammo-1', AMMO, 20);
        },
        call: { instanceId: 'ammo-1', operationId: 'hit-target' },
      },
    ];

    for (const round of ROUNDS)
      for (const toolProtocol of ['fenced', 'native'] as const)
        it(`${round.label} (${toolProtocol})`, async () => {
          const run = async (discoveryMode: 'off' | 'shadow') => {
            const db = seedCampaign();
            try {
              round.seed(db);
              const model =
                toolProtocol === 'fenced'
                  ? new ScriptedModel([
                      `I use it.\n${toolCall('use_item', round.call)}`,
                      'You lower your hand.',
                    ])
                  : new StructuredScriptedModel([
                      {
                        text: 'I use it.',
                        toolCalls: [
                          {
                            id: 'call-1',
                            name: 'use_item',
                            args: round.call,
                          },
                        ],
                        stopReason: 'tool_use',
                      },
                      { text: 'You lower your hand.', stopReason: 'end_turn' },
                    ]);
              const result = await runTurn(
                {
                  db,
                  model,
                  registry: createDefaultToolRegistry(),
                  discoveryMode,
                },
                { ...turnInput('I use it.'), toolProtocol },
              );
              expect(result.ok).toBe(true);
              return {
                seen: model.seen,
                toolCalls: result.toolCalls,
                observed: recordedEvidence(db) !== undefined,
                events:
                  recordedEvidence(db)?.runtime.capabilityInvocations ?? [],
              };
            } finally {
              db.close();
            }
          };
          const off = await run('off');
          const on = await run('shadow');

          // The DM's whole view: system prompt, tool definitions, and every
          // message including the rendered fenced results and the attached
          // native results.
          expect(JSON.stringify(on.seen)).toBe(JSON.stringify(off.seen));
          // Two model calls, so a tool round really happened.
          expect(on.seen.length).toBe(2);
          // The persisted/returned tool calls the auditor and the ordinary
          // accepted trace read are equally unchanged.
          expect(JSON.stringify(on.toolCalls)).toBe(
            JSON.stringify(off.toolCalls),
          );
          // ... and the comparison is not vacuous: the observation happened.
          expect(on.observed).toBe(true);
          expect(off.observed).toBe(false);
          expect(on.events).toHaveLength(1);
        });
  });

  it('observes a capability invoked through the provider-owned MCP bridge', async () => {
    // All three transports run tools through one `registry.invoke(…, toolCtx)`,
    // so the observer is installed on the provider-owned path too. This drives
    // that path directly rather than assuming the shared seam covers it.
    const db = seedCampaign();
    try {
      db.prepare(
        "UPDATE clock SET current_location_id='camp' WHERE id=1",
      ).run();
      db.prepare(
        `INSERT INTO inventory(
           id, character_id, name, quantity, location, properties_json,
           pack_ref, provenance, session_id, updated_at
         ) VALUES ('ammo-1', 'pc-1', 'Magic Ammunition', 20, NULL, '{}', ?, 'test:w9', ?, ?)`,
      ).run('magic-item:ammunition-1-2-or-3', DEFAULT_TEST_SESSION_ID, AT);
      const mcpModel: ModelClient = {
        complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
          const executed = input.executeTool?.({
            name: 'use_item',
            args: { instanceId: 'ammo-1', operationId: 'hit-target' },
          });
          expect(executed?.ok).toBe(true);
          return Promise.resolve({ text: 'The arrow strikes home.' });
        },
      };
      const result = await runTurn(
        {
          db,
          model: mcpModel,
          registry: createDefaultToolRegistry(),
          discoveryMode: 'shadow',
        },
        turnInput('I loose the arrow.'),
      );
      expect(result.ok).toBe(true);
      expect(
        requireRuntime(recordedEvidence(db)).capabilityInvocations,
      ).toMatchObject([
        {
          tool: 'use_item',
          attempt: 1,
          recordKey: 'magic-item:ammunition-1-2-or-3',
          outcome: 'available',
        },
      ]);
    } finally {
      db.close();
    }
  });

  it('adds no table to the live store', async () => {
    const tables = async (discoveryMode: 'off' | 'shadow' | 'intervene') => {
      const db = seedCampaign();
      try {
        await runTurn(
          {
            db,
            model: new ScriptedModel(),
            registry: createDefaultToolRegistry(),
            discoveryMode,
          },
          turnInput('I look for cover behind the low wall.'),
        );
        return (
          db
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .all() as { name: string }[]
        )
          .map((row) => row.name)
          .sort();
      } finally {
        db.close();
      }
    };
    const off = await tables('off');
    expect(await tables('shadow')).toEqual(off);
    expect(await tables('intervene')).toEqual(off);
  });

  it('runs every authored fixture execution, not one per probe', () => {
    // The Phase 1 probe runner loops `fixture.executions`; taking `[0]` here
    // silently dropped P7's `with-active-ruling` — the corpus's only positive
    // jhpt ruling case — and would drop any execution authored later. The
    // corpus and the reach table must name exactly the same cases.
    const authored = DIAGNOSTIC_FIXTURES.flatMap((fixture) =>
      fixture.executions.map(
        (execution) => `${fixture.probeId}/${execution.executionId}`,
      ),
    );
    expect(authored.length).toBeGreaterThan(DIAGNOSTIC_FIXTURES.length);
    expect([...authored].sort()).toEqual(Object.keys(RUNTIME_REACH).sort());
    // ... and the extra execution is the one that matters: the per-execution
    // M5 assertion below is `toBe(declaredRuling)`, which would pass vacuously
    // if no authored execution declared an active jhpt ruling.
    expect(
      DIAGNOSTIC_FIXTURES.flatMap((fixture) => fixture.executions).filter(
        (execution) =>
          'cases' in execution.expectedCampaignRuleOrRulingState &&
          execution.expectedCampaignRuleOrRulingState.cases.some(
            (item) => item.ambiguityId !== undefined,
          ),
      ),
    ).toHaveLength(1);
  });

  for (const fixture of DIAGNOSTIC_FIXTURES) {
    for (const execution of fixture.executions) {
      const label = `${fixture.probeId}/${execution.executionId}`;
      it(`${label} records shadow evidence for a real turn`, async () => {
        const db = seedCampaign();
        try {
          const rulesPackResolver = installScenarioBinding(fixture, db);
          const installed = installJhptCampaignRules(
            db,
            fixture,
            execution,
            rulesPackResolver,
          );
          const runtimeState = installProbeCampaignState(fixture, db);
          const result = await runTurn(
            {
              db,
              model: new ScriptedModel(),
              registry: createDefaultToolRegistry(),
              discoveryMode: 'shadow',
              ...(rulesPackResolver === undefined
                ? {}
                : { resolveRulesPack: rulesPackResolver }),
              ...runtimeState,
            },
            turnInput(fixture.playerInput),
          );
          expect(result.ok).toBe(true);

          const evidence = recordedEvidence(db);
          expect(evidence?.schema).toBe('discovery-shadow-v2');
          expect(evidence?.failure).toBeUndefined();
          expect(evidence?.modelUsageClaim).toBeNull();
          // The seam is bound to the canonical anchor the turn allocated, not to
          // a fixture's human turn label.
          expect(evidence?.campaignPosition).toMatch(/^cp1~/u);

          // Every blocker is observed at capture time (design section 9.6), so a
          // pre-repair capture can never be read as a baseline.
          expect(
            evidence?.blockerRepairs.map((item) => item.blockerId),
          ).toEqual(['B1', 'B2', 'B3', 'B4', 'B5']);
          for (const observation of evidence?.blockerRepairs ?? [])
            expect(observation.evidence.length).toBeGreaterThan(0);
          const status = Object.fromEntries(
            (evidence?.blockerRepairs ?? []).map((item) => [
              item.blockerId,
              item.status,
            ]),
          );
          expect(status.B1).toBe('repaired');
          expect(status.B4).toBe('repaired');
          expect(status.B5).toBe('repaired');
          // B2 repaired the CLI's handoff to `runTurn`. A capture taken inside
          // core cannot see that: a direct caller could always supply a
          // resolver, before and after the repair. So the status is never
          // `repaired` here, and the capture-local fact — whether adventure
          // context reached this turn — is carried by the scenario seat instead.
          expect(status.B2).toBe('not-discriminable');
          const b2 = evidence?.blockerRepairs.find(
            (item) => item.blockerId === 'B2',
          );
          expect(b2?.evidence).toContain(
            runtimeState.resolveAdventureModule === undefined
              ? 'was not supplied'
              : 'was supplied',
          );
          // B3 discriminates only where an add-on overrides a base record.
          expect(status.B3).toBe(
            fixture.probeId === 'P11' ? 'repaired' : 'not-discriminable',
          );

          // The adventure seat is campaign truth, not a fixture field: the run's
          // module and the clock's location, plus the one pending encounter
          // staged there. Probes without an adventure run record no seat at all.
          expect(evidence?.scenario.adventure).toEqual(
            fixture.probeId === 'P9'
              ? {
                  moduleId: 'eshyra:hollow-beneath-emberfall',
                  locationId: 'loc-watchtower-mouth',
                  encounterId: 'enc-mouth-ambush',
                }
              : undefined,
          );
          expect(evidence?.scenario.adventureSeatNotes).toEqual([]);

          const trace = requireTrace(evidence);
          const targets = RUNTIME_REACH[label];
          const measurements = measureDiscovery(trace, {
            mustIncludeTargetRefs: Object.keys(targets),
            mustNotIncludeTargetRefs: fixture.mustNotIncludeTargets.map(
              (target) =>
                target.targetKind === 'adventure-entity'
                  ? `${target.moduleId}#${target.entityKind}:${target.entityId}`
                  : target.recordKey,
            ),
          });

          // M1 and M2 together: what was reached, and for a miss the exact stage
          // that lost it.
          expect(measurements.m2).toEqual(targets);
          expect(measurements.m1).toEqual(
            Object.fromEntries(
              Object.entries(targets).map(([key, lost]) => [
                key,
                lost === null,
              ]),
            ),
          );
          // M6: a must-consider overflow fails the probe (design section 6.3).
          expect(measurements.m6.overflow).toEqual([]);
          expect(measurements.m6.overflowed).toBe(false);
          // M8: nothing whose provenance is known-false or absent is presented.
          expect(measurements.m8).toEqual({
            forbiddenPresent: [],
            unattributedPresent: [],
          });
          // M3, M4, M7, M9 are computable from the same recorded trace.
          expect(measurements.m7.candidateCount).toBe(
            trace.packet.candidates.length,
          );
          for (const [key, routes] of Object.entries(measurements.m3))
            expect(
              routes.producedAcrossStages,
              `${key} reached a stage with no route`,
            ).toBeGreaterThan(0);

          // Stage accounting: a conditional stage may report `skipped` and must
          // then have produced nothing; no other stage may, and `failed-to-run`
          // is never read as a pass (design section 13.3).
          for (const [name, stage] of Object.entries(measurements.perStage)) {
            expect(['ran', 'skipped', 'failed-to-run']).toContain(
              stage.outcome,
            );
            if (stage.outcome === 'skipped') {
              expect(CONDITIONAL_STAGES.has(name)).toBe(true);
              expect(stage.produced).toEqual([]);
            }
            expect(stage.failedToRun).toBe(stage.outcome === 'failed-to-run');
          }
          // P1's turn is the corpus's recorded runtime miss: the signals stage
          // extracted nothing at all, which section 13.3 names failure-to-run
          // rather than a pass.
          expect(measurements.perStage.signals.failedToRun).toBe(
            fixture.probeId === 'P1',
          );

          // M10 and M11 come from the same recorded evidence.
          const runtime = measureRuntimeDiscovery(
            trace,
            requireRuntime(evidence),
          );
          expect(runtime.m10.runtimeInvocationsAbsentFromPacket).toEqual([]);
          // No auditor was wired for these turns, so M11 says so rather than
          // reporting a green zero.
          expect(runtime.m11.auditorAbsent).toBe(true);
          expect(runtime.m11.retries).toBe(0);

          // M5 bound to THIS execution's declared campaign-rule state, so an
          // execution that authors a jhpt rule or ruling cannot pass on a run
          // that persisted neither. `installed` carries the identities jhpt
          // itself assigned; the fixture invents none of them.
          expect([...measurements.m5.returned].sort()).toEqual(
            [...installed.ruleIdentities].sort(),
          );
          expect(measurements.m5.unplaced).toEqual([]);
          expect(measurements.m5.unqueriedAmbiguityIds).toEqual([]);
          const declaredRuling =
            'cases' in execution.expectedCampaignRuleOrRulingState &&
            execution.expectedCampaignRuleOrRulingState.cases.some(
              (item) => item.ambiguityId !== undefined,
            );
          // A ruling reaches the trace only through the seam's ruling query, so
          // the positive case must show a resolved ambiguity, not just a rule.
          expect(measurements.m5.resolvedAmbiguityIds.length > 0).toBe(
            declaredRuling,
          );
        } finally {
          db.close();
        }
      });
    }
  }

  it('places the jhpt house rule beside its governing source on a real turn', async () => {
    const fixture = DIAGNOSTIC_FIXTURES.find((item) => item.probeId === 'P10');
    if (fixture === undefined) throw new Error('P10 fixture is missing');
    const db = seedCampaign();
    try {
      const installed = installJhptCampaignRules(
        db,
        fixture,
        fixture.executions[0],
      );
      await runTurn(
        {
          db,
          model: new ScriptedModel(),
          registry: createDefaultToolRegistry(),
          discoveryMode: 'shadow',
        },
        turnInput(fixture.playerInput),
      );
      const evidence = recordedEvidence(db);
      const m5 = measureDiscovery(requireTrace(evidence)).m5;
      // The identity comes back from jhpt; discovery invents none of it.
      expect(m5.returned).toEqual(installed.ruleIdentities);
      expect(m5.placed).toEqual([
        {
          ruleIdentity: installed.ruleIdentities[0],
          governingRecordKey: 'spell:fireball',
        },
      ]);
      expect(m5.unplaced).toEqual([]);
      expect(m5.unqueriedAmbiguityIds).toEqual([]);
    } finally {
      db.close();
    }
  });

  // F1 repair (`eshyra-o9bd.19.12.9`, PR #543 review): this used to be titled
  // "records a runtime capability outcome the shadow packet never
  // preflighted" and asserted `m10.comparisons` empty on the theory that
  // shadow discovery runs before the model chooses a tool and so can never
  // anticipate the operation. That theory conflated "which operation the
  // model will invoke" (a real future choice, correctly never predicted) with
  // "which operations the character's held item declares" (a fact about
  // state the campaign already holds). The character's ammunition is a real
  // inventory row before the model runs, so its declared `hit-target`
  // operation is preflighted, and the real invocation now pairs with it.
  it('pairs a runtime capability invocation with the preflight the held item declares', async () => {
    const fixture = DIAGNOSTIC_FIXTURES.find((item) => item.probeId === 'P8');
    if (fixture === undefined) throw new Error('P8 fixture is missing');
    const db = seedCampaign();
    try {
      installProbeCampaignState(fixture, db);
      await runTurn(
        {
          db,
          model: new ScriptedModel([
            `I loose the arrow.\n${toolCall('use_item', {
              instanceId: 'ammunition-stack-1',
              operationId: 'hit-target',
            })}`,
          ]),
          registry: createDefaultToolRegistry(),
          discoveryMode: 'shadow',
        },
        { ...turnInput(fixture.playerInput), toolProtocol: 'fenced' as const },
      );
      const evidence = recordedEvidence(db);
      const runtime = measureRuntimeDiscovery(
        requireTrace(evidence),
        requireRuntime(evidence),
      );
      expect(runtime.m10.comparisons).toEqual([
        {
          candidateKey: 'magic-item:ammunition-1-2-or-3',
          capabilityId: 'assertMagicItemOperationReady',
          packetStatus: 'available',
          runtimeOutcome: 'available',
          agreement: 'agreed',
        },
      ]);
      expect(runtime.m10.runtimeInvocationsAbsentFromPacket).toEqual([]);
      // The record key was resolved through the binding the capture recorded,
      // not re-derived after the fact.
      expect(evidence?.scenario.itemInstances).toEqual([
        {
          instanceId: 'ammunition-stack-1',
          recordKey: 'magic-item:ammunition-1-2-or-3',
        },
      ]);
    } finally {
      db.close();
    }
  });

  it('attributes an auditor retry to missing rule evidence', async () => {
    const db = seedCampaign();
    try {
      await runTurn(
        {
          db,
          model: new ScriptedModel([
            'The ward flares as you touch it.',
            'You check the rule first, then touch the ward.',
          ]),
          registry: createDefaultToolRegistry(),
          discoveryMode: 'shadow',
          auditor: new ScriptedAuditor([
            {
              verdict: 'reject',
              missingRequiredTools: ['lookup_rules'],
              missingRequiredCalls: [
                { tool: 'lookup_rules', target: 'rule:cover' },
              ],
              disallowedToolCalls: [],
              reason: 'asserted a rule without consulting it',
              repairInstruction: 'look the rule up first',
            },
          ]),
        },
        turnInput('I touch the warded low wall.'),
      );
      const evidence = recordedEvidence(db);
      const runtime = measureRuntimeDiscovery(
        requireTrace(evidence),
        requireRuntime(evidence),
      );
      expect(runtime.m11.auditorAbsent).toBe(false);
      expect(runtime.m11.primaryDmCandidates).toBe(2);
      expect(runtime.m11.retries).toBe(1);
      expect(runtime.m11.missingRuleEvidenceRetries).toBe(1);
      expect(runtime.m11.byCause).toEqual({ missing_world_evidence: 1 });
      expect(runtime.m11.retriesWithNoNamedMissingTool).toBe(0);
    } finally {
      db.close();
    }
  });

  /**
   * `captureDiscoveryShadow` is TOTAL: it returns a capture for every failure
   * it can meet, so the orchestrator's observation point cannot destabilize a
   * turn. Each of its three stages is failed in turn below, because a guard
   * that is only exercised on one path is a guard for one path.
   *
   * The runtime-level claim rests on this plus `discoveryBoundary.test.ts`,
   * which pins the capture as the only discovery entry point runtime code has.
   */
  /**
   * A capability invocation belongs to the CAPABILITY boundary; whether the
   * candidate containing it is accepted belongs to candidate acceptance. An
   * audit-rejected attempt's canonical writes roll back — that is the point of
   * the attempt savepoint — but the fact that its readiness preflight executed
   * is not a canonical mutation and cannot roll back with it. M12 is the
   * accepted state-effect measurement; M10 has no accepted-attempt restriction.
   */
  describe('capability events survive an audit-rejected attempt', () => {
    const AMMO = 'magic-item:ammunition-1-2-or-3';

    function seedAmmunition(db: ReturnType<typeof freshDbWithSession>): void {
      db.prepare(
        "UPDATE clock SET current_location_id='camp' WHERE id=1",
      ).run();
      db.prepare(
        `INSERT INTO inventory(
           id, character_id, name, quantity, location, properties_json,
           pack_ref, provenance, session_id, updated_at
         ) VALUES ('ammo-1', 'pc-1', 'Magic Ammunition', 20, NULL, '{}', ?, 'test:w9', ?, ?)`,
      ).run(AMMO, DEFAULT_TEST_SESSION_ID, AT);
    }

    const useAmmunition = `I loose the arrow.\n${toolCall('use_item', {
      instanceId: 'ammo-1',
      operationId: 'hit-target',
    })}`;

    const REJECT: AuditVerdict = {
      verdict: 'reject',
      missingRequiredTools: ['roll'],
      missingRequiredCalls: [{ tool: 'roll', target: 'attack' }],
      disallowedToolCalls: [],
      reason: 'asserted a hit without rolling',
      repairInstruction: 'roll the attack first',
    };

    function quantityOf(db: ReturnType<typeof freshDbWithSession>): number {
      return (
        db
          .prepare("SELECT quantity FROM inventory WHERE id='ammo-1'")
          .get() as { quantity: number }
      ).quantity;
    }

    it("keeps the rejected attempt's invocation after its writes roll back", async () => {
      const db = seedCampaign();
      try {
        seedAmmunition(db);
        const result = await runTurn(
          {
            db,
            model: new ScriptedModel([
              // Attempt 1 really spends the ammunition...
              useAmmunition,
              'The arrow strikes home.',
              // ... attempt 2 is accepted without touching the capability.
              'You steady yourself and take stock instead.',
            ]),
            registry: createDefaultToolRegistry(),
            discoveryMode: 'shadow',
            auditor: new ScriptedAuditor([REJECT]),
          },
          {
            ...turnInput('I loose the arrow.'),
            toolProtocol: 'fenced' as const,
          },
        );
        expect(result.ok).toBe(true);
        // The candidate's canonical mutation rolled back with its savepoint.
        expect(quantityOf(db)).toBe(20);
        expect(result.toolCalls).toEqual([]);

        const evidence = recordedEvidence(db);
        const runtime = requireRuntime(evidence);
        // ... and the observation that its capability ran did not.
        expect(runtime.capabilityInvocations).toEqual([
          {
            tool: 'use_item',
            attempt: 1,
            instanceId: 'ammo-1',
            recordKey: AMMO,
            operationId: 'hit-target',
            capabilityId: 'assertMagicItemOperationReady',
            capabilityRevision: 'derived-magic-item-clauses-v1',
            outcome: 'available',
          },
        ]);
        // Nothing is fabricated for the accepted attempt, which invoked nothing.
        expect(
          runtime.capabilityInvocations.filter((item) => item.attempt === 2),
        ).toEqual([]);
        // The canonical audit lifecycle: one rejected candidate, then the
        // acceptance. No flag, no attempt numbering, nothing to disagree with.
        expect(runtime.audit).toMatchObject({
          auditor: 'present',
          outcome: { disposition: 'accepted' },
        });
        expect(
          runtime.audit.auditor === 'present' ? runtime.audit.retries : [],
        ).toHaveLength(1);

        // M10 sees the event. F1 repair (`eshyra-o9bd.19.12.9`): the held
        // ammunition is genuine pre-model state, so the packet preflights its
        // declared `hit-target` operation regardless of which attempt later
        // invokes it, and attempt 1's invocation pairs with that preflight in
        // agreement even though its own canonical writes rolled back — the
        // capability event is not a canonical mutation and does not roll back
        // with it (the comment above this `describe` block).
        const m10 = measureRuntimeDiscovery(
          requireTrace(evidence),
          runtime,
        ).m10;
        expect(m10.comparisons).toEqual([
          {
            candidateKey: AMMO,
            capabilityId: 'assertMagicItemOperationReady',
            packetStatus: 'available',
            runtimeOutcome: 'available',
            agreement: 'agreed',
          },
        ]);
        expect(m10.runtimeInvocationsAbsentFromPacket).toEqual([]);
      } finally {
        db.close();
      }
    });

    it('retains one event per attempt when both attempts invoke the same subject', async () => {
      const db = seedCampaign();
      try {
        seedAmmunition(db);
        const result = await runTurn(
          {
            db,
            model: new ScriptedModel([
              useAmmunition,
              'The arrow strikes home.',
              useAmmunition,
              'I rolled first: the arrow strikes home.',
            ]),
            registry: createDefaultToolRegistry(),
            discoveryMode: 'shadow',
            auditor: new ScriptedAuditor([REJECT]),
          },
          {
            ...turnInput('I loose the arrow.'),
            toolProtocol: 'fenced' as const,
          },
        );
        expect(result.ok).toBe(true);
        // Only the accepted attempt's spend survives.
        expect(quantityOf(db)).toBe(19);
        const runtime = requireRuntime(recordedEvidence(db));
        // Two real invocations, retained individually and attributed to their
        // own attempts. Collapsing them would erase a real event.
        expect(
          runtime.capabilityInvocations.map((item) => ({
            attempt: item.attempt,
            recordKey: item.recordKey,
            outcome: item.outcome,
          })),
        ).toEqual([
          { attempt: 1, recordKey: AMMO, outcome: 'available' },
          { attempt: 2, recordKey: AMMO, outcome: 'available' },
        ]);
      } finally {
        db.close();
      }
    });
  });

  describe('a failed capture is recorded, never raised', () => {
    const captureInput = (db: ReturnType<typeof freshDbWithSession>) => ({
      db,
      campaignPosition: DEFAULT_TEST_CAMPAIGN_POSITION,
      capturedAt: AT,
      playerInput: 'I press on into the dark.',
      stateFields: {},
      itemInstances: [],
      campaignRuleSeam: NULL_CAMPAIGN_RULE_SEAM,
      tools: createDefaultToolRegistry(),
    });

    it('records an unresolvable rules binding at the stack stage', () => {
      const db = freshDbWithSession();
      try {
        writeCampaignRulesBinding(db, {
          base: {
            systemId: 'not-bundled',
            packId: 'rules:absent',
            version: '1.0',
          },
          addons: [],
          resolvedAt: AT,
        });
        const capture = captureDiscoveryShadow({
          ...captureInput(db),
          resolveRulesPack: () => undefined,
        });
        expect(capture.trace).toBeUndefined();
        expect(capture.failure?.stage).toBe('stack');
        expect(capture.failure?.message).toContain('rules:absent');
        // Nothing was observable about the blockers, and the capture says so
        // rather than reporting five repaired ones over a stack it never had.
        expect(capture.blockerRepairs).toEqual([]);
      } finally {
        db.close();
      }
    });

    it('records a failing blocker probe at the blockers stage', () => {
      const db = freshDbWithSession();
      try {
        const capture = captureDiscoveryShadow({
          ...captureInput(db),
          tools: {
            get: () => {
              throw new Error('tool registry unavailable');
            },
          },
        });
        expect(capture.trace).toBeUndefined();
        expect(capture.failure).toEqual({
          stage: 'blockers',
          message: 'tool registry unavailable',
        });
      } finally {
        db.close();
      }
    });

    it('records a failing seam query at the discovery stage', () => {
      const db = freshDbWithSession();
      try {
        const capture = captureDiscoveryShadow({
          ...captureInput(db),
          playerInput: 'I cast fireball.',
          // What the real seam does when queried at a position it is not bound
          // to: it refuses rather than answering for the wrong chronology.
          campaignRuleSeam: {
            activeRulesAtPosition: () => {
              throw new Error(
                'campaign rule seam is bound to another position',
              );
            },
            activeRulingsForAmbiguities: () => [],
          },
        });
        expect(capture.trace).toBeUndefined();
        expect(capture.failure?.stage).toBe('discovery');
        // The blockers were observed before the failure and are kept.
        expect(capture.blockerRepairs.map((item) => item.blockerId)).toEqual([
          'B1',
          'B2',
          'B3',
          'B4',
          'B5',
        ]);
      } finally {
        db.close();
      }
    });
  });

  it('reads the adventure source once, and never a second time for the shadow', async () => {
    const fixture = DIAGNOSTIC_FIXTURES.find((item) => item.probeId === 'P9');
    if (fixture === undefined) throw new Error('P9 fixture is missing');

    // A resolver that answers once and then refuses. Nothing contracts a
    // caller-supplied resolver to be idempotent, and before the per-turn memo
    // the shadow capture called it a SECOND time — so enabling the observation
    // could abort a turn that succeeds with it off, or persist evidence about
    // a different module than the DM context was built from.
    const run = async (discoveryMode: 'off' | 'shadow') => {
      const db = seedCampaign();
      try {
        const seated = installProbeCampaignState(fixture, db);
        if (seated.resolveAdventureModule === undefined)
          throw new Error('P9 must seat an adventure run');
        let calls = 0;
        const resolveAdventureModule = (moduleId: string) => {
          calls += 1;
          if (calls > 1)
            throw new Error('adventure module source is no longer readable');
          return seated.resolveAdventureModule?.(moduleId);
        };
        const model = new ScriptedModel();
        const result = await runTurn(
          {
            db,
            model,
            registry: createDefaultToolRegistry(),
            discoveryMode,
            resolveAdventureModule,
          },
          turnInput(fixture.playerInput),
        );
        expect(result.ok).toBe(true);
        return { seen: model.seen, calls, evidence: recordedEvidence(db) };
      } finally {
        db.close();
      }
    };

    const off = await run('off');
    const on = await run('shadow');

    expect(on.calls).toBe(1);
    expect(on.calls).toBe(off.calls);
    expect(JSON.stringify(on.seen)).toBe(JSON.stringify(off.seen));
    // The evidence describes the source the real turn assembled from.
    expect(on.evidence?.scenario.adventureModuleResolved).toBe(true);
    expect(on.evidence?.scenario.adventure?.moduleId).toBe(
      'eshyra:hollow-beneath-emberfall',
    );
    expect(on.evidence?.failure).toBeUndefined();
  });

  it('survives a live inventory row whose pack ref does not resolve', async () => {
    const db = seedCampaign();
    try {
      db.prepare(
        `INSERT INTO inventory(
           id, character_id, name, quantity, location, properties_json,
           pack_ref, provenance, session_id, updated_at
         ) VALUES (?, 'pc-1', ?, 1, NULL, '{}', ?, 'test:w9', ?, ?)`,
      ).run(
        'broken-relic',
        'Unidentified Relic',
        'magic-item:absent-from-this-stack',
        DEFAULT_TEST_SESSION_ID,
        AT,
      );
      const result = await runTurn(
        {
          db,
          model: new ScriptedModel(),
          registry: createDefaultToolRegistry(),
          discoveryMode: 'shadow',
        },
        turnInput('I turn the relic over in my hands.'),
      );
      expect(result.ok).toBe(true);
      const evidence = recordedEvidence(db);
      expect(evidence?.failure).toBeUndefined();
      // The unresolvable binding is reported by the stage that met it, not
      // turned into a crash and not silently dropped.
      expect(requireTrace(evidence).candidates.unresolvedTargets).toContain(
        'magic-item:absent-from-this-stack',
      );
    } finally {
      db.close();
    }
  });

  /**
   * W10 (`eshyra-o9bd.19.12`) evidence for the accepted deterministic state
   * effect — the canonical event **M12** compares against a fixture
   * expectation (design section 13.1, Erratum 1 in section 9.6).
   *
   * The subject is what the turn ACCEPTED, which is a different fact from what
   * it attempted. A rejected attempt's canonical writes roll back with its
   * savepoint, and the effect record must roll back with them — the exact
   * opposite of the capability invocation above, which survives because a
   * preflight that ran is not a canonical mutation. Both facts live in the same
   * evidence and are asserted against the same turn so the distinction cannot
   * quietly collapse.
   */
  describe('accepted deterministic state effects reach M12', () => {
    const AMMO = 'magic-item:ammunition-1-2-or-3';

    function seedAmmunition(db: ReturnType<typeof freshDbWithSession>): void {
      db.prepare(
        "UPDATE clock SET current_location_id='camp' WHERE id=1",
      ).run();
      db.prepare(
        `INSERT INTO inventory(
           id, character_id, name, quantity, location, properties_json,
           pack_ref, provenance, session_id, updated_at
         ) VALUES ('ammo-1', 'pc-1', 'Magic Ammunition', 20, NULL, '{}', ?, 'test:w10', ?, ?)`,
      ).run(AMMO, DEFAULT_TEST_SESSION_ID, AT);
    }

    const useAmmunition = `I loose the arrow.\n${toolCall('use_item', {
      instanceId: 'ammo-1',
      operationId: 'hit-target',
    })}`;

    const REJECT: AuditVerdict = {
      verdict: 'reject',
      missingRequiredTools: ['roll'],
      missingRequiredCalls: [{ tool: 'roll', target: 'attack' }],
      disallowedToolCalls: [],
      reason: 'asserted a hit without rolling',
      repairInstruction: 'roll the attack first',
    };

    // E1 — a turn that mutates nothing records an EMPTY set, not an absent one.
    it('records an empty accepted set for a turn that mutates nothing', async () => {
      const db = seedCampaign();
      try {
        const result = await runTurn(
          {
            db,
            model: new ScriptedModel(),
            registry: createDefaultToolRegistry(),
            discoveryMode: 'shadow',
          },
          turnInput('I look around the camp.'),
        );
        expect(result.ok).toBe(true);
        const runtime = requireRuntime(recordedEvidence(db));
        // The empty array is a real observation. An absent field would make
        // "the turn changed nothing" and "nobody recorded anything" the same
        // value, which is the green-looking nothing section 13.3 forbids.
        expect(runtime.stateEffects).toEqual([]);
        expect(
          measureAcceptedStateEffect(runtime, { expectation: 'none' })
            .agreement,
        ).toBe('agreed');
      } finally {
        db.close();
      }
    });

    // E1 — a real accepted mutation is recorded with tool, attempt and ordinal.
    it('records the accepted mutation with its tool, attempt and ordinal', async () => {
      const db = seedCampaign();
      try {
        seedAmmunition(db);
        const result = await runTurn(
          {
            db,
            model: new ScriptedModel([
              useAmmunition,
              'The arrow strikes home.',
            ]),
            registry: createDefaultToolRegistry(),
            discoveryMode: 'shadow',
          },
          {
            ...turnInput('I loose the arrow.'),
            toolProtocol: 'fenced' as const,
          },
        );
        expect(result.ok).toBe(true);
        const runtime = requireRuntime(recordedEvidence(db));
        expect(runtime.stateEffects).toEqual([
          {
            attempt: 1,
            ordinal: 0,
            tool: 'use_item',
            args: { instanceId: 'ammo-1', operationId: 'hit-target' },
          },
        ]);
      } finally {
        db.close();
      }
    });

    // E2 — the load-bearing case: a rolled-back attempt contributes nothing.
    it("drops the rejected attempt's mutation and keeps the accepted attempt's", async () => {
      const db = seedCampaign();
      try {
        seedAmmunition(db);
        const result = await runTurn(
          {
            db,
            model: new ScriptedModel([
              // Attempt 1 spends the ammunition and is rejected...
              useAmmunition,
              'The arrow strikes home.',
              // ... attempt 2 spends it again and is accepted.
              useAmmunition,
              'I rolled first: the arrow strikes home.',
            ]),
            registry: createDefaultToolRegistry(),
            discoveryMode: 'shadow',
            auditor: new ScriptedAuditor([REJECT]),
          },
          {
            ...turnInput('I loose the arrow.'),
            toolProtocol: 'fenced' as const,
          },
        );
        expect(result.ok).toBe(true);
        const runtime = requireRuntime(recordedEvidence(db));
        // ONE effect, attributed to the attempt that was accepted. The
        // capability invocations on the same turn show TWO, because a preflight
        // that executed is not a canonical write and does not roll back.
        expect(runtime.stateEffects).toEqual([
          {
            attempt: 2,
            ordinal: 0,
            tool: 'use_item',
            args: { instanceId: 'ammo-1', operationId: 'hit-target' },
          },
        ]);
        expect(
          runtime.capabilityInvocations.map((item) => item.attempt),
        ).toEqual([1, 2]);
      } finally {
        db.close();
      }
    });

    // E2 — a rejected attempt whose replacement mutates nothing records none.
    it('records no effect when the accepted attempt mutates nothing', async () => {
      const db = seedCampaign();
      try {
        seedAmmunition(db);
        const result = await runTurn(
          {
            db,
            model: new ScriptedModel([
              useAmmunition,
              'The arrow strikes home.',
              'You steady yourself and take stock instead.',
            ]),
            registry: createDefaultToolRegistry(),
            discoveryMode: 'shadow',
            auditor: new ScriptedAuditor([REJECT]),
          },
          {
            ...turnInput('I loose the arrow.'),
            toolProtocol: 'fenced' as const,
          },
        );
        expect(result.ok).toBe(true);
        const runtime = requireRuntime(recordedEvidence(db));
        expect(runtime.stateEffects).toEqual([]);
        // ... while the rejected attempt's preflight is still on the record.
        expect(
          runtime.capabilityInvocations.map((item) => item.attempt),
        ).toEqual([1]);
      } finally {
        db.close();
      }
    });

    /**
     * E3 — ONE predicate governs both the turn trace and M12.
     *
     * `spend_spell_slot` succeeds while changing nothing when it reports
     * `spent: false`, and the turn trace has always excluded that case. Two
     * copies of that rule would be two things that can drift, and a drift means
     * M12 and `accepted_state_delta` would describe the same turn differently.
     */
    it('shares the accepted-mutation predicate with the turn trace', () => {
      const call = (
        tool: string,
        mutates: boolean,
        result: { ok: boolean; data?: unknown },
      ) =>
        ({
          tool,
          args: {},
          mutates,
          result: result.ok
            ? { ok: true, data: result.data ?? {} }
            : { ok: false, code: 'x', message: 'x' },
        }) as unknown as Parameters<typeof isAcceptedStateMutation>[0];

      expect(
        isAcceptedStateMutation(call('adjust_hp', true, { ok: true })),
      ).toBe(true);
      expect(
        isAcceptedStateMutation(call('adjust_hp', false, { ok: true })),
      ).toBe(false);
      expect(
        isAcceptedStateMutation(call('adjust_hp', true, { ok: false })),
      ).toBe(false);
      expect(
        isAcceptedStateMutation(
          call('spend_spell_slot', true, { ok: true, data: { spent: false } }),
        ),
      ).toBe(false);
      expect(
        isAcceptedStateMutation(
          call('spend_spell_slot', true, { ok: true, data: { spent: true } }),
        ),
      ).toBe(true);
    });

    // E3 — and the two consumers agree over a REAL turn, not only in the unit.
    it('records one effect per accepted-state-delta entry on a real turn', async () => {
      const db = seedCampaign();
      try {
        seedAmmunition(db);
        const result = await runTurn(
          {
            db,
            model: new ScriptedModel([
              useAmmunition,
              'The arrow strikes home.',
            ]),
            registry: createDefaultToolRegistry(),
            discoveryMode: 'shadow',
          },
          {
            ...turnInput('I loose the arrow.'),
            toolProtocol: 'fenced' as const,
          },
        );
        expect(result.ok).toBe(true);
        const trace = getTurnTrace(db, {
          campaignId: DEFAULT_TEST_CAMPAIGN_ID,
          sessionId: DEFAULT_TEST_SESSION_ID,
          turnId: TURN,
        });
        const runtime = requireRuntime(recordedEvidence(db));
        expect(runtime.stateEffects).toHaveLength(
          trace?.acceptedStateDelta.length ?? -1,
        );
      } finally {
        db.close();
      }
    });

    /**
     * E6 — P8's M12, end to end, against the fixture's OWN declared
     * operations (design section 11.2, Amendment D).
     *
     * The expectation is read from the corpus rather than restated here: a
     * measurement proven against a locally written expectation would prove
     * agreement with this test, not with the fixture.
     */
    it('agrees with the P8 fixture expectation over a real turn', async () => {
      const fixture = DIAGNOSTIC_FIXTURES.find((item) => item.probeId === 'P8');
      if (fixture === undefined) throw new Error('P8 fixture is missing');
      const expected = fixture.executions[0].expectedDeterministicStateEffect;
      if (!('operations' in expected))
        throw new Error('P8 declares no deterministic state effect');

      const db = seedCampaign();
      try {
        seedAmmunition(db);
        const result = await runTurn(
          {
            db,
            model: new ScriptedModel([
              `I loose the arrow.\n${toolCall('use_item', {
                instanceId: 'ammo-1',
                operationId: 'hit-target',
              })}`,
              'The arrow strikes home.',
            ]),
            registry: createDefaultToolRegistry(),
            discoveryMode: 'shadow',
          },
          {
            ...turnInput(fixture.playerInput),
            toolProtocol: 'fenced' as const,
          },
        );
        expect(result.ok).toBe(true);
        const runtime = requireRuntime(recordedEvidence(db));
        // The fixture pins `instanceId: ammunition-stack-1`, which is the
        // instance identity the OFFLINE scenario declares; this runtime turn
        // seeds its own row. Only the operation identity is comparable across
        // both, so the probe is measured on the operation the fixture names.
        const measured = measureAcceptedStateEffect(runtime, {
          expectation: 'effect',
          operations: expected.operations.map((operation) => ({
            tool: operation.tool,
            args: { operationId: operation.args?.operationId },
          })),
        });
        expect(measured.agreement).toBe('agreed');
        expect(measured.disagreements).toEqual([]);
      } finally {
        db.close();
      }
    });
  });
});
