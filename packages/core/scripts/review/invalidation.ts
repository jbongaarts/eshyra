/**
 * `DESIGN_INVALIDATED` — the terminal state.
 *
 * Invalidation is not "changes requested with feeling". It records that the
 * DESIGN, not the diff, failed: repeated rounds produced new defect classes
 * after material contract changes and fresh full reviews. Once published for a
 * PR, every readiness and approval command must fail for that PR permanently.
 * Recovery is a successor bead and a new PR, never a fix on the invalidated
 * branch.
 *
 * The command publishes a comment and nothing else. It does not close the PR,
 * label it, or mutate any bead: silent mutation would destroy the evidence
 * record the invalidation exists to preserve. PRs #475, #476, and #477 are the
 * worked examples and are used only as regression fixtures.
 */

import type { IssueComment, ReviewGitHubClient } from './github.js';
import {
  detectMarker,
  extractJsonPayload,
  fenceJson,
  hasMarker,
  INVALIDATION_MARKER,
} from './markers.js';
import type { ReviewProfile } from './profiles.js';

export interface InvalidationPayload {
  readonly invalidatedHeadSha: string;
  readonly owningBead: string;
  readonly effectiveProfile: ReviewProfile;
  readonly reason: string;
  readonly newDefectClasses: readonly string[];
  /** Successor bead id, or the empty string for pending-successor state. */
  readonly successorBead: string;
}

export interface InvalidationRecord {
  readonly comment: IssueComment;
  readonly payload: InvalidationPayload;
}

export function formatInvalidationComment(
  payload: InvalidationPayload,
): string {
  const successor =
    payload.successorBead === ''
      ? '**PENDING SUCCESSOR** — no successor bead has been named yet. Work does not resume on this PR regardless.'
      : `\`${payload.successorBead}\``;

  const defects =
    payload.newDefectClasses.length === 0
      ? '_none recorded_'
      : payload.newDefectClasses.map((entry) => `- ${entry}`).join('\n');

  return [
    INVALIDATION_MARKER,
    '',
    '# STOP WORK — `DESIGN_INVALIDATED`',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Invalidated head | \`${payload.invalidatedHeadSha}\` |`,
    `| Owning bead | \`${payload.owningBead}\` |`,
    `| Effective profile | \`${payload.effectiveProfile}\` |`,
    `| Successor | ${successor} |`,
    '',
    '## Reason',
    '',
    payload.reason,
    '',
    '## Newly discovered defect classes',
    '',
    defects,
    '',
    '## Consequences',
    '',
    '- **No further substantive commits** may be made on this branch.',
    '- **This PR must not be merged.** It is not superseded by a green build.',
    '- Every readiness, authorization, and approval command fails permanently for this PR.',
    '- Existing review findings stay open and unresolved; they are the evidence record.',
    '- The branch is retained as historical and salvage evidence, and is not deleted.',
    '- Recovery is a successor bead and a new PR, never a fix here.',
    '',
    '## Machine payload',
    '',
    fenceJson(payload),
    '',
  ].join('\n');
}

export function parseInvalidationPayload(value: unknown): InvalidationPayload {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalidation payload must be a JSON object.');
  }
  const raw = value as Record<string, unknown>;
  for (const key of ['invalidatedHeadSha', 'owningBead', 'reason']) {
    if (typeof raw[key] !== 'string' || raw[key] === '') {
      throw new Error(`Invalidation payload is missing string field "${key}".`);
    }
  }
  return {
    invalidatedHeadSha: raw.invalidatedHeadSha as string,
    owningBead: raw.owningBead as string,
    effectiveProfile: (raw.effectiveProfile ?? 'standard') as ReviewProfile,
    reason: raw.reason as string,
    newDefectClasses: Array.isArray(raw.newDefectClasses)
      ? (raw.newDefectClasses as string[])
      : [],
    successorBead:
      typeof raw.successorBead === 'string' ? raw.successorBead : '',
  };
}

/**
 * Detect invalidation. A comment carrying the marker counts EVEN IF its
 * machine payload is malformed — the human stop-work notice is the operative
 * signal, and a parse failure must never downgrade a terminal state to
 * "absent". PRs #475–#477 predate the machine payload entirely.
 */
export function findInvalidation(comments: readonly IssueComment[]): {
  readonly invalidated: boolean;
  readonly records: readonly InvalidationRecord[];
  readonly markerOnly: readonly IssueComment[];
} {
  const records: InvalidationRecord[] = [];
  const markerOnly: IssueComment[] = [];
  for (const comment of comments) {
    if (!hasMarker(comment.body, INVALIDATION_MARKER)) {
      const marker = detectMarker(comment.body);
      if (marker?.family === 'eshyra-design-invalidated') {
        // A future marker version still means "stop", regardless of parsing.
        markerOnly.push(comment);
      }
      continue;
    }
    try {
      records.push({
        comment,
        payload: parseInvalidationPayload(extractJsonPayload(comment.body)),
      });
    } catch {
      markerOnly.push(comment);
    }
  }
  return {
    invalidated: records.length > 0 || markerOnly.length > 0,
    records,
    markerOnly,
  };
}

export async function publishInvalidation(
  client: ReviewGitHubClient,
  prNumber: number,
  payload: InvalidationPayload,
  options: { readonly dryRun: boolean },
): Promise<{ action: 'created' | 'dry-run'; url?: string; body: string }> {
  const body = formatInvalidationComment(payload);
  if (options.dryRun) {
    return { action: 'dry-run', body };
  }
  const created = await client.createComment(prNumber, body);
  return { action: 'created', url: created.url, body };
}
