import type { AdventureModule } from '../adventure/types.js';
import { isCampaignRuleKind } from '../campaign/campaignRules.js';
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
import type { RenderedContextPacket } from './packetMessage.js';
import { renderContextPacketMessage } from './packetMessage.js';
import type { ProjectedDiscoveryTrace } from './traceProjection.js';
import { projectDiscoveryTrace } from './traceProjection.js';
import type {
  CampaignRuleReadSeam,
  DiscoveryScenario,
  DiscoveryTrace,
  RuntimeCapabilityInvocation,
  RuntimeStateEffect,
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

export const DISCOVERY_SHADOW_SCHEMA = 'discovery-shadow-v2';

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
  /**
   * Which part of the capture was running when it failed. `render` exists
   * only for {@link captureDiscoveryIntervention}: a capture that reached a
   * live trace but could not turn it into DM-visible text is a capture
   * failure, not a successful capture with nothing to show for it — the same
   * "an observation point that can abort a turn is worse than none" reasoning
   * that governs the other four stages applies to rendering too, once the
   * packet is load-bearing.
   */
  readonly stage: 'scenario' | 'stack' | 'blockers' | 'discovery' | 'render';
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

/**
 * What actually reached the DM for this turn's discovery output, as one
 * canonical lifecycle rather than a boolean plus optional fields.
 *
 * `mode` alone cannot answer "did the DM get this?": an `intervene`-mode
 * request whose capture or render failed injects nothing, exactly like
 * `shadow` mode's request never tries to. A `{injected: boolean}` field beside
 * an independent `renderedSha256?` would let the two disagree — `injected:
 * true` with no identity, or `injected: false` with one left over from a
 * prior write path — so the identity fields live inside the `injected: true`
 * arm itself, where an impossible pairing cannot be constructed.
 *
 * - `observed` — shadow mode. Never injects; this is W9's contract, unchanged.
 * - `intervened` + `injected: true` — the rendered packet was appended to the
 *   DM's user message. `renderedSha256` binds this record to the exact text
 *   `turn_trace.retrieved_context` recorded for the turn, so a reader never
 *   has to trust that two independently written copies agree — there is only
 *   one copy, and this is its fingerprint.
 * - `intervened` + `injected: false` — intervention was requested but the
 *   capture or the render failed, so nothing reached the DM. `reason` carries
 *   the capture's own failure message. This arm, not an optional field a
 *   reader could forget to check, is why `ShadowDelivery` is a union: a reader
 *   asking "was this injected?" is answered by `mode`+`injected` together, and
 *   every other field it might want is only ever present on the arm where it
 *   means something.
 *
 * The injected arm carries ONLY facts about the delivered text — its size and
 * its fingerprint — and deliberately no summary of what discovery retained.
 * An earlier revision also stored `candidateCount` and `mustConsiderOverflow`
 * here. Both are already derivable from `capture.trace`'s canonical
 * dispositions, which is where M6 and M7 read them, so storing them again was
 * a second copy of a fact the trace owns: the same "derive one from the
 * other, never store both" rule this module applies to every stage summary
 * (`eshyra-o9bd.19.12.5`). A reader wanting the retained-candidate picture
 * measures the trace; `delivery` answers only whether the DM received the
 * packet, and exactly which bytes.
 */
export type ShadowDelivery =
  | { readonly mode: 'observed'; readonly injected: false }
  | {
      readonly mode: 'intervened';
      readonly injected: true;
      readonly renderedBytes: number;
      /**
       * SHA-256 of the rendered packet text, binding this evidence to the
       * message recorded in `turn_trace.retrieved_context`.
       */
      readonly renderedSha256: string;
    }
  | {
      readonly mode: 'intervened';
      readonly injected: false;
      readonly reason: string;
    };

export type DiscoveryShadowEvidence = DiscoveryShadowCapture & {
  readonly schema: typeof DISCOVERY_SHADOW_SCHEMA;
  readonly runtime: RuntimeDiscoveryObservations;
  /**
   * Design section 12.3: presence in a packet is never evidence that the
   * model used the material — true in `shadow` mode, which injects nothing,
   * and equally true in `intervene` mode, which may have injected something.
   * `delivery` says whether the DM received the packet; this field never
   * answers whether the DM attended to it.
   */
  readonly modelUsageClaim: null;
  /** What actually reached the DM for this turn. See {@link ShadowDelivery}. */
  readonly delivery: ShadowDelivery;
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

/**
 * The base fields every capture carries, paired with either the LIVE
 * discovery trace or the failure that stopped it before one existed.
 *
 * Kept apart from {@link DiscoveryShadowCapture}: `captureDiscoveryIntervention`
 * must render from the live trace (§7's source prose is dropped by
 * `projectDiscoveryTrace`, so a render from the projection would either fail
 * or quote nothing), while every durable and shadow-mode consumer wants the
 * projected form. This is the one place the live shape is allowed to exist
 * after discovery has run, so both entry points can build it once, from one
 * discovery execution, rather than each re-running `runDiscoveryStages`.
 */
type RawDiscoveryShadowCapture = DiscoveryShadowCaptureBase &
  (
    | { readonly trace: DiscoveryTrace; readonly failure?: undefined }
    | { readonly trace?: undefined; readonly failure: ShadowFailure }
  );

function captureRawShadow(
  input: ShadowDiscoveryInput,
): RawDiscoveryShadowCapture {
  const base = {
    capturedAt: input.capturedAt,
    campaignPosition: input.campaignPosition,
  };
  // EVERY shadow-only operation is inside this one guard, tracking which part
  // was running — the adventure-source read included, because the resolver is
  // caller-supplied and nothing contracts it to succeed. That makes this
  // function TOTAL: it always returns a capture, so both callers' observation
  // points need no guard of their own and cannot destabilize a turn. A
  // failure is still reported; an empty capture that reads as a green nothing
  // would be the worse outcome.
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
      trace,
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

/** Project a raw capture's live trace away, once, for every durable and
 * shadow-mode consumer. */
function projectCapture(
  raw: RawDiscoveryShadowCapture,
): DiscoveryShadowCapture {
  if (raw.trace === undefined)
    return {
      capturedAt: raw.capturedAt,
      campaignPosition: raw.campaignPosition,
      blockerRepairs: raw.blockerRepairs,
      scenario: raw.scenario,
      failure: raw.failure,
    };
  return {
    capturedAt: raw.capturedAt,
    campaignPosition: raw.campaignPosition,
    blockerRepairs: raw.blockerRepairs,
    scenario: raw.scenario,
    trace: projectDiscoveryTrace(raw.trace),
  };
}

export function captureDiscoveryShadow(
  input: ShadowDiscoveryInput,
): DiscoveryShadowCapture {
  return projectCapture(captureRawShadow(input));
}

/**
 * The intervention capture's result: the same durable capture
 * `captureDiscoveryShadow` would have recorded, plus what rendering it
 * produced.
 *
 * A union, not a capture beside an optional `rendered`, because the two
 * fields are not independent and the durable reader already refuses rows that
 * pretend they are. `assertV2` rejects `delivery.injected: false` under
 * `intervened` unless the capture carries a failure explaining it — so a
 * shape that let `rendered` be absent beside a trace-bearing capture would
 * oblige the orchestrator to invent a reason, and the row it then wrote would
 * fail its own admission. Pairing each arm with the capture shape that
 * belongs to it makes both halves unrepresentable instead: there is no
 * un-rendered success to explain, and no rendered failure to inject from.
 */
export type DiscoveryInterventionCapture =
  | {
      readonly capture: DiscoveryShadowCapture & {
        readonly trace: ProjectedDiscoveryTrace;
      };
      readonly rendered: RenderedContextPacket;
    }
  | {
      readonly capture: DiscoveryShadowCapture & {
        readonly failure: ShadowFailure;
      };
      /** Absent when the capture failed, so nothing can be injected. */
      readonly rendered?: undefined;
    };

/**
 * Design section 12.3 (Phase 3, `eshyra-o9bd.19.12`): run the SAME capture
 * path `captureDiscoveryShadow` runs, from the same discovery execution, and
 * additionally render the packet the orchestrator may inject.
 *
 * As total and failure-tolerant as the shadow capture: rendering runs inside
 * the same guarantee that a capture failure is RECORDED, never thrown into
 * the turn, so a render defect can make an experimental turn's context
 * plainer, never abort it. A render failure downgrades the whole capture to
 * a failure — never a trace-bearing capture with `rendered` left absent for
 * an unexplained reason — because {@link DiscoveryInterventionCapture}'s
 * contract is that `rendered`'s absence always has a `capture.failure`
 * beside it to explain it.
 */
export function captureDiscoveryIntervention(
  input: ShadowDiscoveryInput,
): DiscoveryInterventionCapture {
  const raw = captureRawShadow(input);
  if (raw.trace === undefined)
    return {
      capture: {
        capturedAt: raw.capturedAt,
        campaignPosition: raw.campaignPosition,
        blockerRepairs: raw.blockerRepairs,
        scenario: raw.scenario,
        failure: raw.failure,
      },
    };
  try {
    // Rendered from the LIVE trace before projection, and paired with the
    // projected capture in one expression, so the text the orchestrator may
    // inject and the evidence describing it come from one discovery run.
    const rendered = renderContextPacketMessage(raw.trace);
    return {
      capture: {
        capturedAt: raw.capturedAt,
        campaignPosition: raw.campaignPosition,
        blockerRepairs: raw.blockerRepairs,
        scenario: raw.scenario,
        trace: projectDiscoveryTrace(raw.trace),
      },
      rendered,
    };
  } catch (error) {
    return {
      capture: {
        capturedAt: raw.capturedAt,
        campaignPosition: raw.campaignPosition,
        blockerRepairs: raw.blockerRepairs,
        scenario: raw.scenario,
        failure: { stage: 'render', message: message(error) },
      },
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

export interface ObservedStateMutation {
  readonly tool: string;
  readonly args?: unknown;
}

/** Project already-filtered accepted mutations into discovery's event shape. */
export function acceptedStateEffects(
  calls: readonly ObservedStateMutation[],
  attempt: number,
): readonly RuntimeStateEffect[] {
  return calls.map((call, ordinal) => ({
    tool: call.tool,
    attempt,
    ordinal,
    args: isObject(call.args) ? call.args : {},
  }));
}

/**
 * Attach the turn's recorded runtime observations and delivery outcome to a
 * capture.
 *
 * The observations are handed in already recorded. Nothing here infers a
 * capability invocation from a tool result, an inventory snapshot, or the
 * accepted candidate's tool calls: a capability invocation and the terminal
 * result of the tool containing it are different events, and only the first is
 * M10's subject. This module serializes observations; it does not observe.
 *
 * `delivery` is likewise handed in rather than inferred from `capture`: the
 * orchestrator is the only party that knows whether it actually injected the
 * rendered text (design section 12.3), so it is the only party that can state
 * {@link ShadowDelivery} truthfully.
 */
export function completeDiscoveryShadowEvidence(
  capture: DiscoveryShadowCapture,
  runtime: RuntimeDiscoveryObservations,
  delivery: ShadowDelivery,
): DiscoveryShadowEvidence {
  return {
    ...capture,
    schema: DISCOVERY_SHADOW_SCHEMA,
    runtime,
    modelUsageClaim: null,
    delivery,
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
 * Fail-closed admission of a stored v2 row.
 *
 * The TypeScript shapes live only in memory; the SQLite JSON boundary erases
 * them, so without this a row of `{"schema":"discovery-shadow-v1"}` would be
 * cast straight back into evidence and measured as a green nothing.
 *
 * What this checks is deliberately NARROW, and that is the repair rather than a
 * gap. The durable record now holds canonical facts only — every summary M1-M11
 * reports is derived from them at measurement time — so there is no second copy
 * of any fact for a coordinated corruption to move. The reader's job is
 * therefore the admissibility of the canonical representation: schema, identity,
 * coverage of each decision set, and lifecycle legality. It is not, and must not
 * grow back into, a theorem set proving that stored summaries agree with each
 * other.
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

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) failAt(`${path}.${key}`, 'is an unknown key');
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

/**
 * The v1 stage contract, declared HERE rather than imported from the producer.
 *
 * A validator that reads the producer's own constant cannot catch the producer
 * drifting: both sides would move together and every recorded row would stay
 * "valid" by construction. This table is the checker's independent statement of
 * design section 12.1's stage sequence and section 13.3's rule that ONLY the two
 * conditional stages may report `skipped`.
 */
const V1_STAGES: readonly {
  readonly property: string;
  readonly name: string;
  readonly conditional: boolean;
  /**
   * Whether the stage records losses of its own. Retention and the packet do
   * not: a loss there IS its drop record, so it is derived from the decisions
   * rather than stored where the two could disagree.
   */
  readonly losses: boolean;
}[] = [
  { property: 'signals', name: 'signals', conditional: false, losses: true },
  {
    property: 'candidates',
    name: 'candidates',
    conditional: false,
    losses: true,
  },
  {
    property: 'expansion',
    name: 'expansion',
    conditional: false,
    losses: true,
  },
  { property: 'ruleJoin', name: 'rule-join', conditional: false, losses: true },
  {
    property: 'ruleExpansion',
    name: 'campaign-rule-expansion',
    conditional: true,
    losses: true,
  },
  {
    property: 'lateRuleJoin',
    name: 'late-ruling-join',
    conditional: true,
    losses: true,
  },
  { property: 'dedup', name: 'dedup', conditional: false, losses: true },
  {
    property: 'retention',
    name: 'retention',
    conditional: false,
    losses: false,
  },
  { property: 'packet', name: 'packet', conditional: false, losses: false },
];

const STAGE_OUTCOMES = ['ran', 'skipped', 'failed-to-run'] as const;

/**
 * The v1 durable route vocabulary, pinned HERE.
 *
 * `routeClass` is not descriptive text: `candidateBand()` branches on it, and
 * must-consider is the band whose loss fails a probe (design section 6.3). A
 * reader that accepted any string let a corrupted `direct-state-ref` — say
 * `direct-state-ref-typo` — through, where the band rule would have to guess;
 * a dropped mandatory candidate then reads as an ordinary exploratory drop and
 * M6 turns green over malformed evidence. ADR 0020 section 3: unrecognized is
 * not a safety property.
 *
 * Declared independently of `RouteClass` for the same reason as `V1_STAGES`: a
 * validator that imports the producer's own list cannot catch the producer
 * drifting, because both sides move together. A producer that adds or renames a
 * route must not thereby make old v1 rows valid.
 */
const V1_ROUTE_CLASSES = [
  'direct-state-ref',
  'direct-adventure-ref',
  'explicit-name-or-alias',
  'typed-relationship',
  'situation-cue',
  'auditor-missing-target',
  'campaign-rule',
  'campaign-ruling',
  'capability-preflight',
] as const;

/** The v1 signal kinds. `kind` selects how a signal proposed its target. */
const V1_SIGNAL_KINDS = [
  'state-ref',
  'adventure-ref',
  'name-mention',
  'situation-cue',
  'capability-preflight',
  'auditor-missing-target',
] as const;

/** What a candidate points at. The packet and M1/M9 read the two differently. */
const V1_TARGET_KINDS = ['rules-record', 'adventure-entity'] as const;

/** The disclosure kinds a packet candidate's projection limits may carry. */
const V1_PROJECTION_LIMIT_KINDS = [
  'success-branch',
  'area',
  'execution-readiness',
] as const;

/**
 * Why a candidate's `residue` entry could not be attributed to any of the
 * three declared field-provenance classes (`RecordDataResidue`,
 * `discovery/types.ts`; `eshyra-o9bd.19.12.11`'s F1-rr repair).
 */
const V1_RESIDUE_REASONS = [
  'unrepresentable-shape',
  'no-provenance-declaration',
] as const;

/**
 * Pack roles. A stack has exactly one base and any number of add-ons, and
 * comparability of two captures depends on that identity, so a base recorded as
 * an add-on (or the reverse) is malformed rather than merely odd.
 */
const V1_PACK_ROLES = ['base', 'addon'] as const;
const RULING_SCOPES = ['requested-ambiguities', 'all-active'] as const;
const CAPABILITY_STATUSES = [
  'available',
  'blocked',
  'not-evaluated-offline',
] as const;
const BLOCKER_IDS = ['B1', 'B2', 'B3', 'B4', 'B5'] as const;
const BLOCKER_STATUSES = [
  'repaired',
  'unrepaired',
  'not-discriminable',
] as const;
const CAPABILITY_OUTCOMES = ['available', 'blocked'] as const;
const FAILURE_STAGES = [
  'scenario',
  'stack',
  'blockers',
  'discovery',
  'render',
] as const;
const DELIVERY_MODES = ['observed', 'intervened'] as const;

/** The identity and lifecycle every stage record carries. */
function checkStageHeader(
  value: unknown,
  path: string,
  declared: {
    readonly name: string;
    readonly conditional: boolean;
    readonly losses: boolean;
  },
): Record<string, unknown> {
  const stage = asObject(value, path);
  if (asString(stage.stage, `${path}.stage`) !== declared.name)
    failAt(
      `${path}.stage`,
      `is '${String(stage.stage)}', not the v1 stage '${declared.name}'`,
    );
  const outcome = asEnum(stage.outcome, `${path}.outcome`, STAGE_OUTCOMES);
  // Only a conditional stage may be `skipped`, and only a non-conditional one
  // can fail to run: a mandatory stage that recorded nothing has failed, and
  // calling that a conditional skip is how "recognizing nothing looks green"
  // gets into durable evidence.
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
  if (declared.losses)
    each(stage.losses, `${path}.losses`, (loss, at) => {
      const fields = asObject(loss, at);
      asString(fields.reason, `${at}.reason`);
      asObject(fields.detail, `${at}.detail`);
    });
  else if (stage.losses !== undefined)
    failAt(
      `${path}.losses`,
      'is stored on a stage whose losses are derived from its decisions',
    );
  return stage;
}

function checkRoutes(value: unknown, path: string): void {
  each(value, path, (route, at) => {
    const fields = asObject(route, at);
    asEnum(fields.routeClass, `${at}.routeClass`, V1_ROUTE_CLASSES);
    asString(fields.trigger, `${at}.trigger`);
    asString(fields.signalId, `${at}.signalId`);
    asObject(fields.evidence, `${at}.evidence`);
  });
}

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

/**
 * The ambiguity identity M5 consumes. `unqueriedAmbiguityIds` and
 * `unresolvedAmbiguityIds` both read `id` and filter non-strings, so a
 * malformed identity would become an ABSENCE from a measurement rather than a
 * rejection.
 */
function checkAmbiguityIdentity(value: unknown, path: string): void {
  asString(asObject(value, path).id, `${path}.id`);
}

function checkRuleIdentity(value: unknown, path: string): void {
  asString(asObject(value, path).ruleIdentity, `${path}.ruleIdentity`);
}

/** Candidate identities a stage emitted, unique. */
function checkCandidates(
  stage: Record<string, unknown>,
  path: string,
): string[] {
  const keys: string[] = [];
  each(stage.outputsProduced, `${path}.outputsProduced`, (item, at) => {
    const fields = asObject(item, at);
    keys.push(asString(fields.candidateKey, `${at}.candidateKey`));
    asEnum(fields.targetKind, `${at}.targetKind`, V1_TARGET_KINDS);
    checkRoutes(fields.routes, `${at}.routes`);
    checkTraversals(fields.traversals, `${at}.traversals`);
  });
  if (new Set(keys).size !== keys.length)
    failAt(`${path}.outputsProduced`, 'repeats a candidate identity');
  return keys;
}

/** The cumulative traversal state each candidate of a stage carries. */
function traversalStateOf(
  stage: Record<string, unknown>,
): ReadonlyMap<string, ReadonlySet<string>> {
  const state = new Map<string, ReadonlySet<string>>();
  for (const raw of stage.outputsProduced as readonly Record<
    string,
    unknown
  >[]) {
    const traversals = raw.traversals as readonly unknown[];
    state.set(
      raw.candidateKey as string,
      new Set(traversals.map((item) => JSON.stringify(item))),
    );
  }
  return state;
}

/**
 * An expansion stage's traversal EVENTS, against the state they produced.
 *
 * State and event are different facts, so this is deliberately not a global
 * set-difference: a relationship already carried before this pass may fire
 * again in it, and a checker that rejected the repeat would reinstate exactly
 * the lossy equivalence this design removed. What is checked is the narrow
 * integrity relation between an execution event and its result:
 *
 * - the event is structurally complete;
 * - the same event is recorded once per pass, which is the producer's contract;
 * - both endpoints exist in this stage's output, because the producer emits
 *   both;
 * - both endpoints carry the relationship afterwards;
 * - every traversal a candidate GAINED here is explained by an event here;
 * - a conditional stage that reports `skipped` traversed nothing.
 *
 * An applicable stage that ran and found no links records no event, which is a
 * truthful result and not a defect, so emptiness is never required.
 */
function checkTraversalEvents(
  stage: Record<string, unknown>,
  path: string,
  before: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  const at = `${path}.traversalEvents`;
  checkTraversals(stage.traversalEvents, at);
  const events = stage.traversalEvents as readonly Record<string, unknown>[];
  const after = traversalStateOf(stage);
  const seen = new Set<string>();
  events.forEach((event, index) => {
    const where = `${at}[${index}]`;
    const key = JSON.stringify({
      sourceRecordKey: event.sourceRecordKey,
      linkField: event.linkField,
      relation: event.relation,
      targetRecordKey: event.targetRecordKey,
    });
    if (seen.has(key))
      failAt(where, 'repeats a traversal this stage already recorded once');
    seen.add(key);
    for (const role of ['sourceRecordKey', 'targetRecordKey'] as const) {
      const endpoint = event[role] as string;
      const carried = after.get(endpoint);
      if (carried === undefined)
        failAt(
          where,
          `traverses ${role} '${endpoint}', which this stage did not emit as a candidate`,
        );
      if (!carried.has(key))
        failAt(
          where,
          `traverses ${role} '${endpoint}', which does not carry the relationship afterwards`,
        );
    }
  });
  // The other direction: state a candidate gained here needs an event here.
  for (const [candidateKey, carried] of after) {
    const had = before.get(candidateKey) ?? new Set<string>();
    for (const traversal of carried)
      if (!had.has(traversal) && !seen.has(traversal))
        failAt(
          `${path}.outputsProduced`,
          `'${candidateKey}' gained traversal ${traversal} with no traversal event recorded for this stage`,
        );
  }
  if (stage.outcome === 'skipped' && events.length > 0)
    failAt(
      at,
      'is non-empty on a stage reporting `skipped`, which performed no work',
    );
}

function checkRuleJoin(
  value: unknown,
  path: string,
  declared: {
    readonly name: string;
    readonly conditional: boolean;
    readonly losses: boolean;
  },
): string[] {
  const stage = checkStageHeader(value, path, declared);
  const keys = checkCandidates(stage, path);
  const kinds: string[] = [];
  each(stage.seamQueries, `${path}.seamQueries`, (query, at) => {
    const fields = asObject(query, at);
    const kind = asEnum(fields.kind, `${at}.kind`, [
      'active-rules',
      'active-rulings',
    ]);
    if (kinds.includes(kind))
      failAt(at, `records a second '${kind}' query for one stage`);
    kinds.push(kind);
    if (kind === 'active-rules')
      strings(fields.candidateRecordKeys, `${at}.candidateRecordKeys`);
    else {
      asEnum(fields.scope, `${at}.scope`, RULING_SCOPES);
      strings(fields.ambiguityIds, `${at}.ambiguityIds`);
    }
  });
  const identities: string[] = [];
  each(stage.returnedProjections, `${path}.returnedProjections`, (item, at) => {
    const fields = asObject(item, at);
    identities.push(asString(fields.ruleIdentity, `${at}.ruleIdentity`));
    // The jhpt-owned projection, as the seam returned it. Only what the
    // derivation reads is checked; discovery neither redefines the shape nor
    // decides what else belongs in it.
    //
    // `ruleKind` is closed and the derivation branches on it: `deriveRuleJoin`
    // asks whether a projection is a ruling, and an unrecognized kind would
    // quietly become "not a ruling", removing an ambiguity resolution instead
    // of rejecting the row. It is validated against the CAMPAIGN OWNER's
    // vocabulary, not a discovery-local copy: W11 and design section 8.4 keep
    // rule/ruling domain semantics with `eshyra-jhpt`.
    if (!isCampaignRuleKind(fields.ruleKind))
      failAt(
        `${at}.ruleKind`,
        `'${String(fields.ruleKind)}' is not a campaign rule kind the campaign-rule owner recognizes`,
      );
    strings(fields.governingRecordKeys, `${at}.governingRecordKeys`);
    // A ruling decides an ambiguity; without that link a resolution could be
    // derived for an ambiguity no returned ruling ever named.
    if (fields.ruleKind === 'ruling') {
      asString(fields.ambiguityId, `${at}.ambiguityId`);
      asString(
        fields.selectedInterpretationId,
        `${at}.selectedInterpretationId`,
      );
    }
  });
  if (new Set(identities).size !== identities.length)
    failAt(
      `${path}.returnedProjections`,
      'repeats a rule identity; the seam returns each projection once',
    );
  const returned = new Set(identities);
  each(stage.placements, `${path}.placements`, (item, at) => {
    const fields = asObject(item, at);
    // A placement is a fact ABOUT a returned projection and a candidate this
    // stage emitted, so both links must resolve inside this record.
    const identity = asString(fields.ruleIdentity, `${at}.ruleIdentity`);
    if (!returned.has(identity))
      failAt(at, `places '${identity}', which the seam did not return here`);
    const key = asString(fields.governingRecordKey, `${at}.governingRecordKey`);
    if (!keys.includes(key))
      failAt(
        at,
        `places a rule beside '${key}', which this stage did not emit`,
      );
  });
  strings(stage.consideredAmbiguityIds, `${path}.consideredAmbiguityIds`);
  // A conditional join reports `skipped` only when it had nothing to ask. A
  // recorded seam call is the stage having executed, so the two cannot coexist.
  // Pass-through output is untouched by this: forwarding is not work.
  if (stage.outcome === 'skipped') {
    if ((stage.seamQueries as readonly unknown[]).length > 0)
      failAt(
        `${path}.seamQueries`,
        'records a seam query on a stage reporting `skipped`, which asked nothing',
      );
    if ((stage.returnedProjections as readonly unknown[]).length > 0)
      failAt(
        `${path}.returnedProjections`,
        'records a seam result on a stage reporting `skipped`',
      );
  }
  return keys;
}

/** One disposition per decided candidate, covering exactly the input set. */
function checkDispositions(
  value: unknown,
  path: string,
  decidedOver: readonly string[],
): string[] {
  const seen: string[] = [];
  const retained: string[] = [];
  each(value, path, (item, at) => {
    const fields = asObject(item, at);
    const key = asString(fields.candidateKey, `${at}.candidateKey`);
    seen.push(key);
    if (asBoolean(fields.retained, `${at}.retained`)) {
      retained.push(key);
      if (fields.reason !== undefined)
        failAt(`${at}.reason`, 'is present on a retained candidate');
    } else if (asString(fields.reason, `${at}.reason`).length === 0)
      failAt(
        `${at}.reason`,
        'is empty; an exclusion carries the reason its producer recorded',
      );
  });
  if (new Set(seen).size !== seen.length)
    failAt(path, 'decides one candidate twice');
  // Coverage is the whole invariant here: a stage that silently omits an input
  // candidate would make it vanish from every measurement at once, with no
  // drop, no overflow and no loss recorded anywhere.
  const decided = new Set(seen);
  for (const key of decidedOver)
    if (!decided.has(key))
      failAt(
        path,
        `records no disposition for '${key}', which it decided over`,
      );
  if (decided.size !== decidedOver.length)
    failAt(
      path,
      `decides ${decided.size} candidates but was given ${decidedOver.length}`,
    );
  return retained;
}

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

  const signals = checkStageHeader(
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
      asEnum(signal.kind, `${at}.kind`, V1_SIGNAL_KINDS);
      asString(signal.proposes, `${at}.proposes`);
    },
  );
  if (new Set(signalIds).size !== signalIds.length)
    failAt(`${path}.signals.outputsProduced`, 'repeats a signal identity');
  for (const key of [
    'unconsumedStateFields',
    'stateBindings',
    'ambiguousNames',
  ])
    asArray(signals[key], `${path}.signals.${key}`);

  const candidates = checkStageHeader(
    trace.candidates,
    `${path}.candidates`,
    declared('candidates'),
  );
  checkCandidates(candidates, `${path}.candidates`);
  strings(candidates.unresolvedTargets, `${path}.candidates.unresolvedTargets`);

  // Each expansion pass is checked against the traversal state it was handed,
  // which is the output of the stage immediately before it.
  const expansion = checkStageHeader(
    trace.expansion,
    `${path}.expansion`,
    declared('expansion'),
  );
  checkCandidates(expansion, `${path}.expansion`);
  checkTraversalEvents(
    expansion,
    `${path}.expansion`,
    traversalStateOf(candidates),
  );
  checkRuleJoin(trace.ruleJoin, `${path}.ruleJoin`, declared('ruleJoin'));
  const ruleExpansion = checkStageHeader(
    trace.ruleExpansion,
    `${path}.ruleExpansion`,
    declared('ruleExpansion'),
  );
  checkCandidates(ruleExpansion, `${path}.ruleExpansion`);
  checkTraversalEvents(
    ruleExpansion,
    `${path}.ruleExpansion`,
    traversalStateOf(asObject(trace.ruleJoin, `${path}.ruleJoin`)),
  );
  checkRuleJoin(
    trace.lateRuleJoin,
    `${path}.lateRuleJoin`,
    declared('lateRuleJoin'),
  );
  const dedupKeys = checkCandidates(
    checkStageHeader(trace.dedup, `${path}.dedup`, declared('dedup')),
    `${path}.dedup`,
  );

  const retention = checkStageHeader(
    trace.retention,
    `${path}.retention`,
    declared('retention'),
  );
  const retained = checkDispositions(
    retention.dispositions,
    `${path}.retention.dispositions`,
    dedupKeys,
  );
  // A stage that decided something ran. `failed-to-run` beside real decisions
  // is a lifecycle claim the producer could not have made.
  if (
    retention.outcome === 'failed-to-run' &&
    (retention.dispositions as readonly unknown[]).length > 0
  )
    failAt(
      `${path}.retention.outcome`,
      'is `failed-to-run` on a stage that recorded decisions',
    );
  const packet = checkStageHeader(
    trace.packet,
    `${path}.packet`,
    declared('packet'),
  );
  const included = checkDispositions(
    packet.decisions,
    `${path}.packet.decisions`,
    retained,
  );
  if (
    packet.outcome === 'failed-to-run' &&
    (packet.decisions as readonly unknown[]).length > 0
  )
    failAt(
      `${path}.packet.outcome`,
      'is `failed-to-run` on a stage that recorded decisions',
    );
  const content: string[] = [];
  each(packet.candidates, `${path}.packet.candidates`, (item, at) => {
    const item_ = asObject(item, at);
    const identity = asObject(item_.identity, `${at}.identity`);
    content.push(asString(identity.key, `${at}.identity.key`));
    for (const key of ['kind', 'name'])
      asString(identity[key], `${at}.identity.${key}`);
    const provenance = asObject(item_.provenance, `${at}.provenance`);
    asString(provenance.sourceRef, `${at}.provenance.sourceRef`);
    asString(provenance.source, `${at}.provenance.source`);
    if (!('license' in provenance))
      failAt(`${at}.provenance.license`, 'is absent');
    // F2 (PR #543 review): `sourceProse` was one field split by leaf TYPE at
    // render time. `packetCandidate` then performed a two-way split at build
    // time along a declared projection-container boundary; the second
    // re-review (F1-rr, `eshyra-o9bd.19.12.11`) found that container-name
    // heuristic was itself not a provenance boundary, and replaced it with a
    // THREE-way split read from the pack's own field-provenance manifest —
    // `sourceProse`, `sourceDerived`, `projection` — so the durable shape
    // carries all three plus whatever it could not place on any of them. The
    // admission check follows the producer's shape rather than re-deriving
    // it.
    asObject(item_.sourceProse, `${at}.sourceProse`);
    asObject(item_.sourceDerived, `${at}.sourceDerived`);
    asObject(item_.projection, `${at}.projection`);
    each(item_.residue, `${at}.residue`, (entry, where) => {
      const residueEntry = asObject(entry, where);
      asString(residueEntry.pointer, `${where}.pointer`);
      asString(residueEntry.shape, `${where}.shape`);
      asEnum(residueEntry.reason, `${where}.reason`, V1_RESIDUE_REASONS);
    });
    checkRoutes(item_.routes, `${at}.routes`);
    checkTraversals(item_.traversals, `${at}.traversals`);
    each(item_.ambiguities, `${at}.ambiguities`, checkAmbiguityIdentity);
    for (const key of ['campaignRules', 'campaignRulings'])
      each(item_[key], `${at}.${key}`, checkRuleIdentity);
    each(item_.projectionLimits, `${at}.projectionLimits`, (note, where) => {
      asEnum(
        asObject(note, where).kind,
        `${where}.kind`,
        V1_PROJECTION_LIMIT_KINDS,
      );
    });
    // A candidate now carries a BOUNDED SET of preflights (W10 F1 repair,
    // `eshyra-o9bd.19.12.9`), never a single optional one: `each` requires the
    // field to be an array, so a malformed writer that reverted to the old
    // single-object shape fails closed here rather than being silently
    // admitted as zero preflights.
    each(item_.capabilities, `${at}.capabilities`, checkCapability);
  });
  // The included content is the packet. It is one list, not a second copy of
  // the decisions: every included decision must have its content and nothing
  // else may appear.
  if (new Set(content).size !== content.length)
    failAt(`${path}.packet.candidates`, 'repeats a candidate identity');
  if (
    content.length !== included.length ||
    content.some((key) => !included.includes(key))
  )
    failAt(
      `${path}.packet.candidates`,
      `holds [${content.join(', ')}] while the recorded decisions include [${included.join(', ')}]`,
    );

  const stack = asObject(trace.stack, `${path}.stack`);
  const packIdentity =
    (expected: (typeof V1_PACK_ROLES)[number]): Check =>
    (raw, where) => {
      const pack = asObject(raw, where);
      for (const key of ['systemId', 'packId', 'version'])
        asString(pack[key], `${where}.${key}`);
      const role = asEnum(pack.role, `${where}.role`, V1_PACK_ROLES);
      if (role !== expected)
        failAt(
          `${where}.role`,
          `is '${role}' in the stack's ${expected} position`,
        );
    };
  packIdentity('base')(stack.base, `${path}.stack.base`);
  each(stack.addons, `${path}.stack.addons`, packIdentity('addon'));
}

/**
 * The five pre-experiment blockers a capture must qualify itself against.
 *
 * Declared here rather than read from `observeBlockerRepairs()` for the same
 * reason as the stage table. An empty or partial list is the dangerous shape:
 * every `every(status === 'repaired')` baseline check passes vacuously over it.
 */
const V1_BLOCKERS: readonly string[] = ['B1', 'B2', 'B3', 'B4', 'B5'];

function checkBlockerMembership(
  observations: readonly unknown[],
  complete: boolean,
): void {
  const seen = observations.map(
    (item) => (item as Record<string, unknown>).blockerId as string,
  );
  if (new Set(seen).size !== seen.length)
    failAt('blockerRepairs', 'repeats a blocker id');
  if (!complete) return;
  for (const id of V1_BLOCKERS)
    if (!seen.includes(id))
      failAt(
        'blockerRepairs',
        `omits ${id}; a capture that reached discovery observed all of ${V1_BLOCKERS.join(', ')}`,
      );
}

/** The turn's audit lifecycle, whose shape already forbids the impossible. */
function checkAudit(value: unknown, path: string): number {
  const audit = asObject(value, path);
  const auditor = asEnum(audit.auditor, `${path}.auditor`, [
    'absent',
    'present',
  ]);
  if (auditor === 'absent') {
    for (const key of ['retries', 'outcome'])
      if (audit[key] !== undefined)
        failAt(`${path}.${key}`, 'is present while no auditor ran');
    return 1;
  }
  each(audit.retries, `${path}.retries`, (item, at) => {
    const retry = asObject(item, at);
    strings(retry.missingTools, `${at}.missingTools`);
    if (retry.retryCause !== null)
      asString(retry.retryCause, `${at}.retryCause`);
  });
  const outcome = asObject(audit.outcome, `${path}.outcome`);
  const disposition = asEnum(
    outcome.disposition,
    `${path}.outcome.disposition`,
    ['accepted', 'repaired'],
  );
  if (disposition === 'repaired') {
    asString(outcome.retryCause, `${path}.outcome.retryCause`);
    strings(outcome.missingTools, `${path}.outcome.missingTools`);
  } else if (outcome.retryCause !== undefined)
    failAt(
      `${path}.outcome.retryCause`,
      'is present on an accepted verdict, which has no rejection cause',
    );
  return (audit.retries as unknown[]).length + 1;
}

/**
 * `ShadowDelivery`, admitted narrowly. This is the field a reader consults to
 * learn whether the DM actually received the packet (design section 12.3), so
 * every arm's identity fields are mandatory rather than softened into
 * optionals a reader could forget to check, and `exactKeys` keeps a field from
 * one arm leaking onto another (an `injected: false` row still carrying a
 * `renderedSha256` from a previous shape, say).
 */
function checkDelivery(value: unknown, path: string): void {
  const delivery = asObject(value, path);
  const mode = asEnum(delivery.mode, `${path}.mode`, DELIVERY_MODES);
  const injected = asBoolean(delivery.injected, `${path}.injected`);
  if (mode === 'observed') {
    if (injected)
      failAt(
        `${path}.injected`,
        "is true while mode is 'observed', which never injects",
      );
    exactKeys(delivery, ['mode', 'injected'], path);
    return;
  }
  if (injected) {
    exactKeys(
      delivery,
      ['mode', 'injected', 'renderedBytes', 'renderedSha256'],
      path,
    );
    asNumber(delivery.renderedBytes, `${path}.renderedBytes`);
    if ((delivery.renderedBytes as number) < 0)
      failAt(`${path}.renderedBytes`, 'must be non-negative');
    const sha256 = asString(delivery.renderedSha256, `${path}.renderedSha256`);
    if (!/^[0-9a-f]{64}$/u.test(sha256))
      failAt(
        `${path}.renderedSha256`,
        'is not a 64-character lowercase hex sha-256 digest',
      );
    return;
  }
  exactKeys(delivery, ['mode', 'injected', 'reason'], path);
  const reason = asString(delivery.reason, `${path}.reason`);
  if (reason.length === 0) failAt(`${path}.reason`, 'must not be empty');
}

function assertV2(stored: Record<string, unknown>): void {
  asString(stored.campaignPosition, 'campaignPosition');
  asString(stored.capturedAt, 'capturedAt');
  if (stored.modelUsageClaim !== null)
    failAt('modelUsageClaim', 'expected the recorded non-claim `null`');
  checkDelivery(stored.delivery, 'delivery');

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
  const attemptCount = checkAudit(runtime.audit, 'runtime.audit');
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
      // An event belongs to a candidate attempt that actually ran.
      if (attempt > attemptCount)
        failAt(
          `${at}.attempt`,
          `is ${String(attempt)}, but this turn ran ${attemptCount} candidate attempt(s)`,
        );
    },
  );
  // `runtime.stateEffects` is, by contract (see `RuntimeStateEffect` in
  // types.ts), ONE accepted candidate's executed-tool stream: a rejected
  // attempt's writes roll back with its savepoint and contribute no event
  // here. That single fact forces three checks beyond "each item looks like
  // an effect", which a per-item-only check (as `each` alone would give)
  // cannot express because it never compares one item against another:
  //
  //   1. `attempt` is the ACCEPTED candidate's attempt, which on an accepted
  //      trace is the FINAL one — `attemptCount` from `checkAudit` above,
  //      reused rather than recomputed a second way that could disagree. An
  //      earlier attempt is not merely unusual here, it is impossible: it was
  //      rejected, its savepoint rolled its writes back, and a rolled-back
  //      write is not an accepted state effect. A `1..attemptCount` range
  //      check was the earlier, weaker rule, and it admitted exactly that
  //      rejected-attempt stream (PR #543 re-review, finding 2). Capability
  //      invocations keep the range check on purpose: a preflight that ran is
  //      not a canonical write and survives its candidate's rejection.
  //   2. Every recorded effect shares that SAME attempt: two different
  //      attempt numbers in one stream is not "two effects", it is evidence
  //      stitched together from two different candidates, which no real
  //      producer can emit for an accepted turn.
  //   3. `ordinal` is this one stream's own canonical position: the i-th
  //      effect in stored order must carry ordinal `i`. That single equality
  //      is exactly "0-based, strictly increasing, no gaps, no duplicates" —
  //      any permutation, gap, repeat, or descending order fails it.
  const stateEffects = asArray(runtime.stateEffects, 'runtime.stateEffects');
  let stateEffectAttempt: number | undefined;
  stateEffects.forEach((item, index) => {
    const at = `runtime.stateEffects[${index}]`;
    const effect = asObject(item, at);
    exactKeys(effect, ['attempt', 'ordinal', 'tool', 'args'], at);
    const tool = asString(effect.tool, `${at}.tool`);
    if (tool.length === 0) failAt(`${at}.tool`, 'must not be empty');
    asNumber(effect.attempt, `${at}.attempt`);
    const attempt = effect.attempt as number;
    if (!Number.isInteger(attempt) || attempt !== attemptCount)
      failAt(
        `${at}.attempt`,
        `is ${String(attempt)}; this turn accepted candidate attempt ${attemptCount}, and only the accepted candidate contributes state effects (an earlier attempt was rejected and its writes rolled back)`,
      );
    if (stateEffectAttempt === undefined) {
      stateEffectAttempt = attempt;
    } else if (attempt !== stateEffectAttempt) {
      failAt(
        `${at}.attempt`,
        `is ${String(attempt)}, but an earlier effect in this same stream recorded attempt ${String(stateEffectAttempt)}; stateEffects is one accepted candidate's stream and cannot mix attempts`,
      );
    }
    asNumber(effect.ordinal, `${at}.ordinal`);
    const ordinal = effect.ordinal as number;
    if (!Number.isInteger(ordinal) || ordinal !== index)
      failAt(
        `${at}.ordinal`,
        `is ${String(ordinal)}; the canonical position of this stream's effect ${String(index)} is ${String(index)}`,
      );
    asObject(effect.args, `${at}.args`);
  });

  const hasTrace = stored.trace !== undefined && stored.trace !== null;
  const hasFailure = stored.failure !== undefined && stored.failure !== null;
  if (hasTrace === hasFailure)
    failAt(
      'trace/failure',
      hasTrace
        ? 'it carries both a trace and a failure'
        : 'it carries neither a trace nor a failure',
    );
  // `delivery` and `trace`/`failure` are recorded by different parties — the
  // orchestrator states delivery, discovery states the capture — so a
  // corrupted row could set them independently. Only `intervened` has
  // anything to cross-check: `observed` never injects regardless of whether
  // the capture succeeded, but `intervened`'s two arms each claim a fact
  // about the capture beside it (§7's "an impossible state" reasoning applies
  // across the two fields the same way it applies within one).
  const delivery = stored.delivery as Record<string, unknown>;
  if (delivery.mode === 'intervened') {
    if (delivery.injected === true && !hasTrace)
      failAt(
        'delivery.injected',
        'is true while the capture recorded no trace to have rendered from',
      );
    if (delivery.injected === false && !hasFailure)
      failAt(
        'delivery.injected',
        "is false under mode 'intervened' while the capture recorded no failure to explain it",
      );
  }
  if (hasFailure) {
    const failure = asObject(stored.failure, 'failure');
    const stage = asEnum(failure.stage, 'failure.stage', FAILURE_STAGES);
    asString(failure.message, 'failure.message');
    // A capture that failed IN discovery, or after discovery while rendering,
    // had already completed its blocker observations, so the same complete
    // set is required. One that failed earlier could not have observed them,
    // and inventing observations it never made would be worse than recording
    // none.
    checkBlockerMembership(
      blockers,
      stage === 'discovery' || stage === 'render',
    );
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
 * same way, through {@link assertV2}.
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
  assertV2(stored);
  return stored as unknown as DiscoveryShadowEvidence;
}
