/**
 * The source-clause semantic IR. This is deliberately a contract vocabulary,
 * not a universal rules language: projectors may compose these primitives or
 * retain a clause for model adjudication when a deterministic representation
 * is not available.
 */

export type ClauseKind =
  | 'attack'
  | 'save'
  | 'check'
  | 'branch'
  | 'action-economy'
  | 'resource'
  | 'duration'
  | 'state-transition'
  | 'geometry'
  | 'choice'
  | 'variant'
  | 'entity-lifecycle'
  | 'ledger'
  | 'model-adjudication';

export type MechanicsRecordFamily =
  | 'rule'
  | 'feature'
  | 'spell'
  | 'creature'
  | 'hazard'
  | 'equipment'
  | 'magic-item'
  | 'ancestry'
  | 'background'
  | 'condition'
  | 'action'
  | 'feat'
  | 'class'
  | 'subclass'
  | 'table';

export type BranchName = 'success' | 'failure' | 'partialSuccess';

export type ClauseField =
  | 'identity'
  | 'sourceSpans'
  | 'provenance'
  | 'semanticOwner'
  | 'recordOwner'
  | 'kind'
  | 'sourceObligations'
  | 'trigger'
  | 'eligibility'
  | 'activationCost'
  | 'targets'
  | 'geometry'
  | 'checks'
  | 'attacks'
  | 'saves'
  | 'alternatives'
  | 'branches'
  | 'damage'
  | 'healing'
  | 'grants'
  | 'ledgerChanges'
  | 'stateTransitions'
  | 'duration'
  | 'recurrence'
  | 'repeatChecks'
  | 'immunityWindows'
  | 'termination'
  | 'executionOwner'
  | 'requiredEngineCapabilities'
  | 'readiness'
  | 'regressionEvidence';

export type ClauseRequirementPredicate =
  | {
      readonly kind: 'field';
      readonly field: ClauseField;
      readonly cardinality: 'present' | 'non-empty';
    }
  | {
      readonly kind: 'branch';
      readonly branch: BranchName;
    }
  | {
      readonly kind: 'field-group';
      readonly fields: readonly ClauseField[];
      readonly minCount: number;
      readonly maxCount?: number;
    };

export interface ClauseRequirement {
  readonly id: string;
  readonly sourceText: string;
  readonly predicate: ClauseRequirementPredicate;
}

/** A source-backed semantic obligation, including composed child contracts. */
export interface SourceObligation {
  readonly id: string;
  readonly sourceText: string;
  readonly sourceSpanLocators: readonly [string, ...string[]];
  readonly contractKind: ClauseKind;
  readonly requirements: readonly ClauseRequirement[];
}

export interface ClauseIdentity {
  readonly id: string;
  readonly canonicalKey: string;
  readonly revision: string;
}

