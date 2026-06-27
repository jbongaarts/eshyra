# Eshyra

**A text-first, persistent AI Dungeon Master for long-running fantasy
campaigns.**

[Website](https://eshyra.app)

Eshyra is a local campaign engine for open-ended fantasy roleplaying through
text. It preserves campaign canon across sessions, stores structured game
state in SQLite, adjudicates dice and state changes through deterministic
tools, and uses a frontier model as the Dungeon Master instead of treating the
model as an unbounded fantasy chatbot.

It is not a virtual tabletop and not a general-purpose story bot. The current
product is a local CLI for solo or small-group campaign play; the core is kept
UI-agnostic so a hosted web/PWA surface can be built later without rewriting
the engine.

## Current Status

Eshyra is pre-1.0 local CLI software. The repository currently includes:

- `@eshyra/core`: provider-neutral campaign orchestration, model adapters,
  deterministic tools, SQLite persistence, optional Dolt checkpoints, rules
  lookup, character creation, memory/recap handling, and adventure/module
  context assembly.
- `@eshyra/cli`: the local command-line front end for creating, resuming,
  inspecting, checkpointing, and playing campaigns.
- A bundled starter adventure, **The Hollow Beneath Emberfall**.
- A generated, audited D&D 5e SRD 5.1 rules pack under
  `packages/core/data/rules-packs/`.
- A small Pathfinder 2e Remaster fixture used for early rules-system coverage.
- Four gameplay providers: Claude subscription, Codex subscription, Anthropic
  API, and OpenAI API.

Eshyra is distributed through GitHub Releases as self-contained CLI archives
that bundle their own Node.js runtime. The npm packages are private and are not
the current end-user distribution channel.

## Install

Use the one-line installer from the latest GitHub Release. It downloads the
right archive for your platform, verifies checksums, installs the CLI, and
places `eshyra` on your `PATH`.

Linux, macOS, and WSL:

```bash
curl -fsSL https://github.com/jbongaarts/eshyra/releases/latest/download/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://github.com/jbongaarts/eshyra/releases/latest/download/install.ps1 | iex
```

The default edition is `claude`, for Claude Pro/Max subscription-backed play.
To install a different edition:

```bash
curl -fsSL https://github.com/jbongaarts/eshyra/releases/latest/download/install.sh | sh -s -- --edition codex
```

```powershell
$env:ESHYRA_EDITION = 'codex'
irm https://github.com/jbongaarts/eshyra/releases/latest/download/install.ps1 | iex
```

Available editions:

| Edition | Bundles | Use when |
| --- | --- | --- |
| `api` | API-native dependencies only | You play with API keys only |
| `claude` | Claude Agent SDK / Claude Code binary | You play with a Claude Pro/Max subscription |
| `codex` | Codex SDK / Codex binary | You play with a ChatGPT/Codex subscription |
| `full` | Both agent-harness providers | You use both subscriptions on one machine |

See [docs/install.md](docs/install.md) for supported platforms, pinned
versions, updating, uninstalling, and manual archive installs. See
[docs/cli-distribution.md](docs/cli-distribution.md) for the release artifact
strategy.

## First Run

Set up exactly one gameplay provider, then create and play a campaign.

Claude subscription:

```bash
claude setup-token
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-..."
eshyra new "Emberfall Hollow"
eshyra play
```

Anthropic API key:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
eshyra new "Emberfall Hollow"
eshyra play
```

OpenAI API key:

```bash
export OPENAI_API_KEY="sk-..."
export ESHYRA_AUTH_MODE=openai-api
eshyra new "Emberfall Hollow"
eshyra play
```

Codex subscription:

```bash
codex login
export ESHYRA_AUTH_MODE=codex-sub
eshyra new "Emberfall Hollow"
eshyra play
```

If more than one provider is available, Eshyra fails fast and asks you to set
`ESHYRA_AUTH_MODE` instead of guessing which account or subscription to bill.
Provider setup and billing boundaries are documented in
[docs/agent-sdk-auth.md](docs/agent-sdk-auth.md).

## CLI Overview

Common commands:

```bash
eshyra                          # banner and resolved configuration
eshyra new "Campaign Name"      # create a managed campaign database
eshyra campaigns list           # list registered campaigns
eshyra play [campaign-id]       # play or resume a campaign
eshyra demo                     # start the bounded public demo campaign
eshyra adventures [campaign-id] # inspect adventure/module state
eshyra usage [--timeline]       # inspect local model/tool usage diagnostics
eshyra dolt install             # install optional managed Dolt binary
eshyra checkpoint list [id]     # list Dolt checkpoints for a campaign
```

During play, type `/quit` or `/exit` to close the session gracefully. When Dolt
is available, graceful close writes a checkpoint beside the campaign database;
without Dolt, play still works and closes without checkpoint history.

## Configuration

The installed CLI stores non-secret local data under a per-user data root:

- `ESHYRA_HOME`, when set.
- Otherwise `%LOCALAPPDATA%\Eshyra` on Windows.
- Otherwise `~/.eshyra` on macOS and Linux.

The data root contains the non-secret `config.json`, campaign registry,
managed campaign databases, installed rules/adventure modules, diagnostics,
and the managed Dolt cache. Provider credentials always come from the
environment or provider login state; they are rejected from `config.json`.

Useful environment variables:

| Variable | Purpose |
| --- | --- |
| `ESHYRA_AUTH_MODE` | Force `claude-sub`, `codex-sub`, `anthropic-api`, `openai-api`, or `auto` |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Pro/Max token from `claude setup-token` |
| `ANTHROPIC_API_KEY` | Anthropic Console API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `CODEX_HOME` | Alternate Codex login directory for `codex-sub` detection |
| `ESHYRA_MODEL` | Override the primary DM model for the selected provider |
| `ESHYRA_AUDIT_MODEL` | Override the mechanics-auditor model for the same provider |
| `ESHYRA_DB_PATH` | Open one explicit unmanaged SQLite campaign database |
| `ESHYRA_DOLT_BIN` | Explicit Dolt binary path |
| `ESHYRA_DOLT_HOME` | Managed Dolt cache directory |
| `ESHYRA_DEBUG_SESSION` | Opt in to structural or full session debug logs |

See [docs/storage.md](docs/storage.md) for the storage model,
`config.json`, schema migration expectations, and checkpoint layout. See
[docs/session-debug-logging.md](docs/session-debug-logging.md) for debug log
capture modes.

## Development

Prerequisites for repository work:

- Node.js 24 LTS (`>=24 <25`).
- npm.
- A C++ toolchain only if `better-sqlite3` cannot use its Node 24 prebuild.
- Dolt is optional; Dolt-gated tests skip when the binary is absent.

Install and verify from a checkout:

```bash
npm install
npm run build
npm run typecheck
npm run test
npm run check
```

Use `npm ci` for clean CI-style installs. Use `npm run clean` before any proof
that requires fresh TypeScript build output; deleting only `dist/` can leave
stale `.tsbuildinfo` and create false positives.

Run the built CLI from source:

```bash
npm run build
node packages/cli/dist/index.js
```

The monorepo has two workspaces:

| Package | Path | Role |
| --- | --- | --- |
| `@eshyra/core` | `packages/core` | UI-agnostic engine, persistence, rules, tools, model orchestration |
| `@eshyra/cli` | `packages/cli` | Local CLI front end |

See [AGENTS.md](AGENTS.md) for repository workflow, quality gates, Beads issue
tracking, and PR rules. Dependency updates follow
[docs/dependencies.md](docs/dependencies.md).

## Architecture

Eshyra keeps these concerns separate:

- rules/mechanics and deterministic tool execution;
- authored campaign templates and adventure modules;
- live campaign state and player-specific changes;
- campaign overlay lore promoted during play;
- generated memory, recaps, traces, and diagnostics;
- provider adapters and model capability profiles.

The full design rationale is in
[docs/architecture-report.md](docs/architecture-report.md). Key decisions are
captured in:

- [ADR 0001](docs/adr/0001-product-model-deployment-content-strategy.md):
  product, model, deployment, and content strategy.
- [ADR 0002](docs/adr/0002-hosted-web-pwa-byok-deployment-path.md):
  hosted web/PWA and bring-your-own-key direction.
- [ADR 0004](docs/adr/0004-config-file-and-campaign-registry.md):
  local config file and campaign registry.
- [ADR 0010](docs/adr/0010-api-native-vs-agent-harness-adapter-seam.md):
  API-native versus agent-harness model adapters.
- [ADR 0011](docs/adr/0011-multi-provider-installer-editions.md):
  multi-provider release editions.
- [ADR 0012](docs/adr/0012-rules-pack-campaign-template-adventure-module-campaign-instance.md):
  rules packs, campaign templates, adventure modules, and campaign instances.
- [ADR 0014](docs/adr/0014-campaign-overlay-canon.md):
  durable campaign overlay lore.

## Contributing

External code contributions are not accepted yet because there is no
contributor agreement or inbound license arrangement. Non-code feedback is
welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

Internal work uses [bd/beads](https://github.com/gastownhall/beads) for task
tracking, not GitHub issues or markdown TODO lists. Run `bd prime` inside the
repository for the current workflow.

Bundled or publicly shared campaign/rules content must be open-licensed,
public domain, original, or publisher-licensed. Fair use is not the content
permission model.

## License

Eshyra source code is source-available and free for non-commercial use under
the **PolyForm Noncommercial License 1.0.0**. Commercial use requires separate
written permission or a commercial license. See [LICENSE](LICENSE) and
[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

Bundled rules and campaign content carry their own upstream licenses and
attribution requirements, separate from the Eshyra source-code license. See
[docs/licensing.md](docs/licensing.md).
