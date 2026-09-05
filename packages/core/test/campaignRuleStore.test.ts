import { describe, expect, it, vi } from 'vitest';
import type { CampaignPosition, CampaignRule } from '../src/internal.js';
import {
  assembleCampaignRulesContext,
  assembleContext,
  createCampaignRuleReadSeam,
  formatCampaignPosition,
  getCampaignRule,
  getCurrentCampaignPosition,
  joinCampaignRules,
  listActiveCampaignRulesAtPosition,
  listActiveRulingsForAmbiguitiesAtPosition,
  listCampaignRules,
  createCampaignRule as persistCampaignRule,
  revokeCampaignRule as persistRevokeCampaignRule,
  supersedeCampaignRule as persistSupersedeCampaignRule,
  renderContextMessage,
  resolveCampaignPosition,
  validateCampaignRule,
  validateCampaignRules,
} from '../src/internal.js';
import { resolveStrictCampaignRulesStack } from '../src/state/campaignRecordLookup.js';
import { bareDb } from './support/db.js';

const p = (ordinal: number): CampaignPosition => ({
  sessionId: `s${ordinal}`,
  turnId: `t${ordinal}`,
  ordinal,
});

function rule(
  identity: string,
  ordinal: number,
  kind: CampaignRule['ruleKind'] = 'house-rule',
  overrides: Partial<CampaignRule> = {},
): CampaignRule {
  return {
    ruleIdentity: identity,
    campaignId: 'c1',
    ruleKind: kind,
    status: 'active',
    origin: 'player-approved',
    provenance:
      kind === 'house-rule'
        ? { kind: 'house-rule', rationale: 'table decision' }
        : { kind: 'recurring-question', questionId: 'q1' },
    effectivePosition: p(ordinal),
    temporalMode: { mode: 'prospective' },
    supersededBy: null,
    revokedPosition: null,
    scope: 'combat',
    governingRecordKeys: ['record:one'],
    prose: `Rule ${identity}`,
    ...overrides,
  };
}

const ambiguity = {
  id: 'amb-1',
  question: 'Which interpretation applies?',
  source: [{ locator: 'p.1', clauseId: 'clause-1' }],
  affects: ['record:one'],
  interpretations: [{ id: 'int-1', summary: 'The first interpretation' }],
  canonicalResolution: null,
  runtimeDisposition: { status: 'engine-pending', owner: 'campaign-ruling' },
} as const;

function ambiguityRuling(identity: string, ordinal: number): CampaignRule {
  return {
    ...rule(identity, ordinal, 'ruling'),
    provenance: {
      kind: 'ambiguity',
      ambiguityId: ambiguity.id,
      selectedInterpretationId: 'int-1',
    },
  };
}

function withCurrent<T>(
  value: T,
  currentPosition: CampaignPosition,
): T & {
  currentPosition: CampaignPosition;
} {
  return { ...value, currentPosition };
}

type CreateOptions = Parameters<typeof persistCampaignRule>[2];
type TestCreateOptions = Omit<CreateOptions, 'currentPosition'> & {
  currentPosition?: CampaignPosition;
};
type RevokeInput = Parameters<typeof persistRevokeCampaignRule>[1];
type TestRevokeInput = Omit<RevokeInput, 'currentPosition'> & {
  currentPosition?: CampaignPosition;
};
type SupersedeInput = Parameters<typeof persistSupersedeCampaignRule>[1];
type TestSupersedeInput = Omit<SupersedeInput, 'currentPosition'> & {
  currentPosition?: CampaignPosition;
};

function createCampaignRule(
  db: Parameters<typeof persistCampaignRule>[0],
  value: CampaignRule,
  options: TestCreateOptions = {},
): CampaignRule {
  return persistCampaignRule(db, value, {
    ...options,
    currentPosition: options.currentPosition ?? p(0),
  });
}

function revokeCampaignRule(
  db: Parameters<typeof persistRevokeCampaignRule>[0],
  input: TestRevokeInput,
): CampaignRule {
  return persistRevokeCampaignRule(db, {
    ...input,
    currentPosition: input.currentPosition ?? p(0),
  });
}

function supersedeCampaignRule(
  db: Parameters<typeof persistSupersedeCampaignRule>[0],
  input: TestSupersedeInput,
): CampaignRule {
  return persistSupersedeCampaignRule(db, {
    ...input,
    currentPosition: input.currentPosition ?? p(0),
  });
}

function persistPositions(
  db: Parameters<typeof persistCampaignRule>[0],
  through: number,
  sessionId = 'history',
): CampaignPosition {
  let current: CampaignPosition | undefined;
  for (let ordinal = 1; ordinal <= through; ordinal += 1)
    current = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId,
      turnId: `turn-${ordinal}`,
    });
  if (current === undefined) throw new Error('missing persisted position');
  return current;
}

function persistedPosition(
  db: Parameters<typeof persistCampaignRule>[0],
  ordinal: number,
): CampaignPosition {
  const row = db
    .prepare(
      'SELECT session_id, turn_id, ordinal FROM campaign_turn_position WHERE campaign_id = ? AND ordinal = ?',
    )
    .get('c1', ordinal) as
    | { session_id: string; turn_id: string; ordinal: number }
    | undefined;
  if (row === undefined)
    throw new Error(`missing persisted position ${ordinal}`);
  return {
    sessionId: row.session_id,
    turnId: row.turn_id,
    ordinal: row.ordinal,
  };
}

