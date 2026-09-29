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
  DEFAULT_TOOLS,
  getBundledDnd5eSrdPack,
  type RulesPack,
  type RulesPackLicense,
  type RulesRecord,
} from '../src/internal.js';
import {
  RULE_ADJUDICATION_CONTEXT,
  validateRuleAdjudicationContext,
} from '../src/rules/ruleAdjudicationContext.js';
import { RULE_KNOWN_LIMITS } from '../src/rules/ruleKnownLimits.js';

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

  it('closes every F10-owned coverage row against registered primitives', () => {
    const rows = [
      'rule:coinage',
      'rule:crafting',
      'rule:expenses-lifestyle-expenses',
      'rule:practicing-a-profession',
      'rule:researching',
      'rule:selling-treasure',
      'rule:silvered-weapons',
      'rule:training',
      'rule:wizard-your-spellbook',
      'rule:self-sufficiency',
      'rule:mounts-and-vehicles',
    ];
    const tools = new Set(DEFAULT_TOOLS.map((tool) => tool.name));
    for (const row of rows) {
      const coverage = ENGINE_PROCEDURE_COVERAGE[row];
      expect(coverage).toBeDefined();
      expect(coverage?.missing ?? '').not.toContain('→ F10');
      if (coverage?.status === 'model-adjudicated-supported') {
        expect(coverage.primitives).toContain('lookup_rules');
        for (const primitive of coverage.primitives) {
          expect(tools.has(primitive)).toBe(true);
        }
      }
    }
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
    expect(ENGINE_PROCEDURE_COVERAGE['rule:long-rest']?.status).toBe(
      'implemented',
    );
    expect(ENGINE_PROCEDURE_COVERAGE['rule:short-rest']?.status).toBe(
      'implemented',
    );
    for (const key of ['rule:feats', 'rule:customizing-a-background'])
      expect(ENGINE_PROCEDURE_COVERAGE[key]?.status).toBe('implemented');
    expect(ENGINE_PROCEDURE_COVERAGE['rule:experience-points']?.status).toBe(
      'design-blocked',
    );
    expect(ENGINE_PROCEDURE_COVERAGE['rule:charges']?.status).toBe(
      'model-adjudicated-supported',
    );
    expect(ENGINE_PROCEDURE_COVERAGE['rule:suffocating']?.status).toBe(
      'partial',
    );
    expect(Object.keys(RULE_DISPOSITIONS)).toHaveLength(335);
    expect(Object.keys(ENGINE_PROCEDURE_COVERAGE)).toHaveLength(175);
  });

  it('projects runtime statement rows by object identity into the audit', () => {
    // One definition per dataset (design invariant 5): each migrated audit row
    // points at the runtime entry itself, never at an authored copy.
    for (const [key, context] of Object.entries(RULE_ADJUDICATION_CONTEXT)) {
      expect(
        ENGINE_PROCEDURE_COVERAGE[key]?.runtimeContextSource ??
          ENGINE_PROCEDURE_COVERAGE[key]?.runtimeSource,
      ).toBe(context);
      expect(ENGINE_PROCEDURE_COVERAGE[key]?.contextRequirement).toBe(
        context.dmContext,
      );
    }
    for (const [key, limits] of Object.entries(RULE_KNOWN_LIMITS))
      expect(
        ENGINE_PROCEDURE_COVERAGE[key]?.runtimeLimitSource ??
          ENGINE_PROCEDURE_COVERAGE[key]?.runtimeSource,
      ).toBe(limits[0]);
    expect(ENGINE_PROCEDURE_COVERAGE['rule:channel-divinity']).toMatchObject({
      status: 'design-blocked',
      findingId: 'engine-capability-ownership',
    });
  });

  it('refuses coverage authored both in the audit and in a runtime dataset', () => {
    expect(() =>
      materializeEngineProcedureCoverage({
        'rule:cover': {
          status: 'model-adjudicated-supported',
          primitives: ['lookup_rules'],
          contextRequirement: 'second definition',
        },
      }),
    ).toThrow(/unbound engine procedure coverage must be implemented/);
  });

  it('projects an adjudication context and known limit together by identity', () => {
    const context = Object.freeze({
      tools: Object.freeze(['lookup_rules']),
      dmContext: 'The DM determines the outcome from the retrieved rule.',
    });
    const limit = Object.freeze({
      limit: 'partial' as const,
      statement: 'Eshyra does not track the remaining duration.',
      findingId: 'readiness-integrity',
    });
    const coverage = materializeEngineProcedureCoverage(
      {},
      {
        adjudicationContext: { 'rule:fixture': context },
        knownLimits: { 'rule:fixture': [limit] },
      },
    );

    expect(coverage['rule:fixture']).toMatchObject({
      status: 'partial',
      primitives: context.tools,
      contextRequirement: context.dmContext,
      missing: limit.statement,
      findingId: limit.findingId,
    });
    expect(coverage['rule:fixture']?.runtimeContextSource).toBe(context);
    expect(coverage['rule:fixture']?.runtimeLimitSource).toBe(limit);
  });

  it('requires every listed adjudication tool to be named in its DM context', () => {
    expect(
      validateRuleAdjudicationContext(
        new Set(['lookup_rules', 'resolve_check']),
        {
          'rule:fixture': {
            tools: ['lookup_rules', 'resolve_check'],
            dmContext:
              'Use lookup_rules to read the rule, then resolve the roll.',
          },
        },
      ),
    ).toContain("rule:fixture: tool 'resolve_check' is not named in dmContext");
    expect(
      validateRuleAdjudicationContext(
        new Set(['lookup_rules', 'resolve_check']),
        {
          'rule:fixture': {
            tools: ['lookup_rules', 'resolve_check'],
            dmContext: 'Pass the declared modifier to resolve_check.',
          },
        },
      ),
    ).toEqual([]);
  });

  it('rejects non-implemented rows authored in the audit materializer input', () => {
    expect(() =>
      materializeEngineProcedureCoverage({
        'rule:fixture': {
          status: 'partial',
          missing: 'fixture gap',
        },
      }),
    ).toThrow(/unbound engine procedure coverage must be implemented/);
  });

  it('surfaces actionable detail (key + missing/designOwner/clause), not just counts', () => {
    const report = buildRuleDispositionReport();
    expect(
      ENGINE_PROCEDURE_COVERAGE['rule:casting-a-spell-at-a-higher-level']
        ?.primitives,
    ).toEqual(
      expect.arrayContaining(['spend_spell_slot', 'resolve_spell_upcast']),
    );
    expect(
      report.engineProcedure.designBlocked.find(
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
      expect(ENGINE_PROCEDURE_COVERAGE[key]?.externalClauses).toBeUndefined();
    expect(ENGINE_PROCEDURE_COVERAGE['rule:armor-guidance']?.missing).toContain(
      'armor class',
    );
    expect(
      ENGINE_PROCEDURE_COVERAGE['rule:special-weapons']?.missing,
    ).toContain('net escape');
  });

  it('preserves an explicit non-default external finding ID through materialization and reporting', () => {
    const coverage = materializeEngineProcedureCoverage({
      'rule:fixture': {
        status: 'implemented',
        runtimeOwner: ['fixture'],
        evidence: ['fixture.test.ts'],
        externalClauses: [
          {
            clause: 'fixture external clause',
            bead: 'eshyra-o9bd.18.7.7',
            findingId: 'magic-item-effects',
          },
        ],
      },
    });
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
      RULE_DETERMINISTIC_CAPABILITY_CONTRACTS['resolve-check-v1'],
    ).toMatchObject({
      operationId: 'resolve_check',
    });
    expect(
      RULE_DETERMINISTIC_CAPABILITY_BINDINGS.filter(
        ({ capability }) => capability === 'resolve-check-v1',
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
      validateRuleDeterministicCapabilityInput('resolve-check-v1', {
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
      .filter(([, coverage]) => coverage.status === 'implemented')
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
        { 'rule:x': { status: 'implemented' } },
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
          'resolve-check-v1': {
            ...RULE_DETERMINISTIC_CAPABILITY_CONTRACTS['resolve-check-v1'],
            requiredInputs: ['kind'],
          },
        },
        [],
        {},
      ),
    ).toContain(
      "resolve-check-v1: required schema input 'reason' is missing from the contract",
    );
  });

  it('registers every literally-named supporting tool in primitives, e.g. consumables/remove_item', () => {
    // A supporting tool must be a checked primitive, not just prose — so
    // removing it from DEFAULT_TOOLS invalidates the row (see the
    // 'unregistered primitive' failure-mode test below).
    expect(ENGINE_PROCEDURE_COVERAGE['rule:consumables']?.primitives).toEqual(
      expect.arrayContaining(['remove_item']),
    );
  });

  it('pins the full tool chain on the F1/F9-reclassified rows, not just the formula', () => {
    // resolve_damage is read-only: falling's damage lands only through the
    // HP mutation tools, and the reclassified rows must pin every tool
    // their contextRequirement names so a tool removal fails validation.
    expect(ENGINE_PROCEDURE_COVERAGE['rule:falling']?.primitives).toEqual(
      expect.arrayContaining([
        'calc',
        'resolve_damage',
        'adjust_hp',
        'update_combatant',
        'add_condition',
      ]),
    );
    expect(
      ENGINE_PROCEDURE_COVERAGE['rule:variant-encumbrance']?.primitives,
    ).toEqual(expect.arrayContaining(['calc', 'resolve_check']));
    expect(ENGINE_PROCEDURE_COVERAGE['rule:speed']?.primitives).toEqual(
      expect.arrayContaining(['calc', 'resolve_check']),
    );
    expect(ENGINE_PROCEDURE_COVERAGE['rule:hiding']?.primitives).toEqual(
      expect.arrayContaining(['calc', 'resolve_contest']),
    );
    // Every tool a contextRequirement names literally must be pinned.
    const violations: string[] = [];
    for (const [key, coverage] of Object.entries(ENGINE_PROCEDURE_COVERAGE)) {
      if (
        coverage.status !== 'model-adjudicated-supported' ||
        coverage.contextRequirement === undefined
      ) {
        continue;
      }
      const primitives = new Set(coverage.primitives ?? []);
      for (const tool of [
        'resolve_check',
        'resolve_contest',
        'resolve_damage',
        'calc',
        'adjust_hp',
        'update_combatant',
        'add_condition',
        'spend_turn_resource',
      ]) {
        if (
          coverage.contextRequirement.includes(tool) &&
          !primitives.has(tool)
        ) {
          violations.push(`${key}: names '${tool}' but omits it`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('checks every runtimeOwner/evidence path against the repo tree', () => {
    const missing: string[] = [];
    for (const [key, coverage] of Object.entries(ENGINE_PROCEDURE_COVERAGE)) {
      for (const path of [
        ...(coverage.runtimeOwner ?? []),
        ...(coverage.evidence ?? []),
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

  it('fails closed on a design-blocked row whose designOwner is not a real bead-id shape', () => {
    const errors = validateRuleRegistries(
      dispositions({
        'rule:x': { class: 'engine-procedure', family: 'core-d20', note: 'n' },
      }),
      { 'rule:x': { status: 'design-blocked', designOwner: 'TBD' } },
      { 'engine-procedure': 1 } as never,
      { 'design-blocked': 1 } as never,
    );
    expect(errors).toContain(
      "rule:x: designOwner 'TBD' is not a real bead-id shape",
    );
  });

  it('fails closed on an externalClauses entry with a malformed bead id or empty clause', () => {
    const errors = validateRuleRegistries(
      dispositions({
        'rule:x': { class: 'engine-procedure', family: 'core-d20', note: 'n' },
      }),
      {
        'rule:x': {
          status: 'model-adjudicated-supported',
          primitives: ['lookup_rules'],
          contextRequirement: 'req',
          externalClauses: [
            { clause: '', bead: 'eshyra-o9bd.18.7.6' },
            { clause: 'valid clause', bead: 'not-a-bead' },
          ],
        },
      },
      { 'engine-procedure': 1 } as never,
      { 'model-adjudicated-supported': 1 } as never,
    );
    expect(errors).toContain(
      `rule:x: externalClauses entry is missing 'clause'`,
    );
    expect(errors).toContain(
      "rule:x: externalClauses bead 'not-a-bead' is not a real bead-id shape",
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
        e.includes(
          'semantic fixture census drift: reference-prose is 1, expected 2',
        ),
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
