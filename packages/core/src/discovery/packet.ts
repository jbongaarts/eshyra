import {
  classifyFieldPointer,
  type FieldProvenanceManifest,
} from '../rules/fieldProvenance.js';
import type {
  RulesAmbiguity,
  RulesRecord,
  RulesRecordKind,
} from '../rules/types.js';
import {
  assertMagicItemOperationReady,
  ItemExecutionReadinessError,
  MAGIC_ITEM_OPERATION_READINESS_CAPABILITY,
} from '../state/itemExecutionReadiness.js';
import {
  deriveItemOperationReadinessInput,
  ItemStateError,
} from '../state/itemState.js';
import type {
  CandidateDisposition,
  CapabilityPreflight,
  ContextPacket,
  DiscoveryCandidate,
  FieldProvenanceSource,
  OfflineCapabilityDeclaration,
  PacketCandidate,
  PacketTrace,
  ProjectionLimitNote,
  RecordDataResidue,
  RetentionOverflow,
  RetentionTrace,
} from './types.js';

/**
 * Amendment A2 (`eshyra-o9bd.19.13`): a ruling reaches a bounded capability
 * only through the `eshyra-jhpt` read interface, and reaching it changes
 * nothing about readiness. Stated as an exclusion so a consumer of the packet
 * cannot read the ruling's presence as authorization.
 */
const CAMPAIGN_RULING_EXCLUSION =
  'A campaign ruling supplied through the eshyra-jhpt read interface selects an interpretation only; it does not satisfy, weaken, or green any clause of this readiness contract.';

type Obj = Record<string, unknown>;
function object(value: unknown): Obj | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Obj)
    : undefined;
}
function prose(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(prose);
  if (value !== null && typeof value === 'object')
    return Object.values(value).flatMap(prose);
  return [];
}
function ambiguities(candidate: DiscoveryCandidate): readonly RulesAmbiguity[] {
  const mechanics = object(object(candidate.entry?.record.data)?.mechanics);
  if (!Array.isArray(mechanics?.ambiguities)) return [];
  return mechanics.ambiguities.filter(
    (item): item is RulesAmbiguity =>
      typeof item === 'object' && item !== null && !Array.isArray(item),
  );
}

function isPlainObject(value: unknown): value is Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** What `classifyRecordBody` calls a shape it declined to classify, so a
 * residue entry says WHAT the leaf's own JS type is — `RecordDataResidue`'s
 * `reason` says WHY it landed here rather than in a classified bucket. */
function residueShape(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return typeof value;
  if (typeof value === 'function') return 'function';
  if (typeof value === 'symbol') return 'symbol';
  if (typeof value === 'bigint') return 'bigint';
  const ctor = (value as { constructor?: { name?: string } })?.constructor;
  return `non-plain-object:${ctor?.name ?? 'unknown'}`;
}

interface ProvenanceSplit {
  /** `undefined` means this value contributed nothing on this side. */
  readonly sourceProse: unknown;
  readonly sourceDerived: unknown;
  readonly projection: unknown;
  readonly unattested: unknown;
}

