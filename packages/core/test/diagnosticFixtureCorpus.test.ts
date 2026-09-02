import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadAdventureModuleFromDir,
  loadRulesPackFromDirectory,
} from '../src/internal.js';
import {
  DIAGNOSTIC_FIXTURES,
  type DiagnosticFixture,
  type DiagnosticSelector,
  type DiagnosticTarget,
  type RetainedFact,
  validateDiagnosticCorpus,
} from './diagnostics/index.js';
import {
  CURSED_ATTUNEMENT_ADDON_PACK_ID,
  CURSED_ATTUNEMENT_ADDON_VERSION,
  CURSED_ATTUNEMENT_OVERRIDDEN_ITEM_REF,
} from './support/cursedAttunementAddon.js';

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

function recordData(record: { data: unknown }): Record<string, unknown> {
  return record.data as Record<string, unknown>;
}

function recordsWithId(value: unknown, key: string, id: string): boolean {
  if (!Array.isArray(value)) return false;
  return value.some(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      (item as Record<string, unknown>)[key] === id,
  );
}

function hasKeyValue(value: unknown, key: string, expected: string): boolean {
  if (Array.isArray(value))
    return value.some((item) => hasKeyValue(item, key, expected));
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(
    ([childKey, child]) =>
      (childKey === key && child === expected) ||
      hasKeyValue(child, key, expected),
  );
}

function hasAmbiguity(record: { data: unknown }, id: string): boolean {
  const data = recordData(record);
  const mechanics = data.mechanics as Record<string, unknown> | undefined;
  return recordsWithId(mechanics?.ambiguities, 'id', id);
}

