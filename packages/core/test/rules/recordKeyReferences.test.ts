import { describe, expect, it } from 'vitest';
import type { RelationshipResolution } from '../../src/internal.js';
import {
  assertRecordRelationshipDeclarationsCoverBoundedShapes,
  buildRecordRelationshipManifest,
  bundledDnd5eSrdRecordRelationshipManifestSource,
  expandTypedRelationships,
  getBundledDnd5eSrdPack,
  getBundledDnd5eSrdRecordRelationshipManifest,
  RECORD_KEY_LEAF_KIND_POINTER_SHAPES,
  relationshipDeclarationForPointer,
  resolveRecordRelationships,
  resolveRulesStack,
} from '../../src/internal.js';
import { walkFieldPointers } from '../../src/rules/fieldProvenance.js';

// eshyra-ry69: the remaining record-key reference leaves.
const pack = getBundledDnd5eSrdPack();
const stack = resolveRulesStack({ base: pack });
const manifest = getBundledDnd5eSrdRecordRelationshipManifest();

function outcomes(key: string): readonly RelationshipResolution[] {
  const found = stack.recordsByKey.get(key);
  if (!found) throw new Error(`missing bundled record ${key}`);
  return resolveRecordRelationships(manifest, found.record, stack);
}

describe('record-key leaves are declared (eshyra-ry69)', () => {
  it('leaves no data leaf equal to a record key at an undeclared (kind, pointer)', () => {
    // The bead's deterministic predicate, run over the committed pack.
    const undeclared = new Set<string>();
    for (const record of pack.records)
      walkFieldPointers(record.data, (pointer, value) => {
        if (
          typeof value === 'string' &&
          stack.recordsByKey.has(value) &&
          relationshipDeclarationForPointer(manifest, record.kind, pointer) ===
            undefined
        )
          undeclared.add(`${record.kind}${pointer}`);
      });
    expect([...undeclared].sort()).toEqual([]);
  });

  it('emits and declares every enumerated gate shape', () => {
    const emitted = new Set<string>();
    for (const record of pack.records)
      walkFieldPointers(record.data, (pointer) => {
        emitted.add(`${record.kind}${pointer}`);
      });
    for (const shape of RECORD_KEY_LEAF_KIND_POINTER_SHAPES)
      expect(emitted.has(shape), shape).toBe(true);
    expect(() =>
      assertRecordRelationshipDeclarationsCoverBoundedShapes(
        pack.records,
        manifest,
      ),
    ).not.toThrow();
  });

  it('throws when an enumerated shape loses its declaration', () => {
    const without = buildRecordRelationshipManifest(
      manifest.declarations.filter(
        (declaration) =>
          !(
            declaration.kind === 'class' &&
            declaration.pointerPrefix === '/features/*'
          ),
      ),
    );
    expect(() =>
      assertRecordRelationshipDeclarationsCoverBoundedShapes(
        pack.records,
        without,
      ),
    ).toThrow(/class\/features\/\*/);
  });

  it('resolves or explicitly excludes every declared record-key occurrence', () => {
    const all = pack.records.flatMap((record) =>
      resolveRecordRelationships(manifest, record, stack),
    );
    const keyed = all.filter(
      (resolution) => resolution.declaration.targetResolution === 'record-key',
    );
    expect(keyed.length).toBeGreaterThan(1000);
    expect(
      keyed.filter(
        (resolution) =>
          resolution.outcome === 'unresolved-target' ||
          resolution.outcome === 'indeterminate',
      ),
    ).toEqual([]);
    // Every exclusion is a printed non-record: a leaf that is not a record
    // key, or a sibling-keyed category/kind whose values are names or ids.
    const excluded = keyed.filter(
      (resolution) => resolution.outcome === 'excluded',
    );
    for (const resolution of excluded)
      if (resolution.reason === 'leaf-value-exclusion')
        expect(stack.recordsByKey.has(resolution.rawValue)).toBe(false);
    const tableExclusions = new Set(
      excluded.flatMap((resolution) =>
        resolution.reason === 'relation-table-exclusion'
          ? [
              `${resolution.declaration.kind}|${resolution.declaration.pointerPrefix}|${resolution.relationFieldValue}`,
            ]
          : [],
      ),
    );
    expect([...tableExclusions].sort()).toEqual([
      'ancestry|/choices/*/from/*|language',
      'ancestry|/choices/*/from/*|skill',
      'ancestry|/choices/*/from/*|tool',
      'feature|/choices/*/from/*|asiOrFeat',
      'feature|/choices/*/from/*|favoredEnemy',
      'feature|/choices/*/from/*|fightingStyle',
      'feature|/choices/*/from/*|invocation',
      'feature|/choices/*/from/*|language',
      'feature|/choices/*/from/*|metamagic',
      'feature|/choices/*/from/*|naturalExplorer',
      'feature|/choices/*/from/*|other',
      'feature|/choices/*/from/*|skill',
      'feature|/choices/*/options/*/prerequisites/*/ref|pactBoon',
    ]);
  });

  it('separates mixed shapes truthfully instead of excluding them wholesale', () => {
    const find = (key: string, pointer: string) =>
      outcomes(key).filter((resolution) => resolution.pointer === pointer);
    // Ancestry choices: the cantrip list resolves to spells; language and
    // skill lists are printed names.
    expect(
      find('ancestry:high-elf', '/choices/*/from/*').map((r) => r.outcome),
    ).toEqual([...Array(14).fill('resolved'), ...Array(8).fill('excluded')]);
    expect(
      find('ancestry:half-elf', '/choices/*/from/*').every(
        (r) => r.outcome === 'excluded',
      ),
    ).toBe(true);
    // Feature choices: the subclass list resolves; ability names do not.
    expect(find('feature:barbarian:primal-path', '/choices/*/from/*')).toEqual([
      expect.objectContaining({
        outcome: 'resolved',
        relation: 'choice-option',
        targetRecordKey: 'subclass:path-of-the-berserker',
      }),
    ]);
    // Invocation prerequisites: the cantrip ref resolves, the pact option id
    // is excluded while its featureRef resolves.
    const invocations = outcomes('feature:warlock:eldritch-invocations');
    const prereqRefs = invocations.filter(
      (r) => r.pointer === '/choices/*/options/*/prerequisites/*/ref',
    );
    expect(prereqRefs.map((r) => r.outcome).sort()).toEqual([
      ...Array(5).fill('excluded'),
      ...Array(3).fill('resolved'),
    ]);
    expect(
      invocations.filter(
        (r) =>
          r.pointer === '/choices/*/options/*/prerequisites/*/featureRef' &&
          r.outcome === 'resolved',
      ),
    ).toHaveLength(5);
    // Curse and effect lists: the prose entry is excluded, the spell is not.
    expect(
      find('magic-item:armor-of-vulnerability', '/mechanics/curse/endedBy/*'),
    ).toEqual([
      expect.objectContaining({
        outcome: 'resolved',
        relation: 'ended-by',
        targetRecordKey: 'spell:remove-curse',
      }),
      expect.objectContaining({
        outcome: 'excluded',
        reason: 'leaf-value-exclusion',
        rawValue: 'similar magic',
      }),
    ]);
    expect(
      find(
        'magic-item:dust-of-sneezing-and-choking',
        '/mechanics/effects/*/endsOn/*',
      ).map((r) => [r.outcome, 'rawValue' in r ? r.rawValue : undefined]),
    ).toContainEqual(['excluded', 'successful-repeat-save']);
    expect(
      find(
        'magic-item:dust-of-sneezing-and-choking',
        '/mechanics/effects/*/endsOn/*',
      ),
    ).toContainEqual(
      expect.objectContaining({
        outcome: 'resolved',
        relation: 'ended-by',
        targetRecordKey: 'spell:lesser-restoration',
      }),
    );
  });

  it('carries the execution-readiness back-pointer as not-a-reference, with its keys declared at the structured field', () => {
    for (const record of pack.records) {
      if (record.kind !== 'magic-item') continue;
      const data = record.data as {
        tableRefs?: string[];
        statBlockRefs?: string[];
        executionReadiness?: {
          clauses?: { representation?: { ref?: string } }[];
        };
      };
      const declared = new Set([
        ...(data.tableRefs ?? []),
        ...(data.statBlockRefs ?? []),
      ]);
      for (const clause of data.executionReadiness?.clauses ?? []) {
        const ref = clause.representation?.ref;
        if (ref !== undefined && stack.recordsByKey.has(ref))
          expect(declared.has(ref), `${record.key} ${ref}`).toBe(true);
      }
    }
    expect(
      relationshipDeclarationForPointer(
        manifest,
        'magic-item',
        '/executionReadiness/clauses/*/representation/ref',
      )?.disposition,
    ).toBe('not-a-reference');
  });
});

