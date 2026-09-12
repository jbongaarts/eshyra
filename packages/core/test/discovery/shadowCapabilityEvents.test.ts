import { describe, expect, it } from 'vitest';
import type {
  CapabilityInvocationObservation,
  DiscoveryShadowEvidence,
  ProjectedDiscoveryTrace,
  RuntimeCapabilityInvocation,
  RuntimeDiscoveryObservations,
  ToolContext,
  ToolResult,
} from '../../src/internal.js';
import {
  captureDiscoveryShadow,
  completeDiscoveryShadowEvidence,
  createDefaultToolRegistry,
  createSeededRng,
  encodeDiscoveryShadowEvidence,
  getTurnTrace,
  MAGIC_ITEM_OPERATION_READINESS_CAPABILITY,
  measureRuntimeDiscovery,
  NULL_CAMPAIGN_RULE_SEAM,
  readDiscoveryShadowEvidence,
  recordTurnTrace,
  runtimeCapabilityInvocation,
} from '../../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_CAMPAIGN_POSITION,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from '../support/db.js';
import {
  installVariantReadinessAddon,
  PENDING_VARIANT_ID,
  READY_VARIANT_ID,
  VARIANT_READINESS_ITEM_KEY,
  VARIANT_READINESS_OPERATION,
} from './support/variantReadinessAddon.js';

/**
 * M10's regression matrix, over the RUNTIME CAPABILITY EVENT.
 *
 * A bounded capability invocation and the terminal result of the tool
 * containing it are different events. The tool can succeed, fail afterwards on
 * unrelated live state, or belong to a candidate the auditor rejects; none of
 * that erases or redefines what the capability decided. So the observation is
 * taken at the execution boundary — the instant the readiness preflight returns
 * — through the registry's `ToolContext` seam, and never reconstructed from a
 * `ToolResult`, a pre-model inventory snapshot, or discovery's own packet.
 *
 * Every case below that concerns a real capability outcome executes through the
 * real registry/`ToolContext` boundary rather than hand-building the final
 * measurement input.
 */

const AT = '2026-05-20T10:00:00.000Z';
const AMMO = 'magic-item:ammunition-1-2-or-3';
/** No attunement, and `blinding-beam` is readiness-blocked in the SRD pack. */
const GEM = 'magic-item:gem-of-brightness';
const BLOCKED_OPERATION = 'blinding-beam';
const CAPABILITY_ID = MAGIC_ITEM_OPERATION_READINESS_CAPABILITY.operationId;
const CAPABILITY_REVISION = MAGIC_ITEM_OPERATION_READINESS_CAPABILITY.revision;

type Db = ReturnType<typeof freshDbWithSession>;

function heldItem(db: Db, id: string, packRef: string, quantity = 1): void {
  db.prepare(
    `INSERT INTO inventory(
       id, character_id, name, quantity, location, properties_json,
       pack_ref, provenance, session_id, updated_at
     ) VALUES (?, 'pc-1', ?, ?, NULL, '{}', ?, 'test:w9', ?, ?)`,
  ).run(id, `Item ${id}`, quantity, packRef, DEFAULT_TEST_SESSION_ID, AT);
}

/**
 * Invoke `use_item` through the real registry with a real `ToolContext`
 * observer, exactly as `runTurn` installs one. The events are projected through
 * the same `runtimeCapabilityInvocation` the orchestrator uses, so the test
 * cannot drift from the recorded shape.
 */
function invokeUseItem(
  db: Db,
  args: Record<string, unknown>,
  attempt = 1,
): { result: ToolResult; events: RuntimeCapabilityInvocation[] } {
  const events: RuntimeCapabilityInvocation[] = [];
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(1),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'turn-1',
    at: AT,
    observeCapabilityInvocation: (
      observation: CapabilityInvocationObservation,
    ) => {
      events.push(runtimeCapabilityInvocation(observation, attempt));
    },
  };
  return {
    result: createDefaultToolRegistry().invoke('use_item', args, ctx),
    events,
  };
}

/**
 * A capture whose packet state-references `itemRecord`. F1 repair
 * (`eshyra-o9bd.19.12.9`): the capture now preflights EVERY operation the
 * record declares, not only `operationId` -- that field stays here only
 * because it is otherwise-unconsumed decorative scenario state (like
 * `machineState` elsewhere in this corpus), never because it still selects
 * which operation gets preflighted.
 */
