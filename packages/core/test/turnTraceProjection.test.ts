import { describe, expect, it } from 'vitest';
import type { CampaignRulesContext } from '../src/campaign/campaignContext.js';
import type { RulesPack } from '../src/internal.js';
import {
  assembleContext,
  formatCampaignPosition,
  getBundledDnd5eSrdPack,
  renderContextMessage,
  writeCampaignRulesBinding,
} from '../src/internal.js';
import type { ExecutedToolCall } from '../src/orchestrator/turnLoop.js';
import {
  campaignRulesEvidenceFrom,
  deriveTraceFields,
} from '../src/orchestrator/turnTraceProjection.js';
import { freshDbWithSession } from './support/db.js';

function call(
  tool: string,
  result: ExecutedToolCall['result'],
): ExecutedToolCall {
  return {
    tool,
    args: { amounts: { gp: 1 } },
    result,
    mutates: true,
    source: 'native',
  };
}

const campaignRulesContext: CampaignRulesContext = {
  position: 'cp1~000000000004~session-1~turn-4',
  ambiguitySourceUnavailable: 'optional add-on unavailable',
  rules: [
    {
      ruleIdentity: 'rule:house',
      ruleKind: 'house-rule',
      status: 'active',
      origin: 'player-approved',
      provenance: 'house-rule',
      effectivePosition: 'cp1~000000000001~session-1~turn-1',
      supersededBy: null,
      revokedPosition: null,
      scope: 'tests',
      governingRecordKeys: ['record:house'],
      prose: 'House rule prose.',
    },
  ],
  unboundRulings: [],
  unboundConflicts: [],
  unrepresentableRules: [],
  ambiguities: [
    {
      ambiguity: {
        id: 'ambiguity:resolved-test',
        question: 'Which test interpretation applies?',
        source: [{ locator: 'test', clauseId: 'clause:test' }],
        affects: ['record:ruling'],
        interpretations: [
          { id: 'interpretation:selected', summary: 'Selected test reading.' },
        ],
        canonicalResolution: null,
        runtimeDisposition: {
          status: 'engine-pending',
          owner: 'campaign-ruling',
        },
      },
      ruling: {
        ruleIdentity: 'rule:ruling',
        ruleKind: 'ruling',
        status: 'active',
        origin: 'player-approved',
        provenance: 'ambiguity:ambiguity:resolved-test#interpretation:selected',
        effectivePosition: 'cp1~000000000002~session-1~turn-2',
        supersededBy: null,
        revokedPosition: null,
        scope: 'tests',
        governingRecordKeys: ['record:ruling'],
        ambiguityId: 'ambiguity:resolved-test',
        selectedInterpretationId: 'interpretation:selected',
        prose: 'Selected ruling prose.',
      },
      conflictingRulings: [],
    },
    {
      ambiguity: {
        id: 'ambiguity:unresolved-test',
        question: 'What remains unresolved?',
        source: [{ locator: 'test', clauseId: 'clause:unresolved' }],
        affects: ['record:unresolved'],
        interpretations: [
          { id: 'interpretation:open', summary: 'An open reading.' },
        ],
        canonicalResolution: null,
        runtimeDisposition: {
          status: 'model-adjudication',
          owner: 'primary-dm',
        },
      },
      ruling: undefined,
      conflictingRulings: [],
    },
  ],
};

describe('campaign rules trace projection (ADR 0020 A3)', () => {
  it('projects supplied rules, rulings, ambiguity state, and source availability', () => {
    const evidence = campaignRulesEvidenceFrom(campaignRulesContext);
    expect(evidence).toEqual({
      position: campaignRulesContext.position,
      rules: [
        {
          ruleIdentity: 'rule:house',
          ruleKind: 'house-rule',
          status: 'active',
          provenance: 'house-rule',
          effectivePosition: 'cp1~000000000001~session-1~turn-1',
          governingRecordKeys: ['record:house'],
        },
      ],
      rulings: [
        {
          ruleIdentity: 'rule:ruling',
          ambiguityId: 'ambiguity:resolved-test',
          selectedInterpretationId: 'interpretation:selected',
          effectivePosition: 'cp1~000000000002~session-1~turn-2',
        },
      ],
      unresolvedAmbiguityIds: ['ambiguity:unresolved-test'],
      conflictingAmbiguityIds: [],
      ambiguitySourceUnavailable: 'optional add-on unavailable',
    });
    expect(
      deriveTraceFields([], [], campaignRulesContext).campaignRulesEvidence,
    ).toEqual(evidence);
  });
});

