import { CONDITION_RELATION_VALUES } from '../rules/conditionRelations.js';
import { normalizeRulesRecordName } from '../rules/stack.js';
import type { RulesRecordKind } from '../rules/types.js';
import { candidateBand } from './bands.js';
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
type Obj = Record<string, unknown>;

function object(value: unknown): Obj | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Obj)
    : undefined;
}

function directLinks(entry: Entry, stack: Stack): TypedTraversal[] {
  const data = object(entry.record.data);
  if (data === undefined) return [];
  const links: TypedTraversal[] = [];
  const add = (field: string, raw: unknown, relation: string) => {
    if (typeof raw !== 'string') return;
    const target = stack.recordsByKey.get(raw);
    if (target !== undefined)
      links.push({
        sourceRecordKey: entry.record.key,
        linkField: field,
        relation,
        targetRecordKey: raw,
      });
  };
  add('data.source', data.source, 'data.source');
  add('data.parentClass', data.parentClass, 'data.parentClass');
  add(
    'data.progressionTableRef',
    data.progressionTableRef,
    'data.progressionTableRef',
  );
  for (const field of [
    'tableRefs',
    'spellTableRefs',
    'statBlockRefs',
  ] as const) {
    const values = data[field];
    if (Array.isArray(values))
      for (const value of values) add(`data.${field}`, value, `data.${field}`);
  }
  const mechanics = object(data.mechanics);
  if (mechanics !== undefined && Array.isArray(mechanics.conditions))
    for (const raw of mechanics.conditions) {
      const condition = object(raw);
      if (condition === undefined || typeof condition.condition !== 'string')
        continue;
      const relation = condition.relation;
      if (
        typeof relation !== 'string' ||
        !CONDITION_RELATION_VALUES.includes(relation as never)
      )
        continue;
      const index = stack.recordsByKind.get('condition')?.byName;
      // The byName index is keyed by normalizeName, which does more than
      // lowercase (apostrophes, trailing parentheticals). toLowerCase would
      // silently miss any condition whose name needs real normalization.
      const matches =
        index?.get(normalizeRulesRecordName(condition.condition)) ?? [];
      for (const target of matches)
        links.push({
          sourceRecordKey: entry.record.key,
          linkField: 'data.mechanics.conditions',
          relation,
          targetRecordKey: target.record.key,
        });
    }
  return links;
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

export function expandTypedRelationships(
  candidates: readonly DiscoveryCandidate[],
  stack: Stack,
): ExpansionTrace {
  const result = new Map(
    candidates.map((candidate) => [candidate.candidateKey, candidate]),
  );
  const losses: ExpansionTrace['losses'][number][] = [];
  const reverse = new Map<string, TypedTraversal[]>();
  for (const entry of stack.recordsByKey.values()) {
    for (const traversal of directLinks(entry, stack)) {
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
  const expandable = originals.filter(
    (candidate) =>
      candidate.entry !== undefined &&
      candidateBand(candidate) === 'must-consider',
  );
  for (const candidate of originals)
    if (
      candidate.entry !== undefined &&
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
    const outgoing = directLinks(candidate.entry, stack);
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
      if (
        !traversals.some(
          (item) => JSON.stringify(item) === JSON.stringify(traversal),
        )
      )
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
  return {
    stage: 'expansion',
    inputsConsumed: expandable.map((candidate) => ({
      candidateKey: candidate.candidateKey,
    })),
    outputsProduced: [...result.values()],
    losses,
    failedToRun: result.size === 0 && losses.length === 0,
    traversals,
  };
}
