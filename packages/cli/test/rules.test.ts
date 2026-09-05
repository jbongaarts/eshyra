import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assembleCampaignRulesContext,
  createCampaign,
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
