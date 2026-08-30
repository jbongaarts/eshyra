import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  scripts?: Record<string, string>;
}

function readText(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

// Permanent evidence for eshyra-w65u. The profile-based contract-authorization
// system (PR #481, protocol `eshyra-review-v2`) was closed unmerged, but
// reviewer instructions kept treating its artifacts as required authority and
// rejected PR #504 for their absence. AGENTS.md is the authority that settles
// this, so the distinctions it draws are pinned here. Prose is matched with
// `\s+` between words because AGENTS.md is hard-wrapped.
describe('PR review authority and lifecycle policy', () => {
  it('documents the review lifecycle next to the Git & PR workflow', () => {
    const agents = readText('AGENTS.md');

    expect(agents).toContain('### PR Review Authority and Lifecycle');
    expect(
      agents.indexOf('### PR Review Authority and Lifecycle'),
    ).toBeGreaterThan(agents.indexOf('## Git & PR Workflow'));
    expect(
      agents.indexOf('### PR Review Authority and Lifecycle'),
    ).toBeLessThan(agents.indexOf('## Beads Issue Tracker'));
  });

  it('states that an owning bead implies no specially formatted contract', () => {
    const agents = readText('AGENTS.md');

    expect(agents).toMatch(
      /It does \*\*not\*\* need a specially\s+formatted `## REVIEW CONTRACT` section unless some accepted authority\s+explicitly requires that format for that work/,
    );
    expect(agents).toMatch(
      /the absence of such a\s+section is never itself grounds to reject a PR/,
    );
  });

  it('states that a review profile implies no checkpoint ceremony', () => {
    const agents = readText('AGENTS.md');

    expect(agents).toContain('**Profiles select review depth, not ceremony.**');
    expect(agents).toMatch(
      /A profile\s+never by itself creates a requirement for a separate contract or authorization\s+artifact\./,
    );
    expect(agents).toMatch(
      /must not require a\s+contract hash, an authorization comment, a review checkpoint/,
    );
  });

  it('records that the PR #481 review machinery is not active authority', () => {
    const agents = readText('AGENTS.md');

    expect(agents).toMatch(
      /proposed on PR #481\s+\(`eshyra-o9bd\.19\.1\.17`, protocol `eshyra-review-v2`\) and closed unmerged on\s+2026-07-29; it is not repository authority/,
    );
    expect(agents).toMatch(
      /An abandoned review-contract\s+system is not required authority and must not be treated as such\./,
    );
  });

  it('keeps explicit accepted authority able to require more artifacts', () => {
    const agents = readText('AGENTS.md');

    expect(agents).toMatch(
      /Such artifacts become required only where an accepted ADR, repository policy,\s+an explicit assignment, or other current authority specifically establishes\s+them for the work being reviewed\./,
    );
  });

  it('documents the process-transition exception', () => {
    const agents = readText('AGENTS.md');

    expect(agents).toContain(
      '**A process transition may omit the artifact it replaces.**',
    );
    expect(agents).toMatch(
      /Do not\s+require the process being changed as a prerequisite for changing it/,
    );
    expect(agents).toContain('ADR 0020 / PR #482 is the');
  });

  it('retains authority-first, exact-head, and blocking-findings rules', () => {
    const agents = readText('AGENTS.md');

    expect(agents).toContain('**Authority-first review remains mandatory.**');
    expect(agents).toContain('**Approval binds to an exact head SHA.**');
    expect(agents).toMatch(
      /`DESIGN_INVALIDATED` is terminal for that PR — an invalidated PR can never\s+later be approved\./,
    );
    expect(agents).toMatch(
      /There are no "nonblocking", "minor", "optional", or\s+"follow-up" findings: a fix-worthy defect blocks the PR it was found in\./,
    );
  });

  it('tells PR authors what to hand off without contract boilerplate', () => {
    const agents = readText('AGENTS.md');

    expect(agents).toContain('#### Handing off a PR for review');
    expect(agents).toMatch(
      /Do not manufacture review-contract or\s+checkpoint boilerplate that no active authority consumes\./,
    );
  });

  it('keeps CLAUDE.md a thin pointer that does not restate the policy', () => {
    const claude = readText('CLAUDE.md');

    expect(claude).toContain('@AGENTS.md');
    expect(claude).not.toContain('REVIEW CONTRACT');
    expect(claude).not.toContain('eshyra-review-v2');
  });

  it('ships no review-governance infrastructure for the abandoned protocol', () => {
    const root = JSON.parse(readText('package.json')) as PackageJson;

    for (const name of Object.keys(root.scripts ?? {})) {
      expect(
        name.startsWith('review:'),
        `"${name}" revives PR #481's review:* command surface`,
      ).toBe(false);
    }
  });
});
