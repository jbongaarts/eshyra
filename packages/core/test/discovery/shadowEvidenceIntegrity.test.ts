import { describe, expect, it } from 'vitest';
import type {
  CampaignRulesPackResolver,
  DiscoveryShadowEvidence,
  ProjectedDiscoveryTrace,
  RulesPack,
  RuntimeCapabilityInvocation,
  TraceJsonValue,
} from '../../src/internal.js';
import {
  captureDiscoveryShadow,
  completeDiscoveryShadowEvidence,
  createDefaultToolRegistry,
  createSeededRng,
  DiscoveryShadowSchemaError,
  encodeDiscoveryShadowEvidence,
  getTurnTrace,
  MAGIC_ITEM_OPERATION_READINESS_CAPABILITY,
  measureRuntimeDiscovery,
  NULL_CAMPAIGN_RULE_SEAM,
  observeRuntimeCapabilityInvocations,
  readDiscoveryShadowEvidence,
  recordTurnTrace,
} from '../../src/internal.js';
import {
  CURSED_ATTUNEMENT_OVERRIDDEN_ITEM_REF,
  installCursedAttunementAddon,
} from '../support/cursedAttunementAddon.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_CAMPAIGN_POSITION,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from '../support/db.js';

const AT = '2026-05-20T10:00:00.000Z';
const AMMO = 'magic-item:ammunition-1-2-or-3';
/** No attunement, and `blinding-beam` is readiness-blocked in the SRD pack. */
const CUBE = 'magic-item:cube-of-force';
const GEM = 'magic-item:gem-of-brightness';
const BLOCKED_OPERATION = 'blinding-beam';
const CAPABILITY_ID = MAGIC_ITEM_OPERATION_READINESS_CAPABILITY.operationId;
const CAPABILITY_REVISION = MAGIC_ITEM_OPERATION_READINESS_CAPABILITY.revision;

/**
 * A REAL capture, so the packet side of every M10 case below is the packet the
 * pipeline actually builds rather than a hand-written stand-in. The scenario
 * mirrors P8's: an item instance bound to a magic-item record, with the
 * operation and variant the capability-preflight route reads.
 */
function captureWithPreflight(
  db: ReturnType<typeof freshDbWithSession>,
  variantId: string,
): DiscoveryShadowEvidence {
  const capture = captureDiscoveryShadow({
    db,
    campaignPosition: DEFAULT_TEST_CAMPAIGN_POSITION,
    capturedAt: AT,
    playerInput: 'I fire this piece of magic ammunition and hit the target.',
    stateFields: {
      inventoryInstance: 'ammunition-stack-1',
      operationId: 'hit-target',
      variantId,
    },
    itemInstances: [
      { instanceId: 'ammunition-stack-1', recordKey: AMMO, variantId },
    ],
    campaignRuleSeam: NULL_CAMPAIGN_RULE_SEAM,
    tools: createDefaultToolRegistry(),
  });
  return completeDiscoveryShadowEvidence(capture, {
    toolCalls: [],
    auditAttempts: [],
  });
}

/**
 * A capture whose packet preflights one specific item operation, built by the
 * real pipeline from the same scenario shape the offline probes use.
 */
function captureForOperation(
  db: ReturnType<typeof freshDbWithSession>,
  itemRecord: string,
  operationId: string,
  bindings: readonly {
    instanceId: string;
    recordKey: string;
    variantId?: string;
  }[],
): DiscoveryShadowEvidence {
  return completeDiscoveryShadowEvidence(
    captureDiscoveryShadow({
      db,
      campaignPosition: DEFAULT_TEST_CAMPAIGN_POSITION,
      capturedAt: AT,
      playerInput: 'I level the gem and fire.',
      stateFields: { itemRecord, operationId },
      itemInstances: bindings,
      campaignRuleSeam: NULL_CAMPAIGN_RULE_SEAM,
      tools: createDefaultToolRegistry(),
    }),
    { toolCalls: [], auditAttempts: [] },
  );
}

function packetPreflight(trace: ProjectedDiscoveryTrace): {
  key: string;
  variantId?: string;
  status: string;
} {
  const candidate = trace.packet.packet.candidates.find(
    (item) => item.capability !== undefined,
  );
  if (candidate?.capability === undefined)
    throw new Error('the capture produced no capability preflight');
  return {
    key: candidate.identity.key,
    ...(candidate.capability.variantId === undefined
      ? {}
      : { variantId: candidate.capability.variantId }),
    status: candidate.capability.status,
  };
}

