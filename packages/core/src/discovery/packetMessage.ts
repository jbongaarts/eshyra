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

/**
 * Emit one line per leaf under `value`, at whatever JSON pointer reaches it.
 *
 * F2 (PR #543 review): this used to be two functions, one that emitted only
 * STRING leaves and one that emitted only every OTHER leaf, and the caller ran
 * both over the SAME object — the record body's primitive TYPE was standing in
 * for a provenance boundary that was never actually drawn. `packet.ts` now
 * performs the real split (`classifyRecordBody`, reading the pack's declared
 * field-provenance manifest) and hands this renderer THREE
 * already-classified objects (F1-rr repair, `eshyra-o9bd.19.12.11`); this
 * function's only job is to walk whichever one it is given and print every
 * leaf inside it, string or not, because by the time it runs that heading
 * question is already answered.
 */
function emitLeaves(value: unknown, path: string, lines: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      emitLeaves(item, `${path}/${index}`, lines);
    });
    return;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      lines.push(`- ${path}: {}`);
      return;
    }
    for (const [key, item] of entries)
      emitLeaves(item, `${path}/${key}`, lines);
    return;
  }
  lines.push(`- ${path}: ${valueText(value)}`);
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
  // Licence metadata is neither source prose nor an importer projection of
  // the record's mechanics, so it gets the plain full-leaf walk, unsplit.
  emitLeaves(candidate.provenance.license, '/license', lines);
  lines.push('### Source prose (verbatim; authoritative)');
  emitLeaves(candidate.sourceProse, '', lines);
  // Neither the heading above nor this one: a deterministic parser product
  // (`armorClass.value`) is truthful and attributable but NOT a quotation, so
  // it gets its own heading that says so plainly rather than being folded
  // into "verbatim; authoritative" (the W10 F1-rr defect this heading exists
  // to close) or into the typed-projection heading below, which is about
  // INTERPRETIVE compiler material, not deterministic parsing.
  lines.push(
    '### Source-derived facts (deterministic parser output from the cited source; NOT a verbatim quotation)',
  );
  emitLeaves(candidate.sourceDerived, '', lines);
  lines.push('### Typed projection (does not replace the source prose above)');
  emitLeaves(candidate.projection, '', lines);
  // Content from a pack whose producer attested nothing (PR #543 re-review
  // finding 1): an add-on, a custom resolver result, or a foreign-system pack.
  // It is SHOWN, because deleting a pack's rules content from the DM's context
  // would be a worse and quieter failure than mislabelling it — and it is
  // shown under a heading that refuses the authority claim outright, so it can
  // never be read as the verbatim source prose above.
  if (Object.keys(candidate.unattested.data ?? {}).length > 0) {
    lines.push(
      '### Unattested record content (no producing pack declared provenance for these fields; NOT verified verbatim source prose)',
    );
    emitLeaves(candidate.unattested, '', lines);
  }
  if (candidate.residue.length > 0) {
    // The pack's field-provenance manifest (`rules/fieldProvenance.ts`)
    // classifies every leaf the real bundled SRD pack produces; this heading
    // exists for what it could not — a pointer no declaration covers (which
    // is also what every leaf becomes when no manifest was supplied at all,
    // `eshyra-o9bd.19.12.11` item 5) or a JS shape the pack's JSON cannot
    // represent. `item.reason` says which. Disclosed instead of silently
    // landing under any of the three headings above, and placed immediately
    // beside them, not in a trailing appendix.
    lines.push(
      '### Unclassified record data (no field-provenance declaration covers this)',
    );
    for (const item of candidate.residue)
      lines.push(`- ${item.pointer}: ${item.shape} (${item.reason})`);
  }
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
  // The negative form ("no capability was positively selected") covers the
  // BOUNDED SET being EMPTY, and also a set that holds only DECLARED-but-
  // unevaluated entries (`not-evaluated-offline`) — neither is a positive
  // selection. It is never a stand-in for "every entry happens to be
  // blocked": a record whose every declared operation is blocked still has
  // real contracts to render below, each one stating for itself that a
  // blocked contract is not an executable capability (F1 repair,
  // `eshyra-o9bd.19.12.9`; design sections 7.2/7.3). A magic-item preflight
  // and an offline declaration never coexist in one candidate's set today
  // (`packet.ts`'s `capabilities()`), but the check is written against BOTH
  // rather than assuming that stays true.
  const capabilities = candidate.capabilities;
  const positivelySelected = capabilities.some(
    (item) => item.status !== 'not-evaluated-offline',
  );
  if (!positivelySelected)
    lines.push(
      '- no capability was positively selected.',
      '- This is not a claim that the record has no mechanics, is irrelevant, or is safe to ignore.',
    );
  // Three states per entry, and only ONE of them is a positive selection.
  //
  // `available` and `blocked` are both real commitments a capability contract
  // made over this subject: the contract selected the operation, and the
  // second reports why it cannot run. `not-evaluated-offline` is neither — the
  // phase declared a capability identity it never evaluated — and rendering it
  // as a bounded contract was laundering an unevaluated declaration into an
  // authority claim, which design sections 7.2 and 7.3 forbid.
  for (const capability of capabilities) {
    if (capability.status === 'not-evaluated-offline') {
      lines.push(
        `- a capability identity was DECLARED but not evaluated in this phase: capability=${capability.capabilityId}; revision=${capability.revision ?? 'not declared'}. A declaration is not a selection and grants nothing.`,
        `- declared exclusions: ${capability.exclusions?.join('; ') || 'none'}`,
      );
      continue;
    }
    // The LABEL tracks availability, not merely selection. Both statuses are
    // real commitments and both are bounded contracts, but design section 7.1
    // makes the positive claim about capability AVAILABILITY, and a reader
    // skimming headings should never take "POSITIVE BOUNDED CONTRACT" from a
    // preflight that reported the operation cannot run. The blocked lines
    // below say so too; this keeps the first line from having to be walked
    // back by the second.
    lines.push(
      `- ${capability.status === 'available' ? 'POSITIVE BOUNDED CONTRACT' : 'BOUNDED CONTRACT, NOT AVAILABLE'}: operation=${capability.operationId ?? 'not declared'}; capability=${capability.capabilityId}; revision=${capability.revision ?? 'not declared'}; status=${capability.status}`,
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