/**
 * Partition one record-body value into the pack's three declared
 * field-provenance classes (`rules/fieldProvenance.ts`): `source-prose`,
 * `source-derived`, and `compiler-projection`.
 *
 * This replaces the deleted `PROJECTION_CONTAINER_KEYS` consumer-side
 * heuristic (W10's second re-review, F1-rr; `eshyra-o9bd.19.12.11`): a leaf's
 * class is no longer guessed from its container's NAME, it is READ from the
 * manifest the importer emitted, per leaf, by `classifyFieldPointer`. That
 * function already resolves the "most specific declared prefix wins" rule
 * (so `(creature, /armorClass)` classifies the whole structured statline
 * `source-derived` while `(creature, /armorClass/sourceText)` overrides just
 * the one verbatim-quote leaf to `source-prose`), so this walk carries no
 * inherited "projecting" state of its own — each leaf is classified
 * independently, by its own pointer.
 *
 * Two pointers are threaded through the walk, for two different readers.
 * `displayPointer` keeps concrete array indices — it is what a caller already
 * addresses by JSON pointer (M9's `typedPath` facts, the rendered
 * `/data/actions/5/...` lines) and seeds every `RecordDataResidue.pointer`.
 * `normalizedPointer` collapses every index to the literal segment `*`,
 * because that is `classifyFieldPointer`'s own required convention
 * (`fieldProvenance.ts`) and is never shown to a reader. Arrays stay
 * index-aligned across all three output sides (an index with nothing on one
 * side gets `null` there, never a shift), matching the display pointer's own
 * positional convention.
 *
 * `manifest` is `undefined` exactly when no pack-emitted field-provenance
 * manifest is available for this record at all — `loadFieldProvenanceManifest`
 * (`rules/packLoader.ts`) is optional, and a hand-authored test-corpus pack
 * may ship none (design item 5, `eshyra-o9bd.19.12.11`). That case is decided
 * here identically to a declared-but-non-covering manifest:
 * `classifyFieldPointer` is never even called, every leaf becomes a
 * `'no-provenance-declaration'` residue entry, and nothing lands in
 * `sourceProse` — a pack attesting nothing can never be read as attesting
 * verbatim source authority merely because the manifest argument was omitted.
 */
function classifyRecordBody(
  value: unknown,
  kind: RulesRecordKind,
  manifest: FieldProvenanceManifest | undefined,
  displayPointer: string,
  normalizedPointer: string,
  residue: RecordDataResidue[],
): ProvenanceSplit {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    const cls =
      manifest === undefined
        ? undefined
        : classifyFieldPointer(manifest, kind, normalizedPointer);
    if (cls === undefined) {
      // The VALUE is kept, in its own bucket, not discarded. Dropping it
      // would delete an add-on's or a custom resolver's actual rules content
      // from the DM's context entirely — a worse failure than the laundering
      // this binding exists to stop, and a silent one. It is surfaced under a
      // heading that states no producing pack attested it, which is what
      // "unattested" has to mean: visible and labelled, not absent.
      return {
        sourceProse: undefined,
        sourceDerived: undefined,
        projection: undefined,
        unattested: value,
      };
    }
    return {
      sourceProse: cls === 'source-prose' ? value : undefined,
      sourceDerived: cls === 'source-derived' ? value : undefined,
      projection: cls === 'compiler-projection' ? value : undefined,
      unattested: undefined,
    };
  }
  if (Array.isArray(value)) {
    const proseItems: unknown[] = [];
    const derivedItems: unknown[] = [];
    const projectionItems: unknown[] = [];
    const unattestedItems: unknown[] = [];
    let proseContributed = false;
    let derivedContributed = false;
    let projectionContributed = false;
    let unattestedContributed = false;
    value.forEach((item, index) => {
      const child = classifyRecordBody(
        item,
        kind,
        manifest,
        `${displayPointer}/${index}`,
        `${normalizedPointer}/*`,
        residue,
      );
      proseItems.push(
        child.sourceProse === undefined ? null : child.sourceProse,
      );
      derivedItems.push(
        child.sourceDerived === undefined ? null : child.sourceDerived,
      );
      projectionItems.push(
        child.projection === undefined ? null : child.projection,
      );
      unattestedItems.push(
        child.unattested === undefined ? null : child.unattested,
      );
      if (child.sourceProse !== undefined) proseContributed = true;
      if (child.sourceDerived !== undefined) derivedContributed = true;
      if (child.projection !== undefined) projectionContributed = true;
      if (child.unattested !== undefined) unattestedContributed = true;
    });
    return {
      sourceProse: proseContributed ? proseItems : undefined,
      sourceDerived: derivedContributed ? derivedItems : undefined,
      projection: projectionContributed ? projectionItems : undefined,
      unattested: unattestedContributed ? unattestedItems : undefined,
    };
  }
  if (isPlainObject(value)) {
    const proseOut: Obj = {};
    const derivedOut: Obj = {};
    const projectionOut: Obj = {};
    const unattestedOut: Obj = {};
    for (const [key, child] of Object.entries(value)) {
      const result = classifyRecordBody(
        child,
        kind,
        manifest,
        `${displayPointer}/${key}`,
        `${normalizedPointer}/${key}`,
        residue,
      );
      if (result.sourceProse !== undefined) proseOut[key] = result.sourceProse;
      if (result.sourceDerived !== undefined)
        derivedOut[key] = result.sourceDerived;
      if (result.projection !== undefined)
        projectionOut[key] = result.projection;
      if (result.unattested !== undefined)
        unattestedOut[key] = result.unattested;
    }
    return {
      sourceProse: Object.keys(proseOut).length > 0 ? proseOut : undefined,
      sourceDerived:
        Object.keys(derivedOut).length > 0 ? derivedOut : undefined,
      projection:
        Object.keys(projectionOut).length > 0 ? projectionOut : undefined,
      unattested:
        Object.keys(unattestedOut).length > 0 ? unattestedOut : undefined,
    };
  }
  // A shape plain JSON cannot represent (function, symbol, bigint, or a
  // non-plain object such as a Date or Map). The real pack is parsed JSON and
  // never produces one; this branch exists because `RulesRecord.data` is
  // typed `unknown`, and a defect that silently assigned this to any bucket
  // is exactly what the review forbids ("do not invent a silent default").
  residue.push({
    pointer: displayPointer,
    shape: residueShape(value),
    reason: 'unrepresentable-shape',
  });
  return {
    sourceProse: undefined,
    sourceDerived: undefined,
    projection: undefined,
    unattested: undefined,
  };
}

