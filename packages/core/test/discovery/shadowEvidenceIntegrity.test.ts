import { describe, expect, it } from 'vitest';
import type {
  CampaignRulesPackResolver,
  ProjectedDiscoveryTrace,
  RulesPack,
  RuntimeCapabilityInvocation,
  TraceJsonValue,
} from '../../src/internal.js';
import {
  captureDiscoveryShadow,
  completeDiscoveryShadowEvidence,
  createDefaultToolRegistry,
  DiscoveryShadowSchemaError,
  deriveDiscoveryTrace,
  encodeDiscoveryShadowEvidence,
  MAGIC_ITEM_OPERATION_READINESS_CAPABILITY,
  measureDiscovery,
  measureRuntimeDiscovery,
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
 * The durable v1 boundary, after the canonical-evidence redesign.
 *
 * The record now holds canonical facts ONCE — the candidate stream, the seam's
 * queries and returned projections, one retention disposition per decided
 * candidate, one packet inclusion decision plus the included content, and the
 * audit lifecycle as a discriminated shape. Every summary M1-M11 reports is
 * derived from those at measurement time.
 *
 * That changes what has to be proved, so this suite proves two things rather
 * than one:
 *
 * 1. **Fail-closed admission.** A canonical record that could not have been
 *    emitted — a broken identity, an uncovered decision, an impossible
 *    lifecycle — is rejected at the read boundary.
 * 2. **Truthful derivation.** A canonical record that IS admissible produces a
 *    measurement that matches it, including when corrupted. There is no second
 *    copy of any fact to move, so a corruption cannot make one surface say a
 *    candidate was dropped while another says the packet is clean; it changes
 *    the measurement truthfully instead.
 *
 * The second class is the one that closes the defect that survived four rounds
 * of validator hardening, and it is why this file is much smaller than the
 * predicate matrix it replaces.
 */

const AT = '2026-05-20T10:00:00.000Z';
const CUBE = 'magic-item:cube-of-force';

type Row = Record<string, unknown>;

/**
 * One rich valid row: a Cube of Force capture (ambiguities on the packet
 * candidate and on both rule joins, plus a blocked capability preflight) with a
 * real audit lifecycle and a runtime capability event. A fixture missing any of
 * that would make the corresponding cases vacuous.
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
          audit: {
            auditor: 'present',
            retries: [
              {
                retryCause: 'missing_world_evidence',
                missingTools: ['lookup_rules'],
              },
            ],
            outcome: { disposition: 'accepted' },
          },
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

function trace(row: Row): Row {
  return row.trace as Row;
}

function stage(row: Row, property: string): Row {
  return trace(row)[property] as Row;
}

function candidates(row: Row, property: string): Row[] {
  return stage(row, property).outputsProduced as Row[];
}

function packetContent(row: Row): Row[] {
  return stage(row, 'packet').candidates as Row[];
}

function admitted(row: Row): ProjectedDiscoveryTrace {
  const evidence = readDiscoveryShadowEvidence(row as TraceJsonValue);
  if (evidence?.trace === undefined)
    throw new Error('the row was admitted without a trace');
  return evidence.trace;
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

/** A clone with one field genuinely ABSENT at the given dotted path. */
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

describe('the canonical durable record', () => {
  it('holds the rich state the cases below rely on', () => {
    expect((VALID.blockerRepairs as Row[]).map((b) => b.blockerId)).toEqual([
      'B1',
      'B2',
      'B3',
      'B4',
      'B5',
    ]);
    const cube = packetContent(VALID).find(
      (item) => (item.identity as Row).key === CUBE,
    );
    if (cube === undefined)
      throw new Error(
        'the valid fixture has no Cube of Force packet candidate',
      );
    expect((cube.ambiguities as unknown[]).length).toBeGreaterThan(0);
    expect(cube.capability).toMatchObject({ status: 'blocked' });
    for (const join of ['ruleJoin', 'lateRuleJoin'])
      expect(
        (stage(VALID, join).consideredAmbiguityIds as unknown[]).length,
      ).toBeGreaterThan(0);
    expect((stage(VALID, 'ruleJoin').seamQueries as unknown[]).length).toBe(2);
    expect(
      (stage(VALID, 'retention').dispositions as unknown[]).length,
    ).toBeGreaterThan(1);
    expect((VALID.runtime as Row).audit).toMatchObject({ auditor: 'present' });
  });

  it('records no summary a measurement could contradict', () => {
    // The redundant surfaces the previous rounds kept re-proving consistent are
    // simply not stored any more.
    for (const property of ['signals', 'candidates', 'expansion', 'dedup'])
      for (const field of [
        'produced',
        'modified',
        'carriedForward',
        'failedToRun',
      ])
        expect(stage(VALID, property)[field]).toBeUndefined();
    expect(stage(VALID, 'expansion').traversals).toBeUndefined();
    for (const field of ['returnedRuleIdentities', 'placedRuleIdentities'])
      expect(stage(VALID, 'ruleJoin')[field]).toBeUndefined();
    for (const field of ['dropped', 'overflow', 'overflowed', 'losses'])
      expect(stage(VALID, 'retention')[field]).toBeUndefined();
    for (const field of [
      'bytes',
      'byteOverflow',
      'byteBudgetExceeded',
      'losses',
    ])
      expect(stage(VALID, 'packet')[field]).toBeUndefined();
    expect(trace(VALID).stageOrder).toBeUndefined();
    expect((VALID.runtime as Row).auditorPresent).toBeUndefined();
  });

  it('accepts the value it writes, and reads absence as absence', () => {
    expect(readDiscoveryShadowEvidence(VALID as TraceJsonValue)?.schema).toBe(
      'discovery-shadow-v1',
    );
    expect(readDiscoveryShadowEvidence(undefined)).toBeUndefined();
    expect(readDiscoveryShadowEvidence(null)).toBeUndefined();
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
});

/**
 * A corrupted canonical fact changes the measurement TRUTHFULLY. This is the
 * property the redesign buys: with no independently trusted second copy, a
 * coordinated corruption cannot exist, because there is nothing to coordinate
 * with.
 */
describe('measurements follow the canonical record', () => {
  it('reports a dropped must-consider candidate as an overflow, always', () => {
    const row = clone();
    const dispositions = stage(row, 'retention').dispositions as Row[];
    const target = dispositions.find((item) => item.retained === true) as Row;
    const key = target.candidateKey as string;
    expect(measureDiscovery(admitted(row)).m6.allMustConsiderRetained).toBe(
      true,
    );

    // Flip the ONE canonical fact. There is no overflow array or flag to leave
    // behind: M6's overflow, its flag and M7's drop list are all derived from
    // this decision.
    target.retained = false;
    target.reason = 'must-consider set exceeds maxCandidates';
    // The packet decided over the retained set, so its decision goes too.
    stage(row, 'packet').decisions = (
      stage(row, 'packet').decisions as Row[]
    ).filter((item) => item.candidateKey !== key);
    stage(row, 'packet').candidates = packetContent(row).filter(
      (item) => (item.identity as Row).key !== key,
    );

    const derived = deriveDiscoveryTrace(admitted(row));
    expect(derived.retention.overflowed).toBe(true);
    expect(derived.retention.overflow.map((item) => item.candidateKey)).toEqual(
      [key],
    );
    const m = measureDiscovery(admitted(row), {
      mustIncludeTargetRefs: [key],
    });
    expect(m.m6.allMustConsiderRetained).toBe(false);
    expect(m.m6.overflow.map((item) => item.candidateKey)).toEqual([key]);
    // ... and the same fact reaches M1/M2/M7 rather than contradicting them.
    expect(m.m1[key]).toBe(false);
    expect(m.m2[key]).toBe('retention');
    expect(m.m7.drops.map((item) => item.candidateKey)).toContain(key);
  });

  it('reports a traversal as fired only while a candidate carries it', () => {
    const row = clone();
    const carrier = candidates(row, 'expansion').find(
      (item) => (item.traversals as unknown[]).length > 0,
    );
    if (carrier === undefined)
      throw new Error('the valid fixture records no traversal');
    const traversal = (carrier.traversals as Record<string, unknown>[])[0];
    expect(
      measureDiscovery(admitted(row), {
        requiredRelationshipExpansion: [traversal as never],
      }).m4[0].result,
    ).not.toBe('not-fired');

    // Remove it from the candidate — the only place it is recorded. There is
    // no stage-level list left holding the opposite claim.
    for (const item of candidates(row, 'expansion'))
      item.traversals = (item.traversals as Record<string, unknown>[]).filter(
        (entry) => JSON.stringify(entry) !== JSON.stringify(traversal),
      );
    expect(
      deriveDiscoveryTrace(admitted(row)).expansion.traversals,
    ).not.toContainEqual(traversal);
    expect(
      measureDiscovery(admitted(row), {
        requiredRelationshipExpansion: [traversal as never],
      }).m4[0].result,
    ).toBe('not-fired');
  });

  it('reports a rule as matched only while a placement records it', () => {
    const db = freshDbWithSession();
    try {
      // A capture whose join really placed a rule beside governing material.
      const resolver = installCursedAttunementAddon(db, AT);
      const ring = CURSED_ATTUNEMENT_OVERRIDDEN_ITEM_REF;
      const seam = {
        activeRulesAtPosition: () => [
          {
            ruleIdentity: 'house-rule:test',
            ruleKind: 'house-rule' as const,
            status: 'active',
            origin: 'player-authored',
            provenance: 'house-rule',
            effectivePosition: DEFAULT_TEST_CAMPAIGN_POSITION,
            supersededBy: null,
            revokedPosition: null,
            scope: 'campaign',
            governingRecordKeys: [ring],
          },
        ],
        activeRulingsForAmbiguities: () => [],
      };
      const capture = captureDiscoveryShadow({
        db,
        campaignPosition: DEFAULT_TEST_CAMPAIGN_POSITION,
        capturedAt: AT,
        playerInput: 'I turn the ring over.',
        stateFields: { itemRecord: ring },
        itemInstances: [],
        campaignRuleSeam: seam,
        resolveRulesPack: resolver,
        tools: createDefaultToolRegistry(),
      });
      const row = JSON.parse(
        JSON.stringify(
          encodeDiscoveryShadowEvidence(
            completeDiscoveryShadowEvidence(capture, {
              capabilityInvocations: [],
              audit: { auditor: 'absent' },
            }),
          ),
        ),
      ) as Row;
      expect(
        (stage(row, 'ruleJoin').placements as unknown[]).length,
      ).toBeGreaterThan(0);
      expect(measureDiscovery(admitted(row)).m5.matched).toEqual([
        'house-rule:test',
      ]);

      // Remove the placement. `matched`, `unplaced` and the placement detail
      // all move together because all three are derived from it.
      stage(row, 'ruleJoin').placements = [];
      const m5 = measureDiscovery(admitted(row)).m5;
      expect(m5.matched).toEqual([]);
      expect(m5.unplaced).toEqual(['house-rule:test']);
      expect(m5.placed).toEqual([]);
      // The retrieval itself is unchanged, because that is a different fact.
      expect(m5.returned).toEqual(['house-rule:test']);
    } finally {
      db.close();
    }
  });

  it('cannot resolve an ambiguity no returned ruling decided', () => {
    const row = clone();
    // M5 reports the LATE join's unresolved set, so that is the stage to try
    // this on.
    const join = stage(row, 'lateRuleJoin');
    expect(join.returnedProjections).toEqual([]);
    // Adding an id to what the stage considered cannot manufacture a
    // resolution: resolution derives from a placed RULING, not from a list.
    join.consideredAmbiguityIds = [
      ...(join.consideredAmbiguityIds as string[]),
      'ambiguity:invented',
    ];
    const m5 = measureDiscovery(admitted(row)).m5;
    expect(m5.resolvedAmbiguityIds).toEqual([]);
    expect(m5.unresolvedAmbiguityIds).toContain('ambiguity:invented');
  });

  it('derives auditor presence and causes from the lifecycle alone', () => {
    const row = clone();
    const observations = (record: Row) => ({
      capabilityInvocations: [],
      audit: (record.runtime as Row).audit as never,
    });
    const withAuditor = measureRuntimeDiscovery(
      admitted(row),
      observations(row),
    ).m11;
    expect(withAuditor).toMatchObject({
      auditorAbsent: false,
      primaryDmCandidates: 2,
      retries: 1,
      failures: 0,
      missingRuleEvidenceRetries: 1,
      byCause: { missing_world_evidence: 1 },
    });

    (row.runtime as Row).audit = { auditor: 'absent' };
    expect(
      measureRuntimeDiscovery(admitted(row), observations(row)).m11,
    ).toMatchObject({
      auditorAbsent: true,
      primaryDmCandidates: 0,
      retries: 0,
    });
  });
});

/** Canonical records a real run could not have emitted are refused. */
describe('canonical admissibility', () => {
  describe('blocker membership', () => {
    it('rejects an omitted, duplicated or empty blocker set', () => {
      const omitted = clone();
      omitted.blockerRepairs = (omitted.blockerRepairs as Row[]).filter(
        (item) => item.blockerId !== 'B1',
      );
      rejects(omitted, 'omits B1');

      const duplicated = clone();
      duplicated.blockerRepairs = [
        ...(duplicated.blockerRepairs as Row[]),
        (duplicated.blockerRepairs as Row[])[2],
      ];
      rejects(duplicated, 'repeats a blocker id');

      const empty = clone();
      empty.blockerRepairs = [];
      rejects(empty, 'omits B1');
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
    });
  });

  describe('stage identity and lifecycle', () => {
    it('rejects a mandatory stage reporting a conditional skip', () => {
      const row = clone();
      expect(stage(row, 'signals').outcome).toBe('ran');
      stage(row, 'signals').outcome = 'skipped';
      rejects(row, 'not a conditional stage');
    });

    it('rejects a conditional stage reporting failed-to-run', () => {
      const row = clone();
      expect(stage(row, 'lateRuleJoin').outcome).toBe('skipped');
      stage(row, 'lateRuleJoin').outcome = 'failed-to-run';
      rejects(row, "never 'failed-to-run'");
    });

    it('rejects a wrong embedded stage name', () => {
      const row = clone();
      stage(row, 'dedup').stage = 'retention';
      rejects(row, 'not the v1 stage');
    });
  });

  describe('decision coverage', () => {
    it('rejects a retention that decided over fewer candidates than dedup emitted', () => {
      const row = clone();
      const dispositions = stage(row, 'retention').dispositions as Row[];
      expect(dispositions.length).toBeGreaterThan(1);
      const dropped = dispositions[0].candidateKey as string;
      // A silent omission: no disposition, no drop, no loss — the candidate
      // would simply vanish from every measurement at once.
      stage(row, 'retention').dispositions = dispositions.slice(1);
      stage(row, 'packet').decisions = (
        stage(row, 'packet').decisions as Row[]
      ).filter((item) => item.candidateKey !== dropped);
      stage(row, 'packet').candidates = packetContent(row).filter(
        (item) => (item.identity as Row).key !== dropped,
      );
      rejects(row, 'records no disposition for');
    });

    it('rejects a retention that decided a candidate twice', () => {
      const row = clone();
      const dispositions = stage(row, 'retention').dispositions as Row[];
      stage(row, 'retention').dispositions = [...dispositions, dispositions[0]];
      rejects(row, 'decides one candidate twice');
    });

    it('rejects a retained candidate carrying an exclusion reason', () => {
      const row = clone();
      (stage(row, 'retention').dispositions as Row[])[0].reason = 'invented';
      rejects(row, 'is present on a retained candidate');
    });

    it('rejects a dropped candidate with no reason', () => {
      const row = clone();
      const dispositions = stage(row, 'retention').dispositions as Row[];
      dispositions[0].retained = false;
      rejects(row, 'dispositions[0].reason');
    });

    it('rejects packet content for a candidate the packet excluded', () => {
      const row = clone();
      const decisions = stage(row, 'packet').decisions as Row[];
      decisions[0].retained = false;
      decisions[0].reason = 'packet byte budget';
      rejects(row, 'while the recorded decisions include');
    });

    it('rejects packet content the decisions never included', () => {
      const row = clone();
      const content = packetContent(row);
      stage(row, 'packet').candidates = [...content, content[0]];
      rejects(row, 'repeats a candidate identity');
    });

    it('rejects a packet that decided over something retention did not keep', () => {
      const row = clone();
      stage(row, 'packet').decisions = [
        ...(stage(row, 'packet').decisions as Row[]),
        { candidateKey: 'rule:never-retained', retained: false, reason: 'x' },
      ];
      rejects(row, 'decides');
    });

    it('rejects losses stored on a stage that derives them', () => {
      const row = clone();
      stage(row, 'retention').losses = [
        { reason: 'invented', detail: { candidateKey: 'x' } },
      ];
      rejects(row, 'whose losses are derived from its decisions');
    });
  });

  describe('canonical seam evidence', () => {
    function join(row: Row): Row {
      return stage(row, 'ruleJoin');
    }

    it('rejects two queries of one kind in one stage', () => {
      const row = clone();
      const queries = join(row).seamQueries as Row[];
      join(row).seamQueries = [...queries, queries[0]];
      rejects(row, 'records a second');
    });

    it('rejects a placement of an identity the seam did not return', () => {
      const row = clone();
      join(row).placements = [
        { ruleIdentity: 'house-rule:never', governingRecordKey: CUBE },
      ];
      rejects(row, 'which the seam did not return here');
    });

    it('rejects a placement beside material the stage did not emit', () => {
      const row = clone();
      join(row).returnedProjections = [
        {
          ruleIdentity: 'house-rule:x',
          ruleKind: 'house-rule',
          status: 'active',
          origin: 'player-authored',
          provenance: 'house-rule',
          effectivePosition: DEFAULT_TEST_CAMPAIGN_POSITION,
          supersededBy: null,
          revokedPosition: null,
          scope: 'campaign',
          governingRecordKeys: ['rule:absent'],
        },
      ];
      join(row).placements = [
        { ruleIdentity: 'house-rule:x', governingRecordKey: 'rule:absent' },
      ];
      rejects(row, 'which this stage did not emit');
    });

    it('rejects a returned ruling with no ambiguity link', () => {
      const row = clone();
      join(row).returnedProjections = [
        {
          ruleIdentity: 'ruling:x',
          ruleKind: 'ruling',
          status: 'active',
          origin: 'player-authored',
          provenance: 'ambiguity:x#y',
          effectivePosition: DEFAULT_TEST_CAMPAIGN_POSITION,
          supersededBy: null,
          revokedPosition: null,
          scope: 'campaign',
          governingRecordKeys: [CUBE],
        },
      ];
      rejects(row, 'ambiguityId');
    });

    it('rejects a repeated returned identity', () => {
      const row = clone();
      const projection = {
        ruleIdentity: 'house-rule:x',
        ruleKind: 'house-rule',
        status: 'active',
        origin: 'player-authored',
        provenance: 'house-rule',
        effectivePosition: DEFAULT_TEST_CAMPAIGN_POSITION,
        supersededBy: null,
        revokedPosition: null,
        scope: 'campaign',
        governingRecordKeys: [CUBE],
      };
      join(row).returnedProjections = [projection, projection];
      rejects(row, 'repeats a rule identity');
    });
  });

  describe('candidate and packet identity', () => {
    it('rejects a repeated emitted candidate', () => {
      const row = clone();
      const emitted = candidates(row, 'dedup');
      stage(row, 'dedup').outputsProduced = [...emitted, emitted[0]];
      rejects(row, 'repeats a candidate identity');
    });

    it('rejects a repeated signal identity', () => {
      const row = clone();
      const emitted = candidates(row, 'signals');
      stage(row, 'signals').outputsProduced = [...emitted, emitted[0]];
      rejects(row, 'repeats a signal identity');
    });

    for (const key of ['capabilityId', 'revision', 'operationId'])
      it(`rejects an evaluated capability missing ${key}`, () => {
        const index = packetContent(VALID).findIndex(
          (item) => item.capability !== undefined,
        );
        expect(index).toBeGreaterThanOrEqual(0);
        rejects(
          withoutField(`trace.packet.candidates.${index}.capability.${key}`),
          `capability.${key}`,
        );
      });

    for (const broken of [{}, { id: 7 }, { id: null }])
      it(`rejects a packet ambiguity of ${JSON.stringify(broken)}`, () => {
        const row = clone();
        const cube = packetContent(row).find(
          (item) => (item.identity as Row).key === CUBE,
        ) as Row;
        expect((cube.ambiguities as unknown[]).length).toBeGreaterThan(0);
        (cube.ambiguities as unknown[])[0] = broken;
        rejects(row, 'ambiguities[0].id');
      });

    it('rejects a jhpt projection carrying no rule identity', () => {
      const row = clone();
      packetContent(row)[0].campaignRulings = [{ prose: 'no identity' }];
      rejects(row, 'campaignRulings[0].ruleIdentity');
    });
  });

  describe('audit lifecycle', () => {
    function audit(row: Row): Row {
      return (row.runtime as Row).audit as Row;
    }

    it('rejects an accepted outcome carrying a rejection cause', () => {
      const row = clone();
      (audit(row).outcome as Row).retryCause = 'missing_world_evidence';
      rejects(row, 'is present on an accepted verdict');
    });

    it('rejects retries or an outcome recorded for an absent auditor', () => {
      const row = clone();
      const retries = audit(row).retries;
      (row.runtime as Row).audit = { auditor: 'absent', retries };
      rejects(row, 'while no auditor ran');
    });

    it('rejects an outcome that is neither acceptance nor repair', () => {
      const row = clone();
      (audit(row).outcome as Row).disposition = 'failed';
      rejects(row, 'outcome.disposition');
    });

    it('rejects a capability event from an attempt that never ran', () => {
      const row = clone();
      // One retry plus the acceptance is two candidates; there was no third.
      ((row.runtime as Row).capabilityInvocations as Row[])[0].attempt = 3;
      rejects(row, 'candidate attempt(s)');
    });

    it('rejects an attempt-2 event on a turn that ran no auditor', () => {
      const row = clone();
      (row.runtime as Row).audit = { auditor: 'absent' };
      ((row.runtime as Row).capabilityInvocations as Row[])[0].attempt = 2;
      rejects(row, 'candidate attempt(s)');
    });

    for (const key of ['recordKey', 'capabilityRevision', 'operationId'])
      it(`rejects a capability event missing ${key}`, () => {
        rejects(
          withoutField(`runtime.capabilityInvocations.0.${key}`),
          `capabilityInvocations[0].${key}`,
        );
      });

    for (const attempt of [0, 1.5, -1])
      it(`rejects a capability event with attempt ${attempt}`, () => {
        const row = clone();
        ((row.runtime as Row).capabilityInvocations as Row[])[0].attempt =
          attempt;
        rejects(row, 'a candidate attempt is an integer from 1');
      });
  });

  describe('scenario and non-claim', () => {
    it('rejects a fabricated non-claim', () => {
      const row = clone();
      row.modelUsageClaim = 'the model used it';
      rejects(row, 'modelUsageClaim');
    });

    it('rejects a malformed scenario binding', () => {
      const row = clone();
      (row.scenario as Row).itemInstances = [{ instanceId: 'x' }];
      rejects(row, 'scenario.itemInstances[0].recordKey');
    });

    it('rejects a malformed stack identity', () => {
      rejects(
        withoutField('trace.stack.base.version'),
        'trace.stack.base.version',
      );
    });

    it('rejects a malformed blocker status', () => {
      const row = clone();
      (row.blockerRepairs as Row[])[0].status = 'probably-repaired';
      rejects(row, 'blockerRepairs[0].status');
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
      const candidate = result.trace?.packet.candidates.find(
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
