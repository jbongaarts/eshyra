# ADR 0016: Native Dependency Install Policy Across Dev, Release CI, and End-User Artifacts

- **Status:** Accepted
- **Date:** 2026-06-30
- **Bead:** eshyra-le7p
- **Extends:** [ADR 0008](0008-node-runtime-and-native-sqlite-support.md)

## Context

ADR 0008 was written when `npm install` was the only distribution path in
view, so it treated CI and release native-install policy as one
undifferentiated rule: "CI and release jobs must keep
`npm_config_build_from_source=false`." Distribution has since moved: ADR
[0003](0003-local-cli-first-release-storage.md) and ADR
[0011](0011-multi-provider-installer-editions.md) ship the end-user CLI as
self-contained, per-platform GitHub Release archives that bundle a pinned
Node 24 runtime, the ABI-matched `better-sqlite3` native addon, and the
production app tree (`docs/cli-distribution.md`). End users run
`install.sh`/`install.ps1`, which download, checksum-verify, and unpack an
archive — they never run `npm install`, `npm ci`, or a compiler.

That leaves three environments with materially different constraints, which
ADR 0008 conflated into one policy:

1. **Developer/workspace installs** — `npm ci`/`npm install` in this repo or
   a contributor's clone, and the dev/test workflow
   (`.github/workflows/ci.yml`).
2. **Release CI** — `.github/workflows/release.yml`, which builds the
   artifact once per (edition, OS/arch) leg on GitHub-hosted runners
   (`ubuntu-latest`, `ubuntu-24.04-arm`, `macos-14`, `windows-latest`) that
   ship full native toolchains for exactly the four supported targets.
3. **The end-user machine** that unpacks a published release archive and
   never installs or compiles anything.

Two facts motivate revisiting the single-policy framing:

- `better-sqlite3`'s prebuilt-binary path goes through `prebuild-install`,
  which its maintainers have deprecated across **every** published version
  (verified 7.0.1 through 7.1.3 all carry the deprecation notice) with no
  maintained successor. npm therefore prints a deprecation warning on every
  install (bead `eshyra-nkbo`), and the prebuilt download path itself is now
  unmaintained infrastructure the project depends on for layers 1 and 2.
- `scripts/release/validate-release-artifact.mjs` already asserts the
  unpacked artifact runs on **only** the bundled Node runtime, exercising the
  launcher through a symlink with `PATH` restricted to system bin dirs. But
  every job that runs it executes on a GitHub-hosted runner that has a full
  toolchain on disk. The "end users need no toolchain" claim has never been
  exercised on a machine that actually lacks one.

## Decision

Model native-dependency install policy as three layers with different rules,
and — for the dev/workspace and release-CI layers — treat the prebuilt-vs-
source-build choice as an **implementation decision that can change without a
new ADR**, rather than a fixed policy. ADR 0008's Node 24 / `better-sqlite3`
12.x pin, its prebuilt-first default, and its Node-major guard all remain in
force; this ADR adds the layer model, the end-user-artifact rule, and the
pre-authorization below.

### Layer 1 — developer/workspace install policy

- **Default (current):** prebuilt-first, per ADR 0008. `npm ci`/`npm install`
  in this repo and `.github/workflows/ci.yml` resolve `better-sqlite3` via a
  downloaded `prebuild-install` prebuilt binary
  (`npm_config_build_from_source=false`), and `ci.yml`'s install-smoke guard
  fails if a source-build fallback happens. A working C/C++ toolchain is
  therefore optional for contributors (needed only when no prebuild matches).
- **Pre-authorized alternative:** switching this layer to **source-build-first**
  (e.g. via a checked-in root `.npmrc` `build-from-source=true`, or per-job
  env) is an *implementation choice*, not a policy change — no new ADR is
  required to adopt it. The motivation on the table is resiliency: it removes
  the dependency on `prebuild-install`'s deprecated, unmaintained download
  path. See "Conditions for opting into source-build-first" below for what
  must move together if this is done.

