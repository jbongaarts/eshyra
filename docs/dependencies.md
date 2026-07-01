# Dependency Update Policy

Eshyra accepts dependency updates through conservative, reviewable pull
requests. Dependency PRs should improve maintenance, security, or compatibility
without mixing in feature work, importer parser changes, or broad unrelated
package churn.

## Dependabot Configuration

Dependabot is configured in `.github/dependabot.yml` for:

- npm workspace dependencies rooted at `/`
- GitHub Actions used by `.github/workflows`

The npm configuration groups lower-risk tooling updates separately from
runtime-sensitive dependencies:

- `dev-tooling`: Biome, TypeScript, Vitest, `tsx`, and Node type packages
- `pdf-extraction-tooling`: `pdfjs-dist` (patch/minor only)
- `pdf-generation-tooling`: `pdfkit` and `@types/pdfkit` (patch/minor only)
- `model-provider-sdks`: Anthropic Claude Agent SDK packages
- `runtime-native-sensitive`: `better-sqlite3` and its type package

PDF tooling is split into two groups on purpose. `pdfjs-dist` is the PDF
extraction runtime the D&D SRD importer depends on directly, and its
semver-major releases remove or change extraction lifecycle APIs (for example
the 5.x → 6.x migration in PR #118). `pdfkit` / `@types/pdfkit` are PDF
*generation* tooling. Grouping them together would let a risky `pdfjs-dist`
major ride along with routine `pdfkit` updates, so they are kept separate and
restricted to patch/minor. Semver-major updates for `pdfjs-dist` and `pdfkit`
are ignored by Dependabot; a `pdfjs-dist` major must be opened as a dedicated
migration bead that re-validates importer extraction behavior, never as a
routine dependency PR.

`better-sqlite3` major updates are ignored by Dependabot. Open those manually
only as part of a Node runtime/native dependency decision, because the Node
engine range, CI runtime, and native prebuild availability must move together.
Semver-major updates for `@types/node`, `@biomejs/biome`, and `typescript` are
also ignored by Dependabot and must be opened manually or separately. These
updates can change the supported runtime contract, formatter/linter behavior,
or compiler diagnostics, so they should not be auto-grouped into routine
dependency PRs.

GitHub Actions updates are grouped into one PR so CI workflow changes can be
reviewed as a single operational surface.

## Review Rules

For every dependency PR:

- Confirm the PR changes only dependency metadata, lockfiles, workflow config,
  or narrowly related docs.
- Review the upstream changelog or release notes for breaking changes, security
  notes, engine changes, and install behavior changes.
- Run the normal local gates before merge: `npm run check`,
  `npm run typecheck`, and `npm run test`.
- Let CI prove the clean Linux install and cross-OS CLI install smoke jobs.
- Do not combine dependency updates with importer parser changes or feature
  work. File or claim a separate bead for follow-up code changes.

## Runtime And Native Dependency Rules

`better-sqlite3` is the only native/compiled dependency. It must remain aligned
with the supported Node runtime:

- Node 24 LTS is the supported runtime for this release line.
- Root and workspace `engines.node` ranges stay at `>=24 <25`.
- `@types/node` stays on 24.x while the engine range targets Node 24.
- CI runs on Node 24 and sets `npm_config_build_from_source=false`.
- The selected `better-sqlite3` line must provide prebuilt binaries for the
  supported CI and release platforms.

If an update causes `better-sqlite3` to fall back to `node-gyp` source
compilation in CI, treat that as a regression unless a bead explicitly changes
the runtime/native support policy. See
`docs/adr/0008-node-runtime-and-native-sqlite-support.md` and the header
comment in `.github/workflows/ci.yml` for the full rationale.

## Category-Specific Notes

Dev tooling updates are usually safe to review as a group, but TypeScript,
Vitest, and Biome can expose existing issues or change diagnostics. Keep
tooling fixes in the same dependency PR only when they are mechanical and
directly caused by the update.

Document/import tooling updates can affect PDF extraction shape. Run the
existing importer tests, but do not change importer parser behavior in the same
PR unless the dependency PR is explicitly scoped to that fix.

Model/provider SDK updates can change authentication, streaming, or response
types. Review provider SDK release notes and keep behavior changes behind the
provider adapter boundary.

GitHub Actions updates must preserve least-privilege permissions, Node 24
setup, npm caching, and the native install smoke checks.
