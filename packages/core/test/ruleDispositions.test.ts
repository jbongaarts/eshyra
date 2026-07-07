import { describe, expect, it } from 'vitest';
import {
  assertRuleDispositions,
  buildRuleDispositionReport,
  ENGINE_PROCEDURE_COVERAGE,
  RULE_DISPOSITIONS,
  type RuleDisposition,
  type RuleProcedureCoverage,
  validateRuleRegistries,
} from '../scripts/create-dnd5e-srd-audit-bundle/ruleDispositions.js';
import {
  getBundledDnd5eSrdPack,
  type RulesPack,
  type RulesPackLicense,
  type RulesRecord,
} from '../src/internal.js';

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
  it('pins the exact 335-key semantic census against the committed pack', () => {
    expect(assertRuleDispositions(getBundledDnd5eSrdPack())).toEqual([]);
    const report = buildRuleDispositionReport();
    expect(report).toEqual({
      referencesProse: 96,
      definitions: 33,
      tableBacked: 19,
      duplicates: 12,
      engineProcedure: {
        implemented: 0,
        modelAdjudicatedSupported: 97,
        partial: 47,
        unimplemented: 21,
        designBlocked: 10,
        externalClauses: 5,
      },
    });
    expect(Object.keys(RULE_DISPOSITIONS)).toHaveLength(335);
    expect(Object.keys(ENGINE_PROCEDURE_COVERAGE)).toHaveLength(175);
  });

  it('fails closed on a new (unreviewed) rule record', () => {
    const records = getBundledDnd5eSrdPack().records.filter(
      (record) => record.kind === 'rule',
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
        record.kind === 'rule' && record.key !== 'rule:ability-checks',
    );
    const errors = assertRuleDispositions(pack(records));
    expect(errors).toContain(
      'rule:ability-checks: stale disposition — remove from RULE_DISPOSITIONS',
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

  it('fails closed on an orphan coverage entry (no matching engine-procedure disposition)', () => {
    const errors = validateRuleRegistries(
      dispositions({}),
      { 'rule:x': { status: 'unimplemented', missing: 'n' } },
      {} as never,
      { unimplemented: 1 } as never,
    );
    expect(errors).toContain(
      'rule:x: ENGINE_PROCEDURE_COVERAGE entry is not an engine-procedure disposition (orphan)',
    );
  });

  it('fails closed on an implemented row missing runtimeOwner/evidence', () => {
    const errors = validateRuleRegistries(
      dispositions({
        'rule:x': { class: 'engine-procedure', family: 'core-d20', note: 'n' },
      }),
      { 'rule:x': { status: 'implemented' } },
      { 'engine-procedure': 1 } as never,
      { implemented: 1 } as never,
    );
    expect(errors).toContain('rule:x: implemented row is missing runtimeOwner');
    expect(errors).toContain('rule:x: implemented row is missing evidence');
  });

  it('fails closed on a model-adjudicated-supported row with an unregistered primitive', () => {
    const errors = validateRuleRegistries(
      dispositions({
        'rule:x': { class: 'engine-procedure', family: 'core-d20', note: 'n' },
      }),
      {
        'rule:x': {
          status: 'model-adjudicated-supported',
          primitives: ['not_a_real_tool'],
          contextRequirement: 'req',
        } as RuleProcedureCoverage,
      },
      { 'engine-procedure': 1 } as never,
      { 'model-adjudicated-supported': 1 } as never,
    );
    expect(errors).toContain(
      "rule:x: primitive 'not_a_real_tool' is not a registered DEFAULT_TOOLS name",
    );
  });

  it('fails closed on a model-adjudicated-supported row missing contextRequirement', () => {
    const errors = validateRuleRegistries(
      dispositions({
        'rule:x': { class: 'engine-procedure', family: 'core-d20', note: 'n' },
      }),
      {
        'rule:x': {
          status: 'model-adjudicated-supported',
          primitives: ['lookup_rules'],
        },
      },
      { 'engine-procedure': 1 } as never,
      { 'model-adjudicated-supported': 1 } as never,
    );
    expect(errors).toContain(
      'rule:x: model-adjudicated-supported row is missing contextRequirement',
    );
  });

  it('fails closed on a partial row missing "missing"', () => {
    const errors = validateRuleRegistries(
      dispositions({
        'rule:x': { class: 'engine-procedure', family: 'core-d20', note: 'n' },
      }),
      { 'rule:x': { status: 'partial' } },
      { 'engine-procedure': 1 } as never,
      { partial: 1 } as never,
    );
    expect(errors).toContain(`rule:x: partial row is missing 'missing'`);
  });

  it('fails closed on a design-blocked row missing designOwner', () => {
    const errors = validateRuleRegistries(
      dispositions({
        'rule:x': { class: 'engine-procedure', family: 'core-d20', note: 'n' },
      }),
      { 'rule:x': { status: 'design-blocked' } },
      { 'engine-procedure': 1 } as never,
      { 'design-blocked': 1 } as never,
    );
    expect(errors).toContain(
      'rule:x: design-blocked row is missing designOwner',
    );
  });

  it('fails closed on semantic or coverage census drift', () => {
    const semanticErrors = validateRuleRegistries(
      dispositions({
        'rule:x': { class: 'reference-prose', note: 'n' },
      }),
      {},
      { 'reference-prose': 2 } as never,
      {} as never,
    );
    expect(
      semanticErrors.some((e) =>
        e.includes('semantic census drift: reference-prose is 1, expected 2'),
      ),
    ).toBe(true);

    const coverageErrors = validateRuleRegistries(
      dispositions({
        'rule:x': { class: 'engine-procedure', family: 'core-d20', note: 'n' },
      }),
      { 'rule:x': { status: 'unimplemented', missing: 'n' } },
      { 'engine-procedure': 1 } as never,
      { unimplemented: 2 } as never,
    );
    expect(
      coverageErrors.some((e) =>
        e.includes('coverage census drift: unimplemented is 1, expected 2'),
      ),
    ).toBe(true);
  });

  it('passes clean on an internally consistent fixture', () => {
    const errors = validateRuleRegistries(
      dispositions({
        'rule:x': { class: 'engine-procedure', family: 'core-d20', note: 'n' },
        'rule:y': { class: 'duplicate', canonicalOwner: 'rule:x', note: 'n' },
      }),
      {
        'rule:x': {
          status: 'implemented',
          runtimeOwner: ['packages/core/src/x.ts'],
          evidence: ['packages/core/test/x.test.ts'],
        },
      },
      { 'engine-procedure': 1, duplicate: 1 } as never,
      { implemented: 1 } as never,
    );
    expect(errors).toEqual([]);
  });
});
