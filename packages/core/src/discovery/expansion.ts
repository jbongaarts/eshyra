import {
  type RecordRelationshipManifest,
  type RelationshipResolution,
  resolveRecordRelationships,
} from '../rules/recordRelationships.js';
import type { RulesRecordKind } from '../rules/types.js';
import { accountCandidates } from './accounting.js';
import { candidateBand } from './bands.js';
import { deepEqual } from './structuralEquality.js';
import type {
  DiscoveryCandidate,
  DiscoveryRoute,
  ExpansionTrace,
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
  const linkField =
    resolution.pointer === '/mechanics/conditions/*/condition'
      ? 'data.mechanics.conditions'
      : `data${resolution.pointer.replace(/\/\*$/, '').replaceAll('/', '.')}`;
  return {
    sourceRecordKey: resolution.sourceRecordKey,
    linkField,
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
    readonly relationshipManifest?: RecordRelationshipManifest;
  } = {},
): ExpansionTrace {
  const result = new Map(
    candidates.map((candidate) => [candidate.candidateKey, candidate]),
  );
  const losses: ExpansionTrace['losses'][number][] = [];
  const relationshipResolutions: RelationshipResolution[] = [];
  const manifest = options.relationshipManifest;
  if (manifest === undefined)
    losses.push({
      reason: 'relationship-manifest-absent',
      detail: { note: 'This pack declares no traversable relationships.' },
    });
  const reverse = new Map<string, TypedTraversal[]>();
  for (const entry of stack.recordsByKey.values()) {
    const resolutions =
      manifest === undefined ? [] : manifestLinks(entry, stack, manifest);
    relationshipResolutions.push(...resolutions);
    for (const resolution of resolutions) {
      if (resolution.outcome !== 'resolved') {
        losses.push({
          reason: 'unresolved-typed-target',
          detail: resolution as unknown as Record<string, unknown>,
        });
        continue;
      }
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
    const outgoing =
      manifest === undefined
        ? []
        : manifestLinks(candidate.entry, stack, manifest)
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
    for (const traversal of [...outgoing, ...incoming]) {
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
  };
}
