/**
 * The source-clause semantic IR. This is a narrow contract vocabulary, not a
 * universal rules language. A clause references source obligations; it never
 * defines the requirements by which those obligations are judged.
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

export type BranchName = 'success' | 'failure' | 'partialSuccess';

export type ClauseField =
  | 'identity'
  | 'sourceSpans'
  | 'provenance'
  | 'semanticOwner'
  | 'recordOwner'
  | 'kind'
  | 'sourceObligationIds'
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

export type ObligationId = string;

/** The shared facet vocabulary used by PRs #475, #476, and #477. */
export type SemanticFacet =
  | 'save'
  | 'save-with-damage'
  | 'save-without-damage'
  | 'save-with-alternate-outcomes'
  | 'attack'
  | 'attack-with-one-damage-mode'
  | 'attack-with-conditional-alternatives'
  | 'check'
  | 'branch'
  | 'action-economy'
  | 'resource-use'
  | 'resource-with-reset'
  | 'resource-without-reset'
  | 'duration'
  | 'duration-with-concentration'
  | 'duration-without-concentration'
  | 'effect'
  | 'effect-with-lifecycle'
  | 'effect-without-lifecycle'
  | 'geometry'
  | 'choice'
  | 'variant'
  | 'entity-lifecycle'
  | 'ledger'
  | 'model-adjudication'
  | 'recurrence'
  | 'immunity-window'
  | 'repeat-check'
  | 'termination';

export type EvidenceKind =
  | 'source-span'
  | 'authoritative-input'
  | 'audit-finding'
  | 'code'
  | 'bead'
  | 'known-missing-source-clause';

export interface SourceSpan {
  readonly sourceRef: string;
  readonly locator: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface SourceSpanEvidence {
  readonly kind: 'source-span';
  readonly sourceRef: string;
  readonly locator: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface AuthoritativeInputEvidence {
  readonly kind: 'authoritative-input';
  readonly sourceRef: string;
  readonly locator: string;
  readonly inputId: string;
  readonly digest: string;
}

export interface AuditFindingEvidence {
  readonly kind: 'audit-finding';
  readonly findingId: string;
  /** The source occurrence identified by the audit finding. */
  readonly sourceRef: string;
  readonly locator: string;
}

export interface CodeEvidence {
  readonly kind: 'code';
  readonly path: string;
  readonly symbol: string;
}

export interface BeadEvidence {
  readonly kind: 'bead';
  readonly beadId: string;
}

export interface KnownMissingSourceClauseEvidence {
  readonly kind: 'known-missing-source-clause';
  readonly sourceRef: string;
  readonly locator: string;
  readonly findingId: string;
}

export type ObligationEvidence =
  | SourceSpanEvidence
  | AuthoritativeInputEvidence
  | AuditFindingEvidence
  | CodeEvidence
  | BeadEvidence
  | KnownMissingSourceClauseEvidence;

export type ObligationOrigin =
  | 'source-extraction'
  | 'curated-specification'
  | 'audit-finding';

export interface SourceObligationRecord {
  readonly obligationId: ObligationId;
  readonly origin: ObligationOrigin;
  readonly evidence: readonly [ObligationEvidence, ...ObligationEvidence[]];
  readonly requiredFacets: readonly [SemanticFacet, ...SemanticFacet[]];
}

export interface ClauseIdentity {
  readonly id: string;
  readonly canonicalKey: string;
  readonly revision: string;
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
  /** The source occurrence that proves this outcome is not a shell. */
  readonly sourceSpan: SourceSpan;
  /** IDs of projected atoms this outcome controls. */
  readonly projectedAtomIds: readonly string[];
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
  readonly concentration: boolean;
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

export interface CapabilityReference {
  readonly capability: EngineCapability;
  readonly owningBead: string;
}

export interface DiscoveryReference {
  readonly resolverId: string;
  readonly path: string;
}

/** Readiness is evidence, never four producer-authored booleans. */
export interface ClauseReadinessEvidence {
  readonly captured: readonly ObligationEvidence[];
  readonly supported: readonly CapabilityReference[];
  readonly discoverable: readonly DiscoveryReference[];
}

export interface ClauseDimensions {
  readonly captured: 'satisfied' | 'failed';
  readonly projected: 'satisfied' | 'failed';
  readonly supported: 'satisfied' | 'failed';
  readonly discoverable: 'satisfied' | 'failed';
}

export interface ExecutionOwner {
  readonly kind: 'engine' | 'model';
  readonly id: string;
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
  /** IDs only: the authoritative records live in an independent registry. */
  readonly sourceObligationIds: readonly ObligationId[];
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
  readonly requiredEngineCapabilities: readonly CapabilityReference[];
  readonly readiness: ClauseReadinessEvidence;
  readonly regressionEvidence: readonly RegressionEvidence[];
}