function captureForOperation(
  db: Db,
  itemRecord: string,
  operationId: string,
): DiscoveryShadowEvidence {
  return completeDiscoveryShadowEvidence(
    captureDiscoveryShadow({
      db,
      campaignPosition: DEFAULT_TEST_CAMPAIGN_POSITION,
      capturedAt: AT,
      playerInput: 'I use the item.',
      stateFields: { itemRecord, operationId },
      itemInstances: [],
      campaignRuleSeam: NULL_CAMPAIGN_RULE_SEAM,
      tools: createDefaultToolRegistry(),
    }),
    {
      capabilityInvocations: [],
      stateEffects: [],
      audit: { auditor: 'absent' },
    },
    { mode: 'observed', injected: false },
  );
}

function traceOf(evidence: DiscoveryShadowEvidence): ProjectedDiscoveryTrace {
  if (evidence.trace === undefined)
    throw new Error(
      `capture recorded no trace: ${JSON.stringify(evidence.failure)}`,
    );
  return evidence.trace;
}

/** The one preflight entry for `operationId`, out of the candidate's bounded set. */
function packetCapability(trace: ProjectedDiscoveryTrace, operationId: string) {
  const candidate = trace.packet.candidates.find((item) =>
    item.capabilities.some((entry) => entry.operationId === operationId),
  );
  const capability = candidate?.capabilities.find(
    (entry) => entry.operationId === operationId,
  );
  if (candidate === undefined || capability === undefined)
    throw new Error('the capture produced no capability preflight');
  return { key: candidate.identity.key, capability };
}

function observations(
  capabilityInvocations: readonly RuntimeCapabilityInvocation[],
): RuntimeDiscoveryObservations {
  return {
    capabilityInvocations,
    stateEffects: [],
    audit: { auditor: 'absent' },
  };
}

/** A synthetic event, for the pairing/identity states that need no execution. */
function event(
  overrides: Partial<RuntimeCapabilityInvocation> = {},
): RuntimeCapabilityInvocation {
  return {
    tool: 'use_item',
    attempt: 1,
    instanceId: 'gem-1',
    recordKey: GEM,
    operationId: BLOCKED_OPERATION,
    capabilityId: CAPABILITY_ID,
    capabilityRevision: CAPABILITY_REVISION,
    outcome: 'blocked',
    ...overrides,
  };
}

