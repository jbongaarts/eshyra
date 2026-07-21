# Agent & Contributor Guide

Single source of operational guidance for AI agents (Claude Code, Codex) and
humans. `CLAUDE.md` just imports this file — keep shared guidance here only so
the two can't drift. Issue-tracker workflow and the mandatory session-close
protocol are in the **Beads Issue Tracker** / **Session Completion** sections
below.

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

Expected: **all non-skipped tests pass.** The suite skips by default the
live-API integration tests (`model.integration.test.ts` and
`campaignBibleFaithfulness.integration.test.ts`) and any Dolt-gated checkpoint
tests when the `dolt` binary is absent. The live-API tests run only when a
provider credential is present: either `ANTHROPIC_API_KEY` **or**
`CLAUDE_CODE_OAUTH_TOKEN` (this live-test gate alone keeps an API-key-first
precedence when both are set; released *gameplay* auth is explicit and fails
fast on ambiguity — see `docs/agent-sdk-auth.md` and `ESHYRA_AUTH_MODE`). They
default to the Opus 4.8 model
(`claude-opus-4-8`), and `ESHYRA_MODEL` overrides that default. Both gate
through the shared `packages/core/test/support/liveModelAuth.ts` helper, which
never logs or exposes token values. Treat exact pass/skip counts as
approximate — they grow with the suite; the gate is that nothing outside those
documented skips fails. (As a rough current baseline the suite is ~239 tests
across 37 files.)

**Deterministic builds / core-alone boundary proof:** `tsc --build` is
incremental and keys off `packages/*/tsconfig.tsbuildinfo`. Deleting only
`dist/` leaves a stale `tsbuildinfo`, so `tsc` reports up-to-date, emits
nothing, and exits 0 — a false negative for any proof that builds `@eshyra/core`
alone and asserts `packages/core/dist/index.js` exists. Always reset with
`npm run clean` (clears `dist` **and** `tsbuildinfo`) before such a proof, or
use `npm run typecheck` (`--force`). CI uses `--force` for this reason.

**Native dep — `better-sqlite3` (the only compiled dependency):** use
**Node 24 LTS**. ADR 0008 makes Node 24 the supported runtime and keeps the
root/workspace engines at `>=24 <25`. Keep `@types/node` on 24.x while that
engine range is in force. The workspace uses `better-sqlite3` 12.x because that
line ships Node 24 prebuilds. CI pins Node 24, sets
`npm_config_build_from_source=false`, and runs the CLI install smoke on Linux,
Windows, and macOS. A `better-sqlite3` source-build fallback is a regression
unless a bead explicitly changes the runtime/native support policy. Fallback
for local development: install a C++ toolchain and `npm rebuild better-sqlite3`.
Full rationale:
`docs/adr/0008-node-runtime-and-native-sqlite-support.md` and the header
comment in `.github/workflows/ci.yml`. ADR 0016
(`docs/adr/0016-native-dependency-install-policy-by-environment.md`) splits
this into dev/workspace, release-CI, and end-user-artifact layers and
pre-authorizes deliberately switching the first two to source-build-first
(distinct from an accidental fallback) without a new policy decision, subject
to the conditions it lists.

## Dependency Updates

Dependency updates must follow `docs/dependencies.md`. Keep dependency PRs
separate from feature work and importer parser changes. Treat `better-sqlite3`
updates as runtime/native-sensitive: verify Node 24 compatibility, preserve the
`npm_config_build_from_source=false` CI assumption, and do not take major
updates without a bead that explicitly reviews the Node/runtime decision. Keep
semver-major `@types/node`, `@biomejs/biome`, and `typescript` updates manual
or separate from routine dependency groups so runtime and toolchain policy
changes cannot ride along unnoticed.

## Formatting & Linting

Biome is the canonical formatter/linter for JS/TS source files. Do not
introduce a second formatter for these file types; do not manually reformat code
to fight Biome's output.

```bash
npm run format        # apply Biome safe fixes, formatting, and import organization
npm run format:check  # check Biome format/lint/import rules without writing
npm run lint          # run Biome lint rules
npm run check         # CI-style Biome validation (format + lint, no writes)
```

