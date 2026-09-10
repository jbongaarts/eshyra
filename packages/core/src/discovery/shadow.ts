import type { AdventureModule } from '../adventure/types.js';
import type { TraceJsonValue } from '../memory/turnTrace.js';
import type { Db } from '../persistence/db.js';
import type { CampaignRulesPackResolver } from '../state/campaignRecordLookup.js';
import {
  memoizeCampaignRulesPackResolver,
  resolveStrictCampaignRulesStack,
} from '../state/campaignRecordLookup.js';
import type {
  BlockerRepairObservation,
  BlockerToolSchemaSource,
} from './blockerRepairs.js';
import { observeBlockerRepairs } from './blockerRepairs.js';
import { runDiscoveryStages } from './harness.js';
import type { RuntimeDiscoveryObservations } from './measurements.js';
import type { ProjectedDiscoveryTrace } from './traceProjection.js';
import { projectDiscoveryTrace } from './traceProjection.js';
import type {
  CampaignRuleReadSeam,
  DiscoveryScenario,
  RuntimeCapabilityInvocation,
} from './types.js';

/**
 * Phase 2 runtime shadow mode (design section 12.2, bead `eshyra-o9bd.19.11`).
 *
 * Discovery runs on a real turn between `assembleContext` and
 * `renderContextMessage` and records what it would have proposed. It changes
 * NOTHING the DM receives: nothing here touches the assembled context, the
 * rendered message, the tool registry, or campaign state, and injecting the
 * packet is W10's decision, not this one.
 *
 * The capture is deliberately failure-tolerant. An observation point that can
 * abort a player's turn is worse than no observation point, so a shadow failure
 * is RECORDED as a failure — never swallowed into a green-looking empty
 * capture, and never rethrown into the turn.
 */

export const DISCOVERY_SHADOW_SCHEMA = 'discovery-shadow-v1';

export interface ShadowItemInstanceBinding {
  readonly instanceId: string;
  readonly recordKey: string;
  readonly variantId?: string;
}

export interface ShadowAdventureSeat {
  readonly moduleId: string;
  readonly locationId?: string;
  readonly encounterId?: string;
}

export interface ShadowScenarioRecord {
  readonly playerInput: string;
  readonly actingCharacterId?: string;
  /** JSON-pointer roots of the live state the run was given, never its values. */
  readonly stateFieldRoots: readonly string[];
  readonly itemInstances: readonly ShadowItemInstanceBinding[];
  readonly adventure?: ShadowAdventureSeat;
  /** Whether the declared adventure module actually resolved. */
  readonly adventureModuleResolved?: boolean;
  /**
   * Why the turn's adventure context was seated only partly, or not at all.
   * Recorded rather than left as a silent absence, because an unseated run and
   * a campaign with no adventure look identical in the trace otherwise.
   */
  readonly adventureSeatNotes: readonly string[];
}

export interface ShadowFailure {
  /** Which part of the capture was running when it failed. */
  readonly stage: 'scenario' | 'stack' | 'blockers' | 'discovery';
  readonly message: string;
}

interface DiscoveryShadowCaptureBase {
  readonly capturedAt: string;
  readonly campaignPosition: string;
  readonly blockerRepairs: readonly BlockerRepairObservation[];
  readonly scenario: ShadowScenarioRecord;
}

/**
 * A capture carries EITHER a trace or a failure, never neither. Two optional
 * fields would make "no trace and no failure" representable, and that shape is
 * exactly the green-looking nothing design section 13.3 forbids.
 */
export type DiscoveryShadowCapture = DiscoveryShadowCaptureBase &
  (
    | { readonly trace: ProjectedDiscoveryTrace; readonly failure?: undefined }
    | { readonly trace?: undefined; readonly failure: ShadowFailure }
  );

export type DiscoveryShadowEvidence = DiscoveryShadowCapture & {
  readonly schema: typeof DISCOVERY_SHADOW_SCHEMA;
  readonly runtime: RuntimeDiscoveryObservations;
  /**
   * Design section 12.3: presence in a packet is never evidence that the model
   * used the material. Shadow mode injects nothing at all, so the non-claim is
   * recorded explicitly rather than left to a reader's restraint.
   */
  readonly modelUsageClaim: null;
};

