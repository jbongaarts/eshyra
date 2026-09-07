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
# wrapper: codex -p eshyra-captain --dangerously-bypass-approvals-and-sandbox
codex-captain
codex -p eshyra-captain --dangerously-bypass-approvals-and-sandbox
```

The wrapper always bypasses approvals and the sandbox: a Captain session is an
interactive seat the operator is driving, and per-command approval prompts stall
it. That is an approvals/sandbox choice only — the wrapper still refuses
`--dangerously-bypass-hook-trust`, because a bypassed run is not evidence that
the seat hook is trusted.

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
declaration plus its persisted trust state, and of the Codex runtime that
executed it. An old observation therefore cannot certify a hook that has since
been edited, re-trusted with a different hash, disabled, or handed to an
upgraded Codex. Unrelated tables Codex writes into the same profile are excluded
from that digest, so ordinary churn does not invalidate a good observation.

The installer owns the profile's **whole hook-declaration region**, not a
substring of it. Codex keys hook state by the handler's real group and handler
indices, so a sibling `SessionStart` group would move the managed handler off
`0:0`; and an extra field on the handler can change its semantics outright —
`async = true` makes Codex schedule it separately and drop it from the results
whose stdout becomes the session's additional context, so the runtime would
still execute and stamp while no Captain context was injected. Both now read as
`stale`. Codex's own `[hooks.state]` tables and unrelated tables are excluded.

The runtime half is deliberately the runtime's own report (`codex --version`)
rather than a stat of whatever `codex` resolves to on `PATH`: the npm CLI ships
a JavaScript launcher that spawns a separate native build, so the launcher can
be byte-identical while the build that executes hooks changes underneath it. If
no runtime can be identified the identity is `null` and the state is
`runtime-unknown` — it never collapses to a placeholder that would keep one
observation valid across every future upgrade. The `ESHYRA_SEAT_CODEX_ID`
override is honoured only alongside `ESHYRA_SEAT_TEST_ROOT`, so an inherited
value cannot freeze the identity in a real session.

| State | Meaning | Exit |
|---|---|---|
| `trusted` | observed running, and still describes what Codex would run | 0 |
| `superseded` | observed earlier, but the declaration or Codex build changed since | 1 |
| `unverified` | trust recorded, but never observed running | 1 |
| `untrusted` | no state entry, or no usable `trusted_hash` | 1 |
| `disabled` | trusted but `enabled = false` | 1 |
| `stale` | declaration changed since install | 1 |
| `runtime-unknown` | the Codex runtime could not be identified | 1 |
| `unknown` | profile not installed | 1 |

Only a run Codex admitted under **normal persisted trust** counts.
`--dangerously-bypass-hook-trust` runs enabled hooks without requiring trust, so
a hook Codex would otherwise classify Modified still executes; if such a run
could stamp, it would launder a stale trust state into `trusted` and the next
ordinary session would silently get no Captain context. The runtime is `exec`'d
by the shim, so its parent process is Codex itself and its argv carries the
admission flags — checked as an exact argument, never a substring. Unknown
admission does not stamp. The `codex-captain` wrapper also refuses to forward
that flag.

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
records its own environment **and argv**, and asserts the exact values the child
received across every launch-producing option path.

Argv matters as much as the environment: profile non-loading is the *primary*
boundary and the markers are defense in depth, so a launcher that delivered
both markers correctly while selecting `-p eshyra-captain` would break the
structural boundary and still pass an environment-only probe. The probe refuses
any Captain-profile selection in a dispatched launch:

```sh
node scripts/seats/probe-dispatch-markers.mjs <launcher-path>
node scripts/seats/probe-dispatch-markers.mjs <launcher-path> --baseline <pre-change-copy>
node scripts/seats/probe-dispatch-markers.mjs <launcher-path> --print-digest
```

`--baseline` additionally proves the launcher is its pre-change copy plus an
**exact authorized patch** and nothing else, by reconstruction: the pinned
baseline plus the exact hunks — each at an exact baseline line *index* — must
reproduce the launcher byte-for-byte. The patch lives at
`scripts/seats/dispatch-marker-patch.txt` so the authorized external change is
reviewable in this repository, and it pins the pre-change baseline's digest so a
baseline that is not the original artifact is rejected before anything else:

```sh
# after an intentional launcher change, re-derive the patch for human review
node scripts/seats/probe-dispatch-markers.mjs <launcher-path> \
  --baseline <pre-change-copy> --authorize scripts/seats/dispatch-marker-patch.txt

# routine verification pins the launcher to it
node scripts/seats/probe-dispatch-markers.mjs <launcher-path> \
  --baseline <pre-change-copy> --patch scripts/seats/dispatch-marker-patch.txt
```

Anchoring to line *text* would let an exact authorized block move between two
equal baseline lines, and trusting whatever file is supplied as `--baseline`
would let the same unauthorized edit be applied to both files and still verify.
Both are refused.

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