describe('campaign rules trace projection under ambiguity-source loss (ADR 0020 A3)', () => {
  const CAMPAIGN = 'campaign-1';
  const SESSION = 'session-1';
  const CREATE_UNDEAD = 'ambiguity:create-undead-ghast-wight-composition';
  const FIND_FAMILIAR =
    'ambiguity:find-familiar-permanent-dismissal-after-zero-hp';

  function insertRow(
    db: ReturnType<typeof freshDbWithSession>,
    input: {
      readonly identity: string;
      readonly ruleKind: 'house-rule' | 'ruling';
      readonly provenanceKind:
        | 'ambiguity'
        | 'recurring-question'
        | 'house-rule';
      readonly ambiguityId?: string;
      readonly interpretationId?: string;
    },
  ): void {
    const provenance =
      input.provenanceKind === 'ambiguity'
        ? `${input.ambiguityId}#${input.interpretationId}`
        : input.provenanceKind === 'recurring-question'
          ? 'question:restored-question'
          : 'house-rule';
    db.prepare(`
      INSERT INTO campaign_rule (
        campaign_id, rule_identity, rule_kind, status, origin, provenance_kind,
        ambiguity_id, selected_interpretation_id, question_id, rationale,
        effective_position, temporal_mode, disputed_position, superseded_by,
        revoked_position, scope, governing_record_keys_json, prose, provenance,
        session_id, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      CAMPAIGN,
      input.identity,
      input.ruleKind,
      'active',
      'player-approved',
      input.provenanceKind,
      input.ambiguityId ?? null,
      input.interpretationId ?? null,
      input.provenanceKind === 'recurring-question'
        ? 'restored-question'
        : null,
      input.provenanceKind === 'house-rule' ? 'table agreement' : null,
      formatCampaignPosition({
        sessionId: SESSION,
        turnId: 'turn-1',
        ordinal: 1,
      }),
      'prospective',
      null,
      null,
      null,
      'test',
      JSON.stringify(['spell:find-familiar']),
      `Prose for ${input.identity}`,
      provenance,
      SESSION,
      '2026-09-07T00:00:00.000Z',
    );
  }

  /** Bind a malformed add-on so the real recoverable degradation path runs. */
  function degradedContext(db: ReturnType<typeof freshDbWithSession>) {
    const original = getBundledDnd5eSrdPack();
    const addon: RulesPack = {
      ...original,
      meta: {
        ...original.meta,
        packId: 'rules:test-malformed-ambiguity',
        role: 'addon',
        order: 1,
        compatibleBaseSystems: [
          {
            systemId: original.meta.systemId,
            versions: [original.meta.version],
          },
        ],
      },
      records: [
        {
          ...original.records[0],
          key: 'feature:malformed-ambiguity',
          data: {
            mechanics: { ambiguities: [{ id: 'ambiguity:Foo_Bar' }] },
          },
        },
      ],
    };
    writeCampaignRulesBinding(db, {
      base: {
        systemId: original.meta.systemId,
        packId: original.meta.packId,
        version: original.meta.version,
      },
      addons: [
        {
          systemId: addon.meta.systemId,
          packId: addon.meta.packId,
          version: addon.meta.version,
        },
      ],
      resolvedAt: '2026-09-07T00:00:00.000Z',
    });
    return assembleContext({
      db,
      campaignId: CAMPAIGN,
      campaignPosition: formatCampaignPosition({
        sessionId: SESSION,
        turnId: 'turn-1',
        ordinal: 1,
      }),
      sessionId: SESSION,
      playerInput: 'continue',
      resolveRulesPack: (ref) =>
        ref.packId === original.meta.packId
          ? original
          : ref.packId === addon.meta.packId
            ? addon
            : undefined,
    });
  }

  it('records one supplied ambiguity ruling as a ruling, not a generic rule, when the source is unavailable', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    insertRow(db, {
      identity: 'ruling:create-undead:1',
      ruleKind: 'ruling',
      provenanceKind: 'ambiguity',
      ambiguityId: CREATE_UNDEAD,
      interpretationId: 'mixed-within-total',
    });
    const context = degradedContext(db);
    expect(context.campaignRules.ambiguitySourceUnavailable).toBeDefined();
    expect(context.campaignRules.ambiguities).toEqual([]);
    expect(context.campaignRules.unboundRulings).toEqual([]);
    // The models really received it through the shared section.
    expect(renderContextMessage(context)).toContain(
      `- [ruling] ruling:create-undead:1 (ambiguity:${CREATE_UNDEAD}#mixed-within-total;`,
    );

    const evidence = campaignRulesEvidenceFrom(context.campaignRules);
    expect(evidence.rulings).toEqual([
      {
        ruleIdentity: 'ruling:create-undead:1',
        ambiguityId: CREATE_UNDEAD,
        selectedInterpretationId: 'mixed-within-total',
        effectivePosition: context.campaignRules.position,
      },
    ]);
    expect(evidence.rules).toEqual([]);
    expect(evidence.ambiguitySourceUnavailable).toBe(
      context.campaignRules.ambiguitySourceUnavailable,
    );
    db.close();
  });

  it('keeps every A3 class distinct under source loss: two rulings, a question ruling, a house rule, and an unrepresentable row', () => {
    const db = freshDbWithSession({ sessionId: SESSION });
    insertRow(db, {
      identity: 'ruling:create-undead:1',
      ruleKind: 'ruling',
      provenanceKind: 'ambiguity',
      ambiguityId: CREATE_UNDEAD,
      interpretationId: 'homogeneous-alternative',
    });
    insertRow(db, {
      identity: 'ruling:find-familiar:1',
      ruleKind: 'ruling',
      provenanceKind: 'ambiguity',
      ambiguityId: FIND_FAMILIAR,
      interpretationId: 'presence-required',
    });
    insertRow(db, {
      identity: 'ruling:question',
      ruleKind: 'ruling',
      provenanceKind: 'recurring-question',
    });
    insertRow(db, {
      identity: 'house-rule:table',
      ruleKind: 'house-rule',
      provenanceKind: 'house-rule',
    });
    insertRow(db, {
      identity: 'restored-invalid-provenance',
      ruleKind: 'house-rule',
      provenanceKind: 'ambiguity',
      ambiguityId: FIND_FAMILIAR,
      interpretationId: 'presence-required',
    });
    const context = degradedContext(db);
    const rendered = renderContextMessage(context);
    expect(rendered).toContain('- [ruling] ruling:create-undead:1 (');
    expect(rendered).toContain('- [ruling] ruling:find-familiar:1 (');
    expect(rendered).toContain('- [ruling] ruling:question (question:');
    expect(rendered).toContain('- [house-rule] house-rule:table (house-rule;');
    expect(rendered).toContain(
      'UNREPRESENTABLE ACTIVE CAMPAIGN RULE restored-invalid-provenance',
    );

    const evidence = campaignRulesEvidenceFrom(context.campaignRules);
    expect(evidence.rulings).toEqual([
      expect.objectContaining({
        ruleIdentity: 'ruling:create-undead:1',
        ambiguityId: CREATE_UNDEAD,
        selectedInterpretationId: 'homogeneous-alternative',
      }),
      expect.objectContaining({
        ruleIdentity: 'ruling:find-familiar:1',
        ambiguityId: FIND_FAMILIAR,
        selectedInterpretationId: 'presence-required',
      }),
    ]);
    expect(evidence.rules.map(({ ruleIdentity }) => ruleIdentity)).toEqual([
      'ruling:question',
      'house-rule:table',
      'restored-invalid-provenance',
    ]);
    expect(evidence.conflictingAmbiguityIds).toEqual([]);
    expect(evidence.unresolvedAmbiguityIds).toEqual([]);
    db.close();
  });

  it('classifies a ruling projection found in ctx.rules by its provenance in the pure projection', () => {
    const evidence = campaignRulesEvidenceFrom({
      position: 'cp1~000000000001~session-1~turn-1',
      ambiguitySourceUnavailable: 'source failed',
      rules: [
        {
          ruleIdentity: 'ruling:in-rules',
          ruleKind: 'ruling',
          status: 'active',
          origin: 'player-approved',
          provenance: 'ambiguity:ambiguity:x#choice',
          effectivePosition: 'cp1~000000000001~session-1~turn-1',
          supersededBy: null,
          revokedPosition: null,
          scope: 'tests',
          governingRecordKeys: ['record:x'],
          ambiguityId: 'ambiguity:x',
          selectedInterpretationId: 'choice',
          prose: 'Choice.',
        },
      ],
      unboundRulings: [],
      unboundConflicts: [],
      unrepresentableRules: [],
      ambiguities: [],
    });
    expect(evidence.rulings).toEqual([
      {
        ruleIdentity: 'ruling:in-rules',
        ambiguityId: 'ambiguity:x',
        selectedInterpretationId: 'choice',
        effectivePosition: 'cp1~000000000001~session-1~turn-1',
      },
    ]);
    expect(evidence.rules).toEqual([]);
  });
});

