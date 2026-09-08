import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { preflightCampaignItemOperation } from '../../src/campaign/capabilityPreflight.js';
import { createDefaultToolRegistry, runTurn } from '../../src/index.js';
import type {
  CampaignPosition,
  CampaignRuleReadSeam,
  Db,
  DiscoveryScenario,
  DiscoveryTrace,
  ModelClient,
  ModelCompleteResult,
  PacketCandidate,
} from '../../src/internal.js';
import {
  createCampaignRule,
  createCampaignRuleReadSeam,
  deriveItemOperationReadinessInput,
  formatCampaignPosition,
  getCurrentCampaignPosition,
  getTurnTrace,
  listCampaignRules,
  measureDiscovery,
  NULL_CAMPAIGN_RULE_SEAM,
  openScene,
  projectCampaignRule,
  recordAmbiguityRuling,
  resolveCampaignPosition,
  revokeCampaignRule,
  runDiscoveryStages,
  supersedeCampaignRule,
} from '../../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID as CAMPAIGN_ID,
  freshDbWithSession,
  DEFAULT_TEST_SESSION_ID as SESSION_ID,
} from '../support/db.js';

/**
 * W11 (`eshyra-o9bd.19.13`): discovery CONSUMES the `eshyra-jhpt` campaign-rule
 * read interface.
 *
 * Every rule and ruling in this file is written through jhpt's own writers and
 * read back through `createCampaignRuleReadSeam` — the same active-at-position
 * query the auditor uses. Nothing here defines a rule or ruling schema,
 * persistence, resolution, supersession, revocation, or house-rule lifecycle;
 * all seven belong to `eshyra-jhpt`, and the last test in this file asserts
 * that no substitute for any of them exists inside the discovery path.
 */

const AT = '2026-05-20T10:00:00.000Z';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Required test value is absent');
  return value;
}

/** Minimal scripted DM: this test measures retrieval evidence, not narration. */
class Replies implements ModelClient {
  constructor(private readonly texts: string[]) {}
  async complete(): Promise<ModelCompleteResult> {
    const text = this.texts.shift();
    if (text === undefined) throw new Error('Replies exhausted');
    return { text };
  }
}

const FIREBALL = 'spell:fireball';
const CUBE = 'magic-item:cube-of-force';
const CUBE_AMBIGUITY = 'ambiguity:cube-of-force-same-face-duration-reset';
const CUBE_INTERPRETATION = 'same-face-resets';

const FIREBALL_SCENARIO: DiscoveryScenario = {
  playerInput: 'I cast fireball at the goblins.',
  stateFields: { actingCharacter: 'pc-1', selectedSpell: FIREBALL },
};

const CUBE_SCENARIO: DiscoveryScenario = {
  playerInput: 'I press face 1 of the Cube of Force again.',
  stateFields: {
    actingCharacter: 'pc-1',
    itemInstance: 'cube-1',
    itemRecord: CUBE,
    machineState: 'face-1',
    operationId: 'press-face-1',
  },
};

/** Allocate `count` real campaign turn positions, in chronological order. */
function turns(db: Db, count: number): CampaignPosition[] {
  return Array.from({ length: count }, (_unused, index) =>
    resolveCampaignPosition(db, {
      campaignId: CAMPAIGN_ID,
      sessionId: SESSION_ID,
      turnId: `turn-${index + 1}`,
    }),
  );
}

function seamAt(db: Db, position: CampaignPosition): CampaignRuleReadSeam {
  return createCampaignRuleReadSeam(
    db,
    CAMPAIGN_ID,
    formatCampaignPosition(position),
  );
}

function discover(
  db: Db,
  scenario: DiscoveryScenario,
  position: CampaignPosition,
): DiscoveryTrace {
  return runDiscoveryStages({
    db,
    scenario,
    campaignRuleSeam: seamAt(db, position),
    campaignPosition: formatCampaignPosition(position),
  });
}

function packetCandidate(
  trace: DiscoveryTrace,
  key: string,
): PacketCandidate | undefined {
  return trace.packet.packet.candidates.find(
    (item) => item.identity.key === key,
  );
}

/**
 * Author a house rule the way a campaign would: at the current turn, taking
 * effect at the next one. jhpt rejects a live write that back-dates itself, so
 * the caller allocates the effective turn afterwards.
 */
