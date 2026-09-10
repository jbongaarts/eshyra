import { describe, expect, it } from 'vitest';
import type {
  CampaignRulesPackResolver,
  RulesPack,
  RuntimeCapabilityInvocation,
  TraceJsonValue,
} from '../../src/internal.js';
import {
  captureDiscoveryShadow,
  completeDiscoveryShadowEvidence,
  createDefaultToolRegistry,
  DiscoveryShadowSchemaError,
  encodeDiscoveryShadowEvidence,
  MAGIC_ITEM_OPERATION_READINESS_CAPABILITY,
  NULL_CAMPAIGN_RULE_SEAM,
  readDiscoveryShadowEvidence,
} from '../../src/internal.js';
import {
  CURSED_ATTUNEMENT_OVERRIDDEN_ITEM_REF,
  installCursedAttunementAddon,
} from '../support/cursedAttunementAddon.js';
import {
  DEFAULT_TEST_CAMPAIGN_POSITION,
  freshDbWithSession,
} from '../support/db.js';

/**
 * The durable v1 read boundary.
 *
 * The contract this suite defends: if `readDiscoveryShadowEvidence` returns a
 * `discovery-shadow-v1` value, every invariant M1-M11 or baseline qualification
 * relies on is ALREADY TRUE. Malformed same-version state must fail here rather
 * than becoming an absence, a vacuously green flag, an invented count, or an
 * exception inside a measurement.
 *
 * Leaf types are the easy half. The invariants that keep costing review cycles
 * are semantic: required MEMBERSHIP (the five blockers), stage IDENTITY and
 * lifecycle legality, accounting PARTITIONS, and cross-field agreement. Those
 * are what this suite corrupts.
 *
 * Every mutation asserts that the unmodified fixture really contains the state
 * it breaks, so no case can pass vacuously.
 */

const AT = '2026-05-20T10:00:00.000Z';
const CUBE = 'magic-item:cube-of-force';

type Row = Record<string, unknown>;

/**
 * One rich valid row: a Cube of Force capture (an ambiguity on the packet
 * candidate and on both rule joins, plus a blocked capability preflight) with a
 * real audit history and a runtime capability event. A fixture missing any of
 * that would make the corresponding mutations vacuous.
 */
const VALID: Row = (() => {
  const db = freshDbWithSession();
  try {
    const invocation: RuntimeCapabilityInvocation = {
      tool: 'use_item',
      attempt: 1,
      instanceId: 'cube-1',
      recordKey: CUBE,
      operationId: 'press-face-1',
      capabilityId: MAGIC_ITEM_OPERATION_READINESS_CAPABILITY.operationId,
      capabilityRevision: MAGIC_ITEM_OPERATION_READINESS_CAPABILITY.revision,
      outcome: 'blocked',
    };
    return encodeDiscoveryShadowEvidence(
      completeDiscoveryShadowEvidence(
        captureDiscoveryShadow({
          db,
          campaignPosition: DEFAULT_TEST_CAMPAIGN_POSITION,
          capturedAt: AT,
          playerInput: 'I press a face of the cube.',
          stateFields: { itemRecord: CUBE, operationId: 'press-face-1' },
          itemInstances: [{ instanceId: 'cube-1', recordKey: CUBE }],
          campaignRuleSeam: NULL_CAMPAIGN_RULE_SEAM,
          tools: createDefaultToolRegistry(),
        }),
        {
          capabilityInvocations: [invocation],
          auditorPresent: true,
          auditAttempts: [
            {
              attempt: 1,
              verdict: 'reject',
              action: 'retry',
              retryCause: 'missing_world_evidence',
              missingTools: ['lookup_rules'],
            },
            {
              attempt: 2,
              verdict: 'accept',
              action: 'accept',
              retryCause: null,
              missingTools: [],
            },
          ],
        },
      ),
    ) as Row;
  } finally {
    db.close();
  }
})();

function clone(): Row {
  return JSON.parse(JSON.stringify(VALID)) as Row;
}

/**
 * A clone with one field genuinely ABSENT at the given dotted path.
 *
 * Rebuilt rather than deleted or set to `undefined`: a stored row that lost a
 * field lost it entirely, and setting the key to `undefined` would test a shape
 * SQLite could never hold.
 */
function withoutField(path: string): Row {
  const parts = path.split('.');
  const last = parts[parts.length - 1];
  const row = clone();
  const at = (node: unknown, keys: readonly string[]): Row =>
    keys.reduce<Row>((current, key) => current[key] as Row, node as Row);
  const parent = at(row, parts.slice(0, -1));
  const rebuilt = Object.fromEntries(
    Object.entries(parent).filter(([key]) => key !== last),
  );
  if (parts.length === 1) return rebuilt as Row;
  const grandparent = at(row, parts.slice(0, -2));
  grandparent[parts[parts.length - 2]] = rebuilt;
  return row;
}

