import { describe, expect, it } from 'vitest';
import {
  bundledDnd5eSrdRecordRelationshipManifestSource,
  expandTypedRelationships,
  getBundledDnd5eSrdPack,
  getBundledDnd5eSrdRecordRelationshipManifest,
  normalizeRulesRecordName,
  resolveRecordRelationships,
  resolveRulesStack,
} from '../../src/internal.js';
import { ruleAwareness } from '../../src/rules/ruleAwareness.js';

const pack = getBundledDnd5eSrdPack();
const stack = resolveRulesStack({ base: pack });
const manifest = getBundledDnd5eSrdRecordRelationshipManifest();
const conditionEffectPrefix = '/mechanics/effects/*/condition';
const conditionTriggerPrefix = '/mechanics/effects/*/triggerCondition';

function entry(key: string) {
  const found = stack.recordsByKey.get(key);
  if (!found) throw new Error(`missing bundled record ${key}`);
  return found;
}

function seed(key: string) {
  const found = entry(key);
  return {
    candidateKey: key,
    targetKind: 'rules-record' as const,
    entry: found,
    routes: [
      {
        routeClass: 'direct-state-ref' as const,
        trigger: 'test',
        evidence: {},
        signalId: 'condition-relationship-test',
      },
    ],
    traversals: [],
    campaignRules: [],
    campaignRulings: [],
  };
}

describe('condition discovery relationships in the committed SRD pack', () => {
  it('preserves the source-backed relationship identities and existing exhaustion exception', () => {
    const expected = [
      ['condition:paralyzed', 'implied-condition', 'condition:incapacitated'],
      ['condition:petrified', 'implied-condition', 'condition:incapacitated'],
      ['condition:stunned', 'implied-condition', 'condition:incapacitated'],
      ['condition:unconscious', 'implied-condition', 'condition:incapacitated'],
      ['condition:unconscious', 'imposed-condition', 'condition:prone'],
      [
        'condition:grappled',
        'ending-trigger-condition',
        'condition:incapacitated',
      ],
    ];
    const actual = pack.records.flatMap((record) =>
      resolveRecordRelationships(manifest, record, stack)
        .filter(
          (resolution) =>
            resolution.outcome === 'resolved' &&
            (resolution.declaration.pointerPrefix === conditionEffectPrefix ||
              resolution.declaration.pointerPrefix === conditionTriggerPrefix),
        )
        .map((resolution) => [
          resolution.sourceRecordKey,
          resolution.relation,
          resolution.targetRecordKey,
        ]),
    );
    expect(
      actual.sort((a, b) => a.join('|').localeCompare(b.join('|'))),
    ).toEqual(expected.sort((a, b) => a.join('|').localeCompare(b.join('|'))));
    for (const [sourceRecordKey, , targetRecordKey] of actual)
      expect(targetRecordKey).not.toBe(sourceRecordKey);

    for (const record of pack.records.filter(
      (item) => item.kind === 'condition',
    )) {
      const conditionEdges = resolveRecordRelationships(
        manifest,
        record,
        stack,
      ).filter(
        (resolution) =>
          resolution.declaration.pointerPrefix === conditionEffectPrefix ||
          resolution.declaration.pointerPrefix === conditionTriggerPrefix,
      );
      if (record.key === 'condition:grappled') {
        expect(
          conditionEdges.filter((item) => item.outcome === 'excluded'),
        ).toHaveLength(2);
        expect(conditionEdges).toContainEqual(
          expect.objectContaining({
            outcome: 'resolved',
            relation: 'ending-trigger-condition',
            targetRecordKey: 'condition:incapacitated',
          }),
        );
        continue;
      }
      if (
        record.key === 'condition:paralyzed' ||
        record.key === 'condition:petrified' ||
        record.key === 'condition:stunned' ||
        record.key === 'condition:unconscious'
      )
        continue;
      expect(conditionEdges).toEqual([]);
    }

    expect(
      resolveRecordRelationships(
        manifest,
        entry('condition:exhaustion').record,
        stack,
      ),
    ).toEqual([
      expect.objectContaining({
        outcome: 'resolved',
        pointer: '/mechanics/levelLifecycle/exceptionRuleRefs/*',
        relation: 'lifecycle-exception',
        targetRecordKey: 'rule:food-and-water',
      }),
    ]);
  });

  it('checks each actual excluded leaf against its source record name', () => {
    const excluded = pack.records.flatMap((record) =>
      resolveRecordRelationships(manifest, record, stack)
        .filter((resolution) => resolution.outcome === 'excluded')
        .map((resolution) => ({ record, resolution })),
    );
    expect(excluded).toHaveLength(2);
    expect(
      (
        entry('condition:grappled').record.data as {
          mechanics: { effects: readonly Record<string, unknown>[] };
        }
      ).mechanics.effects.filter(
        (effect) => effect.kind === 'conditionEndsWhen',
      ),
    ).toHaveLength(excluded.length);
    for (const { record, resolution } of excluded) {
      // RelationshipResolution.pointer is the declared pointer shape (array
      // indexes normalized to `*`); the sibling value identifies the actual
      // effect instance whose leaf the table excluded.
      const matchingEffects = (
        record.data as {
          mechanics: { effects: readonly Record<string, unknown>[] };
        }
      ).mechanics.effects.find(
        (candidate) => candidate.kind === resolution.relationFieldValue,
      );
      const leaf = matchingEffects?.condition;
      expect(typeof leaf).toBe('string');
      expect(normalizeRulesRecordName(leaf as string)).toBe(
        normalizeRulesRecordName(record.name),
      );
    }
  });

  it('expands a stunned seed to incapacitated through record-name resolution', () => {
    const trace = expandTypedRelationships([seed('condition:stunned')], stack, {
      relationshipManifestSource:
        bundledDnd5eSrdRecordRelationshipManifestSource(),
    });
    expect(trace.traversals).toContainEqual({
      sourceRecordKey: 'condition:stunned',
      linkField: 'data.mechanics.effects[].condition',
      relation: 'implied-condition',
      targetRecordKey: 'condition:incapacitated',
    });
  });

  it('retains Grappled exclusion in discovery and the lookup_rules awareness envelope without a loss', () => {
    const trace = expandTypedRelationships(
      [seed('condition:grappled')],
      stack,
      {
        relationshipManifestSource:
          bundledDnd5eSrdRecordRelationshipManifestSource(),
      },
    );
    expect(trace.relationshipResolutions).toContainEqual(
      expect.objectContaining({
        outcome: 'excluded',
        sourceRecordKey: 'condition:grappled',
        relationFieldValue: 'conditionEndsWhen',
      }),
    );
    expect(trace.traversals).toContainEqual({
      sourceRecordKey: 'condition:grappled',
      linkField: 'data.mechanics.effects[].triggerCondition',
      relation: 'ending-trigger-condition',
      targetRecordKey: 'condition:incapacitated',
    });
    expect(
      trace.traversals.filter(
        (traversal) => traversal.sourceRecordKey === 'condition:grappled',
      ),
    ).toHaveLength(1);
    expect(trace.losses).not.toContainEqual(
      expect.objectContaining({
        detail: expect.objectContaining({
          sourceRecordKey: 'condition:grappled',
          outcome: 'excluded',
        }),
      }),
    );

    const awareness = ruleAwareness(
      'condition:grappled',
      stack,
      bundledDnd5eSrdRecordRelationshipManifestSource(),
    );
    expect(awareness.relationships).toContainEqual(
      expect.objectContaining({
        outcome: 'excluded',
        relationFieldValue: 'conditionEndsWhen',
        pointer: conditionEffectPrefix,
      }),
    );
  });
});
