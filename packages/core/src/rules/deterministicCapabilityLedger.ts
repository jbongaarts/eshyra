import type { DeterministicCapabilityContract } from './deterministicCapabilityContract.js';
import { MAGIC_ITEM_OPERATION_READINESS_CAPABILITY } from './deterministicCapabilityContract.js';
import { RulesPackError } from './types.js';

/**
 * Runtime-owned statements about Eshyra's positively selected deterministic
 * capabilities. This is a statement about Eshyra, never about the rules: a
 * missing binding does not mean that a record has no mechanics, is irrelevant,
 * safely unsupported, or that the pack is complete. Bindings quote their
 * contract's identity, revision, inputs, exclusions, and residual DM
 * interpretation; they do not restate those facts in different words.
 */
export class DeterministicCapabilityLedgerError extends RulesPackError {}

export type RuleDeterministicCapabilityContract =
  DeterministicCapabilityContract & {
    readonly inputSchemaOperation: string;
    readonly runtimeOwner: readonly string[];
    readonly evidence: readonly string[];
  };

export const RULE_DETERMINISTIC_CAPABILITY_CONTRACTS: Readonly<
  Record<string, RuleDeterministicCapabilityContract>
> = Object.freeze({
  'resolve-check-v1': {
    revision: 'resolve-check-v1',
    operationId: 'resolve_check',
    inputSchemaOperation: 'resolve_check',
    operation:
      'Resolve one declared ability check, saving throw, or attack roll using seeded d20 arithmetic.',
    requiredInputs: ['kind', 'reason'],
    exclusions: [
      'Does not decide which modifiers apply or set the DC/AC.',
      'Does not adjudicate source semantics outside the declared d20 roll.',
    ],
    residualDmInterpretation: [
      'The DM selects applicable modifiers, advantage, and the target DC or AC.',
    ],
    runtimeOwner: ['packages/core/src/orchestrator/toolResolveCheck.ts'],
    evidence: ['packages/core/test/resolutionTools.test.ts'],
  },
  'resolve-concentration-v1': {
    revision: 'resolve-concentration-v1',
    operationId: 'resolve_concentration',
    inputSchemaOperation: 'resolve_concentration',
    operation:
      'Resolve a damage-triggered concentration saving throw and atomically end the effect on failure.',
    requiredInputs: ['owner', 'damage'],
    exclusions: [
      'Does not handle voluntary, incapacitation, death, or other direct concentration breaks.',
      'Does not decide whether a damage event occurred or which modifiers apply.',
    ],
    residualDmInterpretation: [
      'The DM determines whether a save is owed and selects applicable modifiers or advantage.',
    ],
    runtimeOwner: [
      'packages/core/src/state/activeEffects.ts',
      'packages/core/src/orchestrator/toolResolveConcentration.ts',
    ],
    evidence: [
      'packages/core/test/activeEffects.test.ts',
      'packages/core/test/tools.test.ts',
    ],
  },
  'resolve-spell-upcast-v1': {
    revision: 'resolve-spell-upcast-v1',
    operationId: 'resolve_spell_upcast',
    inputSchemaOperation: 'resolve_spell_upcast',
    operation:
      'Resolve the typed source-bound higher-level spell transform for a selected spell slot.',
    requiredInputs: ['spellRef', 'slotLevel'],
    exclusions: [
      'Does not decide whether the spell may be cast or spend the slot.',
      'Does not adjudicate untyped higher-level prose.',
    ],
    residualDmInterpretation: [
      'The DM determines applicability and adjudicates source text outside the typed transform.',
    ],
    runtimeOwner: ['packages/core/src/orchestrator/toolResolveSpellUpcast.ts'],
    evidence: ['packages/core/test/spellSlots.test.ts'],
  },
  [MAGIC_ITEM_OPERATION_READINESS_CAPABILITY.revision]: {
    ...MAGIC_ITEM_OPERATION_READINESS_CAPABILITY,
    inputSchemaOperation: MAGIC_ITEM_OPERATION_READINESS_CAPABILITY.operationId,
    runtimeOwner: ['packages/core/src/state/itemExecutionReadiness.ts'],
    evidence: ['packages/core/test/itemState.test.ts'],
  },
});

