import { describe, expect, it } from 'vitest';
import type { RulesAmbiguity } from '../src/internal.js';
import {
  type CampaignPosition,
  type CampaignRule,
  CampaignRuleError,
  compareCampaignPositions,
  formatCampaignPosition,
  orderCampaignRules,
  parseCampaignPosition,
  precedenceOf,
  projectCampaignRule,
  validateCampaignRule,
  validateCampaignRules,
} from '../src/internal.js';

const position = (ordinal: number, turnId = 'turn-1'): CampaignPosition => ({
  sessionId: 'session-1',
  turnId,
  ordinal,
});

const ambiguity: RulesAmbiguity = {
  id: 'ambiguity:find-familiar',
  question: 'What happens when the familiar drops to zero hit points?',
  source: [],
  affects: ['spell:find-familiar'],
  interpretations: [
    { id: 'interpretation:dismiss', summary: 'It is dismissed.' },
  ],
  canonicalResolution: null,
  runtimeDisposition: { status: 'engine-pending', owner: 'campaign-ruling' },
};

const rule = (overrides: Partial<CampaignRule> = {}): CampaignRule => ({
  ruleIdentity: 'rule-1',
  campaignId: 'campaign-1',
  ruleKind: 'ruling',
  status: 'active',
  origin: 'player-approved',
  provenance: {
    kind: 'ambiguity',
    ambiguityId: ambiguity.id,
    selectedInterpretationId: 'interpretation:dismiss',
  },
  effectivePosition: position(1),
  temporalMode: { mode: 'prospective' },
  supersededBy: null,
  scope: 'spell:find-familiar',
  governingRecordKeys: ['spell:find-familiar'],
  prose: 'The familiar is dismissed.',
  ...overrides,
});

describe('campaign rule domain', () => {
  it('formats, parses, and totally orders anchored positions', () => {
    const value = formatCampaignPosition(position(12));
    expect(value).toBe('cp1~session-1~turn-1~000000000012');
    expect(parseCampaignPosition(value)).toEqual(position(12));
    expect(compareCampaignPositions(position(1), position(2))).toBeLessThan(0);
    expect(() => parseCampaignPosition('turn-12')).toThrow(CampaignRuleError);
  });

  it('distinguishes rulings from house rules and derives seam projections', () => {
    const ruling = rule();
    const projection = projectCampaignRule(ruling);
    expect(projection).toMatchObject({
      ruleKind: 'ruling',
      ambiguityId: ambiguity.id,
      selectedInterpretationId: 'interpretation:dismiss',
    });
    const houseRule = rule({
      ruleIdentity: 'rule-2',
      ruleKind: 'house-rule',
      provenance: { kind: 'house-rule', rationale: 'table agreement' },
    });
    expect(projectCampaignRule(houseRule)).toMatchObject({
      ruleKind: 'house-rule',
      provenance: 'house-rule',
    });
    expect(() =>
      validateCampaignRule(
        { ...ruling, provenance: { kind: 'house-rule' } },
        { ambiguity },
      ),
    ).toThrow('ruling cannot use');
    expect(() =>
      validateCampaignRule(
        {
          ...houseRule,
          provenance: {
            kind: 'ambiguity',
            ambiguityId: ambiguity.id,
            selectedInterpretationId: 'interpretation:dismiss',
          },
        },
        { ambiguity },
      ),
    ).toThrow('house-rule must');
  });

  it('requires an enumerated ambiguity interpretation', () => {
    expect(() =>
      validateCampaignRule(
        rule({
          provenance: {
            kind: 'ambiguity',
            ambiguityId: ambiguity.id,
            selectedInterpretationId: 'interpretation:missing',
          },
        }),
        { ambiguity },
      ),
    ).toThrow('not enumerated');
    expect(() =>
      validateCampaignRule(
        rule({
          provenance: {
            kind: 'ambiguity',
            ambiguityId: 'ambiguity:unknown',
            selectedInterpretationId: 'interpretation:dismiss',
          },
        }),
        { ambiguity },
      ),
    ).toThrow('unknown ambiguity');
  });

  it('allows prospective and immediate disputed-turn timing only', () => {
    const current = position(10, 'turn-10');
    validateCampaignRule(
      rule({
        effectivePosition: current,
        temporalMode: { mode: 'disputed-turn', disputedPosition: current },
      }),
      { ambiguity, currentPosition: current },
    );
    const prior = position(9, 'turn-9');
    validateCampaignRule(
      rule({
        effectivePosition: prior,
        temporalMode: { mode: 'disputed-turn', disputedPosition: prior },
      }),
      { ambiguity, currentPosition: position(10, 'turn-10') },
    );
    expect(() =>
      validateCampaignRule(
        rule({
          effectivePosition: position(1),
          temporalMode: {
            mode: 'disputed-turn',
            disputedPosition: position(1),
          },
        }),
        { ambiguity, currentPosition: position(10, 'turn-10') },
      ),
    ).toThrow('only the current or immediately preceding');
    expect(() =>
      validateCampaignRule(
        rule({ temporalMode: { mode: 'historical' } as never }),
        { ambiguity },
      ),
    ).toThrow();
  });

  it('rejects invalid supersession graphs and lifecycle contradictions', () => {
    expect(() =>
      validateCampaignRules(
        [
          rule({ ruleIdentity: 'a', status: 'superseded', supersededBy: 'b' }),
          rule({ ruleIdentity: 'b', status: 'revoked', supersededBy: null }),
        ],
        { ambiguity },
      ),
    ).toThrow('revoked');
    expect(() =>
      validateCampaignRules(
        [
          rule({ ruleIdentity: 'a', status: 'superseded', supersededBy: 'b' }),
          rule({ ruleIdentity: 'b', status: 'superseded', supersededBy: 'a' }),
        ],
        { ambiguity },
      ),
    ).toThrow('cycle');
    expect(() =>
      validateCampaignRules(
        [
          rule({ ruleIdentity: 'a', status: 'superseded', supersededBy: 'b' }),
          rule({ ruleIdentity: 'b', campaignId: 'campaign-2' }),
        ],
        { ambiguity },
      ),
    ).toThrow('cross campaigns');
  });

  it('orders a shuffled active set deterministically and documents precedence', () => {
    const house = rule({
      ruleIdentity: 'house',
      ruleKind: 'house-rule',
      provenance: { kind: 'house-rule' },
    });
    const later = rule({
      ruleIdentity: 'later',
      effectivePosition: position(2),
    });
    expect(
      orderCampaignRules([house, later, rule()]).map(
        ({ ruleIdentity }) => ruleIdentity,
      ),
    ).toEqual(['rule-1', 'house', 'later']);
    expect(precedenceOf('canonical')).toBeLessThan(
      precedenceOf('unresolved-ambiguity'),
    );
    expect(precedenceOf('unresolved-ambiguity')).toBeLessThan(
      precedenceOf('ruling'),
    );
    expect(precedenceOf('ruling')).toBeLessThan(precedenceOf('house-rule'));
  });
});
