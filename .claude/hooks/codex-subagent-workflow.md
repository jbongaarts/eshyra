# Codex Subagent Workflow — supervisor context

<!-- Injected by .claude/hooks/supervisor-context.mjs (SessionStart) only for a
     main-agent Claude Code session on a Fable or Opus model. Keep this content
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
  child's own worktree, never the parent checkout.
- Resume a session: `codex exec resume <session-id>`.

## Worktree & branch model (one per child)

- The supervisor owns an integration branch + worktree named after the PARENT
  bead: `.worktrees/<parent-bead-id>` on branch `<parent-bead-id>`, cut from
  `origin/main` (`npm run agent:preflight` first, per AGENTS.md).
- Every write-capable dispatch gets its OWN worktree and branch, named after
  the CHILD bead: `.worktrees/<child-bead-id>` on branch `<child-bead-id>`,
  cut from the parent branch. Never point two dispatches at the same worktree
  or branch — concurrent agents sharing a tree can stage/commit each other's
  changes and make verification meaningless. This makes parallel dispatches
  safe by construction; single dispatches just pay one cheap extra merge.
- Integration is the supervisor's job: after a child closes, review its diff,
  run `npm run verify:worktree` yourself in the child worktree, then merge the
  child branch into the parent branch (in the parent worktree), re-run
  verification there if anything else has landed on the parent branch since,
  and remove the finished child worktree. The PR to `main` is opened from the
  parent branch only.

## Bead-per-dispatch pattern

- The PARENT bead holds the high-level spec + acceptance criteria and is owned
  by you, the supervisor. Close it only after your own diff review, an
  independent `npm run verify:worktree` run on the parent branch, and
  integration per the repo's Git & PR workflow. In this repo handoff stops at
  an open PR: if the PR is not yet merged when the session ends, leave the
  parent in_progress with the PR URL in its notes and close it in a later
  session once merged.
- Each dispatch gets a CHILD bead `Dispatch: <title> (attempt N)` whose
  description carries the detailed pre-planning: code survey, judgment calls,
  environment caveats, worktree/branch (per the model above), model config,
  codex session id. Then `bd dep add <parent> <child>` so the parent re-enters
  `bd ready` when the child closes.
- Thin launch prompt for the Codex run:

  > You are working bead `<child-id>` on branch `<child-id>` in this worktree.
  > Run `bd show <child-id>` (and `<parent-id>` for the spec). Implement per
  > the plan, verify with `npm run verify:worktree`, commit on the branch,
  > record your completion report with `bd update <child-id> --append-notes`,
  > file discovered follow-ups with `bd create`, then `bd close <child-id>`.
  > Never close or modify `<parent-id>`, and never touch files outside this
  > worktree.

- Failed or partial attempts: close the child with `--reason`, then create
  attempt N+1 (fresh branch off the current parent branch; delete or abandon
  the failed child branch rather than reusing it).

## Supervisor rules

- **Reviews and planning are yours, never a subagent's.** Do not dispatch Codex
  (or Claude) subagents to review code or to plan — including adversarial PR
  review rounds. Dispatch only for implementation; do review and planning with
  your own tools. (User correction, 2026-07-19, after read-only Codex review
  dispatches on PR #455: "The reviews are for you, along with the planning.
  code writing is for the subagents.")
- Never trust subagent self-reports: read the diff and rerun verification
  yourself before merging a child branch.
- Follow the Agent Worktree Workflow in AGENTS.md for every worktree
  (`npm run agent:preflight` before creating, enter with
  `cd "$(git rev-parse --show-toplevel)"`, worktree-relative paths only,
  `npm run verify:worktree` before commit/push).
- bd closes can silently revert when other bd writes land nearby in time —
  re-verify with `bd show` / `bd list --status=in_progress` before ending a
  session. `bd update`'s note-append flag is `--append-notes`. Run
  `bd dolt push` after any bead changes.

## Dispatches outlive this session

Codex children are billed and rate-limited separately from the supervisor, so
when your session dies on a usage limit they keep running to completion. A
"background task stopped" notification means only that the launched shell
exited — never that the work stopped. (Confirmed by the user, 2026-07-21.)

That is a branch-integrity hazard, not just a stray process. On bead
`eshyra-c7sx` (2026-07-20) two supervisor sessions worked the same bead, each
reading the other's commits as a rogue process; one reset the branch back past
`9222f5d` and force-pushed `f45b1b9` over it, silently reverting two real fixes
and leaving PR #462's reviewed head unreachable from the branch. Cross-session
attribution is unreliable — trust the git and bd record, not any transcript's
account of who did what.

So **record identity at launch, and only ever act on what you recorded.** Start
each dispatch in its own process group and save the PGID alongside the child
bead:

```bash
setsid codex exec … </dev/null &     # new process group
echo "$!" > .worktrees/<child-bead-id>/.dispatch-pid
```

Before integrating:

- Signal only that recorded group (`kill -TERM -<pgid>`), and only after
  confirming it is still the process you launched — check that the PID's start
  time and working directory match the dispatch. A PID can be recycled.
- **Never** run a machine-wide match like `pgrep -af codex` and kill what comes
  back. That pattern catches the user's own interactive Codex sessions, work in
  other repositories, and children belonging to another supervisor; it destroys
  work you cannot see and did not create. (It also matches loosely — any shell
  whose command line merely contains "codex" is a hit.)
- If an unrecorded Codex process seems to be interfering, treat that as a
  finding to report, not something to kill. Reconcile through git instead.
- Read `git reflog <branch>` and compare against `git ls-remote`. An
  unexplained `reset:` or a `merge:` you did not run means another agent moved
  the branch.
- Reconcile forward with additive commits and a plain fast-forward push. Never
  force-push over a commit you did not create, and before discarding any
  commit, check whether it carries fixes absent from the replacement.