describe('currency trace projection', () => {
  it('projects successful currency mutations and rejected calls', () => {
    const fields = deriveTraceFields(
      [
        call('gain_currency', { ok: true, data: { wallet: { gp: 1 } } }),
        call('spend_currency', {
          ok: false,
          code: 'currency_error',
          message: 'not enough gp',
        }),
        call('convert_currency', {
          ok: true,
          data: { wallet: { gp: 0, sp: 10 } },
        }),
      ],
      [],
    );
    expect(fields.acceptedStateDelta).toHaveLength(2);
    expect(fields.rejectedCandidates).toMatchObject([
      { tool: 'spend_currency', code: 'currency_error' },
    ]);
  });

  it('projects successful slot spends and rest mutations but excludes no-ops and failures', () => {
    const fields = deriveTraceFields(
      [
        {
          ...call('spend_spell_slot', {
            ok: true,
            data: {
              spent: true,
              spellRef: 'spell:fireball',
              selectedSlotLevel: 4,
              pool: 'spellcasting',
              upcast: {
                sourceBindings: [
                  {
                    clauseId: 'fireball:higher-slot',
                    sourcePage: 144,
                    sourcePhrase: 'source phrase',
                    operationIds: ['fireball:damage:dice-per-slot'],
                  },
                ],
                adjustments: [
                  {
                    kind: 'dice',
                    addedDice: '1d6',
                    sourceOperationId: 'fireball:damage:dice-per-slot',
                  },
                ],
              },
            },
          }),
          args: { spellRef: 'spell:fireball', slotLevel: 4 },
        },
        call('spend_spell_slot', {
          ok: true,
          data: { spent: false, spellRef: 'spell:fire-bolt', upcast: null },
        }),
        call('spend_spell_slot', {
          ok: false,
          code: 'spell_slot_error',
          message: 'no slot',
        }),
        call('complete_long_rest', {
          ok: true,
          data: { completed: true },
        }),
      ],
      [],
    );
    expect(fields.acceptedStateDelta).toEqual([
      expect.objectContaining({
        tool: 'spend_spell_slot',
        result: expect.objectContaining({
          spellRef: 'spell:fireball',
          selectedSlotLevel: 4,
        }),
      }),
      { amounts: { gp: 1 } },
    ]);
    expect(fields.rejectedCandidates).toHaveLength(1);
    expect(fields.rulesResolution).toMatchObject({
      spellScaling: [
        {
          sourceBindings: [
            {
              clauseId: 'fireball:higher-slot',
              sourcePage: 144,
              sourcePhrase: 'source phrase',
              operationIds: ['fireball:damage:dice-per-slot'],
            },
          ],
          adjustments: [
            {
              kind: 'dice',
              addedDice: '1d6',
              sourceOperationId: 'fireball:damage:dice-per-slot',
            },
          ],
        },
      ],
    });
  });
});