export interface ShadowDiscoveryInput {
  readonly db: Db;
  /** Canonical chronology anchor the seam is bound to; a human turn label will not parse. */
  readonly campaignPosition: string;
  readonly capturedAt: string;
  readonly playerInput: string;
  readonly actingCharacterId?: string;
  /** The live state snapshot, walked generically by the signals stage. */
  readonly stateFields: Readonly<Record<string, unknown>>;
  readonly itemInstances: readonly ShadowItemInstanceBinding[];
  readonly adventure?: ShadowAdventureSeat;
  readonly adventureSeatNotes?: readonly string[];
  readonly resolveAdventureModule?: (
    moduleId: string,
  ) => AdventureModule | undefined;
  /**
   * Resolver for packs the campaign binds that core does not bundle.
   *
   * The capture MEMOIZES it, so every resolution this capture triggers — its
   * own strict stack, B3's call into the real deterministic lookup, and the
   * discovery run — is built from the same pack objects. Nothing contracts a
   * `CampaignRulesPackResolver` to be pure or to keep answering; without the
   * memo the blocker statuses could qualify one source resolution while the
   * persisted trace described another.
   */
  readonly resolveRulesPack?: CampaignRulesPackResolver;
  /**
   * The jhpt read seam, already bound to `campaignPosition` by its owner.
   * Discovery is handed a seam and never reaches for the campaign-rule store
   * to build one (design section 8.4).
   */
  readonly campaignRuleSeam: CampaignRuleReadSeam;
  readonly tools: BlockerToolSchemaSource;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function captureDiscoveryShadow(
  input: ShadowDiscoveryInput,
): DiscoveryShadowCapture {
  const base = {
    capturedAt: input.capturedAt,
    campaignPosition: input.campaignPosition,
  };
  // EVERY shadow-only operation is inside this one guard, tracking which part
  // was running — the adventure-source read included, because the resolver is
  // caller-supplied and nothing contracts it to succeed. That makes this
  // function TOTAL: it always returns a capture, so the orchestrator's
  // observation point needs no guard of its own and cannot destabilize a turn.
  // A failure is still reported; an empty capture that reads as a green
  // nothing would be the worse outcome.
  let stage: ShadowFailure['stage'] = 'scenario';
  let blockerRepairs: readonly BlockerRepairObservation[] = [];
  let scenarioRecord: ShadowScenarioRecord = {
    playerInput: input.playerInput,
    stateFieldRoots: [],
    itemInstances: [],
    adventureSeatNotes: [],
  };
  try {
    // The caller hands in a memoized resolver, so this reads the adventure
    // source the real turn already resolved rather than a second time.
    const module =
      input.adventure === undefined
        ? undefined
        : input.resolveAdventureModule?.(input.adventure.moduleId);
    scenarioRecord = {
      playerInput: input.playerInput,
      ...(input.actingCharacterId === undefined
        ? {}
        : { actingCharacterId: input.actingCharacterId }),
      stateFieldRoots: Object.keys(input.stateFields).map((key) => `/${key}`),
      itemInstances: input.itemInstances,
      ...(input.adventure === undefined
        ? {}
        : {
            adventure: input.adventure,
            adventureModuleResolved: module !== undefined,
          }),
      adventureSeatNotes: input.adventureSeatNotes ?? [],
    };
    const scenario: DiscoveryScenario = {
      playerInput: input.playerInput,
      ...(input.actingCharacterId === undefined
        ? {}
        : { actingCharacterId: input.actingCharacterId }),
      stateFields: input.stateFields,
      itemInstances: input.itemInstances,
      ...(input.adventure === undefined || module === undefined
        ? {}
        : {
            adventure: {
              moduleId: input.adventure.moduleId,
              ...(input.adventure.locationId === undefined
                ? {}
                : { locationId: input.adventure.locationId }),
              ...(input.adventure.encounterId === undefined
                ? {}
                : { encounterId: input.adventure.encounterId }),
              module,
            },
          }),
    };
    // The stack is resolved ONCE and threaded through, and the resolver behind
    // it is memoized, so the blocker probes and the discovery run cannot end up
    // qualifying and tracing two different resolutions of the campaign's packs.
    stage = 'stack';
    // The B3 probe deliberately calls the real deterministic lookup, which
    // resolves the stack itself; that call is the discriminator and must not be
    // replaced by a pinned stack. Memoizing the resolver keeps it honest
    // anyway: it still resolves, but from the packs everything else here saw.
    const resolveRulesPack = memoizeCampaignRulesPackResolver(
      input.resolveRulesPack,
    );
    const stack = resolveStrictCampaignRulesStack(input.db, resolveRulesPack);
    stage = 'blockers';
    blockerRepairs = observeBlockerRepairs({
      db: input.db,
      stack,
      tools: input.tools,
      ...(resolveRulesPack === undefined ? {} : { resolveRulesPack }),
      adventureResolverSupplied: input.resolveAdventureModule !== undefined,
    });
    stage = 'discovery';
    const trace = runDiscoveryStages({
      db: input.db,
      scenario,
      stack,
      campaignPosition: input.campaignPosition,
      campaignRuleSeam: input.campaignRuleSeam,
      ...(resolveRulesPack === undefined
        ? {}
        : { rulesPackResolver: resolveRulesPack }),
    });
    return {
      ...base,
      blockerRepairs,
      scenario: scenarioRecord,
      trace: projectDiscoveryTrace(trace),
    };
  } catch (error) {
    return {
      ...base,
      blockerRepairs,
      scenario: scenarioRecord,
      failure: { stage, message: message(error) },
    };
  }
}

/**
 * A capability invocation as the tool layer observes it.
 *
 * Declared structurally so discovery imports nothing from the orchestrator: the
 * runtime hands its observation in, and the tool registry's own
 * `CapabilityInvocationObservation` satisfies this without either side
 * depending on the other's module.
 */
export interface ObservedCapabilityInvocation {
  readonly tool: string;
  readonly instanceId: string;
  readonly capabilityId: string;
  readonly revision: string;
  readonly status: 'available' | 'blocked';
  readonly subject: {
    readonly recordKey: string;
    readonly variantId?: string;
    readonly operationId: string;
  };
}

/**
 * Project one observed capability invocation into the durable W9 shape.
 *
 * Discovery owns the durable evidence shape, so it owns this projection rather
 * than leaving each caller to spell it out — a caller-side mapping is one more
 * place for the recorded fields to drift from the ones the reader validates and
 * M10 consumes. The `attempt` comes from the turn, which is the only layer that
 * knows which primary-DM candidate was running.
 */
export function runtimeCapabilityInvocation(
  observation: ObservedCapabilityInvocation,
  attempt: number,
): RuntimeCapabilityInvocation {
  return {
    tool: observation.tool,
    attempt,
    instanceId: observation.instanceId,
    recordKey: observation.subject.recordKey,
    ...(observation.subject.variantId === undefined
      ? {}
      : { variantId: observation.subject.variantId }),
    operationId: observation.subject.operationId,
    capabilityId: observation.capabilityId,
    capabilityRevision: observation.revision,
    outcome: observation.status,
  };
}

/**
 * Attach the turn's recorded runtime observations to a capture.
 *
 * The observations are handed in already recorded. Nothing here infers a
 * capability invocation from a tool result, an inventory snapshot, or the
 * accepted candidate's tool calls: a capability invocation and the terminal
 * result of the tool containing it are different events, and only the first is
 * M10's subject. This module serializes observations; it does not observe.
 */
export function completeDiscoveryShadowEvidence(
  capture: DiscoveryShadowCapture,
  runtime: RuntimeDiscoveryObservations,
): DiscoveryShadowEvidence {
  return {
    ...capture,
    schema: DISCOVERY_SHADOW_SCHEMA,
    runtime,
    modelUsageClaim: null,
  };
}

/**
 * Hand the evidence to the existing turn-trace seam. The seam stores an opaque
 * JSON value on purpose: the shape belongs to discovery, and duplicating it
 * inside `memory/turnTrace.ts` would make the memory module an owner of
 * discovery's schema.
 *
 * The round-trip is not ceremony. The packet carries projected source prose
 * straight from the rules pack, whose optional fields are `undefined` rather
 * than absent, so the object is not a `TraceJsonValue` until it has been
 * through `JSON`. Asserting the type instead would put a value in the column
 * that never satisfied it.
 */
export function encodeDiscoveryShadowEvidence(
  evidence: DiscoveryShadowEvidence,
): TraceJsonValue {
  return JSON.parse(JSON.stringify(evidence)) as TraceJsonValue;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class DiscoveryShadowSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscoveryShadowSchemaError';
  }
}

