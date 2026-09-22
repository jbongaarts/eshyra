import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  scripts?: Record<string, string>;
}

// Successor to reviewLifecyclePolicy.test.ts (eshyra-4tgd), which grew from the
// lightweight guard eshyra-w65u authorized into ~60 regexes restating the review
// policy back to itself. Under AGENTS.md "Permanent Test Evidence", a regex
// copy of editable authority is not evidence that the authority is correct: an
// authorized bad edit updates document and regex together, while a legitimate
// rewording breaks the regex. Semantic correctness of review policy is owned by
// the authority hierarchy, the owning Bead or design, and semantic-system review
// of changes to that authority — not by this file.
//
// What survives observes repository STRUCTURE that prose review does not itself
// constitute: whether a pointer resolves, whether an agent still loads common
// authority, whether abandoned machinery has come back, and whether two policy
// stages are still in the order the policy depends on.

const WORKSPACE_MANIFESTS = [
  'package.json',
  'packages/core/package.json',
  'packages/cli/package.json',
];

// Surfaces that carry review authority to an agent or a human without being the
// canonical policy document. The policy document itself legitimately names the
// abandoned machinery in order to record it as superseded, so it is not here.
const AUTHORITY_SURFACES = ['AGENTS.md', 'CLAUDE.md'];

// PR #481 (eshyra-o9bd.19.1.17) proposed a profile-based review-contract system:
// an `eshyra-review-v2` protocol, a `## REVIEW CONTRACT` block, a contract hash,
// an authorization checkpoint, `review:*` commands, and a `docs/review/`
// protocol document. It closed unmerged on 2026-07-29 and is not repository
// authority. PR #504 was rejected solely for lacking those absent artifacts,
// which is the concrete harm this guard exists to prevent from recurring.
const ABANDONED_MACHINERY = [
  'eshyra-review-v2',
  'REVIEW CONTRACT',
  'contract hash',
];

function readText(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

/**
 * The canonical policy document as AGENTS.md actually names it, rather than as
 * this file assumes. Following the real link means renaming the document is a
 * passing edit when AGENTS.md is updated with it, and a failing one when the
 * pointer is left dangling.
 */
function resolvePolicyLink(): string {
  const link = readText('AGENTS.md').match(
    /\[Design Authorization and Pull Request Review Policy\]\(([^)]+)\)/,
  );

  if (link === null) {
    throw new Error(
      'AGENTS.md no longer links to the canonical review policy document',
    );
  }

  return link[1];
}

describe('review authority repository structure', () => {
  it('points common authority at a review policy document that exists', () => {
    const target = resolvePolicyLink();

    expect(existsSync(join(process.cwd(), target))).toBe(true);
  });

  it('keeps CLAUDE.md loading AGENTS.md instead of owning policy itself', () => {
    // The import is the mechanism: without it a Claude Code session never reads
    // repository authority at all, whatever either document says.
    expect(readText('CLAUDE.md')).toContain('@AGENTS.md');
  });

  it('does not revive the abandoned PR #481 review machinery', () => {
    for (const surface of AUTHORITY_SURFACES) {
      const text = readText(surface);

      for (const artifact of ABANDONED_MACHINERY) {
        expect(
          text.includes(artifact),
          `${surface} revives PR #481's "${artifact}"`,
        ).toBe(false);
      }
    }

    for (const manifest of WORKSPACE_MANIFESTS) {
      const { scripts } = JSON.parse(readText(manifest)) as PackageJson;

      for (const name of Object.keys(scripts ?? {})) {
        expect(
          name.startsWith('review:'),
          `${manifest} revives PR #481's review:* command surface`,
        ).toBe(false);
      }
    }

    expect(existsSync(join(process.cwd(), 'docs/review'))).toBe(false);
  });

  it('keeps the disposition gate ahead of findings discipline', () => {
    const policy = readText(resolvePolicyLink());
    const gate = policy.indexOf('## From observation to finding');
    const findings = policy.indexOf('## Findings discipline');

    // A gate that runs after the stage it gates is not a gate. The policy states
    // this ordering in prose and depends on it; only the document's actual
    // topology can show whether the statement is still true.
    expect(gate).toBeGreaterThan(-1);
    expect(findings).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(findings);
  });
});
