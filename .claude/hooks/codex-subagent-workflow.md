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

**Always launch through `/home/jhbongaarts/.claude/dispatch-codex.sh`. Never
hand-roll a `setsid`/`codex exec` command line.** Auto mode allowlists exactly
that script path (`Bash(/home/jhbongaarts/.claude/dispatch-codex.sh:*)` in
`~/.claude/settings.json`); a hand-written `setsid … codex exec
--dangerously-bypass-approvals-and-sandbox …` is NOT allowlisted and the auto-mode
classifier will refuse it. The script lives outside the repo on purpose, so the
Codex children it dispatches cannot read it.

```bash
# write the launch prompt first; the script reads it from the registry
/home/jhbongaarts/.claude/dispatch-codex.sh <child-bead-id>
/home/jhbongaarts/.claude/dispatch-codex.sh <child-bead-id> --dry-run   # preview
```

- Defaults to `-m gpt-5.6-luna -c model_reasoning_effort=medium` with YOLO
  (`--dangerously-bypass-approvals-and-sandbox`); override with `--model`,
  `--effort`, `--prompt-file`, or `--sandbox` (drops YOLO).
- It reads `<root>/.worktrees/.dispatch/<child>.prompt`, writes `<child>.log` and
  `<child>.pgid` beside it, refuses to dispatch into the parent checkout, refuses
  a worktree not on the child's own branch, and refuses to double-dispatch a bead
  whose recorded process group is still alive. Those guards only protect you if
  you actually go through the script.
- Resume a session: `codex exec resume <session-id>`.

**If a dispatch launch is refused, STOP AND ASK THE USER.** A refusal means the
approved path was not taken or the environment changed. Do not "adjust" by
downgrading the sandbox, and above all do not strip capabilities out of the
child's task to fit a weaker sandbox — see the bead-protocol rule below. A
weakened dispatch silently produces a child that cannot do its job and a
supervisor that has to fake the missing half.

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
  > the plan, run `npm run verify:worktree` **before** committing (it rewrites
  > files), commit on the branch, record your completion report with
  > `bd update <child-id> --append-notes`, file discovered follow-ups with
  > `bd create`, then `bd close <child-id>`.
  >
  > **Then stop.** AGENTS.md grants agents standing authority to push a branch
  > and open a PR. That authority does **not** apply to you on this dispatch:
  > do not push, do not open or comment on a pull request, and do not merge
  > anything. Integration is handled by the agent that dispatched you; leaving
  > your work committed on `<child-id>` is a complete handoff. Never close or
  > modify `<parent-id>`, and never touch files outside this worktree.

- Failed or partial attempts: close the child with `--reason`, then create
  attempt N+1 (fresh branch off the current parent branch; delete or abandon
  the failed child branch rather than reusing it).

### The beads protocol is the communication channel — NEVER route around it

**Standing user instruction, restated after a violation on 2026-08-29.** Beads
is how a dispatched subagent receives its task and reports back. Every dispatch
prompt MUST tell the child to read its spec with `bd show` and to report with
`bd update --append-notes` / `bd create` / `bd close`. That is the protocol.

Forbidden, in every case and for every reason:

- telling a child **"do NOT run `bd`"**, or otherwise removing bd from its prompt;
- substituting files (`.dispatch-plan.md`, `.dispatch-report.md`, a pasted spec
  in the prompt, anything else) for `bd show` and `bd`-recorded notes;
- writing the child's completion report or closing its bead **on its behalf**
  because it could not reach bd;
- weakening the dispatch sandbox until bd is unreachable and then working around
  the consequence.

If bd is unreachable for a dispatch, the dispatch is **blocked**. Say so and ask
the user. Do not invent a substitute channel — a file-based side channel looks
like it worked, but it strands the record outside Dolt, it never reaches
`bd dolt push`, and no other machine, Codex session, or future supervisor can
see it. The whole point of the protocol is that the task record is shared and
syncable; a private file is the one thing it must never degrade into.