/**
 * Every place a typed save projection lives, with the JSON pointer that
 * addresses it. Creature actions carry their own nested `mechanics`, so a
 * detector that looked only at `data.mechanics.saves` silently produced no
 * note for `creature:adult-black-dragon` Acid Breath — the exact case design
 * section 7.2 names as a worked example of a required disclosure.
 */
function saveProjections(data: Obj): readonly {
  pointer: string;
  saves: readonly unknown[];
  area: unknown;
  localProse: string;
}[] {
  const found: {
    pointer: string;
    saves: readonly unknown[];
    area: unknown;
    localProse: string;
  }[] = [];
  const push = (pointer: string, holder: Obj | undefined, scope: unknown) => {
    const mechanics = object(holder?.mechanics);
    if (mechanics === undefined || !Array.isArray(mechanics.saves)) return;
    found.push({
      pointer: `${pointer}/mechanics/saves`,
      saves: mechanics.saves,
      area: mechanics.area,
      // Scoped to this projection's own prose. A record-wide test let one
      // action's success branch raise a spurious note on a sibling action
      // whose save has no damage at all (Frightful Presence borrowing Acid
      // Breath's "half as much").
      localProse: prose(scope).join('\n'),
    });
  };
  push('/data', data, data);
  for (const field of ['actions', 'legendaryActions', 'reactions'] as const) {
    const entries = data[field];
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, index) => {
      push(`/data/${field}/${index}`, object(entry), entry);
    });
  }
  return found;
}

/**
 * Bounded, linear-time area recognizer.
 *
 * The previous expression used an unanchored `\d+` before `-foot` over
 * arbitrary record prose, which CodeQL correctly flagged as a polynomial
 * regular expression on uncontrolled data: a long run of digits that never
 * reaches `-foot` costs quadratic work across start positions. Distances in
 * the corpus are at most a few digits, so the repetition is bounded and the
 * match is linear.
 *
 * The separator is `[ -]` because the corpus writes both forms: the Adult
 * Black Dragon's "60-foot line" and Fireball's "20-foot-radius sphere". An
 * earlier revision accepted only whitespace, so Fireball — one of the two
 * worked examples design section 7.2 names — never produced its required
 * area disclosure.
 */
const AREA_PROSE = /\d{1,4}-foot[ -](?:radius|line|cone|cube|sphere)/iu;
const SUCCESS_BRANCH_PROSE = /half as much|successful one/iu;

