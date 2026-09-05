import { describe, expect, it } from 'vitest';
import type { CampaignRulesContext } from '../src/campaign/campaignContext.js';
import type { ExecutedToolCall } from '../src/orchestrator/turnLoop.js';
import {
  campaignRulesEvidenceFrom,
  deriveTraceFields,
} from '../src/orchestrator/turnTraceProjection.js';

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