export const RULE_DETERMINISTIC_CAPABILITY_BINDINGS = Object.freeze([
  { ruleKey: 'rule:ability-checks', capability: 'resolve-check-v1' },
  {
    ruleKey: 'rule:advantage-and-disadvantage',
    capability: 'resolve-check-v1',
  },
  { ruleKey: 'rule:attack-rolls', capability: 'resolve-check-v1' },
  { ruleKey: 'rule:modifiers-to-the-roll', capability: 'resolve-check-v1' },
  { ruleKey: 'rule:proficiency-bonus', capability: 'resolve-check-v1' },
  { ruleKey: 'rule:saving-throws', capability: 'resolve-check-v1' },
  { ruleKey: 'rule:concentration', capability: 'resolve-concentration-v1' },
  {
    ruleKey: 'rule:casting-a-spell-at-a-higher-level',
    capability: 'resolve-spell-upcast-v1',
  },
] as const);

export interface RuleDeterministicCapabilityDisposition {
  readonly ruleKey: string;
  readonly outcome: 'not-positively-selected';
  readonly reason: string;
  readonly replacingResponsibility: string;
  readonly nextState: string;
}

const IMPLEMENTED_ROWS_WITHOUT_SELECTED_CAPABILITY = [
  'rule:abilities',
  'rule:ability-scores-and-modifiers',
  'rule:attunement',
  'rule:backgrounds-equipment',
  'rule:backgrounds-proficiencies',
  'rule:beyond-1st-level',
  'rule:bonus-action',
  'rule:bonus-actions',
  'rule:constitution-hit-points',
  'rule:contests',
  'rule:critical-hits',
  'rule:damage-resistance-and-vulnerability',
  'rule:damage-rolls',
  'rule:death-saving-throws',
  'rule:falling-unconscious',
  'rule:gaining-inspiration',
  'rule:grapple-rules-for-monsters',
  'rule:group-checks',
  'rule:healing',
  'rule:instant-death',
  'rule:legendary-actions',
  'rule:limited-usage',
  'rule:other-activity-on-your-turn',
  'rule:passive-checks',
  'rule:reactions',
  'rule:spell-slots',
  'rule:stabilizing-a-creature',
  'rule:surprise',
  'rule:temporary-hit-points',
  'rule:using-inspiration',
  'rule:your-turn',
] as const;

export const RULE_DETERMINISTIC_CAPABILITY_DISPOSITIONS: Readonly<
  Record<string, RuleDeterministicCapabilityDisposition>
> = Object.freeze(
  Object.fromEntries(
    IMPLEMENTED_ROWS_WITHOUT_SELECTED_CAPABILITY.map((ruleKey) => [
      ruleKey,
      Object.freeze({
        ruleKey,
        outcome: 'not-positively-selected' as const,
        reason:
          'The historical implemented row records code and test evidence, but does not by itself identify one reviewed provider-neutral operation boundary.',
        replacingResponsibility:
          'ENGINE_PROCEDURE_COVERAGE retains the implementation evidence without advertising deterministic capability availability.',
        nextState:
          'Define and review a real validated operation or bounded composite before capability presentation; absence makes no claim about the rule semantics.',
      }),
    ]),
  ),
);

export function requireRuleDeterministicCapabilityContract(
  capability: string,
  contracts = RULE_DETERMINISTIC_CAPABILITY_CONTRACTS,
): RuleDeterministicCapabilityContract {
  const contract = contracts[capability];
  if (contract === undefined)
    throw new DeterministicCapabilityLedgerError(
      `${capability}: no deterministic capability has been positively selected`,
    );
  return contract;
}

