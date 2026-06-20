# ADR 0011: Multi-provider Installer Editions

- **Status:** Accepted
- **Date:** 2026-06-20
- **Bead:** eshyra-7zhm

## Context

Eshyra distributes a self-contained, per-platform CLI as GitHub Release archives
(ADR [0003](0003-local-cli-first-release-storage.md), decision `eshyra-upef`).
Each archive bundles a pinned Node 24 runtime plus the production dependency
tree so end users install nothing else.

Today the dominant cost in that archive is the **Claude Agent SDK**
(`@anthropic-ai/claude-agent-sdk`, ~255 MB on linux-x64). That SDK is a thin JS
wrapper plus a large per-platform CLI binary (the Claude Code executable),
delivered through npm `optionalDependencies` so only the host platform's binary
installs. The whole linux-x64 artifact is ~423 MB unpacked, ~255 MB of which is
that one agent binary; the rest is the Node runtime (~118 MB) and everything
else (bead `eshyra-5cd6` tracks shrinking it).

Eshyra is adding a **second** subscription-backed gameplay provider, **Codex**
(`@openai/codex-sdk` → the `@openai/codex` CLI, ~283 MB on linux-x64), via the
same packaging pattern: a small SDK wrapper plus a large per-platform CLI binary
through `optionalDependencies`. The adapter seam (ADR
[0010](0010-api-native-vs-agent-harness-adapter-seam.md)) classifies these as
**agent-harness** adapters; both forward Eshyra tools through MCP and let the SDK
own its agentic loop. Codex is tracked by epic `eshyra-dcln` and its adapter by
bead `eshyra-jl8n`.

The **api-native** adapters (`@anthropic-ai/sdk`, and a future OpenAI SDK) talk
to provider REST APIs directly. Their SDKs are small ordinary dependencies with
**no** CLI binary.

If we kept a single artifact, adding Codex would bundle **both** giant agent
binaries into every download (~538 MB+ of agent binaries on linux-x64) even
though most users authenticate with exactly one provider. That is wasteful for
download size, GitHub Release storage, and CI.

A hard constraint from the product model: the one-line installer must keep
working with **no manual separate install** of any provider binary
(ADR [0003](0003-local-cli-first-release-storage.md)).

## Decision

Ship **per-edition** self-contained archives and let the one-line installer pick
one. An *edition* is a named subset of the heavy, per-provider agent SDK
packages that get bundled into the archive's `app/node_modules`.

### 1. Four editions

| Edition  | Bundled agent SDK(s)                                  | Intended user                              |
| -------- | ----------------------------------------------------- | ------------------------------------------ |
| `api`    | none — api-native SDKs only                           | API-key gameplay; smallest archive         |
| `claude` | `@anthropic-ai/claude-agent-sdk`                      | Claude Pro/Max subscription (**default**)  |
| `codex`  | `@openai/codex-sdk`                                   | ChatGPT/Codex subscription                 |
| `full`   | both agent SDKs                                        | both subscriptions on one machine          |

The api-native SDKs ship in **every** edition (they are small and carry no CLI
binary), so even the `api` edition can run API-key gameplay. Only the heavy
agent SDKs are gated.

The **default edition is `claude`**, preserving today's artifact behaviour. The
default is a single named constant (`DEFAULT_EDITION` in
`scripts/release/editions.mjs`) shared by the builder and both installers so they
cannot disagree.

### 2. Mechanism: optionalDependencies + prune

The agent SDKs are declared as **`optionalDependencies`** of `@eshyra/core`
(owned by the adapter stream, bead `eshyra-jl8n`; see Coordination below). The
release build installs the full production tree once, then **prunes** the staged
`app/node_modules` down to the edition's provider subset. `editions.mjs` is the
single source of truth for the edition→package map; `build-release-artifact.mjs`
removes every agent SDK that is declared in the dependency graph but not included
in the selected edition. Packages not yet present in the graph are skipped, so a
build tolerates a provider SDK being absent.

We chose prune-after-full-install over per-edition `npm install` because it is
faster (one install, four prunes), is robust to whether a package lives in
`dependencies` or `optionalDependencies`, and does not require the package to be
installable to test the pruning of the *other* editions.

`validate-release-artifact.mjs` parses the edition from the archive name and
asserts the packed provider set matches: every included provider present, every
excluded provider absent. The metadata `.json` sidecar records the edition and
its bundled providers.

### 3. Artifact naming encodes the edition

Archives are named `eshyra-<edition>-<version>-<os>-<arch>.<ext>`. The edition
segment lets all four editions coexist on one Release and lets installers select
by name. Install directories likewise encode the edition, so editions and
versions never collide on disk.

### 4. Installer edition selection (no manual install)

The one-line installer keeps working unchanged and gains an edition selector:

