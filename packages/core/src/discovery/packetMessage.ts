import { isCampaignRulingProjection } from '../campaign/campaignRules.js';
import type {
  CandidateBand,
  ContextPacket,
  DiscoveryRoute,
  PacketCandidate,
  RetentionOverflow,
} from './types.js';

export interface RenderablePacketTrace {
  readonly retention: { readonly overflow: readonly RetentionOverflow[] };
  readonly packet: {
    readonly packet: ContextPacket;
    readonly byteOverflow: readonly RetentionOverflow[];
    readonly dropped: readonly {
      readonly candidateKey: string;
      readonly band: CandidateBand;
      readonly routes: readonly DiscoveryRoute[];
      readonly reason: string;
    }[];
  };
}

export interface RenderedContextPacket {
  readonly text: string;
  readonly bytes: number;
  readonly candidateCount: number;
  readonly mustConsiderOverflow: readonly RetentionOverflow[];
  readonly modelUsageClaim: null;
}

function valueText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function emitStringLeaves(value: unknown, path: string, lines: string[]): void {
  if (typeof value === 'string') {
    lines.push(`- ${path}: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      emitStringLeaves(item, `${path}/${index}`, lines);
    });
    return;
  }
  if (value !== null && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      emitStringLeaves(item, `${path}/${key}`, lines);
    });
  }
}

function emitNonStringLeaves(
  value: unknown,
  path: string,
  lines: string[],
): void {
  if (typeof value === 'string' || value === null || value === undefined)
    return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      emitNonStringLeaves(item, `${path}/${index}`, lines);
    });
    return;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) lines.push(`- ${path}: {}`);
    for (const [key, item] of entries) {
      if (typeof item === 'string') continue;
      if (item === null || item === undefined || typeof item !== 'object')
        lines.push(`- ${path}/${key}: ${valueText(item)}`);
      else emitNonStringLeaves(item, `${path}/${key}`, lines);
    }
  }
}

function routeLines(routes: readonly DiscoveryRoute[], lines: string[]): void {
  for (const route of routes)
    lines.push(
      `- ${route.routeClass}: trigger ${route.trigger} (evidence ${valueText(route.evidence)}, signal ${route.signalId})`,
    );
}

function candidateBlock(candidate: PacketCandidate): string {
  const lines = [
    `## Candidate ${candidate.identity.key}`,
    `- identity: kind=${candidate.identity.kind}; name=${candidate.identity.name}`,
    '### Provenance',
    `- sourceRef: ${candidate.provenance.sourceRef || '(unattributed)'}`,
    ...(candidate.provenance.locator === undefined
      ? []
      : [`- locator: ${candidate.provenance.locator}`]),
    `- source: ${candidate.provenance.source}`,
    '### License identity',
  ];
  // The licence belongs to provenance, not to the record's prose. Emitting it
  // after the source-prose heading put the licence text inside the block a
  // reader is told is the authoritative source, and left this heading empty.
  emitStringLeaves(candidate.provenance.license, '/license', lines);
  emitNonStringLeaves(candidate.provenance.license, '/license', lines);
  if (candidate.provenance.license === null) lines.push('- /license: null');
  lines.push('### Source prose (verbatim; authoritative)');
  emitStringLeaves(candidate.sourceProse, '', lines);
  lines.push('### Typed projection (does not replace the source prose above)');
  emitNonStringLeaves(candidate.sourceProse, '', lines);
  // Design section 7.2 requires a partial projection's omissions to be
  // disclosed IN BAND, beside the projection. These notes previously trailed
  // the whole candidate block, several sections below the projection they
  // qualify; a disclosure a reader meets after the capability contract is not
  // beside the thing it qualifies.
  for (const note of candidate.projectionLimits) {
    lines.push(`### Projection limit (${note.kind})`);
    lines.push(`- ${note.note}`);
    lines.push(`- evidence: ${valueText(note.evidence)}`);
  }
  lines.push('### Retrieval routes');
  routeLines(candidate.routes, lines);
  lines.push('### Traversed relationships');
  for (const traversal of candidate.traversals)
    lines.push(
      `- ${traversal.sourceRecordKey} via ${traversal.linkField}: ${traversal.relation} -> ${traversal.targetRecordKey}`,
    );
  if (candidate.traversals.length === 0) lines.push('- none');
  lines.push('### Source ambiguities');
  for (const ambiguity of candidate.ambiguities) {
    lines.push(`- ${ambiguity.id}: ${ambiguity.question}`);
    lines.push(
      `- interpretations: ${ambiguity.interpretations.map((item) => item.id).join(', ') || 'none'}`,
    );
    // Read, never assumed. `canonicalResolution` is null throughout the pack
    // today, but hardcoding "absent" would state as a fact about THIS record
    // something the renderer never looked at, and would silently present a
    // resolved ambiguity as unresolved if one ever carried a resolution.
    lines.push(
      ambiguity.canonicalResolution === null ||
        ambiguity.canonicalResolution === undefined
        ? '- canonical resolution: absent'
        : `- canonical resolution: ${valueText(ambiguity.canonicalResolution)}`,
    );
  }
  if (candidate.ambiguities.length === 0) lines.push('- none');
  lines.push('### Campaign rules and rulings');
  for (const projection of [
    ...candidate.campaignRules,
    ...candidate.campaignRulings,
  ]) {
    lines.push(
      `- identity=${projection.ruleIdentity}; kind=${projection.ruleKind}; status=${projection.status}; origin=${projection.origin}; scope=${projection.scope}; provenance=${projection.provenance}; effective position=${projection.effectivePosition}; supersededBy=${projection.supersededBy}; revokedPosition=${projection.revokedPosition}; governing records=${projection.governingRecordKeys.join(', ') || 'none'}`,
    );
    if (projection.prose !== undefined)
      lines.push(`- governing prose: ${projection.prose}`);
    if (isCampaignRulingProjection(projection))
      lines.push(
        `- ambiguity id=${projection.ambiguityId}; selected interpretation id=${projection.selectedInterpretationId}`,
      );
  }
  if (
    candidate.campaignRules.length === 0 &&
    candidate.campaignRulings.length === 0
  )
    lines.push('- none');
  lines.push('### Deterministic capability');
  // Three states, and only ONE of them is a positive selection.
  //
  // `available` and `blocked` are both real commitments a capability contract
  // made over this subject: the contract selected the operation, and the
  // second reports why it cannot run. `not-evaluated-offline` is neither — the
  // phase declared a capability identity it never evaluated — and rendering it
  // as a bounded contract was laundering an unevaluated declaration into an
  // authority claim, which design sections 7.2 and 7.3 forbid. The negative
  // form and its disclaimer therefore cover both "nothing selected" and
  // "declared but never evaluated".
  const capability = candidate.capability;
  if (capability === undefined || capability.status === 'not-evaluated-offline')
    lines.push(
      '- no capability was positively selected.',
      '- This is not a claim that the record has no mechanics, is irrelevant, or is safe to ignore.',
    );
  if (capability !== undefined && capability.status === 'not-evaluated-offline')
    lines.push(
      `- a capability identity was DECLARED but not evaluated in this phase: capability=${capability.capabilityId}; revision=${capability.revision ?? 'not declared'}. A declaration is not a selection and grants nothing.`,
      `- declared exclusions: ${capability.exclusions?.join('; ') || 'none'}`,
    );
  if (
    capability !== undefined &&
    capability.status !== 'not-evaluated-offline'
  ) {
    lines.push(
      `- POSITIVE BOUNDED CONTRACT: operation=${capability.operationId ?? 'not declared'}; capability=${capability.capabilityId}; revision=${capability.revision ?? 'not declared'}; status=${capability.status}`,
    );
    if (capability.status === 'blocked')
      lines.push(
        `- BLOCKED, and a blocked contract is not an executable capability: ${capability.message ?? 'no message recorded'}`,
        `- blocking clauses: ${capability.blockingClauseIds?.join(', ') || 'none named'}`,
      );
    lines.push(`- required inputs: ${capability.inputs?.join(', ') || 'none'}`);
    lines.push(
      `- explicit exclusions: ${capability.exclusions?.join('; ') || 'none'}`,
    );
    lines.push(
      `- residual DM interpretation: ${capability.residualInterpretation ?? 'not declared'}`,
    );
  }
  return lines.join('\n');
}

function overflowBlock(
  title: string,
  items: readonly RetentionOverflow[],
): string {
  const lines = [`## ${title}`];
  for (const item of items) {
    lines.push(`- ${item.candidateKey} [${item.band}]: ${item.reason}`);
    for (const route of item.routes)
      lines.push(`  - route ${route.routeClass}: trigger ${route.trigger}`);
  }
  return lines.join('\n');
}

export function renderContextPacketMessage(
  trace: RenderablePacketTrace,
): RenderedContextPacket {
  const candidates = trace.packet.packet.candidates;
  const mustConsiderOverflow = [
    ...trace.retention.overflow,
    ...trace.packet.byteOverflow,
  ];
  const sections = candidates.map(candidateBlock);
  if (candidates.length === 0)
    sections.push('## Context packet\nDiscovery retained nothing.');
  if (mustConsiderOverflow.length > 0)
    sections.push(
      overflowBlock('Must-consider overflow', mustConsiderOverflow),
    );
  const otherDrops = trace.packet.dropped.filter(
    (item) => item.band !== 'must-consider',
  );
  if (otherDrops.length > 0)
    sections.push(overflowBlock('Other packet drops', otherDrops));
  const text = sections.join('\n\n');
  return {
    text,
    bytes: Buffer.byteLength(text, 'utf8'),
    candidateCount: candidates.length,
    mustConsiderOverflow,
    modelUsageClaim: null,
  };
}