type CoverageRow = { readonly status: string };
type CapabilityBinding = {
  readonly ruleKey: string;
  readonly capability: string;
};
export function validateRuleDeterministicCapabilityContracts(
  coverage: Readonly<Record<string, CoverageRow>>,
  contracts: Readonly<Record<string, RuleDeterministicCapabilityContract>>,
  bindings: readonly CapabilityBinding[] = RULE_DETERMINISTIC_CAPABILITY_BINDINGS,
  dispositions: Readonly<
    Record<string, RuleDeterministicCapabilityDisposition>
  > = RULE_DETERMINISTIC_CAPABILITY_DISPOSITIONS,
): readonly string[] {
  const errors: string[] = [];
  const implemented = new Set(
    Object.entries(coverage)
      .filter(([, row]) => row.status === 'implemented')
      .map(([key]) => key),
  );
  for (const [capability, contract] of Object.entries(contracts)) {
    if (
      !contract.revision ||
      !contract.operation ||
      contract.requiredInputs.length === 0 ||
      contract.exclusions.length === 0 ||
      contract.residualDmInterpretation.length === 0
    )
      errors.push(
        `${capability}: capability contract is missing an ADR 0020 §3 field`,
      );
  }
  const boundRules = new Set(bindings.map(({ ruleKey }) => ruleKey));
  for (const binding of bindings) {
    if (!implemented.has(binding.ruleKey))
      errors.push(
        `${binding.ruleKey}: capability binding is not backed by an implemented row`,
      );
    if (contracts[binding.capability] === undefined)
      errors.push(
        `${binding.ruleKey}: binds unknown capability ${binding.capability}`,
      );
  }
  for (const [ruleKey, disposition] of Object.entries(dispositions)) {
    if (!implemented.has(ruleKey))
      errors.push(
        `${ruleKey}: capability disposition is not backed by an implemented row`,
      );
    if (boundRules.has(ruleKey))
      errors.push(
        `${ruleKey}: has both a capability binding and a disposition`,
      );
    if (
      disposition.ruleKey !== ruleKey ||
      !disposition.reason ||
      !disposition.replacingResponsibility ||
      !disposition.nextState
    )
      errors.push(`${ruleKey}: capability disposition is incomplete`);
  }
  for (const ruleKey of implemented)
    if (!boundRules.has(ruleKey) && dispositions[ruleKey] === undefined)
      errors.push(
        `${ruleKey}: implemented row has no W13 capability binding or disposition`,
      );
  return errors;
}

export type CapabilityLedgerLookup =
  | {
      readonly outcome: 'bound';
      readonly recordKey: string;
      readonly bindings: readonly RuleDeterministicCapabilityContract[];
    }
  | {
      readonly outcome: 'not-positively-selected';
      readonly recordKey: string;
      readonly disposition: RuleDeterministicCapabilityDisposition;
    }
  | { readonly outcome: 'no-statement'; readonly recordKey: string };

export interface DeterministicCapabilityLedger {
  readonly contracts: Readonly<
    Record<string, RuleDeterministicCapabilityContract>
  >;
  readonly bindings: readonly {
    readonly ruleKey: string;
    readonly capability: string;
  }[];
  readonly dispositions: Readonly<
    Record<string, RuleDeterministicCapabilityDisposition>
  >;
  lookup(recordKey: string): CapabilityLedgerLookup;
}

export function createDeterministicCapabilityLedger(
  contracts = RULE_DETERMINISTIC_CAPABILITY_CONTRACTS,
  bindings: readonly CapabilityBinding[] = RULE_DETERMINISTIC_CAPABILITY_BINDINGS,
  dispositions = RULE_DETERMINISTIC_CAPABILITY_DISPOSITIONS,
): DeterministicCapabilityLedger {
  const seen = new Set<string>();
  for (const binding of bindings) {
    if (contracts[binding.capability] === undefined)
      throw new DeterministicCapabilityLedgerError(
        `${binding.ruleKey}: binds unknown capability ${binding.capability}`,
      );
    seen.add(binding.ruleKey);
  }
  for (const key of Object.keys(dispositions))
    if (seen.has(key))
      throw new DeterministicCapabilityLedgerError(
        `${key}: has both a capability binding and a disposition`,
      );
  return Object.freeze({
    contracts,
    bindings,
    dispositions,
    lookup(recordKey: string): CapabilityLedgerLookup {
      const selected = bindings
        .filter((binding) => binding.ruleKey === recordKey)
        .map((binding) => contracts[binding.capability]);
      if (selected.length > 0)
        return { outcome: 'bound', recordKey, bindings: selected };
      const disposition = dispositions[recordKey];
      if (disposition !== undefined)
        return { outcome: 'not-positively-selected', recordKey, disposition };
      return { outcome: 'no-statement', recordKey };
    },
  });
}

export const DETERMINISTIC_CAPABILITY_LEDGER =
  createDeterministicCapabilityLedger();
