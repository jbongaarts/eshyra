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
# Linux / macOS / WSL
curl -fsSL https://github.com/jbongaarts/eshyra/releases/latest/download/install.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://github.com/jbongaarts/eshyra/releases/latest/download/install.ps1 | iex
```

See [docs/install.md](install.md) for the full install and update guide.

## Artifact format

Each GitHub Release publishes one self-contained archive per supported platform:

| Platform                | Archive                                | Format    |
| ----------------------- | -------------------------------------- | --------- |
| Linux x64 (incl. WSL)  | `eshyra-<version>-linux-x64.tar.gz`   | `.tar.gz` |
| Linux arm64             | `eshyra-<version>-linux-arm64.tar.gz` | `.tar.gz` |
| macOS arm64             | `eshyra-<version>-darwin-arm64.tar.gz`| `.tar.gz` |
| Windows x64             | `eshyra-<version>-windows-x64.zip`    | `.zip`    |

Each archive contains:
- `runtime/node` (or `runtime\node.exe`) -- the pinned Node 24 runtime
- `app/node_modules/` -- production dependency tree (no devDeps)
- `bin/eshyra` + `bin\eshyra.cmd` -- launchers that invoke the bundled Node
- `LICENSE`, `COMMERCIAL-LICENSE.md`, `NOTICE`, `README.txt`
- `THIRD-PARTY/node-LICENSE.txt` -- redistributed Node runtime license

Each Release also includes:
- `<archive>.json` -- metadata sidecar (version, OS, arch, Node version, size)
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

1. The matrix builds one artifact per platform (Linux x64, Linux arm64, macOS
   arm64, Windows x64), each on its target runner.
2. Each artifact is validated (`npm run release:validate`) before upload.
3. On a `v*` tag, the `release` job downloads all artifacts, generates
   `sha256sums.txt`, and uploads archives + checksums + installer scripts to
   the GitHub Release.

Local development workflow:

```bash
npm run release:build     # build the artifact for the current platform
npm run release:validate  # validate the built artifact
npm run release:checksums # generate sha256sums.txt for dist-release/
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
- Detects OS + arch; rejects unsupported targets (Intel macOS, unknown arch).
- Queries the GitHub API for the latest release tag (or uses `ESHYRA_VERSION`).
- Downloads the archive, verifies SHA-256 against `sha256sums.txt`.
- Installs to `${XDG_DATA_HOME:-$HOME/.local/share}/eshyra/app/<target>/`.
- Creates/repoints `$HOME/.local/bin/eshyra`.
- Supports `ESHYRA_BASE_URL` for local or staged-release testing.

`scripts/release/install.ps1` (PowerShell):
- Detects Windows x64; rejects other architectures.
- Queries the GitHub API for the latest release tag (or uses `-Version`/`$env:ESHYRA_VERSION`).
- Downloads the ZIP, verifies SHA-256 against `sha256sums.txt`.
- Installs to `$env:LOCALAPPDATA\Eshyra\app\<target>\`.
- Creates `$env:LOCALAPPDATA\Eshyra\bin\eshyra.cmd`; updates user PATH.
- Supports `-BaseUrl`/`$env:ESHYRA_BASE_URL` for local testing.