function projectionLimits(
  candidate: DiscoveryCandidate,
): ProjectionLimitNote[] {
  const record = candidate.entry?.record;
  const data = object(record?.data);
  if (record === undefined || data === undefined) return [];
  const text = prose(record.data).join('\n');
  const notes: ProjectionLimitNote[] = [];
  const projections = saveProjections(data);
  for (const projection of projections) {
    if (
      !projection.saves.some(
        (item) => object(item)?.damageOnSuccess === undefined,
      ) ||
      !SUCCESS_BRANCH_PROSE.test(projection.localProse)
    )
      continue;
    notes.push({
      kind: 'success-branch',
      note: 'The typed save projection omits the source success branch; source prose remains authoritative context.',
      evidence: { path: projection.pointer, missing: 'damageOnSuccess' },
      preservedProse: projection.localProse,
    });
  }
  if (
    AREA_PROSE.test(text) &&
    projections.every((projection) => projection.area === undefined) &&
    object(data.mechanics)?.area === undefined
  )
    notes.push({
      kind: 'area',
      note: 'The source describes an area, but no typed mechanics.area projection exists.',
      evidence: { missing: 'mechanics.area' },
      preservedProse: text,
    });
  const readiness = object(data.executionReadiness);
  const pending = Array.isArray(readiness?.clauses)
    ? readiness.clauses.filter((item) => object(item)?.readiness !== 'green')
    : [];
  if (pending.length > 0)
    notes.push({
      kind: 'execution-readiness',
      note: 'The record has engine-pending readiness clauses; typed projections are not a capability.',
      evidence: { clauses: pending },
      preservedProse: text,
    });
  return notes;
}
/**
 * One preflight for one `(record, variant, operation)` triple `signals.ts`
 * enumerated (W10 F1 repair, `eshyra-o9bd.19.12.9`): capability AVAILABILITY
 * is a property of the record plus the item's own state, not a prediction of
 * which operation the model will invoke, so every operation the record
 * declares for the instance's actual variant gets its own preflight here,
 * never just the one operation a future tool call happens to name.
 *
 * The only capability this offline phase can positively establish is W13's
 * `MAGIC_ITEM_OPERATION_READINESS_CAPABILITY`, whose declared operation is
 * `assertMagicItemOperationReady` and which explicitly excludes executing the
 * item operation or supplying missing item semantics. A green readiness
 * preflight is therefore reported AS that readiness capability. It is not
 * promoted into a different, execution-shaped capability: an earlier revision
 * relabelled a green single-use economy as `magic-item-single-use-spend` while
 * copying the readiness contract's revision, inputs, and exclusions, which
 * asserted an execution commitment no contract backs and no code here
 * performs. If a single-use spend capability is wanted, it needs its own
 * contract bound to the real `use_item` execution and state-effect boundary.
 */
function preflightOperation(
  record: RulesRecord,
  operationId: string,
  variantId: string | undefined,
  campaignRulings: DiscoveryCandidate['campaignRulings'],
): CapabilityPreflight {
  const contract = MAGIC_ITEM_OPERATION_READINESS_CAPABILITY;
  // The jhpt projection, passed through: a ruling is on this candidate because
  // its own `governingRecordKeys` named this record, and discovery neither
  // re-derives that association nor reshapes what the owner returned.
  const rulingFields = campaignRulings.length === 0 ? {} : { campaignRulings };
  const rulingExclusions =
    campaignRulings.length === 0 ? [] : [CAMPAIGN_RULING_EXCLUSION];
  try {
    const readinessInput = deriveItemOperationReadinessInput(
      record,
      variantId,
      operationId,
    );
    assertMagicItemOperationReady(record, variantId, readinessInput);
    return {
      status: 'available',
      ...rulingFields,
      // The contract's own identity and operation, quoted rather than
      // restated (design section 7.1).
      capabilityId: contract.operationId,
      revision: contract.revision,
      operationId,
      variantId,
      readinessInput,
      inputs: contract.requiredInputs,
      exclusions: [...contract.exclusions, ...rulingExclusions],
      residualInterpretation: contract.residualDmInterpretation.join(' '),
    };
  } catch (error) {
    // A record that declares no such operation raises ItemStateError from the
    // derivation. That is a blocked preflight, not a harness crash: letting it
    // escape would tear down packet construction for every other candidate.
    if (
      !(error instanceof ItemExecutionReadinessError) &&
      !(error instanceof ItemStateError)
    )
      throw error;
    return {
      status: 'blocked',
      ...rulingFields,
      capabilityId: contract.operationId,
      revision: contract.revision,
      operationId,
      variantId,
      blockingClauseIds: [
        ...error.message.matchAll(
          /([\w:-]{1,120}\/c\d{1,3}(?:-[\w-]{1,120})?)/gu,
        ),
      ].map((match) => match[1]),
      message: error.message,
      inputs: contract.requiredInputs,
      exclusions: [
        'A blocked readiness contract cannot be treated as an executable capability.',
        ...contract.exclusions,
        ...rulingExclusions,
      ],
      residualInterpretation:
        'An engine owner must resolve the named readiness clauses. ' +
        contract.residualDmInterpretation.join(' '),
    };
  }
}

