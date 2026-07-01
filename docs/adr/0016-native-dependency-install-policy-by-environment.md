# ADR 0016: Native Dependency Install Policy Across Dev, Release CI, and End-User Artifacts

- **Status:** Accepted
- **Date:** 2026-06-30
- **Bead:** eshyra-le7p
- **Supersedes:** [ADR 0008](0008-node-runtime-and-native-sqlite-support.md)

## Context

ADR 0008 was written when `npm install` was the only distribution path in
view, so it treated CI and release native-install policy as one
undifferentiated thing ("CI and release jobs must keep
`npm_config_build_from_source=false`"). Distribution has since moved: ADR
[0003](0003-local-cli-first-release-storage.md) and ADR
[0011](0011-multi-provider-installer-editions.md) ship the end-user CLI as
self-contained, per-platform GitHub Release archives that bundle a pinned
Node 24 runtime, the ABI-matched `better-sqlite3` prebuild, and the
production app tree (`docs/cli-distribution.md`). End users run
`install.sh`/`install.ps1`, which download, checksum-verify, and unpack an
archive — they never run `npm install`, `npm ci`, or a compiler.

Under that model there are three environments with materially different
constraints that ADR 0008 conflated into one policy:

1. **Developer/workspace installs** — `npm ci`/`npm install` in this repo or
   a contributor's clone, and the dev/test workflow
   (`.github/workflows/ci.yml`). Toolchain availability on a contributor
   machine is not guaranteed.
2. **Release CI** — `.github/workflows/release.yml`, which builds the
   artifact once per (edition, OS/arch) leg on GitHub-hosted runners
   (`ubuntu-latest`, `ubuntu-24.04-arm`, `macos-14`, `windows-latest`) that
   happen to ship full native toolchains (build-essential / Xcode CLT / MSVC
   Build Tools) for exactly the four supported targets.
3. **The end-user machine** that unpacks a published release archive and
   never installs or compiles anything.

Two concrete gaps surfaced this conflation:

- `better-sqlite3`'s only path to a prebuilt binary goes through
  `prebuild-install`, which its own maintainers have deprecated with no
  maintained successor — npm prints the deprecation notice on every install,
  including today's pinned `better-sqlite3`@12.11.1 (latest). No version bump
  fixes this (bead `eshyra-nkbo`): it is dev-time noise, not a policy
  violation, but ADR 0008 gave no place to record that judgment or to answer
  what should happen if `prebuild-install`, or the npm prebuild ecosystem
  generally, ever stops producing a working binary for a supported target.
- `.github/workflows/ci.yml` fails the job outright if `prebuild-install`
  falls back to `node-gyp` source compilation (log-scan guard, ~lines
  120-141). `.github/workflows/release.yml` has no equivalent guard. That
  omission was accidental, not a decision — ADR 0008 doesn't say whether
  release CI should behave the same as dev CI or differently.
- `scripts/release/validate-release-artifact.mjs` already asserts the
  unpacked artifact runs on **only** the bundled Node runtime, and exercises
  the launcher through a symlink with `PATH` restricted to system bin dirs
  (coreutils only) so the launcher can't silently depend on some other tool
  on `PATH`. But every job that runs this validator executes on a
  GitHub-hosted runner that has a full toolchain installed on the
  filesystem. The "end users need no toolchain" claim has never been
  exercised on a machine that actually lacks one.

## Decision

Split native-dependency install policy into three layers. ADR 0008's
Node 24 / `better-sqlite3` 12.x pin and its Node-major guard are unchanged
and continue to govern layer 1; this ADR adds layers 2 and 3 explicitly and
states them as decisions.

### Layer 1 — developer/workspace install policy (unchanged from ADR 0008)

- `npm ci`/`npm install` in this repo, and `.github/workflows/ci.yml`, must
  resolve `better-sqlite3` via a downloaded prebuild
  (`npm_config_build_from_source=false`).
- A `prebuild-install` → `node-gyp` source-build fallback here stays a hard
  CI failure (the existing `ci.yml` log-scan guard). Contributor machines are
  not guaranteed to have a working native toolchain, and source builds make
  install failures harder to diagnose.
- The `prebuild-install` package-level deprecation notice is accepted,
  tracked, cosmetic noise — not a regression — as long as it keeps fetching a
  working prebuild. It does not need a workaround (e.g. an `overrides` entry
  forcing a different resolver), and should not be "fixed" by a change that
  risks the prebuilt-binary install path. Revisit only if a future
  `better-sqlite3` release migrates off `prebuild-install`, or if it stops
  producing a working binary for a supported target.

### Layer 2 — release CI native-build policy (new)

- Release CI (`release.yml`) prefers the same prebuilt-binary path as layer 1
  (`npm_config_build_from_source=false`) for reproducibility and speed.
- Unlike layer 1, a `prebuild-install` → `node-gyp` fallback in release CI is
  **not** automatically a failure. Release CI runners are fixed,
  toolchain-equipped GitHub-hosted images for exactly the four supported
  (OS, arch) targets, so a controlled source compile there is an acceptable
  last resort if a future `better-sqlite3`/Node-ABI combination ships without
  a prebuild, or the `prebuild-install` ecosystem stops working. This
  decouples "can we cut a release" from "did upstream publish a prebuild this
  week," which layer 1 cannot safely do because dev/CI laptops are not
  release runners.
- Any such fallback must still produce a `.node` binary matching the leg's
  target OS/arch/Node ABI. It is deliberately not silenced: a fallback should
  be visible in the release build log as a reviewable event, not an invisible
  change of provenance.
- This does not relax layer 1. Dev/test CI keeps failing hard on fallback.

### Layer 3 — end-user artifact install policy (new)

- Published release archives must never run `npm install`, `npm ci`, or
  invoke any compiler/toolchain (`node-gyp`, `cc`, `python`, MSVC, etc.) on
  the end-user's machine, at install time or run time. The installer scripts
  only download, checksum-verify, and unpack an archive; the CLI launcher
  only execs the bundled Node runtime against the bundled app tree.
- Every archive bundles (a) the Node runtime binary used to build it and
  (b) the `better-sqlite3` native addon resolved during that build, and both
  must match the archive's declared OS/arch (and therefore Node ABI) — a
  `linux-x64` archive's Node binary and `.node` addon are both built for
  linux-x64 against the same Node ABI. Whether that addon was a downloaded
  prebuild or a layer-2 source compile is invisible and irrelevant to the end
  user: they receive a working binary either way and never touch a
  toolchain.

### Clean-environment artifact smoke coverage (new requirement)

At least one release validation/smoke step must run the unpacked artifact's
launcher on a target environment that actually lacks a native build
toolchain, to prove layer 3's claim rather than assume it from restricted
`PATH` alone. Today's `validate-release-artifact.mjs` and
`installer-smoke.mjs` jobs run on GitHub-hosted runners that always have a
toolchain present on disk, even when `PATH` is restricted for a given
`spawnSync` call. This ADR requires the coverage; the concrete CI mechanism
(for example, a containerized Linux leg using a minimal base image without
`build-essential`/`python3`, fed a pre-built artifact from the existing build
job) is tracked as follow-up implementation and is out of scope for this
decision record. Windows/macOS GitHub-hosted runners ship toolchains by
default and cannot easily be made "clean" short of self-hosted runners; the
follow-up bead should scope initial coverage to Linux and record that
limitation rather than block on full cross-platform clean-room coverage.

### Node-major guard (preserved from ADR 0008)

Moving to another Node major still requires an explicit dependency/runtime
decision that, at minimum:

- uses a `better-sqlite3` version with prebuilt binaries for the supported
  CI/release platforms
- updates the root and workspace `engines.node` ranges and CI Node version
- proves clean installs with `npm_config_build_from_source=false`
- keeps lockfile churn limited to the intentional dependency change

This applies across all three layers: a Node-major bump changes the ABI
target for dev installs, release builds, and bundled artifacts at the same
time, so it cannot be decided layer-by-layer.

## Consequences

- ADR 0008 is superseded by this ADR. Its Node 24 / `better-sqlite3` 12.x pin
  and Node-major guard carry forward unchanged as layer 1.
- `eshyra-nkbo` (the `prebuild-install` deprecation warning) is closed as
  won't-fix, citing layer 1's explicit acceptance of that noise.
- `release.yml` is not required to add a source-build-fallback failure guard
  mirroring `ci.yml`'s; that omission is now a decision (layer 2), not a gap.
- Follow-up work is needed to add a clean-toolchain-free smoke job (tracked
  by a new bead filed alongside this ADR) and, if a layer-2 fallback is ever
  exercised for real, to confirm its log visibility is adequate.
- `AGENTS.md`, `docs/dependencies.md`, and `docs/cli-distribution.md` are
  updated to point at this ADR for release/end-user native-install policy
  while keeping ADR 0008's Node 24/`better-sqlite3` pin as the layer-1
  reference.

## Rejected Alternatives

- **Require release CI to also hard-fail on any source-build fallback (same
  as dev CI).** Rejected: it would make cutting a release depend entirely on
  `prebuild-install`/upstream prebuild availability with no controlled
  fallback, even though release runners have the exact toolchain needed to
  safely compile the target ABI themselves.
- **Allow source compilation on the end-user machine as a fallback when no
  matching prebuild/artifact exists.** Rejected outright: it violates the
  self-contained-artifact product decision (ADR 0003/0011) that end users
  install nothing beyond the downloaded archive.
- **Leave ADR 0008 as the single source of truth and add a clarifying note
  instead of a new ADR.** Rejected: the three layers have different actors
  (contributor laptop vs. release runner vs. end-user machine) and different
  acceptable behaviors. Folding them into one section, as ADR 0008 originally
  did, already produced ambiguity (bead `eshyra-nkbo`, and an untested
  "no toolchain needed" assumption in the release validator).

## Related decisions

- [ADR 0008](0008-node-runtime-and-native-sqlite-support.md) (superseded) —
  Node 24 runtime + `better-sqlite3` pin; origin of the Node-major guard
  preserved above.
- [ADR 0003](0003-local-cli-first-release-storage.md) — self-contained
  GitHub Release archive distribution.
- [ADR 0011](0011-multi-provider-installer-editions.md) — per-edition
  archives bundling the same Node runtime + native addon model.
- `docs/cli-distribution.md` — release build/validate mechanics.
- `docs/dependencies.md` — native/runtime dependency update rules.
- Beads: `eshyra-le7p` (this decision), `eshyra-nkbo` (closed — the
  `prebuild-install` deprecation warning).