export interface SourceSpan {
  readonly sourceRef: string;
  readonly locator: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface ClauseProvenance {
  readonly sourceRef: string;
  readonly sourceHash?: string;
  readonly extraction:
    | 'structural-parser'
    | 'semantic-grammar'
    | 'curated-specification'
    | 'manual-review';
  readonly evidence: readonly string[];
}

export interface SemanticOwner {
  readonly id: string;
  readonly kind: 'rules-pack' | 'projector' | 'engine' | 'model' | 'curator';
}

export interface RecordOwner {
  readonly family: MechanicsRecordFamily;
  readonly key: string;
}

export interface ClausePredicate {
  readonly id: string;
  readonly summary: string;
  readonly sourceText: string;
}

export type ActionEconomyKind =
  | 'action'
  | 'bonus-action'
  | 'reaction'
  | 'free'
  | 'no-action'
  | 'special';

export interface ActionEconomyCost {
  readonly kind: ActionEconomyKind;
  readonly amount: number | 'variable';
  readonly trigger: ClausePredicate | null;
  readonly sourceText: string;
}

export interface TargetSpec {
  readonly mode:
    | 'self'
    | 'single'
    | 'multiple'
    | 'area'
    | 'object'
    | 'creature'
    | 'point'
    | 'special';
  readonly count: number | 'variable' | null;
  readonly description: string;
}

export interface GeometrySpec {
  readonly shape:
    | 'point'
    | 'line'
    | 'cone'
    | 'cube'
    | 'sphere'
    | 'cylinder'
    | 'self'
    | 'special';
  readonly range: string | null;
  readonly area: string | null;
  readonly lineOfSight: boolean | null;
  readonly description: string;
}

export interface CheckSpec {
  readonly id: string;
  readonly ability: string | null;
  readonly dc: string | null;
  readonly purpose: string;
}

export interface AttackSpec {
  readonly id: string;
  readonly attackType: 'melee' | 'ranged' | 'spell' | 'special';
  readonly defense: 'armor-class' | 'save' | 'special';
  readonly attackBonus: string | null;
  readonly purpose: string;
}

export interface SaveSpec {
  readonly id: string;
  readonly ability: string;
  readonly dc: string;
  readonly purpose: string;
}

export interface AlternativeSpec {
  readonly id: string;
  readonly label: string;
  readonly mutuallyExclusiveWith: readonly string[];
  readonly clauseIds: readonly string[];
}

export interface BranchSpec {
  readonly id: string;
  readonly outcome: string;
  readonly condition: ClausePredicate | null;
}

export interface BranchSet {
  readonly success: BranchSpec | null;
  readonly failure: BranchSpec | null;
  readonly partialSuccess: BranchSpec | null;
}

export interface DamageSpec {
  readonly id: string;
  readonly damageType: string;
  readonly amount: string;
  readonly on: 'hit' | 'failure' | 'success' | 'partial-success' | 'special';
}

export interface HealingSpec {
  readonly id: string;
  readonly amount: string;
  readonly on:
    | 'activation'
    | 'success'
    | 'failure'
    | 'partial-success'
    | 'special';
}

export interface GrantSpec {
  readonly id: string;
  readonly grant: string;
  readonly recipient: string;
}

export interface LedgerChangeSpec {
  readonly id: string;
  readonly ledger: string;
  readonly operation: 'increase' | 'decrease' | 'set' | 'transfer' | 'record';
  readonly amount: string;
}

export interface StateTransitionSpec {
  readonly id: string;
  readonly state: string;
  readonly from: string | null;
  readonly to: string;
  readonly condition: ClausePredicate | null;
}

export interface DurationSpec {
  readonly amount: string;
  readonly unit: 'round' | 'minute' | 'hour' | 'day' | 'permanent' | 'special';
}

export interface RecurrenceSpec {
  readonly interval: string;
  readonly reset:
    | 'turn'
    | 'round'
    | 'short-rest'
    | 'long-rest'
    | 'dawn'
    | 'special';
}

export interface RepeatCheckSpec {
  readonly check: CheckSpec;
  readonly interval: string;
  readonly endsOn: 'success' | 'failure' | 'both' | 'special';
}

export interface ImmunityWindowSpec {
  readonly subject: string;
  readonly immunity: string;
  readonly duration: DurationSpec | null;
}

export interface TerminationSpec {
  readonly trigger: ClausePredicate;
  readonly outcome: string;
}

export type EngineCapability =
  | 'engine:F1'
  | 'engine:F2'
  | 'engine:F3'
  | 'engine:F4'
  | 'engine:F5'
  | 'engine:F6'
  | 'engine:F7'
  | 'engine:F8'
  | 'engine:F9'
  | 'engine:F10';

export interface ExecutionOwner {
  readonly kind: 'engine' | 'model' | 'rules-pack' | 'projector';
  readonly id: string;
}

export interface ClauseDimensions {
  readonly captured: boolean;
  readonly projected: boolean;
  readonly supported: boolean;
  readonly discoverable: boolean;
}

export interface ClauseReadiness {
  readonly dimensions: ClauseDimensions;
  readonly note: string | null;
}

export interface RegressionEvidence {
  readonly id: string;
  readonly kind: 'test' | 'audit' | 'finding' | 'source-review';
  readonly assertion: string;
  readonly locator: string | null;
}

export interface Clause {
  readonly identity: ClauseIdentity;
  readonly sourceSpans: readonly [SourceSpan, ...SourceSpan[]];
  readonly provenance: ClauseProvenance;
  readonly semanticOwner: SemanticOwner;
  readonly recordOwner: RecordOwner;
  readonly kind: ClauseKind;
  /** The source, rather than the selected kind, determines these obligations. */
  readonly sourceObligations: readonly [
    SourceObligation,
    ...SourceObligation[],
  ];
  readonly trigger: ClausePredicate | null;
  readonly eligibility: ClausePredicate | null;
  readonly activationCost: ActionEconomyCost | null;
  readonly targets: TargetSpec | null;
  readonly geometry: GeometrySpec | null;
  readonly checks: readonly CheckSpec[];
  readonly attacks: readonly AttackSpec[];
  readonly saves: readonly SaveSpec[];
  readonly alternatives: readonly AlternativeSpec[];
  readonly branches: BranchSet;
  readonly damage: readonly DamageSpec[];
  readonly healing: readonly HealingSpec[];
  readonly grants: readonly GrantSpec[];
  readonly ledgerChanges: readonly LedgerChangeSpec[];
  readonly stateTransitions: readonly StateTransitionSpec[];
  readonly duration: DurationSpec | null;
  readonly recurrence: RecurrenceSpec | null;
  readonly repeatChecks: readonly RepeatCheckSpec[];
  readonly immunityWindows: readonly ImmunityWindowSpec[];
  readonly termination: TerminationSpec | null;
  readonly executionOwner: ExecutionOwner;
  readonly requiredEngineCapabilities: readonly EngineCapability[];
  readonly readiness: ClauseReadiness;
  readonly regressionEvidence: readonly RegressionEvidence[];
}
