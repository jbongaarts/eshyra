import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertRuleDispositions,
  buildRuleDispositionReport,
  ENGINE_PROCEDURE_COVERAGE,
  materializeEngineProcedureCoverage,
  RULE_DETERMINISTIC_CAPABILITY_BINDINGS,
  RULE_DETERMINISTIC_CAPABILITY_CONTRACTS,
  RULE_DETERMINISTIC_CAPABILITY_DISPOSITIONS,
  RULE_DISPOSITIONS,
  type RuleDisposition,
  type RuleProcedureCoverage,
  requireRuleDeterministicCapabilityContract,
  validateRuleDeterministicCapabilityContracts,
  validateRuleDeterministicCapabilityInput,
  validateRuleDispositionIdentity,
  validateRuleRegistries,
} from '../scripts/create-dnd5e-srd-audit-bundle/ruleDispositions.js';
import {
  getBundledDnd5eSrdPack,
  type RulesPack,
  type RulesPackLicense,
  type RulesRecord,
} from '../src/internal.js';
import {
  ENGINE_CAPABILITY_GAPS,
  RULE_KNOWN_LIMITS,
} from '../src/rules/ruleKnownLimits.js';

/**
 * Committed-pack + registry-integrity assertions for the
 * eshyra-o9bd.18.7.8.1 rule-record disposition & engine-procedure coverage
 * layer. Pins the exact census from the 2026-07-06 rule-classification and
 * execution-boundary artifacts so drift is a reviewed diff, and exercises
 * every fail-closed validation mode named in the design doc §6.
 */

const LICENSE: RulesPackLicense = {
  licenseClass: 'open',
  licenseName: 'CC-BY-4.0',
  attributionText: 'fixture',
  requiresAttribution: true,
  commercialUseAllowed: true,
  hostedUseAllowed: true,
  redistributionAllowed: true,
  publicSharingAllowed: true,
  derivativeAllowed: true,
  containsUserSuppliedText: false,
  containsTrademarkedSettingMaterial: false,
  sourceMaterialDescription: 'fixture',
  provenancePolicy: 'fixture',
  outputRestrictions: 'fixture',
};

function ruleRecord(
  key: string,
  data: unknown = { text: 'fixture' },
): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'rule',
    key,
    name: key,
    data,
    source: 'fixture',
    license: LICENSE,
    provenance: { sourceRef: 'fixture', locator: 'p. 1' },
  };
}

function actionRecord(
  key: string,
  data: unknown = { description: 'fixture' },
): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'action',
    key,
    name: key,
    data,
    source: 'fixture',
    license: LICENSE,
    provenance: { sourceRef: 'fixture', locator: 'p. 1' },
  };
}

function pack(records: readonly RulesRecord[]): RulesPack {
  return {
    meta: {
      packId: 'rules:dnd5e-srd-5.1',
      title: 'Fixture',
      description: 'Fixture pack.',
      role: 'base',
      systemId: 'dnd5e-srd',
      version: '5.1',
      license: LICENSE,
    },
    records,
  };
}

