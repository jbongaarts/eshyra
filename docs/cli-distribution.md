# CLI Distribution

This document describes the distribution channel and artifact strategy for the
local Eshyra CLI. Hosted web/PWA distribution remains governed by ADR 0002.
Local storage uses the managed per-user data root and campaign registry; see
[ADR 0004](adr/0004-config-file-and-campaign-registry.md) and
[Local Storage](storage.md).

## Decision

The initial distribution channel is **GitHub Releases** with self-contained,
per-platform archives. **npm publication is not the current distribution model**
and both workspace packages remain `private`. The packages may be published to
npm in a future release if the business/licensing decision (`eshyra-bo2`) so
decides; that is a future change, not a current blocker.

The user-facing install commands are:

```bash
# Linux / macOS / WSL (default edition: claude)
curl -fsSL https://github.com/jbongaarts/eshyra/releases/latest/download/install.sh | sh

# Pick a different edition:
curl -fsSL https://github.com/jbongaarts/eshyra/releases/latest/download/install.sh | sh -s -- --edition codex
```

```powershell
# Windows (PowerShell)
irm https://github.com/jbongaarts/eshyra/releases/latest/download/install.ps1 | iex

# Pick a different edition (env var works under irm | iex):
$env:ESHYRA_EDITION = 'codex'
irm https://github.com/jbongaarts/eshyra/releases/latest/download/install.ps1 | iex
```

See [docs/install.md](install.md) for the full install and update guide.

## Editions (multi-provider)

Eshyra supports more than one gameplay provider. Each agent-harness provider
ships a large per-platform CLI binary through its SDK's npm
`optionalDependencies` (the Claude Agent SDK vendors the Claude Code CLI; the
Codex SDK vendors the `@openai/codex` CLI). Bundling every provider into one
archive is wasteful, so each Release publishes **per-edition** self-contained
archives and the one-line installer selects one (ADR
[0011](adr/0011-multi-provider-installer-editions.md)).

| Edition  | Bundled provider binaries          | Use when                                           |
| -------- | ---------------------------------- | -------------------------------------------------- |
| `api`    | none (api-native SDKs only)        | smallest; API-key gameplay only                    |
| `claude` | Claude Agent SDK (Claude Code CLI) | Claude Pro/Max subscription gameplay (**default**) |
| `codex`  | Codex SDK (`@openai/codex` CLI)    | ChatGPT/Codex subscription gameplay                |
| `full`   | both agent binaries                | both subscriptions on one machine                  |

The api-native SDKs (`@anthropic-ai/sdk` and an OpenAI SDK) are small ordinary
dependencies with no CLI binary, so they ship in **every** edition; only the
heavy agent SDKs are gated per edition.

**Default edition is `claude`**, preserving today's artifact behavior. The
default is a single named constant shared by the builder
(`scripts/release/editions.mjs` `DEFAULT_EDITION`) and both installers.

### Mechanism

The agent SDKs are declared as `optionalDependencies` of `@eshyra/core`. The
build installs the full production tree once, then **prunes** the staged
`app/node_modules` down to the edition's provider subset
(`scripts/release/editions.mjs` is the source of truth for the
edition→package map). Excluded provider binaries therefore never travel in that
edition's archive. `validate-release-artifact.mjs` asserts, per edition, that
every included provider is present and every excluded provider is absent.

### Cost

The grid is **4 editions × 4 platforms = 16 archives per release**, which
multiplies both total Release download size and CI build minutes versus the old
one-artifact-per-platform model. Trimming the per-archive size (especially the
agent-SDK bundles) is tracked by bead `eshyra-5cd6`.

## Artifact format

Each GitHub Release publishes one self-contained archive per **edition and**
supported platform:

| Platform                | Archive                                         | Format    |
| ----------------------- | ----------------------------------------------- | --------- |
| Linux x64 (incl. WSL)  | `eshyra-<edition>-<version>-linux-x64.tar.gz`   | `.tar.gz` |
| Linux arm64             | `eshyra-<edition>-<version>-linux-arm64.tar.gz` | `.tar.gz` |
| macOS arm64             | `eshyra-<edition>-<version>-darwin-arm64.tar.gz`| `.tar.gz` |
| Windows x64             | `eshyra-<edition>-<version>-windows-x64.zip`    | `.zip`    |

Each archive contains:
- `runtime/node` (or `runtime\node.exe`) -- the pinned Node 24 runtime
- `app/node_modules/` -- production dependency tree (no devDeps)
- `bin/eshyra` + `bin\eshyra.cmd` -- launchers that invoke the bundled Node
- `LICENSE`, `COMMERCIAL-LICENSE.md`, `NOTICE`, `README.txt`
- `THIRD-PARTY/node-LICENSE.txt` -- redistributed Node runtime license

Each Release also includes:
- `<archive>.json` -- metadata sidecar (version, edition, bundled providers, OS,
  arch, Node version, size)
- `sha256sums.txt` -- SHA-256 checksums for all archives and sidecars
- `install.sh` / `install.ps1` -- the one-line installer scripts

The artifact format is recorded in `scripts/release/build-release-artifact.mjs`
and validated by `scripts/release/validate-release-artifact.mjs`.

## Why self-contained, not npm

