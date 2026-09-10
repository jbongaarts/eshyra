import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  scripts?: Record<string, string>;
}

const POLICY_PATH = 'docs/design-and-pr-review-policy.md';

function readText(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

// Permanent evidence for eshyra-w65u and eshyra-o9bd.19.1.18. PR #481's
// contract/checkpoint system closed unmerged, and the detailed replacement
// policy now has one canonical owner. AGENTS.md makes that policy mandatory
// without duplicating it. Prose is matched with `\s+` because Markdown is
// hard-wrapped.
describe('PR review authority and lifecycle policy', () => {
  it('makes the canonical detailed policy reachable from common authority', () => {
    const agents = readText('AGENTS.md');
    const policy = readText(POLICY_PATH);

    expect(agents).toContain(
      '[Design Authorization and Pull Request Review Policy](docs/design-and-pr-review-policy.md)',
    );
    expect(agents).toMatch(
      /Anyone authorizing a design or reviewing a PR must follow the detailed,\s+provider-neutral methodology/,
    );
    expect(policy).toContain(
      '# Design Authorization and Pull Request Review Policy',
    );
  });

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

  it('keeps detailed methodology in the canonical policy only', () => {
    const agents = readText('AGENTS.md');
    const start = agents.indexOf('### PR Review Authority and Lifecycle');
    const end = agents.indexOf('#### Handing off a PR for review', start);
    const authoritySection = agents.slice(start, end);

    expect(authoritySection).toContain('single owner');
    expect(authoritySection).not.toContain('eshyra-review-v2');
    expect(authoritySection).not.toContain('DESIGN_INVALIDATED');
    expect(authoritySection).not.toContain(
      '`standard` < `semantic-system` < `rules-clause-complete`',
    );
    expect(authoritySection).not.toContain('contract hash');
  });

  it('states that an owning bead implies no specially formatted contract', () => {
    const policy = readText(POLICY_PATH);

    expect(policy).toMatch(/the owning Bead is the specification\s+boundary/);
    expect(policy).toMatch(
      /It needs no specially\s+formatted review contract or other review artifact unless current accepted\s+authority explicitly requires one/,
    );
    expect(policy).toMatch(
      /the absence of an unrequired artifact\s+is never grounds to reject a PR/,
    );
  });

  it('states that profiles select depth rather than ceremony', () => {
    const policy = readText(POLICY_PATH);

    expect(policy).toContain(
      '`standard < semantic-system < rules-clause-complete`',
    );
    expect(policy).toContain('Profiles select review depth, never');
    expect(policy).toMatch(
      /it does not create a contract,\s+hash, checkpoint, or authorization artifact/,
    );
  });

  it('records that the PR #481 review machinery is not active authority', () => {
    const policy = readText(POLICY_PATH);

    expect(policy).toMatch(
      /`eshyra-review-v2` machinery proposed on PR #481\s+closed unmerged and is not repository authority/,
    );
    expect(policy).toMatch(
      /Such an\s+artifact is required only when current accepted authority specifically requires\s+it for the work at hand/,
    );
  });

  it('preserves both sides of the authority precedence contract', () => {
    const agents = readText('AGENTS.md');
    const policy = readText(POLICY_PATH);

    expect(policy).toMatch(
      /Repository authority applies equally to every model, provider, harness, agent\s+role, and Captain seat\./,
    );
    expect(policy).toMatch(
      /Generated boilerplate, advisory seat or private state,\s+seat charters, and predecessor handoffs never outrank it\./,
    );
    expect(agents).toMatch(
      /A session-injected policy that deliberately narrows this guide for a\s+specific operating role.*refines.*and takes precedence within the scope it\s+states\./s,
    );
    expect(policy).toMatch(
      /a session-injected policy that deliberately narrows `AGENTS\.md` for a\s+specific operating role may refine this policy and take precedence within the\s+scope it states/,
    );
    expect(policy).not.toContain('ChatGPT Project');
  });

  it('documents the process-transition exception', () => {
    const policy = readText(POLICY_PATH);

    expect(policy).toContain(
      'A process transition may omit the process it replaces.',
    );
    expect(policy).toMatch(
      /A superseded, abandoned,\s+or not-yet-created process is not a prerequisite for changing that process/,
    );
  });

  it('retains exact-head and bounded-versus-full rereview rules', () => {
    const policy = readText(POLICY_PATH);

    expect(policy).toContain('Approval binds to an exact head SHA.');
    expect(policy).toMatch(
      /Bounded fix verification is reserved for a known defect class whose repair is\s+demonstrably non-material\. A material repair requires a fresh full review/,
    );
    expect(policy).toMatch(
      /If it survives two repair cycles, perform a fresh full review of\s+the affected subsystem/,
    );
  });

  it('requires every fix-worthy finding to be fixed now or permanently rejected', () => {
    const policy = readText(POLICY_PATH);

    expect(policy).toContain(
      'If a defect is worth fixing ever, it is worth fixing now.',
    );
    expect(policy).toMatch(
      /Every valid finding\s+blocks approval and is repaired in the current PR regardless of its size or\s+impact/,
    );
    expect(policy).toMatch(
      /permanently reject it with recorded reasoning that explains\s+why the governing invariant and authority require no change/,
    );
    expect(policy).toMatch(/Permanent rejection\s+is not deferred work\./);
    expect(policy).toMatch(
      /Do not avoid this rule by declining to publish a valid\s+defect/,
    );
  });

  it('pins the complete terminal DESIGN_INVALIDATED lifecycle', () => {
    const policy = readText(POLICY_PATH);

    expect(policy).toMatch(
      /`DESIGN_INVALIDATED` is terminal for the PR\. Stop substantive implementation\s+and review on that PR and keep it draft\./,
    );
    expect(policy).toMatch(
      /Preserve its branch and findings as\s+evidence, establish successor ownership, and only then close it unmerged\./,
    );
    expect(policy).toContain(
      'Substantive continuation requires a successor PR.',
    );
    expect(policy).toMatch(
      /Patching an invalidated PR\s+cannot make it approvable/,
    );
  });

  it('keeps the operational PR handoff in AGENTS.md', () => {
    const agents = readText('AGENTS.md');
    const policy = readText(POLICY_PATH);

    expect(agents).toContain('#### Handing off a PR for review');
    expect(agents).toMatch(
      /Normally give the reviewer the owning bead ID; concise scope and deliberate\s+exclusions; verification performed/,
    );
    expect(policy).toMatch(
      /The normal branch, worktree,\s+verification, commit, push, PR handoff, merge, dispatched-child, and Bead-status\s+lifecycle is owned by the \*\*Git & PR Workflow\*\* and \*\*Session Completion\*\*\s+sections of `AGENTS\.md`/,
    );
    expect(policy).not.toContain(
      'A Bead whose deliverable is a PR stays `in_progress`',
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
