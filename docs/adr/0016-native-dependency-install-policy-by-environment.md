# ADR 0016: Native Dependency Install Policy Across Dev, Release CI, and End-User Artifacts

- **Status:** Accepted
- **Date:** 2026-06-30
- **Bead:** eshyra-le7p
- **Supersedes:** [ADR 0008](0008-node-runtime-and-native-sqlite-support.md)

## Context

ADR 0008 was written when `npm install` was the only distribution path in
view, so it treated CI and release native-install policy as one
undifferentiated thing and chose the prebuilt-binary path as primary
(`npm_config_build_from_source=false`) to avoid depending on local C++
toolchains. Distribution has since moved: ADR
[0003](0003-local-cli-first-release-storage.md) and ADR
[0011](0011-multi-provider-installer-editions.md) ship the end-user CLI as
self-contained, per-platform GitHub Release archives that bundle a pinned
Node 24 runtime, the ABI-matched `better-sqlite3` native addon, and the
production app tree (`docs/cli-distribution.md`). End users run
`install.sh`/`install.ps1`, which download, checksum-verify, and unpack an
archive — they never run `npm install`, `npm ci`, or a compiler.

Under that model there are three environments with materially different
constraints that ADR 0008 conflated into one policy:

1. **Developer/workspace installs** — `npm ci`/`npm install` in this repo or
   a contributor's clone, and the dev/test workflow
   (`.github/workflows/ci.yml`).
2. **Release CI** — `.github/workflows/release.yml`, which builds the
   artifact once per (edition, OS/arch) leg on GitHub-hosted runners
   (`ubuntu-latest`, `ubuntu-24.04-arm`, `macos-14`, `windows-latest`) that
   ship full native toolchains (build-essential / Xcode CLT / MSVC Build
   Tools) for exactly the four supported targets.
3. **The end-user machine** that unpacks a published release archive and
   never installs or compiles anything.

Two concrete gaps surfaced this conflation:

- `better-sqlite3`'s only path to a prebuilt binary goes through
  `prebuild-install`, which its own maintainers have deprecated with no
  maintained successor — npm prints the deprecation notice on every install,
  including today's pinned `better-sqlite3`@12.11.1 (latest). No version bump
  fixes this (bead `eshyra-nkbo`). ADR 0008's prebuilt-first policy makes
  every dev/CI/release install depend on that deprecated package's download
  path continuing to work, and gave no place to decide what to do about it.
- `scripts/release/validate-release-artifact.mjs` already asserts the
  unpacked artifact runs on **only** the bundled Node runtime, and exercises
  the launcher through a symlink with `PATH` restricted to system bin dirs
  (coreutils only) so the launcher can't silently depend on some other tool
  on `PATH`. But every job that runs this validator executes on a
  GitHub-hosted runner that has a full toolchain installed on the
  filesystem. The "end users need no toolchain" claim has never been
  exercised on a machine that actually lacks one.

## Decision

Split native-dependency install policy into three layers, and flip the
dev/workspace and release-CI layers from prebuilt-first to **source-build
first**, via a checked-in root `.npmrc` (`build-from-source=true`). This
applies uniformly to every `npm ci`/`npm install` run from the repo root —
contributor machines, `ci.yml`, and `release.yml` all pick it up automatically
with no per-workflow env var needed. `better-sqlite3` 12.x and Node 24 LTS
(ADR 0008) are unchanged; this ADR only changes *how* the native addon is
obtained, not which version/runtime it targets.

### Layer 1 — developer/workspace install policy (changed from ADR 0008)

- `npm ci`/`npm install` in this repo now compile `better-sqlite3` from
  source (`build-from-source=true` in the root `.npmrc`), instead of
  downloading a `prebuild-install` prebuilt binary. This requires a working
  C/C++ toolchain on every contributor machine and in `ci.yml` — see
  README.md prerequisites and AGENTS.md.