/**
 * Fail-closed structural validation of a stored v1 row.
 *
 * The TypeScript union that makes "neither a trace nor a failure" impossible
 * lives only in memory; the SQLite JSON boundary erases every guarantee, so
 * without this a row of `{"schema":"discovery-shadow-v1"}` would be cast
 * straight back into evidence and measured as a green nothing. Checking only
 * the common fields is not enough either: a row missing
 * `ruleJoin.requestedRuleRecordKeys` would pass a shallow check and then make
 * M5 spread `undefined`, and an arbitrary `outcome` string would be accepted as
 * stage accounting.
 *
 * The rule applied below is therefore: **every field M1-M11 or baseline
 * qualification dereferences is validated, with its enum and its cross-field
 * invariant.** Fields nothing consumes are not invented here.
 */

type Check = (value: unknown, path: string) => void;

function failAt(path: string, detail: string): never {
  throw new DiscoveryShadowSchemaError(
    `recorded ${DISCOVERY_SHADOW_SCHEMA} evidence is malformed at ${path}: ${detail}`,
  );
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (!isObject(value)) failAt(path, 'expected an object');
  return value;
}

function asArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) failAt(path, 'expected an array');
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string') failAt(path, 'expected a string');
  return value;
}

function asNumber(value: unknown, path: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value))
    failAt(path, 'expected a finite number');
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') failAt(path, 'expected a boolean');
  return value;
}

function asEnum(
  value: unknown,
  path: string,
  allowed: readonly string[],
): string {
  const text = asString(value, path);
  if (!allowed.includes(text))
    failAt(path, `'${text}' is not one of ${allowed.join(', ')}`);
  return text;
}

function optional(value: unknown, path: string, check: Check): void {
  if (value !== undefined && value !== null) check(value, path);
}

function each(value: unknown, path: string, check: Check): void {
  asArray(value, path).forEach((item, index) => {
    check(item, `${path}[${index}]`);
  });
}

function strings(value: unknown, path: string): void {
  each(value, path, (item, at) => {
    asString(item, at);
  });
}

const STAGE_OUTCOMES = ['ran', 'skipped', 'failed-to-run'] as const;
const RULING_SCOPES = ['none', 'requested-ambiguities', 'all-active'] as const;
const CAPABILITY_STATUSES = [
  'available',
  'blocked',
  'not-evaluated-offline',
] as const;
const BANDS = ['must-consider', 'related', 'exploratory'] as const;
const BLOCKER_IDS = ['B1', 'B2', 'B3', 'B4', 'B5'] as const;
const BLOCKER_STATUSES = [
  'repaired',
  'unrepaired',
  'not-discriminable',
] as const;
const CAPABILITY_OUTCOMES = ['available', 'blocked'] as const;
const AUDIT_VERDICTS = ['accept', 'reject'] as const;
const AUDIT_ACTIONS = ['accept', 'repair', 'retry', 'fail'] as const;
const FAILURE_STAGES = ['scenario', 'stack', 'blockers', 'discovery'] as const;