Run `npm run check` before opening or updating any PR that touches source files.
The full config is in `biome.json`. **CI fails on any Biome warning, not just
errors:** the `check`, `format:check`, and `lint` scripts all pass
`--error-on-warnings`, so a warning is as blocking as an error. There is no
"tracked warnings, fixed incrementally" backlog — the tree must stay clean. Fix
the underlying code rather than suppressing a finding with an inline ignore
unless there is a clear, documented reason.

`--error-on-warnings` exits non-zero on warnings and errors but **not** on
info-level diagnostics — Biome has no exit-on-info flag. So info noise is kept
out two ways instead:

- **Config/CLI infos** (e.g. a schema/CLI version mismatch): keep `biome.json`
  migrated to the installed Biome version (`npx biome migrate --write`) so that
  output stays clean.
- **Lint rules that default to `info`** (e.g. `complexity/useLiteralKeys`): raise
  them to `warn`/`error` in `biome.json` so `--error-on-warnings` enforces them.
  `useLiteralKeys` is set to `error`. Its one finding sat in
  `packages/core/scripts/verify-dnd5e-srd-freeze/cli.ts`, a **frozen**
  SRD-artifact path; rather than leave info noise suppressed-by-omission, the
  verifier was thawed (see `docs/audits/dnd5e-srd-5.1-final/thaw-notes/`) to fix
  the code at the source. Before promoting an info rule, confirm the tree can be
  made clean — including any frozen paths, which need a thaw note.

The root scripts run repo-wide (`biome … .`), not against narrowed package
allowlists, so newly added root-level files stay covered. Biome honors
`.gitignore` via its VCS integration (`vcs.useIgnoreFile: true`), so build
output, `node_modules`, local DBs, worktrees, and other gitignored paths are
excluded automatically. The only non-gitignored exclusions are declared
explicitly and narrowly in `biome.json` `files.includes`: `coverage`, the
committed `package-lock.json`, and the generated SRD rules-packs under
`packages/core/data`. Do not widen `.gitignore` just to hide a file from Biome;
add a narrow, intentional `files.includes` exclusion only for genuinely
generated/vendored paths. `packages/core/test/nodeRuntimePolicy.test.ts` guards
this policy (repo-wide scripts, VCS ignore boundary, and the explicit
exclusions).

### Hidden / Bidirectional Unicode

GitHub shows a noisy "This file contains hidden or bidirectional Unicode text"
warning on diffs that triggers on a broad range of Unicode content, so it is not
a reliable signal for manual review. Instead, CI blocks only the small set of
genuinely dangerous invisible / directional control characters via
`scripts/check-hidden-unicode.mjs` (`npm run check:hidden-unicode`, also run as
the first step of `npm run check`). The script scans git-tracked text files
(`.ts/.tsx/.js/.mjs/.cjs/.json/.jsonc/.md/.ps1/.yml/.yaml/.txt/.sql`) and fails on
bidi embedding/override controls (`U+202A..U+202E`), bidi isolates
(`U+2066..U+2069`), zero-width characters and directional marks
(`U+200B..U+200F`), the Arabic Letter Mark (`U+061C`), the BOM / zero-width
no-break space (`U+FEFF`), the soft hyphen (`U+00AD`), and the combining
grapheme joiner (`U+034F`). Benign visible Unicode punctuation — em dash, en
dash, arrows, curly quotes, degree sign and the like — is allowed and never
flagged. Unlike Biome, this check deliberately **does** scan the generated SRD
rules-packs under `packages/core/data`: that is the path most likely to carry
PDF-extracted text and therefore the exact class of hidden/bidi control this
gate exists to catch. Biome's `suspicious.noIrregularWhitespace` is set to `error` as
supplemental protection, but the dedicated script is the primary guard because
Biome does not scan every relevant file type. The behavior is covered by
`packages/core/test/hiddenUnicodeCheck.test.ts`.

## Agent Worktree Workflow

Keep parent-checkout preflight cheap; run full verification only from the
linked worktree being modified.

Fetch `origin/main` before creating a worktree:

```bash
npm run agent:preflight
```

This refreshes the base ref only. Do not run full
verification from the parent checkout: do not run Biome, tests, build,
typecheck, or package verification merely to prove `main` is clean. CI keeps
`main` clean.