### Layer 2 — release CI native-build policy

- **Default (current):** prebuilt-first, per ADR 0008 — the bundled
  `better-sqlite3` addon is a downloaded prebuild.
- **Pre-authorized alternative:** release CI (`release.yml`) may likewise be
  switched to source-build-first without a new ADR. Its runners are fixed,
  toolchain-equipped GitHub-hosted images for exactly the four supported
  targets, so compiling there is low-risk and removes the release-critical
  path's reliance on `prebuild-install`. The same conditions below apply.

### Conditions for opting into source-build-first (layers 1–2)

If a future change flips either layer to source-build-first, the following
must move together (these were validated end-to-end on this bead's branch
before the flip was reverted, so they are known-good, not speculative):

1. **Toolchain becomes mandatory** in that environment — every contributor
   machine and CI runner for that layer needs a working C/C++ toolchain and
   Python (node-gyp's build prerequisites). Update README.md prerequisites
   and AGENTS.md to state this plainly rather than as an "only if" fallback.
2. **Invert the `ci.yml` install-smoke guard.** It currently fails on a
   source-build fallback (asserting the prebuilt path). Under source-build it
   must instead assert a genuine compile happened. Use node-gyp's own
   `gyp info ok` success line as the cross-platform marker — compiler-
   invocation lines (`CXX(target)`, "Building the projects…") are
   compiler/generator-specific and are **not** reliably present in every
   node-gyp/MSVC version's output (a check keyed on them passed on Linux/macOS
   but failed on Windows/MSBuild).
3. **Prune node-gyp byproducts from release artifacts.** A source compile
   runs `node-gyp rebuild`, which builds every target in `better-sqlite3`'s
   `binding.gyp` — including a `test_extension.node` helper addon — plus
   ~18 MB of Makefiles/`.deps`/`obj.target` intermediates. The stray
   `test_extension.node` trips `validate-release-artifact.mjs`'s "no
   unexpected native binaries" rule. Strip everything under
   `better-sqlite3/build/` except `build/Release/better_sqlite3.node`
   (verified: the pruned addon still loads and queries).
4. **Accept a longer build cycle** (a per-install compile instead of a
   prebuild download), and note that switching does **not** remove the
   `prebuild-install` deprecation warning — `prebuild-install` stays a
   declared dependency of `better-sqlite3` and npm prints the notice for any
   resolved deprecated package regardless of whether its code path runs.

### Layer 3 — end-user artifact install policy (hard rule, not a choice)

- Published release archives must **never** run `npm install`, `npm ci`, or
  invoke any compiler/toolchain (`node-gyp`, `cc`, `python`, MSVC, etc.) on
  the end-user's machine, at install time or run time. The installer scripts
  only download, checksum-verify, and unpack an archive; the CLI launcher
  only execs the bundled Node runtime against the bundled app tree.
- Every archive bundles (a) the Node runtime binary used to build it and
  (b) the `better-sqlite3` native addon produced during that build, both
  matching the archive's declared OS/arch (and therefore Node ABI). Whether
  that addon was a downloaded prebuild or a source compile (layers 1–2's
  choice) is invisible and irrelevant to the end user.

### Clean-environment artifact smoke coverage (new requirement)

At least one release validation/smoke step must run the unpacked artifact's
launcher on a target environment that actually lacks a native build
toolchain, to prove layer 3's claim rather than assume it from restricted
`PATH` alone. Today's `validate-release-artifact.mjs` and installer-smoke jobs
run on GitHub-hosted runners that always have a toolchain on disk. This ADR
requires the coverage; the concrete CI mechanism (e.g. a containerized Linux
leg on a minimal base image without `build-essential`/`python3`, fed a
pre-built artifact from the existing build job) is tracked as follow-up
(`eshyra-w7bp`) and is out of scope for this decision record. Windows/macOS
GitHub-hosted runners ship toolchains by default and cannot easily be made
"clean" short of self-hosted runners; the follow-up should scope initial
coverage to Linux and record that limitation.