function trace(row: Row): Row {
  return row.trace as Row;
}

function stage(row: Row, property: string): Row {
  return trace(row)[property] as Row;
}

function packetCandidates(row: Row): Row[] {
  return (stage(row, 'packet').packet as Row).candidates as Row[];
}

/** The Cube of Force packet candidate: the one carrying ambiguities and a capability. */
function cubeCandidate(row: Row): Row {
  const found = packetCandidates(row).find(
    (candidate) => (candidate.identity as Row).key === CUBE,
  );
  if (found === undefined)
    throw new Error('the valid fixture has no Cube of Force packet candidate');
  return found;
}

function cubeIndex(): number {
  return packetCandidates(VALID).findIndex(
    (candidate) => (candidate.identity as Row).key === CUBE,
  );
}

function emittedIds(row: Row, property: string): string[] {
  const outputs = stage(row, property).outputsProduced as Row[];
  if (property === 'signals')
    return outputs.map((item) => item.signalId as string);
  if (property === 'packet')
    return outputs.map((item) => (item.identity as Row).key as string);
  return outputs.map((item) => item.candidateKey as string);
}

/** The stage property whose recorded state a mutation needs, or a hard failure. */
function stageWith(predicate: (stage: Row) => boolean): string {
  const property = [
    'signals',
    'candidates',
    'expansion',
    'ruleJoin',
    'ruleExpansion',
    'lateRuleJoin',
    'dedup',
    'retention',
    'packet',
  ].find((name) => predicate(stage(VALID, name)));
  if (property === undefined)
    throw new Error('the valid fixture has no stage in the required state');
  return property;
}

function rejects(row: unknown, at: string): void {
  let thrown: unknown;
  try {
    readDiscoveryShadowEvidence(row as TraceJsonValue);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DiscoveryShadowSchemaError);
  expect((thrown as Error).message).toContain(at);
}

