/**
 * Injectable Beads boundary.
 *
 * The bead is the authoritative location for a change-specific review
 * contract, so this is the only place the review system reads it from. It is
 * read-only by construction: the review system never mutates a bead, because
 * "the tool closed the bead" is not evidence that the work was reviewed.
 *
 * The normative contract may appear in the bead's description or its
 * acceptance criteria; chronological NOTES are explanatory only and are not
 * scanned, so a design round appended to notes cannot silently become the
 * contract.
 */

import { spawnSync } from 'node:child_process';

export interface BeadIssue {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: string;
  readonly status: string;
}

export interface ReviewBeadsClient {
  getIssue(id: string): Promise<BeadIssue | undefined>;
}

export class BeadsAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BeadsAccessError';
  }
}

interface BdIssueJson {
  id: string;
  title?: string;
  description?: string;
  acceptance_criteria?: string;
  status?: string;
}

/** Production client, backed by `bd show --json`. */
export class BdCliBeadsClient implements ReviewBeadsClient {
  constructor(private readonly cwd: string) {}

  async getIssue(id: string): Promise<BeadIssue | undefined> {
    const result = spawnSync('bd', ['show', id, '--json'], {
      cwd: this.cwd,
      encoding: 'utf8',
    });
    if (result.error) {
      throw new BeadsAccessError(
        `Failed to run bd show ${id}: ${result.error.message}`,
      );
    }
    if (result.status !== 0) {
      throw new BeadsAccessError(
        `bd show ${id} exited ${result.status}: ${result.stderr.trim()}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (error) {
      throw new BeadsAccessError(
        `bd show ${id} returned malformed JSON: ${(error as Error).message}`,
      );
    }
    const rows = (Array.isArray(parsed) ? parsed : [parsed]) as BdIssueJson[];
    const row = rows.find((entry) => entry?.id === id);
    if (!row) {
      return undefined;
    }
    return {
      id: row.id,
      title: row.title ?? '',
      description: row.description ?? '',
      acceptanceCriteria: row.acceptance_criteria ?? '',
      status: row.status ?? '',
    };
  }
}

/** The bead fields that may legally carry the normative contract. */
export function contractSources(
  issue: BeadIssue,
): { label: string; text: string }[] {
  return [
    { label: `${issue.id} description`, text: issue.description },
    {
      label: `${issue.id} acceptance criteria`,
      text: issue.acceptanceCriteria,
    },
  ];
}
