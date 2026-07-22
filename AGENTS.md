# Agent & Contributor Guide

Single source of operational guidance for AI agents (Claude Code, Codex) and
humans. `CLAUDE.md` just imports this file — keep shared guidance here only so
the two can't drift.

Each rule is stated once, with a pointer to the doc, ADR, script, or test that
carries the rationale. **When this file disagrees with a generated or
session-injected block, this file wins.**

## Build & Test

Monorepo (npm workspaces): `@eshyra/core` + `@eshyra/cli`.

```bash
npm ci             # CI or worktree install; never rewrites package-lock.json
npm install        # Only when intentionally changing dependency metadata
npm run build      # tsc --build (incremental)
npm run clean      # tsc --build --clean (removes dist AND .tsbuildinfo)
npm run typecheck  # tsc --build --force (deterministic full build; used by CI)
npm run test       # vitest run
```

Expected: **all non-skipped tests pass.** The documented skips are the live-API
integration tests (`model.integration.test.ts`,
`campaignBibleFaithfulness.integration.test.ts`) and the Dolt-gated checkpoint
tests when the `dolt` binary is absent. Live tests run only when
`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` is present, gate through
`packages/core/test/support/liveModelAuth.ts` (which never logs token values),
and default to `claude-opus-4-8` unless `ESHYRA_MODEL` overrides. That gate's
API-key-first precedence is test-only — released *gameplay* auth is explicit and
fails fast on ambiguity (see `docs/agent-sdk-auth.md` and `ESHYRA_AUTH_MODE`).
Pass/skip counts grow with the suite; the gate is that nothing outside those
skips fails.

**Never prove anything with an incremental build.** `tsc --build` keys off
`packages/*/tsconfig.tsbuildinfo`, so deleting `dist/` alone leaves it stale:
`tsc` reports up-to-date, emits nothing, and exits 0 — a false green for any
check asserting that build output exists. Reset with `npm run clean` (clears
`dist` **and** `tsbuildinfo`) or use `npm run typecheck` (`--force`, as CI does).

**Native dep — `better-sqlite3`** (the only compiled dependency): Node 24 LTS,
workspace engines pinned `>=24 <25`, `@types/node` on 24.x, `better-sqlite3` on
12.x (the line shipping Node 24 prebuilds). CI pins Node 24, sets
`npm_config_build_from_source=false`, and runs the CLI install smoke on Linux,
Windows, and macOS. **An accidental source-build fallback is a regression**
unless a bead explicitly changes runtime/native policy; *deliberately* moving
dev/workspace or release-CI to source-build-first is a different decision and is
pre-authorized by ADR 0016 under the conditions it lists. Local fix: install a
C++ toolchain and `npm rebuild better-sqlite3`. Rationale:
[ADR 0008](docs/adr/0008-node-runtime-and-native-sqlite-support.md),
[ADR 0016](docs/adr/0016-native-dependency-install-policy-by-environment.md),
and the header comment in `.github/workflows/ci.yml`.

## Dependency Updates

Follow `docs/dependencies.md`. Keep dependency PRs separate from feature work
and importer parser changes. `better-sqlite3` updates are runtime-sensitive
under the native-dep rules above: take no major update without a bead that
explicitly reviews the runtime decision. Keep semver-major
`@types/node`, `@biomejs/biome`, and `typescript` updates out of routine
dependency groups so runtime and toolchain policy can't ride along unnoticed.

## Formatting & Linting

Biome is the canonical formatter/linter for JS/TS source files. Do not add a
second formatter for those file types; do not hand-reformat code to fight
Biome's output.

```bash
npm run format        # apply safe fixes, formatting, and import organization
npm run format:check  # check format/lint/import rules without writing
npm run lint          # lint rules only
npm run check         # CI-style validation (hidden-unicode + format + lint)
```

Run `npm run check` before opening or updating any PR that touches source files.
Config lives in `biome.json`.

- **CI fails on warnings, not just errors** — `check`, `format:check`, and
  `lint` all pass `--error-on-warnings`. There is no "tracked warnings, fixed
  later" backlog; the tree stays clean. Fix the underlying code rather than
  suppressing a finding with an inline ignore absent a documented reason.
- **Info-level diagnostics do not fail the build** (Biome has no exit-on-info
  flag), so keep info noise from accumulating two ways: keep `biome.json`
  migrated to the installed Biome (`npx biome migrate --write`), and promote
  info-default lint rules to `warn`/`error` there rather than tolerating them
  (`complexity/useLiteralKeys` is set to `error` for this reason). Before
  promoting a rule, confirm the whole tree can be made clean — including frozen
  paths, which require a thaw note under
  `docs/audits/dnd5e-srd-5.1-final/thaw-notes/`.
