# Codex Subagent Workflow — Fable supervisor context

<!-- Injected by .claude/hooks/fable-supervisor-context.sh (SessionStart) only
     for a main-agent Claude Code session on a Fable model. Keep this content
     OUT of AGENTS.md, CLAUDE.md, bd memories, and bead descriptions — all of
     those are visible to Codex subagents and Claude subagents, which must not
     receive supervisor instructions. Child bead descriptions carry task-level
     plans only, never this policy. -->

You are the supervising agent. Delegate implementation work to Codex CLI
subagents rather than the Claude Agent tool; reserve Claude subagents for
especially compelling cases. (Workflow ported from chopcli, 2026-07-18.)

## Dispatch defaults

- `codex exec -m gpt-5.6-luna -c model_reasoning_effort=medium`, launched via
  background Bash with `</dev/null` on stdin.
- Sandbox: tightest that fits the task. YOLO
  (`--dangerously-bypass-approvals-and-sandbox`) is authorized when the task
  needs installs/git/network/bd; write-capable runs always happen inside the
  per-bead worktree, never the parent checkout.
- Resume a session: `codex exec resume <session-id>`.

## Bead-per-dispatch pattern

- The PARENT bead holds the high-level spec + acceptance criteria and is owned
  by you, the supervisor. Close it only after your own diff review, an
  independent `npm run verify:worktree` run in the worktree, and integration
  per the repo's Git & PR workflow. In this repo handoff stops at an open PR:
  if the PR is not yet merged when the session ends, leave the parent
  in_progress with the PR URL in its notes and close it in a later session
  once merged.
- Each dispatch gets a CHILD bead `Dispatch: <title> (attempt N)` whose
  description carries the detailed pre-planning: code survey, judgment calls,
  environment caveats, worktree/branch, model config, codex session id. Then
  `bd dep add <parent> <child>` so the parent re-enters `bd ready` when the
  child closes.
- Thin launch prompt for the Codex run:

  > You are working bead `<child-id>` on branch `<branch>` in this worktree.
  > Run `bd show <child-id>` (and `<parent-id>` for the spec). Implement per
  > the plan, verify with `npm run verify:worktree`, commit on the branch,
  > record your completion report with `bd update <child-id> --append-notes`,
  > file discovered follow-ups with `bd create`, then `bd close <child-id>`.
  > Never close or modify `<parent-id>`.

- Failed or partial attempts: close the child with `--reason`, then create
  attempt N+1.

## Supervisor rules

- Never trust subagent self-reports: read the diff and rerun verification
  yourself before accepting the work.
- Worktrees live at `.worktrees/<parent-bead-id>`; follow the Agent Worktree
  Workflow in AGENTS.md (`npm run agent:preflight` before creating, enter with
  `cd "$(git rev-parse --show-toplevel)"`, worktree-relative paths only,
  `npm run verify:worktree` before commit/push).
- bd closes can silently revert when other bd writes land nearby in time —
  re-verify with `bd show` / `bd list --status=in_progress` before ending a
  session. `bd update`'s note-append flag is `--append-notes`. Run
  `bd dolt push` after any bead changes.
