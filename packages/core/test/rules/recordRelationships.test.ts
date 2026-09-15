import { describe, expect, it } from 'vitest';
import type {
  RecordRelationshipDeclaration,
  RelationshipArtifactState,
  RelationshipResolution,
  ResolvedRulesStack,
  RulesPack,
  RulesRecord,
} from '../../src/internal.js';
import {
  assertRecordRelationshipDeclarationsAreLive,
  assertRecordRelationshipDeclarationsCoverBoundedShapes,
  buildRecordRelationshipManifest,
  bundledDnd5eSrdRecordRelationshipManifestSource,
  DND5E_SRD_PACK_ID,
  expandTypedRelationships,
  getBundledDnd5eSrdPack,
  getBundledDnd5eSrdRecordRelationshipManifest,
  LEGACY_RELATIONSHIP_BEARING_POINTER_SHAPES,
  projectDiscoveryTrace,
  relationshipDeclarationForPointer,
  resolveRecordRelationships,
  resolveRulesStack,
  runDiscoveryStages,
} from '../../src/internal.js';
import { freshDbWithSession } from '../support/db.js';

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

/**
 * A must-consider seed candidate for `key`, carrying the EXACT entry object
 * `targetStack` holds — the same identity `resolveDiscoveryCandidates`
 * produces in production (`candidates.ts` pulls straight from
 * `stack.recordsByKey`). Shared by the F1/F4/F6 evidence below so each test
 * exercises the real `expandTypedRelationships` entry point rather than
 * calling `resolveRecordRelationships` directly.
 */
function mustConsiderSeed(targetStack: ResolvedRulesStack, key: string) {
  const entry = targetStack.recordsByKey.get(key);
  if (!entry) throw new Error(`missing fixture ${key}`);
  return {
    candidateKey: key,
    targetKind: 'rules-record' as const,
    entry,
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
      relationshipManifestSource: () => keyManifest,
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
        relationField: 'relation',
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

  it('requires an explicit manifest source and reports producer absence separately from losses', () => {
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
      relationshipManifestSource: undefined,
    });
    expect(trace.traversals).toEqual([]);
    // Replaces the old single `relationshipManifestAbsent: boolean` (F4):
    // exactly the one producer this single-pack stack has, reported absent by
    // its stable packId, never inferred or defaulted.
    expect(trace.relationshipArtifactByProducer).toEqual([
      { packId: DND5E_SRD_PACK_ID, state: 'absent' },
    ]);
    expect(trace.losses).toEqual([]);
  });

  it('reads the per-occurrence relation from the DECLARED sibling key', () => {
    // The pack's condition entries keep their relation in `relation`. A pack
    // whose parser named that sibling something else must still resolve, and
    // must do so because the declaration SAYS so — not because a pointer
    // string happened to end in `/condition`.
    const action = record('action:dodge');
    const renamed = {
      ...action,
      data: {
        mechanics: {
          conditions: [{ condition: 'incapacitated', how: 'exclusion' }],
        },
      },
    };
    const renamedManifest = buildRecordRelationshipManifest([
      {
        kind: 'action',
        pointerPrefix: '/mechanics/conditions/*/condition',
        linkField: 'data.mechanics.conditions',
        disposition: 'reference',
        relation: 'condition',
        targetResolution: 'record-name',
        targetKind: 'condition',
        relationField: 'how',
        reason: 'test: the relation sibling is named `how` in this pack.',
      },
    ]);
    expect(
      resolveRecordRelationships(renamedManifest, renamed, stack),
    ).toContainEqual(
      expect.objectContaining({
        outcome: 'resolved',
        relation: 'exclusion',
        targetRecordKey: 'condition:incapacitated',
      }),
    );
    // The same record under the shipped manifest, which declares the sibling
    // `relation` — absent here, since this fixture names it `how` instead.
    // D3 (eshyra-o9bd.19.1.4 review, repaired by eshyra-jgxl): the CODIFIED
    // DEFECT this test used to assert was `toEqual([])` here — the declared
    // occurrence silently vanishing, indistinguishable from "nothing was ever
    // declared for this pointer". The declaration DID fire; what could not be
    // read is the record's own data. That is exactly the `indeterminate`
    // outcome's reason for existing (see `RelationshipResolution`'s doc
    // comment in `recordRelationships.ts`), asserted here by full identity —
    // one element, this shape, this declaration, nothing else.
    const shippedDeclaration = relationshipDeclarationForPointer(
      manifest,
      'action',
      '/mechanics/conditions/*/condition',
    );
    expect(shippedDeclaration).toBeDefined();
    expect(resolveRecordRelationships(manifest, renamed, stack)).toEqual([
      {
        outcome: 'indeterminate',
        sourceRecordKey: action.key,
        pointer: '/mechanics/conditions/*/condition',
        reason: 'relation-sibling-missing',
        declaration: shippedDeclaration,
      },
    ]);
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
      { ...valid, linkField: '' },
      // record-name must DECLARE the sibling carrying each occurrence's own
      // relation; leaving it undeclared is what forced the pointer-string
      // rewrite this field replaced.
      {
        ...valid,
        targetResolution: 'record-name',
        targetKind: 'condition',
        relationField: undefined,
      },
      {
        ...valid,
        targetResolution: 'record-name',
        targetKind: 'condition',
        relationField: 'mechanics/relation',
      },
      // F2: `targetKind` used to go unvalidated here, so a typo would not
      // fail the build — it would silently masquerade as every occurrence's
      // target being absent (see the check's own doc comment in
      // `recordRelationships.ts`).
      {
        ...valid,
        targetResolution: 'record-name',
        targetKind: 'not-a-real-kind',
        relationField: 'relation',
      },
      { ...valid, relationField: 'relation' },
      {
        ...valid,
        disposition: 'not-a-reference',
        relation: undefined,
        targetResolution: undefined,
        relationField: 'relation',
      },
      [valid, valid],
    ])
      expect(() =>
        buildRecordRelationshipManifest(
          Array.isArray(bad) ? bad : ([bad] as never),
        ),
      ).toThrow();
  });
});

