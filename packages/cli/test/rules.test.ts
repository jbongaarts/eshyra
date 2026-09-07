import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assembleCampaignRulesContext,
  type CampaignPosition,
  createCampaign,
  createCampaignRule,
  EMBERFALL_HOLLOW,
  formatCampaignPosition,
  getCampaignRule,
  initSchema,
  listCampaignRules,
  openDatabase,
  resolveStrictCampaignRulesStack,
} from '@eshyra/core';
import { resolveCampaignPosition } from '@eshyra/core/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { type RulesDeps, runRulesCommand } from '../src/rules.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function campaignDb(campaignId = 'c1'): string {
  const dbPath = join(tempDir('esh-rules-'), `${campaignId}.db`);
  const db = openDatabase(dbPath);
  try {
    initSchema(db);
    createCampaign(db, { campaignId, pack: EMBERFALL_HOLLOW });
  } finally {
    db.close();
  }
  return dbPath;
}

interface Harness {
  readonly deps: RulesDeps;
  readonly logs: string[];
}

function harness(dbPath?: string): Harness {
  const logs: string[] = [];
  return {
    logs,
    deps: {
      root: join(tempDir('esh-rules-root-'), 'data'),
      env: dbPath === undefined ? {} : { ESHYRA_DB_PATH: dbPath },
      log: (message) => logs.push(message),
    },
  };
}

function invoke(
  dbPath: string,
  args: string[],
): { code: number; output: string } {
  const h = harness(dbPath);
  return { code: runRulesCommand(args, h.deps), output: h.logs.join('\n') };
}

function advance(dbPath: string, through: number, campaignId = 'c1'): void {
  const db = openDatabase(dbPath);
  try {
    for (let ordinal = 1; ordinal <= through; ordinal += 1) {
      resolveCampaignPosition(db, {
        campaignId,
        sessionId: 'cli-session',
        turnId: `turn-${ordinal}`,
      });
    }
  } finally {
    db.close();
  }
}

function persistedPosition(ordinal: number): CampaignPosition {
  return { sessionId: 'cli-session', turnId: `turn-${ordinal}`, ordinal };
}

/** Persist a house rule effective at the start of the (disputed) current turn. */
function createDisputedTurnRule(
  dbPath: string,
  ruleIdentity: string,
  current: CampaignPosition,
): void {
  const db = openDatabase(dbPath);
  try {
    createCampaignRule(
      db,
      {
        ruleIdentity,
        campaignId: 'c1',
        ruleKind: 'house-rule',
        status: 'active',
        origin: 'player-approved',
        provenance: { kind: 'house-rule', rationale: 'disputed replay' },
        effectivePosition: current,
        temporalMode: { mode: 'disputed-turn', disputedPosition: current },
        supersededBy: null,
        revokedPosition: null,
        scope: 'combat',
        governingRecordKeys: ['rule:one'],
        prose: 'Applies from the start of the disputed turn.',
      },
      { currentPosition: current },
    );
  } finally {
    db.close();
  }
}

function firstAmbiguity(dbPath: string): {
  id: string;
  interpretationId: string;
} {
  const db = openDatabase(dbPath);
  try {
    const context = assembleCampaignRulesContext(
      db,
      'c1',
      formatCampaignPosition({
        sessionId: 'cli',
        turnId: 'bootstrap',
        ordinal: 0,
      }),
      resolveStrictCampaignRulesStack(db),
    );
    const item = context.ambiguities[0];
    if (item === undefined) throw new Error('test pack has no ambiguities');
    const interpretation = item.ambiguity.interpretations[0];
    if (interpretation === undefined)
      throw new Error('test ambiguity has no interpretation');
    return { id: item.ambiguity.id, interpretationId: interpretation.id };
  } finally {
    db.close();
  }
}

