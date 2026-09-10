import type { CampaignRulingProjection } from '../campaign/campaignRules.js';
import { isCampaignRulingProjection } from '../campaign/campaignRules.js';
import { candidateBand } from './bands.js';
import type {
  ProjectedCandidate,
  ProjectedDiscoveryTrace,
  ProjectedRuleJoinStage,
  ProjectedStage,
} from './traceProjection.js';
import type {
  CandidateBand,
  ContextPacket,
  PacketCandidate,
  RetentionOverflow,
  StageLoss,
  StageOutcome,
  TypedTraversal,
} from './types.js';

/**
 * Everything a measurement reads, DERIVED from the canonical durable record.
 *
 * Nothing here is persisted. That is the invariant the durable boundary now
 * rests on: a summary computed from the facts cannot contradict them, so there
 * is no second copy for a coordinated corruption to move. `assertV1` therefore
 * only has to admit a well-formed canonical record — schema, identity, coverage
 * and lifecycle — instead of proving an ever-growing set of relations between
 * stored claims that were free to drift apart.
 *
 * Where a summary needs a rule the producer owns (a candidate's band, say),
 * this module uses the producer's own function. That is not the drift hazard
 * the durable reader guards against: this module IS the producer of the
 * summary now, and the durable reader shares nothing with either.
 */

export interface DerivedStage {
  readonly stage: string;
  readonly outcome: StageOutcome;
  readonly failedToRun: boolean;
  readonly losses: readonly StageLoss[];
  readonly outputsProduced: readonly unknown[];
  readonly produced: readonly string[];
  readonly modified: readonly string[];
  readonly carriedForward: readonly string[];
}

export interface DerivedRuleJoin extends DerivedStage {
  readonly requestedRuleRecordKeys: readonly string[];
  readonly requestedAmbiguityIds: readonly string[];
  readonly rulingQueryScope: 'none' | 'requested-ambiguities' | 'all-active';
  readonly ruleQueryExecuted: boolean;
  readonly rulingQueryExecuted: boolean;
  readonly returnedRuleIdentities: readonly string[];
  readonly returnedAmbiguityIds: readonly string[];
  readonly placedRuleIdentities: readonly string[];
  readonly unplacedRuleIdentities: readonly string[];
  readonly surfacedCandidateKeys: readonly string[];
  readonly placedRules: readonly {
    readonly ruleIdentity: string;
    readonly governingRecordKey: string;
  }[];
  readonly resolvedAmbiguityIds: readonly string[];
  readonly unresolvedAmbiguityIds: readonly string[];
}

export interface DerivedExpansion extends DerivedStage {
  readonly traversals: readonly TypedTraversal[];
}

export interface DerivedRetention extends DerivedStage {
  readonly outputsProduced: readonly (ProjectedCandidate & {
    readonly band: CandidateBand;
  })[];
  readonly dropped: readonly RetentionOverflow[];
  readonly overflow: readonly RetentionOverflow[];
  readonly overflowed: boolean;
}

export interface DerivedPacket extends DerivedStage {
  readonly outputsProduced: readonly PacketCandidate[];
  readonly packet: ContextPacket;
  readonly byteBudgetExceeded: boolean;
  readonly byteOverflow: readonly RetentionOverflow[];
  readonly dropped: readonly RetentionOverflow[];
}

export interface DerivedDiscoveryTrace {
  readonly signals: DerivedStage;
  readonly candidates: DerivedStage;
  readonly expansion: DerivedExpansion;
  readonly ruleJoin: DerivedRuleJoin;
  readonly ruleExpansion: DerivedExpansion;
  readonly lateRuleJoin: DerivedRuleJoin;
  readonly dedup: DerivedStage;
  readonly retention: DerivedRetention;
  readonly packet: DerivedPacket;
  readonly unexpandedPromotions: readonly string[];
  readonly stageOrder: readonly string[];
}

/**
 * A candidate's semantic identity, for classifying a stage transition.
 *
 * Design section 12.1: "a candidate can gain a traversal without gaining a
 * route", so routes alone would report that mutation as untouched pass-through.
 * The rule and ruling evidence a candidate carries is part of that identity
 * too, and it is taken from the JOIN PLACEMENTS rather than from a copy stored
 * on the candidate — placement is one fact, and recording it twice is how two
 * surfaces come to disagree about it.
 */
