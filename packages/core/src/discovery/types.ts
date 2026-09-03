import type { AdventureModule } from '../adventure/types.js';
import type {
  CampaignRuleProjection,
  CampaignRuleReadSeam,
  CampaignRulingProjection,
} from '../campaign/campaignRules.js';
import type { Db } from '../persistence/db.js';
import type {
  ResolvedRulesStack,
  RulesStackRecordEntry,
} from '../rules/stack.js';
import type { RulesAmbiguity } from '../rules/types.js';
import type { ItemOperationReadinessInput } from '../state/itemExecutionReadiness.js';

export type {
  CampaignRuleProjection,
  CampaignRuleReadSeam,
  CampaignRulingProjection,
} from '../campaign/campaignRules.js';

export type RouteClass =
  | 'direct-state-ref'
  | 'direct-adventure-ref'
  | 'explicit-name-or-alias'
  | 'typed-relationship'
  | 'situation-cue'
  | 'auditor-missing-target'
  | 'campaign-rule'
  | 'campaign-ruling'
  | 'capability-preflight';

export type DiscoverySignalKind =
  | 'state-ref'
  | 'adventure-ref'
  | 'name-mention'
  | 'situation-cue'
  | 'capability-preflight'
  | 'auditor-missing-target';

export interface DiscoveryScenario {
  readonly playerInput: string;
  readonly actingCharacterId?: string;
  readonly stateFields: Readonly<Record<string, unknown>>;
  readonly adventure?: {
    readonly moduleId: string;
    readonly locationId?: string;
    readonly encounterId?: string;
    readonly module: AdventureModule;
  };
  readonly itemInstances?: readonly {
    readonly instanceId: string;
    readonly recordKey: string;
    readonly variantId?: string;
  }[];
  readonly oracleSignals?: readonly InjectedSignal[];
  readonly declaredCapabilities?: readonly OfflineCapabilityDeclaration[];
}

export interface OfflineCapabilityDeclaration {
  readonly capabilityId: string;
  readonly candidateKey: string;
  readonly revision?: string;
  readonly inputs?: readonly string[];
  readonly exclusions?: readonly string[];
  readonly residualInterpretation?: string;
}

export interface InjectedSignal {
  readonly signalId?: string;
  readonly kind: DiscoverySignalKind;
  readonly evidence: Record<string, unknown>;
  readonly proposes: string;
  readonly operationId?: string;
  readonly oracleLabel?: string;
}

export interface DiscoverySignal extends InjectedSignal {
  readonly signalId: string;
  readonly oracleSupplied?: boolean;
}

export interface UnconsumedStateField {
  readonly path: string;
  readonly valueShape: string;
}

export interface ScenarioStateBinding {
  readonly path: string;
  readonly instanceId: string;
  readonly recordKey: string;
  readonly variantId?: string;
}

export interface AmbiguousNameObservation {
  readonly name: string;
  readonly keys: readonly string[];
  readonly evidence: Record<string, unknown>;
}

export interface StageLoss {
  readonly reason: string;
  readonly detail: Record<string, unknown>;
}

/**
 * How a stage reports itself (design section 12.1, stage accounting).
 *
 * `ran` — it did work: produced candidates, traversals, placements or losses.
 * `skipped` — it is a CONDITIONAL stage with nothing applicable to do. This is
 *   a truthful third state, not a pass, and only a stage the amendment
 *   declares conditional may report it.
 * `failed-to-run` — it recorded nothing and is not a conditional skip. Section
 *   13.3 forbids treating this as success.
 */
export type StageOutcome = 'ran' | 'skipped' | 'failed-to-run';

export interface StageTrace<T> {
  readonly stage: string;
  readonly inputsConsumed: readonly Record<string, unknown>[];
  /** Everything the stage emits downstream, including pass-through. Read
   * `produced`/`modified`/`carriedForward` for what the stage actually did;
   * this array's length is not a measure of work. */
  readonly outputsProduced: readonly T[];
  /** Candidate keys this stage created. */
  readonly produced: readonly string[];
  /** Existing candidate keys this stage changed — new routes, traversals,
   * rules or rulings. A modified candidate is never pass-through. */
  readonly modified: readonly string[];
  /** Candidate keys forwarded untouched. */
  readonly carriedForward: readonly string[];
  readonly losses: readonly StageLoss[];
  readonly outcome: StageOutcome;
  /** Retained for readability; true only when outcome is 'failed-to-run'. */
  readonly failedToRun: boolean;
}