/** M3 reads each route's class/trigger/signal identity; M1/M2 read the rest. */
function checkRoutes(value: unknown, path: string): void {
  each(value, path, (route, at) => {
    const fields = asObject(route, at);
    asString(fields.routeClass, `${at}.routeClass`);
    asString(fields.trigger, `${at}.trigger`);
    asString(fields.signalId, `${at}.signalId`);
    asObject(fields.evidence, `${at}.evidence`);
  });
}

/**
 * The ambiguity identity M5 consumes, in every place it consumes one.
 *
 * `unqueriedAmbiguityIds` and `unresolvedAmbiguityIds` both read `id` and then
 * `.filter((id) => typeof id === 'string')`. Validating only that the container
 * is an array of objects would let `{}` or `{id: 7}` be stored and then simply
 * vanish from the measurement — the same "malformed identity becomes absence"
 * defect the reader exists to prevent.
 */
function checkAmbiguityIdentity(value: unknown, path: string): void {
  asString(asObject(value, path).id, `${path}.id`);
}

/** The jhpt-owned projection identity the packet carries as evidence. */
function checkRuleIdentity(value: unknown, path: string): void {
  asString(asObject(value, path).ruleIdentity, `${path}.ruleIdentity`);
}

/** M4 deep-equals a declared traversal against these. */
function checkTraversals(value: unknown, path: string): void {
  each(value, path, (traversal, at) => {
    const fields = asObject(traversal, at);
    for (const key of [
      'sourceRecordKey',
      'linkField',
      'relation',
      'targetRecordKey',
    ])
      asString(fields[key], `${at}.${key}`);
  });
}

function checkDrops(value: unknown, path: string): void {
  each(value, path, (drop, at) => {
    const fields = asObject(drop, at);
    asString(fields.candidateKey, `${at}.candidateKey`);
    asEnum(fields.band, `${at}.band`, BANDS);
    asString(fields.reason, `${at}.reason`);
    checkRoutes(fields.routes, `${at}.routes`);
  });
}

/**
 * The v1 stage contract, declared HERE rather than imported from the producer.
 *
 * A validator that reads the producer's own constant cannot catch the producer
 * drifting: both sides would move together and every recorded row would stay
 * "valid" by construction. This table is the checker's independent statement of
 * the accepted contract — design section 12.1's stage sequence, and section
 * 13.3's rule that ONLY the two conditional stages may report `skipped`.
 */
const V1_STAGES: readonly {
  readonly property: string;
  readonly name: string;
  readonly conditional: boolean;
}[] = [
  { property: 'signals', name: 'signals', conditional: false },
  { property: 'candidates', name: 'candidates', conditional: false },
  { property: 'expansion', name: 'expansion', conditional: false },
  { property: 'ruleJoin', name: 'rule-join', conditional: false },
  {
    property: 'ruleExpansion',
    name: 'campaign-rule-expansion',
    conditional: true,
  },
  { property: 'lateRuleJoin', name: 'late-ruling-join', conditional: true },
  { property: 'dedup', name: 'dedup', conditional: false },
  { property: 'retention', name: 'retention', conditional: false },
  { property: 'packet', name: 'packet', conditional: false },
];

/**
 * Stage accounting integrity.
 *
 * `produced`, `modified` and `carriedForward` are a PARTITION of the identities
 * the stage emitted: each identity appears exactly once across the three, and
 * nothing appears that was not emitted. Validating the three as bare string
 * arrays would let a row claim work over an identity it never emitted, or omit
 * an emitted one, and M2's loss attribution and the per-stage report would
 * quietly describe a stage that never existed.
 */
function checkAccounting(
  stage: Record<string, unknown>,
  path: string,
  emitted: readonly string[],
): void {
  const accounted = [
    ...(stage.produced as string[]),
    ...(stage.modified as string[]),
    ...(stage.carriedForward as string[]),
  ];
  if (new Set(accounted).size !== accounted.length)
    failAt(path, 'produced/modified/carriedForward repeat an identity');
  if (new Set(emitted).size !== emitted.length)
    failAt(path, 'outputsProduced repeats an emitted identity');
  if (accounted.length !== emitted.length)
    failAt(
      path,
      `accounts for ${accounted.length} identities but emitted ${emitted.length}`,
    );
  const emittedSet = new Set(emitted);
  for (const key of accounted)
    if (!emittedSet.has(key))
      failAt(path, `accounts for '${key}', which it did not emit`);
}