function identityOf(
  candidate: ProjectedCandidate,
  placed: ReadonlyMap<string, readonly string[]>,
): string {
  return JSON.stringify([
    candidate.routes.map((route) => [
      route.routeClass,
      route.trigger,
      route.signalId,
    ]),
    candidate.traversals,
    placed.get(candidate.candidateKey) ?? [],
  ]);
}

/**
 * Which rule identities each candidate carries after the given joins. Derived
 * from the placements themselves.
 */
function placedOn(
  ...joins: readonly ProjectedRuleJoinStage[]
): ReadonlyMap<string, readonly string[]> {
  const byCandidate = new Map<string, string[]>();
  for (const join of joins)
    for (const placement of join.placements) {
      const held = byCandidate.get(placement.governingRecordKey) ?? [];
      if (!held.includes(placement.ruleIdentity))
        held.push(placement.ruleIdentity);
      byCandidate.set(placement.governingRecordKey, held);
    }
  return new Map(
    [...byCandidate].map(([key, identities]) => [key, [...identities].sort()]),
  );
}

function accounting(
  before: readonly ProjectedCandidate[],
  after: readonly ProjectedCandidate[],
  placedBefore: ReadonlyMap<string, readonly string[]>,
  placedAfter: ReadonlyMap<string, readonly string[]>,
): Pick<DerivedStage, 'produced' | 'modified' | 'carriedForward'> {
  const prior = new Map(
    before.map((candidate) => [
      candidate.candidateKey,
      identityOf(candidate, placedBefore),
    ]),
  );
  const produced: string[] = [];
  const modified: string[] = [];
  const carriedForward: string[] = [];
  for (const candidate of after) {
    const was = prior.get(candidate.candidateKey);
    if (was === undefined) produced.push(candidate.candidateKey);
    else if (was !== identityOf(candidate, placedAfter))
      modified.push(candidate.candidateKey);
    else carriedForward.push(candidate.candidateKey);
  }
  return { produced, modified, carriedForward };
}

function stageBase<T>(
  stage: ProjectedStage<T>,
  entries: Pick<DerivedStage, 'produced' | 'modified' | 'carriedForward'>,
): DerivedStage {
  return {
    stage: stage.stage,
    outcome: stage.outcome,
    failedToRun: stage.outcome === 'failed-to-run',
    losses: stage.losses,
    outputsProduced: stage.outputsProduced,
    ...entries,
  };
}

/** Everything the whole output of a stage is newly its own. */
function allProduced(ids: readonly string[]) {
  return { produced: ids, modified: [], carriedForward: [] };
}

function traversalKey(traversal: TypedTraversal): string {
  return JSON.stringify(traversal);
}

/**
 * The traversals a stage performed: those newly appearing on the candidate
 * stream here. Each traversal is attached to both of its endpoints, so this is
 * exactly what the stage recorded — and it cannot claim one no candidate
 * carries, nor omit one a candidate does.
 */
function traversalsOf(
  before: readonly ProjectedCandidate[],
  after: readonly ProjectedCandidate[],
): TypedTraversal[] {
  const had = new Set(
    before.flatMap((candidate) => candidate.traversals.map(traversalKey)),
  );
  const gained = new Map<string, TypedTraversal>();
  for (const candidate of after)
    for (const traversal of candidate.traversals) {
      const key = traversalKey(traversal);
      if (!had.has(key) && !gained.has(key)) gained.set(key, traversal);
    }
  return [...gained.values()];
}