export interface SignalsTrace extends StageTrace<DiscoverySignal> {
  readonly unconsumedStateFields: readonly UnconsumedStateField[];
  readonly stateBindings: readonly ScenarioStateBinding[];
  readonly ambiguousNames: readonly AmbiguousNameObservation[];
  readonly oracleSuppliedSignalLabels: readonly string[];
}

export interface DiscoveryRoute {
  readonly routeClass: RouteClass;
  readonly trigger: string;
  readonly evidence: Record<string, unknown>;
  readonly signalId: string;
}

export interface DiscoveryCandidate {
  readonly candidateKey: string;
  readonly targetKind: 'rules-record' | 'adventure-entity';
  readonly entry?: RulesStackRecordEntry;
  readonly adventureEntity?: Record<string, unknown>;
  readonly routes: readonly DiscoveryRoute[];
  readonly traversals: readonly TypedTraversal[];
  readonly campaignRules: readonly CampaignRuleProjection[];
  readonly campaignRulings: readonly CampaignRulingProjection[];
}

export interface CandidateTrace extends StageTrace<DiscoveryCandidate> {
  readonly unresolvedTargets: readonly string[];
}

export interface TypedTraversal {
  readonly sourceRecordKey: string;
  readonly linkField: string;
  readonly relation: string;
  readonly targetRecordKey: string;
}

export interface ExpansionTrace extends StageTrace<DiscoveryCandidate> {
  readonly traversals: readonly TypedTraversal[];
}

export { NULL_CAMPAIGN_RULE_SEAM } from '../campaign/campaignRules.js';

export interface RuleJoinTrace extends StageTrace<DiscoveryCandidate> {
  /** Keys passed to the active-rule query, empty unless it executed. */
  readonly requestedRuleRecordKeys: readonly string[];
  /** Ids passed to the ruling query, empty unless it executed. When the scope
   * is `all-active`, these are context ids and do not limit the result. */
  readonly requestedAmbiguityIds: readonly string[];
  /** Whether the ruling query asked for the complete active ruling set. */
  readonly rulingQueryScope: 'none' | 'requested-ambiguities' | 'all-active';
  /** Whether each seam query actually ran. A position query over an empty
   * candidate set still ran, so counts cannot witness this. */
  readonly ruleQueryExecuted: boolean;
  readonly rulingQueryExecuted: boolean;
  /** Every identity the seam returned, whether or not it could be placed. */
  readonly returnedRuleIdentities: readonly string[];
  readonly placedRuleIdentities: readonly string[];
  /** Returned but with no governing key resolvable in the active stack. */
  readonly unplacedRuleIdentities: readonly string[];
  /** Governing material this stage introduced that no earlier route reached. */
  readonly surfacedCandidateKeys: readonly string[];
  readonly placedRules: readonly {
    readonly ruleIdentity: string;
    readonly governingRecordKey: string;
  }[];
  readonly resolvedAmbiguityIds: readonly string[];
  readonly unresolvedAmbiguities: readonly RulesAmbiguity[];
}

export interface DedupTrace extends StageTrace<DiscoveryCandidate> {
  readonly routeCountBeforeDedup: Readonly<Record<string, number>>;
  readonly routeCountAfterDedup: Readonly<Record<string, number>>;
}

export type CandidateBand = 'must-consider' | 'related' | 'exploratory';

export interface RetainedCandidate extends DiscoveryCandidate {
  readonly band: CandidateBand;
}

export interface RetentionBudget {
  readonly maxCandidates: number;
  readonly maxPacketBytes: number;
}

export interface RetentionOverflow {
  readonly candidateKey: string;
  readonly band: CandidateBand;
  readonly routes: readonly DiscoveryRoute[];
  readonly reason: string;
}