function checkStage(
  value: unknown,
  path: string,
  declared: { readonly name: string; readonly conditional: boolean },
): Record<string, unknown> {
  const stage = asObject(value, path);
  if (asString(stage.stage, `${path}.stage`) !== declared.name)
    failAt(
      `${path}.stage`,
      `is '${String(stage.stage)}', not the v1 stage '${declared.name}'`,
    );
  asArray(stage.outputsProduced, `${path}.outputsProduced`);
  for (const key of ['produced', 'modified', 'carriedForward'])
    strings(stage[key], `${path}.${key}`);
  each(stage.losses, `${path}.losses`, (loss, at) => {
    const fields = asObject(loss, at);
    asString(fields.reason, `${at}.reason`);
    asObject(fields.detail, `${at}.detail`);
  });
  const outcome = asEnum(stage.outcome, `${path}.outcome`, STAGE_OUTCOMES);
  const failedToRun = asBoolean(stage.failedToRun, `${path}.failedToRun`);
  // Section 13.3 gives these two one meaning; a row where they disagree would
  // let a failed stage read as a pass in exactly one of the two places a
  // measurement looks.
  if (failedToRun !== (outcome === 'failed-to-run'))
    failAt(
      `${path}.failedToRun`,
      `is ${String(failedToRun)} while outcome is '${outcome}'`,
    );
  // Only a conditional stage may be `skipped`, and only a non-conditional one
  // can fail to run: a mandatory stage that recorded nothing has failed, and
  // calling that a conditional skip is precisely how "recognizing nothing looks
  // green" gets into durable evidence.
  if (outcome === 'skipped' && !declared.conditional)
    failAt(
      `${path}.outcome`,
      `'${declared.name}' is not a conditional stage and may not report 'skipped'`,
    );
  if (outcome === 'failed-to-run' && declared.conditional)
    failAt(
      `${path}.outcome`,
      `'${declared.name}' is conditional and reports 'skipped', never 'failed-to-run'`,
    );
  // Both non-`ran` outcomes mean the stage did NO WORK. Pass-through is not
  // work (section 12.1), so `carriedForward` and forwarded output stay legal;
  // produced candidates, modifications and losses do not.
  if (outcome !== 'ran')
    for (const key of ['produced', 'modified', 'losses'])
      if ((stage[key] as unknown[]).length > 0)
        failAt(
          `${path}.${key}`,
          `is non-empty on a stage that reports '${outcome}', which means it did no work`,
        );
  return stage;
}

function checkCandidateStage(
  value: unknown,
  path: string,
  declared: { readonly name: string; readonly conditional: boolean },
  banded: boolean,
) {
  const stage = checkStage(value, path, declared);
  const emitted: string[] = [];
  each(stage.outputsProduced, `${path}.outputsProduced`, (item, at) => {
    const fields = asObject(item, at);
    emitted.push(asString(fields.candidateKey, `${at}.candidateKey`));
    asString(fields.targetKind, `${at}.targetKind`);
    checkRoutes(fields.routes, `${at}.routes`);
    checkTraversals(fields.traversals, `${at}.traversals`);
    strings(fields.campaignRuleIdentities, `${at}.campaignRuleIdentities`);
    strings(fields.campaignRulingIdentities, `${at}.campaignRulingIdentities`);
    if (banded) asEnum(fields.band, `${at}.band`, BANDS);
  });
  checkAccounting(stage, path, emitted);
  return stage;
}

function checkRuleJoin(
  value: unknown,
  path: string,
  declared: { readonly name: string; readonly conditional: boolean },
): void {
  const stage = checkCandidateStage(value, path, declared, false);
  for (const key of [
    'requestedRuleRecordKeys',
    'requestedAmbiguityIds',
    'returnedRuleIdentities',
    'returnedAmbiguityIds',
    'placedRuleIdentities',
    'unplacedRuleIdentities',
    'surfacedCandidateKeys',
    'resolvedAmbiguityIds',
  ])
    strings(stage[key], `${path}.${key}`);
  asEnum(stage.rulingQueryScope, `${path}.rulingQueryScope`, RULING_SCOPES);
  asBoolean(stage.ruleQueryExecuted, `${path}.ruleQueryExecuted`);
  asBoolean(stage.rulingQueryExecuted, `${path}.rulingQueryExecuted`);
  each(stage.placedRules, `${path}.placedRules`, (placed, at) => {
    const fields = asObject(placed, at);
    asString(fields.ruleIdentity, `${at}.ruleIdentity`);
    asString(fields.governingRecordKey, `${at}.governingRecordKey`);
  });
  // M5 reads these ids and filters non-strings, so a malformed identity would
  // become an ABSENCE from `unresolvedAmbiguityIds` rather than a rejection.
  each(
    stage.unresolvedAmbiguities,
    `${path}.unresolvedAmbiguities`,
    checkAmbiguityIdentity,
  );
}