- **Scope is repo-wide** (`biome … .`), not a package allowlist, so new
  root-level files stay covered. Biome honors `.gitignore` via
  `vcs.useIgnoreFile`, excluding build output, `node_modules`, local DBs, and
  worktrees automatically. The only non-gitignored exclusions are narrow and
  explicit in `biome.json` `files.includes`: `coverage`, `package-lock.json`,
  and the generated SRD rules-packs under `packages/core/data`. Never widen
  `.gitignore` just to hide a file from Biome.
  `packages/core/test/nodeRuntimePolicy.test.ts` guards this policy.

### Hidden / Bidirectional Unicode

`scripts/check-hidden-unicode.mjs` (`npm run check:hidden-unicode`, and the
first step of `npm run check`) blocks the genuinely dangerous invisible and
directional control characters in git-tracked text files — bidi
embeddings/overrides/isolates, zero-width characters, directional marks, the
BOM, soft hyphen, and combining grapheme joiner. Benign visible punctuation (em
dash, curly quotes, arrows) is always allowed; GitHub's own "hidden or
bidirectional Unicode" banner triggers too broadly to use as a review signal.
Unlike Biome, this check deliberately **does** scan the generated SRD
rules-packs under `packages/core/data` — PDF-extracted text is the exact class
of defect it exists to catch. Biome's `suspicious.noIrregularWhitespace`
(`error`) is supplemental; the script is the primary guard because Biome does
not scan every relevant file type. Covered by
`packages/core/test/hiddenUnicodeCheck.test.ts`.

## Agent Worktree Workflow

Keep parent-checkout preflight cheap; run full verification only from the linked
worktree being modified. CI keeps `main` clean — **do not** run Biome, tests,
build, typecheck, or package verification from the parent checkout merely to
prove that.

```bash
npm run agent:preflight                # fetch origin/main only; run before creating a worktree
cd .worktrees/<worktree-name>          # then normalize to the worktree's git root:
cd "$(git rev-parse --show-toplevel)"
npm run verify:worktree                # required before commit/push
```

Run every install, edit, format, lint, test, build, and verification command
from that worktree root. `verify:worktree` resolves the active git root, applies
`npm run format` safe fixes and import organization, then runs the repo checks
and tests. (The npm scripts wrap `scripts/agent-preflight-main.mjs` and
`scripts/verify-current-worktree.mjs`.)

Verification may be run earlier when a task needs a clean baseline, but it is
not mandatory immediately after creating a worktree — cheap preflight plus a
CI-clean `origin/main` is enough to start work.

**Managed-sandbox exception:** where Git/npm orchestration works but Vitest
cannot launch the known nested Node/npm subprocesses or bind a loopback MCP
server, `npm run verify:worktree:sandbox` is the required alternative. It runs
the same format, check, and typecheck gates and marks only those affected
integration tests as environmental skips. It does not support environments that
deny all child processes. CI and ordinary worktrees must use the full command.

**If Biome reports that no relevant files were checked,** the command ran from
the parent checkout, where `.worktrees/` is ignored. Do not delete or recreate
the worktree, and do not make Biome scan nested worktrees — enter the intended
worktree, run `cd "$(git rev-parse --show-toplevel)"`, and rerun verification.

## Architecture

Text-first, persistent AI Dungeon Master for long-running fantasy campaigns;
UI-agnostic TypeScript core with a thin CLI. Full strategy in
`docs/architecture-report.md` and
[ADR 0001](docs/adr/0001-product-model-deployment-content-strategy.md).
Load-bearing principles:

- Keep rules/mechanics, campaign/module content, live state, user-private
  content, and generated memory separate.
- Deterministic math/dice/canon writes go in tools; narration and rulings go
  through the DM model under bounded-context orchestration.
- SQLite is the live per-turn store; Dolt is only for checkpoint/history/branch
  work off the per-turn path.
- Model access sits behind provider adapters + capability profiles (Claude
  Agent SDK is one adapter, not a core assumption).
- Primary DM targets premium frontier quality; cheaper models are
  auxiliary/experimental unless validated.

## Conventions

- Bundled/public content must be open-licensed, public domain, original, or
  publisher-licensed; fair use is not the permission model.
- Native VTT, native mobile, hosted billing, and custom/local primary-DM
  replacement are out of early scope absent a new decision record.
- `@eshyra/core` has two import paths and they are **not** interchangeable:
  the root export (`packages/core/src/index.ts`) is the stable public surface
  for external consumers; `@eshyra/core/internal`
  (`packages/core/src/internal.ts`) re-exports movable internals with **no**
  compatibility promise. Production callers (the CLI today, hosted/PWA
  consumers tomorrow) should depend only on the root. The `/internal` subpath
  is for co-developed callers inside this repo (e.g. tests that assert against
  implementation details). New core symbols default to internal — promote to
  the root export only when a real consumer needs the API.

## Non-Interactive Shell

Always pass non-interactive flags so aliased confirmation prompts can't hang
the agent: `cp -f`, `mv -f`, `rm -f` / `rm -rf`, `apt-get -y`, and
`ssh`/`scp -o BatchMode=yes`.

## Git & PR Workflow

Work reaches `main` by pull request only — never by a direct push to `main`.