describe('F2: malformed declared data yields a typed indeterminate outcome, never emptiness', () => {
  it('value-not-a-string: a declared reference leaf whose emitted value is not a string', () => {
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
    const numeric = { ...source, data: { ...source.data, source: 42 } };
    const declaration = relationshipDeclarationForPointer(
      keyManifest,
      'feature',
      '/source',
    );
    expect(declaration).toBeDefined();
    expect(resolveRecordRelationships(keyManifest, numeric, stack)).toEqual([
      {
        outcome: 'indeterminate',
        sourceRecordKey: source.key,
        pointer: '/source',
        reason: 'value-not-a-string',
        rawValue: 42,
        declaration,
      },
    ]);
  });

  it('relation-sibling-not-a-string: the declared relation sibling exists but is not a string', () => {
    const nameManifest = buildRecordRelationshipManifest([
      {
        kind: 'action',
        pointerPrefix: '/mechanics/conditions/*/condition',
        linkField: 'data.mechanics.conditions',
        disposition: 'reference',
        relation: 'condition',
        targetResolution: 'record-name',
        targetKind: 'condition',
        relationField: 'relation',
        reason: 'test',
      },
    ]);
    const action = record('action:dodge');
    const numericRelation = {
      ...action,
      data: {
        mechanics: {
          conditions: [{ condition: 'incapacitated', relation: 7 }],
        },
      },
    };
    const declaration = relationshipDeclarationForPointer(
      nameManifest,
      'action',
      '/mechanics/conditions/*/condition',
    );
    expect(declaration).toBeDefined();
    expect(
      resolveRecordRelationships(nameManifest, numericRelation, stack),
    ).toEqual([
      {
        outcome: 'indeterminate',
        sourceRecordKey: action.key,
        pointer: '/mechanics/conditions/*/condition',
        reason: 'relation-sibling-not-a-string',
        rawValue: 7,
        declaration,
      },
    ]);
  });

  it('relation-not-recognized: the sibling is a string outside CONDITION_RELATION_VALUES', () => {
    const nameManifest = buildRecordRelationshipManifest([
      {
        kind: 'action',
        pointerPrefix: '/mechanics/conditions/*/condition',
        linkField: 'data.mechanics.conditions',
        disposition: 'reference',
        relation: 'condition',
        targetResolution: 'record-name',
        targetKind: 'condition',
        relationField: 'relation',
        reason: 'test',
      },
    ]);
    const action = record('action:dodge');
    const unrecognized = {
      ...action,
      data: {
        mechanics: {
          conditions: [
            { condition: 'incapacitated', relation: 'not-a-real-relation' },
          ],
        },
      },
    };
    const declaration = relationshipDeclarationForPointer(
      nameManifest,
      'action',
      '/mechanics/conditions/*/condition',
    );
    expect(declaration).toBeDefined();
    expect(
      resolveRecordRelationships(nameManifest, unrecognized, stack),
    ).toEqual([
      {
        outcome: 'indeterminate',
        sourceRecordKey: action.key,
        pointer: '/mechanics/conditions/*/condition',
        reason: 'relation-not-recognized',
        rawValue: 'not-a-real-relation',
        declaration,
      },
    ]);
  });
});

