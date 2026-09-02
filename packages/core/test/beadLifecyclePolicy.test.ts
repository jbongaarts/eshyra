import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readText(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

const SUPERVISOR_HOOK = '.claude/hooks/codex-subagent-workflow.md';

// Permanent evidence for eshyra-o9bd.19.16. A Codex main-agent session closed
// an owning bead as soon as it opened the PR and reopened it on the first
// blocking review, while Claude sessions held the bead until merge. The cause
// was structural, not a model quirk: the only statement of the rule lived in
// the supervisor hook, which is injected by a Claude Code SessionStart hook
// that Codex can never execute, while AGENTS.md said only "an open, unmerged
// PR is a complete handoff" and `bd prime` injects a generated session-close
// checklist whose first item is `bd close`. AGENTS.md is the authority both
// agents read, so the distinctions it now draws are pinned here. Prose is
// matched with `\s+` between words because AGENTS.md is hard-wrapped.
describe('bead lifecycle policy', () => {
  it('states that a PR-deliverable bead stays in_progress until merge', () => {
    const agents = readText('AGENTS.md');

    expect(agents).toMatch(
      /\*\*A bead whose deliverable is a pull request stays `in_progress` until that PR\s+merges\.\*\*/,
    );
    expect(agents).toMatch(
      /An open PR is a complete \*handoff\*, not a completed bead/,
    );
  });

  it('scopes the rule by deliverable so dispatched children still close', () => {
    const agents = readText('AGENTS.md');

    expect(agents).toContain('Judge by **deliverable**, not by agent role.');
    expect(agents).toMatch(
      /is finished when that\s+commit lands on its branch, and the child closes its own bead as instructed/,
    );
  });

  it('records that it narrows the generated bd close checklist', () => {
    const agents = readText('AGENTS.md');

    expect(agents).toMatch(
      /narrows the generated `bd close` session-close checklist that `bd prime`\s+injects/,
    );
  });

  it('keeps the rule in Session Completion, ahead of PR Merge Policy', () => {
    const agents = readText('AGENTS.md');
    const rule = agents.indexOf(
      '**A bead whose deliverable is a pull request stays',
    );

    expect(rule).toBeGreaterThan(agents.indexOf('### Session Completion'));
    expect(rule).toBeLessThan(agents.indexOf('### PR Merge Policy'));
  });

  it('does not strand the rule in the supervisor-only hook', () => {
    // The hook is Claude Code tooling and optional; the policy above stands
    // without it. When it is present it must point at AGENTS.md rather than
    // restate the rule, or the rule is once again visible to only one agent.
    if (!existsSync(join(process.cwd(), SUPERVISOR_HOOK))) return;
    const hook = readText(SUPERVISOR_HOOK);

    expect(hook).toContain('AGENTS.md');
    expect(hook).not.toMatch(
      /handoff stops at\s+an open PR: if the PR is not yet merged when the session ends/,
    );
  });
});
