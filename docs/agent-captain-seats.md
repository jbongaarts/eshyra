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

## Hook trust and the trusted closure

Codex requires persisted per-hook trust and **silently runs nothing** without
it, so the first `codex-captain` launch prompts once ("Hooks need review").
Until it is approved the seat does not inject, which is safe but quiet.

Codex runs command hooks **outside its sandbox**, and its trust decision covers
the hook *declaration*, not whatever that command later executes. Everything
reachable from the trusted shim is therefore user-local — the seat runtime and
its library are copied into `~/.codex/seats/` at install time — and changes only
when you run `npm run seat:install` again. The hook deliberately does **not**
execute the seat script out of a worktree: any branch, or any dispatched
implementation worker able to write repository files, could otherwise gain
unsandboxed user-level execution at the next Captain startup with no new prompt.
`--check` reports repo-vs-installed drift so an intended update is explicit.

Trust is keyed by the declaring file plus event and handler indices, and Codex
writes it back **into that same profile file**. The installer therefore owns
only the hook declaration inside `~/.codex/eshyra-captain.config.toml` and
leaves Codex's `[hooks.state]` alone, so reinstalling does not silently revoke
trust.

Codex executes a hook only when it is enabled *and* its stored `trusted_hash`
matches the hash it computes for the current declaration. That hash is not
reproducible outside Codex, and mirroring it would rot the moment Codex changed
its normalisation. So `--check` does not infer execution from config text: the
installed shim stamps `.last-run` every time Codex actually dispatches the hook,
and the stamp records the *identity* of what ran — a digest of the hook
declaration plus its persisted trust state, and of the Codex binary that
executed it. An old observation therefore cannot certify a hook that has since
been edited, re-trusted with a different hash, disabled, or handed to an
upgraded Codex. Unrelated tables Codex writes into the same profile are excluded
from that digest, so ordinary churn does not invalidate a good observation.

| State | Meaning | Exit |
|---|---|---|
| `trusted` | observed running, and still describes what Codex would run | 0 |
| `superseded` | observed earlier, but the declaration or Codex build changed since | 1 |
| `unverified` | trust recorded, but never observed running | 1 |
| `untrusted` | no state entry, or no usable `trusted_hash` | 1 |
| `disabled` | trusted but `enabled = false` | 1 |
| `stale` | declaration changed since install | 1 |
| `unknown` | profile not installed | 1 |

The normal lifecycle is: install → `unverified` → start one `codex-captain`
session and approve the prompt → `trusted`. After a Codex upgrade or any edit to
the declaration the state drops to `superseded` until the next Captain session
re-establishes it.

## Dispatch marker contract

Dispatched Codex workers are marked `ESHYRA_SEAT_ROLE=dispatched-worker` with
`ESHYRA_DISPATCH_CHILD=<child>`, which the Captain classifier treats as a hard
refusal. Reading the launcher cannot prove it does this — an exported value can
be unset again before the launch, and the literal `dispatched-worker` can appear
in a comment while the variable is assigned something else. So the probe runs
the real launcher in a disposable sandbox with `codex` replaced by a stub that
records its own environment, and asserts the exact values the child received:

```sh
node scripts/seats/probe-dispatch-markers.mjs <launcher-path>
node scripts/seats/probe-dispatch-markers.mjs <launcher-path> --baseline <pre-change-copy>
node scripts/seats/probe-dispatch-markers.mjs <launcher-path> --print-digest
```

`--baseline` additionally proves the launcher is its pre-change copy plus the
authorized marker injection and nothing else, compared as an **ordered**
program: removing the authorized additions must leave the baseline
byte-for-byte. Shell line order is behaviour, so a comparison that ignored
sequence would accept a safety guard moved after the launch.

`--print-digest` pins the launcher bytes; that is an identity pin, not semantic
proof.

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
