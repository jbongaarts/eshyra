import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../../src/internal.js';
import {
  bundledDnd5eSrdRecordRelationshipManifestSource,
  createDefaultToolRegistry,
  createSeededRng,
  expandTypedRelationships,
  getBundledDnd5eSrdPack,
  getBundledDnd5eSrdRecordRelationshipManifest,
  initSchema,
  normalizeRulesRecordName,
  openDatabase,
  resolveRecordRelationships,
  resolveRulesStack,
  startSession,
} from '../../src/internal.js';

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

  it('checks every actual excluded leaf against its source record name', () => {
    const excluded = pack.records.flatMap((record) =>
      resolveRecordRelationships(manifest, record, stack).flatMap(
        (resolution) =>
          resolution.outcome === 'excluded' ? [{ record, resolution }] : [],
      ),
    );
    expect(
      excluded.map(({ resolution }) => resolution.sourceRecordKey),
    ).toEqual(['condition:grappled', 'condition:grappled']);
    // An excluded outcome carries the declared pointer SHAPE, so repeated
    // outcomes for one record are indistinguishable by identity. Group them,
    // enumerate every array element the shape covers whose relation sibling
    // carries the excluded value, require one element per outcome (so no two
    // outcomes can alias one element), and check EVERY such element's leaf.
    const groups = new Map<string, typeof excluded>();
    for (const item of excluded) {
      const id = `${item.record.key}|${item.resolution.pointer}|${item.resolution.relationFieldValue}`;
      groups.set(id, [...(groups.get(id) ?? []), item]);
    }
    for (const items of groups.values()) {
      const [{ record, resolution }] = items;
      const [arrayPath, leafPath] = resolution.pointer.split('/*/');
      const relationField = resolution.declaration.relationField as string;
      let container: unknown = record.data;
      for (const segment of arrayPath.split('/').filter(Boolean))
        container = (container as Record<string, unknown>)[segment];
      const covered = (container as readonly Record<string, unknown>[]).filter(
        (element) =>
          element[relationField] === resolution.relationFieldValue &&
          leafPath in element,
      );
      expect(covered).toHaveLength(items.length);
      for (const element of covered) {
        const leaf = element[leafPath];
        expect(typeof leaf).toBe('string');
        expect(normalizeRulesRecordName(leaf as string)).toBe(
          normalizeRulesRecordName(record.name),
        );
      }
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

    // Amended F-09 contract (A2): the live lookup_rules envelope passes the
    // `excluded` outcome through unfiltered.
    const db = openDatabase(':memory:');
    initSchema(db);
    startSession(db, {
      campaignId: 'campaign-1',
      sessionId: 'session-1',
      startedAt: '2026-05-20T09:00:00.000Z',
    });
    const toolContext: ToolContext = {
      db,
      rng: createSeededRng(42),
      campaignId: 'campaign-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      at: '2026-05-20T10:00:00.000Z',
    };
    const result = createDefaultToolRegistry().invoke(
      'lookup_rules',
      { kind: 'condition', ref: 'condition:grappled' },
      toolContext,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      ruleAwareness: { relationships: readonly unknown[] };
    };
    expect(data.ruleAwareness.relationships).toContainEqual(
      expect.objectContaining({
        outcome: 'excluded',
        relationFieldValue: 'conditionEndsWhen',
        pointer: conditionEffectPrefix,
      }),
    );
  });
});