describe('F3: the bounded coverage gate is two-directional', () => {
  it('is bounded to exactly the seven historical shapes, never a corpus-wide claim', () => {
    expect(LEGACY_RELATIONSHIP_BEARING_POINTER_SHAPES).toEqual([
      '/source',
      '/parentClass',
      '/progressionTableRef',
      '/tableRefs/*',
      '/spellTableRefs/*',
      '/statBlockRefs/*',
      '/mechanics/conditions/*/condition',
    ]);
  });

  it('passes for the shipped manifest, which declares every bounded shape the pack emits', () => {
    expect(() =>
      assertRecordRelationshipDeclarationsCoverBoundedShapes(
        pack.records,
        manifest,
      ),
    ).not.toThrow();
  });

  it('catches an EMITTED bounded shape left with no declaration for its kind (the direction assertRecordRelationshipDeclarationsAreLive cannot see)', () => {
    const featureSource = manifest.declarations.find(
      (decl) => decl.kind === 'feature' && decl.pointerPrefix === '/source',
    );
    if (!featureSource)
      throw new Error('missing shipped (feature, /source) declaration');
    // The shipped pack still EMITS `/source` under `feature` (e.g.
    // feature:barbarian:ability-score-improvement); removing only its
    // declaration leaves every remaining declaration live —
    // `assertRecordRelationshipDeclarationsAreLive` would pass this manifest
    // — while the emitted occurrence itself now has no declaration at all.
    const withoutFeatureSource = buildRecordRelationshipManifest(
      manifest.declarations.filter((decl) => decl !== featureSource),
    );
    expect(() =>
      assertRecordRelationshipDeclarationsAreLive(
        pack.records,
        withoutFeatureSource,
      ),
    ).not.toThrow();
    expect(() =>
      assertRecordRelationshipDeclarationsCoverBoundedShapes(
        pack.records,
        withoutFeatureSource,
      ),
    ).toThrow(/feature\/source/);
  });
});