describe('runRulesCommand', () => {
  it('rejects an unknown subcommand with usage', () => {
    const result = invoke(campaignDb(), ['bogus']);
    expect(result.code).toBe(1);
    expect(result.output).toContain('usage: eshyra rules');
  });

  it('fails cleanly when no campaign can be resolved', () => {
    const h = harness();
    expect(runRulesCommand(['list'], h.deps)).toBe(1);
    expect(h.logs.join('\n')).toContain('no campaigns');
  });

  it('adds a house rule with deterministic identity and confirmation metadata', () => {
    const dbPath = campaignDb();
    const result = invoke(dbPath, [
      'add',
      '--kind',
      'house-rule',
      '--prose',
      'Shields grant a small bonus when braced.',
      '--scope',
      'combat',
      '--records',
      'equipment:shield',
      '--rationale',
      'table agreement',
    ]);
    expect(result.code).toBe(0);
    expect(result.output).toContain('house-rule:shields-grant-a-small-bonus:1');
    expect(result.output).toContain('effective ordinal 1');
    expect(result.output).toContain('provenance: house-rule (table agreement)');
    expect(result.output).toContain('takes effect from turn 1');
  });

  it('adds a ruling after validating an ambiguity and interpretation', () => {
    const dbPath = campaignDb();
    const ambiguity = firstAmbiguity(dbPath);
    const result = invoke(dbPath, [
      'add',
      '--kind',
      'ruling',
      '--identity',
      'ruling-one',
      '--prose',
      'The table uses the first listed interpretation.',
      '--scope',
      'spell',
      '--records',
      'spell:find-familiar',
      '--ambiguity',
      ambiguity.id,
      '--interpretation',
      ambiguity.interpretationId,
    ]);
    expect(result.code).toBe(0);
    expect(result.output).toContain('ruling-one');
    expect(result.output).toContain(`ambiguity ${ambiguity.id}`);
    expect(result.output).toContain('takes effect from turn 1');
  });

  it('lists known ambiguity ids for an unknown ambiguity', () => {
    const result = invoke(campaignDb(), [
      'add',
      '--kind',
      'ruling',
      '--prose',
      'Use the table ruling.',
      '--scope',
      'spell',
      '--records',
      'spell:find-familiar',
      '--ambiguity',
      'ambiguity:missing',
      '--interpretation',
      'missing',
    ]);
    expect(result.code).toBe(1);
    expect(result.output).toContain('known ambiguity ids:');
    expect(result.output).toContain('ambiguity:');
  });

  it('lists known interpretation ids for an unknown interpretation', () => {
    const dbPath = campaignDb();
    const ambiguity = firstAmbiguity(dbPath);
    const result = invoke(dbPath, [
      'add',
      '--kind',
      'ruling',
      '--prose',
      'Use an enumerated interpretation.',
      '--scope',
      'spell',
      '--records',
      'spell:find-familiar',
      '--ambiguity',
      ambiguity.id,
      '--interpretation',
      'not-enumerated',
    ]);
    expect(result.code).toBe(1);
    expect(result.output).toContain('known interpretation ids:');
    expect(result.output).toContain(ambiguity.interpretationId);
  });

  it('shows active, all, and ordinal-at views with deterministic summaries', () => {
    const dbPath = campaignDb();
    const added = invoke(dbPath, [
      'add',
      '--kind',
      'house-rule',
      '--identity',
      'future-rule',
      '--prose',
      'This rule is active from the next turn.',
      '--scope',
      'combat',
      '--records',
      'rule:one',
    ]);
    expect(added.code).toBe(0);
    expect(invoke(dbPath, ['list']).output).not.toContain('future-rule');
    expect(invoke(dbPath, ['list', '--at', '1']).output).toContain(
      'future-rule',
    );
    const all = invoke(dbPath, ['list', '--all']);
    expect(all.code).toBe(0);
    expect(all.output).toContain(
      'future-rule  [house-rule/active]  effective 1  house-rule',
    );
    expect(all.output).toContain('This rule is active from the next turn.');
  });

  it('prints a complete rule record with provenance and lifecycle fields', () => {
    const dbPath = campaignDb();
    invoke(dbPath, [
      'add',
      '--kind',
      'house-rule',
      '--identity',
      'show-me',
      '--prose',
      'The table keeps this rule.',
      '--scope',
      'exploration',
      '--records',
      'rule:one,rule:two',
    ]);
    const result = invoke(dbPath, ['show', 'show-me']);
    expect(result.code).toBe(0);
    expect(result.output).toContain('kind: house-rule');
    expect(result.output).toContain('status: active');
    expect(result.output).toContain('origin: player-authored');
    expect(result.output).toContain('scope: exploration');
    expect(result.output).toContain('governing records: rule:one, rule:two');
    expect(result.output).toContain('temporal mode: prospective');
    expect(result.output).toContain('prose: The table keeps this rule.');
  });

  it('supersedes with a new record and preserves history', () => {
    const dbPath = campaignDb();
    invoke(dbPath, [
      'add',
      '--kind',
      'house-rule',
      '--identity',
      'old-rule',
      '--prose',
      'The old table rule.',
      '--scope',
      'combat',
      '--records',
      'rule:one',
      '--rationale',
      'old rationale',
    ]);
    advance(dbPath, 1);
    const result = invoke(dbPath, [
      'supersede',
      'old-rule',
      '--identity',
      'new-rule',
      '--prose',
      'The new table rule.',
    ]);
    expect(result.code).toBe(0);
    expect(result.output).toContain("'old-rule' -> 'new-rule'");
    expect(result.output).toContain('prior effective');
    expect(result.output).toContain('successor effective');
    expect(result.output).toContain('provenance: house-rule (old rationale)');
    const history = invoke(dbPath, ['history', 'new-rule']);
    expect(history.code).toBe(0);
    const historyLines = history.output.split('\n').slice(1);
    expect(
      historyLines.findIndex((line) => line.trim().startsWith('old-rule ')),
    ).toBeLessThan(
      historyLines.findIndex((line) => line.trim().startsWith('new-rule ')),
    );
    expect(history.output).toContain('[superseded]');
    expect(history.output).toContain('[active]');
  });

  it('revokes prospectively, omits the rule after its revocation, and exposes revoked status in all', () => {
    const dbPath = campaignDb();
    invoke(dbPath, [
      'add',
      '--kind',
      'house-rule',
      '--identity',
      'revocable',
      '--prose',
      'This rule will be revoked.',
      '--scope',
      'combat',
      '--records',
      'rule:one',
    ]);
    advance(dbPath, 1);
    const revoked = invoke(dbPath, ['revoke', 'revocable']);
    expect(revoked.code).toBe(0);
    expect(revoked.output).toContain('revoked from turn 2');
    expect(revoked.output).toContain('provenance: house-rule');
    advance(dbPath, 2);
    expect(invoke(dbPath, ['list']).output).not.toContain('revocable');
    const all = invoke(dbPath, ['list', '--all']);
    expect(all.output).toContain('revocable  [house-rule/revoked]');
    expect(invoke(dbPath, ['show', 'revocable']).output).toContain(
      'revoked position: cp1~000000000002~__future__~__future__',
    );
  });

  it('surfaces the store message for a revocation at or before current', () => {
    const dbPath = campaignDb();
    invoke(dbPath, [
      'add',
      '--kind',
      'house-rule',
      '--identity',
      'too-early',
      '--prose',
      'This rule cannot be revoked yet.',
      '--scope',
      'combat',
      '--records',
      'rule:one',
    ]);
    advance(dbPath, 1);
    const result = invoke(dbPath, ['revoke', 'too-early', '--at', '1']);
    expect(result.code).toBe(1);
    expect(result.output).toBe(
      "campaign rule 'too-early' cannot be revoked at or before the current position",
    );
  });

  it('keeps campaigns isolated when the same rule identity is used', () => {
    const firstDb = campaignDb('first');
    const secondDb = campaignDb('second');
    invoke(firstDb, [
      'add',
      '--kind',
      'house-rule',
      '--identity',
      'same-name',
      '--prose',
      'Only the first campaign has this.',
      '--scope',
      'combat',
      '--records',
      'rule:one',
    ]);
    expect(invoke(secondDb, ['list', '--all']).output).not.toContain(
      'same-name',
    );
    expect(invoke(secondDb, ['show', 'same-name']).code).toBe(1);
  });

  it('rejects duplicate generated identities without rewriting the first rule', () => {
    const dbPath = campaignDb();
    const args = [
      'add',
      '--kind',
      'house-rule',
      '--prose',
      'A deterministic duplicate rule.',
      '--scope',
      'combat',
      '--records',
      'rule:one',
    ];
    expect(invoke(dbPath, args).code).toBe(0);
    const duplicate = invoke(dbPath, args);
    expect(duplicate.code).toBe(1);
    expect(duplicate.output).toBe(
      "campaign rule 'house-rule:a-deterministic-duplicate-rule:1' already exists",
    );
    const db = openDatabase(dbPath);
    try {
      expect(listCampaignRules(db, { campaignId: 'c1' })).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('reads a bare --at ordinal as the persisted anchor so a disputed-turn rule at that turn is included (eshyra-jhpt.5)', () => {
    const dbPath = campaignDb();
    advance(dbPath, 10);
    const p10 = persistedPosition(10);
    createDisputedTurnRule(dbPath, 'disputed-p10', p10);

    const byOrdinal = invoke(dbPath, ['list', '--at', '10']);
    const byAnchor = invoke(dbPath, [
      'list',
      '--at',
      formatCampaignPosition(p10),
    ]);
    expect(byOrdinal.code).toBe(0);
    expect(byAnchor.code).toBe(0);
    expect(byOrdinal.output).toContain(`at ${formatCampaignPosition(p10)}`);
    expect(byOrdinal.output).toContain('disputed-p10');
    expect(byOrdinal.output).toBe(byAnchor.output);
    expect(invoke(dbPath, ['list']).output).toBe(byOrdinal.output);
    expect(invoke(dbPath, ['list', '--at', '9']).output).not.toContain(
      'disputed-p10',
    );
  });

  it('rejects a fabricated formatted anchor at an already-persisted ordinal (eshyra-jhpt.5)', () => {
    const dbPath = campaignDb();
    advance(dbPath, 10);
    const p10 = persistedPosition(10);
    createDisputedTurnRule(dbPath, 'disputed-p10', p10);
    const fabricated = formatCampaignPosition({
      sessionId: 'forged-session',
      turnId: 'forged-turn',
      ordinal: 10,
    });

    for (const args of [
      ['list', '--at', fabricated],
      ['revoke', 'disputed-p10', '--at', fabricated],
      [
        'add',
        '--kind',
        'house-rule',
        '--prose',
        'Forged anchor rule.',
        '--scope',
        'combat',
        '--records',
        'rule:one',
        '--effective',
        fabricated,
      ],
    ]) {
      const result = invoke(dbPath, args);
      expect(result.code).toBe(1);
      expect(result.output).toContain(
        `does not match the persisted turn at ordinal 10 (${formatCampaignPosition(p10)})`,
      );
    }
    expect(invoke(dbPath, ['list', '--all']).output).not.toContain(
      'forged-anchor-rule',
    );
    expect(invoke(dbPath, ['list', '--at', '10']).output).toContain(
      'disputed-p10  [house-rule/active]',
    );
  });

  it('still reads a genuinely future ordinal at the future anchor with its scheduled rule (eshyra-jhpt.5)', () => {
    const dbPath = campaignDb();
    advance(dbPath, 3);
    const added = invoke(dbPath, [
      'add',
      '--kind',
      'house-rule',
      '--identity',
      'scheduled-p7',
      '--prose',
      'Scheduled for turn seven.',
      '--scope',
      'combat',
      '--records',
      'rule:one',
      '--effective',
      '7',
    ]);
    expect(added.code).toBe(0);
    const future = invoke(dbPath, ['list', '--at', '7']);
    expect(future.code).toBe(0);
    expect(future.output).toContain(
      'at cp1~000000000007~__future__~__future__',
    );
    expect(future.output).toContain('scheduled-p7');
    expect(invoke(dbPath, ['list', '--at', '6']).output).not.toContain(
      'scheduled-p7',
    );
    expect(invoke(dbPath, ['list']).output).not.toContain('scheduled-p7');
  });

  it('accepts a formatted --at position and rejects malformed command arguments', () => {
    const dbPath = campaignDb();
    const malformed = invoke(dbPath, ['list', '--at']);
    expect(malformed.code).toBe(1);
    expect(malformed.output).toContain('--at requires a value');
    const at = formatCampaignPosition({
      sessionId: 'cli',
      turnId: 'bootstrap',
      ordinal: 0,
    });
    expect(invoke(dbPath, ['list', '--at', at]).code).toBe(0);
  });

  it('uses the persisted rule read path for cross-command records', () => {
    const dbPath = campaignDb();
    const added = invoke(dbPath, [
      'add',
      '--kind',
      'house-rule',
      '--identity',
      'read-path',
      '--prose',
      'Read this from the campaign store.',
      '--scope',
      'combat',
      '--records',
      'rule:one',
    ]);
    expect(added.code).toBe(0);
    const db = openDatabase(dbPath);
    try {
      expect(
        getCampaignRule(db, { campaignId: 'c1', ruleIdentity: 'read-path' }),
      ).toMatchObject({
        status: 'active',
        effectivePosition: { ordinal: 1 },
      });
    } finally {
      db.close();
    }
  });

  it('lists every bundled ambiguity with its status and interpretations', () => {
    const result = invoke(campaignDb(), ['ambiguities']);
    expect(result.code).toBe(0);
    for (const id of [
      'ambiguity:create-undead-ghast-wight-composition',
      'ambiguity:find-familiar-permanent-dismissal-after-zero-hp',
      'ambiguity:cube-of-force-same-face-duration-reset',
    ]) {
      expect(result.output).toContain(id);
      expect(result.output).toContain('status: unresolved');
      expect(result.output).toContain('interpretations:');
    }
  });

  it('resolves an ambiguity and reports idempotent repeats', () => {
    const dbPath = campaignDb();
    const args = [
      'resolve',
      'ambiguity:create-undead-ghast-wight-composition',
      '--interpretation',
      'homogeneous-alternative',
    ];
    const first = invoke(dbPath, args);
    expect(first.code).toBe(0);
    expect(first.output).toContain(
      'ruling:create-undead-ghast-wight-composition:1',
    );
    expect(first.output).toContain('takes effect from turn 1');
    const second = invoke(dbPath, [
      'resolve',
      'ambiguity:create-undead-ghast-wight-composition',
      '--interpretation',
      'mixed-within-total',
    ]);
    expect(second.code).toBe(0);
    expect(second.output).toContain('already resolved by');
  });

  it('reports the durable ruling identity for a resolved ambiguity (eshyra-jhpt.6)', () => {
    const dbPath = campaignDb();
    advance(dbPath, 1);
    const resolved = invoke(dbPath, [
      'resolve',
      'ambiguity:create-undead-ghast-wight-composition',
      '--interpretation',
      'mixed-within-total',
    ]);
    expect(resolved.code).toBe(0);
    expect(resolved.output).toContain(
      'ruling:create-undead-ghast-wight-composition:2',
    );
    expect(invoke(dbPath, ['ambiguities']).output).toContain(
      'ambiguity:create-undead-ghast-wight-composition  status: unresolved',
    );

    advance(dbPath, 2);
    const result = invoke(dbPath, ['ambiguities']);
    expect(result.code).toBe(0);
    const line = result.output
      .split('\n')
      .find((entry) =>
        entry.startsWith('ambiguity:create-undead-ghast-wight-composition'),
      );
    expect(line).toContain(
      'status: resolved:ruling:create-undead-ghast-wight-composition:2',
    );
    expect(line).not.toContain('resolved:mixed-within-total');
    expect(line).toContain('interpretations:');
    expect(line).toContain('homogeneous-alternative');
    expect(line).toContain('mixed-within-total');
  });

  it('lists known interpretations for an unknown resolve choice', () => {
    const result = invoke(campaignDb(), [
      'resolve',
      'ambiguity:create-undead-ghast-wight-composition',
      '--interpretation',
      'not-enumerated',
    ]);
    expect(result.code).toBe(1);
    expect(result.output).toContain('known interpretation ids:');
    expect(result.output).toContain('homogeneous-alternative');
    expect(result.output).toContain('mixed-within-total');
  });
});