function checkPacket(
  value: unknown,
  path: string,
  declared: { readonly name: string; readonly conditional: boolean },
): void {
  const stage = checkStage(value, path, declared);
  asBoolean(stage.byteBudgetExceeded, `${path}.byteBudgetExceeded`);
  checkDrops(stage.byteOverflow, `${path}.byteOverflow`);
  checkDrops(stage.dropped, `${path}.dropped`);
  const packet = asObject(stage.packet, `${path}.packet`);
  asNumber(packet.bytes, `${path}.packet.bytes`);
  asArray(packet.projectionLimitNotes, `${path}.packet.projectionLimitNotes`);
  if (packet.modelUsageClaim !== null)
    failAt(`${path}.packet.modelUsageClaim`, 'expected the non-claim `null`');
  const emitted: string[] = [];
  each(packet.candidates, `${path}.packet.candidates`, (item, at) => {
    const candidate = asObject(item, at);
    const identity = asObject(candidate.identity, `${at}.identity`);
    emitted.push(asString(identity.key, `${at}.identity.key`));
    for (const key of ['kind', 'name'])
      asString(identity[key], `${at}.identity.${key}`);
    const provenance = asObject(candidate.provenance, `${at}.provenance`);
    asString(provenance.sourceRef, `${at}.provenance.sourceRef`);
    asString(provenance.source, `${at}.provenance.source`);
    if (!('license' in provenance))
      failAt(`${at}.provenance.license`, 'is absent');
    asObject(candidate.sourceProse, `${at}.sourceProse`);
    checkRoutes(candidate.routes, `${at}.routes`);
    checkTraversals(candidate.traversals, `${at}.traversals`);
    each(candidate.ambiguities, `${at}.ambiguities`, checkAmbiguityIdentity);
    for (const key of ['campaignRules', 'campaignRulings'])
      each(candidate[key], `${at}.${key}`, checkRuleIdentity);
    asArray(candidate.projectionLimits, `${at}.projectionLimits`);
    optional(candidate.capability, `${at}.capability`, checkCapability);
  });
  // The packet's outputs ARE its candidates, so the accounting is checked
  // against the same list M1, M3 and M7 read.
  checkAccounting(stage, path, emitted);
  if (
    asArray(stage.outputsProduced, `${path}.outputsProduced`).length !==
    emitted.length
  )
    failAt(
      `${path}.outputsProduced`,
      `holds ${(stage.outputsProduced as unknown[]).length} entries while the packet holds ${emitted.length}`,
    );
  // M7 reports these bytes as the packet's size. A finite but fabricated count
  // is not evidence, so it is recomputed from the recorded candidates using the
  // representation v1 writes.
  const recomputed = Buffer.byteLength(
    JSON.stringify(packet.candidates),
    'utf8',
  );
  if (packet.bytes !== recomputed)
    failAt(
      `${path}.packet.bytes`,
      `records ${String(packet.bytes)} but the recorded candidates serialize to ${recomputed}`,
    );
}

/**
 * A packet capability preflight.
 *
 * An EVALUATED status is a bounded commitment and must name the identity,
 * revision and operation it was made under, or M10 could not require a runtime
 * event to match it — and deleting `revision` would silently downgrade a
 * malformed row into a merely "non-comparable" measurement.
 */
function checkCapability(value: unknown, path: string): void {
  const capability = asObject(value, path);
  const status = asEnum(
    capability.status,
    `${path}.status`,
    CAPABILITY_STATUSES,
  );
  for (const key of ['capabilityId', 'revision', 'operationId'])
    if (status === 'not-evaluated-offline')
      optional(capability[key], `${path}.${key}`, (x, w) => {
        asString(x, w);
      });
    else asString(capability[key], `${path}.${key}`);
  optional(capability.variantId, `${path}.variantId`, (x, w) => {
    asString(x, w);
  });
}

function checkTrace(value: unknown, path: string): void {
  const trace = asObject(value, path);
  const declared = (property: string) => {
    const entry = V1_STAGES.find((item) => item.property === property);
    if (entry === undefined) throw new Error(`unknown v1 stage ${property}`);
    return entry;
  };

  const signals = checkStage(
    trace.signals,
    `${path}.signals`,
    declared('signals'),
  );
  const signalIds: string[] = [];
  each(
    signals.outputsProduced,
    `${path}.signals.outputsProduced`,
    (item, at) => {
      const signal = asObject(item, at);
      signalIds.push(asString(signal.signalId, `${at}.signalId`));
      asString(signal.kind, `${at}.kind`);
      asString(signal.proposes, `${at}.proposes`);
    },
  );
  checkAccounting(signals, `${path}.signals`, signalIds);
  for (const key of [
    'unconsumedStateFields',
    'stateBindings',
    'ambiguousNames',
  ])
    asArray(signals[key], `${path}.signals.${key}`);
  strings(
    signals.oracleSuppliedSignalLabels,
    `${path}.signals.oracleSuppliedSignalLabels`,
  );

  const candidates = checkCandidateStage(
    trace.candidates,
    `${path}.candidates`,
    declared('candidates'),
    false,
  );
  strings(candidates.unresolvedTargets, `${path}.candidates.unresolvedTargets`);
  for (const key of ['expansion', 'ruleExpansion']) {
    const stage = checkCandidateStage(
      trace[key],
      `${path}.${key}`,
      declared(key),
      false,
    );
    checkTraversals(stage.traversals, `${path}.${key}.traversals`);
  }
  checkRuleJoin(trace.ruleJoin, `${path}.ruleJoin`, declared('ruleJoin'));
  checkRuleJoin(
    trace.lateRuleJoin,
    `${path}.lateRuleJoin`,
    declared('lateRuleJoin'),
  );
  checkCandidateStage(trace.dedup, `${path}.dedup`, declared('dedup'), false);
  const dedup = asObject(trace.dedup, `${path}.dedup`);
  for (const key of ['routeCountBeforeDedup', 'routeCountAfterDedup'])
    for (const [name, count] of Object.entries(
      asObject(dedup[key], `${path}.dedup.${key}`),
    ))
      asNumber(count, `${path}.dedup.${key}.${name}`);
  const retention = checkCandidateStage(
    trace.retention,
    `${path}.retention`,
    declared('retention'),
    true,
  );
  checkDrops(retention.dropped, `${path}.retention.dropped`);
  checkDrops(retention.overflow, `${path}.retention.overflow`);
  const overflowed = asBoolean(
    retention.overflowed,
    `${path}.retention.overflowed`,
  );
  // M6 reads the flag; a row where the flag and the record disagree would let
  // an overflow that section 6.3 says fails the probe report as clean.
  if (overflowed !== (retention.overflow as unknown[]).length > 0)
    failAt(
      `${path}.retention.overflowed`,
      `is ${String(overflowed)} while ${(retention.overflow as unknown[]).length} overflow record(s) are present`,
    );
  checkPacket(trace.packet, `${path}.packet`, declared('packet'));

  strings(trace.unexpandedPromotions, `${path}.unexpandedPromotions`);
  strings(trace.stageOrder, `${path}.stageOrder`);
  const order = trace.stageOrder as string[];
  const expected = V1_STAGES.map((stage) => stage.name);
  if (
    order.length !== expected.length ||
    order.some((n, i) => n !== expected[i])
  )
    failAt(
      `${path}.stageOrder`,
      `is [${order.join(', ')}], not the v1 order [${expected.join(', ')}]`,
    );
  const stack = asObject(trace.stack, `${path}.stack`);
  const packIdentity: Check = (raw, where) => {
    const pack = asObject(raw, where);
    for (const key of ['systemId', 'packId', 'version', 'role'])
      asString(pack[key], `${where}.${key}`);
  };
  packIdentity(stack.base, `${path}.stack.base`);
  each(stack.addons, `${path}.stack.addons`, packIdentity);
}