describe('rule-record disposition registry (eshyra-o9bd.18.7.8.1)', () => {
  it('rejects an equal-size rule-class reclassification by identity', () => {
    const changed = {
      ...RULE_DISPOSITIONS,
      'rule:a-legendary-creatures-lair': {
        ...RULE_DISPOSITIONS['rule:a-legendary-creatures-lair'],
        class: 'definition' as const,
      },
      'rule:wisdom': {
        ...RULE_DISPOSITIONS['rule:wisdom'],
        class: 'reference-prose' as const,
      },
    };

    expect(Object.keys(changed)).toHaveLength(
      Object.keys(RULE_DISPOSITIONS).length,
    );
    expect(validateRuleDispositionIdentity(changed)).toContainEqual(
      expect.stringContaining('rule disposition identity drift'),
    );
  });

  it('pins the exact 335-key semantic census against the committed pack', () => {
    expect(assertRuleDispositions(getBundledDnd5eSrdPack())).toEqual([]);
    const report = buildRuleDispositionReport();
    expect(report.referencesProse).toBe(96);
    expect(report.definitions).toBe(33);
    expect(report.tableBacked).toBe(19);
    expect(report.duplicates).toBe(12);
    // Coverage counts move as engine families land (F6, eshyra-2n1t.8 moved
    // four unimplemented rows and healing to implemented, and
    // stabilizing-a-creature to implemented; F2, eshyra-2n1t.4 moved the five
    // action-economy rows to implemented; F5, eshyra-2n1t.7 moved
    // limited-usage, legendary-actions, attunement, and gaining-inspiration
    // to implemented and using-inspiration to partial; F1+F9,
    // eshyra-2n1t.3 + eshyra-2n1t.11 moved the 16 fully-tool-owned
    // dice-grammar / resolution / derived-math rows to implemented and 9
    // clause-only rows to model-adjudicated-supported; F4, eshyra-2n1t.6,
    // implements spell-slot expenditure/recovery; F3, eshyra-2n1t.5 moved
    // concentration to implemented). The F-09 vertical slice replaced the
    // hand-maintained status census with the identity assertions below.
    expect(
      ENGINE_PROCEDURE_COVERAGE['rule:long-rest']?.implementation,
    ).toBeDefined();
    expect(
      ENGINE_PROCEDURE_COVERAGE['rule:short-rest']?.implementation,
    ).toBeDefined();
    for (const key of ['rule:feats', 'rule:customizing-a-background'])
      expect(ENGINE_PROCEDURE_COVERAGE[key]?.implementation).toBeDefined();
    expect(
      ENGINE_PROCEDURE_COVERAGE['rule:experience-points']?.knownLimits[0]
        ?.limit,
    ).toBe('deferred');
    expect(ENGINE_PROCEDURE_COVERAGE['rule:blindsight']).toEqual({
      knownLimits: [],
    });
    expect(
      ENGINE_PROCEDURE_COVERAGE['rule:suffocating']?.knownLimits[0]?.limit,
    ).toBe('partial');
    expect(Object.keys(RULE_DISPOSITIONS)).toHaveLength(335);
    expect(Object.keys(ENGINE_PROCEDURE_COVERAGE)).toHaveLength(175);
  });

  it('projects runtime statement rows by object identity into the audit', () => {
    // One definition per dataset (design invariant 5): each migrated audit row
    // points at the runtime entry itself, never at an authored copy.
    for (const [key, limits] of Object.entries(RULE_KNOWN_LIMITS)) {
      expect(ENGINE_PROCEDURE_COVERAGE[key]?.knownLimits).toBe(limits);
      limits.forEach((limit, index) => {
        expect(ENGINE_PROCEDURE_COVERAGE[key]?.knownLimits[index]).toBe(limit);
      });
    }
    expect(
      ENGINE_PROCEDURE_COVERAGE['rule:channel-divinity']?.knownLimits[0]
        ?.findingId,
    ).toBe('engine-capability-ownership');
  });

  it('projects implementation and every limit independently', () => {
    const implementation = Object.freeze({
      runtimeOwner: ['fixture.ts'],
      evidence: ['fixture.test.ts'],
    });
    const partial = Object.freeze({
      limit: 'partial' as const,
      statement: 'Eshyra does not track the remaining duration.',
      findingId: 'readiness-integrity',
    });
    const deferred = Object.freeze({
      limit: 'deferred' as const,
      statement: 'Multiclass progression is deferred.',
      findingId: 'engine-capability-ownership',
      designOwner: 'eshyra-2n1t.1',
    });
    const limits = Object.freeze([partial, deferred]);
    const coverage = materializeEngineProcedureCoverage(
      { 'rule:fixture': implementation },
      {
        procedureKeys: ['rule:fixture', 'rule:empty'],
        knownLimits: { 'rule:fixture': limits },
      },
    );
    expect(coverage['rule:fixture']?.implementation).toBe(implementation);
    expect(coverage['rule:fixture']?.knownLimits).toBe(limits);
    expect(coverage['rule:fixture']?.knownLimits[0]).toBe(partial);
    expect(coverage['rule:fixture']?.knownLimits[1]).toBe(deferred);
    expect(coverage['rule:empty']).toEqual({ knownLimits: [] });
    const report = buildRuleDispositionReport(coverage);
    expect(report.engineProcedure).toMatchObject({
      implementation: 1,
      noRuntimeStatement: 1,
    });
    expect(report.engineProcedure.knownLimits.partial).toContainEqual({
      key: 'rule:fixture',
      statement: partial.statement,
      findingId: partial.findingId,
    });
    expect(report.engineProcedure.knownLimits.deferred).toContainEqual({
      key: 'rule:fixture',
      statement: deferred.statement,
      findingId: deferred.findingId,
      designOwner: deferred.designOwner,
    });
  });

  it('projects source procedures without runtime entries as no statement', () => {
    const coverage = materializeEngineProcedureCoverage(
      {},
      {
        procedureKeys: ['rule:fixture'],
        knownLimits: {},
      },
    );
    expect(coverage['rule:fixture']).toEqual({ knownLimits: [] });
    expect(
      buildRuleDispositionReport(coverage).engineProcedure.noRuntimeStatement,
    ).toBe(1);
  });

  it('keeps runtime statements distinct from eight-word source passages', () => {
    const records = new Map(
      getBundledDnd5eSrdPack().records.map((record) => [record.key, record]),
    );
    const words = (text: string) =>
      text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    const violations: string[] = [];
    for (const [key, limits] of Object.entries(RULE_KNOWN_LIMITS)) {
      const statements = limits.map((limit) => limit.statement);
      const record = records.get(key);
      if (record === undefined)
        throw new Error(`missing committed record ${key}`);
      const data = record.data as { text?: string; description?: string };
      const source = words(data.text ?? data.description ?? '');
      const sourceWindows = new Set(
        source
          .slice(0, -7)
          .map((_, index) => source.slice(index, index + 8).join(' ')),
      );
      for (const statement of statements) {
        const statementWords = words(statement);
        for (let index = 0; index + 8 <= statementWords.length; index++) {
          const window = statementWords.slice(index, index + 8).join(' ');
          if (sourceWindows.has(window)) violations.push(`${key}: ${window}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('removes the landed retained-check gap from the A5 report', () => {
    // The retained-check operation now owns this mechanical step; its bounded
    // known-limit text remains, while the blocking capability gap is gone.
    const report = buildRuleDispositionReport();
    const expected = Object.entries(RULE_KNOWN_LIMITS)
      .flatMap(([key, limits]) =>
        limits.flatMap((limit) =>
          (limit.capabilityGaps ?? []).map((gap) => ({
            key,
            gap,
            operation: ENGINE_CAPABILITY_GAPS[gap].operation,
            ownerBead: ENGINE_CAPABILITY_GAPS[gap].ownerBead,
            findingId: 'engine-capability-ownership',
          })),
        ),
      )
      .sort((a, b) =>
        a.key < b.key ? -1 : a.key > b.key ? 1 : a.gap.localeCompare(b.gap),
      );
    expect(expected).toEqual([]);
    expect(report.engineProcedure.blockingCapabilityGaps).toEqual(expected);
    const pair = ({ key, ownerBead }: { key: string; ownerBead?: string }) =>
      `${key} -> ${ownerBead}`;
    expect(
      report.unresolvedWork
        .filter((row) => row.kind === 'blocking-capability-gap')
        .map(pair)
        .sort(),
    ).toEqual(expected.map(pair).sort());
  });

  it('projects a registered fixture gap through the report producer and unresolved work', () => {
    const coverage: Record<string, RuleProcedureCoverage> = {
      'rule:fixture-gap': {
        knownLimits: [
          {
            limit: 'partial',
            statement: 'The fixture operation remains blocked.',
            findingId: 'engine-capability-ownership',
            capabilityGaps: ['fixture-gap'],
          },
        ],
      },
    };
    const report = buildRuleDispositionReport(coverage, {
      'fixture-gap': {
        operation: 'resolve fixture operation',
        ownerBead: 'eshyra-fixture.1',
        findingId: 'engine-capability-ownership',
      },
    });
    expect(report.engineProcedure.blockingCapabilityGaps).toContainEqual({
      key: 'rule:fixture-gap',
      gap: 'fixture-gap',
      operation: 'resolve fixture operation',
      ownerBead: 'eshyra-fixture.1',
      findingId: 'engine-capability-ownership',
    });
    expect(report.unresolvedWork).toContainEqual({
      key: 'rule:fixture-gap',
      kind: 'blocking-capability-gap',
      detail: 'resolve fixture operation',
      findingId: 'engine-capability-ownership',
      ownerBead: 'eshyra-fixture.1',
    });
  });

  it('surfaces each known limit with its key and finding', () => {
    const report = buildRuleDispositionReport();
    expect(
      report.engineProcedure.knownLimits.deferred.find(
        (row) => row.key === 'rule:multiclassing',
      )?.designOwner,
    ).toBe('eshyra-2n1t.1');
    expect(report.engineProcedure.externalClauses).toEqual([]);
    for (const key of [
      'rule:armor-guidance',
      'rule:casting-a-spell-saving-throws',
      'rule:special-weapons',
      'rule:spells',
      'rule:telepathy',
      'rule:weapon-properties',
    ])
      expect(
        ENGINE_PROCEDURE_COVERAGE[key]?.knownLimits.flatMap(
          (limit) => limit.externalClauses ?? [],
        ),
      ).toEqual([]);
    // A3 retires armor-guidance: character AC is not derived by a live tool.
    expect(ENGINE_PROCEDURE_COVERAGE['rule:armor-guidance']).toEqual({
      knownLimits: [],
    });
    expect(
      ENGINE_PROCEDURE_COVERAGE['rule:special-weapons']?.knownLimits[0]
        ?.statement,
    ).toContain('one attack');
  });

  it('preserves an explicit non-default external finding ID through materialization and reporting', () => {
    const coverage = materializeEngineProcedureCoverage(
      {},
      {
        knownLimits: {
          'rule:fixture': [
            {
              limit: 'partial',
              statement: 'fixture limit',
              findingId: 'readiness-integrity',
              externalClauses: [
                {
                  clause: 'fixture external clause',
                  bead: 'eshyra-o9bd.18.7.7',
                  findingId: 'magic-item-effects',
                },
              ],
            },
          ],
        },
      },
    );
    const report = buildRuleDispositionReport(coverage);

    expect(report.engineProcedure.externalClauses).toEqual([
      {
        key: 'rule:fixture',
        clause: 'fixture external clause',
        bead: 'eshyra-o9bd.18.7.7',
        findingId: 'magic-item-effects',
      },
    ]);
    expect(report.unresolvedWork).toContainEqual({
      key: 'rule:fixture',
      kind: 'external-clause',
      detail: 'fixture external clause',
      findingId: 'magic-item-effects',
      historicalBead: 'eshyra-o9bd.18.7.7',
    });
  });

  it('declares W13 concentration as a positive bounded provider-neutral capability', () => {
    const contract =
      buildRuleDispositionReport().deterministicCapabilities.find(
        (row) => row.operationId === 'resolve_concentration',
      );

    expect(contract).toMatchObject({
      revision: 'resolve-concentration-v1',
      runtimeOwner: [
        'packages/core/src/state/activeEffects.ts',
        'packages/core/src/orchestrator/toolResolveConcentration.ts',
      ],
      evidence: [
        'packages/core/test/activeEffects.test.ts',
        'packages/core/test/tools.test.ts',
      ],
    });
    expect(contract?.operation).toContain('concentration');
    expect(contract?.requiredInputs).not.toHaveLength(0);
    expect(contract?.exclusions).not.toHaveLength(0);
    expect(contract?.residualDmInterpretation).not.toHaveLength(0);
  });

  it('uses one actual operation for several rule bindings and fails closed on invalid input', () => {
    expect(
      RULE_DETERMINISTIC_CAPABILITY_CONTRACTS['resolve-check-v2'],
    ).toMatchObject({
      operationId: 'resolve_check',
    });
    expect(
      RULE_DETERMINISTIC_CAPABILITY_BINDINGS.filter(
        ({ capability }) => capability === 'resolve-check-v2',
      ).map(({ ruleKey }) => ruleKey),
    ).toEqual([
      'rule:ability-checks',
      'rule:advantage-and-disadvantage',
      'rule:attack-rolls',
      'rule:modifiers-to-the-roll',
      'rule:proficiency-bonus',
      'rule:saving-throws',
    ]);
    expect(() =>
      requireRuleDeterministicCapabilityContract('not-recognized-v1'),
    ).toThrow(/no deterministic capability has been positively selected/);
    expect(
      validateRuleDeterministicCapabilityInput('resolve-check-v2', {
        kind: 'initiative',
        reason: 'invalid kind',
        extra: true,
      }),
    ).toBeDefined();
    expect(
      validateRuleDeterministicCapabilityInput('resolve-spell-upcast-v1', {
        spellRef: 'spell:fireball',
        slotLevel: 3,
        extra: true,
      }),
    ).toBeDefined();
    expect(
      validateRuleDeterministicCapabilityInput('resolve-concentration-v1', {
        owner: 'pc-1',
        damage: 4,
        extra: true,
      }),
    ).toBeDefined();
  });

  it('accounts for every implemented row with a binding or explicit disposition', () => {
    const report = buildRuleDispositionReport();
    const implementedKeys = Object.entries(ENGINE_PROCEDURE_COVERAGE)
      .filter(([, coverage]) => coverage.implementation !== undefined)
      .map(([ruleKey]) => ruleKey)
      .sort();
    expect(
      report.deterministicCapabilitySourceOutcomes
        .map(({ ruleKey }) => ruleKey)
        .sort(),
    ).toEqual(implementedKeys);
    expect(
      RULE_DETERMINISTIC_CAPABILITY_DISPOSITIONS['rule:spell-slots'],
    ).toMatchObject({
      outcome: 'not-positively-selected',
      nextState: expect.stringContaining('validated operation'),
    });
    expect(
      report.deterministicCapabilitySourceOutcomes.find(
        ({ ruleKey }) => ruleKey === 'rule:casting-a-spell-at-a-higher-level',
      ),
    ).toMatchObject({
      outcome: 'bound',
      capabilities: ['resolve-spell-upcast-v1'],
    });
    expect(
      validateRuleDeterministicCapabilityContracts(
        { 'rule:x': { implementation: {} } },
        {},
        [],
        {},
      ),
    ).toContain(
      'rule:x: implemented row has no W13 capability binding or disposition',
    );
  });

  it('rejects capability operation and required-input contract drift', () => {
    expect(
      validateRuleDeterministicCapabilityContracts(
        {},
        {
          'rule:x': {
            ...RULE_DETERMINISTIC_CAPABILITY_CONTRACTS[
              'resolve-concentration-v1'
            ],
            operationId: 'not-registered',
          },
        },
        [],
        {},
      ),
    ).toContain('rule:x: capability operation is not a registered tool');
    expect(
      validateRuleDeterministicCapabilityContracts(
        {},
        {
          'resolve-check-v2': {
            ...RULE_DETERMINISTIC_CAPABILITY_CONTRACTS['resolve-check-v2'],
            requiredInputs: ['kind'],
          },
        },
        [],
        {},
      ),
    ).toContain(
      "resolve-check-v2: required schema input 'reason' is missing from the contract",
    );
  });

  it('checks every runtimeOwner/evidence path against the repo tree', () => {
    const missing: string[] = [];
    for (const [key, coverage] of Object.entries(ENGINE_PROCEDURE_COVERAGE)) {
      for (const path of [
        ...(coverage.implementation?.runtimeOwner ?? []),
        ...(coverage.implementation?.evidence ?? []),
      ]) {
        if (!existsSync(join(process.cwd(), path))) {
          missing.push(`${key}: ${path}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('fails closed on a new (unreviewed) rule record', () => {
    // eshyra-t8gw.1: assertRuleDispositions now also covers `action:*`
    // records, so this fixture keeps both kinds (not just `rule`) to isolate
    // the single new-key failure this test targets from spurious
    // stale-disposition noise for the real action:* keys.
    const records = getBundledDnd5eSrdPack().records.filter(
      (record) => record.kind === 'rule' || record.kind === 'action',
    );
    const errors = assertRuleDispositions(
      pack([...records, ruleRecord('rule:a-brand-new-rule')]),
    );
    expect(errors).toContain(
      'rule:a-brand-new-rule: unreviewed rule record — add to RULE_DISPOSITIONS',
    );
  });

  it('fails closed on a stale disposition (pack record removed)', () => {
    const records = getBundledDnd5eSrdPack().records.filter(
      (record) =>
        (record.kind === 'rule' || record.kind === 'action') &&
        record.key !== 'rule:ability-checks',
    );
    const errors = assertRuleDispositions(pack(records));
    expect(errors).toContain(
      'rule:ability-checks: stale disposition — remove from RULE_DISPOSITIONS',
    );
  });

  // eshyra-t8gw.1: `assertRuleDispositions` now also covers `action:*`
  // records (the ten SRD 5.1 standard-action dispositions moved there from
  // `rule:*`). These two mirror the `rule:*` fail-closed pair above for the
  // `action:*` half of the same check.
  it('fails closed on a new (unreviewed) action record', () => {
    const records = getBundledDnd5eSrdPack().records.filter(
      (record) => record.kind === 'rule' || record.kind === 'action',
    );
    const errors = assertRuleDispositions(
      pack([...records, actionRecord('action:a-brand-new-action')]),
    );
    expect(errors).toContain(
      'action:a-brand-new-action: unreviewed rule record — add to RULE_DISPOSITIONS',
    );
  });

  it('fails closed on a stale disposition (action pack record removed)', () => {
    const records = getBundledDnd5eSrdPack().records.filter(
      (record) =>
        (record.kind === 'rule' || record.kind === 'action') &&
        record.key !== 'action:dash',
    );
    const errors = assertRuleDispositions(pack(records));
    expect(errors).toContain(
      'action:dash: stale disposition — remove from RULE_DISPOSITIONS',
    );
  });

  it('fails closed when a table-backed/tableEvidence row has no non-empty tableRefs', () => {
    const records = getBundledDnd5eSrdPack().records.map((record) =>
      record.key === 'rule:ability-checks'
        ? { ...record, data: { text: 'no table refs here' } }
        : record,
    );
    const errors = assertRuleDispositions(pack(records));
    expect(errors).toContain(
      'rule:ability-checks: disposition claims table evidence but the pack record has no non-empty tableRefs',
    );
  });
});

describe('validateRuleRegistries (eshyra-o9bd.18.7.8.1 §6 failure modes)', () => {
  function dispositions(
    entries: Record<string, RuleDisposition>,
  ): Readonly<Record<string, RuleDisposition>> {
    return entries;
  }

  it('fails closed on an engine-procedure row missing family', () => {
    const errors = validateRuleRegistries(
      dispositions({
        'rule:x': { class: 'engine-procedure', note: 'n' },
      }),
      {},
      { 'engine-procedure': 1 } as never,
      {} as never,
    );
    expect(errors).toContain('rule:x: engine-procedure row is missing family');
  });

  it('fails closed on a duplicate row with a dangling canonicalOwner', () => {
    const errors = validateRuleRegistries(
      dispositions({
        'rule:x': {
          class: 'duplicate',
          canonicalOwner: 'rule:missing',
          note: 'n',
        },
      }),
      {},
      { duplicate: 1 } as never,
      {} as never,
    );
    expect(errors).toContain(
      "rule:x: canonicalOwner 'rule:missing' does not resolve to a rule key",
    );
  });

  it('fails closed on a duplicate row whose canonicalOwner is itself a duplicate', () => {
    const errors = validateRuleRegistries(
      dispositions({
        'rule:x': { class: 'duplicate', canonicalOwner: 'rule:y', note: 'n' },
        'rule:y': { class: 'duplicate', canonicalOwner: 'rule:x', note: 'n' },
      }),
      {},
      { duplicate: 2 } as never,
      {} as never,
    );
    expect(
      errors.some((e) =>
        e.includes("canonicalOwner 'rule:x' is itself a duplicate"),
      ),
    ).toBe(true);
  });

  it('fails closed on a deterministicOwner that resolves to a reference-prose row', () => {
    const errors = validateRuleRegistries(
      dispositions({
        'rule:x': {
          class: 'definition',
          deterministicOwner: 'rule:y',
          note: 'n',
        },
        'rule:y': { class: 'reference-prose', note: 'n' },
      }),
      {},
      { definition: 1, 'reference-prose': 1 } as never,
      {} as never,
    );
    expect(
      errors.some((e) =>
        e.includes(
          "deterministicOwner 'rule:y' must be engine-procedure or table-backed, is 'reference-prose'",
        ),
      ),
    ).toBe(true);
  });

  it('does not flag a deterministicOwner using the record-data: pointer form', () => {
    const errors = validateRuleRegistries(
      dispositions({
        'rule:x': {
          class: 'definition',
          deterministicOwner: 'record-data:creature.skills',
          note: 'n',
        },
      }),
      {},
      { definition: 1 } as never,
      {} as never,
    );
    expect(errors).toEqual([]);
  });

  it('fails closed on an engine-procedure row with no coverage entry', () => {
    const errors = validateRuleRegistries(
      dispositions({
        'rule:x': { class: 'engine-procedure', family: 'core-d20', note: 'n' },
      }),
      {},
      { 'engine-procedure': 1 } as never,
      {} as never,
    );
    expect(errors).toContain(
      'rule:x: engine-procedure row has no ENGINE_PROCEDURE_COVERAGE entry',
    );
  });

  const procedure = dispositions({
    'rule:x': { class: 'engine-procedure', family: 'core-d20', note: 'n' },
  });
  const limit = (
    overrides: Partial<RuleProcedureCoverage['knownLimits'][number]> = {},
  ) => ({
    limit: 'partial' as const,
    statement: 'fixture gap',
    findingId: 'readiness-integrity',
    ...overrides,
  });

  it('fails closed on an orphan coverage entry', () => {
    const errors = validateRuleRegistries(dispositions({}), {
      'rule:x': { knownLimits: [] },
    });
    expect(errors).toContain(
      'rule:x: ENGINE_PROCEDURE_COVERAGE entry is not an engine-procedure disposition (orphan)',
    );
  });

  it('fails closed on implementation evidence missing paths', () => {
    const errors = validateRuleRegistries(procedure, {
      'rule:x': {
        implementation: { runtimeOwner: [], evidence: [] },
        knownLimits: [],
      },
    });
    expect(errors).toContain('rule:x: implementation is missing runtimeOwner');
    expect(errors).toContain('rule:x: implementation is missing evidence');
  });

  it('fails closed on a known limit missing its statement or finding', () => {
    const errors = validateRuleRegistries(procedure, {
      'rule:x': {
        knownLimits: [limit({ statement: '', findingId: 'not-registered' })],
      },
    });
    expect(errors).toContain(
      'rule:x: partial known limit is missing statement',
    );
    expect(errors).toContain(
      'rule:x: unknown canonical finding ID "not-registered"',
    );
  });

  it('fails closed on deferred limits without a valid design owner', () => {
    const missing = validateRuleRegistries(procedure, {
      'rule:x': {
        knownLimits: [limit({ limit: 'deferred', designOwner: undefined })],
      },
    });
    expect(missing).toContain(
      'rule:x: deferred known limit is missing designOwner',
    );
    const malformed = validateRuleRegistries(procedure, {
      'rule:x': {
        knownLimits: [limit({ limit: 'deferred', designOwner: 'TBD' })],
      },
    });
    expect(malformed).toContain(
      "rule:x: designOwner 'TBD' is not a real bead-id shape",
    );
  });

  it('fails closed on malformed external clause ownership', () => {
    const errors = validateRuleRegistries(procedure, {
      'rule:x': {
        knownLimits: [
          limit({
            externalClauses: [
              {
                clause: '',
                bead: 'eshyra-o9bd.18.7.6',
                findingId: 'readiness-integrity',
              },
              {
                clause: 'valid clause',
                bead: 'not-a-bead',
                findingId: 'readiness-integrity',
              },
            ],
          }),
        ],
      },
    });
    expect(errors).toContain(
      "rule:x: externalClauses entry is missing 'clause'",
    );
    expect(errors).toContain(
      "rule:x: externalClauses bead 'not-a-bead' is not a real bead-id shape",
    );
  });

  it('fails closed on semantic or channel census drift', () => {
    const semanticErrors = validateRuleRegistries(
      dispositions({ 'rule:x': { class: 'reference-prose', note: 'n' } }),
      {},
      { 'reference-prose': 2 } as never,
    );
    expect(semanticErrors).toContain(
      'semantic fixture census drift: reference-prose is 1, expected 2',
    );
    const coverageErrors = validateRuleRegistries(
      procedure,
      { 'rule:x': { knownLimits: [limit()] } },
      undefined,
      { knownLimit: 2 } as never,
    );
    expect(coverageErrors).toContain(
      'coverage census drift: knownLimit is 1, expected 2 (caller-supplied census)',
    );
  });

  it('passes clean on an internally consistent fixture', () => {
    const errors = validateRuleRegistries(
      dispositions({
        'rule:x': { class: 'engine-procedure', family: 'core-d20', note: 'n' },
        'rule:y': { class: 'duplicate', canonicalOwner: 'rule:x', note: 'n' },
      }),
      {
        'rule:x': {
          implementation: {
            runtimeOwner: ['packages/core/src/x.ts'],
            evidence: ['packages/core/test/x.test.ts'],
          },
          knownLimits: [],
        },
      },
      { 'engine-procedure': 1, duplicate: 1 } as never,
      { implementation: 1 } as never,
    );
    expect(errors).toEqual([]);
  });
});