// One discovery regression per newly traversed relation family: the edge is
// resolved against the printed source and one-hop expansion follows it.
const FAMILIES: readonly (readonly [
  source: string,
  pointer: string,
  relation: string,
  target: string,
])[] = [
  [
    'class:cleric',
    '/features/*',
    'class-feature',
    'feature:cleric:spellcasting',
  ],
  [
    'class:barbarian',
    '/progression/*/advancement/*/ref',
    'granted-feature',
    'feature:barbarian:rage',
  ],
  [
    'class:cleric',
    '/progression/*/advancement/*/targetRefs/*',
    'improved-feature',
    'feature:cleric:divine-intervention',
  ],
  [
    'class:barbarian',
    '/startingEquipment/entries/*/options/*/grants/*/ref',
    'starting-equipment',
    'equipment:greataxe',
  ],
  [
    'background:acolyte',
    '/equipmentGrants/*/ref',
    'starting-equipment',
    'equipment:clothes-common',
  ],
  [
    'equipment:burglars-pack',
    '/contents/*/ref',
    'pack-contents',
    'equipment:backpack',
  ],
  [
    'subclass:champion',
    '/features/*',
    'subclass-feature',
    'feature:champion:improved-critical',
  ],
  ['ancestry:dwarf', '/subraces/*', 'has-subrace', 'ancestry:hill-dwarf'],
  ['ancestry:high-elf', '/subraceOf', 'subrace-of', 'ancestry:elf'],
  [
    'ancestry:high-elf',
    '/choices/*/from/*',
    'choice-option',
    'spell:acid-splash',
  ],
  [
    'ancestry:high-elf',
    '/choices/*/extension/ruleRef',
    'governing-rule',
    'rule:languages',
  ],
  [
    'ancestry:tiefling',
    '/traits/*/mechanics/spellGrants/*/spell',
    'granted-spell',
    'spell:hellish-rebuke',
  ],
  [
    'feature:barbarian:primal-path',
    '/choices/*/from/*',
    'choice-option',
    'subclass:path-of-the-berserker',
  ],
  [
    'feature:bard:spellcasting',
    '/choices/*/from/classLists/*',
    'spell-list-class',
    'class:bard',
  ],
  [
    'feature:warlock:eldritch-invocations',
    '/choices/*/options/*/prerequisites/*/ref',
    'prerequisite-spell',
    'spell:eldritch-blast',
  ],
  [
    'feature:warlock:eldritch-invocations',
    '/choices/*/options/*/prerequisites/*/featureRef',
    'prerequisite-feature',
    'feature:warlock:pact-boon',
  ],
  [
    'feature:warlock:pact-boon',
    '/choices/*/options/*/summonFormExtensions/*/forms/*/creatureRef',
    'creation-form',
    'creature:imp',
  ],
  [
    'feature:oath-of-devotion:purity-of-spirit',
    '/mechanics/effects/*/spell',
    'permanent-spell-effect',
    'spell:protection-from-evil-and-good',
  ],
  [
    'feature:bard:font-of-inspiration',
    '/mechanics/resources/*/appliesTo',
    'resource-applies-to',
    'feature:bard:bardic-inspiration',
  ],
  [
    'magic-item:amulet-of-the-planes',
    '/mechanics/effects/*/spellRef',
    'effect-spell',
    'spell:plane-shift',
  ],
  [
    'magic-item:armor-of-vulnerability',
    '/mechanics/curse/endedBy/*',
    'ended-by',
    'spell:remove-curse',
  ],
  [
    'magic-item:sovereign-glue',
    '/mechanics/effects/*/removableOnlyBy/*',
    'removable-only-by',
    'magic-item:universal-solvent',
  ],
  [
    'magic-item:oil-of-slipperiness',
    '/mechanics/interItem/counters/*/targetRef',
    'inter-item-counter',
    'magic-item:sovereign-glue',
  ],
  [
    'magic-item:bag-of-holding',
    '/mechanics/interItem/nestingHazard/withItemRefs/*',
    'nesting-hazard',
    'magic-item:portable-hole',
  ],
  [
    'magic-item:bag-of-tricks',
    '/mechanics/entityGrant/grants/*/creatureRefs/*',
    'granted-creature',
    'creature:weasel',
  ],
  [
    'magic-item:apparatus-of-the-crab',
    '/mechanics/effects/*/tableRef',
    'table-reference',
    'table:apparatus-of-the-crab-levers',
  ],
  [
    'spell:animate-dead',
    '/mechanics/effects/*/creation/outcomes/*/resultRef',
    'creation-form',
    'creature:skeleton',
  ],
  [
    'spell:control-weather',
    '/mechanics/effects/*/tableRefs/*',
    'table-reference',
    'table:precipitation',
  ],
  [
    'table:indefinite-madness',
    '/projection/sourceRuleRef',
    'source-rule',
    'rule:madness-effects',
  ],
];

