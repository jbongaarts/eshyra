/**
 * Checkpoint comments: formatting and discovery.
 *
 * Checkpoint comments stay COMPACT. They carry a small table, the machine
 * payload, and nothing else — no protocol restatement, no normalized contract,
 * no checklist. The contract lives in the handoff comment; the protocol lives
 * in `docs/review`. Duplicating either here would put a copy of the whole
 * system into every reviewer's PR timeline.
 *
 * Unlike handoffs there is no upsert: checkpoints are an append-only record.
 * A reviewer's earlier verdict is history, not something to overwrite. The
 * LATEST checkpoint of each kind is current; earlier ones are superseded.
 */

import {
  type CheckpointKind,
  type CheckpointTrust,
  parseCheckpoint,
  type ReviewCheckpoint,
} from './checkpoints.js';
import type { IssueComment, ReviewGitHubClient } from './github.js';
import { shortHash } from './hashing.js';
import {
  CHECKPOINT_MARKER,
  detectMarker,
  extractJsonPayload,
  fenceJson,
  hasMarker,
} from './markers.js';

export interface CheckpointComment {
  readonly comment: IssueComment;
  readonly checkpoint: ReviewCheckpoint;
}

export interface CheckpointDiscovery {
  readonly currentAuthorization?: CheckpointComment;
  readonly currentImplementation?: CheckpointComment;
  readonly superseded: readonly CheckpointComment[];
  /** Comments carrying the marker whose payload could not be parsed. */
  readonly malformed: readonly { comment: IssueComment; error: string }[];
}

export function formatCheckpointComment(checkpoint: ReviewCheckpoint): string {
  const rows: string[][] = [
    ['Checkpoint kind', `\`${checkpoint.checkpointKind}\``],
    ['Result', `\`${checkpoint.result}\``],
    ['Effective profile', `\`${checkpoint.effectiveProfile}\``],
    ['Reviewer role', checkpoint.reviewerRole],
    [
      'Protocol / profile / policy',
      `\`${shortHash(checkpoint.protocolHash)}\` / \`${shortHash(checkpoint.profileHash)}\` / \`${shortHash(checkpoint.policyHash)}\``,
    ],
    ['Contract', `\`${shortHash(checkpoint.contractHash)}\``],
    ['Open findings', String(checkpoint.openFindings)],
    ['New defect classes', String(checkpoint.newDefectClasses)],
    ['Material contract change', String(checkpoint.materialContractChange)],
    [
      'Fresh contract review required',
      String(checkpoint.freshContractReviewRequired),
    ],
  ];

  if (checkpoint.checkpointKind === 'contract-authorization') {
    rows.push(
      ['Reviewed scope', `\`${checkpoint.reviewedScope}\``],
      ['Publication head', `\`${checkpoint.publicationHeadSha}\``],
      [
        'Implementation permission',
        `**${checkpoint.implementationPermission}**`,
      ],
    );
  } else {
    rows.push(
      ['Reviewed head', `\`${checkpoint.reviewedHeadSha}\``],
      ['Review mode', `\`${checkpoint.reviewMode}\``],
      [
        'Fresh full implementation review required',
        String(checkpoint.freshFullImplementationReviewRequired),
      ],
      [
        'Next permissible review mode',
        `\`${checkpoint.nextPermissibleReviewMode}\``,
      ],
      ['Design invalidated', String(checkpoint.designInvalidated)],
    );
  }

  const title =
    checkpoint.checkpointKind === 'contract-authorization'
      ? 'Contract authorization checkpoint'
      : 'Implementation review checkpoint';

  return [
    CHECKPOINT_MARKER,
    '',
    `# ${title}`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    ...rows.map(([key, value]) => `| ${key} | ${value} |`),
    '',
    checkpoint.checkpointKind === 'contract-authorization'
      ? 'The publication head is context for this authorization, not an approval of the code at that commit.'
      : 'This approval binds to the reviewed head only. Any new commit invalidates it.',
    '',
    fenceJson(checkpointPayload(checkpoint)),
    '',
  ].join('\n');
}

function checkpointPayload(
  checkpoint: ReviewCheckpoint,
): Record<string, unknown> {
  return { ...checkpoint };
}

export function findCheckpointComments(
  comments: readonly IssueComment[],
  trust: CheckpointTrust = 'production',
): CheckpointDiscovery {
  const unsupported = comments.filter((comment) => {
    const marker = detectMarker(comment.body);
    return marker?.family === 'eshyra-review-checkpoint' && !marker.supported;
  });
  if (unsupported.length > 0) {
    throw new Error(
      `PR carries ${unsupported.length} eshyra-review-checkpoint comment(s) at an unsupported marker version. Refusing to evaluate review state against checkpoints this tool cannot read.`,
    );
  }

  const parsed: CheckpointComment[] = [];
  const malformed: { comment: IssueComment; error: string }[] = [];
  for (const comment of comments) {
    if (!hasMarker(comment.body, CHECKPOINT_MARKER)) {
      continue;
    }
    try {
      parsed.push({
        comment,
        checkpoint: parseCheckpoint(extractJsonPayload(comment.body), {
          trust,
        }),
      });
    } catch (error) {
      malformed.push({ comment, error: (error as Error).message });
    }
  }

  const ordered = [...parsed].sort((a, b) =>
    a.comment.createdAt === b.comment.createdAt
      ? a.comment.id - b.comment.id
      : a.comment.createdAt.localeCompare(b.comment.createdAt),
  );
  const latestOfKind = (kind: CheckpointKind): CheckpointComment | undefined =>
    [...ordered]
      .reverse()
      .find((entry) => entry.checkpoint.checkpointKind === kind);

  const currentAuthorization = latestOfKind('contract-authorization');
  const currentImplementation = latestOfKind('implementation-review');
  const currentIds = new Set(
    [currentAuthorization, currentImplementation]
      .filter((entry) => entry !== undefined)
      .map((entry) => entry.comment.id),
  );

  return {
    currentAuthorization,
    currentImplementation,
    superseded: ordered.filter((entry) => !currentIds.has(entry.comment.id)),
    malformed,
  };
}

export async function publishCheckpoint(
  client: ReviewGitHubClient,
  prNumber: number,
  checkpoint: ReviewCheckpoint,
  options: { readonly dryRun: boolean },
): Promise<{ action: 'created' | 'dry-run'; url?: string; body: string }> {
  const body = formatCheckpointComment(checkpoint);
  if (options.dryRun) {
    return { action: 'dry-run', body };
  }
  const created = await client.createComment(prNumber, body);
  return { action: 'created', url: created.url, body };
}
