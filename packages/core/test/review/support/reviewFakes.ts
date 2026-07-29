/**
 * In-memory GitHub and Beads doubles plus contract builders.
 *
 * Unit tests never touch a live service. Both boundaries are interfaces for
 * exactly this reason, and these doubles are the only implementations the
 * tests use.
 */

import type {
  BeadIssue,
  ReviewBeadsClient,
} from '../../../scripts/review/beads.js';
import type {
  IssueComment,
  PullRequestSnapshot,
  ReviewGitHubClient,
} from '../../../scripts/review/github.js';
import type { ReviewProfile } from '../../../scripts/review/profiles.js';

export class FakeGitHub implements ReviewGitHubClient {
  private nextCommentId = 1000;
  readonly comments = new Map<number, IssueComment[]>();
  readonly prs = new Map<number, PullRequestSnapshot>();
  baseBranchPaths = new Set<string>();
  readonly writes: string[] = [];

  setPullRequest(pr: PullRequestSnapshot): void {
    this.prs.set(pr.number, pr);
    if (!this.comments.has(pr.number)) {
      this.comments.set(pr.number, []);
    }
  }

  addComment(prNumber: number, body: string, createdAt?: string): IssueComment {
    const id = this.nextCommentId++;
    const comment: IssueComment = {
      id,
      body,
      url: `https://github.test/pr/${prNumber}#issuecomment-${id}`,
      createdAt: createdAt ?? new Date(1700000000000 + id).toISOString(),
      authorLogin: 'reviewer',
    };
    const list = this.comments.get(prNumber) ?? [];
    list.push(comment);
    this.comments.set(prNumber, list);
    return comment;
  }

  async getPullRequest(number: number): Promise<PullRequestSnapshot> {
    const pr = this.prs.get(number);
    if (!pr) {
      throw new Error(`FakeGitHub has no PR #${number}`);
    }
    return pr;
  }

  async listComments(number: number): Promise<readonly IssueComment[]> {
    return this.comments.get(number) ?? [];
  }

  async createComment(number: number, body: string): Promise<IssueComment> {
    this.writes.push(`create:${number}`);
    return this.addComment(number, body);
  }

  async updateComment(commentId: number, body: string): Promise<IssueComment> {
    this.writes.push(`update:${commentId}`);
    for (const [prNumber, list] of this.comments) {
      const index = list.findIndex((comment) => comment.id === commentId);
      if (index !== -1) {
        const updated = { ...list[index], body };
        list[index] = updated;
        this.comments.set(prNumber, list);
        return updated;
      }
    }
    throw new Error(`FakeGitHub has no comment ${commentId}`);
  }

  async baseBranchHasPath(_base: string, path: string): Promise<boolean> {
    return this.baseBranchPaths.has(path);
  }
}

export class FakeBeads implements ReviewBeadsClient {
  readonly issues = new Map<string, BeadIssue>();

  set(issue: BeadIssue): void {
    this.issues.set(issue.id, issue);
  }

  async getIssue(id: string): Promise<BeadIssue | undefined> {
    return this.issues.get(id);
  }
}

export function captureIo(): {
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
  out: () => string;
  err: () => string;
} {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  return {
    stdout: {
      write(chunk: string) {
        outChunks.push(chunk);
        return true;
      },
    },
    stderr: {
      write(chunk: string) {
        errChunks.push(chunk);
        return true;
      },
    },
    out: () => outChunks.join(''),
    err: () => errChunks.join(''),
  };
}