function invocation(
  overrides: Partial<RuntimeCapabilityInvocation> = {},
): RuntimeCapabilityInvocation {
  return {
    tool: 'use_item',
    instanceId: 'ammunition-stack-1',
    operationId: 'hit-target',
    recordKey: AMMO,
    subjectSource: 'runtime-result',
    capabilityId: CAPABILITY_ID,
    capabilityRevision: CAPABILITY_REVISION,
    outcome: 'available',
    ...overrides,
  };
}

describe('M10 capability identity', () => {
  it('reads the capability event the runtime reported, not the pre-model binding', () => {
    // A successful `use_item` carries the preflight event it ran through. The
    // pre-model binding disagrees on purpose: if the snapshot were used, the
    // observation would name the stale variant.
    expect(
      observeRuntimeCapabilityInvocations(
        [
          {
            tool: 'use_item',
            args: {
              instanceId: 'ammunition-stack-1',
              operationId: 'hit-target',
            },
            result: {
              ok: true,
              data: {
                packRef: AMMO,
                variantId: '2',
                operationId: 'hit-target',
                capabilityPreflight: {
                  status: 'available',
                  capabilityId: CAPABILITY_ID,
                  revision: CAPABILITY_REVISION,
                  subject: {
                    recordKey: AMMO,
                    variantId: '2',
                    operationId: 'hit-target',
                  },
                },
              },
            },
          },
        ],
        [{ instanceId: 'ammunition-stack-1', recordKey: AMMO, variantId: '1' }],
      ),
    ).toEqual([
      {
        tool: 'use_item',
        instanceId: 'ammunition-stack-1',
        operationId: 'hit-target',
        recordKey: AMMO,
        variantId: '2',
        subjectSource: 'runtime-result',
        capabilityId: CAPABILITY_ID,
        capabilityRevision: CAPABILITY_REVISION,
        outcome: 'available',
      },
    ]);
  });

  it('labels a fallback to the pre-model binding when the event names no subject', () => {
    const observed = observeRuntimeCapabilityInvocations(
      [
        {
          tool: 'use_item',
          args: { instanceId: 'ammunition-stack-1', operationId: 'hit-target' },
          result: {
            ok: false,
            code: 'item_error',
            message: 'blocked',
            data: { status: 'blocked', capabilityId: CAPABILITY_ID },
          },
        },
      ],
      [{ instanceId: 'ammunition-stack-1', recordKey: AMMO, variantId: '1' }],
    );
    // The event is real, so it is recorded — but its subject is not proved,
    // and the snapshot standing in for it is labelled, so M10 refuses it.
    expect(observed[0]).toMatchObject({
      subjectSource: 'pre-model-binding',
      variantId: '1',
      capabilityId: CAPABILITY_ID,
      outcome: 'blocked',
    });
  });

  it('does not pair one variant with another variant of the same record', () => {
    const db = freshDbWithSession();
    try {
      const evidence = captureWithPreflight(db, '1');
      const trace = evidence.trace as ProjectedDiscoveryTrace;
      const preflight = packetPreflight(trace);
      expect(preflight.key).toBe(AMMO);
      expect(preflight.variantId).toBe('1');

      // Same record, same operation, DIFFERENT variant. The old matcher paired
      // these and would have reported an agreement between two subjects with
      // possibly different readiness.
      const measured = measureRuntimeDiscovery(trace, {
        capabilityInvocations: [invocation({ variantId: '2' })],
        auditAttempts: [],
      });
      expect(measured.m10.comparisons).toEqual([
        {
          candidateKey: AMMO,
          capabilityId: expect.any(String),
          packetStatus: preflight.status,
          runtimeOutcome: 'not-invoked',
          agreement: 'not-comparable',
          incomparableBecause: 'not-invoked',
        },
      ]);
      // The unmatched runtime outcome is still reported, not discarded.
      expect(
        measured.m10.runtimeInvocationsAbsentFromPacket.map((i) => i.variantId),
      ).toEqual(['2']);
    } finally {
      db.close();
    }
  });

  it('compares only when the runtime reported the subject itself', () => {
    const db = freshDbWithSession();
    try {
      const trace = captureWithPreflight(db, '1')
        .trace as ProjectedDiscoveryTrace;
      const fromRuntime = measureRuntimeDiscovery(trace, {
        capabilityInvocations: [invocation({ variantId: '1' })],
        auditAttempts: [],
      });
      expect(fromRuntime.m10.comparisons[0].agreement).not.toBe(
        'not-comparable',
      );
      expect(fromRuntime.m10.runtimeInvocationsAbsentFromPacket).toEqual([]);

      const fromSnapshot = measureRuntimeDiscovery(trace, {
        capabilityInvocations: [
          invocation({ variantId: '1', subjectSource: 'pre-model-binding' }),
        ],
        auditAttempts: [],
      });
      expect(fromSnapshot.m10.comparisons[0]).toMatchObject({
        agreement: 'not-comparable',
        incomparableBecause: 'runtime-subject-identity-not-reported',
      });
    } finally {
      db.close();
    }
  });

  it('refuses to compare across capability identities or revisions', () => {
    const db = freshDbWithSession();
    try {
      const trace = captureWithPreflight(db, '1')
        .trace as ProjectedDiscoveryTrace;
      // Same subject, a different bounded commitment. Agreement here would be
      // agreement about nothing: two preflights over one subject can be two
      // different capabilities, or two revisions of one.
      for (const [reason, overrides] of [
        [
          'capability-identity-mismatch',
          { capabilityId: 'someOtherCapability' },
        ],
        ['capability-identity-mismatch', { capabilityRevision: 'v99' }],
        ['capability-identity-not-reported', { capabilityId: undefined }],
        ['capability-identity-not-reported', { capabilityRevision: undefined }],
      ] as const) {
        const observed = invocation({ variantId: '1', ...overrides });
        expect(
          measureRuntimeDiscovery(trace, {
            capabilityInvocations: [observed],
            auditAttempts: [],
          }).m10.comparisons[0],
          `${reason} for ${JSON.stringify(overrides)}`,
        ).toMatchObject({
          agreement: 'not-comparable',
          incomparableBecause: reason,
        });
      }
      // The control: the same observation with matching identity compares.
      expect(
        measureRuntimeDiscovery(trace, {
          capabilityInvocations: [invocation({ variantId: '1' })],
          auditAttempts: [],
        }).m10.comparisons[0].agreement,
      ).not.toBe('not-comparable');
    } finally {
      db.close();
    }
  });

  it('refuses to compare a status that evaluated nothing', () => {
    const db = freshDbWithSession();
    try {
      const real = captureWithPreflight(db, '1')
        .trace as ProjectedDiscoveryTrace;
      // The offline `not-evaluated-offline` status: a declaration was carried
      // through but no readiness derivation ran, so there is no result to
      // agree or disagree with, however the runtime turned out.
      const trace = {
        ...real,
        packet: {
          ...real.packet,
          packet: {
            ...real.packet.packet,
            candidates: real.packet.packet.candidates.map((candidate) =>
              candidate.capability === undefined
                ? candidate
                : {
                    ...candidate,
                    capability: {
                      ...candidate.capability,
                      status: 'not-evaluated-offline' as const,
                    },
                  },
            ),
          },
        },
      };
      expect(
        measureRuntimeDiscovery(trace, {
          capabilityInvocations: [invocation({ variantId: '1' })],
          auditAttempts: [],
        }).m10.comparisons[0],
      ).toMatchObject({
        agreement: 'not-comparable',
        incomparableBecause: 'packet-status-not-evaluated-offline',
      });
    } finally {
      db.close();
    }
  });

  it('refuses to pick between two invocations of the same subject', () => {
    const db = freshDbWithSession();
    try {
      const trace = captureWithPreflight(db, '1')
        .trace as ProjectedDiscoveryTrace;
      const measured = measureRuntimeDiscovery(trace, {
        capabilityInvocations: [
          invocation({ variantId: '1', outcome: 'available' }),
          invocation({ variantId: '1', outcome: 'blocked' }),
        ],
        auditAttempts: [],
      });
      expect(measured.m10.comparisons[0]).toMatchObject({
        agreement: 'not-comparable',
        incomparableBecause: 'ambiguous-runtime-invocation',
      });
      // Both are consumed, so neither is also reported as absent.
      expect(measured.m10.runtimeInvocationsAbsentFromPacket).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe('durable shadow evidence fails closed', () => {
  const db = freshDbWithSession();
  const valid = (() => {
    try {
      return encodeDiscoveryShadowEvidence(
        captureWithPreflight(db, '1'),
      ) as Record<string, unknown>;
    } finally {
      db.close();
    }
  })();

  /** Set one field by JSON-pointer-ish path on a deep clone of a valid row. */
  function mutated(path: string, value: unknown): Record<string, unknown> {
    const clone = JSON.parse(JSON.stringify(valid)) as Record<string, unknown>;
    const parts = path.split('.');
    let node: Record<string, unknown> = clone;
    for (const part of parts.slice(0, -1)) {
      const index = Number.parseInt(part, 10);
      node = (
        Number.isNaN(index) ? node[part] : (node as unknown as unknown[])[index]
      ) as Record<string, unknown>;
    }
    const last = parts[parts.length - 1];
    if (value === undefined) delete node[last];
    else node[last] = value;
    return clone;
  }

  const rejectsIn = (stored: unknown, at: string): void => {
    let thrown: unknown;
    try {
      readDiscoveryShadowEvidence(stored as TraceJsonValue);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DiscoveryShadowSchemaError);
    expect((thrown as Error).message).toContain(at);
  };

  const rejects = (stored: unknown, at: string): void => {
    let thrown: unknown;
    try {
      readDiscoveryShadowEvidence(stored as TraceJsonValue);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DiscoveryShadowSchemaError);
    expect((thrown as Error).message).toContain(`malformed at ${at}`);
  };

  it('accepts the value it writes, and reads absence as absence', () => {
    expect(readDiscoveryShadowEvidence(valid as TraceJsonValue)?.schema).toBe(
      'discovery-shadow-v1',
    );
    expect(readDiscoveryShadowEvidence(undefined)).toBeUndefined();
    expect(readDiscoveryShadowEvidence(null)).toBeUndefined();
  });

  it('rejects a non-object and an unknown schema tag', () => {
    expect(() =>
      readDiscoveryShadowEvidence('nonsense' as TraceJsonValue),
    ).toThrowError(DiscoveryShadowSchemaError);
    expect(() =>
      readDiscoveryShadowEvidence({
        ...valid,
        schema: 'discovery-shadow-v2',
      } as TraceJsonValue),
    ).toThrowError(DiscoveryShadowSchemaError);
  });

  it('rejects a row carrying neither a trace nor a failure, or both', () => {
    rejects(mutated('trace', undefined), 'trace/failure');
    rejects(
      { ...valid, failure: { stage: 'discovery', message: 'x' } },
      'trace/failure',
    );
  });

  it('rejects a bare schema tag', () => {
    rejects({ schema: 'discovery-shadow-v1' }, 'campaignPosition');
  });

  /**
   * One mutation per measurement-input family. Each field named here is
   * dereferenced by M1-M11 or by baseline qualification, so accepting a row
   * without it would mean spreading `undefined` into a measurement or reading
   * a status nothing produced.
   */
  const MUTATIONS: readonly [string, string, unknown][] = [
    // Stage accounting and its cross-field invariant (design §13.3).
    ['stage enum', 'trace.dedup.outcome', 'probably-ran'],
    ['stage invariant', 'trace.dedup.failedToRun', true],
    ['stage array', 'trace.dedup.produced', 'none'],
    ['stage loss shape', 'trace.retention.losses', [{ reason: 1 }]],
    // Candidate identity and routes (M1, M2, M3).
    ['candidate key', 'trace.candidates.outputsProduced.0.candidateKey', 7],
    ['route identity', 'trace.candidates.outputsProduced.0.routes', [{}]],
    // Rule join (M5).
    ['rule-join field', 'trace.ruleJoin.requestedRuleRecordKeys', undefined],
    ['ruling scope enum', 'trace.ruleJoin.rulingQueryScope', 'sometimes'],
    ['query flag', 'trace.lateRuleJoin.ruleQueryExecuted', 'yes'],
    ['placed rule shape', 'trace.ruleJoin.placedRules', [{ ruleIdentity: 1 }]],
    // Expansion traversals (M4).
    ['traversal shape', 'trace.expansion.traversals', [{ relation: 'x' }]],
    // Retention and overflow (M6, M7).
    ['overflow flag', 'trace.retention.overflowed', 'no'],
    ['drop reason', 'trace.retention.dropped', [{ candidateKey: 'k' }]],
    ['retained band', 'trace.retention.outputsProduced.0.band', 'urgent'],
    // Packet (M7, M8, M9, M10).
    ['packet bytes', 'trace.packet.packet.bytes', '12'],
    ['packet candidates', 'trace.packet.packet.candidates', {}],
    [
      'packet provenance',
      'trace.packet.packet.candidates.0.provenance.sourceRef',
      undefined,
    ],
    [
      'capability status enum',
      'trace.packet.packet.candidates.0.capability.status',
      'probably-fine',
    ],
    ['packet non-claim', 'trace.packet.packet.modelUsageClaim', 'used'],
    // Source identity of the whole run.
    ['stack identity', 'trace.stack.base.version', undefined],
    ['stage order', 'trace.stageOrder', 'signals,candidates'],
    // Runtime observations (M10, M11).
    [
      'invocation outcome enum',
      'runtime.capabilityInvocations',
      [{ tool: 'use_item', outcome: 'maybe', subjectSource: 'runtime-result' }],
    ],
    [
      'subject source enum',
      'runtime.capabilityInvocations',
      [{ tool: 'use_item', outcome: 'available', subjectSource: 'a guess' }],
    ],
    [
      'audit action enum',
      'runtime.auditAttempts',
      [
        {
          attempt: 1,
          verdict: 'reject',
          action: 'ponder',
          retryCause: null,
          missingTools: [],
        },
      ],
    ],
    ['audit container', 'runtime.auditAttempts', {}],
    // Baseline qualification.
    ['blocker status enum', 'blockerRepairs.0.status', 'probably-repaired'],
    ['blocker id enum', 'blockerRepairs.0.blockerId', 'B9'],
    ['blocker gates', 'blockerRepairs.0.gates', 'nothing'],
    // Scenario.
    ['scenario binding', 'scenario.itemInstances', [{ instanceId: 'x' }]],
    ['scenario notes', 'scenario.adventureSeatNotes', undefined],
    ['recorded non-claim', 'modelUsageClaim', 'the model used it'],
  ];

  for (const [family, path, value] of MUTATIONS)
    it(`rejects a malformed ${family}`, () => {
      const stored = mutated(path, value);
      // The valid row really did contain what is being broken, or the mutation
      // would be testing a field this evidence never carries.
      expect(JSON.stringify(stored)).not.toBe(JSON.stringify(valid));
      expect(() =>
        readDiscoveryShadowEvidence(stored as TraceJsonValue),
      ).toThrowError(DiscoveryShadowSchemaError);
    });

  /**
   * The mutation row above is an ammunition capture, which carries no
   * ambiguities at all — so none of its thirty cases can reach the nested
   * identities M5 consumes. Cube of Force does carry one, on the packet
   * candidate and on both rule joins, which is the state this block corrupts.
   */
  describe('nested ambiguity identity, which M5 filters rather than fails on', () => {
    const ambiguous = (() => {
      const db = freshDbWithSession();
      try {
        return encodeDiscoveryShadowEvidence(
          completeDiscoveryShadowEvidence(
            captureDiscoveryShadow({
              db,
              campaignPosition: DEFAULT_TEST_CAMPAIGN_POSITION,
              capturedAt: AT,
              playerInput: 'I press a face of the cube.',
              stateFields: {
                itemRecord: CUBE,
                operationId: 'press-face-1',
              },
              itemInstances: [],
              campaignRuleSeam: NULL_CAMPAIGN_RULE_SEAM,
              tools: createDefaultToolRegistry(),
            }),
            { toolCalls: [], auditAttempts: [] },
          ),
        ) as Record<string, unknown>;
      } finally {
        db.close();
      }
    })();

    function trace(): Record<string, unknown> {
      return (ambiguous.trace as Record<string, unknown>) ?? {};
    }

    function packetAmbiguities(row: Record<string, unknown>): unknown[] {
      const candidates = (
        (
          (row.trace as Record<string, unknown>).packet as Record<
            string,
            unknown
          >
        ).packet as Record<string, unknown>
      ).candidates as Record<string, unknown>[];
      const cube = candidates.find(
        (candidate) =>
          (candidate.identity as Record<string, unknown>).key === CUBE,
      );
      return (cube as Record<string, unknown>).ambiguities as unknown[];
    }

    function clone(): Record<string, unknown> {
      return JSON.parse(JSON.stringify(ambiguous)) as Record<string, unknown>;
    }

    it('has ambiguities to corrupt, so these cases are not vacuous', () => {
      expect(packetAmbiguities(ambiguous).length).toBeGreaterThan(0);
      for (const join of ['ruleJoin', 'lateRuleJoin'])
        expect(
          (
            (trace()[join] as Record<string, unknown>)
              .unresolvedAmbiguities as unknown[]
          ).length,
        ).toBeGreaterThan(0);
      expect(
        readDiscoveryShadowEvidence(ambiguous as TraceJsonValue)?.schema,
      ).toBe('discovery-shadow-v1');
    });

    for (const broken of [{}, { id: 7 }, { id: null }])
      it(`rejects a packet ambiguity of ${JSON.stringify(broken)}`, () => {
        const row = clone();
        packetAmbiguities(row)[0] = broken;
        expect(() =>
          readDiscoveryShadowEvidence(row as TraceJsonValue),
        ).toThrowError(DiscoveryShadowSchemaError);
      });

    for (const join of ['ruleJoin', 'lateRuleJoin'])
      it(`rejects an unresolved ambiguity with no id on ${join}`, () => {
        const row = clone();
        (
          (row.trace as Record<string, unknown>)[join] as Record<
            string,
            unknown
          >
        ).unresolvedAmbiguities = [{ note: 'no id here' }];
        rejectsIn(row, `trace.${join}.unresolvedAmbiguities[0].id`);
      });

    it('rejects a jhpt projection carrying no rule identity', () => {
      const row = clone();
      const candidates = (
        (
          (row.trace as Record<string, unknown>).packet as Record<
            string,
            unknown
          >
        ).packet as Record<string, unknown>
      ).candidates as Record<string, unknown>[];
      candidates[0].campaignRulings = [{ prose: 'no identity' }];
      expect(() =>
        readDiscoveryShadowEvidence(row as TraceJsonValue),
      ).toThrowError(DiscoveryShadowSchemaError);
    });

    it('rejects a malformed capability revision M10 would read as absent', () => {
      const row = clone();
      const candidates = (
        (
          (row.trace as Record<string, unknown>).packet as Record<
            string,
            unknown
          >
        ).packet as Record<string, unknown>
      ).candidates as Record<string, unknown>[];
      const withCapability = candidates.find(
        (candidate) => candidate.capability !== undefined,
      );
      expect(withCapability).toBeDefined();
      (withCapability as Record<string, unknown>).capability = {
        ...((withCapability as Record<string, unknown>).capability as object),
        revision: 3,
      };
      rejectsIn(row, 'revision');
    });
  });

  it('names the exact path it rejected', () => {
    rejects(
      mutated('trace.ruleJoin.rulingQueryScope', 'sometimes'),
      'trace.ruleJoin.rulingQueryScope',
    );
    rejects(
      mutated('blockerRepairs.0.status', 'nope'),
      'blockerRepairs[0].status',
    );
  });
});

describe('M10 over a real readiness-blocked capability', () => {
  /** The real runtime outcome: `useItem` refuses on the readiness preflight. */
  function blockedInvocation(db: ReturnType<typeof freshDbWithSession>) {
    db.prepare(
      `INSERT INTO inventory(
         id, character_id, name, quantity, location, properties_json,
         pack_ref, provenance, session_id, updated_at
       ) VALUES ('gem-1', 'pc-1', 'Gem of Brightness', 1, NULL, '{}', ?, 'test:w9', ?, ?)`,
    ).run(GEM, DEFAULT_TEST_SESSION_ID, AT);
    const registry = createDefaultToolRegistry();
    const result = registry.invoke(
      'use_item',
      { instanceId: 'gem-1', operationId: BLOCKED_OPERATION },
      {
        db,
        rng: createSeededRng(1),
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        sessionId: DEFAULT_TEST_SESSION_ID,
        turnId: 'turn-1',
        at: AT,
      },
    );
    // The refusal must come from the readiness capability, not from anything
    // else about the item, or this proves nothing about M10.
    expect(result.ok).toBe(false);
    expect((result as { data?: unknown }).data).toMatchObject({
      status: 'blocked',
      subject: { recordKey: GEM, operationId: BLOCKED_OPERATION },
    });
    return {
      tool: 'use_item',
      args: { instanceId: 'gem-1', operationId: BLOCKED_OPERATION },
      result: result as {
        ok: false;
        code: string;
        message: string;
        data?: unknown;
      },
    };
  }

  it('compares the packet preflight with a blocked runtime outcome, through SQLite', () => {
    const db = freshDbWithSession();
    try {
      const call = blockedInvocation(db);
      const capture = captureForOperation(db, GEM, BLOCKED_OPERATION, [
        { instanceId: 'gem-1', recordKey: GEM },
      ]);
      const evidence = completeDiscoveryShadowEvidence(capture, {
        toolCalls: [call],
        auditAttempts: [],
      });

      // Persist and re-read: "derivable from the trace" means from the row.
      recordTurnTrace(db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        sessionId: DEFAULT_TEST_SESSION_ID,
        turnId: 'turn-1',
        consentScope: 'private',
        playerInput: 'I level the gem and fire.',
        retrievedContext: [],
        promptProfile: 'default',
        modelOutput: 'Nothing happens.',
        toolCalls: [],
        rulesResolution: {},
        acceptedStateDelta: [],
        rejectedCandidates: [],
        finalNarration: 'Nothing happens.',
        memoryUpdates: [],
        humanCorrections: [],
        qualityFlags: [],
        createdAt: AT,
        discoveryShadow: encodeDiscoveryShadowEvidence(evidence),
      });
      const stored = readDiscoveryShadowEvidence(
        getTurnTrace(db, {
          campaignId: DEFAULT_TEST_CAMPAIGN_ID,
          sessionId: DEFAULT_TEST_SESSION_ID,
          turnId: 'turn-1',
        })?.discoveryShadow,
      );
      const invocations = stored?.runtime.capabilityInvocations ?? [];
      // The subject came from the runtime's own preflight, not the snapshot.
      expect(invocations).toEqual([
        {
          tool: 'use_item',
          instanceId: 'gem-1',
          operationId: BLOCKED_OPERATION,
          recordKey: GEM,
          subjectSource: 'runtime-result',
          capabilityId: CAPABILITY_ID,
          capabilityRevision: CAPABILITY_REVISION,
          outcome: 'blocked',
          detail: expect.any(String),
        },
      ]);

      const trace = stored?.trace as ProjectedDiscoveryTrace;
      expect(packetPreflight(trace)).toMatchObject({
        key: GEM,
        status: 'blocked',
      });
      expect(
        measureRuntimeDiscovery(
          trace,
          stored?.runtime ?? {
            capabilityInvocations: [],
            auditAttempts: [],
          },
        ).m10,
      ).toMatchObject({
        comparisons: [
          {
            candidateKey: GEM,
            packetStatus: 'blocked',
            runtimeOutcome: 'blocked',
            agreement: 'agreed',
          },
        ],
        runtimeInvocationsAbsentFromPacket: [],
      });
    } finally {
      db.close();
    }
  });

  it('records an available capability that a downstream failure then swallowed', () => {
    const db = freshDbWithSession();
    try {
      // Magic ammunition with no campaign location: the readiness capability
      // reports `available`, and `useItem` then fails placing the spent piece
      // as an unheld item. Inferring the capability's outcome from the tool's
      // would erase an invocation that really happened and really succeeded.
      db.prepare(
        `INSERT INTO inventory(
           id, character_id, name, quantity, location, properties_json,
           pack_ref, provenance, session_id, updated_at
         ) VALUES ('ammo-1', 'pc-1', 'Magic Ammunition', 20, NULL, '{}', ?, 'test:w9', ?, ?)`,
      ).run(AMMO, DEFAULT_TEST_SESSION_ID, AT);
      const result = createDefaultToolRegistry().invoke(
        'use_item',
        { instanceId: 'ammo-1', operationId: 'hit-target' },
        {
          db,
          rng: createSeededRng(1),
          campaignId: DEFAULT_TEST_CAMPAIGN_ID,
          sessionId: DEFAULT_TEST_SESSION_ID,
          turnId: 'turn-1',
          at: AT,
        },
      );
      expect(result.ok).toBe(false);
      // The failure is downstream of the capability, not the capability's.
      expect((result as { message: string }).message).toContain(
        'current campaign location',
      );
      expect(
        observeRuntimeCapabilityInvocations(
          [
            {
              tool: 'use_item',
              args: { instanceId: 'ammo-1', operationId: 'hit-target' },
              result: result as {
                ok: false;
                code: string;
                message: string;
                data?: unknown;
              },
            },
          ],
          [],
        )[0],
      ).toMatchObject({
        recordKey: AMMO,
        operationId: 'hit-target',
        subjectSource: 'runtime-result',
        capabilityId: CAPABILITY_ID,
        capabilityRevision: CAPABILITY_REVISION,
        outcome: 'available',
      });
    } finally {
      db.close();
    }
  });

  it('is unaffected by a pre-model binding that names a different subject', () => {
    const db = freshDbWithSession();
    try {
      const call = blockedInvocation(db);
      // A stale snapshot: the binding claims a different record and a variant.
      // If M10 consulted it, the comparison would be lost or fabricated.
      const capture = captureForOperation(db, GEM, BLOCKED_OPERATION, [
        { instanceId: 'gem-1', recordKey: AMMO, variantId: '3' },
      ]);
      const evidence = completeDiscoveryShadowEvidence(capture, {
        toolCalls: [call],
        auditAttempts: [],
      });
      expect(evidence.runtime.capabilityInvocations[0]).toMatchObject({
        recordKey: GEM,
        subjectSource: 'runtime-result',
      });
      expect(
        evidence.runtime.capabilityInvocations[0].variantId,
      ).toBeUndefined();
      expect(
        measureRuntimeDiscovery(
          evidence.trace as ProjectedDiscoveryTrace,
          evidence.runtime,
        ).m10.comparisons[0],
      ).toMatchObject({ runtimeOutcome: 'blocked', agreement: 'agreed' });
    } finally {
      db.close();
    }
  });

  it('falls back to the labelled snapshot only when no subject is reported', () => {
    // The pre-subject payload shape, which M10 must refuse to compare on.
    const observed = observeRuntimeCapabilityInvocations(
      [
        {
          tool: 'use_item',
          args: { instanceId: 'gem-1', operationId: BLOCKED_OPERATION },
          result: {
            ok: false,
            code: 'item_error',
            message: 'blocked',
            data: { status: 'blocked', capabilityId: 'x' },
          },
        },
      ],
      [{ instanceId: 'gem-1', recordKey: GEM }],
    );
    expect(observed[0]).toMatchObject({
      recordKey: GEM,
      subjectSource: 'pre-model-binding',
      outcome: 'blocked',
    });
  });
});

describe('one capture, one rules-pack source', () => {
  /**
   * A `CampaignRulesPackResolver` is caller-supplied and nothing contracts it
   * to be pure, to keep answering, or to answer the same way twice. One shadow
   * capture resolves the campaign's packs more than once — its own strict
   * stack, B3's call into the real deterministic lookup, and the discovery run
   * — so without a pinned source the persisted blocker statuses could qualify
   * one resolution while the trace beside them described another.
   */
  function adversarialResolver(
    real: CampaignRulesPackResolver,
    later: (
      ref: Parameters<CampaignRulesPackResolver>[0],
    ) => RulesPack | undefined,
  ) {
    // Counted PER BOUND PACK: a binding with a base and an add-on legitimately
    // asks for two refs. What must not happen is asking for the same ref twice
    // and getting two different answers.
    const calls = new Map<string, number>();
    return {
      resolve: (ref: Parameters<CampaignRulesPackResolver>[0]) => {
        const key = `${ref.systemId}/${ref.packId}@${ref.version}`;
        const seen = (calls.get(key) ?? 0) + 1;
        calls.set(key, seen);
        return seen === 1 ? real(ref) : later(ref);
      },
      maxCallsForOneRef: () => Math.max(0, ...calls.values()),
    };
  }

  function capture(
    db: ReturnType<typeof freshDbWithSession>,
    resolveRulesPack: CampaignRulesPackResolver,
  ) {
    return captureDiscoveryShadow({
      db,
      campaignPosition: DEFAULT_TEST_CAMPAIGN_POSITION,
      capturedAt: AT,
      playerInput: 'I turn the ring over.',
      stateFields: { itemRecord: CURSED_ATTUNEMENT_OVERRIDDEN_ITEM_REF },
      itemInstances: [],
      campaignRuleSeam: NULL_CAMPAIGN_RULE_SEAM,
      resolveRulesPack,
      tools: createDefaultToolRegistry(),
    });
  }

  it('resolves each bound pack once, even when a later call would throw', () => {
    const db = freshDbWithSession();
    try {
      const real = installCursedAttunementAddon(db, AT);
      const resolver = adversarialResolver(real, () => {
        throw new Error('rules pack source is no longer readable');
      });
      const result = capture(db, resolver.resolve);
      expect(resolver.maxCallsForOneRef()).toBe(1);
      expect(result.failure).toBeUndefined();
      expect(result.trace).toBeDefined();
      // B3 exercised the real deterministic lookup, which resolves the stack
      // itself; it saw the pinned packs rather than the throwing second call.
      expect(
        result.blockerRepairs.find((item) => item.blockerId === 'B3')?.status,
      ).toBe('repaired');
    } finally {
      db.close();
    }
  });

  it('qualifies and traces the same pack CONTENT, not merely equal metadata', () => {
    const db = freshDbWithSession();
    try {
      const real = installCursedAttunementAddon(db, AT);
      // A second resolution that keeps the identity and drops the override.
      // Unpinned, the blocker qualification and the trace would describe two
      // different rules corpora under one pack identity.
      const resolver = adversarialResolver(real, (ref) => {
        const pack = real(ref);
        return pack === undefined ? undefined : { ...pack, records: [] };
      });
      const result = capture(db, resolver.resolve);
      expect(resolver.maxCallsForOneRef()).toBe(1);
      expect(
        result.blockerRepairs.find((item) => item.blockerId === 'B3')?.status,
      ).toBe('repaired');
      const candidate = result.trace?.packet.packet.candidates.find(
        (item) => item.identity.key === CURSED_ATTUNEMENT_OVERRIDDEN_ITEM_REF,
      );
      expect(candidate).toBeDefined();
      // The add-on's overriding content reached the packet: the trace was
      // built from the same resolution B3 qualified, not a later one.
      expect(JSON.stringify(candidate?.sourceProse)).toContain(
        'test-addon-curse',
      );
    } finally {
      db.close();
    }
  });
});