describe('runtime capability events reach M10', () => {
  it('observes an AVAILABLE capability when the tool then succeeds', () => {
    const db = freshDbWithSession();
    try {
      db.prepare(
        "UPDATE clock SET current_location_id='camp' WHERE id=1",
      ).run();
      heldItem(db, 'ammo-1', AMMO, 20);
      const { result, events } = invokeUseItem(db, {
        instanceId: 'ammo-1',
        operationId: 'hit-target',
      });
      expect(result.ok).toBe(true);
      expect(events).toEqual([
        {
          tool: 'use_item',
          attempt: 1,
          instanceId: 'ammo-1',
          recordKey: AMMO,
          operationId: 'hit-target',
          capabilityId: CAPABILITY_ID,
          capabilityRevision: CAPABILITY_REVISION,
          outcome: 'available',
        },
      ]);
      // And the success result is untouched by the observation.
      expect(result.ok && result.data).not.toHaveProperty(
        'capabilityPreflight',
      );
    } finally {
      db.close();
    }
  });

  it('observes an AVAILABLE capability that a downstream failure then swallowed', () => {
    const db = freshDbWithSession();
    try {
      // No campaign location: readiness reports `available`, and the use then
      // fails placing the spent piece as an unheld item. Inferring the
      // capability's outcome from the tool's would erase a real invocation.
      heldItem(db, 'ammo-1', AMMO, 20);
      const { result, events } = invokeUseItem(db, {
        instanceId: 'ammo-1',
        operationId: 'hit-target',
      });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.message).toContain(
        'current campaign location',
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        recordKey: AMMO,
        outcome: 'available',
      });
    } finally {
      db.close();
    }
  });

  it('observes a BLOCKED capability', () => {
    const db = freshDbWithSession();
    try {
      heldItem(db, 'gem-1', GEM);
      const { result, events } = invokeUseItem(db, {
        instanceId: 'gem-1',
        operationId: BLOCKED_OPERATION,
      });
      expect(result.ok).toBe(false);
      expect(events).toEqual([event({ outcome: 'blocked' })]);
    } finally {
      db.close();
    }
  });

  it('observes nothing when the call fails BEFORE the preflight runs', () => {
    const db = freshDbWithSession();
    try {
      heldItem(db, 'relic-1', 'magic-item:absent-from-this-stack');
      const { result, events } = invokeUseItem(db, {
        instanceId: 'relic-1',
        operationId: 'anything',
      });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.message).toContain('does not resolve');
      // Nothing was invoked, so there is nothing for M10 to compare.
      expect(events).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('compares a blocked runtime event with the packet preflight, through SQLite', () => {
    const db = freshDbWithSession();
    try {
      heldItem(db, 'gem-1', GEM);
      const { events } = invokeUseItem(db, {
        instanceId: 'gem-1',
        operationId: BLOCKED_OPERATION,
      });
      const evidence = completeDiscoveryShadowEvidence(
        captureForOperation(db, GEM, BLOCKED_OPERATION),
        observations(events),
        { mode: 'observed', injected: false },
      );
      recordTurnTrace(db, {
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        sessionId: DEFAULT_TEST_SESSION_ID,
        turnId: 'turn-1',
        consentScope: 'private',
        playerInput: 'I use the item.',
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
      if (stored === undefined) throw new Error('no shadow evidence persisted');
      expect(stored.runtime.capabilityInvocations).toEqual(events);
      expect(
        packetCapability(traceOf(stored), BLOCKED_OPERATION).capability.status,
      ).toBe('blocked');
      const m10 = measureRuntimeDiscovery(traceOf(stored), stored.runtime).m10;
      // The gem declares four operations (F1 repair, `eshyra-o9bd.19.12.9`),
      // so the candidate now carries four contracts and `comparisons` holds
      // one entry per contract; this test is about the one the real
      // invocation actually paired with.
      expect(m10.comparisons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            candidateKey: GEM,
            packetStatus: 'blocked',
            runtimeOutcome: 'blocked',
            agreement: 'agreed',
          }),
        ]),
      );
      expect(m10.runtimeInvocationsAbsentFromPacket).toEqual([]);
    } finally {
      db.close();
    }
  });

  describe('pairing and identity', () => {
    /**
     * The gem declares four operations (F1 repair, `eshyra-o9bd.19.12.9`), so
     * its candidate now carries four preflight contracts and `m10.comparisons`
     * holds one entry per contract, in the SAME order as the candidate's own
     * `capabilities` (measurements.ts flatMaps candidates onto that array).
     * This suite's pairing/identity assertions are about the ONE contract for
     * `BLOCKED_OPERATION`, picked out by that shared index rather than by
     * assuming it is the only (or the first) entry.
     */
    function measured(db: Db, events: readonly RuntimeCapabilityInvocation[]) {
      const evidence = captureForOperation(db, GEM, BLOCKED_OPERATION);
      const trace = traceOf(evidence);
      const index = (trace.packet.candidates[0]?.capabilities ?? []).findIndex(
        (item) => item.operationId === BLOCKED_OPERATION,
      );
      if (index < 0)
        throw new Error('capture did not preflight the operation under test');
      const m10 = measureRuntimeDiscovery(trace, observations(events)).m10;
      return { m10, comparison: m10.comparisons[index] };
    }

    it('agrees on a matching subject, identity and status', () => {
      const db = freshDbWithSession();
      try {
        expect(measured(db, [event()]).comparison).toMatchObject({
          agreement: 'agreed',
          runtimeOutcome: 'blocked',
        });
      } finally {
        db.close();
      }
    });

    it('disagrees on a matching subject and identity with a different status', () => {
      const db = freshDbWithSession();
      try {
        expect(
          measured(db, [event({ outcome: 'available' })]).comparison,
        ).toMatchObject({
          agreement: 'disagreed',
          runtimeOutcome: 'available',
        });
      } finally {
        db.close();
      }
    });

    it('does not pair a different variant of the same record and operation', () => {
      const db = freshDbWithSession();
      try {
        const { m10, comparison } = measured(db, [event({ variantId: '2' })]);
        expect(comparison).toMatchObject({
          runtimeOutcome: 'not-invoked',
          agreement: 'not-comparable',
          incomparableBecause: 'not-invoked',
        });
        // The unpaired event is still reported, never discarded.
        expect(
          m10.runtimeInvocationsAbsentFromPacket.map((item) => item.variantId),
        ).toEqual(['2']);
      } finally {
        db.close();
      }
    });

    for (const [label, overrides] of [
      ['a different capability id', { capabilityId: 'someOtherCapability' }],
      ['a different revision', { capabilityRevision: 'v99' }],
    ] as const)
      it(`refuses to compare ${label}`, () => {
        const db = freshDbWithSession();
        try {
          expect(measured(db, [event(overrides)]).comparison).toMatchObject({
            agreement: 'not-comparable',
            incomparableBecause: 'capability-identity-mismatch',
          });
        } finally {
          db.close();
        }
      });

    it('reports not-invoked when nothing ran', () => {
      const db = freshDbWithSession();
      try {
        expect(measured(db, []).comparison).toMatchObject({
          runtimeOutcome: 'not-invoked',
          agreement: 'not-comparable',
          incomparableBecause: 'not-invoked',
        });
      } finally {
        db.close();
      }
    });

    it('retains two real invocations of one subject and refuses to pick', () => {
      const db = freshDbWithSession();
      try {
        const both = [
          event({ attempt: 1, outcome: 'blocked' }),
          event({ attempt: 2, outcome: 'available' }),
        ];
        const { m10, comparison } = measured(db, both);
        expect(comparison).toMatchObject({
          agreement: 'not-comparable',
          incomparableBecause: 'ambiguous-runtime-invocation',
        });
        // Neither is deduplicated away, and neither is double-counted as absent.
        expect(m10.runtimeInvocationsAbsentFromPacket).toEqual([]);
      } finally {
        db.close();
      }
    });

    it('reports an event the packet never preflighted', () => {
      const db = freshDbWithSession();
      try {
        const { m10, comparison } = measured(db, [
          event({
            recordKey: AMMO,
            operationId: 'hit-target',
            instanceId: 'ammo-1',
          }),
        ]);
        expect(comparison).toMatchObject({
          incomparableBecause: 'not-invoked',
        });
        expect(
          m10.runtimeInvocationsAbsentFromPacket.map((item) => item.recordKey),
        ).toEqual([AMMO]);
      } finally {
        db.close();
      }
    });

    it('refuses to compare a packet status that evaluated nothing', () => {
      const db = freshDbWithSession();
      try {
        const real = captureForOperation(db, GEM, BLOCKED_OPERATION);
        const trace = traceOf(real);
        const rewritten = {
          ...trace,
          packet: {
            ...trace.packet,
            candidates: trace.packet.candidates.map((candidate) => ({
              ...candidate,
              capabilities: candidate.capabilities.map((capability) => ({
                ...capability,
                status: 'not-evaluated-offline' as const,
              })),
            })),
          },
        };
        // Every entry was rewritten identically, so any index agrees.
        expect(
          measureRuntimeDiscovery(rewritten, observations([event()])).m10
            .comparisons[0],
        ).toMatchObject({
          agreement: 'not-comparable',
          incomparableBecause: 'packet-status-not-evaluated-offline',
        });
      } finally {
        db.close();
      }
    });
  });
});