1. Branch from an up-to-date `origin/main` (`npm run agent:preflight` first).
2. Commit on the feature branch.
3. Run `npm run verify:worktree` from the worktree holding the change.
4. Push the branch and open a PR targeting `main`.
5. Hand off the PR URL for review.

**Agents hold standing authority for steps 2–4.** Committing and pushing a
*feature branch* and opening its PR needs no separate approval; leaving finished
work unpushed is the failure mode to avoid. That authority stops there — it
never extends to `main`, to force-pushes, or to merging. This section is the
repository authority that `bd prime`'s injected conservative "no commit/push
without authority" default defers to, and it overrides any generated block
demanding an unconditional `git push`: a push is always to a feature branch.

Do not merge the PR yourself unless the user explicitly asks you to after review
and required checks are satisfied.

### Session Completion

An open, unmerged PR is a complete handoff. Before ending a session:

- File beads issues for anything left undone.
- Run the quality gates for what changed, from the worktree that holds it.
- Close finished beads and update in-progress ones, then **`bd dolt push`** —
  bead state syncs separately from git and is otherwise stranded locally.
- Commit and push the feature branch; confirm with `git status`. Open the PR
  when the work is ready for review.
- Clear stashes and prune stale remote branches.
- Hand off: PR URL, bead IDs, and context for the next session.

### PR Merge Policy

Default merge method is a **merge commit**, not squash. Eshyra's history is
frequently traversed by coding agents and bead/PR tooling; preserving commit
ancestry lets them answer "did this work land on `main`?" with a deterministic
Git-graph check instead of reconstructing squashed diffs.

- PR branches may be tidied before review, but reviewed commits should remain
  reachable from `main`.
- For the readable mainline narrative, use `git log --first-parent main`.
- Squash merges are rare exceptions for tiny, human-authored changes where
  branch commit identity has no future diagnostic value.
- Merge commit titles carry the PR number and bead ID, e.g.
  `Merge PR #277: eshyra-hlte Fix mechanics audit evidence`.

## Beads Issue Tracker

All task tracking goes through **bd (beads)** — never TodoWrite, TaskCreate, or
markdown TODO lists. Create the issue before writing code and mark it
in_progress when you start. `bd prime` (auto-injected at session start; rerun it
after compaction or `/clear`) carries the full command reference.

```bash
bd ready                 # find unblocked work
bd show <id>             # issue detail
bd update <id> --claim   # claim work
bd close <id>            # complete work
bd dolt push             # REQUIRED after any bead change
```

- Issues live in a local Dolt DB; sync uses `refs/dolt/data` on the git remote;
  `.beads/issues.jsonl` is a passive export. Nothing leaves this machine without
  `bd dolt push`. Details and anti-patterns:
  [SYNC_CONCEPTS](https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md).
- Use `bd remember` for durable project knowledge — anything another machine,
  account, or Codex session would need. Only bd memories sync (`bd dolt push`)
  and reach other agents via `bd prime`. The ban on markdown memory files
  targets in-repo TODO/memory documents; an agent harness's own private store
  is exempt for harness-local preferences, but repo knowledge must never live
  there, where it cannot sync and Codex cannot read it. Verify any memory
  against the tree before acting on it — several have gone stale.
- Issue IDs are `eshyra-*`. Historical `loreweaver-*` references map by swapping
  only the prefix (`loreweaver-r00` → `eshyra-r00`). `.beads/metadata.json`
  `dolt_database` remains `loreweaver` — an internal historical name, unrelated
  to the issue prefix.
- This section is hand-maintained. `bd onboard` prints an upstream snippet; do
  not paste it back over this one. A stale generated block is what introduced
  the push-policy conflict resolved in **Git & PR Workflow** above.

<!-- BEGIN IMPORTER FIX PROTOCOL POINTER -->
## Deterministic rules-pack importer work

The "importer" is the source-grounded **rules-pack compiler** with an
executable-curation stage: it must make the pack a semantic substrate for the
model/engine execution boundary, not only a reference corpus. Before
compiler/curator work read `docs/rules-pack-compiler.md` (architecture + the
parser / curated-spec / procedural / model-adjudication / engine-hook decision
hierarchy) and [ADR 0017](docs/adr/0017-rules-pack-compiler-and-executable-curation-architecture.md)
(refines [ADR 0007](docs/adr/0007-rules-pack-ingestion-policy.md)).

When touching SRD importer, extractor, parser, audit, generated rules-pack, or importer test files, follow `docs/importer-fix-protocol.md`.

This applies to changes under:

- `packages/core/scripts/importers/`
- `packages/core/test/importers/`
- `packages/core/data/rules-packs/`
- SRD audit/oracle code such as `packages/core/src/rules/srdAudit.ts`

Do not weaken regression tests or audit expectations to match current generated output. Fix the importer, extractor, or parser behavior, or document source-backed evidence that the expectation was wrong.
<!-- END IMPORTER FIX PROTOCOL POINTER -->
