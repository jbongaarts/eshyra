import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCurrentCampaignPosition } from '../src/campaign/campaignPosition.js';
import { preflightCampaignItemOperation } from '../src/campaign/capabilityPreflight.js';
import {
  disputeTurn,
  resumeDisputedTurn,
} from '../src/campaign/disputedTurn.js';
import { replaySnapshot } from '../src/campaign/turnReplayStore.js';
import {
  type AuditVerdict,
  createCampaignRule,
  createDefaultToolRegistry,
  listCampaignRules,
  type ModelClient,
  type ModelCompleteInput,
  type ModelCompleteResult,
  recordAmbiguityRuling,
  revokeCampaignRule,
  runTurn,
  supersedeCampaignRule,
  type TurnAuditInput,
  type TurnAuditor,
} from '../src/index.js';
import {
  appendSceneLog,
  closeScene,
  deriveItemOperationReadinessInput,
  getBundledDnd5eSrdPack,
  getLastDmOutput,
  getTurnTrace,
  listSceneLog,
  openScene,
  renderCampaignRulesSection,
  writeCampaignRulesBinding,
} from '../src/internal.js';
import { serializeCampaign } from '../src/persistence/checkpoint/serialize.js';
import { materializeSnapshot } from '../src/persistence/checkpoint/store.js';
import { openDatabase } from '../src/persistence/db.js';
import { freshDbWithSession } from './support/db.js';

const ambiguityId = 'ambiguity:create-undead-ghast-wight-composition';
const at = '2026-05-20T10:00:00.000Z';
const base = {
  campaignId: 'campaign-1',
  sessionId: 'session-1',
  turnId: 't1',
  playerInput: 'Bob summons a ghast and a wight.',
  seed: 42,
  at,
};
const accepted: AuditVerdict = {
  verdict: 'accept',
  missingRequiredTools: [],
  missingRequiredCalls: [],
  disallowedToolCalls: [],
  reason: '',
  repairInstruction: '',
};
const rejected: AuditVerdict = {
  ...accepted,
  verdict: 'reject',
  disallowedToolCalls: ['accept_ambiguity_precedent'],
  reason: 'The action does not select exactly one interpretation.',
};
class Script implements ModelClient {
  seen: ModelCompleteInput[] = [];
  constructor(private replies: (string | Error)[]) {}
  async complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    this.seen.push(input);
    const reply = this.replies.shift();
    if (reply instanceof Error) throw reply;
    if (reply === undefined) throw new Error('Script exhausted');
    return { text: reply };
  }
}
class Auditor implements TurnAuditor {
  seen: TurnAuditInput[] = [];
  constructor(private verdicts: AuditVerdict[] = [accepted]) {}
  async audit(input: TurnAuditInput): Promise<AuditVerdict> {
    this.seen.push(input);
    return this.verdicts.shift() ?? accepted;
  }
}
const call = (tool: string, args: unknown) =>
  `\`\`\`tool_call\n${JSON.stringify({ tool, args })}\n\`\`\``;
const proposal = (id = ambiguityId, ids = ['mixed-within-total']) =>
  call('accept_ambiguity_precedent', {
    ambiguityId: id,
    matchingInterpretationIds: ids,
    reason:
      'The accepted action names both a ghast and a wight, excluding the homogeneous alternative.',
  });
function setup(replies: (string | Error)[], verdicts?: AuditVerdict[]) {
  const db = freshDbWithSession();
  openScene(db, {
    campaignId: base.campaignId,
    sessionId: base.sessionId,
    sceneId: 'scene',
    title: 'Crypt',
    at,
  });
  return {
    db,
    model: new Script(replies),
    auditor: new Auditor(verdicts),
    registry: createDefaultToolRegistry(),
  };
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Required test value is absent');
  return value;
}
function parity(
  deps: ReturnType<typeof setup>,
  turnId: string,
  auditIndex: number,
) {
  const trace = getTurnTrace(deps.db, { ...base, turnId });
  const context = deps.auditor.seen[auditIndex].campaignRules;
  expect(context).toBeDefined();
  const rendered = renderCampaignRulesSection(required(context));
  expect(trace?.retrievedContext[0]).toContain(rendered);
  expect(
    trace?.campaignRulesEvidence?.rules.map(({ ruleIdentity }) => ruleIdentity),
  ).toEqual(required(context).rules.map(({ ruleIdentity }) => ruleIdentity));
  return trace;
}

