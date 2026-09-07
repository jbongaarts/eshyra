# Agent Captain Seats

Claude Captain and Codex Captain are durable organizational seats occupied by
disposable model sessions. They are seats, not models. A startup context is
composed of a personal charter, live repository authority, and an advisory
predecessor handoff; only live repository authority is authoritative.

Charters are user-local at `~/.claude/seats/claude-captain.md` and
`~/.codex/seats/codex-captain.md`. Handoffs are per-seat files at
`<git common dir>/eshyra-seats/<seat>/handoff.md`, so every worktree of a clone
resolves the same untracked state. These files are never part of a clone or
release.

## Occupying a seat

Claude Captain needs no launcher: the repository's `SessionStart` hook injects
it into a Claude Code **main** session on an authorized model, and fails closed
otherwise — a subagent, a resumed session, an unauthorized model, and a payload
with no model identity all receive nothing. `claude -p` sends no model identity,
so print-mode runs never occupy the seat.

Codex Captain is explicit, because `codex exec` fires `SessionStart` exactly
like an interactive session and the event alone cannot tell a Captain from a
dispatched implementation worker:

```sh
codex-captain            # wrapper: codex -p eshyra-captain
codex -p eshyra-captain  # equivalent, without the wrapper
```

The seat hook is registered **only** in the `eshyra-captain` profile overlay
(`~/.codex/eshyra-captain.config.toml`). Nothing that starts Codex without that
profile can load it, which is what keeps dispatched workers out of the seat by
construction rather than by request.

Codex requires persisted per-hook trust and **silently runs nothing** when it is
absent, so the first `codex-captain` launch prompts once to trust the seat hook.
Until you approve it the seat simply does not inject, which is safe but quiet;
`npm run seat:install -- --check` reports the trust state so it cannot go
unnoticed. The recorded hash covers the hook command string, so editing the shim
body or either charter never revokes trust.

Install or check the user-local Codex pieces with:

```sh
npm run seat:install
npm run seat:install -- --check
```

Installation backs up an existing changed managed file to its adjacent
`.bak.<timestamp>` path before replacing it. Roll back by restoring the desired
backup over the managed path, then run the check again. The installer does not
create or modify either charter; create bounded charter text in the two
user-local charter paths when needed.

Record a handoff from the repository root with:

```sh
npm run seat:handoff -- write claude-captain < handoff.md
npm run seat:handoff -- show claude-captain
npm run seat:handoff -- clear claude-captain
```

Seat state is never repository authority. Missing, stale, or unreadable seat
state degrades to ordinary repository behaviour. Handoff claims must be
reconciled with current repository state before acting. Dispatched Codex
workers are marked with `ESHYRA_SEAT_ROLE=dispatched-worker` and receive no
Captain identity.