function deriveRuleJoin(
  join: ProjectedRuleJoinStage,
  before: readonly ProjectedCandidate[],
  placedBefore: ReadonlyMap<string, readonly string[]>,
  placedAfter: ReadonlyMap<string, readonly string[]>,
  seededResolved: ReadonlySet<string>,
): DerivedRuleJoin {
  const entries = accounting(
    before,
    join.outputsProduced,
    placedBefore,
    placedAfter,
  );
  const ruleQuery = join.seamQueries.find(
    (query) => query.kind === 'active-rules',
  );
  const rulingQuery = join.seamQueries.find(
    (query) => query.kind === 'active-rulings',
  );
  const placedRuleIdentities = [
    ...new Set(join.placements.map((item) => item.ruleIdentity)),
  ];
  const placed = new Set(placedRuleIdentities);
  const resolved = new Set([
    ...seededResolved,
    ...join.returnedProjections
      .filter(
        (projection) =>
          isCampaignRulingProjection(projection) &&
          placed.has(projection.ruleIdentity),
      )
      .map(
        (projection) => (projection as CampaignRulingProjection).ambiguityId,
      ),
  ]);
  return {
    ...stageBase(join, entries),
    requestedRuleRecordKeys:
      ruleQuery?.kind === 'active-rules' ? ruleQuery.candidateRecordKeys : [],
    requestedAmbiguityIds:
      rulingQuery?.kind === 'active-rulings' ? rulingQuery.ambiguityIds : [],
    rulingQueryScope:
      rulingQuery?.kind === 'active-rulings' ? rulingQuery.scope : 'none',
    ruleQueryExecuted: ruleQuery !== undefined,
    rulingQueryExecuted: rulingQuery !== undefined,
    returnedRuleIdentities: join.returnedProjections.map(
      (projection) => projection.ruleIdentity,
    ),
    returnedAmbiguityIds: [
      ...new Set(
        join.returnedProjections
          .filter(isCampaignRulingProjection)
          .map((projection) => projection.ambiguityId),
      ),
    ],
    placedRuleIdentities,
    unplacedRuleIdentities: join.returnedProjections
      .filter((projection) => !placed.has(projection.ruleIdentity))
      .map((projection) => projection.ruleIdentity),
    // A join adds a candidate only by surfacing governing material the rest of
    // discovery did not reach, so what it produced IS what it surfaced.
    surfacedCandidateKeys: entries.produced,
    placedRules: join.placements,
    resolvedAmbiguityIds: [...resolved],
    unresolvedAmbiguityIds: join.consideredAmbiguityIds.filter(
      (id) => !resolved.has(id),
    ),
  };
}

function overflowRecord(
  candidate: ProjectedCandidate,
  reason: string,
): RetentionOverflow {
  return {
    candidateKey: candidate.candidateKey,
    band: candidateBand(candidate),
    routes: candidate.routes,
    reason,
  };
}