/**
 * Capability presentation for one candidate: a BOUNDED SET, one entry per
 * `capability-preflight` route `signals.ts` emitted for it (zero or more —
 * design section 7.3 forbids treating "the candidate declares no operations"
 * or "nothing was preflighted" as anything but the empty set, never a single
 * missing value). A candidate carrying no such route falls back to the
 * unrelated offline-declaration mechanism (`declarations`, e.g. a spell's
 * upcast contract), which reports at most one `not-evaluated-offline` entry
 * and never mixes with a real preflight.
 */
function capabilities(
  candidate: DiscoveryCandidate,
  declarations: readonly OfflineCapabilityDeclaration[],
): readonly CapabilityPreflight[] {
  const routes = candidate.routes.filter(
    (item) => item.routeClass === 'capability-preflight',
  );
  if (candidate.entry?.record.kind !== 'magic-item' || routes.length === 0) {
    const declaration = declarations.find(
      (item) => item.candidateKey === candidate.candidateKey,
    );
    return declaration === undefined
      ? []
      : [
          {
            status: 'not-evaluated-offline',
            capabilityId: declaration.capabilityId,
            revision: declaration.revision,
            inputs: declaration.inputs,
            exclusions: declaration.exclusions,
            residualInterpretation: declaration.residualInterpretation,
          },
        ];
  }
  const record = candidate.entry.record;
  return routes.map((route) => {
    // `signals.ts` never emits a `capability-preflight` route without an
    // `operationId`; a route that somehow lacked one would name no operation
    // to preflight, which is a signals-stage defect, not a packet-stage one.
    const operationId = String(route.evidence.operationId);
    const variantId =
      typeof route.evidence.variantId === 'string'
        ? route.evidence.variantId
        : undefined;
    return preflightOperation(
      record,
      operationId,
      variantId,
      candidate.campaignRulings,
    );
  });
}
/**
 * Run the field-provenance-manifest split (`classifyRecordBody`) over one
 * rules-pack record's `data` and shape the result exactly like the two-bucket
 * split it replaces: always present, even when a side is empty, so a caller's
 * JSON pointer resolves the same root it always did.
 */
function splitRecordData(
  data: Obj,
  kind: RulesRecordKind,
  manifest: FieldProvenanceManifest | undefined,
): {
  readonly sourceProse: Obj;
  readonly sourceDerived: Obj;
  readonly projection: Obj;
  readonly unattested: Obj;
  readonly residue: readonly RecordDataResidue[];
} {
  const residue: RecordDataResidue[] = [];
  const result = classifyRecordBody(data, kind, manifest, '/data', '', residue);
  return {
    sourceProse: (result.sourceProse as Obj | undefined) ?? {},
    sourceDerived: (result.sourceDerived as Obj | undefined) ?? {},
    projection: (result.projection as Obj | undefined) ?? {},
    unattested: (result.unattested as Obj | undefined) ?? {},
    residue,
  };
}