- **POSIX** (`install.sh`): `--edition <name>` flag, then `ESHYRA_EDITION` env,
  then an interactive prompt **only** when stdin is a TTY, else the `claude`
  default. Piped installs are non-interactive:
  `curl -fsSL …/install.sh | sh` (default) or
  `curl -fsSL …/install.sh | sh -s -- --edition codex`.
- **PowerShell** (`install.ps1`): `-Edition <name>` (direct invocation) or
  `$env:ESHYRA_EDITION` (works under `irm … | iex`), then a console prompt, else
  the default.

Both installers select the Release asset by edition **prefix** + target
**suffix**, never by reconstructing the version-bearing filename from the tag.

### 5. CI builds the edition × platform grid

`release.yml` builds a **4 editions × 4 platforms = 16 archive** matrix, passing
`--edition`/`ESHYRA_EDITION` per leg, validating each, and attaching all to the
tagged Release alongside `sha256sums.txt` and the installer scripts.

## Alternatives considered

### Option B — single lean artifact + on-demand provider fetch (rejected)

Ship one lean archive (no agent binary) and download the selected provider's CLI
binary on first use, mirroring how Dolt is self-provisioned (ADR
[0003](0003-local-cli-first-release-storage.md), `docs/storage.md`). Rejected
for the primary gameplay path because:

- The provider binaries are delivered as npm `optionalDependencies`, not as
  single self-verifying release binaries like Dolt; fetching them on demand means
  reintroducing an npm/network/build step into the user's machine — exactly what
  the self-contained artifact exists to avoid.
- It makes first gameplay depend on network + a post-install resolution step,
  defeating "reproducibly runnable from the installed archive" (ADR 0003).
- Dolt is genuinely optional (off the per-turn path); a gameplay provider is
  not — deferring it pushes a heavyweight download to the worst moment.

Option A keeps the install fully self-contained per edition; the user pays the
provider cost once, at install, by choosing an edition.

### Single fat artifact with both binaries (rejected)

Simplest to build but ships ~538 MB+ of agent binaries to every user regardless
of which provider they use. Unacceptable given `eshyra-5cd6` already flags the
single-provider artifact as too large.

## Consequences

- **Positive:** Each user downloads only the provider they use. The `api` edition
  is the smallest possible artifact. The one-line install remains fully
  self-contained with no manual provider install.
- **Positive:** Adding a third provider later is a new edition + manifest entry,
  not a new distribution mechanism.
- **Cost / negative:** **16 archives per release.** This multiplies total Release
  download size and CI build minutes versus one-artifact-per-platform. This is
  documented prominently in `release.yml`, `docs/cli-distribution.md`, and is the
  motivation to coordinate with **bead `eshyra-5cd6`** (artifact-size reduction):
  trimming each agent-SDK bundle directly reduces the multiplied total. A future
  bead may throttle the grid (e.g. build `full`/`api` only on tags, or drop
  rarely used edition×platform legs) if the cost proves painful.
- **Neutral:** The default edition (`claude`) is byte-for-byte the prior artifact
  plus an edition segment in its name, so existing install/update flows are
  unaffected apart from the new filename.
- **Risk / assumption:** Pruning the Claude Agent SDK from the `api`/`codex`
  editions only yields a *runnable* artifact if the core's agent-SDK adapters
  resolve their SDK **lazily** (no eager top-level import of a possibly-pruned
  package). That lazy-resolution refactor is owned by the adapter stream
  (`eshyra-jl8n`); until it lands, only the `claude`/`full` editions are
  guaranteed to pass the validator's no-config run check. See Coordination.

## Coordination with the adapter stream (eshyra-jl8n)

- The adapter stream **owns** adding `@openai/codex-sdk` to
  `packages/core/package.json` and moving the agent SDKs into
  `optionalDependencies`. This ADR's build/prune logic reads the dependency set
  from `package.json` + the edition manifest, so it works once those deps land
  and is a no-op for a not-yet-declared package.
- The adapter stream **owns** making the agent SDK imports lazy so that an
  edition with a pruned SDK still starts (e.g. the no-config CLI path and any
  edition whose selected provider differs from a statically-imported SDK). This
  ADR does not modify any `packages/core/src/model/*` code.

## Related decisions

- [ADR 0003](0003-local-cli-first-release-storage.md) — Local CLI-first release,
  self-contained artifact, self-provisioned Dolt
- [ADR 0008](0008-node-runtime-and-native-sqlite-support.md) — Node 24 runtime +
  native better-sqlite3 prebuild policy
- [ADR 0010](0010-api-native-vs-agent-harness-adapter-seam.md) — API-native vs
  agent-harness adapter families
- `docs/cli-distribution.md` — distribution + editions reference
- Beads: `eshyra-dcln` (Codex epic), `eshyra-jl8n` (Codex adapter),
  `eshyra-5cd6` (artifact-size reduction)