describe('F4: producer-qualified relationship-artifact state survives the durable trace', () => {
  it('reports a single present producer for an ordinary SRD-only run, surviving projectDiscoveryTrace and JSON round-trip', () => {
    const db = freshDbWithSession();
    try {
      const trace = runDiscoveryStages({
        db,
        stack,
        scenario: { playerInput: '', stateFields: {} },
      });
      const expected: readonly RelationshipArtifactState[] = [
        { packId: DND5E_SRD_PACK_ID, state: 'present' },
      ];
      expect(trace.expansion.relationshipArtifactByProducer).toEqual(expected);
      const roundTripped = JSON.parse(
        JSON.stringify(projectDiscoveryTrace(trace)),
      ) as ReturnType<typeof projectDiscoveryTrace>;
      expect(roundTripped.expansion.relationshipArtifactByProducer).toEqual(
        expected,
      );
    } finally {
      db.close();
    }
  });

  it('reports a single absent producer for a foreign base pack, surviving projectDiscoveryTrace and JSON round-trip', () => {
    const db = freshDbWithSession();
    try {
      const foreignBase: RulesPack = {
        ...pack,
        meta: { ...pack.meta, packId: 'rules:test-f4-foreign-base' },
      };
      const foreignStack = resolveRulesStack({ base: foreignBase });
      const trace = runDiscoveryStages({
        db,
        stack: foreignStack,
        scenario: { playerInput: '', stateFields: {} },
      });
      const expected: readonly RelationshipArtifactState[] = [
        { packId: 'rules:test-f4-foreign-base', state: 'absent' },
      ];
      expect(trace.expansion.relationshipArtifactByProducer).toEqual(expected);
      const roundTripped = JSON.parse(
        JSON.stringify(projectDiscoveryTrace(trace)),
      ) as ReturnType<typeof projectDiscoveryTrace>;
      expect(roundTripped.expansion.relationshipArtifactByProducer).toEqual(
        expected,
      );
    } finally {
      db.close();
    }
  });

  it('reports BOTH a present and an absent producer for a mixed stack, surviving projectDiscoveryTrace and JSON round-trip', () => {
    const db = freshDbWithSession();
    try {
      const template = pack.records.find((r) => r.kind === 'feature');
      if (!template) throw new Error('missing feature fixture');
      const foreignFeature: RulesRecord = {
        ...structuredClone(template),
        key: 'feature:test-f4-foreign',
        name: 'Test F4 Foreign Feature',
        data: { source: 'class:barbarian', level: 1 },
      };
      const foreignAddon: RulesPack = {
        meta: {
          ...pack.meta,
          packId: 'rules:test-f4-foreign-addon',
          role: 'addon',
          version: '1.0.0',
          order: 1,
          compatibleBaseSystems: [
            { systemId: pack.meta.systemId, versions: [pack.meta.version] },
          ],
        },
        records: [foreignFeature],
      };
      const mixedStack = resolveRulesStack({
        base: pack,
        addons: [foreignAddon],
      });
      const trace = runDiscoveryStages({
        db,
        stack: mixedStack,
        scenario: { playerInput: '', stateFields: {} },
      });
      // A single boolean could report only ONE of these two facts (see
      // `relationshipArtifactByProducer`'s doc comment) — this is exactly the
      // mixed-stack case it replaces the boolean to describe. Sorted by
      // packId, so `rules:dnd5e-srd-5.1` sorts before `rules:test-...`.
      const expected: readonly RelationshipArtifactState[] = [
        { packId: DND5E_SRD_PACK_ID, state: 'present' },
        { packId: 'rules:test-f4-foreign-addon', state: 'absent' },
      ];
      expect(trace.expansion.relationshipArtifactByProducer).toEqual(expected);
      const roundTripped = JSON.parse(
        JSON.stringify(projectDiscoveryTrace(trace)),
      ) as ReturnType<typeof projectDiscoveryTrace>;
      expect(roundTripped.expansion.relationshipArtifactByProducer).toEqual(
        expected,
      );
    } finally {
      db.close();
    }
  });
});