export function deriveDiscoveryTrace(
  trace: ProjectedDiscoveryTrace,
): DerivedDiscoveryTrace {
  const signalIds = trace.signals.outputsProduced.map(
    (signal) => signal.signalId,
  );
  const candidateKeys = trace.candidates.outputsProduced.map(
    (item) => item.candidateKey,
  );
  // Placement state as of each stage, derived from the joins that ran before
  // it. Nothing on a candidate records this a second time.
  const beforeJoins = placedOn();
  const afterFirstJoin = placedOn(trace.ruleJoin);
  const afterBothJoins = placedOn(trace.ruleJoin, trace.lateRuleJoin);
  const expansion: DerivedExpansion = {
    ...stageBase(
      trace.expansion,
      accounting(
        trace.candidates.outputsProduced,
        trace.expansion.outputsProduced,
        beforeJoins,
        beforeJoins,
      ),
    ),
    traversals: traversalsOf(
      trace.candidates.outputsProduced,
      trace.expansion.outputsProduced,
    ),
  };
  const ruleJoin = deriveRuleJoin(
    trace.ruleJoin,
    trace.expansion.outputsProduced,
    beforeJoins,
    afterFirstJoin,
    new Set(),
  );
  const ruleExpansion: DerivedExpansion = {
    ...stageBase(
      trace.ruleExpansion,
      accounting(
        trace.ruleJoin.outputsProduced,
        trace.ruleExpansion.outputsProduced,
        afterFirstJoin,
        afterFirstJoin,
      ),
    ),
    traversals: traversalsOf(
      trace.ruleJoin.outputsProduced,
      trace.ruleExpansion.outputsProduced,
    ),
  };
  const lateRuleJoin = deriveRuleJoin(
    trace.lateRuleJoin,
    trace.ruleExpansion.outputsProduced,
    afterFirstJoin,
    afterBothJoins,
    new Set(ruleJoin.resolvedAmbiguityIds),
  );
  const dedup = stageBase(
    trace.dedup,
    accounting(
      trace.lateRuleJoin.outputsProduced,
      trace.dedup.outputsProduced,
      afterBothJoins,
      afterBothJoins,
    ),
  );

  // Retention decided over everything dedup emitted. Retained set, drops,
  // overflow and the overflow flag all come out of that one decision list.
  const byKey = new Map(
    trace.dedup.outputsProduced.map((item) => [item.candidateKey, item]),
  );
  const retained: (ProjectedCandidate & { band: CandidateBand })[] = [];
  const dropped: RetentionOverflow[] = [];
  for (const decision of trace.retention.dispositions) {
    const item = byKey.get(decision.candidateKey);
    if (item === undefined) continue;
    if (decision.retained)
      retained.push({ ...item, band: candidateBand(item) });
    else
      dropped.push(
        overflowRecord(item, decision.reason ?? 'excluded by retention'),
      );
  }
  const overflow = dropped.filter((item) => item.band === 'must-consider');
  const retention: DerivedRetention = {
    ...stageBase(
      {
        ...trace.retention,
        outputsProduced: retained,
        // A retention loss IS its drop record; deriving it keeps the two from
        // ever being able to say different things.
        losses: dropped.map((item) => ({
          reason: item.reason,
          detail: item as unknown as Record<string, unknown>,
        })),
      },
      {
        produced: [],
        modified: retained.map((item) => item.candidateKey),
        carriedForward: [],
      },
    ),
    outputsProduced: retained,
    dropped,
    overflow,
    overflowed: overflow.length > 0,
  };

  // The packet decided over everything retention kept.
  const retainedByKey = new Map(
    retained.map((item) => [item.candidateKey, item]),
  );
  const byteDropped: RetentionOverflow[] = [];
  for (const decision of trace.packet.decisions) {
    if (decision.retained) continue;
    const item = retainedByKey.get(decision.candidateKey);
    if (item === undefined) continue;
    byteDropped.push(
      overflowRecord(item, decision.reason ?? 'excluded from the packet'),
    );
  }
  const byteOverflow = byteDropped.filter(
    (item) => item.band === 'must-consider',
  );
  const included = trace.packet.candidates;
  const packetDropped = [...dropped, ...byteDropped];
  const packet: DerivedPacket = {
    ...stageBase(
      {
        ...trace.packet,
        outputsProduced: included,
        losses: packetDropped.map((item) => ({
          reason: item.reason,
          detail: item as unknown as Record<string, unknown>,
        })),
      },
      allProduced(included.map((item) => item.identity.key)),
    ),
    outputsProduced: included,
    packet: {
      candidates: included,
      bytes: Buffer.byteLength(JSON.stringify(included), 'utf8'),
      projectionLimitNotes: included.flatMap((item) => item.projectionLimits),
      modelUsageClaim: null,
    },
    byteBudgetExceeded: byteDropped.length > 0,
    byteOverflow,
    dropped: packetDropped,
  };

  // The bounded residual design section 12.1 names: a record the late join
  // promoted to must-consider that expansion no longer reaches.
  const bandBefore = new Map(
    trace.ruleExpansion.outputsProduced.map((item) => [
      item.candidateKey,
      candidateBand(item),
    ]),
  );
  return {
    signals: stageBase(trace.signals, allProduced(signalIds)),
    candidates: stageBase(trace.candidates, allProduced(candidateKeys)),
    expansion,
    ruleJoin,
    ruleExpansion,
    lateRuleJoin,
    dedup,
    retention,
    packet,
    unexpandedPromotions: trace.lateRuleJoin.outputsProduced
      .filter(
        (item) =>
          candidateBand(item) === 'must-consider' &&
          bandBefore.get(item.candidateKey) !== 'must-consider',
      )
      .map((item) => item.candidateKey),
    stageOrder: [
      trace.signals.stage,
      trace.candidates.stage,
      trace.expansion.stage,
      trace.ruleJoin.stage,
      trace.ruleExpansion.stage,
      trace.lateRuleJoin.stage,
      trace.dedup.stage,
      trace.retention.stage,
      trace.packet.stage,
    ],
  };
}
