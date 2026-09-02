import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadAdventureModuleFromDir,
  loadRulesPackFromDirectory,
} from '../src/internal.js';
import {
  DIAGNOSTIC_FIXTURES,
  type DiagnosticSelector,
  type DiagnosticTarget,
  type RetainedFact,
  validateDiagnosticCorpus,
} from './diagnostics/index.js';

const PACK_DIR = join(
  process.cwd(),
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1',
);
const MODULE_DIR = join(
  process.cwd(),
  'packages/core/data/adventure-modules/eshyra_hollow-beneath-emberfall',
);

function jsonPointer(root: unknown, pointer: string): unknown {
  let current = root;
  for (const token of pointer.slice(1).split('/')) {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    if (typeof current !== 'object' || current === null || !(key in current))
      return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function stringsIn(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(stringsIn);
}

function findById(value: unknown, id: string): boolean {
  if (Array.isArray(value)) return value.some((item) => findById(item, id));
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(
    ([key, child]) =>
      ((key === 'id' || key === 'clauseId' || key === 'via') && child === id) ||
      findById(child, id),
  );
}

function recordForTarget(
  target: DiagnosticTarget,
  pack: ReturnType<typeof loadRulesPackFromDirectory>,
) {
  if (target.targetKind !== 'rules-record') return undefined;
  const record = pack.records.find(
    (candidate) => candidate.key === target.recordKey,
  );
  expect(record, `missing declared record ${target.recordKey}`).toBeDefined();
  expect(record?.provenance.sourceRef).toBe(target.sourceRef);
  expect(record?.provenance.locator).toBe(target.locator);
  return record;
}

function assertSelector(
  selector: DiagnosticSelector,
  record: ReturnType<typeof loadRulesPackFromDirectory>['records'][number],
): void {
  if (selector.kind === 'json-pointer') {
    expect(
      jsonPointer(record, selector.pointer),
      `${record.key} ${selector.pointer}`,
    ).not.toBeUndefined();
  } else if (selector.kind === 'source-text-predicate') {
    expect(
      stringsIn(record.data).some((text) =>
        text.includes(selector.exactSubstring),
      ),
      `${record.key} ${selector.description}`,
    ).toBe(true);
  } else if (selector.kind === 'ambiguity-id') {
    expect(
      findById(record.data, selector.id),
      `${record.key} ${selector.id}`,
    ).toBe(true);
  } else {
    expect(
      findById(record.data, selector.id),
      `${record.key} ${selector.id}`,
    ).toBe(true);
  }
}

function assertPackTarget(
  target: DiagnosticTarget,
  pack: ReturnType<typeof loadRulesPackFromDirectory>,
): void {
  if (target.targetKind === 'absent-rules-record') {
    expect(
      pack.records.some((record) => record.key === target.recordKey),
      target.reason,
    ).toBe(false);
    return;
  }
  if (target.targetKind !== 'rules-record') return;
  const record = recordForTarget(target, pack);
  if (record !== undefined && target.selector !== undefined)
    assertSelector(target.selector, record);
}

function assertFact(
  fact: RetainedFact,
  pack: ReturnType<typeof loadRulesPackFromDirectory>,
  adventure: ReturnType<typeof loadAdventureModuleFromDir>,
): void {
  // A fact with no targetRef is prose-only evidence. The contract rejects an
  // unanchored `exactSubstring`, so there is deliberately nothing to bind here:
  // matching such a substring against pack metadata would assert live pack
  // authority for a statement that claims to be historical.
  if (fact.targetRef === undefined) return;
  const record = pack.records.find(
    (candidate) => candidate.key === fact.targetRef,
  );
  if (record === undefined) {
    const [moduleId, entityRef] = fact.targetRef.split('#');
    const [entityKind, entityId] = entityRef?.split(':') ?? [];
    expect(moduleId).toBe(adventure.id);
    expect(
      (entityKind === 'location'
        ? adventure.locations
        : adventure.encounters
      ).some((entity) => entity.id === entityId),
      `missing retained-fact target ${fact.targetRef}`,
    ).toBe(true);
    return;
  }
  if (fact.exactSubstring !== undefined)
    expect(
      stringsIn(record.data).some((text) => text.includes(fact.exactSubstring)),
      fact.statement,
    ).toBe(true);
  if (fact.typedPath !== undefined) {
    const actual = jsonPointer(record, fact.typedPath);
    expect(actual, fact.statement).not.toBeUndefined();
    if (fact.expectedValue !== undefined)
      expect(actual, fact.statement).toEqual(fact.expectedValue);
  }
}

describe('ADR 0020 diagnostic fixture corpus', () => {
  const pack = loadRulesPackFromDirectory(PACK_DIR);
  const adventure = loadAdventureModuleFromDir(MODULE_DIR);

  it('validates the self-describing fixture contract and probe roster', () => {
    expect(validateDiagnosticCorpus(DIAGNOSTIC_FIXTURES)).toHaveLength(12);
    expect(DIAGNOSTIC_FIXTURES.map((fixture) => fixture.probeId)).toEqual(
      Array.from({ length: 12 }, (_, index) => `P${index + 1}`),
    );
  });

  it('keeps every declared pack, selector, module, and source-text identity current', () => {
    for (const fixture of DIAGNOSTIC_FIXTURES) {
      for (const target of [
        ...fixture.mustIncludeTargets,
        ...fixture.mayIncludeTargets,
        ...fixture.mustNotIncludeTargets,
      ]) {
        if (target.targetKind === 'adventure-entity') {
          expect(target.moduleId).toBe(adventure.id);
          const collection =
            adventure[`${target.entityKind}s` as 'locations' | 'encounters'];
          expect(
            collection.some((entity) => entity.id === target.entityId),
            `${fixture.probeId} ${target.entityId}`,
          ).toBe(true);
        } else {
          assertPackTarget(target, pack);
        }
      }
      const facts = fixture.requiredRetainedFacts;
      if (Array.isArray(facts))
        for (const fact of facts) assertFact(fact, pack, adventure);
      const relations = fixture.requiredRelationshipExpansion;
      if (Array.isArray(relations)) {
        for (const relation of relations) {
          const source = pack.records.find(
            (record) => record.key === relation.sourceRecordKey,
          );
          const target = pack.records.find(
            (record) => record.key === relation.targetRecordKey,
          );
          expect(source, relation.statement).toBeDefined();
          expect(target, relation.statement).toBeDefined();
          const relationValue = jsonPointer(
            source,
            `/${relation.linkField.replaceAll('.', '/')}`,
          );
          const relationFound =
            Array.isArray(relationValue) &&
            relationValue.some(
              (candidate) =>
                typeof candidate === 'object' &&
                candidate !== null &&
                'condition' in candidate &&
                'relation' in candidate &&
                (candidate as { condition?: unknown }).condition ===
                  relation.targetRecordKey.replace('condition:', '') &&
                (candidate as { relation?: unknown }).relation ===
                  relation.relation,
            );
          expect(relationFound, relation.statement).toBe(true);
        }
      }
    }
  });

  it('asserts the narrow P12 absence without pinning record counts or aggregating corpus figures', () => {
    expect(
      pack.records.some(
        (record) => record.key === 'table:starting-wealth-by-class',
      ),
    ).toBe(false);
  });
});