/**
 * E3 (F1 repair, `eshyra-o9bd.19.12.9`, PR #543 review): the adversarial,
 * non-fixture-specific case. `magic-item:test-variant-readiness`
 * (`variantReadinessAddon.ts`) is a synthetic magic item whose readiness
 * differs by variant and which declares exactly one operation
 * (`spend-one-use`) -- unlike the real pack's cube-of-force/ammunition,
 * nothing about it is tailored to a diagnostic fixture. `variantId` is a
 * property of the bound INSTANCE, never enumerated (design section 7.3 would
 * forbid preflighting a variant the campaign is not in), so this proves the
 * packet preflights the declared operation for the instance's ACTUAL variant.
 */
describe('E3 -- the adversarial case: variant-scoped preflight and an undeclared operation', () => {
  function heldVariantItem(
    db: Db,
    id: string,
    packRef: string,
    variantId: string,
  ): void {
    db.prepare(
      `INSERT INTO inventory(
         id, character_id, name, quantity, location, properties_json,
         pack_ref, variant_id, provenance, session_id, updated_at
       ) VALUES (?, 'pc-1', ?, 1, NULL, '{}', ?, ?, 'test:w10-f1', ?, ?)`,
    ).run(id, `Item ${id}`, packRef, variantId, DEFAULT_TEST_SESSION_ID, AT);
  }

  it('preflights the declared operation for the actual variant and pairs a real invocation', () => {
    const db = freshDbWithSession();
    try {
      const resolver = installVariantReadinessAddon(db, AT);
      // The item's `uses` economy is single-use, so a successful spend needs
      // a current campaign location to place the depleted remainder, exactly
      // as the ammunition cases above do.
      db.prepare(
        "UPDATE clock SET current_location_id='camp' WHERE id=1",
      ).run();
      heldVariantItem(
        db,
        'variant-item-1',
        VARIANT_READINESS_ITEM_KEY,
        READY_VARIANT_ID,
      );
      const events: RuntimeCapabilityInvocation[] = [];
      const ctx: ToolContext = {
        db,
        rng: createSeededRng(1),
        campaignId: DEFAULT_TEST_CAMPAIGN_ID,
        sessionId: DEFAULT_TEST_SESSION_ID,
        turnId: 'turn-1',
        at: AT,
        resolveRulesPack: resolver,
        observeCapabilityInvocation: (observation) => {
          events.push(runtimeCapabilityInvocation(observation, 1));
        },
      };
      const result = createDefaultToolRegistry().invoke(
        'use_item',
        {
          instanceId: 'variant-item-1',
          operationId: VARIANT_READINESS_OPERATION,
        },
        ctx,
      );
      expect(result.ok).toBe(true);
      expect(events).toHaveLength(1);

      const capture = completeDiscoveryShadowEvidence(
        captureDiscoveryShadow({
          db,
          campaignPosition: DEFAULT_TEST_CAMPAIGN_POSITION,
          capturedAt: AT,
          playerInput: 'I use the item.',
          stateFields: { heldInstance: 'variant-item-1' },
          itemInstances: [
            {
              instanceId: 'variant-item-1',
              recordKey: VARIANT_READINESS_ITEM_KEY,
              variantId: READY_VARIANT_ID,
            },
          ],
          campaignRuleSeam: NULL_CAMPAIGN_RULE_SEAM,
          tools: createDefaultToolRegistry(),
          resolveRulesPack: resolver,
        }),
        {
          capabilityInvocations: [],
          stateEffects: [],
          audit: { auditor: 'absent' },
        },
        { mode: 'observed', injected: false },
      );
      const trace = traceOf(capture);
      const candidate = trace.packet.candidates.find(
        (item) => item.identity.key === VARIANT_READINESS_ITEM_KEY,
      );
      // Exactly the one declared operation, for the instance's actual
      // variant -- never the OTHER variant the record also declares.
      expect(candidate?.capabilities).toEqual([
        expect.objectContaining({
          operationId: VARIANT_READINESS_OPERATION,
          variantId: READY_VARIANT_ID,
          status: 'available',
        }),
      ]);
      expect(
        candidate?.capabilities.some(
          (item) => item.variantId === PENDING_VARIANT_ID,
        ),
      ).toBe(false);

      const m10 = measureRuntimeDiscovery(trace, observations(events)).m10;
      expect(m10.comparisons).toEqual([
        expect.objectContaining({
          candidateKey: VARIANT_READINESS_ITEM_KEY,
          runtimeOutcome: 'available',
          agreement: 'agreed',
        }),
      ]);
      expect(m10.runtimeInvocationsAbsentFromPacket).toEqual([]);

      // An invocation of an operation the record does NOT declare is never
      // silently paired with the one contract the packet actually holds. A
      // real `useItem` call cannot produce this event (it throws before the
      // preflight boundary for an undeclared operation -- see "observes
      // nothing when the call fails BEFORE the preflight runs" above), so
      // this is the same kind of synthetic event this file already uses for
      // pairing states that need no execution (`event()`).
      const undeclared: RuntimeCapabilityInvocation = {
        tool: 'use_item',
        attempt: 1,
        instanceId: 'variant-item-1',
        recordKey: VARIANT_READINESS_ITEM_KEY,
        variantId: READY_VARIANT_ID,
        operationId: 'an-operation-this-record-does-not-declare',
        capabilityId: MAGIC_ITEM_OPERATION_READINESS_CAPABILITY.operationId,
        capabilityRevision: MAGIC_ITEM_OPERATION_READINESS_CAPABILITY.revision,
        outcome: 'blocked',
      };
      const withUndeclared = measureRuntimeDiscovery(
        trace,
        observations([...events, undeclared]),
      ).m10;
      expect(
        withUndeclared.runtimeInvocationsAbsentFromPacket.map(
          (item) => item.operationId,
        ),
      ).toEqual(['an-operation-this-record-does-not-declare']);
      // The real, declared invocation still pairs; the undeclared one never
      // rides along with it.
      expect(withUndeclared.comparisons).toEqual([
        expect.objectContaining({ agreement: 'agreed' }),
      ]);
    } finally {
      db.close();
    }
  });
});