- **No automatic runtime fallback exists today.** `better-sqlite3`'s own
  install script is hardcoded as `prebuild-install || node-gyp rebuild`; it
  cannot be reordered to "compile first, download a prebuild if that fails"
  without custom wrapper tooling (e.g. a workspace-level install script that
  shells out to `node-gyp` first and only invokes `prebuild-install` on
  failure). Building that wrapper is **not required by this decision** — a
  compile failure today is a hard install failure, same as ADR 0008's
  prebuild-unavailable case was. This ADR deliberately leaves room for adding
  a smarter fallback later without mandating it now; see Rejected
  Alternatives.
- Switching to source-build-first does **not** eliminate the `prebuild-install`
  deprecation warning (bead `eshyra-nkbo`): `prebuild-install` remains a
  declared dependency of `better-sqlite3` and gets installed into
  `node_modules` regardless of whether its code path ever runs, and npm
  prints deprecation notices for any resolved package flagged deprecated in
  the registry independent of runtime behavior (verified: the warning still
  appears with `build-from-source=true`). The warning stays accepted, tracked
  cosmetic noise under either install strategy.
- `npm_config_build_from_source` is passed via `.npmrc`'s `build-from-source`
  key rather than an ambient env var so it survives regardless of shell/CI
  environment. Recent npm versions warn `Unknown project config
  "build-from-source"` even though the setting still works (`prebuild-install`
  reads the resulting `npm_config_build_from_source` env var directly, not
  through npm's own config-name validation) — this is a known upstream npm
  wrinkle, not a project misconfiguration; revisit if a future npm major
  actually stops forwarding it.

### Layer 2 — release CI native-build policy (changed from ADR 0008)

- Release CI (`release.yml`) uses the same source-build-first policy as
  layer 1, via the same root `.npmrc` — no separate release-specific
  override. Release runners are fixed, toolchain-equipped GitHub-hosted
  images for exactly the four supported (OS, arch) targets, so compiling
  there is low-risk and removes the release pipeline's dependency on
  `prebuild-install`/upstream prebuild availability entirely.
- `scripts/release/build-release-artifact.mjs` installs the production app
  tree via a `--global --prefix` install, which does not inherit the repo
  root's `.npmrc` (global installs resolve config differently); that call
  passes `npm_config_build_from_source: 'true'` explicitly so it matches
  layer 1/2 policy.
- Any install failure here is real and should fail the release build loudly
  (GitHub-hosted runners are expected to have working toolchains for their
  own platform); there is no silent fallback to a downloaded prebuild, same
  caveat as layer 1.

### Layer 3 — end-user artifact install policy (new, unchanged intent)

- Published release archives must never run `npm install`, `npm ci`, or
  invoke any compiler/toolchain (`node-gyp`, `cc`, `python`, MSVC, etc.) on
  the end-user's machine, at install time or run time. The installer scripts
  only download, checksum-verify, and unpack an archive; the CLI launcher
  only execs the bundled Node runtime against the bundled app tree.
- Every archive bundles (a) the Node runtime binary used to build it and
  (b) the `better-sqlite3` native addon compiled during that build (layer 2),
  and both must match the archive's declared OS/arch (and therefore Node
  ABI). Whether the addon came from a compile or (hypothetically, if layer
  1/2 policy ever changes back) a downloaded prebuild is invisible and
  irrelevant to the end user: they receive a working binary either way and
  never touch a toolchain.

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
job) is tracked as follow-up implementation (`eshyra-w7bp`) and is out of
scope for this decision record. Windows/macOS GitHub-hosted runners ship
toolchains by default and cannot easily be made "clean" short of self-hosted
runners; the follow-up bead should scope initial coverage to Linux and record
that limitation rather than block on full cross-platform clean-room coverage.

### Node-major guard (preserved from ADR 0008)

Moving to another Node major still requires an explicit dependency/runtime
decision that, at minimum:

- uses a `better-sqlite3` version that compiles cleanly from source (and,
  ideally, still ships prebuilt binaries as a documented recovery option) for
  the supported CI/release platforms
- updates the root and workspace `engines.node` ranges and CI Node version
- proves clean installs with the repo's `.npmrc` `build-from-source=true`
  policy in effect
