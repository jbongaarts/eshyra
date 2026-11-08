import { describe, expect, it } from 'vitest';
import type {
  RelationshipResolution,
  ToolContext,
} from '../../src/internal.js';
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
import { walkFieldPointers } from '../../src/rules/fieldProvenance.js';

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
            // The magic-item effect `condition` pointer shares this prefix;
            // this test is about condition records only.
            resolution.declaration.kind === 'condition' &&
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
    // Scoped to condition records: their `conditionEndsWhen` exclusion is the
    // self-reference this test checks. Exclusions declared on other kinds
    // (overloaded prose `condition` fields) are checked by the
    // 'outside condition records' tests below.
    const excluded = pack.records.flatMap((record) =>
      resolveRecordRelationships(manifest, record, stack).flatMap(
        (resolution) =>
          resolution.outcome === 'excluded' &&
          resolution.declaration.kind === 'condition'
            ? [{ record, resolution }]
            : [],
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

describe('condition-name leaves outside condition records (eshyra-o9bd.19.3.5)', () => {
  function outcomes(key: string, pointerPrefix: string) {
    return resolveRecordRelationships(
      manifest,
      entry(key).record,
      stack,
    ).filter(
      (resolution) => resolution.declaration.pointerPrefix === pointerPrefix,
    );
  }

  const resolvedEdge = (
    sourceKey: string,
    pointerPrefix: string,
  ): readonly [string, string][] =>
    outcomes(sourceKey, pointerPrefix).flatMap((resolution) =>
      resolution.outcome === 'resolved'
        ? [
            [resolution.relation, resolution.targetRecordKey] as [
              string,
              string,
            ],
          ]
        : [],
    );

  it('resolves a creature action, an ancestry trait, and the magic-item shapes against the printed clause', () => {
    // Aboleth Enslave: "... or be magically charmed by the aboleth."
    expect(
      resolvedEdge(
        'creature:aboleth',
        '/actions/*/mechanics/conditions/*/condition',
      ),
    ).toContainEqual(['mention', 'condition:charmed']);
    // Elf Fey Ancestry: advantage on saving throws against being charmed.
    expect(
      resolvedEdge(
        'ancestry:elf',
        '/traits/*/mechanics/conditions/*/condition',
      ),
    ).toEqual([['advantage', 'condition:charmed']]);
    // Wand of Paralysis: "... or be paralyzed for 1 minute".
    expect(
      resolvedEdge(
        'magic-item:wand-of-paralysis',
        '/mechanics/effects/*/conditions/*',
      ),
    ).toEqual([['imposed-condition', 'condition:paralyzed']]);
    // Periapt of Proof against Poison: "immune to the poisoned condition".
    expect(
      resolvedEdge(
        'magic-item:periapt-of-proof-against-poison',
        '/mechanics/effects/*/conditions/*',
      ),
    ).toEqual([['condition-immunity', 'condition:poisoned']]);
    // Giant Slayer: "must succeed on a DC 15 Strength saving throw or fall prone".
    expect(
      resolvedEdge(
        'magic-item:giant-slayer',
        '/mechanics/effects/*/failedSaveCondition',
      ),
    ).toEqual([['failed-save-condition', 'condition:prone']]);
    // Philter of Love: the imposesCondition effect names charmed.
    expect(
      resolvedEdge(
        'magic-item:philter-of-love',
        '/mechanics/effects/*/condition',
      ),
    ).toEqual([['imposed-condition', 'condition:charmed']]);
    // Rod of Rulership: "must succeed on a DC 15 Wisdom saving throw or be
    // charmed by you for 8 hours".
    expect(
      resolvedEdge(
        'magic-item:rod-of-rulership',
        '/mechanics/effects/*/conditions/*',
      ),
    ).toEqual([['imposed-condition', 'condition:charmed']]);
    expect(
      outcomes('magic-item:rod-of-rulership', '/mechanics/effects/*/condition'),
    ).toEqual([]);
    // Philter of Love: both the imposesCondition effect and the residual
    // triggeredEffect ("become charmed by that creature for 1 hour") reach it.
    expect(
      resolvedEdge(
        'magic-item:philter-of-love',
        '/mechanics/effects/*/conditions/*',
      ),
    ).toEqual([['imposed-condition', 'condition:charmed']]);
    // Ball Bearings: "... Dexterity saving throw or fall prone".
    expect(
      resolvedEdge(
        'equipment:ball-bearings-bag-of-1-000',
        '/useProfile/clauses/*/semantics/failureCondition',
      ),
    ).toEqual([['failed-save-condition', 'condition:prone']]);
    // Net: "A Large or smaller creature hit by a net is restrained until it is freed."
    expect(
      resolvedEdge(
        'equipment:net',
        '/useProfile/clauses/*/semantics/condition',
      ),
    ).toEqual([['imposed-condition', 'condition:restrained']]);
  });

  it('declares Dodge ending circumstances as not-a-reference and emits no outcome for them', () => {
    const declaration = manifest.declarations.find(
      (item) =>
        item.kind === 'action' &&
        item.pointerPrefix === '/mechanics/effects/*/conditions/*',
    );
    expect(declaration).toMatchObject({ disposition: 'not-a-reference' });
    expect(entry('action:dodge').record.data).toMatchObject({
      mechanics: {
        effects: expect.arrayContaining([
          {
            kind: 'benefitEndsWhen',
            conditions: ['you-are-incapacitated', 'your-speed-is-0'],
          },
        ]),
      },
    });
    expect(
      outcomes('action:dodge', '/mechanics/effects/*/conditions/*'),
    ).toEqual([]);
  });

  it('excludes the non-condition value suffocating by declaration, with nothing left unresolved', () => {
    const all = pack.records.flatMap((record) =>
      resolveRecordRelationships(manifest, record, stack),
    );
    expect(
      all.filter((resolution) => resolution.outcome === 'unresolved-target'),
    ).toEqual([]);
    expect(
      all.filter(
        (resolution) =>
          resolution.outcome === 'excluded' &&
          resolution.reason === 'leaf-value-exclusion',
      ),
    ).toEqual([
      expect.objectContaining({
        sourceRecordKey: 'magic-item:dust-of-sneezing-and-choking',
        pointer: '/mechanics/effects/*/conditions/*',
        rawValue: 'suffocating',
      }),
      expect.objectContaining({
        sourceRecordKey: 'magic-item:dust-of-sneezing-and-choking',
        pointer: '/mechanics/effects/*/conditions/*',
        rawValue: 'suffocating',
      }),
    ]);
    // Printed: "A creature affected in this way is incapacitated and
    // suffocating." The pack has rule:suffocating but no condition of that
    // name, and incapacitated still resolves.
    expect(stack.recordsByKey.has('rule:suffocating')).toBe(true);
    expect(stack.recordsByKey.has('condition:suffocating')).toBe(false);
    expect(
      resolvedEdge(
        'magic-item:dust-of-sneezing-and-choking',
        '/mechanics/effects/*/conditions/*',
      ),
    ).toEqual([
      ['imposed-condition', 'condition:incapacitated'],
      ['imposed-condition', 'condition:incapacitated'],
    ]);
  });

  it('excludes only prose leaves in overloaded condition fields, never a condition name', () => {
    const conditionNames = new Set(
      pack.records
        .filter((record) => record.kind === 'condition')
        .map((record) => normalizeRulesRecordName(record.name)),
    );
    const excludedByRecord: [string, string][] = [];
    for (const record of pack.records) {
      const excludedPointers = new Set(
        resolveRecordRelationships(manifest, record, stack).flatMap(
          (resolution: RelationshipResolution) =>
            resolution.outcome === 'excluded' &&
            resolution.reason === 'relation-table-exclusion' &&
            resolution.declaration.kind !== 'condition'
              ? [resolution.pointer]
              : [],
        ),
      );
      if (excludedPointers.size === 0) continue;
      walkFieldPointers(record.data, (pointer, value) => {
        if (!excludedPointers.has(pointer)) return;
        if (
          typeof value === 'string' &&
          conditionNames.has(normalizeRulesRecordName(value))
        )
          excludedByRecord.push([record.key, `${pointer}=${value}`]);
      });
    }
    // No exceptions: every table-excluded leaf outside condition records is
    // prose. A condition name under an excluded-capable pointer would be a
    // silently lost edge (the earlier charmed triggeredEffect gap, eshyra-y0us).
    expect(excludedByRecord).toEqual([]);
    const lance = outcomes(
      'equipment:lance',
      '/useProfile/clauses/*/semantics/condition',
    );
    expect(lance).toEqual([
      expect.objectContaining({
        outcome: 'excluded',
        relationFieldValue: 'model',
      }),
    ]);
  });

  it('lets a seeded creature record reach the condition record through one-hop expansion', () => {
    const trace = expandTypedRelationships([seed('creature:aboleth')], stack, {
      relationshipManifestSource:
        bundledDnd5eSrdRecordRelationshipManifestSource(),
    });
    expect(trace.traversals).toContainEqual({
      sourceRecordKey: 'creature:aboleth',
      linkField: 'data.actions[].mechanics.conditions',
      relation: 'mention',
      targetRecordKey: 'condition:charmed',
    });
  });
});