- Eliminates system Node and npm as prerequisites for end users.
- Pins the Node ABI exactly to the `better-sqlite3` native prebuild.
- Ensures the CLI is reproducibly runnable from the installed archive without
  any post-install build steps.
- Keeps `@eshyra/core` private and not exposed as a public SDK, consistent
  with the pre-1.0 API-stability posture.

## Build and release flow

Release builds run in CI via `.github/workflows/release.yml`:

1. The matrix builds one artifact per **edition × platform** (4 editions ×
   4 platforms = 16 archives), each edition selected with
   `--edition`/`ESHYRA_EDITION` on its target runner.
2. Each artifact is validated (`npm run release:validate`) before upload; the
   validator also checks the packed provider set matches the encoded edition.
3. The `clean-env-smoke` job runs the linux-x64 artifact's bundled launcher
   inside a minimal, toolchain-free Debian container
   (`scripts/release/clean-env-smoke.sh`) to prove it runs on a machine with no
   `gcc`/`make`/`python3`/system-Node — ADR 0016's "end users need no
   toolchain" claim, which the toolchain-equipped GitHub-hosted runners cannot
   otherwise exercise. It gates the tag-release job.
4. On a `v*` tag, the `release` job downloads all artifacts, generates
   `sha256sums.txt`, and uploads archives + checksums + installer scripts to
   the GitHub Release.

### Version resolution

The release version is **derived from the pushed git tag** — there is no
`version` field to hand-edit. `release:build` resolves it in precedence order:

1. an explicit `--version <v>` argument,
2. the `ESHYRA_RELEASE_VERSION` environment variable,
3. the pushed tag (`GITHUB_REF_NAME` when `GITHUB_REF_TYPE=tag`, leading `v`
   stripped) — this is the CI path, set automatically by GitHub Actions,
4. the `0.0.0-dev` sentinel fallback (local/PR/dev builds).

The resolved version (with the edition) names the artifact
(`eshyra-<edition>-<version>-<os>-<arch>`), the `README.txt`, and the `.json`
sidecar, and the version is **stamped into the compiled core `dist`** (replacing
the `CORE_VERSION` `0.0.0-dev` placeholder) before packing, so the installed
CLI's banner reports the true release version. To cut a release, push a semver
tag (e.g. `git tag v0.1.0 && git push origin v0.1.0`); no source edit is
required.

### Edition resolution

`release:build` resolves the edition in precedence order: an explicit
`--edition <name>` argument, then the `ESHYRA_EDITION` environment variable,
then `DEFAULT_EDITION` (`claude`) from `scripts/release/editions.mjs`. An
unknown edition fails the build loudly.

Local development workflow:

```bash
npm run release:build     # build the default (claude) edition, dev version
npm run release:build -- --edition api      # build the lean api edition
npm run release:validate  # validate the built artifact(s) in dist-release/
npm run release:checksums # generate sha256sums.txt for dist-release/

# Simulate a tagged release build locally:
npm run release:build -- --edition codex --version 0.1.0
```

## Runtime policy

Node 24 LTS is the supported runtime. The bundled Node binary is the one
running the `release:build` script (the CI matrix runner's Node 24 binary).
The `better-sqlite3` prebuild is the one npm installed for that exact ABI.

See [ADR 0008](adr/0008-node-runtime-and-native-sqlite-support.md) for the
full rationale.

## Dolt (checkpoints)

Dolt is **not** bundled in the archive. The CLI works without Dolt; graceful
session close reports that no checkpoint was made. On first use of a checkpoint
feature, the CLI offers to download a pinned, checksum-verified Dolt binary
into the managed data root. See [Local Storage](storage.md).

## Installer behavior

`scripts/release/install.sh` (POSIX):
- Selects the edition: `--edition <name>` flag, then `ESHYRA_EDITION`, then an
  interactive prompt (TTY only), then the `claude` default. Piped installs
  (`curl … | sh`) are non-interactive and take the default unless a flag/env is
  given (`curl … | sh -s -- --edition codex`).
- Detects OS + arch; rejects unsupported targets (Intel macOS, unknown arch).
- Queries the GitHub API and selects the asset by edition prefix + target suffix
  (or uses `ESHYRA_VERSION`).
- Downloads the archive, verifies SHA-256 against `sha256sums.txt`.
- Installs to `${XDG_DATA_HOME:-$HOME/.local/share}/eshyra/app/<artifact>/` (the
  artifact dir name encodes the edition, so editions/versions never collide).
- Creates/repoints `$HOME/.local/bin/eshyra`.
- Supports `ESHYRA_BASE_URL` for local or staged-release testing.

`scripts/release/install.ps1` (PowerShell):
- Selects the edition: `-Edition <name>` (direct invocation) or
  `$env:ESHYRA_EDITION` (works under `irm … | iex`), then an interactive prompt
  when a console is attached, then the `claude` default.
- Detects Windows x64; rejects other architectures.
- Queries the GitHub API and selects the asset by edition prefix + target suffix
  (or uses `-Version`/`$env:ESHYRA_VERSION`).
- Downloads the ZIP, verifies SHA-256 against `sha256sums.txt`.
- Installs to `$env:LOCALAPPDATA\Eshyra\app\<artifact>\`.
- Creates `$env:LOCALAPPDATA\Eshyra\bin\eshyra.cmd`; updates user PATH.
- Supports `-BaseUrl`/`$env:ESHYRA_BASE_URL` for local testing.