describe('F1: relationship declarations resolve per PRODUCING pack, not per stack', () => {
  const template = pack.records.find((r) => r.kind === 'feature');
  if (!template) throw new Error('missing feature fixture');

  function addonPack(
    packId: string,
    records: readonly RulesRecord[],
  ): RulesPack {
    return {
      meta: {
        ...pack.meta,
        packId,
        role: 'addon',
        version: '1.0.0',
        order: 1,
        compatibleBaseSystems: [
          { systemId: pack.meta.systemId, versions: [pack.meta.version] },
        ],
      },
      records,
    };
  }

  function syntheticFeature(key: string): RulesRecord {
    return {
      ...structuredClone(template as RulesRecord),
      key,
      name: `Test ${key}`,
      data: { source: 'class:barbarian', level: 1, description: 'synthetic' },
    };
  }

  const noManifestAddon = addonPack('rules:test-f1-no-manifest', [
    syntheticFeature('feature:test-f1-no-manifest'),
  ]);
  const ownManifestAddon = addonPack('rules:test-f1-own-manifest', [
    syntheticFeature('feature:test-f1-own-manifest'),
  ]);
  const ownManifest = buildRecordRelationshipManifest([
    {
      kind: 'feature',
      pointerPrefix: '/source',
      linkField: 'data.source',
      disposition: 'reference',
      relation: 'test-own-relation',
      targetResolution: 'record-key',
      reason:
        "Test fixture (F1 evidence c): declares this add-on's OWN semantics " +
        'for its synthetic feature.',
    },
  ]);
  const overrideRecord: RulesRecord = {
    ...structuredClone(record('feature:barbarian:ability-score-improvement')),
    data: { source: 'class:barbarian', level: 1 },
    overrides: [
      `${pack.meta.packId}/feature:barbarian:ability-score-improvement`,
    ],
  };
  const overridingAddon = addonPack('rules:test-f1-overriding', [
    overrideRecord,
  ]);
  const overridingManifest = buildRecordRelationshipManifest([
    {
      kind: 'feature',
      pointerPrefix: '/source',
      linkField: 'data.source',
      disposition: 'reference',
      relation: 'test-override-relation',
      targetResolution: 'record-key',
      reason:
        "Test fixture (F1 evidence d): the WINNING producer's own semantics " +
        'govern the override, never the base overrideChain producer.',
    },
  ]);

  const bundledSource = bundledDnd5eSrdRecordRelationshipManifestSource();
  function source(candidatePack: RulesPack) {
    if (candidatePack === ownManifestAddon) return ownManifest;
    if (candidatePack === overridingAddon) return overridingManifest;
    return bundledSource(candidatePack);
  }

  it('(a) a base SRD record resolves under the SRD manifest even alongside an unrelated add-on', () => {
    const evidenceStack = resolveRulesStack({
      base: pack,
      addons: [noManifestAddon],
    });
    const trace = expandTypedRelationships(
      [
        mustConsiderSeed(
          evidenceStack,
          'feature:barbarian:ability-score-improvement',
        ),
      ],
      evidenceStack,
      { relationshipManifestSource: source },
    );
    expect(trace.traversals).toContainEqual({
      sourceRecordKey: 'feature:barbarian:ability-score-improvement',
      linkField: 'data.source',
      relation: 'granted-by',
      targetRecordKey: 'class:barbarian',
    });
  });

  it('(b) an add-on with no manifest of its own does not inherit the SRD one; its absence is recorded', () => {
    const evidenceStack = resolveRulesStack({
      base: pack,
      addons: [noManifestAddon],
    });
    const trace = expandTypedRelationships(
      [mustConsiderSeed(evidenceStack, 'feature:test-f1-no-manifest')],
      evidenceStack,
      { relationshipManifestSource: source },
    );
    expect(trace.traversals).toEqual([]);
    expect(
      trace.relationshipResolutions.filter(
        (r) => r.sourceRecordKey === 'feature:test-f1-no-manifest',
      ),
    ).toEqual([]);
    expect(trace.relationshipArtifactByProducer).toContainEqual({
      packId: noManifestAddon.meta.packId,
      state: 'absent',
    });
  });

  it('(c) an add-on carrying its own differing manifest resolves under its own semantics', () => {
    const evidenceStack = resolveRulesStack({
      base: pack,
      addons: [ownManifestAddon],
    });
    const trace = expandTypedRelationships(
      [mustConsiderSeed(evidenceStack, 'feature:test-f1-own-manifest')],
      evidenceStack,
      { relationshipManifestSource: source },
    );
    expect(trace.traversals).toContainEqual({
      sourceRecordKey: 'feature:test-f1-own-manifest',
      linkField: 'data.source',
      relation: 'test-own-relation',
      targetRecordKey: 'class:barbarian',
    });
    expect(trace.relationshipArtifactByProducer).toContainEqual({
      packId: ownManifestAddon.meta.packId,
      state: 'present',
    });
  });

  it('(d) an overriding record is interpreted under the WINNING producer manifest, never overrideChain', () => {
    const evidenceStack = resolveRulesStack({
      base: pack,
      addons: [overridingAddon],
    });
    const winning = evidenceStack.recordsByKey.get(
      'feature:barbarian:ability-score-improvement',
    );
    // The stack mechanics this test relies on: the ADDON is the winning
    // producer, and the BASE it overrode is demoted to overrideChain.
    expect(winning?.pack).toBe(overridingAddon);
    expect(winning?.overrideChain).toHaveLength(1);
    expect(winning?.overrideChain[0]?.pack).toBe(pack);
    const trace = expandTypedRelationships(
      [
        mustConsiderSeed(
          evidenceStack,
          'feature:barbarian:ability-score-improvement',
        ),
      ],
      evidenceStack,
      { relationshipManifestSource: source },
    );
    // The WINNING producer's relation, and ONLY it — never the base
    // overrideChain producer's 'granted-by', proving semantics follow
    // `entry.pack`, not the record's kind/field shape alone.
    expect(trace.traversals).toEqual([
      {
        sourceRecordKey: 'feature:barbarian:ability-score-improvement',
        linkField: 'data.source',
        relation: 'test-override-relation',
        targetRecordKey: 'class:barbarian',
      },
    ]);
  });
});

