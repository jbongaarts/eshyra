/**
 * Contract handoff comments.
 *
 * A handoff publishes, in one deliberately-fetched place, the exact contract a
 * reviewer is being asked to act on and the exact identity it was published
 * under. This is the one comment permitted to carry the full normalized
 * contract — checkpoints stay compact and never restate it.
 *
 * Exactly one handoff comment is active per PR. Republishing UPDATES that
 * comment in place rather than adding another, so a reviewer can never be
 * looking at a shadowed earlier version.
 */

import {
  hashNormalizedContract,
  type NormalizedContract,
  normalizeContractBlock,
  renderNormalizedContract,
} from './contract.js';
import type { IssueComment, ReviewGitHubClient } from './github.js';
import { shortHash } from './hashing.js';
import {
  CONTRACT_MARKER,
  detectMarker,
  extractJsonPayload,
  fenceJson,
  hasMarker,
} from './markers.js';
import type { ReviewProfile } from './profiles.js';

export type HandoffKind = 'contract-authorization' | 'implementation-review';

export interface HandoffPayload {
  readonly handoffKind: HandoffKind;
  readonly beadId: string;
  readonly beadTitle: string;
  readonly protocolId: string;
  readonly protocolHash: string;
  readonly profileId: string;
  readonly profileHash: string;
  readonly policyHash: string;
  readonly contractHash: string;
  readonly declaredProfile: ReviewProfile;
  readonly minimumProfile: ReviewProfile;
  readonly effectiveProfile: ReviewProfile;
  readonly escalationReasons: readonly string[];
  readonly authorizationRequired: boolean;
  /** The PR head at publication time. Context, not an approval of code. */
  readonly publicationHeadSha: string;
  /**
   * The exact normalized structure the hash was taken over.
   *
   * Republished so CI can re-derive `contractHash` and re-run every structural
   * rule without reaching the Beads Dolt database, which is not available to a
   * GitHub Actions runner. It does not make the handoff authoritative: the
   * bead remains the authority, and `review:preflight` is what proves the two
   * still agree.
   */
  readonly contract: NormalizedContract;
}

export interface HandoffComment {
  readonly comment: IssueComment;
  readonly payload: HandoffPayload;
}

export function formatHandoffComment(
  payload: HandoffPayload,
  contract: NormalizedContract,
): string {
  const escalations =
    payload.escalationReasons.length === 0
      ? 'none — declared profile already meets the minimum'
      : payload.escalationReasons.map((reason) => `- ${reason}`).join('\n');

  const headingKind =
    payload.handoffKind === 'contract-authorization'
      ? 'Contract authorization requested'
      : 'Implementation review requested';

  return [
    CONTRACT_MARKER,
    '',
    `# ${headingKind}`,
    '',
    `**Bead** \`${payload.beadId}\` — ${payload.beadTitle}`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Handoff kind | \`${payload.handoffKind}\` |`,
    `| Declared profile | \`${payload.declaredProfile}\` |`,
    `| Minimum profile | \`${payload.minimumProfile}\` |`,
    `| Effective profile | \`${payload.effectiveProfile}\` |`,
    `| Authorization required before implementation | ${payload.authorizationRequired ? 'yes' : 'no'} |`,
    `| Protocol | \`${payload.protocolId}\` \`${shortHash(payload.protocolHash)}\` |`,
    `| Selected profile | \`${payload.profileId}\` \`${shortHash(payload.profileHash)}\` |`,
    `| Minimum-profile policy | \`${shortHash(payload.policyHash)}\` |`,
    `| Normalized contract | \`${shortHash(payload.contractHash)}\` |`,
    `| Publication head | \`${payload.publicationHeadSha}\` |`,
    '',
    '## Escalation reasons',
    '',
    escalations,
    '',
    '## Authority',
    '',
    `The **Bead \`${payload.beadId}\` contract reproduced below is authoritative.** The PR body, the PR template, commit messages, and every other comment on this PR are explanatory only and carry no review weight.`,
    '',
    payload.handoffKind === 'contract-authorization'
      ? 'The publication head above is **context for this authorization, not an approval of the code at that commit.** Later implementation commits do not invalidate an authorization while the contract, profile, and policy hashes are unchanged.'
      : 'This handoff is bound to the publication head above. **Any new commit invalidates implementation approval** and requires a fresh handoff.',
    '',
    '## Normalized contract',
    '',
    renderNormalizedContract(contract),
    '',
    '## Machine payload',
    '',
    fenceJson(payload),
    '',
  ].join('\n');
}

/**
 * Find the active handoff. Multiple handoff comments are a defect, not a
 * history: the most recent is active and the rest are reported so they can be
 * removed rather than silently ignored.
 */