function hasStableId(
  record: { data: unknown },
  idKind: 'operation' | 'clause',
  id: string,
): boolean {
  const data = recordData(record);
  const mechanics = data.mechanics as Record<string, unknown> | undefined;
  if (idKind === 'operation')
    return (
      recordsWithId(mechanics?.operations, 'id', id) ||
      recordsWithId(
        (mechanics?.stateMachine as Record<string, unknown> | undefined)
          ?.transitions,
        'via',
        id,
      )
    );
  return hasKeyValue(data, 'clauseId', id);
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
      hasAmbiguity(record, selector.id),
      `${record.key} ${selector.id}`,
    ).toBe(true);
  } else {
    expect(
      hasStableId(record, selector.idKind, selector.id),
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
      for (const execution of fixture.executions) {
        const ambiguityState = execution.expectedAmbiguityState;
        if (ambiguityState.kind !== 'ambiguities') continue;
        for (const expectation of ambiguityState.expectations) {
          const record = pack.records.find(
            (candidate) =>
              candidate.key ===
              fixture.mustIncludeTargets.find(
                (target) =>
                  target.targetKind === 'rules-record' &&
                  hasAmbiguity(candidate, expectation.ambiguityId),
              )?.recordKey,
          );
          expect(record, expectation.statement).toBeDefined();
          const ambiguities = (
            recordData(record as { data: unknown }).mechanics as Record<
              string,
              unknown
            >
          ).ambiguities as readonly Record<string, unknown>[];
          const ambiguity = ambiguities.find(
            (candidate) => candidate.id === expectation.ambiguityId,
          );
          expect(ambiguity, expectation.statement).toBeDefined();
          const interpretations = ambiguity?.interpretations;
          for (const interpretationId of expectation.interpretationIds)
            expect(
              recordsWithId(interpretations, 'id', interpretationId),
              `${fixture.probeId} ${expectation.ambiguityId} ${interpretationId}`,
            ).toBe(true);
          if (
            execution.campaignRuleState.kind === 'none' &&
            expectation.expectedResolution === 'unresolved'
          )
            expect(ambiguity?.canonicalResolution).toBeNull();
        }
      }
    }
  });

  it('keeps P7 executions independently falsifiable and capability-blocked', () => {
    const p7 = DIAGNOSTIC_FIXTURES.find((fixture) => fixture.probeId === 'P7');
    expect(p7).toBeDefined();
    const executions = p7?.executions ?? [];
    const withoutRuling = executions.find(
      (execution) => execution.executionId === 'without-active-ruling',
    );
    const withRuling = executions.find(
      (execution) => execution.executionId === 'with-active-ruling',
    );
    expect(withoutRuling?.campaignRuleState.kind).toBe('none');
    expect(
      withoutRuling?.expectedRouteClasses.some((route) =>
        route.routes.includes('campaign-ruling'),
      ),
    ).toBe(false);
    expect(withoutRuling?.expectedAmbiguityState).toMatchObject({
      kind: 'ambiguities',
      expectations: [{ expectedResolution: 'unresolved' }],
    });
    expect(withRuling?.campaignRuleState).toMatchObject({
      source: 'eshyra-jhpt',
      scope: 'ambiguity:cube-of-force-same-face-duration-reset',
    });
    expect(
      withRuling?.expectedRouteClasses.some((route) =>
        route.routes.includes('campaign-ruling'),
      ),
    ).toBe(true);
    expect(withRuling?.expectedCampaignRuleOrRulingState).toMatchObject({
      cases: [
        {
          ruleIdentity: 'supplied by eshyra-jhpt at runtime',
          provenance: 'eshyra-jhpt campaign-rule read interface',
        },
      ],
    });
    expect(withRuling?.oracleSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'jhpt-active-ruling' }),
      ]),
    );
    expect(
      executions.every(
        (execution) => execution.expectedCapabilityStatus.status === 'blocked',
      ),
    ).toBe(true);
  });

  it('binds P11 synthetic identity declarations to its producer fixture', () => {
    const p11 = DIAGNOSTIC_FIXTURES.find(
      (fixture) => fixture.probeId === 'P11',
    );
    expect(p11?.campaignState).toMatchObject({
      selectedRecord: CURSED_ATTUNEMENT_OVERRIDDEN_ITEM_REF,
      campaignRulesBinding: {
        addons: [
          {
            packId: CURSED_ATTUNEMENT_ADDON_PACK_ID,
            version: CURSED_ATTUNEMENT_ADDON_VERSION,
          },
        ],
      },
    });
  });

  it('rejects adversarial mutations of the diagnostic contract and identity gate', () => {
    const fixture = (): DiagnosticFixture[] =>
      JSON.parse(JSON.stringify(DIAGNOSTIC_FIXTURES)) as DiagnosticFixture[];
    const expectInvalid = (mutated: DiagnosticFixture[]) =>
      expect(() => validateDiagnosticCorpus(mutated)).toThrow();
    const expectIdentityInvalid = (mutated: DiagnosticFixture[]) => {
      validateDiagnosticCorpus(mutated);
      const target = mutated[2]?.mustIncludeTargets[0];
      if (
        target?.targetKind !== 'rules-record' ||
        target.selector === undefined
      )
        throw new Error('P3 selector fixture missing');
      expect(() => assertPackTarget(target, pack)).toThrow();
    };

    const wrongSelectorKind = fixture();
    const wrongTarget = wrongSelectorKind[2]?.mustIncludeTargets[0];
    if (
      wrongTarget?.targetKind !== 'rules-record' ||
      wrongTarget.selector?.kind !== 'json-pointer'
    )
      throw new Error('P3 selector fixture missing');
    wrongTarget.selector = {
      kind: 'stable-id',
      idKind: 'clause',
      id: '/data/actions/5',
    };
    expectIdentityInvalid(wrongSelectorKind);

    const staleIdentity = fixture();
    const staleTarget = staleIdentity[2]?.mustIncludeTargets[0];
    if (
      staleTarget?.targetKind !== 'rules-record' ||
      staleTarget.selector?.kind !== 'json-pointer'
    )
      throw new Error('P3 selector fixture missing');
    staleTarget.selector = {
      kind: 'json-pointer',
      pointer: '/data/actions/999',
    };
    expectIdentityInvalid(staleIdentity);

    const missingRoute = fixture();
    missingRoute[4]?.executions[0]?.expectedRouteClasses.splice(0, 1);
    expectInvalid(missingRoute);
    const missingProbe = fixture();
    missingProbe.pop();
    expectInvalid(missingProbe);
    const duplicateProbe = fixture();
    if (duplicateProbe[1] !== undefined) duplicateProbe[1].probeId = 'P1';
    expectInvalid(duplicateProbe);
    const duplicateExecution = fixture();
    if (duplicateExecution[6] !== undefined)
      duplicateExecution[6].executions[1].executionId = 'without-active-ruling';
    expectInvalid(duplicateExecution);
    const unanchoredSubstring = fixture();
    const fact = unanchoredSubstring[0]?.requiredRetainedFacts;
    if (!Array.isArray(fact)) throw new Error('P1 facts missing');
    fact[0].targetRef = undefined;
    expectInvalid(unanchoredSubstring);
    const unknownRoute = fixture();
    const route = unknownRoute[0]?.executions[0]?.expectedRouteClasses[0];
    if (route === undefined) throw new Error('P1 route missing');
    route.routes = ['unknown-route'] as never;
    expectInvalid(unknownRoute);
    const unlabelledOracle = fixture();
    const signal = unlabelledOracle[6]?.executions[1]?.oracleSignals[0];
    if (signal === undefined) throw new Error('P7 oracle signal missing');
    signal.label = '';
    expectInvalid(unlabelledOracle);
    const noRulingRoute = fixture();
    const noRuling = noRulingRoute[6]?.executions[0];
    if (noRuling === undefined) throw new Error('P7 execution missing');
    noRuling.expectedRouteClasses[0]?.routes.push('campaign-ruling');
    expectInvalid(noRulingRoute);
  });

  it('asserts the narrow P12 absence without pinning record counts or aggregating corpus figures', () => {
    expect(
      pack.records.some(
        (record) => record.key === 'table:starting-wealth-by-class',
      ),
    ).toBe(false);
  });
});
