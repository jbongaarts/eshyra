import type { AdventureModule } from '../adventure/types.js';
import type { Db } from '../persistence/db.js';
import type {
  ResolvedRulesStack,
  RulesStackRecordEntry,
} from '../rules/stack.js';
import type { RulesAmbiguity } from '../rules/types.js';
import type { ItemOperationReadinessInput } from '../state/itemExecutionReadiness.js';

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

export interface StageTrace<T> {
  readonly stage: string;
  readonly inputsConsumed: readonly Record<string, unknown>[];
  readonly outputsProduced: readonly T[];
  readonly losses: readonly StageLoss[];
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

export interface CampaignRuleProjection {
  readonly ruleIdentity: string;
  readonly ruleKind: 'house-rule' | 'ruling';
  readonly status: string;
  readonly origin: string;
  readonly provenance: string;
  readonly effectivePosition: string;
  readonly supersededBy: string | null;
  readonly scope: string;
  readonly governingRecordKeys: readonly string[];
  readonly ambiguityId?: string;
  readonly oracleSupplied?: boolean;
  readonly prose?: string;
}

export interface CampaignRulingProjection extends CampaignRuleProjection {
  readonly ruleKind: 'ruling';
  readonly ambiguityId: string;
  readonly selectedInterpretationId: string;
}

export interface CampaignRuleReadSeam {
  activeRulesAtPosition(query: {
    readonly campaignPosition?: string;
    readonly candidateRecordKeys: readonly string[];
  }): readonly CampaignRuleProjection[];
  activeRulingsForAmbiguities(
    ambiguityIds: readonly string[],
  ): readonly CampaignRulingProjection[];
}

export const NULL_CAMPAIGN_RULE_SEAM: CampaignRuleReadSeam = {
  activeRulesAtPosition: () => [],
  activeRulingsForAmbiguities: () => [],
};

export interface RuleJoinTrace extends StageTrace<DiscoveryCandidate> {
  readonly requestedRuleRecordKeys: readonly string[];
  readonly requestedAmbiguityIds: readonly string[];
  readonly placedRules: readonly {
    readonly ruleIdentity: string;
    readonly governingRecordKey: string;
  }[];
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
  readonly dedup: DedupTrace;
  readonly retention: RetentionTrace;
  readonly packet: PacketTrace;
  readonly stageOrder: readonly string[];
  readonly stack: ResolvedRulesStack;
}

export type { Db };
