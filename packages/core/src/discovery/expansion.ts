import {
  type RecordRelationshipManifest,
  type RelationshipResolution,
  resolveRecordRelationships,
} from '../rules/recordRelationships.js';
import type { RulesPack, RulesRecordKind } from '../rules/types.js';
import { accountCandidates } from './accounting.js';
import { candidateBand } from './bands.js';
import { deepEqual } from './structuralEquality.js';
import type {
  DiscoveryCandidate,
  DiscoveryRoute,
  ExpansionTrace,
  RecordRelationshipManifestSource,
  RelationshipArtifactState,
  TypedTraversal,
} from './types.js';

type Entry = NonNullable<DiscoveryCandidate['entry']>;
type Stack = {
  recordsByKey: ReadonlyMap<string, Entry>;
  recordsByKind: ReadonlyMap<
    RulesRecordKind,
    { byName: ReadonlyMap<string, readonly Entry[]> }
  >;
};
function manifestLinks(
  entry: Entry,
  stack: Stack,
  manifest: RecordRelationshipManifest,
): RelationshipResolution[] {
  return [...resolveRecordRelationships(manifest, entry.record, stack)];
}

function traversalOf(
  resolution: Extract<RelationshipResolution, { outcome: 'resolved' }>,
): TypedTraversal {
  return {
    sourceRecordKey: resolution.sourceRecordKey,
    linkField: resolution.declaration.linkField,
    relation: resolution.relation,
    targetRecordKey: resolution.targetRecordKey,
  };
}

function route(traversal: TypedTraversal, signalId: string): DiscoveryRoute {
  return {
    routeClass: 'typed-relationship',
    trigger: `${traversal.linkField}:${traversal.relation}`,
    evidence: traversal as unknown as Record<string, unknown>,
    signalId,
  };
}

function withLink(
  candidate: DiscoveryCandidate,
  traversal: TypedTraversal,
  signalId: string,
): DiscoveryCandidate {
  const already = candidate.traversals.some(
    (item) =>
      item.sourceRecordKey === traversal.sourceRecordKey &&
      item.linkField === traversal.linkField &&
      item.relation === traversal.relation &&
      item.targetRecordKey === traversal.targetRecordKey,
  );
  return {
    ...candidate,
    routes: candidate.routes.some(
      (item) =>
        item.routeClass === 'typed-relationship' &&
        item.trigger === `${traversal.linkField}:${traversal.relation}` &&
        item.signalId === signalId,
    )
      ? candidate.routes
      : [...candidate.routes, route(traversal, signalId)],
    traversals: already
      ? candidate.traversals
      : [...candidate.traversals, traversal],
  };
}

function newRecordCandidate(
  entry: Entry,
  traversal: TypedTraversal,
  signalId: string,
): DiscoveryCandidate {
  return withLink(
    {
      candidateKey: entry.record.key,
      targetKind: 'rules-record',
      entry,
      routes: [],
      traversals: [],
      campaignRules: [],
      campaignRulings: [],
    },
    traversal,
    signalId,
  );
}

/**
 * One-hop typed expansion from must-consider material.
 *
 * `seedKeys` restricts which candidates act as expansion origins. The second
 * pass authorized by design section 12.1 uses it to expand only the
 * candidates the campaign-rule join promoted to must-consider, so the
 * repetition stays one hop and cannot cascade.
 */
