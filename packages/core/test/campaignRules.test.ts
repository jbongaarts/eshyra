import { describe, expect, it } from 'vitest';
import type { RulesAmbiguity } from '../src/internal.js';
import {
  type CampaignPosition,
  type CampaignRule,
  compareCampaignPositions,
  formatCampaignPosition,
  orderCampaignRules,
  parseCampaignPosition,
  precedenceOf,
  projectCampaignRule,
  validateCampaignRule,
  validateCampaignRules,
} from '../src/internal.js';

const position = (
  ordinal: number,
  turnId = 'turn-1',
  sessionId = 'session-1',
): CampaignPosition => ({
  sessionId,
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
  revokedPosition: null,
  scope: 'spell:find-familiar',
  governingRecordKeys: ['spell:find-familiar'],
  prose: 'The familiar is dismissed.',
  ...overrides,
});

describe('campaign rule domain', () => {
  it('formats, parses, and totally orders anchored positions', () => {
    const value = formatCampaignPosition(position(12));
    expect(value).toBe('cp1~000000000012~session-1~turn-1');
    expect(parseCampaignPosition(value)).toEqual(position(12));
    expect(compareCampaignPositions(position(1), position(2))).toBeLessThan(0);
    expect(() => parseCampaignPosition('turn-12')).toThrow(
      'invalid campaign position',
    );
  });

  it('orders chronology by ordinal across sessions and turns', () => {
    const early = position(5, 't1', 's2');
    const late = position(6, 't1', 's10');
    expect(compareCampaignPositions(early, late)).toBeLessThan(0);
    expect(compareCampaignPositions(late, early)).toBeGreaterThan(0);
    expect(
      compareCampaignPositions(
        position(5, 'turn-2', 'session-1'),
        position(5, 'turn-10', 'session-1'),
      ),
    ).toBeGreaterThan(0);

    const shuffled = [
      position(12, 'turn-2', 'S!'),
      position(2, 'turn-1', 's10'),
      position(11, 'turn-1', 's2'),
      position(7, 'Turn-1', 'S!'),
    ];
    expect(shuffled.sort(compareCampaignPositions)).toEqual([
      position(2, 'turn-1', 's10'),
      position(7, 'Turn-1', 'S!'),
      position(11, 'turn-1', 's2'),
      position(12, 'turn-2', 'S!'),
    ]);
    expect(
      compareCampaignPositions(
        position(1, 'turn', 'S1'),
        position(1, 'turn', 's1'),
      ),
    ).toBeLessThan(0);
    expect(
      compareCampaignPositions(
        position(1, 'turn', 'a'),
        position(1, 'turn', 'B'),
      ),
    ).toBeGreaterThan(0);
  });

  it('makes canonical position strings self-sort chronologically', () => {
    const positions = [
      position(5, 't1', 's2'),
      position(6, 't1', 's10'),
      position(7, 't1', 's3'),
    ];
    const canonical = positions.map(formatCampaignPosition);
    const cutoff = canonical[1];

    expect([...canonical].sort()).toEqual(canonical);
    expect(canonical.filter((value) => value <= cutoff)).toEqual(
      canonical.slice(0, 2),
    );
    expect(
      positions.filter((value) => value.ordinal <= positions[1].ordinal),
    ).toEqual(positions.slice(0, 2));
  });

  it('distinguishes rulings from house rules and derives seam projections', () => {
    const ruling = rule();
    const projection = projectCampaignRule(ruling);
    expect(projection).toMatchObject({
      ruleKind: 'ruling',
      ambiguityId: ambiguity.id,
      selectedInterpretationId: 'interpretation:dismiss',
      revokedPosition: null,
    });
    const houseRule = rule({
      ruleIdentity: 'rule-2',
      ruleKind: 'house-rule',
      provenance: { kind: 'house-rule', rationale: 'table agreement' },
    });
    expect(projectCampaignRule(houseRule)).toMatchObject({
      ruleKind: 'house-rule',
      provenance: 'house-rule',
      revokedPosition: null,
    });
    const recurring = rule({
      ruleIdentity: 'recurring',
      provenance: { kind: 'recurring-question', questionId: 'question-1' },
    });
    expect(projectCampaignRule(recurring)).toEqual(
      expect.not.objectContaining({
        ambiguityId: expect.anything(),
        selectedInterpretationId: expect.anything(),
      }),
    );
    expect(projectCampaignRule(recurring)).toMatchObject({
      ruleKind: 'ruling',
      provenance: 'question:question-1',
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
      { ambiguity },
      current,
    );
    expect(() =>
      validateCampaignRule(
        rule({
          effectivePosition: position(3, 't-current', 's-current'),
          temporalMode: {
            mode: 'disputed-turn',
            disputedPosition: position(3, 't-current', 's-current'),
          },
        }),
        { ambiguity },
        position(100, 't-current', 's-current'),
      ),
    ).toThrow('only the current or immediately preceding');
    const prior = position(9, 'turn-9');
    validateCampaignRule(
      rule({
        effectivePosition: prior,
        temporalMode: { mode: 'disputed-turn', disputedPosition: prior },
      }),
      { ambiguity },
      position(10, 'turn-10'),
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
        { ambiguity },
        position(10, 'turn-10'),
      ),
    ).toThrow('only the current or immediately preceding');
    expect(() =>
      validateCampaignRule(
        rule({ temporalMode: { mode: 'historical' } as never }),
        { ambiguity },
      ),
    ).toThrow(/reading 'ordinal'/);
  });

  it('allows an immediately preceding disputed turn across a session boundary', () => {
    const previous = position(7, 'turn-7', 'session-1');
    const current = position(8, 'turn-8', 'session-2');
    expect(() =>
      validateCampaignRule(
        rule({
          effectivePosition: previous,
          temporalMode: {
            mode: 'disputed-turn',
            disputedPosition: previous,
          },
        }),
        { ambiguity },
        current,
      ),
    ).not.toThrow();
  });

  it('keeps SQL and decoded position ordering aligned for encoded anchors', () => {
    const positions = [position(5, 'turn', 'a b'), position(6, 'turn', 'a!c')];
    const encoded = positions.map(formatCampaignPosition);
    expect([...encoded].sort()).toEqual(encoded);
    expect(
      positions
        .slice()
        .sort(compareCampaignPositions)
        .map(formatCampaignPosition),
    ).toEqual(encoded);
  });

  it('accepts coherent supersession history ending in a revoked successor', () => {
    expect(() =>
      validateCampaignRules(
        [
          rule({ ruleIdentity: 'a', status: 'superseded', supersededBy: 'b' }),
          rule({
            ruleIdentity: 'b',
            effectivePosition: position(2),
            status: 'revoked',
            revokedPosition: position(3),
          }),
        ],
        { ambiguity },
      ),
    ).not.toThrow();

    expect(() =>
      validateCampaignRules(
        [
          rule({ ruleIdentity: 'a', status: 'superseded', supersededBy: 'b' }),
          rule({
            ruleIdentity: 'b',
            effectivePosition: position(2),
            status: 'superseded',
            supersededBy: 'c',
          }),
          rule({
            ruleIdentity: 'c',
            effectivePosition: position(3),
            status: 'revoked',
            revokedPosition: position(4),
          }),
        ],
        { ambiguity },
      ),
    ).not.toThrow();
  });

  it('rejects an incoherent revoked rule without a revocation position', () => {
    expect(() =>
      validateCampaignRules(
        [
          rule({ ruleIdentity: 'a', status: 'superseded', supersededBy: 'b' }),
          rule({ ruleIdentity: 'b', status: 'revoked', supersededBy: null }),
        ],
        { ambiguity },
      ),
    ).toThrow('revoked rule must carry revokedPosition');
  });

  it('rejects invalid supersession graphs', () => {
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