describe('campaign rule persistence', () => {
  it('assigns stable campaign-wide positions across sessions and replay', () => {
    const db = bareDb();
    const first = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId: 's1',
      turnId: 'turn-a',
    });
    const replay = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId: 's1',
      turnId: 'turn-a',
    });
    const next = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId: 's1',
      turnId: 'turn-b',
    });
    const nextSession = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId: 's2',
      turnId: 'turn-c',
    });
    expect(replay).toEqual(first);
    expect(next.ordinal).toBe(first.ordinal + 1);
    expect(nextSession.ordinal).toBe(next.ordinal + 1);
    db.close();
  });

  it('round trips rule fields and orders future positions canonically', () => {
    const db = bareDb();
    createCampaignRule(db, rule('later', 10));
    createCampaignRule(db, rule('earlier', 2));
    expect(
      listCampaignRules(db, { campaignId: 'c1' }).map((r) => r.ruleIdentity),
    ).toEqual(['earlier', 'later']);
    expect(
      getCampaignRule(db, { campaignId: 'c1', ruleIdentity: 'earlier' }),
    ).toEqual(
      rule('earlier', 2, 'house-rule', {
        effectivePosition: {
          ...p(2),
          sessionId: '__future__',
          turnId: '__future__',
        },
      }),
    );
    expect(formatCampaignPosition(p(2))).toMatch(/^cp1~000000000002~/);
    db.close();
  });

  it('returns the canonical rule representation that it persisted', () => {
    const db = bareDb();
    const ordinary = createCampaignRule(db, rule('ordinary', 1));
    expect(ordinary).toEqual(
      getCampaignRule(db, { campaignId: 'c1', ruleIdentity: 'ordinary' }),
    );

    const future = createCampaignRule(db, rule('future-returned', 9));
    expect(future).toEqual(
      getCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'future-returned',
      }),
    );
    expect(future.effectivePosition).toEqual({
      ...p(9),
      sessionId: '__future__',
      turnId: '__future__',
    });
    db.close();
  });

  it('R1 exposes the canonical prospective revoked position through typed reads', () => {
    const db = bareDb();
    createCampaignRule(db, rule('r1-revocable', 1));
    const currentPosition = persistPositions(db, 2, 'r1');
    const revoked = revokeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'r1-revocable',
      revokedPosition: p(3),
      currentPosition,
    });
    const canonicalRevokedPosition = {
      ...p(3),
      sessionId: '__future__',
      turnId: '__future__',
    };

    expect(revoked.revokedPosition).toEqual(canonicalRevokedPosition);
    expect(
      getCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'r1-revocable',
      }),
    ).toMatchObject({
      status: 'revoked',
      revokedPosition: canonicalRevokedPosition,
    });
    expect(
      listCampaignRules(db, { campaignId: 'c1' }).find(
        ({ ruleIdentity }) => ruleIdentity === 'r1-revocable',
      ),
    ).toMatchObject({
      status: 'revoked',
      revokedPosition: canonicalRevokedPosition,
    });
    db.close();
  });

  it('R2 exposes canonical future anchors for fabricated revocation positions', () => {
    const db = bareDb();
    createCampaignRule(db, rule('r2-next', 1));
    createCampaignRule(db, rule('r2-large', 1));
    const currentPosition = persistPositions(db, 1, 'r2');
    const next = revokeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'r2-next',
      revokedPosition: {
        sessionId: 'fabricated-session',
        turnId: 'fabricated-turn',
        ordinal: currentPosition.ordinal + 1,
      },
      currentPosition,
    });
    const large = revokeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'r2-large',
      revokedPosition: {
        sessionId: 'another-fabricated-session',
        turnId: 'another-fabricated-turn',
        ordinal: 999999,
      },
      currentPosition,
    });

    expect(next.revokedPosition).toEqual({
      sessionId: '__future__',
      turnId: '__future__',
      ordinal: currentPosition.ordinal + 1,
    });
    expect(large.revokedPosition).toEqual({
      sessionId: '__future__',
      turnId: '__future__',
      ordinal: 999999,
    });
    expect(
      listCampaignRules(db, { campaignId: 'c1' })
        .filter(({ ruleIdentity }) =>
          ['r2-next', 'r2-large'].includes(ruleIdentity),
        )
        .map(({ ruleIdentity, revokedPosition }) => ({
          ruleIdentity,
          revokedPosition,
        })),
    ).toEqual([
      {
        ruleIdentity: 'r2-large',
        revokedPosition: {
          sessionId: '__future__',
          turnId: '__future__',
          ordinal: 999999,
        },
      },
      {
        ruleIdentity: 'r2-next',
        revokedPosition: {
          sessionId: '__future__',
          turnId: '__future__',
          ordinal: currentPosition.ordinal + 1,
        },
      },
    ]);
    db.close();
  });

  it('R3 preserves null revocation positions and rejects inconsistent domain and stored rows', () => {
    const db = bareDb();
    createCampaignRule(db, rule('r3-active', 1));
    supersedeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'r3-active',
      successor: rule('r3-successor', 2),
    });
    expect(
      getCampaignRule(db, { campaignId: 'c1', ruleIdentity: 'r3-successor' }),
    ).toMatchObject({ status: 'active', revokedPosition: null });
    expect(
      getCampaignRule(db, { campaignId: 'c1', ruleIdentity: 'r3-active' }),
    ).toMatchObject({ status: 'superseded', revokedPosition: null });

    expect(() =>
      validateCampaignRule(
        rule('r3-invalid-revoked', 1, 'house-rule', {
          status: 'revoked',
        }),
      ),
    ).toThrow('revoked rule must carry revokedPosition');
    expect(() =>
      validateCampaignRule(
        rule('r3-invalid-active', 1, 'house-rule', {
          revokedPosition: p(2),
        }),
      ),
    ).toThrow('only a revoked rule may carry revokedPosition');

    db.pragma('ignore_check_constraints = ON');
    createCampaignRule(db, rule('r3-missing-persisted-position', 1));
    db.prepare(
      "UPDATE campaign_rule SET status = 'revoked' WHERE rule_identity = ?",
    ).run('r3-missing-persisted-position');
    expect(() =>
      getCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'r3-missing-persisted-position',
      }),
    ).toThrow(
      "revoked campaign rule 'r3-missing-persisted-position' is missing revoked_position",
    );

    createCampaignRule(db, rule('r3-non-revoked-position', 1));
    db.prepare(
      'UPDATE campaign_rule SET revoked_position = ? WHERE rule_identity = ?',
    ).run(formatCampaignPosition(p(2)), 'r3-non-revoked-position');
    expect(() =>
      getCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'r3-non-revoked-position',
      }),
    ).toThrow(
      "only a revoked rule may carry revokedPosition (campaign rule 'r3-non-revoked-position')",
    );
    db.close();
  });

  it('R5 exposes the complete management history through typed campaign-rule APIs', () => {
    const db = bareDb();
    createCampaignRule(db, rule('r5-original', 1));
    const successor = supersedeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'r5-original',
      successor: rule('r5-successor', 2),
    });
    const revoked = revokeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'r5-successor',
      revokedPosition: p(3),
      currentPosition: p(0),
    });

    expect(
      listCampaignRules(db, { campaignId: 'c1' }).map(
        ({
          ruleIdentity,
          status,
          effectivePosition,
          supersededBy,
          revokedPosition,
        }) => ({
          ruleIdentity,
          status,
          effectivePosition,
          supersededBy,
          revokedPosition,
        }),
      ),
    ).toEqual([
      {
        ruleIdentity: 'r5-original',
        status: 'superseded',
        effectivePosition: {
          sessionId: '__future__',
          turnId: '__future__',
          ordinal: 1,
        },
        supersededBy: 'r5-successor',
        revokedPosition: null,
      },
      {
        ruleIdentity: 'r5-successor',
        status: 'revoked',
        effectivePosition: {
          sessionId: '__future__',
          turnId: '__future__',
          ordinal: 2,
        },
        supersededBy: null,
        revokedPosition: {
          sessionId: '__future__',
          turnId: '__future__',
          ordinal: 3,
        },
      },
    ]);
    expect(successor.effectivePosition).toEqual({
      sessionId: '__future__',
      turnId: '__future__',
      ordinal: 2,
    });
    expect(revoked.revokedPosition).toEqual({
      sessionId: '__future__',
      turnId: '__future__',
      ordinal: 3,
    });
    expect(() =>
      validateCampaignRules(listCampaignRules(db, { campaignId: 'c1' })),
    ).not.toThrow();
    db.close();
  });

  it('returns the canonical successor representation that it persisted', () => {
    const db = bareDb();
    createCampaignRule(db, rule('prior-returned', 1));
    const successor = supersedeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'prior-returned',
      successor: rule('future-successor-returned', 9),
    });
    expect(successor).toEqual(
      getCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'future-successor-returned',
      }),
    );
    expect(successor.effectivePosition).toEqual({
      ...p(9),
      sessionId: '__future__',
      turnId: '__future__',
    });
    db.close();
  });

  it('rejects stale current-position authority and preserves history', () => {
    const db = bareDb();
    const first = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId: 'chronology',
      turnId: 'turn-1',
    });
    expect(getCurrentCampaignPosition(db, 'c1')).toEqual(first);
    createCampaignRule(
      db,
      rule('live', 2, 'house-rule', { effectivePosition: p(2) }),
      {
        currentPosition: first,
      },
    );
    createCampaignRule(
      db,
      rule('revocable', 2, 'house-rule', { effectivePosition: p(2) }),
      {
        currentPosition: first,
      },
    );
    createCampaignRule(
      db,
      rule('supersedable', 2, 'house-rule', { effectivePosition: p(2) }),
      {
        currentPosition: first,
      },
    );
    const positions = [
      first,
      ...Array.from({ length: 9 }, (_, index) =>
        resolveCampaignPosition(db, {
          campaignId: 'c1',
          sessionId: 'chronology',
          turnId: `turn-${index + 2}`,
        }),
      ),
    ];
    const current = positions[9];
    if (first === undefined || current === undefined)
      throw new Error('missing test positions');
    expect(getCurrentCampaignPosition(db, 'c1')).toEqual(current);
    const before = listActiveCampaignRulesAtPosition(
      db,
      'c1',
      formatCampaignPosition(positions[4] as CampaignPosition),
    ).map((item) => item.ruleIdentity);

    expect(() =>
      createCampaignRule(db, rule('backdated-via-stale-authority', 2), {
        currentPosition: positions[1] as CampaignPosition,
      }),
    ).toThrow(
      'currentPosition does not match the persisted current campaign position',
    );
    expect(() =>
      revokeCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'revocable',
        revokedPosition: current,
        currentPosition: positions[1] as CampaignPosition,
      }),
    ).toThrow(
      'currentPosition does not match the persisted current campaign position',
    );
    expect(() =>
      supersedeCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'supersedable',
        successor: rule('successor-at-current', 10),
        currentPosition: positions[1] as CampaignPosition,
      }),
    ).toThrow(
      'currentPosition does not match the persisted current campaign position',
    );
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(positions[4] as CampaignPosition),
      ).map((item) => item.ruleIdentity),
    ).toEqual(before);
    db.close();
  });

  it('does not accept arbitrary authority before the first turn position', () => {
    const db = bareDb();
    expect(getCurrentCampaignPosition(db, 'c1')).toBeUndefined();
    expect(() =>
      createCampaignRule(db, rule('unanchored', 10), {
        currentPosition: p(10),
      }),
    ).toThrow(
      "campaign 'c1' has no persisted turn position; currentPosition must use ordinal 0",
    );
    createCampaignRule(db, rule('initial', 1), { currentPosition: p(0) });
    expect(
      getCampaignRule(db, { campaignId: 'c1', ruleIdentity: 'initial' }),
    ).toBeDefined();
    db.close();
  });

  it('maps duplicate identity failures to CampaignRuleError', () => {
    const db = bareDb();
    createCampaignRule(db, rule('duplicate', 1), withCurrent({}, p(0)));
    expect(() =>
      createCampaignRule(db, rule('duplicate', 1), withCurrent({}, p(0))),
    ).toThrow("campaign rule 'duplicate' already exists");
    db.close();
  });

  it('reports duplicate ambiguity identity before checking overlap', () => {
    const db = bareDb();
    const first = ambiguityRuling('duplicate-ruling', 1);
    createCampaignRule(db, first, {
      validation: { ambiguity },
    });
    expect(() =>
      createCampaignRule(db, first, {
        validation: { ambiguity },
      }),
    ).toThrow("campaign rule 'duplicate-ruling' already exists");
    db.close();
  });

  it('applies supersession and revocation prospectively', () => {
    const db = bareDb();
    createCampaignRule(db, rule('old', 1), withCurrent({}, p(0)));
    supersedeCampaignRule(
      db,
      withCurrent(
        {
          campaignId: 'c1',
          ruleIdentity: 'old',
          successor: rule('new', 5),
        },
        p(0),
      ),
    );
    createCampaignRule(db, rule('revocable', 2), withCurrent({}, p(0)));
    const currentPosition = persistPositions(db, 7);
    revokeCampaignRule(
      db,
      withCurrent(
        {
          campaignId: 'c1',
          ruleIdentity: 'revocable',
          revokedPosition: p(8),
        },
        currentPosition,
      ),
    );
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(p(4)),
      ).map((r) => r.ruleIdentity),
    ).toEqual(['old', 'revocable']);
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(p(6)),
      ).map((r) => r.ruleIdentity),
    ).toEqual(['revocable', 'new']);
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(p(8)),
      ).map((r) => r.ruleIdentity),
    ).toEqual(['new']);
    db.close();
  });

  it('requires a position and excludes future-effective rules', () => {
    const db = bareDb();
    createCampaignRule(db, rule('now', 1));
    createCampaignRule(db, rule('future', 999));
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(p(1)),
      ).map((r) => r.ruleIdentity),
    ).toEqual(['now']);
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(p(999)),
      ).map((r) => r.ruleIdentity),
    ).toEqual(['now', 'future']);
    db.close();
  });

  it('canonicalizes future anchors and permits deterministic revocation at the real turn', () => {
    const db = bareDb();
    const first = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId: 'session-1',
      turnId: 'turn-1',
    });
    const futureWithLateAnchor = {
      ...p(2),
      sessionId: 'zzz',
      turnId: 'zzz',
    };
    const futureWithEarlyAnchor = {
      ...p(2),
      sessionId: 'aaa',
      turnId: 'aaa',
    };
    createCampaignRule(
      db,
      rule('late-anchor', 2, 'house-rule', {
        effectivePosition: futureWithLateAnchor,
      }),
      withCurrent({}, first),
    );
    createCampaignRule(
      db,
      rule('early-anchor', 2, 'house-rule', {
        effectivePosition: futureWithEarlyAnchor,
      }),
      withCurrent({}, first),
    );

    const realSecond = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId: 'session-2',
      turnId: 'turn-2',
    });
    const realThird = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId: 'session-3',
      turnId: 'turn-3',
    });
    const realFourth = p(4);
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(realSecond),
      ).map((item) => item.ruleIdentity),
    ).toEqual(['early-anchor', 'late-anchor']);

    expect(() =>
      revokeCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'late-anchor',
        revokedPosition: realFourth,
        currentPosition: realThird,
      }),
    ).not.toThrow();
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(realFourth),
      ).map((item) => item.ruleIdentity),
    ).toEqual(['early-anchor']);
    db.close();
  });

  it('resolves superseded successors from the fetched active-row set', () => {
    const db = bareDb();
    const current = p(0);
    createCampaignRule(db, rule('prior', 1), withCurrent({}, current));
    const first = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId: 'session-1',
      turnId: 'turn-1',
    });
    supersedeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'prior',
      successor: rule('successor', 2, 'house-rule', {
        effectivePosition: p(2),
      }),
      currentPosition: first,
    });

    const pointQueries: string[] = [];
    const originalPrepare = db.prepare.bind(db);
    const prepareSpy = vi.spyOn(db, 'prepare').mockImplementation(((
      sql: string,
    ) => {
      if (sql.includes('WHERE campaign_id = ? AND rule_identity = ?'))
        pointQueries.push(sql);
      return originalPrepare(sql);
    }) as typeof db.prepare);

    listActiveCampaignRulesAtPosition(db, 'c1', formatCampaignPosition(first));
    expect(pointQueries).toEqual([]);
    prepareSpy.mockRestore();
    db.close();
  });

  it('revokes campaign rules inside the same transaction as its guards', () => {
    const db = bareDb();
    createCampaignRule(db, rule('transactional-revocation', 1), {
      currentPosition: p(0),
    });
    const current = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId: 's1',
      turnId: 'turn-1',
    });
    const originalTransaction = db.transaction.bind(db);
    const transactionSpy = vi
      .spyOn(db, 'transaction')
      .mockImplementation(originalTransaction);

    revokeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'transactional-revocation',
      revokedPosition: p(2),
      currentPosition: current,
    });

    expect(transactionSpy).toHaveBeenCalled();
    transactionSpy.mockRestore();
    db.close();
  });

  it('scans active campaign rows once when assembling both context lists', () => {
    const db = bareDb();
    createCampaignRule(db, rule('single-active-row-scan', 1));
    const originalPrepare = db.prepare.bind(db);
    const prepareSpy = vi
      .spyOn(db, 'prepare')
      .mockImplementation(originalPrepare);

    assembleCampaignRulesContext(
      db,
      'c1',
      formatCampaignPosition(p(1)),
      undefined,
    );

    const activeRowQueries = prepareSpy.mock.calls.filter(
      ([sql]) =>
        typeof sql === 'string' &&
        sql.startsWith('SELECT campaign_id, rule_identity, rule_kind'),
    );
    expect(activeRowQueries).toHaveLength(1);
    prepareSpy.mockRestore();
    db.close();
  });

  it('rejects malformed positions before querying active rules', () => {
    const db = bareDb();
    expect(() =>
      listActiveCampaignRulesAtPosition(db, 'c1', 'test-position'),
    ).toThrow(/invalid campaign position/);
    expect(() =>
      listActiveRulingsForAmbiguitiesAtPosition(
        db,
        'c1',
        ['amb-1'],
        'test-position',
      ),
    ).toThrow(/invalid campaign position/);
    expect(() => createCampaignRuleReadSeam(db, 'c1', 'test-position')).toThrow(
      /invalid campaign position/,
    );
    db.close();
  });

  it('provides the shared seam contract: non-ambiguity rules and ambiguity rulings separately', () => {
    const db = bareDb();
    createCampaignRule(db, rule('house', 1));
    createCampaignRule(db, rule('recurring', 1, 'ruling'));
    createCampaignRule(db, ambiguityRuling('ruling', 1), {
      validation: { ambiguity },
    });
    const seam = createCampaignRuleReadSeam(
      db,
      'c1',
      formatCampaignPosition(p(2)),
    );
    expect(
      seam
        .activeRulesAtPosition({
          campaignPosition: formatCampaignPosition(p(2)),
          candidateRecordKeys: [],
        })
        .map((r) => r.ruleIdentity),
    ).toEqual(['recurring', 'house']);
    expect(
      seam.activeRulingsForAmbiguities(['amb-1']).map((r) => r.ruleIdentity),
    ).toEqual(['ruling']);
    expect(seam.activeRulingsForAmbiguities(['not-q'])).toEqual([]);
    expect(
      listActiveRulingsForAmbiguitiesAtPosition(
        db,
        'c1',
        ['amb-1'],
        formatCampaignPosition(p(2)),
      ).map((r) => r.ruleIdentity),
    ).toEqual(['ruling']);
    expect(
      seam
        .activeRulesAtPosition({
          campaignPosition: formatCampaignPosition(p(2)),
          candidateRecordKeys: [],
        })
        .map((r) => r.ruleIdentity),
    ).not.toContain('ruling');
    db.close();
  });

  it('rejects a seam position override that differs from its bound position', () => {
    const db = bareDb();
    createCampaignRule(db, rule('house-early', 1));
    createCampaignRule(db, rule('house-late', 10));
    const seam = createCampaignRuleReadSeam(
      db,
      'c1',
      formatCampaignPosition(p(10)),
    );

    expect(
      seam
        .activeRulesAtPosition({ candidateRecordKeys: [] })
        .map((item) => item.ruleIdentity),
    ).toEqual(['house-early', 'house-late']);
    expect(() =>
      seam.activeRulesAtPosition({
        campaignPosition: formatCampaignPosition(p(5)),
        candidateRecordKeys: [],
      }),
    ).toThrow(/campaign rule seam is bound to/);
    db.close();
  });

  it('carries a recurring-question ruling through the DB seam and discovery join', () => {
    const db = bareDb();
    createCampaignRule(db, rule('recurring', 1, 'ruling'));
    const seam = createCampaignRuleReadSeam(
      db,
      'c1',
      formatCampaignPosition(p(2)),
    );
    const projection = seam.activeRulesAtPosition({
      candidateRecordKeys: ['record:one'],
    })[0];
    expect(projection).toMatchObject({
      ruleIdentity: 'recurring',
      ruleKind: 'ruling',
      provenance: 'question:q1',
      governingRecordKeys: ['record:one'],
    });
    expect(projection).not.toHaveProperty('ambiguityId');
    expect(projection).not.toHaveProperty('selectedInterpretationId');

    const trace = joinCampaignRules(
      [
        {
          candidateKey: 'record:one',
          targetKind: 'rules-record',
          routes: [],
          traversals: [],
          campaignRules: [],
          campaignRulings: [],
        },
      ],
      seam,
      { campaignPosition: formatCampaignPosition(p(2)) },
    );
    const candidate = trace.outputsProduced[0];
    expect(candidate?.campaignRules).toEqual([
      expect.objectContaining({
        ruleIdentity: 'recurring',
        ruleKind: 'ruling',
        provenance: 'question:q1',
      }),
    ]);
    expect(candidate?.campaignRules[0]).not.toHaveProperty('ambiguityId');
    expect(candidate?.campaignRulings).toEqual([]);
    expect(candidate?.routes[0]?.routeClass).toBe('campaign-rule');
    db.close();
  });

  it('rejects overlapping active ambiguity rulings', () => {
    const db = bareDb();
    createCampaignRule(db, ambiguityRuling('ruling-one', 1), {
      validation: { ambiguity },
    });
    const secondAmbiguity = {
      ...ambiguity,
      interpretations: [
        ...ambiguity.interpretations,
        { id: 'int-2', summary: 'The second interpretation' },
      ],
    };
    expect(() =>
      createCampaignRule(
        db,
        {
          ...ambiguityRuling('ruling-two', 2),
          provenance: {
            kind: 'ambiguity',
            ambiguityId: ambiguity.id,
            selectedInterpretationId: 'int-2',
          },
        },
        { validation: { ambiguity: secondAmbiguity } },
      ),
    ).toThrow(/overlaps/);
    db.close();
  });

  it('cancels a future rule at the next position before it takes effect', () => {
    const db = bareDb();
    const current = persistPositions(db, 2, 'future-cancel');
    createCampaignRule(db, rule('future-to-cancel', 9), {
      currentPosition: current,
    });

    const revoked = revokeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'future-to-cancel',
      revokedPosition: p(3),
      currentPosition: current,
    });
    expect(revoked).toMatchObject({ status: 'revoked' });
    for (const ordinal of [2, 9, 10]) {
      expect(
        listActiveCampaignRulesAtPosition(
          db,
          'c1',
          formatCampaignPosition(p(ordinal)),
        ).map((item) => item.ruleIdentity),
      ).not.toContain('future-to-cancel');
    }
    db.close();
  });

  it('rejects empty governing keys and places restored duplicate keys idempotently', () => {
    const db = bareDb();
    expect(() =>
      createCampaignRule(
        db,
        rule('empty-governing-keys', 1, 'house-rule', {
          governingRecordKeys: [],
        }),
      ),
    ).toThrow('governingRecordKeys must contain at least one record key');
    expect(() =>
      createCampaignRule(
        db,
        rule('blank-governing-key', 1, 'house-rule', {
          governingRecordKeys: [''],
        }),
      ),
    ).toThrow('governingRecordKeys[0] must be a non-empty string');
    expect(() =>
      createCampaignRule(
        db,
        rule('duplicate-governing-keys', 1, 'house-rule', {
          governingRecordKeys: ['spell:fireball', 'spell:fireball'],
        }),
      ),
    ).toThrow("governingRecordKeys contains duplicate key 'spell:fireball'");

    createCampaignRule(
      db,
      rule('legacy-duplicate-governing-keys', 1, 'house-rule', {
        governingRecordKeys: ['spell:fireball'],
      }),
    );
    db.prepare(
      'UPDATE campaign_rule SET governing_record_keys_json = ? WHERE rule_identity = ?',
    ).run(
      JSON.stringify(['spell:fireball', 'spell:fireball']),
      'legacy-duplicate-governing-keys',
    );
    const position = formatCampaignPosition(p(1));
    const trace = joinCampaignRules(
      [],
      createCampaignRuleReadSeam(db, 'c1', position),
      {
        campaignPosition: position,
        stack: resolveStrictCampaignRulesStack(db),
      },
    );
    const fireball = trace.outputsProduced.find(
      (candidate) => candidate.candidateKey === 'spell:fireball',
    );
    expect(fireball?.campaignRules.map((item) => item.ruleIdentity)).toEqual([
      'legacy-duplicate-governing-keys',
    ]);
    expect(
      trace.placedRules.filter(
        ({ ruleIdentity }) =>
          ruleIdentity === 'legacy-duplicate-governing-keys',
      ),
    ).toHaveLength(1);
    db.close();
  });

  it('keeps historical ambiguity-ruling supersession intervals disjoint', () => {
    const db = bareDb();
    createCampaignRule(db, ambiguityRuling('old-ruling', 1), {
      validation: { ambiguity },
    });
    supersedeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'old-ruling',
      successor: ambiguityRuling('new-ruling', 5),
      validation: { ambiguity },
    });
    expect(
      listActiveRulingsForAmbiguitiesAtPosition(
        db,
        'c1',
        [ambiguity.id],
        formatCampaignPosition(p(4)),
      ).map((item) => item.ruleIdentity),
    ).toEqual(['old-ruling']);
    expect(
      listActiveRulingsForAmbiguitiesAtPosition(
        db,
        'c1',
        [ambiguity.id],
        formatCampaignPosition(p(5)),
      ).map((item) => item.ruleIdentity),
    ).toEqual(['new-ruling']);
    db.close();
  });

  it('uses one current-position authority when superseding a historical rule', () => {
    const db = bareDb();
    createCampaignRule(
      db,
      {
        ...ambiguityRuling('historical', 1),
        effectivePosition: p(1),
      },
      {
        currentPosition: p(0),
        validation: { ambiguity },
      },
    );
    const current = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId: 'session',
      turnId: 'turn-1',
    });
    const positions = [current];
    for (let ordinal = 2; ordinal <= 10; ordinal += 1) {
      positions.push(
        resolveCampaignPosition(db, {
          campaignId: 'c1',
          sessionId: 'session',
          turnId: `turn-${ordinal}`,
        }),
      );
    }
    const now = positions[9];
    if (now === undefined) throw new Error('missing current position');
    expect(() =>
      supersedeCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'historical',
        successor: {
          ...ambiguityRuling('replacement', 10),
          effectivePosition: p(11),
        },
        currentPosition: now,
        validation: {
          ambiguity,
          currentPosition: now,
        } as never,
      }),
    ).not.toThrow();
    expect(
      getCampaignRule(db, { campaignId: 'c1', ruleIdentity: 'replacement' }),
    ).toBeDefined();
    db.close();
  });

  it('surfaces an ambiguity ruling even when no ambiguity candidate was discovered', () => {
    const db = bareDb();
    const campaignPosition = p(1);
    createCampaignRule(
      db,
      {
        ...ambiguityRuling('unprompted-ruling', 1),
        effectivePosition: campaignPosition,
        governingRecordKeys: ['spell:find-familiar'],
      },
      { currentPosition: p(0), validation: { ambiguity } },
    );
    resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId: 'session',
      turnId: 'turn-1',
    });
    const seam = createCampaignRuleReadSeam(
      db,
      'c1',
      formatCampaignPosition(campaignPosition),
    );
    const trace = joinCampaignRules([], seam, {
      campaignPosition: formatCampaignPosition(campaignPosition),
      stack: resolveStrictCampaignRulesStack(db),
    });
    expect(trace.returnedRuleIdentities).toEqual(['unprompted-ruling']);
    expect(trace.outputsProduced.map((item) => item.candidateKey)).toContain(
      'spell:find-familiar',
    );
    const candidate = trace.outputsProduced.find(
      (item) => item.candidateKey === 'spell:find-familiar',
    );
    expect(candidate?.campaignRulings.map((item) => item.ruleIdentity)).toEqual(
      ['unprompted-ruling'],
    );
    db.close();
  });

  it('keeps contradictory restored ambiguity rulings visible without choosing one', () => {
    const db = bareDb();
    const campaignPosition = formatCampaignPosition(p(1));
    const insert = db.prepare(`
      INSERT INTO campaign_rule (
        campaign_id, rule_identity, rule_kind, status, origin, provenance_kind,
        ambiguity_id, selected_interpretation_id, question_id, rationale,
        effective_position, temporal_mode, disputed_position, superseded_by,
        revoked_position, scope, governing_record_keys_json, prose, provenance,
        session_id, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const [identity, selected] of [
      ['raw-ruling-one', 'presence-required'],
      ['raw-ruling-two', 'active-link-sufficient'],
    ]) {
      insert.run(
        'c1',
        identity,
        'ruling',
        'active',
        'player-approved',
        'ambiguity',
        'ambiguity:find-familiar-permanent-dismissal-after-zero-hp',
        selected,
        null,
        null,
        campaignPosition,
        'prospective',
        null,
        null,
        null,
        'test',
        '[]',
        identity,
        `ambiguity:find-familiar-permanent-dismissal-after-zero-hp#${selected}`,
        'test',
        '2026-09-03T00:00:00.000Z',
      );
    }
    const context = assembleCampaignRulesContext(
      db,
      'c1',
      campaignPosition,
      resolveStrictCampaignRulesStack(db),
    );
    const ambiguityContext = context.ambiguities.find(
      ({ ambiguity }) =>
        ambiguity.id ===
        'ambiguity:find-familiar-permanent-dismissal-after-zero-hp',
    );
    expect(ambiguityContext?.ruling).toBeUndefined();
    expect(
      ambiguityContext?.conflictingRulings.map((r) => r.ruleIdentity),
    ).toEqual(['raw-ruling-one', 'raw-ruling-two']);
    expect(
      renderContextMessage({
        ...assembleContext({
          db,
          campaignId: 'c1',
          campaignPosition,
          sessionId: 'session-1',
          playerInput: 'continue',
        }),
        campaignRules: context,
      }),
    ).toContain(
      'CONFLICT: active rulings raw-ruling-one, raw-ruling-two contradict one another; none is authoritative.',
    );
    db.close();
  });

  it('accounts for restored house rules with ambiguity provenance', () => {
    const db = bareDb();
    const campaignPosition = formatCampaignPosition(p(1));
    db.prepare(`
      INSERT INTO campaign_rule (
        campaign_id, rule_identity, rule_kind, status, origin, provenance_kind,
        ambiguity_id, selected_interpretation_id, question_id, rationale,
        effective_position, temporal_mode, disputed_position, superseded_by,
        revoked_position, scope, governing_record_keys_json, prose, provenance,
        session_id, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'c1',
      'restored-invalid-provenance',
      'house-rule',
      'active',
      'player-approved',
      'ambiguity',
      'ambiguity:find-familiar-permanent-dismissal-after-zero-hp',
      'presence-required',
      null,
      null,
      campaignPosition,
      'prospective',
      null,
      null,
      null,
      'test',
      JSON.stringify(['spell:find-familiar']),
      'Restored invalid rule',
      'ambiguity:find-familiar-permanent-dismissal-after-zero-hp#presence-required',
      'test',
      '2026-09-03T00:00:00.000Z',
    );

    const context = assembleCampaignRulesContext(
      db,
      'c1',
      campaignPosition,
      resolveStrictCampaignRulesStack(db),
    );
    expect(context.unrepresentableRules).toEqual([
      expect.objectContaining({ ruleIdentity: 'restored-invalid-provenance' }),
    ]);
    expect(context.rules).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleIdentity: 'restored-invalid-provenance',
        }),
      ]),
    );
    expect(
      renderContextMessage({
        ...assembleContext({
          db,
          campaignId: 'c1',
          campaignPosition,
          sessionId: 'session-1',
          playerInput: 'continue',
        }),
        campaignRules: context,
      }),
    ).toContain(
      'UNREPRESENTABLE ACTIVE CAMPAIGN RULE restored-invalid-provenance',
    );
    db.close();
  });

  it('isolates campaigns and rejects non-prospective lifecycle changes', () => {
    const db = bareDb();
    createCampaignRule(db, rule('same', 1), withCurrent({}, p(0)));
    const current = persistPositions(db, 5);
    expect(
      getCampaignRule(db, { campaignId: 'c2', ruleIdentity: 'same' }),
    ).toBeUndefined();
    expect(() =>
      revokeCampaignRule(
        db,
        withCurrent(
          {
            campaignId: 'c1',
            ruleIdentity: 'same',
            revokedPosition: persistedPosition(db, 4),
          },
          current,
        ),
      ),
    ).toThrow(
      "campaign rule 'same' cannot be revoked at or before the current position",
    );
    expect(() =>
      supersedeCampaignRule(
        db,
        withCurrent(
          {
            campaignId: 'c1',
            ruleIdentity: 'same',
            successor: rule('earlier-successor', 4),
          },
          current,
        ),
      ),
    ).toThrow(
      "successor 'earlier-successor' cannot take effect at or before the current position",
    );
    expect(() =>
      supersedeCampaignRule(
        db,
        withCurrent(
          {
            campaignId: 'c1',
            ruleIdentity: 'same',
            successor: { ...rule('other-campaign', 5), campaignId: 'c2' },
          },
          current,
        ),
      ),
    ).toThrow('supersession cannot cross campaigns');
    db.close();
  });

  it('rejects re-superseding and preserves the original supersession chain', () => {
    const db = bareDb();
    createCampaignRule(db, rule('old', 1), withCurrent({}, p(0)));
    supersedeCampaignRule(
      db,
      withCurrent(
        {
          campaignId: 'c1',
          ruleIdentity: 'old',
          successor: rule('first', 5),
        },
        p(0),
      ),
    );
    expect(() =>
      supersedeCampaignRule(
        db,
        withCurrent(
          {
            campaignId: 'c1',
            ruleIdentity: 'old',
            successor: rule('second', 9),
          },
          p(0),
        ),
      ),
    ).toThrow("campaign rule 'old' is already superseded");
    expect(
      getCampaignRule(db, { campaignId: 'c1', ruleIdentity: 'old' }),
    ).toMatchObject({ status: 'superseded', supersededBy: 'first' });
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(p(7)),
      ).map((r) => r.ruleIdentity),
    ).toEqual(['first']);
    db.close();
  });

  it('rejects superseding a revoked rule without changing its revocation', () => {
    const db = bareDb();
    createCampaignRule(db, rule('revoked', 1), withCurrent({}, p(0)));
    const revocationCurrent = persistPositions(db, 4);
    revokeCampaignRule(
      db,
      withCurrent(
        {
          campaignId: 'c1',
          ruleIdentity: 'revoked',
          revokedPosition: p(5),
        },
        revocationCurrent,
      ),
    );
    expect(() =>
      supersedeCampaignRule(
        db,
        withCurrent(
          {
            campaignId: 'c1',
            ruleIdentity: 'revoked',
            successor: rule('successor', 5),
          },
          revocationCurrent,
        ),
      ),
    ).toThrow("campaign rule 'revoked' is revoked");
    expect(
      getCampaignRule(db, { campaignId: 'c1', ruleIdentity: 'revoked' }),
    ).toMatchObject({
      status: 'revoked',
      revokedPosition: {
        ...p(5),
        sessionId: '__future__',
        turnId: '__future__',
      },
    });
    db.close();
  });

  it.each([
    {
      label: 'a house rule',
      successor: () => rule('house-successor', 1),
      validation: undefined,
    },
    {
      label: 'a ruling for a different ambiguity',
      successor: () => ({
        ...ambiguityRuling('different-ruling', 1),
        provenance: {
          kind: 'ambiguity' as const,
          ambiguityId: 'amb-2',
          selectedInterpretationId: 'int-2',
        },
      }),
      validation: {
        ambiguity: {
          ...ambiguity,
          id: 'amb-2',
          interpretations: [
            { id: 'int-2', summary: 'The second interpretation' },
          ],
        },
      },
    },
    {
      label: 'a ruling for the same ambiguity',
      successor: () => ambiguityRuling('same-ruling', 1),
      validation: { ambiguity },
    },
  ])(
    'supersedes an ambiguity ruling with $label',
    ({ successor, validation }) => {
      const db = bareDb();
      const prior = ambiguityRuling('prior-ambiguity-ruling', 1);
      createCampaignRule(db, prior, {
        currentPosition: p(0),
        validation: { ambiguity },
      });

      const replaced = supersedeCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: prior.ruleIdentity,
        successor: successor(),
        currentPosition: p(0),
        validation,
      });

      expect(replaced).toEqual(
        getCampaignRule(db, {
          campaignId: 'c1',
          ruleIdentity: replaced.ruleIdentity,
        }),
      );
      expect(
        getCampaignRule(db, {
          campaignId: 'c1',
          ruleIdentity: prior.ruleIdentity,
        }),
      ).toMatchObject({
        status: 'superseded',
        supersededBy: replaced.ruleIdentity,
      });
      db.close();
    },
  );

  it('supersedes a ruling at the immediately preceding disputed turn', () => {
    const db = bareDb();
    const previous = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId: 's1',
      turnId: 'turn-1',
    });
    const prior = {
      ...ambiguityRuling('prior-ruling', 1),
      effectivePosition: previous,
      temporalMode: {
        mode: 'disputed-turn' as const,
        disputedPosition: previous,
      },
    };
    createCampaignRule(db, prior, {
      validation: { ambiguity },
      currentPosition: previous,
    });
    const current = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId: 's1',
      turnId: 'turn-2',
    });
    const successor = ambiguityRuling('corrected-ruling', 1);
    supersedeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: prior.ruleIdentity,
      successor: {
        ...successor,
        effectivePosition: previous,
        temporalMode: {
          mode: 'disputed-turn',
          disputedPosition: previous,
        },
      },
      currentPosition: current,
      validation: { ambiguity },
    });
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(previous),
      ).map((item) => item.ruleIdentity),
    ).toEqual(['corrected-ruling']);

    const third = rule('third-rule', 1);
    createCampaignRule(
      db,
      {
        ...third,
        effectivePosition: previous,
        temporalMode: {
          mode: 'disputed-turn',
          disputedPosition: previous,
        },
      },
      {
        currentPosition: current,
      },
    );
    const older = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId: 's1',
      turnId: 'turn-3',
    });
    expect(() =>
      supersedeCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: third.ruleIdentity,
        successor: {
          ...rule('too-old-correction', 1),
          effectivePosition: previous,
          temporalMode: {
            mode: 'disputed-turn',
            disputedPosition: previous,
          },
        },
        currentPosition: older,
      }),
    ).toThrow(
      'disputed-turn mode may target only the current or immediately preceding turn',
    );
    db.close();
  });

  it('rejects a disputed anchor that disagrees with persisted chronology', () => {
    const db = bareDb();
    const previous = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId: 'session-1',
      turnId: 'turn-1',
    });
    const current = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId: 'session-1',
      turnId: 'turn-2',
    });
    expect(() =>
      createCampaignRule(
        db,
        {
          ...ambiguityRuling('fabricated-anchor', previous.ordinal),
          effectivePosition: {
            ...previous,
            turnId: current.turnId,
          },
          temporalMode: {
            mode: 'disputed-turn',
            disputedPosition: {
              ...previous,
              turnId: current.turnId,
            },
          },
        },
        { currentPosition: current, validation: { ambiguity } },
      ),
    ).toThrow(
      'temporalMode.disputedPosition does not match the persisted campaign turn position',
    );
    db.close();
  });

  it('uses decoded position ordering for equal-ordinal active queries', () => {
    const db = bareDb();
    const space = {
      sessionId: 'a b',
      turnId: 'turn-space',
      ordinal: 4,
    };
    const bang = {
      sessionId: 'a!b',
      turnId: 'turn-bang',
      ordinal: 4,
    };
    createCampaignRule(db, {
      ...rule('space', 4),
      effectivePosition: space,
    });
    createCampaignRule(db, {
      ...rule('bang', 4),
      effectivePosition: bang,
    });
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(bang),
      ).map((item) => item.ruleIdentity),
    ).toEqual(['bang', 'space']);
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(space),
      ).map((item) => item.ruleIdentity),
    ).toEqual(['bang', 'space']);
    db.close();
  });

  it('canonicalizes a fabricated future effective-position chronology anchor', () => {
    const db = bareDb();
    const current = persistPositions(db, 2, 'canonical');
    createCampaignRule(
      db,
      rule('fabricated-effective', 3, 'house-rule', {
        effectivePosition: { ...p(3), turnId: 'turn-z' },
      }),
      withCurrent({}, current),
    );
    expect(
      getCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'fabricated-effective',
      })?.effectivePosition,
    ).toEqual({
      ...p(3),
      sessionId: '__future__',
      turnId: '__future__',
    });

    db.close();
  });

  it('canonicalizes a fabricated future revocation-position chronology anchor', () => {
    const db = bareDb();
    createCampaignRule(db, rule('fabricated-revocation', 1), {
      currentPosition: p(0),
    });
    const current = persistPositions(db, 2, 'canonical');
    revokeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'fabricated-revocation',
      revokedPosition: {
        sessionId: 'invented-session',
        turnId: 'invented-turn',
        ordinal: 999999,
      },
      currentPosition: current,
    });
    expect(
      getCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'fabricated-revocation',
      }),
    ).toMatchObject({
      status: 'revoked',
      revokedPosition: {
        sessionId: '__future__',
        turnId: '__future__',
        ordinal: 999999,
      },
    });

    db.close();
  });

  it('canonicalizes a fabricated future supersession effective-position anchor', () => {
    const db = bareDb();
    createCampaignRule(db, rule('superseded-prior', 1), {
      currentPosition: p(0),
    });
    const current = persistPositions(db, 2, 'canonical');
    const successor = supersedeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'superseded-prior',
      successor: rule('fabricated-successor', 3, 'house-rule', {
        effectivePosition: { ...p(3), turnId: 'turn-z' },
      }),
      currentPosition: current,
    });
    expect(successor.effectivePosition).toEqual({
      ...p(3),
      sessionId: '__future__',
      turnId: '__future__',
    });
    db.close();
  });

  it('rejects dangling supersession and direct creation of historical rows', () => {
    const db = bareDb();
    expect(() =>
      createCampaignRule(
        db,
        withCurrent(
          {
            ...rule('bad-superseded', 10),
            status: 'superseded',
            supersededBy: 'does-not-exist',
          },
          p(0),
        ),
      ),
    ).toThrow(/requires active status/);
    createCampaignRule(db, rule('successor', 12), withCurrent({}, p(0)));
    expect(() =>
      createCampaignRule(
        db,
        withCurrent(
          {
            ...rule('historical-revoked', 10),
            status: 'revoked',
            revokedPosition: p(11),
          },
          p(0),
        ),
      ),
    ).toThrow(/requires active status/);
    expect(() =>
      createCampaignRule(
        db,
        withCurrent(
          {
            ...rule('historical-superseded', 10),
            status: 'superseded',
            supersededBy: 'successor',
          },
          p(0),
        ),
      ),
    ).toThrow(/requires active status/);
    db.close();
  });

  it('rejects prospective creation before current position while preserving bounded disputed turns', () => {
    const db = bareDb();
    createCampaignRule(db, rule('existing', 5), withCurrent({}, p(0)));
    const positions = Array.from({ length: 10 }, (_, index) =>
      resolveCampaignPosition(db, {
        campaignId: 'c1',
        sessionId: 's10',
        turnId: `t${index + 1}`,
      }),
    );
    const currentPosition = positions[9];
    if (currentPosition === undefined)
      throw new Error('missing current position');
    const before = listCampaignRules(db, { campaignId: 'c1' });
    expect(() =>
      createCampaignRule(
        db,
        rule('backdated', 9),
        withCurrent({}, currentPosition),
      ),
    ).toThrow(
      'prospective campaign rule cannot take effect at or before the current position',
    );
    expect(listCampaignRules(db, { campaignId: 'c1' })).toEqual(before);
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(p(9)),
      ).map((item) => item.ruleIdentity),
    ).toEqual(['existing']);

    expect(() =>
      createCampaignRule(
        db,
        { ...rule('at-current', 10), effectivePosition: currentPosition },
        withCurrent({}, currentPosition),
      ),
    ).toThrow(
      'prospective campaign rule cannot take effect at or before the current position',
    );
    createCampaignRule(
      db,
      rule('future', 11),
      withCurrent({}, currentPosition),
    );
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(p(10)),
      ).map((item) => item.ruleIdentity),
    ).toEqual(['existing']);
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(p(11)),
      ).map((item) => item.ruleIdentity),
    ).toEqual(['existing', 'future']);

    const currentTurn = currentPosition;
    const previousTurn = positions[8];
    const olderTurn = positions[7];
    if (previousTurn === undefined || olderTurn === undefined)
      throw new Error('missing disputed-turn positions');
    createCampaignRule(
      db,
      rule('disputed-current', 10, 'ruling', {
        effectivePosition: currentTurn,
        temporalMode: { mode: 'disputed-turn', disputedPosition: currentTurn },
      }),
      withCurrent({}, currentTurn),
    );
    createCampaignRule(
      db,
      rule('disputed-previous', 9, 'ruling', {
        effectivePosition: previousTurn,
        temporalMode: { mode: 'disputed-turn', disputedPosition: previousTurn },
      }),
      withCurrent({}, currentTurn),
    );
    expect(() =>
      createCampaignRule(
        db,
        rule('disputed-too-old', 8, 'ruling', {
          effectivePosition: olderTurn,
          temporalMode: { mode: 'disputed-turn', disputedPosition: olderTurn },
        }),
        withCurrent({}, currentTurn),
      ),
    ).toThrow(
      'disputed-turn mode may target only the current or immediately preceding turn',
    );
    db.close();
  });

  it('E1 rejects ordinary creation at committed P10 and activates P11 rules prospectively', () => {
    const db = bareDb();
    const current = persistPositions(db, 10, 'e1');
    const before = listActiveCampaignRulesAtPosition(
      db,
      'c1',
      formatCampaignPosition(current),
    );
    expect(() =>
      createCampaignRule(
        db,
        { ...rule('at-committed-current', 10), effectivePosition: current },
        {
          currentPosition: current,
        },
      ),
    ).toThrow(
      'prospective campaign rule cannot take effect at or before the current position',
    );
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(current),
      ),
    ).toEqual(before);

    createCampaignRule(db, rule('at-next-turn', 11), {
      currentPosition: current,
    });
    expect(
      getCampaignRule(db, { campaignId: 'c1', ruleIdentity: 'at-next-turn' })
        ?.effectivePosition,
    ).toEqual({
      ...p(11),
      sessionId: '__future__',
      turnId: '__future__',
    });
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(current),
      ).map((item) => item.ruleIdentity),
    ).toEqual([]);
    const next = persistPositions(db, 11, 'e1');
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(next),
      ).map((item) => item.ruleIdentity),
    ).toEqual(['at-next-turn']);
    db.close();
  });

  it('E2 rejects revocation at committed P10 and canonicalizes a P11 revocation', () => {
    const db = bareDb();
    createCampaignRule(db, rule('active-at-ten', 1));
    const current = persistPositions(db, 10, 'e2');
    const before = listActiveCampaignRulesAtPosition(
      db,
      'c1',
      formatCampaignPosition(current),
    );
    expect(() =>
      revokeCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'active-at-ten',
        revokedPosition: current,
        currentPosition: current,
      }),
    ).toThrow(
      "campaign rule 'active-at-ten' cannot be revoked at or before the current position",
    );
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(current),
      ),
    ).toEqual(before);

    revokeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'active-at-ten',
      revokedPosition: p(11),
      currentPosition: current,
    });
    expect(
      getCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'active-at-ten',
      }),
    ).toMatchObject({
      revokedPosition: {
        ...p(11),
        sessionId: '__future__',
        turnId: '__future__',
      },
    });
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(current),
      ).map((item) => item.ruleIdentity),
    ).toEqual(['active-at-ten']);
    const next = persistPositions(db, 11, 'e2');
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(next),
      ).map((item) => item.ruleIdentity),
    ).toEqual([]);
    db.close();
  });

  it('E3 rejects supersession at committed P10 and starts the successor at P11', () => {
    const db = bareDb();
    createCampaignRule(db, rule('prior-at-ten', 1));
    const current = persistPositions(db, 10, 'e3');
    const before = listActiveCampaignRulesAtPosition(
      db,
      'c1',
      formatCampaignPosition(current),
    );
    expect(() =>
      supersedeCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'prior-at-ten',
        successor: {
          ...rule('successor-at-ten', 10),
          effectivePosition: current,
        },
        currentPosition: current,
      }),
    ).toThrow(
      "successor 'successor-at-ten' cannot take effect at or before the current position",
    );
    expect(listCampaignRules(db, { campaignId: 'c1' })).toHaveLength(1);
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(current),
      ),
    ).toEqual(before);

    supersedeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'prior-at-ten',
      successor: rule('successor-at-eleven', 11),
      currentPosition: current,
    });
    expect(
      getCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'successor-at-eleven',
      })?.effectivePosition,
    ).toEqual({
      ...p(11),
      sessionId: '__future__',
      turnId: '__future__',
    });
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(current),
      ).map((item) => item.ruleIdentity),
    ).toEqual(['prior-at-ten']);
    const next = persistPositions(db, 11, 'e3');
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(next),
      ).map((item) => item.ruleIdentity),
    ).toEqual(['successor-at-eleven']);
    db.close();
  });

  it('E4 preserves disputed-turn creation and supersession at current and previous cross-session turns', () => {
    const db = bareDb();
    const previous = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId: 'e4-session-one',
      turnId: 'turn-one',
    });
    const current = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId: 'e4-session-two',
      turnId: 'turn-two',
    });
    expect(() =>
      createCampaignRule(
        db,
        {
          ...rule('ordinary-at-current', current.ordinal),
          effectivePosition: current,
        },
        { currentPosition: current },
      ),
    ).toThrow(
      'prospective campaign rule cannot take effect at or before the current position',
    );

    const disputedCurrent = {
      ...rule('disputed-current', current.ordinal),
      effectivePosition: current,
      temporalMode: {
        mode: 'disputed-turn' as const,
        disputedPosition: current,
      },
    };
    const disputedPrevious = {
      ...rule('disputed-previous', previous.ordinal),
      effectivePosition: previous,
      temporalMode: {
        mode: 'disputed-turn' as const,
        disputedPosition: previous,
      },
    };
    createCampaignRule(db, disputedCurrent, { currentPosition: current });
    createCampaignRule(db, disputedPrevious, { currentPosition: current });
    supersedeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'disputed-current',
      successor: {
        ...rule('corrected-current', current.ordinal),
        effectivePosition: current,
        temporalMode: {
          mode: 'disputed-turn',
          disputedPosition: current,
        },
      },
      currentPosition: current,
    });
    supersedeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'disputed-previous',
      successor: {
        ...rule('corrected-previous', previous.ordinal),
        effectivePosition: previous,
        temporalMode: {
          mode: 'disputed-turn',
          disputedPosition: previous,
        },
      },
      currentPosition: current,
    });
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(previous),
      ).map((item) => item.ruleIdentity),
    ).toEqual(['corrected-previous']);
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(current),
      ).map((item) => item.ruleIdentity),
    ).toEqual(['corrected-previous', 'corrected-current']);
    db.close();
  });

  it('E5 cancels a future rule at current+1 without changing the current active set', () => {
    const db = bareDb();
    const current = persistPositions(db, 2, 'e5');
    createCampaignRule(db, rule('future-cancelled', 9), {
      currentPosition: current,
    });
    const before = listActiveCampaignRulesAtPosition(
      db,
      'c1',
      formatCampaignPosition(current),
    );
    revokeCampaignRule(db, {
      campaignId: 'c1',
      ruleIdentity: 'future-cancelled',
      revokedPosition: p(3),
      currentPosition: current,
    });
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(current),
      ),
    ).toEqual(before);
    const atEffective = persistPositions(db, 9, 'e5');
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(atEffective),
      ).map((item) => item.ruleIdentity),
    ).not.toContain('future-cancelled');
    const afterEffective = persistPositions(db, 10, 'e5');
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(afterEffective),
      ).map((item) => item.ruleIdentity),
    ).not.toContain('future-cancelled');
    db.close();
  });

  it('E6 rejected ordinary mutations preserve rows, chains, and active-at-position results', () => {
    const db = bareDb();
    createCampaignRule(db, rule('existing-rule', 1));
    createCampaignRule(db, rule('revocation-target', 1));
    createCampaignRule(db, rule('supersession-target', 1));
    const current = persistPositions(db, 10, 'e6');
    const beforeRules = listCampaignRules(db, { campaignId: 'c1' });
    const beforeActive = listActiveCampaignRulesAtPosition(
      db,
      'c1',
      formatCampaignPosition(current),
    );
    expect(() =>
      createCampaignRule(
        db,
        { ...rule('rejected-create', 10), effectivePosition: current },
        { currentPosition: current },
      ),
    ).toThrow(
      'prospective campaign rule cannot take effect at or before the current position',
    );
    expect(() =>
      revokeCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'revocation-target',
        revokedPosition: current,
        currentPosition: current,
      }),
    ).toThrow(
      "campaign rule 'revocation-target' cannot be revoked at or before the current position",
    );
    expect(() =>
      supersedeCampaignRule(db, {
        campaignId: 'c1',
        ruleIdentity: 'supersession-target',
        successor: {
          ...rule('rejected-successor', 10),
          effectivePosition: current,
        },
        currentPosition: current,
      }),
    ).toThrow(
      "successor 'rejected-successor' cannot take effect at or before the current position",
    );
    expect(listCampaignRules(db, { campaignId: 'c1' })).toEqual(beforeRules);
    expect(
      listActiveCampaignRulesAtPosition(
        db,
        'c1',
        formatCampaignPosition(current),
      ),
    ).toEqual(beforeActive);
    db.close();
  });

  it('rejects revocation before current position without rewriting historical active sets', () => {
    const db = bareDb();
    createCampaignRule(db, rule('live', 5), withCurrent({}, p(0)));
    const current = persistPositions(db, 10, 's10');
    expect(() =>
      revokeCampaignRule(
        db,
        withCurrent(
          {
            campaignId: 'c1',
            ruleIdentity: 'live',
            revokedPosition: persistedPosition(db, 9),
          },
          current,
        ),
      ),
    ).toThrow(
      "campaign rule 'live' cannot be revoked at or before the current position",
    );
    for (const ordinal of [7, 9, 10]) {
      expect(
        listActiveCampaignRulesAtPosition(
          db,
          'c1',
          formatCampaignPosition(p(ordinal)),
        ).map((item) => item.ruleIdentity),
      ).toEqual(['live']);
    }
    db.close();
  });

  it('rejects supersession before current position without rewriting the prior chain', () => {
    const db = bareDb();
    createCampaignRule(db, rule('old', 5), withCurrent({}, p(0)));
    const current = persistPositions(db, 10, 's10');
    expect(() =>
      supersedeCampaignRule(
        db,
        withCurrent(
          { campaignId: 'c1', ruleIdentity: 'old', successor: rule('new', 9) },
          current,
        ),
      ),
    ).toThrow(
      "successor 'new' cannot take effect at or before the current position",
    );
    expect(
      getCampaignRule(db, { campaignId: 'c1', ruleIdentity: 'new' }),
    ).toBeUndefined();
    expect(
      getCampaignRule(db, { campaignId: 'c1', ruleIdentity: 'old' }),
    ).toMatchObject({ status: 'active', supersededBy: null });
    for (const ordinal of [7, 9, 10]) {
      expect(
        listActiveCampaignRulesAtPosition(
          db,
          'c1',
          formatCampaignPosition(p(ordinal)),
        ).map((item) => item.ruleIdentity),
      ).toEqual(['old']);
    }
    db.close();
  });

  it('fails closed when current-position authority is omitted from every mutation API', () => {
    const db = bareDb();
    expect(() =>
      Reflect.apply(persistCampaignRule, null, [
        db,
        rule('create-without-current', 1),
      ]),
    ).toThrow('currentPosition is required for live campaign rule creation');
    createCampaignRule(
      db,
      rule('revoke-without-current', 1),
      withCurrent({}, p(0)),
    );
    expect(() =>
      Reflect.apply(persistRevokeCampaignRule, null, [
        db,
        {
          campaignId: 'c1',
          ruleIdentity: 'revoke-without-current',
          revokedPosition: p(2),
        },
      ]),
    ).toThrow('currentPosition is required for live campaign rule revocation');
    createCampaignRule(
      db,
      rule('supersede-without-current', 1),
      withCurrent({}, p(0)),
    );
    expect(() =>
      Reflect.apply(persistSupersedeCampaignRule, null, [
        db,
        {
          campaignId: 'c1',
          ruleIdentity: 'supersede-without-current',
          successor: rule('successor-without-current', 2),
        },
      ]),
    ).toThrow(
      'currentPosition is required for live campaign rule supersession',
    );
    db.close();
  });
});