export function expandTypedRelationships(
  candidates: readonly DiscoveryCandidate[],
  stack: Stack,
  options: {
    readonly seedKeys?: ReadonlySet<string>;
    readonly stageName?: string;
    readonly conditional?: boolean;
    readonly relationshipManifestSource:
      | RecordRelationshipManifestSource
      | undefined;
  },
): ExpansionTrace {
  const result = new Map(
    candidates.map((candidate) => [candidate.candidateKey, candidate]),
  );
  const losses: ExpansionTrace['losses'][number][] = [];
  const relationshipResolutions: RelationshipResolution[] = [];
  const manifestSource = options.relationshipManifestSource;
  // Resolved ONCE per PRODUCING PACK (F1), never per record: a relationship
  // manifest is a fact about the pack that emitted a record
  // (`RulesStackRecordEntry.pack`, the WINNING entry for an override), not
  // about the resolved stack as a whole. The map doubles as this pass's
  // producer-qualified evidence (F4): every distinct pack this loop actually
  // asked about ends up here, present or absent, and that is exactly the set
  // `relationshipArtifactByProducer` below reports.
  const manifestByPack = new Map<
    RulesPack,
    RecordRelationshipManifest | undefined
  >();
  function manifestFor(
    pack: RulesPack,
  ): RecordRelationshipManifest | undefined {
    if (!manifestByPack.has(pack))
      manifestByPack.set(pack, manifestSource?.(pack));
    return manifestByPack.get(pack);
  }
  // F6: resolved ONCE per stack entry, by OBJECT IDENTITY, and reused for
  // both the reverse-index pass below and the outbound half of the
  // `expandable` loop further down — never recomputed by calling
  // `resolveRecordRelationships` a second time for the SAME entry. The old
  // code called `manifestLinks` once per stack entry to build the reverse
  // index, then called it AGAIN for every expandable candidate's own entry,
  // pushing the identical unresolved resolution and loss twice for any
  // candidate whose entry is a normal stack entry. `measureDiscovery` counts
  // `stage.losses.length` directly, so that duplication corrupted measured
  // loss counts, not just an internal list.
  //
  // Keyed by object identity rather than record key on purpose: a candidate
  // whose `.entry` is genuinely a DIFFERENT object from the stack's own entry
  // for that key (a test fixture that deliberately mutates a copy, say) is a
  // different fact and must still be resolved fresh — this cache only
  // short-circuits recomputing the SAME entry object, never a distinct one
  // that merely shares a record key.
  const resolutionCache = new Map<Entry, readonly RelationshipResolution[]>();
  function resolveEntry(entry: Entry): readonly RelationshipResolution[] {
    const cached = resolutionCache.get(entry);
    if (cached !== undefined) return cached;
    const manifest = manifestFor(entry.pack);
    const resolutions =
      manifest === undefined ? [] : manifestLinks(entry, stack, manifest);
    resolutionCache.set(entry, resolutions);
    relationshipResolutions.push(...resolutions);
    for (const resolution of resolutions) {
      if (resolution.outcome === 'resolved') continue;
      losses.push({
        reason:
          resolution.outcome === 'indeterminate'
            ? 'indeterminate-typed-occurrence'
            : 'unresolved-typed-target',
        detail: { ...resolution },
      });
    }
    return resolutions;
  }
  const reverse = new Map<string, TypedTraversal[]>();
  for (const entry of stack.recordsByKey.values()) {
    const resolutions = resolveEntry(entry);
    for (const resolution of resolutions) {
      if (resolution.outcome !== 'resolved') continue;
      const traversal = traversalOf(resolution);
      const inbound = reverse.get(traversal.targetRecordKey) ?? [];
      inbound.push(traversal);
      reverse.set(traversal.targetRecordKey, inbound);
    }
  }
  // Design section 6.3 defines Related as one-hop typed relationships FROM
  // must-consider material. Expanding from an exploratory-only seed (a bare
  // situation cue, say) would promote its whole typed neighbourhood into the
  // Related band, changing retention pressure and bypassing the boundary the
  // design draws. Skipped seeds are recorded, never silently ignored.
  const originals = [...candidates];
  const seeded = (candidate: DiscoveryCandidate) =>
    options.seedKeys === undefined ||
    options.seedKeys.has(candidate.candidateKey);
  const expandable = originals.filter(
    (candidate) =>
      candidate.entry !== undefined &&
      candidateBand(candidate) === 'must-consider' &&
      seeded(candidate),
  );
  for (const candidate of originals)
    if (
      candidate.entry !== undefined &&
      seeded(candidate) &&
      candidateBand(candidate) !== 'must-consider'
    )
      losses.push({
        reason: 'expansion-origin-not-must-consider',
        detail: {
          candidateKey: candidate.candidateKey,
          band: candidateBand(candidate),
          routes: candidate.routes.map((route) => route.routeClass),
        },
      });
  const traversals: TypedTraversal[] = [];
  for (const candidate of expandable) {
    if (candidate.entry === undefined) continue;
    // Reuses the resolution `resolveEntry` already computed above for this
    // exact entry object when it is the same one the stack carries (the
    // normal case); recomputes fresh only when it genuinely is not (F6).
    const outgoing = resolveEntry(candidate.entry);
    const outgoingTraversals = outgoing
      .filter(
        (
          resolution,
        ): resolution is Extract<
          RelationshipResolution,
          { outcome: 'resolved' }
        > => resolution.outcome === 'resolved',
      )
      .map(traversalOf);
    const incoming = reverse.get(candidate.candidateKey) ?? [];
    for (const traversal of [...outgoingTraversals, ...incoming]) {
      const source = stack.recordsByKey.get(traversal.sourceRecordKey);
      const target = stack.recordsByKey.get(traversal.targetRecordKey);
      if (source === undefined || target === undefined) {
        losses.push({
          reason: 'unresolved-typed-target',
          detail: { traversal },
        });
        continue;
      }
      if (!traversals.some((item) => deepEqual(item, traversal)))
        traversals.push(traversal);
      const sourceSignal = candidate.routes[0]?.signalId ?? 'typed-expansion';
      result.set(
        source.record.key,
        withLink(
          result.get(source.record.key) ??
            newRecordCandidate(source, traversal, sourceSignal),
          traversal,
          sourceSignal,
        ),
      );
      result.set(
        target.record.key,
        withLink(
          result.get(target.record.key) ??
            newRecordCandidate(target, traversal, sourceSignal),
          traversal,
          sourceSignal,
        ),
      );
    }
  }
  const outputs = [...result.values()];
  const accounting = accountCandidates(candidates, outputs);
  // A conditional stage is `skipped` only when it had nothing applicable to
  // do. Anything it actually performed makes it `ran`, and pass-through is
  // never counted as work.
  const didWork =
    expandable.length > 0 || traversals.length > 0 || losses.length > 0;
  // F4: one entry per distinct producing pack this pass actually consulted,
  // sorted by packId for a deterministic, diff-friendly order. Every pack
  // among `stack.recordsByKey`'s winning entries was consulted at least once
  // above (the reverse-index pass iterates every one of them), so this is
  // complete for the stack this call ran over, never a subset.
  const relationshipArtifactByProducer: RelationshipArtifactState[] = [
    ...manifestByPack.entries(),
  ]
    .map(([pack, manifest]) => ({
      packId: pack.meta.packId,
      state: (manifest === undefined ? 'absent' : 'present') as
        | 'present'
        | 'absent',
    }))
    .sort((a, b) => a.packId.localeCompare(b.packId));
  return {
    stage: options.stageName ?? 'expansion',
    inputsConsumed: expandable.map((candidate) => ({
      candidateKey: candidate.candidateKey,
    })),
    produced: accounting.produced,
    modified: accounting.modified,
    carriedForward: accounting.carriedForward,
    outcome: didWork
      ? 'ran'
      : options.conditional === true
        ? 'skipped'
        : 'failed-to-run',
    failedToRun: !didWork && options.conditional !== true,
    outputsProduced: [...result.values()],
    losses,
    traversals,
    relationshipResolutions,
    relationshipArtifactByProducer,
  };
}