export function fakePr(
  overrides: Partial<PullRequestSnapshot> = {},
): PullRequestSnapshot {
  return {
    number: 900,
    title: 'test pr',
    state: 'OPEN',
    isDraft: false,
    headRefName: 'eshyra-test',
    headSha: 'a'.repeat(40),
    baseRefName: 'main',
    changedPaths: ['packages/cli/src/index.ts'],
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
 * Contract builders
 * ---------------------------------------------------------------------- */

const COMMON_BODY = `### Objective and scope
- Intended outcome: Make the widget resolve deterministically.
- In scope: the widget resolver and its tests.
- Out of scope: the renderer.
- Exact affected surfaces: packages/cli/src/index.ts

### Authority and inputs
- Authoritative inputs: the widget specification.
- Derived inputs: the resolver cache.
- Untrusted inputs: user-supplied widget names.
- Ownership: this bead owns the resolver.

### Behavior and representation
- Required behavior: resolve every declared widget or fail.
- Required distinctions: declared versus inferred widgets.
- Compatibility requirements: existing callers keep working.
- Negative behavior: unknown widgets raise, never default.

### Consumers and blast radius
- Direct consumers: the CLI entry point.
- Indirect consumers: the smoke test.
- Cross-surface checks: CLI help output regenerated.
- Migration implications: none; no persisted shape changes.

### Failure, recovery, and residuals
- Fail-closed requirements: unresolved widget names raise.
- Recovery or rollback: revert the commit; no state is written.
- Approved residuals: the legacy alias table stays for one release.
- Explicitly unsupported material: nested widget graphs.

### Verification and closure
- Required tests: resolver unit tests plus a CLI smoke case.
- Permanent regression evidence: packages/core/test/widget.test.ts
- Generated or exact membership: not applicable.
- Closure evidence: verify:worktree green and an approved implementation review.`;

const SEMANTIC_BODY = `### Semantic-system contract
- Trust boundaries: the resolver trusts the specification, nothing else.
- Stable identities and revisions: widget id plus a content revision hash.
- State transitions and lifecycle: draft to active to retired, one way.
- Stale-state detection: revision mismatch raises rather than repairs.
- Migration and backward compatibility: version 1 rows are read read-only.
- Adversarial scenarios: a caller forging a revision hash is rejected.`;

const RULES_BODY = `### Source or authoritative obligations
- Authority: the frozen SRD extraction, pinned by digest.
- Exact membership or bounded scope: five procedures on five pages.
- Membership derivation: span tiling over reviewed regions.
- Source spans or authoritative inputs: page-anchored span locators.
- Complete obligations: every facet occurrence on those spans.

### Pack representation
- Required semantic distinctions: save count, branch binding, termination.
- Branches, alternatives, multiplicity, and locality: one atom per obligation.
- Timing, lifecycle, resources, reset, and termination: modelled per facet.
- Provenance: locator plus source span on every record.

### Cross-kind and cross-surface siblings
- Applicable record kinds: hazard, equipment, feature, spell.
- Applicable consumers: the reference harness only.
- Generated predicates or reconciliation: exact identity sets, never counts.

### Capability boundary
- Required engine capabilities: save resolution and damage application.
- Evidence strength: reference execution, not symbol presence.
- Existing owners: the F-family engine beads.
- Known missing capability handling: refuse execution, never fill the gap.

### Pack-driven reference execution
- Real generated-record scenarios: the five shipped records unmodified.
- Negative and fail-closed scenarios: a removed required field refuses.
- Replay, rollback, RNG, or determinism requirements: seeded RNG, fixed trace.

### Rules residuals
- Source ambiguity: none in the bounded regions.
- Designed adjudication: the GM-latitude clause is model-adjudicated.
- Explicitly unsupported source material: material outside the five regions.`;

export interface BuildContractOptions {
  readonly profile: ReviewProfile;
  readonly beadId?: string;
  readonly authorization?: string;
  readonly characteristics?: string;
  readonly protocol?: string;
  readonly omitSections?: readonly string[];
  readonly extraSections?: string;
  readonly placeholderField?: string;
}

/** Build a valid contract block for `profile`, with targeted defects. */
export function buildContract(options: BuildContractOptions): string {
  const beadId = options.beadId ?? 'eshyra-test.1';
  const authorization =
    options.authorization ?? (options.profile === 'standard' ? 'no' : 'yes');
  const characteristics = options.characteristics ?? 'none';

  let body = [
    '## REVIEW CONTRACT',
    '',
    `Protocol: ${options.protocol ?? 'eshyra-review-v2'}`,
    '',
    '### Review classification',
    `- Declared profile: ${options.profile}`,
    `- Authorization required before implementation: ${authorization}`,
    '- Classification reason: exercised by the review-system test suite.',
    `- Change characteristics: ${characteristics}`,
    '- Escalation conditions: escalate if persisted state enters scope.',
    `- Owning Bead: ${beadId}`,
    '',
    COMMON_BODY,
  ].join('\n');

  if (options.profile !== 'standard') {
    body += `\n\n${SEMANTIC_BODY}`;
  }
  if (options.profile === 'rules-clause-complete') {
    body += `\n\n${RULES_BODY}`;
  }
  if (options.extraSections) {
    body += `\n\n${options.extraSections}`;
  }

  for (const section of options.omitSections ?? []) {
    const start = body.indexOf(`### ${section}`);
    if (start === -1) {
      throw new Error(`Test builder: no section "${section}" to omit.`);
    }
    const nextIndex = body.indexOf('\n### ', start + 1);
    body =
      body.slice(0, start) +
      (nextIndex === -1 ? '' : body.slice(nextIndex + 1));
  }

  if (options.placeholderField) {
    const [key] = options.placeholderField.split('=');
    body = body.replace(new RegExp(`^- ${key}:.*$`, 'm'), `- ${key}: TBD`);
  }

  return body;
}

export function beadWithContract(
  options: BuildContractOptions & { readonly title?: string },
): BeadIssue {
  const id = options.beadId ?? 'eshyra-test.1';
  return {
    id,
    title: options.title ?? 'Test bead',
    description: buildContract(options),
    acceptanceCriteria: 'The suite passes.',
    status: 'in_progress',
  };
}
