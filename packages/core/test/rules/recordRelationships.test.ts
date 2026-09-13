import { describe, expect, it } from 'vitest';
import type {
  RecordRelationshipDeclaration,
  RelationshipResolution,
} from '../../src/internal.js';
import {
  assertRecordRelationshipDeclarationsAreLive,
  buildRecordRelationshipManifest,
  expandTypedRelationships,
  getBundledDnd5eSrdPack,
  getBundledDnd5eSrdRecordRelationshipManifest,
  relationshipDeclarationForPointer,
  resolveRecordRelationships,
  resolveRulesStack,
} from '../../src/internal.js';

const pack = getBundledDnd5eSrdPack();
const stack = resolveRulesStack({ base: pack });
const manifest = getBundledDnd5eSrdRecordRelationshipManifest();

function resolutions(key: string): readonly RelationshipResolution[] {
  const entry = stack.recordsByKey.get(key);
  if (!entry) throw new Error(`missing fixture ${key}`);
  return resolveRecordRelationships(manifest, entry.record, stack);
}

function record(key: string) {
  const found = stack.recordsByKey.get(key);
  if (!found) throw new Error(`missing fixture ${key}`);
  return found.record;
}

describe('pack-owned record relationships', () => {
  it('distinguishes ancestry source from feature source by identity', () => {
    const ancestry = stack.recordsByKey.get('ancestry:dwarf')?.record;
    const feature = stack.recordsByKey.get(
      'feature:barbarian:ability-score-improvement',
    )?.record;
    expect(
      ancestry &&
        relationshipDeclarationForPointer(manifest, ancestry.kind, '/source'),
    ).toMatchObject({
      disposition: 'not-a-reference',
      reason: expect.stringContaining('structural field'),
    });
    expect(feature && resolutions(feature.key)).toContainEqual(
      expect.objectContaining({
        outcome: 'resolved',
        sourceRecordKey: feature?.key,
        pointer: '/source',
        relation: 'granted-by',
        targetRecordKey: 'class:barbarian',
      }),
    );
    expect(resolutions('ancestry:dwarf')).toEqual([]);
  });

  it('fails closed when a declaration is dead', () => {
    const declaration = manifest.declarations[0];
    expect(() =>
      assertRecordRelationshipDeclarationsAreLive(
        pack.records,
        buildRecordRelationshipManifest([
          { ...declaration, pointerPrefix: '/does-not-exist' },
        ]),
      ),
    ).toThrow(/ancestry, \/does-not-exist/);
  });

  it('retains absent key, absent name, and ambiguous name outcomes', () => {
    const source = record('feature:barbarian:ability-score-improvement');
    const keyManifest = buildRecordRelationshipManifest([
      {
        kind: 'feature',
        pointerPrefix: '/source',
        linkField: 'data.source',
        disposition: 'reference',
        relation: 'granted-by',
        targetResolution: 'record-key',
        reason: 'test',
      },
    ]);
    const missing = {
      ...source,
      data: { ...source.data, source: 'class:missing' },
    };
    const missingResult = resolveRecordRelationships(
      keyManifest,
      missing,
      stack,
    );
    expect(missingResult).toContainEqual(
      expect.objectContaining({
        outcome: 'unresolved-target',
        reason: 'no-record-with-key',
        rawValue: 'class:missing',
      }),
    );
    const sourceEntry = stack.recordsByKey.get(source.key);
    if (!sourceEntry) throw new Error('missing source entry');
    const missingCandidate = {
      candidateKey: source.key,
      targetKind: 'rules-record' as const,
      entry: { ...sourceEntry, record: missing },
      routes: [
        {
          routeClass: 'direct-state-ref' as const,
          trigger: 'test',
          evidence: {},
          signalId: 'test',
        },
      ],
      traversals: [],
      campaignRules: [],
      campaignRulings: [],
    };
    const missingTrace = expandTypedRelationships([missingCandidate], stack, {
      relationshipManifest: keyManifest,
    });
    expect(missingTrace.relationshipResolutions).toContainEqual(
      expect.objectContaining({
        outcome: 'unresolved-target',
        reason: 'no-record-with-key',
        rawValue: 'class:missing',
      }),
    );
    expect(missingTrace.losses).toContainEqual(
      expect.objectContaining({ reason: 'unresolved-typed-target' }),
    );
    const nameManifest = buildRecordRelationshipManifest([
      {
        kind: 'action',
        pointerPrefix: '/mechanics/conditions/*/condition',
        linkField: 'data.mechanics.conditions',
        disposition: 'reference',
        relation: 'condition',
        targetResolution: 'record-name',
        targetKind: 'condition',
        reason: 'test',
      },
    ]);
    const action = record('action:dodge');
    const absent = {
      ...action,
      data: {
        mechanics: {
          conditions: [{ condition: 'missing', relation: 'applies' }],
        },
      },
    };
    expect(
      resolveRecordRelationships(nameManifest, absent, stack),
    ).toContainEqual(
      expect.objectContaining({ reason: 'no-record-with-name' }),
    );
    const conditionIndex = stack.recordsByKind.get('condition');
    if (!conditionIndex) throw new Error('missing condition index');
    const ambiguous = [...conditionIndex.byName.entries()][0][1][0].record;
    const duplicate = { ...ambiguous, key: 'condition:duplicate' };
    const ambiguousStack = resolveRulesStack({
      base: { ...pack, records: [...pack.records, duplicate] },
    });
    const named = {
      ...action,
      data: {
        mechanics: {
          conditions: [{ condition: 'blinded', relation: 'applies' }],
        },
      },
    };
    expect(
      resolveRecordRelationships(nameManifest, named, ambiguousStack),
    ).toContainEqual(expect.objectContaining({ reason: 'ambiguous-name' }));
  });

  it('uses each condition entry relation and preserves all ten resolving families', () => {
    const action = record('action:dodge');
    const duplicateConditions = {
      ...action,
      data: {
        ...action.data,
        mechanics: {
          conditions: [
            { condition: 'incapacitated', relation: 'exclusion' },
            { condition: 'incapacitated', relation: 'applies' },
          ],
        },
      },
    };
    const conditionResults = resolutions(action.key);
    const duplicateResults = resolveRecordRelationships(
      manifest,
      duplicateConditions,
      stack,
    );
    expect(duplicateResults.map((r) => r.relation)).toEqual([
      'exclusion',
      'applies',
    ]);
    expect(conditionResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRecordKey: 'action:dodge',
          relation: 'exclusion',
          targetRecordKey: 'condition:incapacitated',
        }),
      ]),
    );
    const expected = [
      [
        'feature:barbarian:ability-score-improvement',
        'granted-by',
        'class:barbarian',
      ],
      ['subclass:champion', 'parent-class', 'class:fighter'],
      ['class:barbarian', 'progression-table', 'table:the-barbarian'],
      ['rule:ability-checks', 'table-reference', 'table:difficulty-classes'],
      [
        'magic-item:apparatus-of-the-crab',
        'table-reference',
        'table:apparatus-of-the-crab-levers',
      ],
      [
        'magic-item:deck-of-many-things',
        'stat-block-reference',
        'stat-block:avatar-of-death',
      ],
      [
        'spell:animate-objects',
        'table-reference',
        'table:animated-object-statistics',
      ],
      [
        'feature:cleric:destroy-undead',
        'table-reference',
        'table:destroy-undead',
      ],
      ['background:acolyte', 'table-reference', 'table:acolyte-bonds'],
      [
        'subclass:circle-of-the-land',
        'table-reference',
        'table:circle-of-the-land-arctic',
      ],
    ] as const;
    for (const [sourceRecordKey, relation, targetRecordKey] of expected)
      expect(resolutions(sourceRecordKey)).toContainEqual(
        expect.objectContaining({ sourceRecordKey, relation, targetRecordKey }),
      );
  });

  it('requires an explicit manifest and reports absence separately from losses', () => {
    const seed = {
      candidateKey: 'feature:barbarian:ability-score-improvement',
      targetKind: 'rules-record' as const,
      entry: stack.recordsByKey.get(
        'feature:barbarian:ability-score-improvement',
      ),
      routes: [
        {
          routeClass: 'direct-state-ref' as const,
          trigger: 'test',
          evidence: {},
          signalId: 'test',
        },
      ],
      traversals: [],
      campaignRules: [],
      campaignRulings: [],
    };
    const trace = expandTypedRelationships([seed], stack, {
      relationshipManifest: undefined,
    });
    expect(trace.traversals).toEqual([]);
    expect(trace.relationshipManifestAbsent).toBe(true);
    expect(trace.losses).toEqual([]);
  });

  it('rejects every malformed declaration shape', () => {
    const valid: RecordRelationshipDeclaration = {
      kind: 'feature',
      pointerPrefix: '/source',
      linkField: 'data.source',
      disposition: 'reference',
      relation: 'granted-by',
      targetResolution: 'record-key',
      reason: 'test',
    };
    for (const bad of [
      { ...valid, pointerPrefix: '' },
      { ...valid, pointerPrefix: 'source' },
      { ...valid, reason: '' },
      { ...valid, disposition: 'not-a-reference', relation: 'wrong' },
      { ...valid, targetResolution: undefined },
      { ...valid, targetResolution: 'record-name', targetKind: undefined },
      [valid, valid],
    ])
      expect(() =>
        buildRecordRelationshipManifest(
          Array.isArray(bad) ? bad : ([bad] as never),
        ),
      ).toThrow();
  });
});
