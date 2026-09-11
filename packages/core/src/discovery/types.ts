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

/**
 * One retention or packet decision, recorded WHERE THE DECISION IS MADE.
 *
 * This is an EVENT, not a shape inferred later from which candidates survived.
 * A final candidate list can say what state exists after a stage; it cannot say
 * why something is missing from it, and reconstructing an exclusion from
 * "absent from the output" fabricates a reason the producer never recorded.
 * The union makes the two malformed shapes unrepresentable in producer code: an
 * exclusion cannot exist without its reason, and a retained decision cannot
 * carry one.
 */
export type CandidateDisposition =
  | {
      readonly candidateKey: string;
      readonly retained: true;
    }
  | {
      readonly candidateKey: string;
      readonly retained: false;
      readonly reason: string;
    };

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

/**
 * One seam call this stage actually made. Canonical: the query evidence M5
 * reports is derived from these, never stored as separate flags that could
 * disagree with them.
 */
export type SeamQuery =
  | {
      readonly kind: 'active-rules';
      readonly candidateRecordKeys: readonly string[];
    }
  | {
      readonly kind: 'active-rulings';
      readonly scope: 'requested-ambiguities' | 'all-active';
      readonly ambiguityIds: readonly string[];
    };

/**
 * What the seam returned, as the seam returned it.
 *
 * Deliberately the jhpt-owned projection rather than a discovery-declared
 * shape: design section 8.4 forbids discovery from declaring a rule or ruling
 * schema of its own, and a narrowed copy would both drift from the owner and
 * drop fields the owner considers part of the projection. `ruleKind`,
 * `ambiguityId` and `governingRecordKeys` are read from it; none is redefined.
 */
export type ReturnedRuleProjection =
  | CampaignRuleProjection
  | CampaignRulingProjection;

export interface RuleJoinTrace extends StageTrace<DiscoveryCandidate> {
  /** Canonical: the seam calls this stage made, in order. */
  readonly seamQueries: readonly SeamQuery[];
  /** Canonical: what the seam returned, unchanged. */
  readonly returnedProjections: readonly ReturnedRuleProjection[];
  /** Canonical: every ambiguity id this stage's candidate set carried. */
  readonly consideredAmbiguityIds: readonly string[];
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
  /** Ambiguity ids carried by rulings the seam actually returned. */
  readonly returnedAmbiguityIds: readonly string[];
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
  /**
   * Canonical: one decision per candidate this stage decided over, in the rank
   * order it decided them. `outputsProduced`, `dropped`, `overflow`,
   * `overflowed` and `losses` are all VIEWS of this list, computed from it
   * rather than authored beside it, so no two of them can describe the same
   * exclusion differently.
   */
  readonly dispositions: readonly CandidateDisposition[];
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
  /**
   * Active campaign rulings governing this candidate, as the `eshyra-jhpt`
   * seam supplied them (amendment A2) — the jhpt-owned projection itself,
   * passed through unchanged. Discovery must not define a ruling shape of its
   * own (design section 8.4), and a narrowed copy would both drift from the
   * owner and silently drop jhpt-owned fields the execution owner needs, such
   * as the governing association and the prose.
   *
   * Present only where a readiness derivation actually ran: a
   * `not-evaluated-offline` entry evaluated nothing, so attaching rulings to
   * it would claim a consultation that never happened. A ruling never changes
   * readiness; it travels with the preflight so the execution owner can
   * consult the selected interpretation once the clause is executable.
   */
  readonly campaignRulings?: readonly CampaignRulingProjection[];
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
  /**
   * Canonical: one inclusion decision per retained candidate, recorded at the
   * byte-budget comparison. An excluded candidate carries the real budget
   * arithmetic that excluded it; the packet content below is what was
   * included, which is a different fact and is not a substitute for this one.
   */
  readonly decisions: readonly CandidateDisposition[];
  readonly packet: ContextPacket;
  /** Recorded rather than thrown, so the trace survives a budget overrun. */
  readonly byteBudgetExceeded: boolean;
  /** Must-consider candidates the byte budget could not hold. Non-empty is an
   * overflow under design section 6.3 and fails the probe, exactly as a
   * candidate-count overflow does. */
  readonly byteOverflow: readonly RetentionOverflow[];
  readonly dropped: readonly RetentionTrace['dropped'][number][];
}