/**
 * The five pre-experiment blockers a capture must qualify itself against.
 *
 * Declared here rather than read from `observeBlockerRepairs()` for the same
 * reason as the stage table: a checker that asks the producer what it produced
 * proves nothing. An empty or partial list is the dangerous shape — every
 * `every(status === 'repaired')` baseline check passes vacuously over it.
 */
const V1_BLOCKERS: readonly string[] = ['B1', 'B2', 'B3', 'B4', 'B5'];

function checkBlockerMembership(
  observations: readonly unknown[],
  complete: boolean,
): void {
  const seen = observations.map(
    (item) => (item as Record<string, unknown>).blockerId as string,
  );
  const unique = new Set(seen);
  if (unique.size !== seen.length)
    failAt('blockerRepairs', 'repeats a blocker id');
  if (!complete) {
    for (const id of seen)
      if (!V1_BLOCKERS.includes(id))
        failAt('blockerRepairs', `records unknown blocker '${id}'`);
    return;
  }
  for (const id of V1_BLOCKERS)
    if (!unique.has(id))
      failAt(
        'blockerRepairs',
        `omits ${id}; a capture that reached discovery observed all of ${V1_BLOCKERS.join(', ')}`,
      );
  if (unique.size !== V1_BLOCKERS.length)
    failAt(
      'blockerRepairs',
      `records ${unique.size} blockers, not the ${V1_BLOCKERS.length} the capture observes`,
    );
}