export function findHandoffComments(comments: readonly IssueComment[]): {
  active?: HandoffComment;
  superseded: readonly IssueComment[];
  malformed: readonly IssueComment[];
} {
  const candidates = comments.filter((comment) =>
    hasMarker(comment.body, CONTRACT_MARKER),
  );
  const unsupported = comments.filter((comment) => {
    const marker = detectMarker(comment.body);
    return marker?.family === 'eshyra-review-contract' && !marker.supported;
  });
  if (unsupported.length > 0) {
    throw new Error(
      `PR carries ${unsupported.length} eshyra-review-contract comment(s) at an unsupported marker version. Reading them is an error, not a skip; upgrade the review tooling.`,
    );
  }

  const parsed: HandoffComment[] = [];
  const malformed: IssueComment[] = [];
  for (const comment of candidates) {
    try {
      parsed.push({
        comment,
        payload: parseHandoffPayload(extractJsonPayload(comment.body)),
      });
    } catch {
      malformed.push(comment);
    }
  }
  const ordered = [...parsed].sort((a, b) =>
    a.comment.createdAt === b.comment.createdAt
      ? a.comment.id - b.comment.id
      : a.comment.createdAt.localeCompare(b.comment.createdAt),
  );
  const active = ordered.at(-1);
  return {
    active,
    superseded: ordered.slice(0, -1).map((entry) => entry.comment),
    malformed,
  };
}

export function parseHandoffPayload(value: unknown): HandoffPayload {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Handoff payload must be a JSON object.');
  }
  const raw = value as Record<string, unknown>;
  const required = [
    'handoffKind',
    'beadId',
    'protocolId',
    'protocolHash',
    'profileId',
    'profileHash',
    'policyHash',
    'contractHash',
    'declaredProfile',
    'minimumProfile',
    'effectiveProfile',
    'publicationHeadSha',
  ];
  for (const key of required) {
    if (typeof raw[key] !== 'string' || raw[key] === '') {
      throw new Error(`Handoff payload is missing string field "${key}".`);
    }
  }
  if (
    raw.handoffKind !== 'contract-authorization' &&
    raw.handoffKind !== 'implementation-review'
  ) {
    throw new Error(
      `Handoff payload has unknown handoffKind ${JSON.stringify(raw.handoffKind)}.`,
    );
  }
  const contract = normalizeHandoffContract(raw.contract);
  if (hashNormalizedContract(contract) !== (raw.contractHash as string)) {
    throw new Error(
      'Handoff payload contractHash does not match the contract structure it publishes. A published digest that does not describe its own payload is stale or forged.',
    );
  }

  return {
    handoffKind: raw.handoffKind,
    contract,
    beadId: raw.beadId as string,
    beadTitle: typeof raw.beadTitle === 'string' ? raw.beadTitle : '',
    protocolId: raw.protocolId as string,
    protocolHash: raw.protocolHash as string,
    profileId: raw.profileId as string,
    profileHash: raw.profileHash as string,
    policyHash: raw.policyHash as string,
    contractHash: raw.contractHash as string,
    declaredProfile: raw.declaredProfile as ReviewProfile,
    minimumProfile: raw.minimumProfile as ReviewProfile,
    effectiveProfile: raw.effectiveProfile as ReviewProfile,
    escalationReasons: Array.isArray(raw.escalationReasons)
      ? (raw.escalationReasons as string[])
      : [],
    authorizationRequired: raw.authorizationRequired === true,
    publicationHeadSha: raw.publicationHeadSha as string,
  };
}

export interface UpsertResult {
  readonly action: 'created' | 'updated' | 'unchanged' | 'dry-run';
  readonly commentId?: number;
  readonly url?: string;
  readonly body: string;
}

/**
 * Idempotent upsert: republishing identical content reports `unchanged` and
 * performs no write, so re-running the command in CI cannot spam a PR.
 */
export async function upsertHandoffComment(
  client: ReviewGitHubClient,
  prNumber: number,
  body: string,
  options: { readonly dryRun: boolean },
): Promise<UpsertResult> {
  const comments = await client.listComments(prNumber);
  const existing = findHandoffComments(comments);
  const target = existing.active?.comment ?? existing.malformed.at(-1);

  if (options.dryRun) {
    return { action: 'dry-run', commentId: target?.id, body };
  }
  if (!target) {
    const created = await client.createComment(prNumber, body);
    return { action: 'created', commentId: created.id, url: created.url, body };
  }
  if (target.body.trim() === body.trim()) {
    return {
      action: 'unchanged',
      commentId: target.id,
      url: target.url,
      body,
    };
  }
  const updated = await client.updateComment(target.id, body);
  return { action: 'updated', commentId: updated.id, url: updated.url, body };
}

/**
 * Accept either the structured form (current) or a raw Markdown block, so a
 * handoff written by hand during an incident still round-trips.
 */
function normalizeHandoffContract(value: unknown): NormalizedContract {
  if (typeof value === 'string') {
    return normalizeContractBlock(value);
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('Handoff payload is missing its "contract" structure.');
  }
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.protocol !== 'string' ||
    !Array.isArray(raw.preamble) ||
    !Array.isArray(raw.sections)
  ) {
    throw new Error(
      'Handoff payload "contract" is not a normalized contract structure.',
    );
  }
  return value as unknown as NormalizedContract;
}