Note the interaction with the sandbox: `bd` writes to the Dolt DB in the PARENT
checkout, outside any child worktree. A `--sandbox workspace-write` dispatch
therefore cannot use bd at all, and cannot `git commit` either (a linked
worktree's git metadata lives in the parent checkout). That is precisely why
`dispatch-codex.sh` defaults to YOLO. `--sandbox` is for read-only or
analysis-only runs, never for a normal implementation dispatch.

(Violation of record, 2026-08-29, bead `eshyra-o9bd.19.1.15.1`: after the
auto-mode classifier refused a hand-rolled YOLO launch, the supervisor
downgraded to `--sandbox workspace-write` and rewrote the prompt to say "Do NOT
run `bd`", passing the spec as `.dispatch-plan.md` and taking the report back as
`.dispatch-report.md`. The child then could not commit either, so the supervisor
committed and closed the bead for it. Two failures, one root cause: the approved
launcher above was not used, and rather than stopping, the dispatch was reshaped
around the refusal.)

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

## Heartbeating a dispatch (the output pane is 4 fixed lines)

`setsid` removes the dispatch from the harness process tree, so it never appears
as a background task in the UI and the user has **no** view of it except what
your own monitor prints. `pgrep -f 'codex exec'` will not find your monitor
either — query `.worktrees/.dispatch/*.pgid`, which is the tracking mechanism.

The monitor's output pane is a **fixed 4-line, non-scrollable, head-truncated**
view of the task's captured stdout. Appending is therefore useless for currency:
every tick pushes the live state further out of view, and the user is left
staring at the oldest lines. Do not "fix" this by lengthening the interval, and
never by removing periodic output — that deletes the signal while appearing to
address the complaint. (Both were tried on 2026-07-26 and both were wrong.)

**Overwrite the output file instead.** A background task can locate its own
captured-output file by printing a unique marker and grepping the tasks
directory for it, then truncate-and-rewrite that file every tick:

```bash
m="MON-$$-$RANDOM"; echo "$m"; sleep 3
out=$(grep -l "$m" /tmp/claude-*/*/*/tasks/*.output 2>/dev/null | head -1)
render() { printf '%s\n' "$@" > "$out"; }   # truncating write, not append
while ps -p "$pgid" >/dev/null 2>&1; do
  render "<child> RUNNING $(date +%H:%M:%S)" \
         "elapsed … log <KB> growth +<KB>/30s load $(cut -d' ' -f1 /proc/loadavg)" \
         "$(tail -1 "$reg/<child>.log" | cut -c1-110)" \
         "growth +0KB across two ticks = wedged; else healthy"
  sleep 30
done
```

Rules that make it work:

- After self-locating, write **only** to `$out`. Any further stdout is appended
  below your rewritten content and reintroduces the scroll problem.
- Keep it to 4 lines, and spend the last one on the interpretation rule so the
  pane is self-describing.
- **Log growth since the previous tick is the load-bearing signal.** A detached
  process that is wedged still shows increasing elapsed time; only stalled
  growth reveals it, and neither the completion notification nor `ps` will.
- Overwriting removes the cost of frequency, so use a short interval (~30s).
- Heartbeat ticks cost no model inference — the harness writes the file and the
  UI reads it. You are only invoked on completion, or when you `Read` the file
  yourself. Polling in the model loop is the expensive mistake.

Prefer waiting on process exit over waiting for a string to appear in a log. A
predicate like `grep -c … | grep -qE "[2-9]"` cannot distinguish "not finished"
from "finished differently than I assumed", and will spin forever when a run
fails in an unanticipated way.

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

So **record identity at launch, and only ever act on what you recorded.**
`dispatch-codex.sh` already does this correctly — it is the reason the script
exists, and the reason not to hand-roll the launch. What it handles for you:

- The new session leader records its own `$$` rather than the caller trusting
  `$!`. `setsid` forks only when the caller is already a process group leader,
  so `$!` is *not guaranteed* to be the new session leader. When it does fork,
  `$!` is a parent that has already exited and whose PID is eligible for reuse —
  signalling it later can hit an unrelated process group. `exec` then preserves
  the leader's PID, so the recorded value is the real PGID.
- The dispatch runs IN THE CHILD WORKTREE (write-capable runs never execute in
  the parent checkout), and the `cd` fails the dispatch closed if the worktree
  vanished between the check and the launch.
- The registry sits BESIDE the worktrees at `.worktrees/.dispatch/`, never
  inside one: `.worktrees/` is gitignored, so no child agent sees a stray
  untracked file and nothing can be committed by accident.
- A prior log is renamed to `.bak` rather than clobbered, so failed-attempt
  evidence survives.

Mirror the PGID into the child bead's notes so the registry survives a deleted
worktree.

Before integrating:

- Signal only that recorded group — `kill -TERM -"$(cat "$reg/<child>.pgid")"` —
  and only after confirming the PID was not recycled: `ps -o
  pid,pgid,sid,lstart,cmd -p <pgid>` must still show PID == PGID == SID running
  the command you launched. If it does not match, the dispatch already exited;
  do nothing.
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