describe('newly traversed record-key relation families (eshyra-ry69)', () => {
  it.each(FAMILIES)(
    '%s %s resolves to %s -> %s',
    (source, pointer, relation, target) => {
      expect(outcomes(source)).toContainEqual(
        expect.objectContaining({
          outcome: 'resolved',
          pointer,
          relation,
          targetRecordKey: target,
        }),
      );
    },
  );

  it.each(FAMILIES)(
    'one-hop expansion from %s %s follows %s to %s',
    (source, pointer, relation, target) => {
      const entry = stack.recordsByKey.get(source);
      if (!entry) throw new Error(`missing ${source}`);
      const linkField = relationshipDeclarationForPointer(
        manifest,
        entry.record.kind,
        pointer,
      )?.linkField;
      const trace = expandTypedRelationships(
        [
          {
            candidateKey: source,
            targetKind: 'rules-record' as const,
            entry,
            routes: [
              {
                routeClass: 'direct-state-ref' as const,
                trigger: 'test',
                evidence: {},
                signalId: 'record-key-reference-test',
              },
            ],
            traversals: [],
            campaignRules: [],
            campaignRulings: [],
          },
        ],
        stack,
        {
          relationshipManifestSource:
            bundledDnd5eSrdRecordRelationshipManifestSource(),
        },
      );
      expect(trace.traversals).toContainEqual({
        sourceRecordKey: source,
        linkField,
        relation,
        targetRecordKey: target,
      });
    },
  );
});