/**
 * Phase 2 runtime observations (design section 12.2).
 *
 * These are facts about the REAL turn that surrounds a shadow run, recorded so
 * M10 and M11 are derivable from the durable evidence without re-running
 * discovery or re-auditing the turn. They describe what the runtime did; they
 * never describe what the model attended to, which section 12.3 forbids
 * inferring from packet membership.
 */

/**
 * One bounded readiness capability invocation that actually happened.
 *
 * Every field is required because this is an EVENT, recorded at the execution
 * boundary the instant the preflight returned — not a reconstruction from a
 * tool result, a pre-model inventory snapshot, or discovery's own packet. There
 * is consequently no "maybe" state here: a runtime capability event that cannot
 * name its subject or the identity it committed under is malformed evidence and
 * is rejected at the durable read boundary rather than being softened into
 * something M10 declines to compare.
 */
export interface RuntimeCapabilityInvocation {
  /** Registry name of the tool the capability was invoked inside. */
  readonly tool: string;
  /**
   * Primary-DM candidate attempt this invocation happened on, counting from 1.
   *
   * An audit-rejected attempt's canonical writes roll back; the fact that its
   * capability preflight executed does not. The attempt number is what keeps
   * those observations interpretable instead of anonymous.
   */
  readonly attempt: number;
  readonly instanceId: string;
  readonly recordKey: string;
  readonly variantId?: string;
  readonly operationId: string;
  readonly capabilityId: string;
  readonly capabilityRevision: string;
  readonly outcome: 'available' | 'blocked';
}

/**
 * One deterministic state effect accepted by the primary-DM candidate.
 * `tool`, `args`, `attempt`, and `ordinal` are all required so the event can
 * be compared with a fixture operation and located in the executed stream.
 * This is recorded at the ACCEPT boundary, not reconstructed from
 * `accepted_state_delta`; a rejected attempt rolls back its mutations and
 * therefore contributes no event here.
 */
export interface RuntimeStateEffect {
  /** Primary-DM candidate attempt this effect was accepted on, counting from 1. */
  readonly attempt: number;
  /** Position in the accepted candidate's executed tool stream, from 0. */
  readonly ordinal: number;
  readonly tool: string;
  /** The tool's arguments, as executed. */
  readonly args: Readonly<Record<string, unknown>>;
}

/**
 * The turn's mechanics-audit history, as one canonical lifecycle.
 *
 * Discriminated rather than a flat list plus flags, so the states a real turn
 * cannot reach are unrepresentable rather than merely rejected: an accepted
 * verdict carrying a retry cause, an intermediate acceptance, a turn-failing
 * verdict inside an accepted trace, a non-sequential attempt number, or an
 * "auditor present" claim with nothing recorded. M11's auditor presence, retry
 * counts and cause breakdown are derived from this, never stored beside it.
 *
 * A turn that FAILS its audit throws and persists no accepted trace, so no
 * failing terminal state appears here at all.
 */
export interface RuntimeAuditRetry {
  /** Structural cause the auditor's rejection was classified as, if any. */
  readonly retryCause: string | null;
  /**
   * Tool names the verdict named as missing. The coarse retry cause cannot
   * carry the M11 attribution on its own: `missing_state` is classified before
   * `missing_world_evidence`, so a verdict missing both a state tool and
   * `lookup_rules` reports only the former.
   */
  readonly missingTools: readonly string[];
}

export type RuntimeAuditOutcome =
  | { readonly disposition: 'accepted' }
  | {
      readonly disposition: 'repaired';
      readonly retryCause: string;
      readonly missingTools: readonly string[];
    };

export type RuntimeAudit =
  | { readonly auditor: 'absent' }
  | {
      readonly auditor: 'present';
      /** Candidates the auditor rejected, in order; the turn retried each. */
      readonly retries: readonly RuntimeAuditRetry[];
      /** How the accepted candidate was admitted. */
      readonly outcome: RuntimeAuditOutcome;
    };

export interface DiscoveryRunInput {
  readonly db: Db;
  /**
   * A rules stack the caller has already resolved. When present it is used
   * verbatim rather than re-resolved, so a caller that must qualify the SAME
   * source it traces (the W9 shadow capture, whose blocker observations
   * describe one resolution) cannot end up describing two. Absent, the run
   * resolves the campaign's strict stack itself.
   */
  readonly stack?: ResolvedRulesStack;
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