After creating a linked worktree, immediately enter it and normalize to its git
root:

```bash
cd .worktrees/<worktree-name>
cd "$(git rev-parse --show-toplevel)"
```

Run all install, edit, format, lint, test, build, and verification commands from
that directory. Before commit/push, run full verification there, not from the
parent checkout:

```bash
npm run verify:worktree
```

Managed sandboxes that deny child-process or loopback operations may use
`npm run verify:worktree:sandbox`. It runs the same format, check, and
typecheck gates and marks only subprocess/loopback integration tests as
environmental skips. CI and ordinary worktrees must use the full command.

The helper resolves the active git root. It runs
`npm run format` (`biome check --write .`) for safe fixes and import
organization, then runs the repo checks and tests. The npm commands wrap
`scripts/agent-preflight-main.mjs` and
`scripts/verify-current-worktree.mjs`, respectively.

Full `npm run verify:worktree` is required before commit/push. It may be run
earlier when a task specifically needs a clean baseline, but agents should not
treat full verification as mandatory immediately after creating a worktree. The
cheap parent-checkout preflight plus CI-clean `origin/main` is sufficient to
start work.

If Biome says no relevant files were checked because `.worktrees` is ignored,
the command ran from the wrong checkout. The parent checkout's `.worktrees/`
directory remains ignored; do not make Biome scan nested worktrees. In
response, do not delete or recreate the worktree. Enter the intended worktree,
run `cd "$(git rev-parse --show-toplevel)"`, and rerun verification.

## Architecture

Text-first, persistent AI Dungeon Master for long-running fantasy campaigns;
UI-agnostic TypeScript core with a thin CLI. Full strategy in
`docs/architecture-report.md` and `docs/adr/0001-product-model-deployment-content-strategy.md`.
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

- All task tracking via beads (see below) — never TodoWrite or markdown TODOs.
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

Completed work is integrated to `main` by pull request, not by direct pushes to
`main`. Agents should work on a feature branch, run the relevant quality gates,
commit, push the branch, open a PR targeting `main`, and hand off the PR URL for
review.

Routine agent handoff stops at an open PR. Do not merge the PR yourself unless
the user explicitly asks you to merge after review/check requirements are
satisfied. The generated Beads session-completion block below still requires
pushing so work is not stranded locally; in this repository that means pushing
the feature branch and opening the PR for review.

### PR Merge Policy

Default PR merge method is a **merge commit**, not squash. Rationale: Eshyra's
history is frequently traversed by coding agents and bead/PR tooling. Preserving
commit ancestry lets agents answer "did this work land on `main`?" with
deterministic Git-graph checks instead of spending tokens reconstructing
squashed diffs.

- PR branches may be cleaned up before review/merge, but once reviewed, the
  reviewed commits should remain reachable from `main`.
- For the readable mainline narrative, use `git log --first-parent main`.
- Squash merges are rare exceptions for tiny, human-authored changes where
  preserving branch commit identity has no future diagnostic value.
- Merge commit titles should include the PR number and bead ID when applicable,
  e.g. `Merge PR #277: eshyra-hlte Fix mechanics audit evidence`.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

### Issue Prefix Migration (Completed)

All live beads issues now use the `eshyra-*` prefix. The migration from `loreweaver-*` was completed via `bd rename-prefix eshyra`, which renamed 381 issues.

- **Live work:** All current issues use `eshyra-*` (e.g., `eshyra-r00`, `eshyra-bo2`, `eshyra-tf8`).
- **Historical references:** Old commits, branches, and chat logs may mention `loreweaver-*` IDs; map them to current issues by replacing only the prefix with `eshyra-` and preserving the suffix (e.g., `loreweaver-r00` → `eshyra-r00`).
- **Configuration:** The beads database `issue_prefix` is `eshyra`, and `allowed_prefixes` is `eshyra` only. `.beads/config.yaml` keeps repository-local settings such as `sync.remote`; it does not control the active issue generator prefix for this existing database.
- **Database name:** `.beads/metadata.json` `dolt_database` remains `loreweaver` (internal historical name, separate from issue prefix).

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->

<!-- BEGIN IMPORTER FIX PROTOCOL POINTER -->
### Deterministic rules-pack importer work

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