- keeps lockfile churn limited to the intentional dependency change

This applies across all three layers: a Node-major bump changes the ABI
target for dev installs, release builds, and bundled artifacts at the same
time, so it cannot be decided layer-by-layer.

## Consequences

- ADR 0008 is superseded by this ADR. Its Node 24 / `better-sqlite3` 12.x pin
  and Node-major guard carry forward unchanged; its prebuilt-first install
  decision is reversed for layers 1 and 2.
- Every contributor machine and CI runner now needs a working C/C++
  toolchain to run `npm ci`/`npm install` — no longer optional/conditional.
  README.md and AGENTS.md document the prerequisite plainly instead of as a
  "only if" fallback note.
- `eshyra-nkbo` (the `prebuild-install` deprecation warning) is closed as
  won't-fix: neither the old nor the new install policy removes it, since
  `prebuild-install` remains a declared dependency of `better-sqlite3`
  either way.
- `ci.yml`'s install-smoke job is inverted: it now fails if the log shows a
  *downloaded* prebuilt binary (policy not taking effect) or is missing
  evidence of a genuine compile, instead of failing when a compile happens.
- Release build time increases modestly (a native compile per matrix leg
  instead of a prebuild download); accepted as the cost of removing the
  `prebuild-install` dependency from the release-critical path.
- Follow-up work is needed to add a clean-toolchain-free smoke job (tracked
  by `eshyra-w7bp`).
- `AGENTS.md`, `docs/dependencies.md`, `docs/cli-distribution.md`, and
  `README.md` are updated to describe the source-build-first policy and the
  now-mandatory toolchain prerequisite.

## Rejected Alternatives

- **Build a custom install-order wrapper now (compile first, fall back to
  `prebuild-install` on failure).** Deferred, not rejected outright: it would
  give real graceful degradation for contributors without a toolchain, but
  it's meaningful new tooling (a wrapper script, plus verifying it behaves
  correctly across `npm ci`/`npm install`/lockfile scenarios) that isn't
  needed to unblock the current decision. Revisit if toolchain-less
  contributor installs turn out to matter in practice.
- **Keep prebuilt-first for layer 1/2 and only document the deprecation
  warning as accepted noise.** Rejected: it leaves every dev/CI/release
  install permanently dependent on `prebuild-install`'s continued operation,
  which is the exact deprecated, unmaintained path bead `eshyra-nkbo`
  flagged as a risk.
- **Allow source compilation on the end-user machine as a fallback when no
  matching prebuild/artifact exists.** Rejected outright: it violates the
  self-contained-artifact product decision (ADR 0003/0011) that end users
  install nothing beyond the downloaded archive. Layer 3 is unaffected by the
  layer 1/2 flip.
- **Leave ADR 0008 as the single source of truth and add a clarifying note
  instead of a new ADR.** Rejected: the three layers have different actors
  (contributor laptop vs. release runner vs. end-user machine) and now
  materially different install strategies (source-first for layers 1/2,
  never-installs-anything for layer 3). Folding them into one section, as
  ADR 0008 originally did, already produced ambiguity (bead `eshyra-nkbo`,
  and an untested "no toolchain needed" assumption in the release
  validator).

## Related decisions

- [ADR 0008](0008-node-runtime-and-native-sqlite-support.md) (superseded) —
  Node 24 runtime + `better-sqlite3` pin; origin of the Node-major guard
  preserved above.
- [ADR 0003](0003-local-cli-first-release-storage.md) — self-contained
  GitHub Release archive distribution.
- [ADR 0011](0011-multi-provider-installer-editions.md) — per-edition
  archives bundling the same Node runtime + native addon model.
- `.npmrc` — the checked-in mechanism implementing layers 1/2 of this
  decision.
- `docs/cli-distribution.md` — release build/validate mechanics.
- `docs/dependencies.md` — native/runtime dependency update rules.
- Beads: `eshyra-le7p` (this decision), `eshyra-nkbo` (closed — the
  `prebuild-install` deprecation warning), `eshyra-w7bp` (clean-environment
  smoke test follow-up).