describe('F6: an edge is resolved once per expansion pass, never duplicated within one pass', () => {
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
  const source = record('feature:barbarian:ability-score-improvement');
  const broken: RulesRecord = {
    ...source,
    data: {
      ...(source.data as Record<string, unknown>),
      source: 'class:does-not-exist',
    },
  };
  const brokenStack = resolveRulesStack({
    base: {
      ...pack,
      records: pack.records.map((r) => (r.key === source.key ? broken : r)),
    },
  });
  const brokenEntry = brokenStack.recordsByKey.get(source.key);
  if (!brokenEntry) throw new Error('missing broken fixture entry');
  // The candidate carries the EXACT entry object `brokenStack` holds — the
  // normal-case identity `resolveDiscoveryCandidates` produces in production.
  // A test whose candidate diverges from the stack's own entry (like the
  // "retains absent key" fixture above) cannot expose F6: the divergence
  // itself is what made the old duplicate invisible (see this describe
  // block's title and the F6 finding in eshyra-jgxl).
  const brokenCandidate = mustConsiderSeed(brokenStack, source.key);

  function unresolvedFor(
    trace: ReturnType<typeof expandTypedRelationships>,
  ): readonly RelationshipResolution[] {
    return trace.relationshipResolutions.filter(
      (r) =>
        r.outcome === 'unresolved-target' && r.sourceRecordKey === source.key,
    );
  }

  it('records exactly one unresolved resolution and one loss for a single unresolved declared edge', () => {
    const trace = expandTypedRelationships([brokenCandidate], brokenStack, {
      relationshipManifestSource: () => keyManifest,
    });
    const unresolved = unresolvedFor(trace);
    expect(unresolved).toEqual([
      {
        outcome: 'unresolved-target',
        sourceRecordKey: source.key,
        pointer: '/source',
        relation: 'granted-by',
        rawValue: 'class:does-not-exist',
        reason: 'no-record-with-key',
        declaration: relationshipDeclarationForPointer(
          keyManifest,
          'feature',
          '/source',
        ),
      },
    ]);
    const matchingLosses = trace.losses.filter(
      (loss) =>
        loss.reason === 'unresolved-typed-target' &&
        (loss.detail as { sourceRecordKey?: string }).sourceRecordKey ===
          source.key,
    );
    expect(matchingLosses).toHaveLength(1);
  });

  it('distinguishes a genuine second-pass repeat from duplicate work inside one pass', () => {
    // The harness's own two-pass architecture (design section 12.1) calls
    // `expandTypedRelationships` a SECOND time over the same stack. That is a
    // real, independent event and must produce its OWN resolution and loss —
    // never collapsed with the first call's, and never doubled within either
    // individual call.
    const firstPass = expandTypedRelationships([brokenCandidate], brokenStack, {
      relationshipManifestSource: () => keyManifest,
    });
    const secondPass = expandTypedRelationships(
      [brokenCandidate],
      brokenStack,
      {
        relationshipManifestSource: () => keyManifest,
        stageName: 'campaign-rule-expansion',
        conditional: true,
      },
    );
    expect(unresolvedFor(firstPass)).toHaveLength(1);
    expect(unresolvedFor(secondPass)).toHaveLength(1);
  });
});
