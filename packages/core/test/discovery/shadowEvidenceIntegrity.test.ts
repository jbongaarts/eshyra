import { describe, expect, it } from 'vitest';
import type {
  DiscoveryShadowEvidence,
  ProjectedDiscoveryTrace,
  RuntimeCapabilityInvocation,
  TraceJsonValue,
} from '../../src/internal.js';
import {
  captureDiscoveryShadow,
  completeDiscoveryShadowEvidence,
  createDefaultToolRegistry,
  DiscoveryShadowSchemaError,
  encodeDiscoveryShadowEvidence,
  measureRuntimeDiscovery,
  NULL_CAMPAIGN_RULE_SEAM,
  observeRuntimeCapabilityInvocations,
  readDiscoveryShadowEvidence,
} from '../../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_POSITION,
  freshDbWithSession,
} from '../support/db.js';

const AT = '2026-05-20T10:00:00.000Z';
const AMMO = 'magic-item:ammunition-1-2-or-3';

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
    outcome: 'available',
    ...overrides,
  };
}

describe('M10 capability identity', () => {
  it('reads the subject the runtime reported, not the pre-model binding', () => {
    // A successful `use_item` reports the pack ref and variant it resolved.
    // The pre-model binding disagrees on purpose: if the snapshot were used,
    // the observation would name the stale variant.
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
        outcome: 'available',
      },
    ]);
  });

  it('labels a fallback to the pre-model binding when the runtime reports no subject', () => {
    const observed = observeRuntimeCapabilityInvocations(
      [
        {
          tool: 'use_item',
          args: { instanceId: 'ammunition-stack-1', operationId: 'hit-target' },
          result: {
            ok: false,
            code: 'item_error',
            message: 'blocked',
            data: { status: 'blocked', capabilityId: 'x' },
          },
        },
      ],
      [{ instanceId: 'ammunition-stack-1', recordKey: AMMO, variantId: '1' }],
    );
    expect(observed[0].subjectSource).toBe('pre-model-binding');
    expect(observed[0].variantId).toBe('1');
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

  const rejects = (stored: unknown, detail: string): void => {
    expect(() =>
      readDiscoveryShadowEvidence(stored as TraceJsonValue),
    ).toThrowError(DiscoveryShadowSchemaError);
    expect(() => readDiscoveryShadowEvidence(stored as TraceJsonValue)).toThrow(
      new RegExp(detail, 'u'),
    );
  };

  it('accepts the value it writes, and reads absence as absence', () => {
    expect(readDiscoveryShadowEvidence(valid as TraceJsonValue)?.schema).toBe(
      'discovery-shadow-v1',
    );
    expect(readDiscoveryShadowEvidence(undefined)).toBeUndefined();
    expect(readDiscoveryShadowEvidence(null)).toBeUndefined();
  });

  it('rejects a schema-correct row carrying neither a trace nor a failure', () => {
    const { trace: _trace, ...rest } = valid;
    rejects(rest, 'neither a trace nor a failure');
  });

  it('rejects a schema-correct row carrying both', () => {
    rejects(
      { ...valid, failure: { stage: 'discovery', message: 'x' } },
      'both a trace and a failure',
    );
  });

  it('rejects a bare schema tag', () => {
    rejects({ schema: 'discovery-shadow-v1' }, 'scenario is not an object');
  });

  it('rejects malformed runtime observations', () => {
    rejects(
      { ...valid, runtime: { capabilityInvocations: {}, auditAttempts: [] } },
      'runtime.capabilityInvocations is not an array',
    );
    rejects({ ...valid, runtime: null }, 'runtime is not an object');
  });

  it('rejects a trace missing a stage or its accounting', () => {
    const { signals: _signals, ...stages } = valid.trace as Record<
      string,
      unknown
    >;
    rejects({ ...valid, trace: stages }, 'trace.signals is not an object');
    rejects(
      {
        ...valid,
        trace: {
          ...(valid.trace as Record<string, unknown>),
          dedup: { ...(stages.dedup as object), produced: 'none' },
        },
      },
      'trace.dedup.produced is not an array',
    );
  });

  it('rejects a fabricated non-claim', () => {
    rejects({ ...valid, modelUsageClaim: 'the model used it' }, 'non-claim');
  });

  it('still rejects an unknown schema tag', () => {
    expect(() =>
      readDiscoveryShadowEvidence({
        ...valid,
        schema: 'discovery-shadow-v2',
      } as TraceJsonValue),
    ).toThrowError(DiscoveryShadowSchemaError);
  });
});