function assertV1(stored: Record<string, unknown>): void {
  asString(stored.campaignPosition, 'campaignPosition');
  asString(stored.capturedAt, 'capturedAt');
  if (stored.modelUsageClaim !== null)
    failAt('modelUsageClaim', 'expected the recorded non-claim `null`');

  const scenario = asObject(stored.scenario, 'scenario');
  asString(scenario.playerInput, 'scenario.playerInput');
  strings(scenario.stateFieldRoots, 'scenario.stateFieldRoots');
  strings(scenario.adventureSeatNotes, 'scenario.adventureSeatNotes');
  each(scenario.itemInstances, 'scenario.itemInstances', (item, at) => {
    const binding = asObject(item, at);
    asString(binding.instanceId, `${at}.instanceId`);
    asString(binding.recordKey, `${at}.recordKey`);
    optional(binding.variantId, `${at}.variantId`, (x, w) => {
      asString(x, w);
    });
  });
  optional(scenario.adventure, 'scenario.adventure', (raw, where) => {
    const seat = asObject(raw, where);
    asString(seat.moduleId, `${where}.moduleId`);
    for (const key of ['locationId', 'encounterId'])
      optional(seat[key], `${where}.${key}`, (x, w) => {
        asString(x, w);
      });
  });

  // Baseline qualification reads these, so a malformed or incomplete set would
  // let a capture be read as a baseline on a status nothing produced.
  const blockers = asArray(stored.blockerRepairs, 'blockerRepairs');
  each(blockers, 'blockerRepairs', (item, at) => {
    const observation = asObject(item, at);
    asEnum(observation.blockerId, `${at}.blockerId`, BLOCKER_IDS);
    asEnum(observation.status, `${at}.status`, BLOCKER_STATUSES);
    asString(observation.owner, `${at}.owner`);
    asString(observation.evidence, `${at}.evidence`);
    strings(observation.gates, `${at}.gates`);
  });

  const runtime = asObject(stored.runtime, 'runtime');
  // Every recorded invocation is an EVENT, so every identity field is
  // mandatory. There is no partial-identity path to soften.
  each(
    runtime.capabilityInvocations,
    'runtime.capabilityInvocations',
    (item, at) => {
      const fields = asObject(item, at);
      for (const key of [
        'tool',
        'instanceId',
        'recordKey',
        'operationId',
        'capabilityId',
        'capabilityRevision',
      ])
        asString(fields[key], `${at}.${key}`);
      optional(fields.variantId, `${at}.variantId`, (x, w) => {
        asString(x, w);
      });
      asEnum(fields.outcome, `${at}.outcome`, CAPABILITY_OUTCOMES);
      asNumber(fields.attempt, `${at}.attempt`);
      const attempt = fields.attempt as number;
      if (!Number.isInteger(attempt) || attempt < 1)
        failAt(
          `${at}.attempt`,
          `is ${String(attempt)}; a candidate attempt is an integer from 1`,
        );
    },
  );

  // M11's `auditorAbsent` is derived from this flag, never from an empty
  // attempt list: "no auditor ran" and "the auditor recorded nothing" are
  // different facts, and inferring the first from the second is how an empty
  // evidence collection becomes a green flag.
  const auditorPresent = asBoolean(
    runtime.auditorPresent,
    'runtime.auditorPresent',
  );
  const attempts = asArray(runtime.auditAttempts, 'runtime.auditAttempts');
  each(attempts, 'runtime.auditAttempts', (item, at) => {
    const fields = asObject(item, at);
    asNumber(fields.attempt, `${at}.attempt`);
    asEnum(fields.verdict, `${at}.verdict`, AUDIT_VERDICTS);
    const action = asEnum(fields.action, `${at}.action`, AUDIT_ACTIONS);
    strings(fields.missingTools, `${at}.missingTools`);
    if (fields.retryCause !== null)
      asString(fields.retryCause, `${at}.retryCause`);
    // An accepted verdict can only have been accepted; a rejected one cannot
    // have been.
    const accepted = fields.verdict === 'accept';
    if (accepted !== (action === 'accept'))
      failAt(
        `${at}.action`,
        `'${action}' is not coherent with verdict '${String(fields.verdict)}'`,
      );
  });
  if (!auditorPresent && attempts.length > 0)
    failAt(
      'runtime.auditAttempts',
      `records ${attempts.length} attempt(s) while runtime.auditorPresent is false`,
    );
  if (auditorPresent && attempts.length === 0)
    failAt(
      'runtime.auditAttempts',
      'is empty while runtime.auditorPresent is true; an auditor that ran recorded at least one verdict',
    );
  attempts.forEach((item, index) => {
    const attempt = (item as Record<string, unknown>).attempt;
    if (attempt !== index + 1)
      failAt(
        `runtime.auditAttempts[${index}].attempt`,
        `is ${String(attempt)}; audited candidates are numbered sequentially from 1`,
      );
  });
  if (attempts.length > 0) {
    const last = attempts[attempts.length - 1] as Record<string, unknown>;
    // This evidence hangs off an ACCEPTED turn trace, so the audit history
    // cannot end in a retry that never happened or a turn-failing verdict.
    if (last.action !== 'accept' && last.action !== 'repair')
      failAt(
        `runtime.auditAttempts[${attempts.length - 1}].action`,
        `is '${String(last.action)}'; a persisted accepted-turn trace ends in 'accept' or 'repair'`,
      );
  }

  const hasTrace = stored.trace !== undefined && stored.trace !== null;
  const hasFailure = stored.failure !== undefined && stored.failure !== null;
  if (hasTrace === hasFailure)
    failAt(
      'trace/failure',
      hasTrace
        ? 'it carries both a trace and a failure'
        : 'it carries neither a trace nor a failure',
    );
  if (hasFailure) {
    const failure = asObject(stored.failure, 'failure');
    const stage = asEnum(failure.stage, 'failure.stage', FAILURE_STAGES);
    asString(failure.message, 'failure.message');
    // A capture that failed IN discovery had already completed its blocker
    // observations, so the same complete set is required. A capture that failed
    // earlier could not have observed them, and inventing observations it never
    // made would be worse than recording none.
    checkBlockerMembership(blockers, stage === 'discovery');
    return;
  }
  checkBlockerMembership(blockers, true);
  checkTrace(stored.trace, 'trace');
}

/**
 * Read shadow evidence back off a recorded turn trace.
 *
 * A stored value carrying a schema tag this build does not know is an error,
 * not an absence: measuring it as if it were absent would report a green
 * nothing for a capture that exists. Same-version corruption fails closed the
 * same way, through {@link assertV1}.
 */
export function readDiscoveryShadowEvidence(
  stored: TraceJsonValue | undefined,
): DiscoveryShadowEvidence | undefined {
  if (stored === undefined || stored === null) return undefined;
  if (!isObject(stored))
    throw new DiscoveryShadowSchemaError(
      'recorded discovery shadow evidence is not a JSON object',
    );
  const schema = stored.schema;
  if (schema !== DISCOVERY_SHADOW_SCHEMA)
    throw new DiscoveryShadowSchemaError(
      `recorded discovery shadow evidence has schema '${String(schema)}', not '${DISCOVERY_SHADOW_SCHEMA}'`,
    );
  assertV1(stored);
  return stored as unknown as DiscoveryShadowEvidence;
}
