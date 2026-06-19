# Eshyra

**A text-first, persistent AI Dungeon Master for long-running fantasy campaigns.**

Eshyra is not a generic fantasy chatbot and not a virtual tabletop. It is a
campaign engine that preserves canon across many play sessions: it remembers
prior events, tracks structured game state, adjudicates rules through
deterministic tools, and sustains a tabletop-like solo or small-group
experience entirely through text.

It is built for two overlapping kinds of player:

- **Tabletop-seeking solo adventurers** who want D&D/TTRPG-style play when
  friends are unavailable or nobody wants to DM.
- **Living text-world nostalgists** who loved text adventures, MUDs, and BBS
  door games but wanted worlds that could understand actions the designer
  never pre-authored.

The promise: open-ended text adventure plus tabletop rules and consequences
plus persistent campaign memory. It should feel like a real DM inhabiting a
living world, not a video game missing its graphics.

> **Project status:** local CLI MVP. The repository now contains the
> provider-neutral core, SQLite persistence, module/world loading,
> multi-system rules packs (bundled D&D 5e SRD and Pathfinder 2e Remaster
> fixtures) with provider-neutral `lookup_rules`, deterministic tools, model
> orchestration, session launch/resume,
> graceful session close, and optional Dolt checkpoints. The CLI can create or
> resume a local campaign and run interactive model-backed turns, and manages
> campaigns through a per-user data root and registry (`ESHYRA_DB_PATH`
> still works as an explicit-path override). The CLI is distributed as
> self-contained, per-platform GitHub Release archives that bundle their own
> Node.js runtime — see [docs/install.md](docs/install.md).

## Why It's Built This Way

- **Text-first.** The MVP is pure text: narration, player input, dice/results,
  state tracking, campaign memory, summaries, checkpoints, and
  theater-of-the-mind combat. Structured UI panels, tactical abstractions, and
  VTT export come later; native VTT and native mobile are explicit non-goals
  for early scope.
- **CLI now, web later.** The current surface is CLI/local-friendly because it
  is the fastest route to the core game loop, local campaign state, and
  bring-your-own-key use. The likely public product is a hosted,
  mobile-friendly web app / PWA. The CLI remains supported as the local and
  power-user surface.
- **Provider-neutral core.** Model access is isolated behind provider adapters
  and capability-based model profiles such as `premium_dm`, `state_extractor`,
  and `summarizer`. The Claude Agent SDK is the initial adapter, not a hardcoded
  core assumption.
- **Premium quality floor.** The primary DM targets frontier-model quality
  (Opus 4.6+ / GPT-5.5-class or a future equivalent). Cheaper models are only
  for bounded auxiliary tasks that cannot corrupt canon. Eshyra targets a
  capability floor, not a price floor.
- **Separated knowledge.** Rules/mechanics, campaign/module content, live
  campaign state, user-private content, and generated memory are kept separate.
  Bundled/public content must be open-licensed, public domain, original, or
  publisher-licensed; fair use is not the permission model.

See [docs/architecture-report.md](docs/architecture-report.md) for the full
strategy,
[docs/adr/0001-product-model-deployment-content-strategy.md](docs/adr/0001-product-model-deployment-content-strategy.md)
for the product/model/content decision record, and
[docs/adr/0002-hosted-web-pwa-byok-deployment-path.md](docs/adr/0002-hosted-web-pwa-byok-deployment-path.md)
for the CLI-to-hosted deployment path, and
[docs/adr/0004-config-file-and-campaign-registry.md](docs/adr/0004-config-file-and-campaign-registry.md)
for the managed local storage decision. The local CLI release plan is in
[docs/cli-distribution.md](docs/cli-distribution.md).

## Repository Layout

Monorepo using npm workspaces:

| Package            | Path             | Role                                                    |
| ------------------ | ---------------- | ------------------------------------------------------- |
| `@eshyra/core` | `packages/core`  | UI-agnostic engine: config, models, tools, persistence  |
| `@eshyra/cli`  | `packages/cli`   | Thin CLI front end for local play and development       |

## Getting Started

### Prerequisites

- **Node.js 24 LTS is the supported runtime.** The package engines intentionally
  use `>=24 <25`, and the native `better-sqlite3` dependency is on 12.x for
  Node 24 prebuilt binary support. See
  [ADR 0008](docs/adr/0008-node-runtime-and-native-sqlite-support.md).
