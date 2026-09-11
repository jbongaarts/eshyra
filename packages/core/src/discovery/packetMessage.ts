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
    '### Source prose (verbatim; authoritative)',
  ];
  emitStringLeaves(candidate.sourceProse, '', lines);
  emitStringLeaves(candidate.provenance.license, '/license', lines);
  emitNonStringLeaves(candidate.provenance.license, '/license', lines);
  lines.push('### Typed projection (does not replace the source prose above)');
  emitNonStringLeaves(candidate.sourceProse, '', lines);
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
    lines.push('- canonical resolution: absent');
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
  if (candidate.capability === undefined) {
    lines.push('- no capability was positively selected.');
    lines.push(
      '- This is not a claim that the record has no mechanics, is irrelevant, or is safe to ignore.',
    );
  } else {
    const capability = candidate.capability;
    lines.push(
      `- POSITIVE BOUNDED CONTRACT: operation=${capability.operationId ?? 'not declared'}; capability=${capability.capabilityId}; revision=${capability.revision ?? 'not declared'}; status=${capability.status}`,
    );
    lines.push(`- required inputs: ${capability.inputs?.join(', ') || 'none'}`);
    lines.push(
      `- explicit exclusions: ${capability.exclusions?.join('; ') || 'none'}`,
    );
    lines.push(
      `- residual DM interpretation: ${capability.residualInterpretation ?? 'not declared'}`,
    );
  }
  for (const note of candidate.projectionLimits) {
    lines.push(`### Projection limit (${note.kind})`);
    lines.push(`- ${note.note}`);
    lines.push(`- evidence: ${valueText(note.evidence)}`);
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