function houseRule(
  db: Db,
  input: {
    readonly ruleIdentity: string;
    readonly currentPosition: CampaignPosition;
    readonly effectivePosition: CampaignPosition;
    readonly governingRecordKeys: readonly string[];
    readonly prose: string;
  },
) {
  return createCampaignRule(
    db,
    {
      ruleIdentity: input.ruleIdentity,
      campaignId: CAMPAIGN_ID,
      ruleKind: 'house-rule',
      status: 'active',
      origin: 'player-authored',
      provenance: { kind: 'house-rule', rationale: 'table preference' },
      effectivePosition: input.effectivePosition,
      temporalMode: { mode: 'prospective' },
      supersededBy: null,
      revokedPosition: null,
      scope: 'campaign',
      governingRecordKeys: input.governingRecordKeys,
      prose: input.prose,
    },
    { currentPosition: input.currentPosition, sessionId: SESSION_ID },
  );
}

describe('W11 campaign-rule read-interface consumption', () => {
  it('places an active jhpt rule beside its governing pack record, unchanged', () => {
    const db = freshDbWithSession();
    try {
      const [authoring] = turns(db, 1);
      const rule = houseRule(db, {
        ruleIdentity: 'house-rule:no-material-components',
        currentPosition: authoring,
        effectivePosition: {
          ...authoring,
          turnId: 'turn-2',
          ordinal: authoring.ordinal + 1,
        },
        governingRecordKeys: [FIREBALL],
        prose: 'This campaign does not use material spell components.',
      });
      const [, effective] = turns(db, 2);
      const trace = discover(db, FIREBALL_SCENARIO, effective);

      const candidate = packetCandidate(trace, FIREBALL);
      expect(candidate).toBeDefined();
      // The pairing is jhpt's association data (amendment A1), not something
      // discovery re-derived: the rule is here because ITS governingRecordKeys
      // named this record.
      expect(candidate?.campaignRules).toEqual([projectCampaignRule(rule)]);
      expect(candidate?.campaignRules[0].governingRecordKeys).toContain(
        FIREBALL,
      );
      expect(candidate?.routes.map((route) => route.routeClass)).toContain(
        'campaign-rule',
      );
      // Identity, kind, campaign scope, provenance, effective position and
      // supersession status all survive into the packet unchanged.
      expect(candidate?.campaignRules[0]).toMatchObject({
        ruleIdentity: rule.ruleIdentity,
        ruleKind: 'house-rule',
        status: 'active',
        origin: 'player-authored',
        provenance: 'house-rule',
        scope: 'campaign',
        effectivePosition: formatCampaignPosition(rule.effectivePosition),
        supersededBy: null,
        revokedPosition: null,
      });
      // The governing source is placed BESIDE the rule, never replaced by it.
      expect(candidate?.sourceProse).toBeDefined();
      expect(JSON.stringify(candidate?.sourceProse)).toContain('8d6');

      const placed = measureDiscovery(trace, {
        mustIncludeTargetRefs: [FIREBALL],
        mustNotIncludeTargetRefs: [],
        requiredFacts: [],
        requiredRelationshipExpansion: [],
      }).m5.placed;
      expect(placed).toEqual([
        { ruleIdentity: rule.ruleIdentity, governingRecordKey: FIREBALL },
      ]);
    } finally {
      db.close();
    }
  });

  it('places an active jhpt ruling beside the ambiguity it resolves', () => {
    const db = freshDbWithSession();
    try {
      const [authoring] = turns(db, 1);
      const { rule } = recordAmbiguityRuling(db, {
        campaignId: CAMPAIGN_ID,
        ambiguityId: CUBE_AMBIGUITY,
        interpretationId: CUBE_INTERPRETATION,
        currentPosition: authoring,
        sessionId: SESSION_ID,
      });
      const [, effective] = turns(db, 2);
      const trace = discover(db, CUBE_SCENARIO, effective);

      const candidate = packetCandidate(trace, CUBE);
      expect(candidate?.campaignRulings).toEqual([projectCampaignRule(rule)]);
      expect(candidate?.campaignRulings[0]).toMatchObject({
        ruleIdentity: rule.ruleIdentity,
        ruleKind: 'ruling',
        status: 'active',
        origin: 'player-approved',
        ambiguityId: CUBE_AMBIGUITY,
        selectedInterpretationId: CUBE_INTERPRETATION,
        provenance: `ambiguity:${CUBE_AMBIGUITY}#${CUBE_INTERPRETATION}`,
      });
      expect(candidate?.routes.map((route) => route.routeClass)).toContain(
        'campaign-ruling',
      );
      // The ruling is placed on the record that DECLARES the ambiguity,
      // because that is the association jhpt stored.
      expect(candidate?.campaignRulings[0].governingRecordKeys).toEqual([CUBE]);
      expect(trace.ruleJoin.resolvedAmbiguityIds).toContain(CUBE_AMBIGUITY);
      expect(
        trace.lateRuleJoin.unresolvedAmbiguities.map((item) => item.id),
      ).not.toContain(CUBE_AMBIGUITY);
    } finally {
      db.close();
    }
  });

  it('preserves the uncertainty of a discovered ambiguity that has no active ruling', () => {
    const db = freshDbWithSession();
    try {
      const [current] = turns(db, 1);
      const trace = discover(db, CUBE_SCENARIO, current);

      // The seam RAN and returned nothing. Absence is evidence (design
      // section 8.2 R7), not a skipped stage.
      expect(trace.ruleJoin.ruleQueryExecuted).toBe(true);
      expect(trace.ruleJoin.rulingQueryExecuted).toBe(true);
      expect(trace.ruleJoin.returnedRuleIdentities).toEqual([]);

      const candidate = packetCandidate(trace, CUBE);
      expect(candidate?.campaignRulings).toEqual([]);
      expect(candidate?.routes.map((route) => route.routeClass)).not.toContain(
        'campaign-ruling',
      );
      // The uncertainty and BOTH published interpretations remain visible; the
      // ambiguity never acquires silent canonical certainty.
      const ambiguity = candidate?.ambiguities.find(
        (item) => item.id === CUBE_AMBIGUITY,
      );
      expect(ambiguity).toBeDefined();
      expect(ambiguity?.interpretations.map((item) => item.id)).toEqual(
        expect.arrayContaining([
          CUBE_INTERPRETATION,
          'different-face-only-resets',
        ]),
      );
      expect(
        trace.lateRuleJoin.unresolvedAmbiguities.map((item) => item.id),
      ).toContain(CUBE_AMBIGUITY);
      // Nothing local filled the gap.
      expect(listCampaignRules(db, { campaignId: CAMPAIGN_ID })).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('reflects supersession in what discovery receives, at each position', () => {
    const db = freshDbWithSession();
    try {
      const [first] = turns(db, 1);
      const original = houseRule(db, {
        ruleIdentity: 'house-rule:components-v1',
        currentPosition: first,
        effectivePosition: { ...first, turnId: 'turn-2', ordinal: 2 },
        governingRecordKeys: [FIREBALL],
        prose: 'No material components at all.',
      });
      const [, second] = turns(db, 2);
      supersedeCampaignRule(db, {
        campaignId: CAMPAIGN_ID,
        ruleIdentity: original.ruleIdentity,
        currentPosition: second,
        successor: {
          ...original,
          ruleIdentity: 'house-rule:components-v2',
          prose: 'Only costly material components are required.',
          effectivePosition: { ...first, turnId: 'turn-3', ordinal: 3 },
        },
      });
      const [, , third] = turns(db, 3);

      const before = discover(db, FIREBALL_SCENARIO, second);
      expect(
        packetCandidate(before, FIREBALL)?.campaignRules.map(
          (item) => item.ruleIdentity,
        ),
      ).toEqual([original.ruleIdentity]);
      // Discovery does not decide this: at turn 2 the successor is not yet in
      // effect, so jhpt's active-at-position query still returns the original.
      expect(packetCandidate(before, FIREBALL)?.campaignRules[0].status).toBe(
        'superseded',
      );
      expect(
        packetCandidate(before, FIREBALL)?.campaignRules[0].supersededBy,
      ).toBe('house-rule:components-v2');

      const after = discover(db, FIREBALL_SCENARIO, third);
      expect(
        packetCandidate(after, FIREBALL)?.campaignRules.map(
          (item) => item.ruleIdentity,
        ),
      ).toEqual(['house-rule:components-v2']);
      expect(packetCandidate(after, FIREBALL)?.campaignRules[0]).toMatchObject({
        status: 'active',
        supersededBy: null,
        prose: 'Only costly material components are required.',
      });
    } finally {
      db.close();
    }
  });

  it('reflects revocation in what discovery receives, at each position', () => {
    const db = freshDbWithSession();
    try {
      const [first] = turns(db, 1);
      const rule = houseRule(db, {
        ruleIdentity: 'house-rule:components-only',
        currentPosition: first,
        effectivePosition: { ...first, turnId: 'turn-2', ordinal: 2 },
        governingRecordKeys: [FIREBALL],
        prose: 'No material components at all.',
      });
      const [, second] = turns(db, 2);
      revokeCampaignRule(db, {
        campaignId: CAMPAIGN_ID,
        ruleIdentity: rule.ruleIdentity,
        currentPosition: second,
        revokedPosition: { ...first, turnId: 'turn-3', ordinal: 3 },
      });
      const [, , third] = turns(db, 3);

      const before = discover(db, FIREBALL_SCENARIO, second);
      expect(
        packetCandidate(before, FIREBALL)?.campaignRules.map(
          (item) => item.ruleIdentity,
        ),
      ).toEqual([rule.ruleIdentity]);
      expect(packetCandidate(before, FIREBALL)?.campaignRules[0]).toMatchObject(
        { status: 'revoked', revokedPosition: expect.any(String) },
      );

      const after = discover(db, FIREBALL_SCENARIO, third);
      expect(packetCandidate(after, FIREBALL)?.campaignRules).toEqual([]);
      expect(after.ruleJoin.returnedRuleIdentities).toEqual([]);
      // The governing source material is still retained; only the rule is gone.
      expect(packetCandidate(after, FIREBALL)).toBeDefined();
    } finally {
      db.close();
    }
  });

  it('hands a jhpt ruling to the bounded capability preflight, without granting readiness', () => {
    const db = freshDbWithSession();
    try {
      const [authoring] = turns(db, 1);
      const { rule } = recordAmbiguityRuling(db, {
        campaignId: CAMPAIGN_ID,
        ambiguityId: CUBE_AMBIGUITY,
        interpretationId: CUBE_INTERPRETATION,
        currentPosition: authoring,
        sessionId: SESSION_ID,
      });
      const [, effective] = turns(db, 2);
      const trace = discover(db, CUBE_SCENARIO, effective);
      const capability = packetCandidate(trace, CUBE)?.capability;

      // A2: the ruling reached the bounded preflight as the jhpt projection
      // ITSELF, not a discovery-shaped copy of it. Exact equality with
      // `projectCampaignRule` is the assertion that matters: a narrowed local
      // shape would pass a field-by-field check while silently dropping the
      // governing association and the prose an execution owner needs.
      expect(capability?.campaignRulings).toEqual([projectCampaignRule(rule)]);
      expect(capability?.campaignRulings).toEqual(
        packetCandidate(trace, CUBE)?.campaignRulings,
      );
      expect(capability?.campaignRulings?.[0].governingRecordKeys).toEqual([
        CUBE,
      ]);
      expect(capability?.campaignRulings?.[0].prose).toEqual(rule.prose);
      // A ruling resolves interpretation only. Every press-face clause is
      // engine-pending, so readiness stays blocked and the packet says so
      // rather than letting the ruling read as authorization.
      expect(capability?.status).toBe('blocked');
      expect(capability?.exclusions).toContain(
        'A campaign ruling supplied through the eshyra-jhpt read interface selects an interpretation only; it does not satisfy, weaken, or green any clause of this readiness contract.',
      );

      // The same is true of the runtime capability path: the ONLY route from a
      // ruling into bounded readiness is jhpt's own preflight, which reports
      // the ambiguity resolved while readiness remains blocked.
      const record = trace.stack.recordsByKey.get(CUBE)?.record;
      expect(record).toBeDefined();
      const runtime = preflightCampaignItemOperation(db, {
        campaignId: CAMPAIGN_ID,
        record: required(record),
        operation: deriveItemOperationReadinessInput(
          required(record),
          undefined,
          'press-face-1',
        ),
      });
      expect(runtime.status).toBe('blocked');
      const resolved = runtime.ambiguities.find(
        (item) => item.ambiguity.id === CUBE_AMBIGUITY,
      );
      expect(resolved?.status).toBe('resolved');
      expect(resolved?.ruling?.ruleIdentity).toBe(rule.ruleIdentity);
      expect(resolved?.ruling?.selectedInterpretationId).toBe(
        CUBE_INTERPRETATION,
      );
    } finally {
      db.close();
    }
  });

  it('omits preflight rulings entirely when jhpt supplies none', () => {
    const db = freshDbWithSession();
    try {
      const [current] = turns(db, 1);
      const capability = packetCandidate(
        discover(db, CUBE_SCENARIO, current),
        CUBE,
      )?.capability;
      expect(capability?.status).toBe('blocked');
      // Negative control for the assertion above: absent a jhpt ruling the
      // field is absent, so its presence there is evidence of consumption
      // rather than of a field that is always populated.
      expect(capability?.campaignRulings).toBeUndefined();
      expect(capability?.exclusions).not.toContain(
        'A campaign ruling supplied through the eshyra-jhpt read interface selects an interpretation only; it does not satisfy, weaken, or green any clause of this readiness contract.',
      );
    } finally {
      db.close();
    }
  });

  it('leaves M5 measurable from the accepted-turn trace, with no discovery-owned store', async () => {
    const db = freshDbWithSession();
    try {
      openScene(db, {
        campaignId: CAMPAIGN_ID,
        sessionId: SESSION_ID,
        sceneId: 'scene',
        title: 'Goblin ambush',
        at: AT,
      });
      const deps = {
        db,
        model: new Replies(['The flames bloom.', 'The embers settle.']),
        registry: createDefaultToolRegistry(),
      };
      const base = {
        campaignId: CAMPAIGN_ID,
        sessionId: SESSION_ID,
        playerInput: FIREBALL_SCENARIO.playerInput,
        seed: 7,
        at: AT,
      };
      expect((await runTurn(deps, { ...base, turnId: 't1' })).ok).toBe(true);
      const authoring = required(getCurrentCampaignPosition(db, CAMPAIGN_ID));
      const rule = houseRule(db, {
        ruleIdentity: 'house-rule:no-material-components',
        currentPosition: authoring,
        effectivePosition: {
          sessionId: SESSION_ID,
          turnId: 't2',
          ordinal: authoring.ordinal + 1,
        },
        governingRecordKeys: [FIREBALL],
        prose: 'This campaign does not use material spell components.',
      });
      expect((await runTurn(deps, { ...base, turnId: 't2' })).ok).toBe(true);
      const turnPosition = required(
        getCurrentCampaignPosition(db, CAMPAIGN_ID),
      );
      expect(turnPosition.turnId).toBe('t2');

      // A3: the accepted turn's durable trace already names which rules were
      // retrieved for the turn and under which identities.
      const evidence = getTurnTrace(db, {
        campaignId: CAMPAIGN_ID,
        sessionId: SESSION_ID,
        turnId: 't2',
      })?.campaignRulesEvidence;
      expect(evidence?.rules.map((item) => item.ruleIdentity)).toEqual([
        rule.ruleIdentity,
      ]);

      // M5 agrees with that trace at the same position, so the measurement
      // needs no discovery-owned record of what was retrieved.
      const measured = measureDiscovery(
        discover(db, FIREBALL_SCENARIO, turnPosition),
        {
          mustIncludeTargetRefs: [FIREBALL],
          mustNotIncludeTargetRefs: [],
          requiredFacts: [],
          requiredRelationshipExpansion: [],
        },
      ).m5;
      expect(measured.placed.map((item) => item.ruleIdentity)).toEqual(
        evidence?.rules.map((item) => item.ruleIdentity),
      );
      expect(measured.unplaced).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('keeps nothing of its own: a later run sees only what the seam supplies', () => {
    const db = freshDbWithSession();
    try {
      const [authoring] = turns(db, 1);
      houseRule(db, {
        ruleIdentity: 'house-rule:no-material-components',
        currentPosition: authoring,
        effectivePosition: { ...authoring, turnId: 'turn-2', ordinal: 2 },
        governingRecordKeys: [FIREBALL],
        prose: 'This campaign does not use material spell components.',
      });
      const [, effective] = turns(db, 2);
      expect(
        packetCandidate(discover(db, FIREBALL_SCENARIO, effective), FIREBALL)
          ?.campaignRules,
      ).toHaveLength(1);

      // Same database, same position, same scenario -- only the seam differs.
      // A discovery-side cache or store of record would leak the previous
      // run's rule into this one.
      const withoutSeam = runDiscoveryStages({
        db,
        scenario: FIREBALL_SCENARIO,
        campaignRuleSeam: NULL_CAMPAIGN_RULE_SEAM,
        campaignPosition: formatCampaignPosition(effective),
      });
      expect(packetCandidate(withoutSeam, FIREBALL)?.campaignRules).toEqual([]);
      expect(withoutSeam.ruleJoin.returnedRuleIdentities).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('re-reads jhpt at the same position after a lifecycle change, retaining nothing', () => {
    const db = freshDbWithSession();
    try {
      const [authoring] = turns(db, 1);
      const adjudicated = {
        sessionId: SESSION_ID,
        turnId: 'turn-2',
        ordinal: authoring.ordinal + 1,
      };

      // The adversary the structural checker cannot see: a cache or shadow
      // resolver keyed by position would answer every query below from the
      // first result. Each query names the SAME adjudicated position, and jhpt
      // state changes between them -- unlike the supersession and revocation
      // cases above, which make all their writes before their first query and
      // so would be satisfied by a cache populated on the first read.
      expect(
        packetCandidate(discover(db, FIREBALL_SCENARIO, adjudicated), FIREBALL)
          ?.campaignRules,
      ).toEqual([]);

      const original = houseRule(db, {
        ruleIdentity: 'house-rule:components-v1',
        currentPosition: authoring,
        effectivePosition: adjudicated,
        governingRecordKeys: [FIREBALL],
        prose: 'No material components at all.',
      });
      const [, current] = turns(db, 2);
      expect(current).toEqual(adjudicated);

      // A rule that did not exist at the first query is present at the second.
      const afterCreate = packetCandidate(
        discover(db, FIREBALL_SCENARIO, adjudicated),
        FIREBALL,
      )?.campaignRules;
      expect(afterCreate?.map((item) => item.ruleIdentity)).toEqual([
        original.ruleIdentity,
      ]);
      expect(afterCreate?.[0].status).toBe('active');

      supersedeCampaignRule(db, {
        campaignId: CAMPAIGN_ID,
        ruleIdentity: original.ruleIdentity,
        currentPosition: current,
        successor: {
          ...original,
          ruleIdentity: 'house-rule:components-v2',
          prose: 'Only costly material components are required.',
          effectivePosition: {
            ...adjudicated,
            turnId: 'turn-3',
            ordinal: adjudicated.ordinal + 1,
          },
        },
      });

      // Same position, same rule, different lifecycle status -- the successor
      // is not yet in effect here, so jhpt still selects the original, but its
      // status is no longer `active`. Retained state would report `active`.
      const afterSupersede = packetCandidate(
        discover(db, FIREBALL_SCENARIO, adjudicated),
        FIREBALL,
      )?.campaignRules;
      expect(afterSupersede?.map((item) => item.ruleIdentity)).toEqual([
        original.ruleIdentity,
      ]);
      expect(afterSupersede?.[0]).toMatchObject({
        status: 'superseded',
        supersededBy: 'house-rule:components-v2',
      });
      expect(afterSupersede?.[0].prose).toBe('No material components at all.');
    } finally {
      db.close();
    }
  });

  it('proves its ownership boundary structurally in a dedicated checker', () => {
    // The source-level half of "no discovery-side rule store" is
    // `discoveryOwnershipBoundary.test.ts`, which runs an AST analyzer over the
    // complete recursive discovery surface and, first, proves that analyzer
    // rejects each prohibited class. It is separate because its rejection
    // fixtures are the substance of that evidence, not a footnote to this file.
    expect(
      readFileSync(
        'packages/core/test/discovery/discoveryOwnershipBoundary.test.ts',
        'utf8',
      ),
    ).toContain('owns no rule schema, store, cache, resolver, or lifecycle');
  });
});