### Node-major guard (preserved from ADR 0008)

Moving to another Node major still requires an explicit dependency/runtime
decision that, at minimum: uses a `better-sqlite3` version supported on the
target platforms (prebuilt binaries while prebuilt-first is the default, or a
clean source build if a layer has opted into source-build-first); updates the
root and workspace `engines.node` ranges and CI Node version; proves clean
installs; and keeps lockfile churn limited to the intentional change. This
applies across all three layers because a Node-major bump changes the ABI
target for dev installs, release builds, and bundled artifacts at once.

### The prebuild-install deprecation warning

`eshyra-nkbo` (the `prebuild-install` deprecation warning) is closed
won't-fix. The warning is accepted, tracked cosmetic noise: it is emitted by
a transitive dependency of `better-sqlite3`'s current latest version, every
`prebuild-install` version is deprecated, and neither the prebuilt-first
default nor a source-build-first opt-in removes it (the package stays in the
tree either way). Fully eliminating it would require overriding
`prebuild-install` out of the dependency tree with a no-op stub via npm
`overrides` — only safe once a layer builds from source (so the stub is
provably dead code) and it adds a maintained stub + override surface. That is
recorded here as a possible future step, **not** adopted, and would itself be
an implementation choice rather than a policy change.

## Consequences

- ADR 0008 remains accepted and in force; this ADR extends it. The only ADR
  0008 clause this loosens is "CI and release jobs *must* keep
  `build_from_source=false`" — that is now the default, with source-build-first
  a pre-authorized alternative (a pointer is added to ADR 0008).
- The current tree stays prebuilt-first: no `.npmrc` change, no mandatory
  toolchain, `ci.yml`/`release.yml` unchanged. The deprecation warning
  persists and is documented as accepted.
- A future flip to source-build-first (for resiliency against the deprecated
  `prebuild-install` download path) needs no new ADR — only the four
  conditions above, which are recorded from a validated end-to-end trial.
- Follow-up `eshyra-w7bp` adds the clean-toolchain-free artifact smoke job to
  prove layer 3.

## Rejected Alternatives

- **Mandate source-build-first now (flip the default).** Rejected: it does not
  remove the deprecation warning, adds build-cycle time, and makes a toolchain
  mandatory everywhere, in exchange for a resiliency benefit that is real but
  not currently urgent. Recording it as a pre-authorized option captures the
  benefit's availability without paying the cost until it is warranted.
- **Pin `prebuild-install` to a non-deprecated version via `overrides`.**
  Rejected: impossible — every published `prebuild-install` version carries
  the deprecation notice.
- **Suppress npm warnings globally** (`.npmrc loglevel=error`). Rejected: it
  would hide legitimate security and deprecation warnings, not just this one.
- **Allow source compilation on the end-user machine as a fallback.** Rejected
  outright: it violates the self-contained-artifact product decision (ADR
  0003/0011). Layer 3 is a hard rule, not a choice.
- **Fold everything into ADR 0008 with a clarifying note.** Rejected: the three
  layers have different actors (contributor laptop vs. release runner vs.
  end-user machine) and different rules (a pre-authorized choice for layers
  1–2, a hard rule for layer 3), which is clearer as its own record.

## Related decisions

- [ADR 0008](0008-node-runtime-and-native-sqlite-support.md) — Node 24 runtime
  + `better-sqlite3` pin, prebuilt-first default, Node-major guard (all still
  in force; extended here).
- [ADR 0003](0003-local-cli-first-release-storage.md) — self-contained GitHub
  Release archive distribution.
- [ADR 0011](0011-multi-provider-installer-editions.md) — per-edition archives
  bundling the same Node runtime + native addon model.
- `docs/cli-distribution.md` — release build/validate mechanics.
- `docs/dependencies.md` — native/runtime dependency update rules.
- Beads: `eshyra-le7p` (this decision), `eshyra-nkbo` (closed won't-fix — the
  `prebuild-install` deprecation warning), `eshyra-w7bp` (clean-environment
  smoke test follow-up).
