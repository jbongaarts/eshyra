import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/index.js';
import type { CampaignPosition, CampaignRule } from '../src/internal.js';
import {
  formatCampaignPosition,
  getCampaignRule,
  listActiveCampaignRulesAtPosition,
  listCampaignRules,
  materializeSnapshot,
  createCampaignRule as persistCampaignRule,
  revokeCampaignRule as persistRevokeCampaignRule,
  supersedeCampaignRule as persistSupersedeCampaignRule,
  resolveCampaignPosition,
  serializeCampaign,
  validateCampaignRules,
} from '../src/internal.js';
import { openDatabase } from '../src/persistence/db.js';
import { bareDb } from './support/db.js';

const ambiguity = {
  id: 'amb-matrix',
  question: 'Which interpretation applies?',
  source: [{ locator: 'p.1', clauseId: 'clause-1' }],
  affects: ['record:one'],
  interpretations: [{ id: 'int-1', summary: 'The first interpretation' }],
  canonicalResolution: null,
  runtimeDisposition: { status: 'engine-pending', owner: 'campaign-ruling' },
} as const;

const p = (ordinal: number, sessionId = 's1'): CampaignPosition => ({
  sessionId,
  turnId: `t${ordinal}`,
  ordinal,
});

function rule(
  identity: string,
  ordinal: number,
  overrides: Partial<CampaignRule> = {},
): CampaignRule {
  return {
    ruleIdentity: identity,
    campaignId: 'c1',
    ruleKind: 'house-rule',
    status: 'active',
    origin: 'player-approved',
    provenance: { kind: 'house-rule', rationale: 'matrix' },
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

function ruling(identity: string, ordinal: number): CampaignRule {
  return {
    ...rule(identity, ordinal),
    ruleKind: 'ruling',
    provenance: {
      kind: 'ambiguity',
      ambiguityId: ambiguity.id,
      selectedInterpretationId: 'int-1',
    },
  };
}

type CreateOptions = Parameters<typeof persistCampaignRule>[2];
type RevokeInput = Parameters<typeof persistRevokeCampaignRule>[1];
type SupersedeInput = Parameters<typeof persistSupersedeCampaignRule>[1];

function create(
  db: Db,
  value: CampaignRule,
  currentPosition: CampaignPosition = p(0),
  validation?: CreateOptions['validation'],
): CampaignRule {
  return persistCampaignRule(db, value, { currentPosition, validation });
}

function revoke(
  db: Db,
  input: Omit<RevokeInput, 'currentPosition'>,
  currentPosition: CampaignPosition,
): CampaignRule {
  return persistRevokeCampaignRule(db, { ...input, currentPosition });
}

function supersede(
  db: Db,
  input: Omit<SupersedeInput, 'currentPosition'>,
  currentPosition: CampaignPosition,
): CampaignRule {
  return persistSupersedeCampaignRule(db, { ...input, currentPosition });
}

function persistThrough(
  db: Db,
  through: number,
  sessionId = 's1',
): CampaignPosition {
  let current: CampaignPosition | undefined;
  for (let ordinal = 1; ordinal <= through; ordinal += 1) {
    current = resolveCampaignPosition(db, {
      campaignId: 'c1',
      sessionId,
      turnId: `t${ordinal}`,
    });
  }
  if (current === undefined) throw new Error('missing persisted position');
  return current;
}

function activeIds(db: Db, position: CampaignPosition): string[] {
  return listActiveCampaignRulesAtPosition(
    db,
    'c1',
    formatCampaignPosition(position),
  ).map(({ ruleIdentity }) => ruleIdentity);
}

interface Boundary {
  readonly position: CampaignPosition;
  readonly active: readonly string[];
}

interface AcceptedGraph {
  readonly name: string;
  readonly validation?: Parameters<typeof validateCampaignRules>[1];
  readonly build: (db: Db) => readonly Boundary[];
}

const acceptedGraphs: readonly AcceptedGraph[] = [
  {
    name: 'G1 single active rule',
    build: (db) => {
      create(db, rule('A', 1));
      return [
        { position: p(0), active: [] },
        { position: p(1), active: ['A'] },
        { position: p(20), active: ['A'] },
      ];
    },
  },
  {
    name: 'G2 rule revoked later',
    build: (db) => {
      create(db, rule('A', 1));
      const current = persistThrough(db, 2);
      revoke(
        db,
        { campaignId: 'c1', ruleIdentity: 'A', revokedPosition: p(5) },
        current,
      );
      return [
        { position: p(0), active: [] },
        { position: p(1), active: ['A'] },
        { position: p(4), active: ['A'] },
        { position: p(5), active: [] },
        { position: p(20), active: [] },
      ];
    },
  },
  {
    name: 'G3 scheduled rule cancelled without a prior',
    build: (db) => {
      const current = persistThrough(db, 2);
      create(db, rule('A', 9), current);
      revoke(
        db,
        { campaignId: 'c1', ruleIdentity: 'A', revokedPosition: p(3) },
        current,
      );
      return [
        { position: p(2), active: [] },
        { position: p(3), active: [] },
        { position: p(8), active: [] },
        { position: p(9), active: [] },
        { position: p(20), active: [] },
      ];
    },
  },
  {
    name: 'G4 A superseded by prospective B',
    build: (db) => {
      create(db, rule('A', 1));
      const current = persistThrough(db, 2);
      supersede(
        db,
        { campaignId: 'c1', ruleIdentity: 'A', successor: rule('B', 5) },
        current,
      );
      return [
        { position: p(0), active: [] },
        { position: p(1), active: ['A'] },
        { position: p(4), active: ['A'] },
        { position: p(5), active: ['B'] },
        { position: p(20), active: ['B'] },
      ];
    },
  },
  {
    name: 'G5 A superseded by B then B revoked after effect',
    build: (db) => {
      create(db, rule('A', 1));
      const beforeSupersession = persistThrough(db, 2);
      supersede(
        db,
        { campaignId: 'c1', ruleIdentity: 'A', successor: rule('B', 5) },
        beforeSupersession,
      );
      const beforeRevocation = persistThrough(db, 6);
      revoke(
        db,
        { campaignId: 'c1', ruleIdentity: 'B', revokedPosition: p(8) },
        beforeRevocation,
      );
      return [
        { position: p(0), active: [] },
        { position: p(1), active: ['A'] },
        { position: p(4), active: ['A'] },
        { position: p(5), active: ['B'] },
        { position: p(8), active: [] },
        { position: p(20), active: [] },
      ];
    },
  },
  {
    name: 'G6 A superseded by B superseded by C then C revoked',
    build: (db) => {
      create(db, rule('A', 1));
      const beforeB = persistThrough(db, 2);
      supersede(
        db,
        { campaignId: 'c1', ruleIdentity: 'A', successor: rule('B', 5) },
        beforeB,
      );
      const beforeC = persistThrough(db, 6);
      supersede(
        db,
        { campaignId: 'c1', ruleIdentity: 'B', successor: rule('C', 9) },
        beforeC,
      );
      const beforeRevoke = persistThrough(db, 10);
      revoke(
        db,
        { campaignId: 'c1', ruleIdentity: 'C', revokedPosition: p(12) },
        beforeRevoke,
      );
      return [
        { position: p(0), active: [] },
        { position: p(1), active: ['A'] },
        { position: p(4), active: ['A'] },
        { position: p(5), active: ['B'] },
        { position: p(8), active: ['B'] },
        { position: p(9), active: ['C'] },
        { position: p(12), active: [] },
        { position: p(20), active: [] },
      ];
    },
  },
  {
    name: 'G7 scheduled A superseded by B at the same position',
    build: (db) => {
      const current = persistThrough(db, 2);
      create(db, rule('A', 9), current);
      supersede(
        db,
        { campaignId: 'c1', ruleIdentity: 'A', successor: rule('B', 9) },
        current,
      );
      return [
        { position: p(2), active: [] },
        { position: p(8), active: [] },
        { position: p(9), active: ['B'] },
        { position: p(20), active: ['B'] },
      ];
    },
  },
  {
    name: 'G8 disputed-turn successor at current turn',
    build: (db) => {
      create(db, rule('A', 1));
      const current = persistThrough(db, 5);
      supersede(
        db,
        {
          campaignId: 'c1',
          ruleIdentity: 'A',
          successor: rule('B', 5, {
            temporalMode: { mode: 'disputed-turn', disputedPosition: p(5) },
          }),
        },
        current,
      );
      return [
        { position: p(0), active: [] },
        { position: p(1), active: ['A'] },
        { position: p(4), active: ['A'] },
        { position: p(5), active: ['B'] },
        { position: p(20), active: ['B'] },
      ];
    },
  },
  {
    name: 'G9 disputed-turn successor at immediately preceding turn across sessions',
    build: (db) => {
      create(db, rule('A', 1));
      persistThrough(db, 4, 's1');
      const current = resolveCampaignPosition(db, {
        campaignId: 'c1',
        sessionId: 's2',
        turnId: 't5',
      });
      supersede(
        db,
        {
          campaignId: 'c1',
          ruleIdentity: 'A',
          successor: rule('B', 4, {
            effectivePosition: p(4, 's1'),
            temporalMode: {
              mode: 'disputed-turn',
              disputedPosition: p(4, 's1'),
            },
          }),
        },
        current,
      );
      return [
        { position: p(3, 's1'), active: ['A'] },
        { position: p(4, 's1'), active: ['B'] },
        { position: p(5, 's2'), active: ['B'] },
        { position: p(20, 's2'), active: ['B'] },
      ];
    },
  },
  {
    name: 'G10 disjoint ambiguity-ruling intervals',
    validation: { ambiguity },
    build: (db) => {
      create(db, ruling('R1', 1), p(0), { ambiguity });
      const current = persistThrough(db, 2);
      revoke(
        db,
        { campaignId: 'c1', ruleIdentity: 'R1', revokedPosition: p(3) },
        current,
      );
      create(db, ruling('R2', 5), current, { ambiguity });
      return [
        { position: p(0), active: [] },
        { position: p(1), active: ['R1'] },
        { position: p(2), active: ['R1'] },
        { position: p(3), active: [] },
        { position: p(4), active: [] },
        { position: p(5), active: ['R2'] },
        { position: p(20), active: ['R2'] },
      ];
    },
  },
];

function expectGraph(
  db: Db,
  graph: AcceptedGraph,
  boundaries: readonly Boundary[],
): void {
  validateCampaignRules(
    listCampaignRules(db, { campaignId: 'c1' }),
    graph.validation,
  );
  for (const boundary of boundaries)
    expect(activeIds(db, boundary.position)).toEqual(boundary.active);
}

describe('campaign rule lifecycle matrix', () => {
  it.each(acceptedGraphs)(
    '$name survives validation and snapshot round trip',
    (graph) => {
      const root = mkdtempSync(join(tmpdir(), 'eshyra-rule-matrix-'));
      const dest = join(root, 'restored.db');
      const db = bareDb();
      try {
        const boundaries = graph.build(db);
        expectGraph(db, graph, boundaries);
        const beforeRules = listCampaignRules(db, { campaignId: 'c1' });
        materializeSnapshot(serializeCampaign(db), dest);
        const restored = openDatabase(dest);
        try {
          expect(listCampaignRules(restored, { campaignId: 'c1' })).toEqual(
            beforeRules,
          );
          expectGraph(restored, graph, boundaries);
        } finally {
          restored.close();
        }
      } finally {
        db.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it('X1 rejects reverse-time supersession at store and validator boundaries atomically', () => {
    const db = bareDb();
    create(db, rule('A', 10));
    const beforeRules = listCampaignRules(db, { campaignId: 'c1' });
    const beforeActive = activeIds(db, p(10));
    expect(() =>
      supersede(
        db,
        { campaignId: 'c1', ruleIdentity: 'A', successor: rule('B', 5) },
        p(0),
      ),
    ).toThrow("successor 'B' cannot take effect before 'A'");
    expect(listCampaignRules(db, { campaignId: 'c1' })).toEqual(beforeRules);
    expect(activeIds(db, p(10))).toEqual(beforeActive);
    expect(() =>
      validateCampaignRules([
        rule('A', 10, { status: 'superseded', supersededBy: 'B' }),
        rule('B', 5),
      ]),
    ).toThrow("successor 'B' cannot take effect before 'A'");
    db.close();
  });

  it('X2 rejects cancellation of a scheduled successor at store and validator boundaries atomically', () => {
    const db = bareDb();
    create(db, rule('A', 1));
    const current = persistThrough(db, 2);
    supersede(
      db,
      { campaignId: 'c1', ruleIdentity: 'A', successor: rule('B', 9) },
      current,
    );
    const beforeRules = listCampaignRules(db, { campaignId: 'c1' });
    const beforeActive = [activeIds(db, p(2)), activeIds(db, p(9))];
    expect(() =>
      revoke(
        db,
        {
          campaignId: 'c1',
          ruleIdentity: 'B',
          revokedPosition: {
            sessionId: 'fabricated-session',
            turnId: 'fabricated-turn',
            ordinal: 9,
          },
        },
        current,
      ),
    ).toThrow(
      "campaign rule 'B' supersedes 'A' and cannot be revoked before it takes effect; supersede it instead",
    );
    expect(listCampaignRules(db, { campaignId: 'c1' })).toEqual(beforeRules);
    expect([activeIds(db, p(2)), activeIds(db, p(9))]).toEqual(beforeActive);
    expect(() =>
      validateCampaignRules(listCampaignRules(db, { campaignId: 'c1' })),
    ).not.toThrow();
    expect(() =>
      revoke(
        db,
        { campaignId: 'c1', ruleIdentity: 'B', revokedPosition: p(3) },
        current,
      ),
    ).toThrow(
      "campaign rule 'B' supersedes 'A' and cannot be revoked before it takes effect; supersede it instead",
    );
    expect(listCampaignRules(db, { campaignId: 'c1' })).toEqual(beforeRules);
    expect([activeIds(db, p(2)), activeIds(db, p(9))]).toEqual(beforeActive);
    expect(() =>
      validateCampaignRules([
        rule('A', 1, { status: 'superseded', supersededBy: 'B' }),
        rule('B', 9, { status: 'revoked', revokedPosition: p(3) }),
      ]),
    ).toThrow("successor 'B' of 'A' was revoked before taking effect");

    const positiveDb = bareDb();
    create(positiveDb, rule('A', 1));
    const positiveCurrent = persistThrough(positiveDb, 2);
    supersede(
      positiveDb,
      { campaignId: 'c1', ruleIdentity: 'A', successor: rule('B', 9) },
      positiveCurrent,
    );
    const revoked = revoke(
      positiveDb,
      { campaignId: 'c1', ruleIdentity: 'B', revokedPosition: p(10) },
      positiveCurrent,
    );
    expect(revoked.revokedPosition).toEqual({
      sessionId: '__future__',
      turnId: '__future__',
      ordinal: 10,
    });
    expect(activeIds(positiveDb, p(9))).toEqual(['B']);
    expect(activeIds(positiveDb, p(10))).toEqual([]);
    expect(() =>
      validateCampaignRules(
        listCampaignRules(positiveDb, { campaignId: 'c1' }),
      ),
    ).not.toThrow();
    positiveDb.close();
    db.close();
  });

  it('X3 rejects two priors naming one successor at validator and store boundaries atomically', () => {
    const db = bareDb();
    create(db, rule('A1', 1));
    create(db, rule('A2', 1));
    supersede(
      db,
      { campaignId: 'c1', ruleIdentity: 'A1', successor: rule('B', 2) },
      p(0),
    );
    const beforeRules = listCampaignRules(db, { campaignId: 'c1' });
    const beforeActive = activeIds(db, p(2));
    expect(() =>
      supersede(
        db,
        { campaignId: 'c1', ruleIdentity: 'A2', successor: rule('B', 2) },
        p(0),
      ),
    ).toThrow("campaign rule 'B' already exists");
    expect(listCampaignRules(db, { campaignId: 'c1' })).toEqual(beforeRules);
    expect(activeIds(db, p(2))).toEqual(beforeActive);
    expect(() =>
      validateCampaignRules([
        rule('A1', 1, { status: 'superseded', supersededBy: 'B' }),
        rule('A2', 1, { status: 'superseded', supersededBy: 'B' }),
        rule('B', 2),
      ]),
    ).toThrow("campaign rule 'B' is named as successor by more than one rule");
    db.close();
  });

  it('X4 rejects overlapping ambiguity rulings at validator and store boundaries atomically', () => {
    const db = bareDb();
    create(db, ruling('R1', 1), p(0), { ambiguity });
    const beforeRules = listCampaignRules(db, { campaignId: 'c1' });
    const beforeActive = activeIds(db, p(1));
    expect(() => create(db, ruling('R2', 2), p(0), { ambiguity })).toThrow(
      "active ambiguity ruling 'R2' overlaps 'R1' for ambiguity 'amb-matrix'",
    );
    expect(listCampaignRules(db, { campaignId: 'c1' })).toEqual(beforeRules);
    expect(activeIds(db, p(1))).toEqual(beforeActive);
    expect(() =>
      validateCampaignRules([ruling('R1', 1), ruling('R2', 2)], { ambiguity }),
    ).toThrow(
      "active ambiguity ruling 'R2' overlaps 'R1' for ambiguity 'amb-matrix'",
    );
    db.close();
  });

  it('X5 rejects asymmetric hydrated rows and domain rules without mutating the store', () => {
    const db = bareDb();
    create(db, rule('hydrated', 1));
    const variants = [
      {
        status: 'superseded',
        supersededBy: null,
        hydrationMessage:
          "superseded campaign rule 'hydrated' is missing superseded_by",
        domainRule: rule('domain-missing-successor', 1, {
          status: 'superseded',
          supersededBy: null,
        }),
        domainMessage: 'superseded rule must name supersededBy',
      },
      {
        status: 'active',
        supersededBy: 'successor',
        hydrationMessage:
          "only a superseded rule may name supersededBy (campaign rule 'hydrated')",
        domainRule: rule('domain-illegal-successor', 1, {
          supersededBy: 'successor',
        }),
        domainMessage: 'only a superseded rule may name supersededBy',
      },
    ] as const;
    for (const variant of variants) {
      db.pragma('ignore_check_constraints = ON');
      db.prepare(
        'UPDATE campaign_rule SET status = ?, superseded_by = ? WHERE rule_identity = ?',
      ).run(variant.status, variant.supersededBy, 'hydrated');
      const before = serializeCampaign(db);
      expect(() =>
        getCampaignRule(db, { campaignId: 'c1', ruleIdentity: 'hydrated' }),
      ).toThrow(variant.hydrationMessage);
      expect(() => listCampaignRules(db, { campaignId: 'c1' })).toThrow(
        variant.hydrationMessage,
      );
      expect(() =>
        listActiveCampaignRulesAtPosition(
          db,
          'c1',
          formatCampaignPosition(p(1)),
        ),
      ).toThrow(variant.hydrationMessage);
      expect(serializeCampaign(db)).toEqual(before);
      expect(() => validateCampaignRules([variant.domainRule])).toThrow(
        variant.domainMessage,
      );
    }
    db.close();
  });
});