/**
 * The model-visible tool contract, pinned against the pre-W9 shape at PR base
 * `a9196de`.
 *
 * Comparing shadow-on with shadow-off cannot prove this on its own: a change to
 * the public `use_item` payload would appear on both branches and the
 * comparison would false-green. These assertions therefore state the shape
 * directly, and they are exact key sets rather than absence checks so that any
 * future W9 field fails here rather than reaching the DM, the mechanics
 * auditor, the provider-owned MCP bridge, or `turn_trace.tool_calls_json`.
 */
describe('the public use_item contract is unchanged by W9', () => {
  it('returns exactly the pre-W9 success fields', () => {
    const db = freshDbWithSession();
    try {
      db.prepare(
        "UPDATE clock SET current_location_id='camp' WHERE id=1",
      ).run();
      heldItem(db, 'ammo-1', AMMO, 20);
      const { result, events } = invokeUseItem(db, {
        instanceId: 'ammo-1',
        operationId: 'hit-target',
      });
      expect(result.ok).toBe(true);
      const data = (result as { ok: true; data: Record<string, unknown> }).data;
      expect(Object.keys(data).sort()).toEqual([
        'consumed',
        'costs',
        'effects',
        'instanceId',
        'operationId',
        'packRef',
        'quantity',
        'transformations',
      ]);
      // Named explicitly because these two were the W9 additions now reverted.
      expect(data).not.toHaveProperty('capabilityPreflight');
      expect(data).not.toHaveProperty('variantId');
      // The observation still happened — through the private seam.
      expect(events).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('keeps the pre-existing blocked-readiness payload, and adds nothing', () => {
    const db = freshDbWithSession();
    try {
      heldItem(db, 'gem-1', GEM);
      const { result, events } = invokeUseItem(db, {
        instanceId: 'gem-1',
        operationId: BLOCKED_OPERATION,
      });
      expect(result.ok).toBe(false);
      const data = (result as { data?: Record<string, unknown> }).data;
      // The blocked error carried the ordinary campaign preflight at the PR
      // base, and still does: that is not W9 telemetry.
      expect(Object.keys(data ?? {}).sort()).toEqual([
        'ambiguities',
        'capabilityId',
        'position',
        'reason',
        'revision',
        'status',
      ]);
      // The M10 subject is internal and must NOT ride on the public payload.
      expect(data).not.toHaveProperty('subject');
      expect(events).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('does not attach a preflight payload to a downstream failure', () => {
    const db = freshDbWithSession();
    try {
      heldItem(db, 'ammo-1', AMMO, 20);
      const { result, events } = invokeUseItem(db, {
        instanceId: 'ammo-1',
        operationId: 'hit-target',
      });
      expect(result.ok).toBe(false);
      // At the PR base this error carried no capability payload, because the
      // failure is not the capability's. W9 observes it privately instead.
      expect((result as { data?: unknown }).data).toBeUndefined();
      expect(events[0]).toMatchObject({ outcome: 'available' });
    } finally {
      db.close();
    }
  });

  it('cannot be turned into a tool error by a faulty observer', () => {
    const db = freshDbWithSession();
    try {
      db.prepare(
        "UPDATE clock SET current_location_id='camp' WHERE id=1",
      ).run();
      heldItem(db, 'ammo-1', AMMO, 20);
      // Observing must not be able to intervene. Without the guard the registry
      // would convert this throw into `tool_error`, which the DM and the
      // mechanics auditor would both see.
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
          observeCapabilityInvocation: () => {
            throw new Error('a faulty observer');
          },
        },
      );
      expect(result.ok).toBe(true);
    } finally {
      db.close();
    }
  });

  it('installs no observer on a turn that is not recording', () => {
    const db = freshDbWithSession();
    try {
      db.prepare(
        "UPDATE clock SET current_location_id='camp' WHERE id=1",
      ).run();
      heldItem(db, 'ammo-1', AMMO, 20);
      // The same call with no observer in the context: the tool behaves
      // identically, so nothing about the capability path depends on being
      // watched.
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
      expect(result.ok).toBe(true);
    } finally {
      db.close();
    }
  });
});