function packetCandidate(
  candidate: DiscoveryCandidate,
  declarations: readonly OfflineCapabilityDeclaration[],
  provenanceSource: FieldProvenanceSource | undefined,
): PacketCandidate {
  if (candidate.routes.length === 0)
    throw new Error(
      `route-free candidate '${candidate.candidateKey}' cannot enter context packet`,
    );
  if (candidate.entry === undefined) {
    const holder = candidate.adventureEntity ?? {};
    const entity = object(holder.entity) ?? {};
    const provenance = object(holder.provenance);
    // The field-provenance manifest classifies by `RulesRecordKind`
    // (`fieldProvenance.ts`), and `adventure-entity` is not one — an authored
    // module is never compiled by the SRD importer the manifest describes, so
    // there is no per-leaf classification to read here at all. The whole
    // entity is authored source material, wholesale, matching what a module
    // author actually wrote rather than a compiler's typed extraction from
    // it. A future authored container that starts behaving like a compiler
    // projection is a new decision for whoever owns adventure content, not a
    // silent inheritance of this record boundary.
    return {
      identity: {
        key: candidate.candidateKey,
        kind: 'adventure-entity',
        name: String(entity.name ?? candidate.candidateKey),
      },
      // The authored module's real authority metadata, not a placeholder.
      provenance: {
        sourceRef: String(provenance?.sourceRef ?? ''),
        locator:
          typeof provenance?.locator === 'string'
            ? provenance.locator
            : undefined,
        source: String(holder.moduleId ?? 'adventure-module'),
        license: holder.license ?? null,
      },
      sourceProse: entity,
      sourceDerived: {},
      projection: {},
      // An authored module is source material by construction, so nothing
      // here is unattested in the field-provenance sense: its author IS the
      // attestation, and the module's own provenance metadata above carries
      // it. This is not the SRD importer's manifest speaking for a foreign
      // pack, which is what the producer binding forbids.
      unattested: {},
      residue: [],
      routes: candidate.routes,
      traversals: candidate.traversals,
      ambiguities: [],
      campaignRules: candidate.campaignRules,
      campaignRulings: candidate.campaignRulings,
      // An authored adventure entity is never a magic-item record, so it
      // never carries a `capability-preflight` route and never has an offline
      // declaration keyed to it: the bounded set is always empty here.
      capabilities: [],
      projectionLimits: [],
    };
  }
  const record = candidate.entry.record;
  // The manifest is resolved from the pack that ACTUALLY PRODUCED this
  // resolved record, never from the stack, the kind, or the campaign's base
  // system. `candidate.entry.pack` is the winning producer: `mergeRecord` in
  // `rules/stack.ts` sets it to the OVERRIDING pack and pushes the previous
  // one onto `overrideChain`, so an add-on that overrides a spell's
  // `description` is asked for ITS provenance, not the base pack's.
  //
  // A manifest attests only what its own producer emitted. Passing one
  // manifest for a whole stack applied the SRD importer's authority to
  // add-on, custom-resolver and foreign-system records whose values it never
  // produced — laundering foreign content through SRD provenance. A pack with
  // no positively associated manifest resolves to `undefined` here and takes
  // the same fail-safe path as a pack that ships none: every leaf becomes
  // disclosed residue, nothing is labelled prose, derived or projection.
  const split = splitRecordData(
    object(record.data) ?? {},
    record.kind,
    provenanceSource?.(candidate.entry.pack),
  );
  return {
    identity: { key: record.key, kind: record.kind, name: record.name },
    provenance: {
      sourceRef: record.provenance.sourceRef,
      locator: record.provenance.locator,
      source: record.source,
      license: candidate.entry.license,
    },
    sourceProse: { data: split.sourceProse },
    sourceDerived: { data: split.sourceDerived },
    projection: { data: split.projection },
    unattested: { data: split.unattested },
    residue: split.residue,
    routes: candidate.routes,
    traversals: candidate.traversals,
    ambiguities: ambiguities(candidate),
    campaignRules: candidate.campaignRules,
    campaignRulings: candidate.campaignRulings,
    capabilities: capabilities(candidate, declarations),
    projectionLimits: projectionLimits(candidate),
  };
}
/**
 * Build the packet, enforcing BOTH budgets with the same contract.
 *
 * The byte budget was previously diagnostic only: the packet was built in full,
 * every candidate retained, and a flag set afterwards. That failed the section
 * 6.3 contract, which is about the packet budget — M6 must fail and the
 * overflow record must name the affected candidates and their routes. Bytes
 * are charged in retention rank order (must-consider first), so a byte budget
 * behaves exactly like the candidate-count budget: related and exploratory
 * candidates are dropped with recorded reasons, and a must-consider candidate
 * that cannot fit is an explicit overflow that fails the probe.
 *
 * `fieldProvenanceSource` associates a PRODUCING PACK with the classification
 * that pack emitted (`rules/fieldProvenance.ts`). It is a function of the
 * pack, not a single manifest for the whole stack, because a manifest attests
 * only the values its own producer wrote: an add-on, a custom resolver result,
 * or a foreign-system pack that merely reuses familiar `RulesRecordKind`s was
 * not emitted by the SRD importer and must not inherit its authority.
 *
 * Optional, and `undefined` deliberately: a caller with no association to hand
 * gets the SAME fail-safe treatment as a pack that ships no manifest — see
 * `classifyRecordBody`'s doc comment. Production discovery
 * (`discovery/harness.ts`) passes
 * `bundledDnd5eSrdFieldProvenanceSource()`, which answers only for the
 * canonical bundled pack OBJECT and nothing else.
 */