export interface RetentionTrace extends StageTrace<RetainedCandidate> {
  readonly dropped: readonly {
    readonly candidateKey: string;
    readonly band: CandidateBand;
    readonly routes: readonly DiscoveryRoute[];
    readonly reason: string;
  }[];
  readonly overflowed: boolean;
  readonly overflow: readonly RetentionOverflow[];
}

export interface CapabilityPreflight {
  readonly status: 'available' | 'blocked' | 'not-evaluated-offline';
  readonly capabilityId: string;
  readonly revision?: string;
  readonly inputs?: readonly string[];
  readonly exclusions?: readonly string[];
  readonly residualInterpretation?: string;
  readonly operationId?: string;
  /** The variant the preflight route selected, threaded through to the real
   * readiness derivation exactly as `useItem` does. */
  readonly variantId?: string;
  readonly readinessInput?: ItemOperationReadinessInput;
  readonly blockingClauseIds?: readonly string[];
  readonly message?: string;
}

export interface ProjectionLimitNote {
  readonly kind: 'success-branch' | 'area' | 'execution-readiness';
  readonly note: string;
  readonly evidence: Record<string, unknown>;
  readonly preservedProse: string;
}

export interface PacketCandidate {
  readonly identity: {
    readonly key: string;
    readonly kind: string;
    readonly name: string;
  };
  readonly provenance: {
    readonly sourceRef: string;
    readonly locator?: string;
    readonly source: string;
    readonly license: unknown;
  };
  readonly sourceProse: Readonly<Record<string, unknown>>;
  readonly routes: readonly DiscoveryRoute[];
  readonly traversals: readonly TypedTraversal[];
  readonly ambiguities: readonly RulesAmbiguity[];
  readonly campaignRules: readonly CampaignRuleProjection[];
  readonly campaignRulings: readonly CampaignRulingProjection[];
  readonly capability?: CapabilityPreflight;
  readonly projectionLimits: readonly ProjectionLimitNote[];
}

export interface ContextPacket {
  readonly candidates: readonly PacketCandidate[];
  readonly bytes: number;
  readonly projectionLimitNotes: readonly ProjectionLimitNote[];
  readonly modelUsageClaim: null;
}

export interface PacketTrace extends StageTrace<PacketCandidate> {
  readonly packet: ContextPacket;
  /** Recorded rather than thrown, so the trace survives a budget overrun. */
  readonly byteBudgetExceeded: boolean;
  /** Must-consider candidates the byte budget could not hold. Non-empty is an
   * overflow under design section 6.3 and fails the probe, exactly as a
   * candidate-count overflow does. */
  readonly byteOverflow: readonly RetentionOverflow[];
  readonly dropped: readonly RetentionTrace['dropped'][number][];
}

export interface DiscoveryRunInput {
  readonly db: Db;
  readonly scenario: DiscoveryScenario;
  readonly campaignRuleSeam?: CampaignRuleReadSeam;
  readonly campaignPosition?: string;
  readonly budget?: Partial<RetentionBudget>;
  readonly rulesPackResolver?: import('../state/campaignRecordLookup.js').CampaignRulesPackResolver;
}

export interface DiscoveryTrace {
  readonly signals: SignalsTrace;
  readonly candidates: CandidateTrace;
  readonly expansion: ExpansionTrace;
  readonly ruleJoin: RuleJoinTrace;
  /** The second, bounded expansion pass (design section 12.1), seeded only
   * by candidates the rule join promoted to must-consider. */
  readonly ruleExpansion: ExpansionTrace;
  /** The final seam query, for material the first join never saw. */
  readonly lateRuleJoin: RuleJoinTrace;
  /** Records the late join promoted that expansion no longer reaches. The
   * bound is declared in design section 12.1 and reported, not hidden. */
  readonly unexpandedPromotions: readonly string[];
  readonly dedup: DedupTrace;
  readonly retention: RetentionTrace;
  readonly packet: PacketTrace;
  readonly stageOrder: readonly string[];
  readonly stack: ResolvedRulesStack;
}

export type { Db };