describe('campaign-rule runtime end-to-end acceptance', () => {
  it('commits one visible implicit precedent only after audit and supplies it on the next turn without changing pack bytes', async () => {
    const packPath = new URL(
      '../data/rules-packs/rules__dnd5e-srd-5.1/records.json',
      import.meta.url,
    );
    const before = readFileSync(packPath);
    const deps = setup([
      proposal(),
      'Bob summons both undead.',
      'The precedent still applies.',
    ]);
    const audit = deps.auditor.audit.bind(deps.auditor);
    deps.auditor.audit = async (input) => {
      if (deps.auditor.seen.length === 0)
        expect(
          listCampaignRules(deps.db, { campaignId: base.campaignId }),
        ).toEqual([]);
      return audit(input);
    };
    const first = await runTurn(deps, base);
    expect(first).toMatchObject({ ok: true });
    expect(first.narration).toContain('Campaign precedent accepted');
    expect(getTurnTrace(deps.db, base)?.acceptedStateDelta).toContainEqual({
      campaignRule: expect.objectContaining({
        prose: expect.any(String),
        provenance: {
          kind: 'ambiguity',
          ambiguityId,
          selectedInterpretationId: 'mixed-within-total',
        },
      }),
    });
    expect(
      deps.db.prepare('SELECT updated_at FROM campaign_rule').get(),
    ).toEqual({ updated_at: at });
    const rules = listCampaignRules(deps.db, { campaignId: base.campaignId });
    expect(rules).toHaveLength(1);
    expect(rules[0].governingRecordKeys).toEqual(['spell:create-undead']);
    expect(rules[0]).toMatchObject({
      ruleKind: 'ruling',
      origin: 'player-approved',
      effectivePosition: { ordinal: 2 },
      provenance: {
        ambiguityId,
        selectedInterpretationId: 'mixed-within-total',
      },
    });
    expect(
      parity(deps, 't1', 0)?.campaignRulesEvidence?.unresolvedAmbiguityIds,
    ).toContain(ambiguityId);
    expect((await runTurn(deps, { ...base, turnId: 't2' })).ok).toBe(true);
    expect(parity(deps, 't2', 1)?.campaignRulesEvidence?.rulings).toEqual([
      expect.objectContaining({
        ruleIdentity: rules[0].ruleIdentity,
        ambiguityId,
        selectedInterpretationId: 'mixed-within-total',
      }),
    ]);
    expect(readFileSync(packPath).equals(before)).toBe(true);
    deps.db.close();
  });

  it.each([
    [
      'rejected',
      [proposal(), 'Attempt one.', proposal(), 'Attempt two.'],
      [rejected, rejected],
    ],
    [
      'retried',
      [proposal(), 'Attempt one.', 'No precedent established.'],
      [rejected, accepted],
    ],
    ['failed provider', [proposal(), new Error('offline')], [accepted]],
  ] as const)(
    '%s candidates leak no precedent',
    async (_label, replies, verdicts) => {
      const deps = setup([...replies], [...verdicts]);
      await runTurn(deps, base);
      expect(
        listCampaignRules(deps.db, { campaignId: base.campaignId }),
      ).toEqual([]);
      deps.db.close();
    },
  );

  it.each([
    [
      'unmarked canonical rule',
      'no-material-components',
      ['mixed-within-total'],
    ],
    ['no matching interpretation', ambiguityId, []],
    [
      'multiple matching interpretations',
      ambiguityId,
      ['mixed-within-total', 'homogeneous-alternative'],
    ],
    ['invented interpretation', ambiguityId, ['invented']],
  ])(
    'refuses %s at the deterministic tool boundary',
    async (_label, id, ids) => {
      const deps = setup([
        proposal(id as string, ids as string[]),
        'No precedent.',
      ]);
      const result = await runTurn(deps, base);
      expect(result.toolCalls[0].result.ok).toBe(false);
      expect(
        listCampaignRules(deps.db, { campaignId: base.campaignId }),
      ).toEqual([]);
      deps.db.close();
    },
  );

  it.each([
    'What cover does this rubble provide?',
    'I cast without the required components.',
  ])('ordinary adjudication creates no rule: %s', async (playerInput) => {
    const deps = setup(['The DM adjudicates the situation.']);
    expect((await runTurn(deps, { ...base, playerInput })).ok).toBe(true);
    expect(listCampaignRules(deps.db, { campaignId: base.campaignId })).toEqual(
      [],
    );
    deps.db.close();
  });

  it('an existing active ruling prevents duplicate implicit precedent', async () => {
    const deps = setup([proposal(), 'Use the existing ruling.']);
    recordAmbiguityRuling(deps.db, {
      campaignId: base.campaignId,
      ambiguityId,
      interpretationId: 'mixed-within-total',
      currentPosition: {
        sessionId: base.sessionId,
        turnId: 'bootstrap',
        ordinal: 0,
      },
    });
    const result = await runTurn(deps, base);
    expect(result.toolCalls[0].result).toMatchObject({
      ok: false,
      code: 'ruling_exists',
    });
    expect(
      listCampaignRules(deps.db, { campaignId: base.campaignId }),
    ).toHaveLength(1);
    deps.db.close();
  });

  it('explicit Create Undead choice is prospective; declined Find Familiar stays unresolved', async () => {
    const familiar =
      'ambiguity:find-familiar-permanent-dismissal-after-zero-hp';
    const deps = setup([
      call('request_ambiguity_ruling', { ambiguityId }),
      'Both interpretations are published; please choose.',
      call('request_ambiguity_ruling', { ambiguityId: familiar }),
      'The published ambiguity remains unresolved.',
    ]);
    expect(
      (
        await runTurn(deps, {
          ...base,
          playerInput: 'Can I mix a ghast and a wight?',
        })
      ).ok,
    ).toBe(true);
    const choice = recordAmbiguityRuling(deps.db, {
      campaignId: base.campaignId,
      ambiguityId,
      interpretationId: 'mixed-within-total',
      currentPosition: required(
        getCurrentCampaignPosition(deps.db, base.campaignId),
      ),
    });
    expect(choice.rule.effectivePosition.ordinal).toBe(2);
    expect(
      (
        await runTurn(deps, {
          ...base,
          turnId: 't2',
          playerInput: 'Can I permanently dismiss my familiar after zero HP?',
        })
      ).ok,
    ).toBe(true);
    const trace = parity(deps, 't2', 1);
    expect(trace?.campaignRulesEvidence?.unresolvedAmbiguityIds).toContain(
      familiar,
    );
    expect(trace?.campaignRulesEvidence?.rulings[0].ruleIdentity).toBe(
      choice.rule.ruleIdentity,
    );
    expect(
      listCampaignRules(deps.db, { campaignId: base.campaignId }),
    ).toHaveLength(1);
    deps.db.close();
  });

  it('restores exact pre-turn state and makes the component-objection replay canonical with shared rule evidence', async () => {
    const deps = setup([
      call('adjust_hp', { amount: -1 }),
      'You lack components; a trap wounds you.',
      call('adjust_hp', { amount: -2 }),
      'Under our house rule the spell succeeds.',
    ]);
    deps.db
      .prepare("UPDATE character SET hp_current=10, hp_max=10 WHERE id='pc-1'")
      .run();
    const snapshotBefore = replaySnapshot(deps.db);
    const hpBefore = deps.db
      .prepare('SELECT hp_current FROM character WHERE id=?')
      .get('pc-1');
    const first = await runTurn(deps, {
      ...base,
      playerInput: 'I cast my spell.',
    });
    expect(first.ok).toBe(true);
    expect(first.toolCalls[0].result.ok).toBe(true);
    expect(
      deps.db.prepare("SELECT hp_current FROM character WHERE id='pc-1'").get(),
    ).toEqual({ hp_current: 9 });
    let snapshotAtReplay: unknown;
    let stateAtReplay: unknown;
    const complete = deps.model.complete.bind(deps.model);
    deps.model.complete = async (input) => {
      snapshotAtReplay ??= replaySnapshot(deps.db);
      stateAtReplay ??= deps.db
        .prepare('SELECT hp_current FROM character WHERE id=?')
        .get('pc-1');
      return complete(input);
    };
    const replay = await disputeTurn(deps, {
      ...base,
      approvedRule: {
        kind: 'house-rule',
        governingRecordKeys: ['rule:casting-a-spell'],
        prose: "We don't use spell components.",
      },
    });
    expect(replay.ok, replay.error).toBe(true);
    expect(stateAtReplay).toEqual(hpBefore);
    expect(replay.toolCalls[0].result.ok).toBe(true);
    expect(
      deps.db.prepare("SELECT hp_current FROM character WHERE id='pc-1'").get(),
    ).toEqual({ hp_current: 8 });
    const withoutReplayRule = (records: ReturnType<typeof replaySnapshot>) =>
      records.filter(
        (record) =>
          !['campaign_rule', 'campaign_turn_position'].includes(record.table),
      );
    expect(
      withoutReplayRule(snapshotAtReplay as ReturnType<typeof replaySnapshot>),
    ).toEqual(withoutReplayRule(snapshotBefore));
    const rules = listCampaignRules(deps.db, { campaignId: base.campaignId });
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      ruleKind: 'house-rule',
      provenance: { kind: 'house-rule' },
      effectivePosition: { ordinal: 1 },
      temporalMode: { mode: 'disputed-turn' },
    });
    const trace = parity(deps, 't1', 1);
    expect(trace?.playerInput).toBe('I cast my spell.');
    expect(trace?.finalNarration).toContain('spell succeeds');
    expect(JSON.stringify(listSceneLog(deps.db, 'scene'))).not.toContain(
      'trap wounds',
    );
    expect(
      deps.db
        .prepare('SELECT original_trace_json FROM turn_replay_diagnostic')
        .get(),
    ).toEqual({ original_trace_json: expect.stringContaining('trap wounds') });
    expect(
      deps.db.prepare('SELECT COUNT(*) AS n FROM campaign_turn_position').get(),
    ).toEqual({ n: 1 });
    await expect(
      disputeTurn(deps, {
        ...base,
        approvedRule: {
          kind: 'house-rule',
          governingRecordKeys: ['rule:casting-a-spell'],
          prose: 'A second rewrite.',
        },
      }),
    ).rejects.toThrow('Only the latest unreplayed adjudication');
    deps.db.close();
  });

  it('failed replay retains recoverable pre-turn state, approved prose, and resumes the same action once', async () => {
    const deps = setup([
      'Original rejected spell.',
      new Error('provider unavailable'),
      'Successful replay.',
    ]);
    await runTurn(deps, base);
    const result = await disputeTurn(deps, {
      ...base,
      approvedRule: {
        kind: 'house-rule',
        governingRecordKeys: ['rule:casting-a-spell'],
        prose: "We don't use spell components.",
      },
    });
    expect(result.ok).toBe(false);
    expect(getTurnTrace(deps.db, base)).toBeUndefined();
    expect(
      listCampaignRules(deps.db, { campaignId: base.campaignId }),
    ).toHaveLength(1);
    const next = await runTurn(deps, { ...base, turnId: 'later' });
    expect(next.error).toContain('A disputed replay is pending');
    const resumed = await resumeDisputedTurn(deps, base.campaignId);
    expect(resumed.ok, resumed.error).toBe(true);
    expect(getTurnTrace(deps.db, base)?.playerInput).toBe(base.playerInput);
    deps.db.close();
  });

  it('rejects older-turn and later-state rewrites without changing canon', async () => {
    const deps = setup(['First.', 'Second.']);
    await runTurn(deps, base);
    await runTurn(deps, { ...base, turnId: 't2' });
    const before = replaySnapshot(deps.db);
    await expect(
      disputeTurn(deps, {
        ...base,
        approvedRule: {
          kind: 'house-rule',
          governingRecordKeys: ['rule:casting-a-spell'],
          prose: 'Old rewrite.',
        },
      }),
    ).rejects.toThrow('Only the latest unreplayed');
    deps.db
      .prepare("UPDATE character SET hp_current=hp_current+1 WHERE id='pc-1'")
      .run();
    await expect(
      disputeTurn(deps, {
        ...base,
        turnId: 't2',
        approvedRule: {
          kind: 'house-rule',
          governingRecordKeys: ['rule:casting-a-spell'],
          prose: 'Unsafe rewrite.',
        },
      }),
    ).rejects.toThrow('Campaign state changed');
    expect(
      getTurnTrace(deps.db, { ...base, turnId: 't2' })?.finalNarration,
    ).toBe('Second.');
    expect(before.length).toBeGreaterThan(0);
    deps.db.close();
  });

  it('ordinary house-rule creation, supersession and revocation stay prospective and preserve trace history', async () => {
    const deps = setup(['First.', 'Second.', 'Third.', 'Fourth.']);
    await runTurn(deps, base);
    const current = required(
      getCurrentCampaignPosition(deps.db, base.campaignId),
    );
    const rule = createCampaignRule(
      deps.db,
      {
        campaignId: base.campaignId,
        ruleIdentity: 'components',
        ruleKind: 'house-rule',
        status: 'active',
        origin: 'player-authored',
        provenance: { kind: 'house-rule' },
        prose: "We don't use spell components.",
        effectivePosition: { ...current, ordinal: 2 },
        temporalMode: { mode: 'prospective' },
        supersededBy: null,
        revokedPosition: null,
        scope: 'campaign',
        governingRecordKeys: ['rule:casting-a-spell'],
      },
      { currentPosition: current },
    );
    await runTurn(deps, { ...base, turnId: 't2' });
    supersedeCampaignRule(deps.db, {
      campaignId: base.campaignId,
      ruleIdentity: rule.ruleIdentity,
      currentPosition: required(
        getCurrentCampaignPosition(deps.db, base.campaignId),
      ),
      successor: {
        ...rule,
        ruleIdentity: 'components-v2',
        prose: 'Only costly material components are required.',
        effectivePosition: { ...current, ordinal: 3 },
      },
    });
    await runTurn(deps, { ...base, turnId: 't3' });
    revokeCampaignRule(deps.db, {
      campaignId: base.campaignId,
      ruleIdentity: 'components-v2',
      currentPosition: required(
        getCurrentCampaignPosition(deps.db, base.campaignId),
      ),
      revokedPosition: { ...current, ordinal: 4 },
    });
    await runTurn(deps, { ...base, turnId: 't4' });
    expect(parity(deps, 't1', 0)?.campaignRulesEvidence?.rules).toEqual([]);
    expect(
      parity(deps, 't2', 1)?.campaignRulesEvidence?.rules.map(
        (r) => r.ruleIdentity,
      ),
    ).toEqual(['components']);
    expect(
      parity(deps, 't3', 2)?.campaignRulesEvidence?.rules.map(
        (r) => r.ruleIdentity,
      ),
    ).toEqual(['components-v2']);
    expect(parity(deps, 't4', 3)?.campaignRulesEvidence?.rules).toEqual([]);
    deps.db.close();
  });

  it.each(['same-face-resets', 'different-face-only-resets'])(
    'A2 exposes %s while Cube of Force preflight remains blocked',
    async (interpretationId) => {
      const deps = setup(['Continue.']);
      const record = required(
        getBundledDnd5eSrdPack().records.find(
          (r) => r.key === 'magic-item:cube-of-force',
        ),
      );
      const operation = deriveItemOperationReadinessInput(
        record,
        undefined,
        'press-face-1',
      );
      const input = { campaignId: base.campaignId, record, operation };
      const unresolved = preflightCampaignItemOperation(deps.db, input);
      expect(unresolved.status).toBe('blocked');
      expect(unresolved.ambiguities).toHaveLength(1);
      expect(unresolved.ambiguities[0].ruling).toBeUndefined();
      expect(unresolved.ambiguities[0].status).toBe('unresolved');
      expect(
        unresolved.ambiguities[0].ambiguity.interpretations.map((i) => i.id),
      ).toEqual(
        expect.arrayContaining([
          'same-face-resets',
          'different-face-only-resets',
        ]),
      );
      const ruling = recordAmbiguityRuling(deps.db, {
        campaignId: base.campaignId,
        ambiguityId: 'ambiguity:cube-of-force-same-face-duration-reset',
        interpretationId,
        currentPosition: {
          sessionId: base.sessionId,
          turnId: 'bootstrap',
          ordinal: 0,
        },
      });
      await runTurn(deps, base);
      const resolved = preflightCampaignItemOperation(deps.db, input);
      expect(resolved.status).toBe('blocked');
      expect(resolved.ambiguities[0].status).toBe('resolved');
      expect(resolved.reason).toBe(unresolved.reason);
      expect(resolved.ambiguities[0].ruling?.ruleIdentity).toBe(
        ruling.rule.ruleIdentity,
      );
      expect(resolved.ambiguities[0].ruling?.selectedInterpretationId).toBe(
        interpretationId,
      );
      deps.db.close();
    },
  );
  it('a late trace-write failure rolls accepted precedent and action mutations back together', async () => {
    const deps = setup([proposal(), 'Accepted action.']);
    deps.db.exec(
      "CREATE TRIGGER fail_trace BEFORE INSERT ON turn_trace BEGIN SELECT RAISE(ABORT, 'trace unavailable'); END;",
    );
    const result = await runTurn(deps, base);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('trace unavailable');
    expect(listCampaignRules(deps.db, { campaignId: base.campaignId })).toEqual(
      [],
    );
    expect(
      getCurrentCampaignPosition(deps.db, base.campaignId),
    ).toBeUndefined();
    deps.db.close();
  });

  it('pending replay survives a non-Dolt checkpoint round trip', async () => {
    const deps = setup([
      'Original.',
      new Error('offline'),
      'Replayed after restore.',
    ]);
    const dir = mkdtempSync(join(tmpdir(), 'jhpt-recovery-'));
    try {
      await runTurn(deps, base);
      await disputeTurn(deps, {
        ...base,
        approvedRule: {
          kind: 'house-rule',
          prose: 'No components.',
          governingRecordKeys: ['rule:components'],
        },
      });
      const records = serializeCampaign(deps.db);
      const dest = join(dir, 'restored.sqlite');
      materializeSnapshot(records, dest);
      const restored = openDatabase(dest);
      try {
        const result = await resumeDisputedTurn(
          { ...deps, db: restored },
          base.campaignId,
        );
        expect(result.ok, result.error).toBe(true);
        const rule = listCampaignRules(restored, {
          campaignId: base.campaignId,
        })[0];
        expect(rule).toMatchObject({
          prose: 'No components.',
          temporalMode: { mode: 'disputed-turn' },
          effectivePosition: {
            sessionId: 'session-1',
            turnId: 't1',
            ordinal: 1,
          },
        });
        expect(
          getTurnTrace(restored, base)?.campaignRulesEvidence?.rules[0]
            .ruleIdentity,
        ).toBe(rule.ruleIdentity);
        expect(
          restored
            .prepare('SELECT rule_identity FROM turn_replay_diagnostic')
            .get(),
        ).toEqual({ rule_identity: rule.ruleIdentity });
      } finally {
        restored.close();
      }
    } finally {
      deps.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a disputed ambiguity supersedes the prior ruling without changing its original trace', async () => {
    const deps = setup(['Homogeneous only.', 'Mixed composition accepted.']);
    const prior = recordAmbiguityRuling(deps.db, {
      campaignId: base.campaignId,
      ambiguityId,
      interpretationId: 'homogeneous-alternative',
      currentPosition: {
        sessionId: base.sessionId,
        turnId: 'bootstrap',
        ordinal: 0,
      },
    }).rule;
    await runTurn(deps, base);
    const replay = await disputeTurn(deps, {
      ...base,
      approvedRule: {
        kind: 'ruling',
        prose: 'Mixed ghasts and wights are allowed within the total.',
        ambiguityId,
        interpretationId: 'mixed-within-total',
        supersedes: prior.ruleIdentity,
        governingRecordKeys: ['spell:create-undead'],
      },
    });
    expect(replay.ok, replay.error).toBe(true);
    const rules = listCampaignRules(deps.db, { campaignId: base.campaignId });
    expect(
      rules.find((rule) => rule.ruleIdentity === prior.ruleIdentity)?.status,
    ).toBe('superseded');
    expect(
      parity(deps, 't1', 1)?.campaignRulesEvidence?.rulings[0]
        .selectedInterpretationId,
    ).toBe('mixed-within-total');
    expect(
      deps.db
        .prepare('SELECT original_trace_json FROM turn_replay_diagnostic')
        .get(),
    ).toEqual({
      original_trace_json: expect.stringContaining('homogeneous-alternative'),
    });
    deps.db.close();
  });
  it('cannot establish implicit precedent without an auditor', async () => {
    const deps = setup([proposal(), 'No audited precedent.']);
    const result = await runTurn({ ...deps, auditor: undefined }, base);
    expect(result.toolCalls[0].result).toMatchObject({
      ok: false,
      code: 'audit_required',
    });
    expect(listCampaignRules(deps.db, { campaignId: base.campaignId })).toEqual(
      [],
    );
    deps.db.close();
  });

  it('restoring a replay preserves insert guards and rolls back invalid rule admission', async () => {
    const deps = setup(['Original accepted turn.', 'Replayed.']);
    await runTurn(deps, base);
    const before = replaySnapshot(deps.db);
    await expect(
      disputeTurn(deps, {
        ...base,
        approvedRule: {
          kind: 'ruling',
          prose: 'Invalid selection.',
          ambiguityId,
          interpretationId: 'invented',
          governingRecordKeys: ['spell:create-undead'],
        },
      }),
    ).rejects.toThrow('interpretation invented is not enumerated');
    expect(replaySnapshot(deps.db)).toEqual(before);
    await disputeTurn(deps, {
      ...base,
      approvedRule: {
        kind: 'house-rule',
        prose: 'No components.',
        governingRecordKeys: ['rule:components'],
      },
    });
    expect(() =>
      deps.db
        .prepare(
          "INSERT INTO inventory(id, name, quantity) VALUES (?, 'invalid', 1)",
        )
        .run('x'.repeat(257)),
    ).toThrow('inventory id/name exceeds UTF-8 identity bounds');
    deps.db.close();
  });
  it.each([false, true])(
    'derives disputed ambiguity source keys from the bound stack (addon=%s)',
    async (addon) => {
      const deps = setup(['Original.', 'Corrected.']);
      const bundled = getBundledDnd5eSrdPack();
      const source = required(
        bundled.records.find((record) => record.key === 'spell:create-undead'),
      );
      const declaringKey = addon ? 'spell:addon-undead' : source.key;
      const extra = {
        ...bundled,
        meta: {
          ...bundled.meta,
          packId: 'rules:test-addon',
          role: 'addon' as const,
          compatibleBaseSystems: [
            {
              systemId: bundled.meta.systemId,
              versions: [bundled.meta.version],
            },
          ],
        },
        records: [{ ...source, key: declaringKey }],
      };
      const empty = {
        ...bundled,
        meta: { ...bundled.meta, packId: 'rules:test-base' },
        records: [],
      };
      const runtime = {
        ...deps,
        resolveRulesPack: addon
          ? (ref: { packId: string }) =>
              ref.packId === extra.meta.packId ? extra : empty
          : undefined,
      };
      if (addon)
        writeCampaignRulesBinding(deps.db, {
          base: empty.meta,
          addons: [extra.meta],
          resolvedAt: at,
        });
      const initial = await runTurn(runtime, base);
      expect(initial.ok, initial.error).toBe(true);
      const result = await disputeTurn(runtime, {
        ...base,
        approvedRule: {
          kind: 'ruling',
          ambiguityId,
          interpretationId: 'mixed-within-total',
          prose: 'Mix within the total.',
          governingRecordKeys: ['invented:wrong-source'],
        },
      });
      expect(result.ok, result.error).toBe(true);
      const rules = listCampaignRules(deps.db, { campaignId: base.campaignId });
      expect(rules[0].governingRecordKeys).toEqual([declaringKey]);
      expect(
        JSON.stringify(getTurnTrace(deps.db, base)?.retrievedContext),
      ).not.toContain('invented:wrong-source');
      deps.db.close();
    },
  );

  it('preserves equal-timestamp insertion order through the real last-DM consumer at replay start', async () => {
    const deps = setup(['Disputed.', 'Replayed.']);
    appendSceneLog(deps.db, {
      ...base,
      sceneId: 'scene',
      turnId: 'older',
      role: 'dm',
      content: 'Z older insertion',
    });
    closeScene(deps.db, { ...base, sceneId: 'scene' });
    openScene(deps.db, {
      ...base,
      sceneId: 'other-scene',
      title: 'Next scene',
    });
    appendSceneLog(deps.db, {
      ...base,
      sceneId: 'other-scene',
      turnId: 'newer',
      role: 'dm',
      content: 'A newer insertion',
    });
    expect(getLastDmOutput(deps.db, base)?.turnId).toBe('newer');
    const dir = mkdtempSync(join(tmpdir(), 'jhpt-order-'));
    try {
      const dest = join(dir, 'restored.sqlite');
      materializeSnapshot(serializeCampaign(deps.db), dest);
      const restored = openDatabase(dest);
      try {
        expect(getLastDmOutput(restored, base)?.turnId).toBe('newer');
        appendSceneLog(restored, {
          ...base,
          sceneId: 'other-scene',
          turnId: 'after-checkpoint',
          role: 'dm',
          content: 'After restore',
        });
        expect(getLastDmOutput(restored, base)?.turnId).toBe(
          'after-checkpoint',
        );
      } finally {
        restored.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    await runTurn(deps, base);
    const complete = deps.model.complete.bind(deps.model);
    let observed: string | undefined;
    deps.model.complete = async (input) => {
      observed = getLastDmOutput(deps.db, base)?.turnId;
      return complete(input);
    };
    await disputeTurn(deps, {
      ...base,
      approvedRule: {
        kind: 'house-rule',
        prose: 'No components.',
        governingRecordKeys: ['rule:components'],
      },
    });
    expect(observed).toBe('newer');
    deps.db.close();
  });
});
