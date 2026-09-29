import { describe, expect, it } from 'vitest';
import { expandTypedRelationships } from '../../src/discovery/expansion.js';
import { DEFAULT_TOOLS } from '../../src/orchestrator/tools.js';
import {
  bundledDnd5eSrdRecordRelationshipManifestSource,
  getBundledDnd5eSrdPack,
} from '../../src/rules/bundledSrdPack.js';
import {
  RULE_ADJUDICATION_CONTEXT,
  validateRuleAdjudicationContext,
} from '../../src/rules/ruleAdjudicationContext.js';
import { ruleAwareness } from '../../src/rules/ruleAwareness.js';
import {
  RULE_KNOWN_LIMITS,
  validateRuleKnownLimits,
} from '../../src/rules/ruleKnownLimits.js';
import { resolveRulesStack } from '../../src/rules/stack.js';

const stack = resolveRulesStack({ base: getBundledDnd5eSrdPack() });
const manifestSource = bundledDnd5eSrdRecordRelationshipManifestSource();

describe('rule awareness', () => {
  it('keeps the capability, adjudication, and limit channels independent', () => {
    const key = 'rule:ability-checks';
    const context = {
      tools: ['lookup_rules'],
      dmContext: 'Synthetic context.',
    };
    const limit = {
      limit: 'partial' as const,
      statement: 'Synthetic limit.',
      findingId: 'readiness-integrity',
      status: 'partial' as const,
      missing: 'Synthetic limit.',
    };
    const result = ruleAwareness(key, stack, manifestSource, {
      adjudicationContext: { [key]: context },
      knownLimits: { [key]: [limit] },
    });
    expect(result.capabilities.outcome).toBe('bound');
    expect(result.adjudicationContext).toEqual(context);
    expect(result.knownLimits).toEqual([
      {
        limit: limit.limit,
        statement: limit.statement,
        findingId: limit.findingId,
      },
    ]);
  });

  it('preserves the declared action:hide ruleRef relationship', () => {
    const result = ruleAwareness('action:hide', stack, manifestSource);
    expect(result.relationshipArtifact).toEqual({
      packId: stack.base.meta.packId,
      state: 'present',
    });
    expect(result.relationships).toContainEqual(
      expect.objectContaining({
        outcome: 'resolved',
        sourceRecordKey: 'action:hide',
        pointer: '/mechanics/effects/*/ruleRef',
        relation: 'governing-rule',
      }),
    );
  });

  it('matches discovery relationship resolutions for the same stack and source', () => {
    const awareness = ruleAwareness('action:hide', stack, manifestSource);
    const expansion = expandTypedRelationships([], stack, {
      relationshipManifestSource: manifestSource,
    });
    expect(awareness.relationships).toEqual(
      expansion.relationshipResolutions.filter(
        (resolution) => resolution.sourceRecordKey === 'action:hide',
      ),
    );
  });

  it('retires the stale long-rest limit and leaves reference prose empty', () => {
    const longRest = ruleAwareness('rule:long-rest', stack, manifestSource);
    expect(longRest.capabilities.outcome).toBe('not-positively-selected');
    expect(longRest.knownLimits).toEqual([]);

    const lair = ruleAwareness(
      'rule:a-legendary-creatures-lair',
      stack,
      manifestSource,
    );
    expect(lair.capabilities.outcome).toBe('no-statement');
    expect(lair.adjudicationContext).toBeUndefined();
    expect(lair.knownLimits).toEqual([]);
  });

  it('validates tool and finding identities in its authored datasets', () => {
    expect(
      validateRuleAdjudicationContext(
        new Set(DEFAULT_TOOLS.map((tool) => tool.name)),
      ),
    ).toEqual([]);
    expect(validateRuleKnownLimits()).toEqual([]);
    expect(RULE_ADJUDICATION_CONTEXT['rule:cover']?.tools).toContain(
      'resolve_check',
    );
    expect(RULE_KNOWN_LIMITS['rule:suffocating']?.[0]?.findingId).toBe(
      'readiness-integrity',
    );
  });
});