describe('durable v1 evidence fails closed', () => {
  it('accepts the value it writes, and reads absence as absence', () => {
    expect(readDiscoveryShadowEvidence(VALID as TraceJsonValue)?.schema).toBe(
      'discovery-shadow-v1',
    );
    expect(readDiscoveryShadowEvidence(undefined)).toBeUndefined();
    expect(readDiscoveryShadowEvidence(null)).toBeUndefined();
  });

  it('has the rich state the mutations below corrupt', () => {
    expect((VALID.blockerRepairs as Row[]).map((b) => b.blockerId)).toEqual([
      'B1',
      'B2',
      'B3',
      'B4',
      'B5',
    ]);
    const cube = cubeCandidate(VALID);
    expect((cube.ambiguities as unknown[]).length).toBeGreaterThan(0);
    expect(cube.capability).toMatchObject({ status: 'blocked' });
    for (const join of ['ruleJoin', 'lateRuleJoin'])
      expect(
        (stage(VALID, join).unresolvedAmbiguities as unknown[]).length,
      ).toBeGreaterThan(0);
    expect((VALID.runtime as Row).auditorPresent).toBe(true);
    expect(((VALID.runtime as Row).auditAttempts as unknown[]).length).toBe(2);
    expect(
      ((VALID.runtime as Row).capabilityInvocations as unknown[]).length,
    ).toBe(1);
  });

  it('rejects a non-object and an unknown schema tag', () => {
    for (const bad of ['nonsense', { ...VALID, schema: 'discovery-shadow-v2' }])
      expect(() =>
        readDiscoveryShadowEvidence(bad as TraceJsonValue),
      ).toThrowError(DiscoveryShadowSchemaError);
  });

  it('rejects a row carrying neither a trace nor a failure, or both', () => {
    rejects(withoutField('trace'), 'trace/failure');
    rejects(
      { ...VALID, failure: { stage: 'discovery', message: 'x' } },
      'trace/failure',
    );
  });

  describe('blocker membership', () => {
    it('rejects an omitted blocker', () => {
      const row = clone();
      row.blockerRepairs = (row.blockerRepairs as Row[]).filter(
        (item) => item.blockerId !== 'B1',
      );
      expect((row.blockerRepairs as Row[]).length).toBe(4);
      rejects(row, 'omits B1');
    });

    it('rejects a duplicated blocker', () => {
      const row = clone();
      const b3 = (row.blockerRepairs as Row[]).find(
        (item) => item.blockerId === 'B3',
      );
      row.blockerRepairs = [...(row.blockerRepairs as Row[]), b3 as Row];
      rejects(row, 'repeats a blocker id');
    });

    it('rejects an empty blocker list on a successful trace', () => {
      // The dangerous shape: every `all repaired` baseline check passes
      // vacuously over an empty set.
      const row = clone();
      row.blockerRepairs = [];
      rejects(row, 'omits B1');
    });

    it('still requires the complete set when discovery itself failed', () => {
      const row = withoutField('trace');
      row.failure = { stage: 'discovery', message: 'seam refused' };
      row.blockerRepairs = [];
      rejects(row, 'omits B1');
    });

    it('accepts an empty list when the capture failed before observing them', () => {
      const row = withoutField('trace');
      row.blockerRepairs = [];
      for (const stageName of ['scenario', 'stack', 'blockers']) {
        row.failure = { stage: stageName, message: 'could not resolve' };
        expect(
          readDiscoveryShadowEvidence(row as TraceJsonValue)?.failure?.stage,
        ).toBe(stageName);
      }
      // ... but never a duplicate, whenever it did record some.
      const b1 = (VALID.blockerRepairs as Row[])[0];
      row.blockerRepairs = [b1, b1];
      row.failure = { stage: 'blockers', message: 'x' };
      rejects(row, 'repeats a blocker id');
    });
  });

  describe('stage identity, order and lifecycle', () => {
    it('rejects a mandatory stage reporting a conditional skip', () => {
      const row = clone();
      const signals = stage(row, 'signals');
      expect(signals.outcome).toBe('ran');
      signals.outcome = 'skipped';
      signals.produced = [];
      signals.modified = [];
      signals.carriedForward = emittedIds(row, 'signals');
      signals.losses = [];
      rejects(row, 'not a conditional stage');
    });

    it('rejects a conditional stage reporting failed-to-run', () => {
      const row = clone();
      const conditional = stage(row, 'lateRuleJoin');
      expect(conditional.outcome).toBe('skipped');
      conditional.outcome = 'failed-to-run';
      conditional.failedToRun = true;
      rejects(row, "never 'failed-to-run'");
    });

    it('rejects a stage that claims work while reporting it did none', () => {
      const row = clone();
      const signals = stage(row, 'signals');
      signals.outcome = 'failed-to-run';
      signals.failedToRun = true;
      rejects(row, 'did no work');
    });

    it('rejects a wrong embedded stage name', () => {
      const row = clone();
      expect(stage(row, 'dedup').stage).toBe('dedup');
      stage(row, 'dedup').stage = 'retention';
      rejects(row, 'not the v1 stage');
    });

    it('rejects a reordered stage order', () => {
      const row = clone();
      const order = trace(row).stageOrder as string[];
      expect(order[0]).toBe('signals');
      trace(row).stageOrder = [order[1], order[0], ...order.slice(2)];
      rejects(row, 'not the v1 order');
    });

    it('rejects a truncated stage order', () => {
      const row = clone();
      trace(row).stageOrder = (trace(row).stageOrder as string[]).slice(0, 8);
      rejects(row, 'not the v1 order');
    });
  });

  describe('stage accounting integrity', () => {
    it('rejects a repeated accounting identity', () => {
      const property = stageWith(
        (item) => (item.produced as string[]).length > 0,
      );
      const row = clone();
      const target = stage(row, property);
      target.produced = [
        ...(target.produced as string[]),
        (target.produced as string[])[0],
      ];
      rejects(row, 'repeat an identity');
    });

    it('rejects one identity claimed by two accounting sets', () => {
      const property = stageWith(
        (item) =>
          item.outcome === 'ran' &&
          (item.carriedForward as string[]).length > 0,
      );
      const row = clone();
      const target = stage(row, property);
      target.modified = [
        ...(target.modified as string[]),
        (target.carriedForward as string[])[0],
      ];
      rejects(row, 'repeat an identity');
    });

    it('rejects an emitted identity missing from the accounting', () => {
      const property = stageWith(
        (item) => (item.produced as string[]).length > 1,
      );
      const row = clone();
      const target = stage(row, property);
      target.produced = (target.produced as string[]).slice(1);
      rejects(row, 'but emitted');
    });

    it('rejects accounting for an identity that was never emitted', () => {
      const property = stageWith(
        (item) => (item.produced as string[]).length > 0,
      );
      const row = clone();
      const target = stage(row, property);
      const kept = target.produced as string[];
      target.produced = [...kept.slice(1), 'candidate:never-emitted'];
      rejects(row, 'which it did not emit');
    });

    it('rejects a duplicated emitted packet candidate', () => {
      const row = clone();
      const candidates = packetCandidates(row);
      expect(candidates.length).toBeGreaterThan(1);
      (stage(row, 'packet').packet as Row).candidates = [
        ...candidates,
        candidates[0],
      ];
      rejects(row, 'repeats an emitted identity');
    });
  });

  describe('cross-field semantics M6 and M7 read', () => {
    it('rejects an overflow record that the flag denies', () => {
      const row = clone();
      const retention = stage(row, 'retention');
      expect(retention.overflowed).toBe(false);
      retention.overflow = [
        {
          candidateKey: emittedIds(row, 'retention')[0],
          band: 'must-consider',
          routes: [],
          reason: 'forged',
        },
      ];
      rejects(row, 'overflow record(s) are present');
    });

    it('rejects a forged packet byte count', () => {
      const row = clone();
      const packet = stage(row, 'packet').packet as Row;
      expect(typeof packet.bytes).toBe('number');
      packet.bytes = 12;
      rejects(row, 'serialize to');
    });
  });

  describe('packet capability identity', () => {
    function evaluated(row: Row): Row {
      return cubeCandidate(row).capability as Row;
    }

    for (const key of ['capabilityId', 'revision', 'operationId'])
      it(`rejects an evaluated capability missing ${key}`, () => {
        expect(evaluated(VALID)[key]).toBeDefined();
        rejects(
          withoutField(
            `trace.packet.packet.candidates.${cubeIndex()}.capability.${key}`,
          ),
          `capability.${key}`,
        );
      });

    it('accepts a not-evaluated-offline declaration without them', () => {
      const row = clone();
      const capability = evaluated(row);
      capability.status = 'not-evaluated-offline';
      capability.revision = undefined;
      capability.operationId = undefined;
      // The packet's recorded size is part of the same evidence, so a rewritten
      // packet has to carry the size it actually serializes to.
      const packet = stage(row, 'packet').packet as Row;
      packet.bytes = Buffer.byteLength(
        JSON.stringify(packet.candidates),
        'utf8',
      );
      expect(readDiscoveryShadowEvidence(row as TraceJsonValue)?.schema).toBe(
        'discovery-shadow-v1',
      );
    });
  });

  describe('runtime capability events', () => {
    function invocation(row: Row): Row {
      return ((row.runtime as Row).capabilityInvocations as Row[])[0];
    }

    for (const key of [
      'recordKey',
      'capabilityRevision',
      'operationId',
      'instanceId',
    ])
      it(`rejects an event missing ${key}`, () => {
        expect(invocation(VALID)[key]).toBeDefined();
        rejects(
          withoutField(`runtime.capabilityInvocations.0.${key}`),
          `capabilityInvocations[0].${key}`,
        );
      });

    for (const attempt of [0, 1.5, -1])
      it(`rejects an event with attempt ${attempt}`, () => {
        const row = clone();
        invocation(row).attempt = attempt;
        rejects(row, 'a candidate attempt is an integer from 1');
      });

    it('rejects an outcome that is not a capability status', () => {
      const row = clone();
      invocation(row).outcome = 'not-a-capability-outcome';
      rejects(row, 'capabilityInvocations[0].outcome');
    });
  });

  describe('M11 auditor presence and history', () => {
    function runtime(row: Row): Row {
      return row.runtime as Row;
    }

    it('rejects a present auditor with no recorded verdict', () => {
      const row = clone();
      runtime(row).auditAttempts = [];
      rejects(row, 'is empty while runtime.auditorPresent is true');
    });

    it('rejects an absent auditor with recorded verdicts', () => {
      const row = clone();
      runtime(row).auditorPresent = false;
      rejects(row, 'runtime.auditorPresent is false');
    });

    it('rejects non-sequential attempt numbers', () => {
      const row = clone();
      (runtime(row).auditAttempts as Row[])[1].attempt = 3;
      rejects(row, 'numbered sequentially from 1');
    });

    it('rejects duplicated attempt numbers', () => {
      const row = clone();
      (runtime(row).auditAttempts as Row[])[1].attempt = 1;
      rejects(row, 'numbered sequentially from 1');
    });

    it('rejects an accepted-turn history ending in a retry or a failure', () => {
      for (const [verdict, action] of [
        ['reject', 'retry'],
        ['reject', 'fail'],
      ] as const) {
        const row = clone();
        const attempts = runtime(row).auditAttempts as Row[];
        attempts[1].verdict = verdict;
        attempts[1].action = action;
        rejects(row, "ends in 'accept' or 'repair'");
      }
    });

    it('rejects an incoherent verdict and action', () => {
      const row = clone();
      (runtime(row).auditAttempts as Row[])[0].action = 'accept';
      rejects(row, 'not coherent with verdict');
    });
  });

  describe('nested identities the measurements filter rather than fail on', () => {
    function cubeAmbiguities(row: Row): unknown[] {
      return cubeCandidate(row).ambiguities as unknown[];
    }

    for (const broken of [{}, { id: 7 }, { id: null }])
      it(`rejects a packet ambiguity of ${JSON.stringify(broken)}`, () => {
        const row = clone();
        expect(cubeAmbiguities(row).length).toBeGreaterThan(0);
        cubeAmbiguities(row)[0] = broken;
        rejects(row, 'ambiguities[0].id');
      });

    for (const join of ['ruleJoin', 'lateRuleJoin'])
      it(`rejects an unresolved ambiguity with no id on ${join}`, () => {
        const row = clone();
        expect(
          (stage(row, join).unresolvedAmbiguities as unknown[]).length,
        ).toBeGreaterThan(0);
        stage(row, join).unresolvedAmbiguities = [{ note: 'no id here' }];
        rejects(row, `trace.${join}.unresolvedAmbiguities[0].id`);
      });

    it('rejects a jhpt projection carrying no rule identity', () => {
      const row = clone();
      packetCandidates(row)[0].campaignRulings = [{ prose: 'no identity' }];
      rejects(row, 'campaignRulings[0].ruleIdentity');
    });
  });

  describe('leaf families each measurement dereferences', () => {
    const MUTATIONS: readonly [string, () => Row, string][] = [
      [
        'stage outcome enum',
        () => {
          const row = clone();
          stage(row, 'dedup').outcome = 'probably-ran';
          return row;
        },
        'trace.dedup.outcome',
      ],
      [
        'failedToRun invariant',
        () => {
          const row = clone();
          stage(row, 'dedup').failedToRun = true;
          return row;
        },
        'trace.dedup.failedToRun',
      ],
      [
        'route identity',
        () => {
          const row = clone();
          (stage(row, 'candidates').outputsProduced as Row[])[0].routes = [{}];
          return row;
        },
        'routes[0]',
      ],
      [
        'rule-join field',
        () => withoutField('trace.ruleJoin.requestedRuleRecordKeys'),
        'trace.ruleJoin.requestedRuleRecordKeys',
      ],
      [
        'ruling query scope enum',
        () => {
          const row = clone();
          stage(row, 'ruleJoin').rulingQueryScope = 'sometimes';
          return row;
        },
        'trace.ruleJoin.rulingQueryScope',
      ],
      [
        'traversal shape',
        () => {
          const row = clone();
          stage(row, 'expansion').traversals = [{ relation: 'x' }];
          return row;
        },
        'trace.expansion.traversals[0]',
      ],
      [
        'drop reason',
        () => {
          const row = clone();
          stage(row, 'retention').dropped = [{ candidateKey: 'k' }];
          return row;
        },
        'trace.retention.dropped[0]',
      ],
      [
        'retained band enum',
        () => {
          const row = clone();
          (stage(row, 'retention').outputsProduced as Row[])[0].band = 'urgent';
          return row;
        },
        '.band',
      ],
      [
        'packet provenance',
        () => withoutField('trace.packet.packet.candidates.0.provenance'),
        '.provenance',
      ],
      [
        'packet non-claim',
        () => {
          const row = clone();
          (stage(row, 'packet').packet as Row).modelUsageClaim = 'used';
          return row;
        },
        'modelUsageClaim',
      ],
      [
        'stack identity',
        () => withoutField('trace.stack.base.version'),
        'trace.stack.base.version',
      ],
      [
        'scenario binding',
        () => {
          const row = clone();
          (row.scenario as Row).itemInstances = [{ instanceId: 'x' }];
          return row;
        },
        'scenario.itemInstances[0].recordKey',
      ],
      [
        'recorded non-claim',
        () => {
          const row = clone();
          row.modelUsageClaim = 'the model used it';
          return row;
        },
        'modelUsageClaim',
      ],
      [
        'blocker status enum',
        () => {
          const row = clone();
          (row.blockerRepairs as Row[])[0].status = 'probably-repaired';
          return row;
        },
        'blockerRepairs[0].status',
      ],
    ];

    for (const [family, build, at] of MUTATIONS)
      it(`rejects a malformed ${family}`, () => {
        const row = build();
        expect(JSON.stringify(row)).not.toBe(JSON.stringify(VALID));
        rejects(row, at);
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