export function buildContextPacket(
  retained: RetentionTrace,
  declarations: readonly OfflineCapabilityDeclaration[] = [],
  maxPacketBytes = 512_000,
  fieldProvenanceSource?: FieldProvenanceSource,
): PacketTrace {
  const built = retained.outputsProduced.map((candidate) => ({
    band: candidate.band,
    candidate,
    packet: packetCandidate(candidate, declarations, fieldProvenanceSource),
  }));
  // ONE decision per retained candidate, recorded AT the byte comparison that
  // makes it. An exclusion's reason is the budget arithmetic that excluded it,
  // authored here and nowhere else: the included-candidate list below says what
  // the packet holds, which cannot say why anything is missing from it.
  const decisions: CandidateDisposition[] = [];
  const kept: PacketCandidate[] = [];
  const byteDropped: RetentionTrace['dropped'][number][] = [];
  const byteOverflow: RetentionOverflow[] = [];
  let bytes = 2; // the enclosing "[]" of the serialized candidate list
  for (const item of built) {
    // Each entry costs its own serialization plus the separating comma.
    const cost =
      Buffer.byteLength(JSON.stringify(item.packet), 'utf8') +
      (kept.length === 0 ? 0 : 1);
    if (bytes + cost <= maxPacketBytes) {
      decisions.push({
        candidateKey: item.candidate.candidateKey,
        retained: true,
      });
      kept.push(item.packet);
      bytes += cost;
      continue;
    }
    const reason = `packet byte budget: candidate needs ${cost} bytes, ${maxPacketBytes - bytes} remain`;
    decisions.push({
      candidateKey: item.candidate.candidateKey,
      retained: false,
      reason,
    });
    const record = {
      candidateKey: item.candidate.candidateKey,
      band: item.band,
      routes: item.candidate.routes,
      reason,
    };
    byteDropped.push(record);
    if (item.band === 'must-consider') byteOverflow.push(record);
  }
  const packet: ContextPacket = {
    candidates: kept,
    bytes: Buffer.byteLength(JSON.stringify(kept), 'utf8'),
    projectionLimitNotes: kept.flatMap(
      (candidate) => candidate.projectionLimits,
    ),
    modelUsageClaim: null,
  };
  const dropped = [...retained.dropped, ...byteDropped];
  return {
    stage: 'packet',
    inputsConsumed: retained.outputsProduced.map((candidate) => ({
      candidateKey: candidate.candidateKey,
    })),
    decisions,
    outputsProduced: kept,
    losses: dropped.map((item) => ({
      reason: item.reason,
      detail: item as unknown as Record<string, unknown>,
    })),
    produced: kept.map((candidate) => candidate.identity.key),
    modified: [],
    carriedForward: [],
    outcome:
      kept.length === 0 && dropped.length === 0 ? 'failed-to-run' : 'ran',
    failedToRun: kept.length === 0 && dropped.length === 0,
    packet,
    byteBudgetExceeded: byteOverflow.length > 0 || byteDropped.length > 0,
    byteOverflow,
    dropped,
  };
}