- **Provider credential.** Eshyra supports two ways to authenticate with
  Anthropic models — see [Supported Provider Modes](#supported-provider-modes)
  below.
- **Dolt optional.** Dolt is used only for local campaign checkpoints on
  graceful session close. Play still works without Dolt; the CLI reports that
  the session was closed without a checkpoint.

### Install The CLI

The CLI is distributed through **GitHub Releases** as a self-contained,
per-platform archive that **bundles its own Node.js runtime** -- there is
nothing to `npm install` and no system Node.js to set up.

**Linux, macOS, and WSL:**

```bash
curl -fsSL https://github.com/jbongaarts/eshyra/releases/latest/download/install.sh | sh
```

**Windows (PowerShell):**

```powershell
irm https://github.com/jbongaarts/eshyra/releases/latest/download/install.ps1 | iex
```

The installer detects your platform, downloads the matching archive, verifies
its SHA-256 checksum, installs to your local app directory, and puts `eshyra`
on your PATH. Running the CLI with no provider key set prints setup guidance.

See **[docs/install.md](docs/install.md)** for the full guide: supported
platforms (Linux x64/arm64 incl. WSL, macOS Apple Silicon, Windows x64),
version-pinned installs, updating, and uninstalling.

### Build From Source

```bash
npm install        # local install
npm run build      # tsc --build (incremental)
npm run typecheck  # tsc --build --force (full deterministic build)
npm run test       # vitest run
```

Use `npm ci` for clean CI-style installs and `npm run clean` before any proof
that needs fresh build output. Incremental TypeScript builds can otherwise
report "up to date" after `dist/` was deleted if `.tsbuildinfo` remains.

## Supported Provider Modes

Eshyra supports two ways to call the language model. They are separate provider
modes, not interchangeable auth variants (see
[ADR 0010](docs/adr/0010-api-native-vs-agent-harness-adapter-seam.md)).

### Claude Agent SDK — subscription-backed (default for released gameplay)

Uses the `@anthropic-ai/claude-agent-sdk` with an in-process MCP server.
Authentication can be an Anthropic Console API key **or** a Claude Pro/Max
subscription token (`CLAUDE_CODE_OAUTH_TOKEN`). The subscription path draws
from the monthly Agent SDK credit rather than per-token API billing, making
it the practical choice for sustained local development and play.

The SDK drives its own tool loop internally; Eshyra bridges in via an
in-process MCP server and an executor delegate. Fenced-text tool calls are
**not** a supported gameplay protocol — this path uses native MCP tools.

### Anthropic Messages API — API-key native

Uses `@anthropic-ai/sdk` to call the Anthropic Messages API directly.
Eshyra owns the full call lifecycle (prompt, tools, turn loop). This adapter
returns native `tool_use` blocks for the Eshyra turn loop to execute and is
the clean-architecture alternative for API-key-only deployments.

OpenAI and Codex SDK adapter support is planned; see follow-up beads.

## Configuration

The CLI reads provider credentials and model overrides from environment
variables. Campaigns normally live under Eshyra's per-user data root and
are selected through the managed registry. `.env.example` is a template, but
the CLI does not currently load `.env` files by itself.

Provider authentication: set **exactly one** credential before running
model-backed play. If both `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN`
are present, Eshyra fails fast and asks you to choose — it will not guess
which one to bill. Set `ESHYRA_AUTH_MODE=api-key` or `=oauth-token` to force
a specific mode when both are present. See
[docs/agent-sdk-auth.md](docs/agent-sdk-auth.md):

- `ANTHROPIC_API_KEY` - an Anthropic Console API key (API-billed per token).
- `CLAUDE_CODE_OAUTH_TOKEN` - a Claude Pro/Max subscription token, generated
  by `claude setup-token`. Lets the CLI run on a subscription credit instead
  of billing API tokens.

Optional:

- `ESHYRA_HOME` - explicit data-root directory for config, the campaign
  registry, managed campaign databases, rules packs, and the managed Dolt cache.
- `ESHYRA_MODEL` - legacy flat override for the primary-DM model id. When
  set it still takes precedence over the profile registry.
- `ESHYRA_PROFILE_*_PROVIDER` / `ESHYRA_PROFILE_*_MODEL` - per-profile
  provider/model overrides for the provider-neutral profile registry. The CLI
  runtime resolves its primary-DM model from the `premium_dm` profile entry, so
  `ESHYRA_PROFILE_PREMIUM_DM_MODEL` selects the DM model when
  `ESHYRA_MODEL` is unset. The resolved `premium_dm` provider must be
  `anthropic` — the only adapter the CLI ships today.
- `ESHYRA_DOLT_BIN` - explicit path to a Dolt binary for checkpoints.
- `ESHYRA_DOLT_HOME` - managed Dolt cache directory used by
  `eshyra dolt install`; defaults to `<data-root>/dolt`.
- `ESHYRA_DB_PATH` - advanced override for an explicit, unmanaged SQLite
  campaign database. When set, `eshyra play` opens that file directly and
  bypasses the managed campaign registry.

Installed CLI PowerShell example:

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
eshyra new "Emberfall Hollow"
eshyra campaigns list
eshyra play
```

## CLI Usage

After install, run the CLI with:

```bash
eshyra
```

This prints the core version and resolved config.

Start or resume a campaign:

```bash
eshyra new "Emberfall Hollow"
eshyra campaigns list
eshyra play
```

`new` creates a managed SQLite campaign database under the data root, forks the
bundled `EMBERFALL_HOLLOW` module into it, and records it in the registry.
`campaigns list` shows registered campaigns. `play` opens the only registered
campaign, prompts you to choose when several exist, or offers to create the
first one when the registry is empty. You can also pass a campaign id:
`eshyra play <id>`.

During play, each player input goes through the core turn orchestrator. Type
`/quit` or `/exit` to close and recap the session.

For scripted, CI, synced-folder, or other explicit-path workflows, set
`ESHYRA_DB_PATH`. In that mode `play` opens exactly that SQLite file as an
unmanaged campaign and bypasses the registry.

Install Dolt into the managed cache when you want local checkpoints and Dolt is
not already on `PATH`:

```bash
eshyra dolt install
```

Managed Dolt install is consent-based. Non-interactive shells decline
automatically so CI and automation cannot trigger an unattended binary
download.

When working directly from a repository checkout before package publication,
run `npm run build` and invoke the built entrypoint with
`node packages/cli/dist/index.js`.

## Storage Model

Local CLI storage is managed through a per-user data root and campaign
registry. See [docs/storage.md](docs/storage.md) and
[ADR 0004](docs/adr/0004-config-file-and-campaign-registry.md) for the full
user-facing storage boundary.

- **Static bundled content** lives in the package source/build output,
  including `EMBERFALL_HOLLOW` sample module data, SRD catalog data, and
  bundled rules packs (`DND5E_SRD_RULES_PACK`, `PATHFINDER2E_REMASTER_RULES_PACK`).
- **Managed user data** lives under the data root: `ESHYRA_HOME` when set,
  otherwise `%LOCALAPPDATA%\Eshyra` on Windows and `~/.eshyra` on
  macOS/Linux. The registry is `registry.json`; managed campaign databases live
  under `campaigns/`.
- **Live campaign state** lives in the SQLite file selected by the registry.
  `eshyra new` creates managed databases under `<root>/campaigns/`, while
  `eshyra campaigns add <path>` registers an existing external database.
  SQLite sidecar files such as `-wal`, `-shm`, or `-journal` may appear beside
  the database while it is open.
- **Explicit unmanaged campaigns** use `ESHYRA_DB_PATH`. When set, the CLI
  opens exactly that SQLite file and does not consult or update the registry.
- **Dolt checkpoints** live beside the selected database in
  `<dbPath>.checkpoints` when Dolt is available. Restore/fork commands
  materialize checkpoints into a new SQLite database path chosen by the caller.
- **Beads tracker data** is separate from campaign checkpoints. Checkpoint code
  guards against reusing the beads Dolt ref/remote.
- **Provider secrets** come from the local environment in the CLI release. They
  must not be written to campaign SQLite databases, Dolt checkpoints,
  `turn_trace`, exports, or logs. Hosted BYOK secret handling is governed by
  ADR 0002.

The managed Dolt binary cache defaults inside the data root, and bundled static
content lives in the npm package build output.

## Contributing

- **External code contributions are not accepted yet.** There is no contributor
  agreement in place under which outside contributions could be received. See
  [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/licensing.md](docs/licensing.md).
- Issue tracking uses **bd (beads)**, not GitHub issues or markdown TODO lists.
  Run `bd ready` to find available work and `bd prime` for the full workflow.
- Operational guidance for both humans and AI agents lives in
  [AGENTS.md](AGENTS.md). `CLAUDE.md` simply imports it.
- Dependency updates use the conservative policy in
  [docs/dependencies.md](docs/dependencies.md), including special handling for
  Node runtime and `better-sqlite3` compatibility.
- Bundled or publicly shared campaign/rules content must be open-licensed,
  public domain, original, or publisher-licensed.

## License

Eshyra is source-available and free for non-commercial use under the
**PolyForm Noncommercial License 1.0.0**. Commercial use requires separate
written permission or a separate commercial license. See [LICENSE](LICENSE) and
[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) for details.

Bundled rules/campaign content (e.g. the D&D 5e SRD, Pathfinder 2e Remaster
fixtures) is governed by its own upstream licenses and attribution requirements,
separate from the Eshyra source-code license. Third-party adventure or module
text must be confirmed open, public domain, original, or publisher-licensed
before bundling. See [docs/licensing.md](docs/licensing.md).
