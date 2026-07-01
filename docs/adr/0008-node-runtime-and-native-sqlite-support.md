# ADR 0008: Node Runtime and Native SQLite Support

Status: superseded by [ADR 0016](0016-native-dependency-install-policy-by-environment.md)

Date: 2026-05-29

> **Superseded.** ADR 0016 keeps the Node 24 LTS / `better-sqlite3` 12.x pin
> and the Node-major guard below unchanged, as the developer/workspace install
> layer, but splits out release-CI native-build policy and end-user artifact
> install policy as their own explicit layers — distinctions this ADR did not
> make because it predates the self-contained release-artifact distribution
> model (ADR 0003/0011). Read ADR 0016 for the current, complete policy; this
> ADR remains accurate for the dev/workspace layer.

## Context

Eshyra's local CLI is distributed through npm and depends on
`better-sqlite3` for the campaign SQLite store. `better-sqlite3` is the only
native dependency in the workspace, so the Node runtime support decision is also
a native binary support decision.

The workspace previously depended on `better-sqlite3` `^11.3.0`, resolved in
the lockfile as 11.10.0. That line was suitable for the earlier Node 22 baseline
but made Node 24 support depend on native binding availability or source
compilation. The package installs through `prebuild-install` first and falls
back to `node-gyp` source compilation when a matching prebuilt binary is not
available. Source compilation is not an acceptable default for CI or the first
CLI release because it depends on local C++ toolchains and makes install
failures harder to diagnose.

The root package and both workspaces already declare:

```json
{ "engines": { "node": ">=24 <25" } }
```

That engine range communicates the supported runtime boundary.

## Decision

Node 24 LTS is the supported runtime for the first local CLI release.

The workspace uses `better-sqlite3` 12.x for Node 24 native prebuild support.
The root package and both workspaces declare `>=24 <25`, and CI runs on Node 24.

CI and release jobs must keep `npm_config_build_from_source=false` when
installing dependencies so prebuild-install does not intentionally skip native
prebuilds. If the selected Node runtime and `better-sqlite3` line diverge, the
fix is to update them together rather than relying on source compilation.

Moving to another Node major requires a dependency decision that, at minimum:

- uses a `better-sqlite3` version with prebuilt binaries for the supported
  CI/release platforms
- updates the root and workspace `engines.node` ranges and CI Node version
- proves clean installs with `npm_config_build_from_source=false`
- keeps lockfile churn limited to the intentional dependency change

## Consequences

- README prerequisites, package engine ranges, CI comments, release planning,
  and agent guidance all point to Node 24 LTS as the supported baseline.
- `better-sqlite3` moves to the 12.x line as an intentional native dependency
  upgrade.
- Node 22 is no longer in the supported engine range for the first CLI release.
- Future Node runtime work has a concrete acceptance bar instead of relying on
  incidental local install behavior.

## Rejected Alternatives

- **Keep Node 22 for the first release.** Rejected because Node 24 is now LTS,
  `better-sqlite3` 12.x is available, and the project can align CI, package
  engines, and release docs on the current LTS runtime.
- **Declare Node 24 supported without changing `better-sqlite3`.** Rejected
  because support would depend on source compilation or incidental local native
  bindings rather than a reproducible prebuilt-binary install.