describe('sibling-keyed record-key declarations (eshyra-ry69)', () => {
  const declaration = {
    kind: 'feature' as const,
    pointerPrefix: '/choices/*/from/*',
    linkField: 'data.choices[].from',
    disposition: 'reference' as const,
    targetResolution: 'record-key' as const,
    relationField: '../category',
    relationByFieldValue: { subclass: 'choice-option', skill: null },
    reason: 'synthetic',
  };

  it('requires a relation table beside a record-key relationField', () => {
    expect(() => buildRecordRelationshipManifest([declaration])).not.toThrow();
    expect(() =>
      buildRecordRelationshipManifest([
        { ...declaration, relationByFieldValue: undefined, relation: 'x' },
      ]),
    ).toThrow(/relationByFieldValue/);
  });

  it('types an unlisted sibling value as indeterminate, never skipped', () => {
    const base = stack.recordsByKey.get('feature:barbarian:primal-path');
    if (!base) throw new Error('missing record');
    const found = resolveRecordRelationships(
      buildRecordRelationshipManifest([declaration]),
      {
        ...base.record,
        data: {
          choices: [
            { category: 'subclass', from: ['subclass:champion'] },
            { category: 'skill', from: ['Arcana'] },
            { category: 'surprise', from: ['x'] },
          ],
        },
      },
      stack,
    );
    expect(found.map((item) => item.outcome)).toEqual([
      'resolved',
      'excluded',
      'indeterminate',
    ]);
  });
});
