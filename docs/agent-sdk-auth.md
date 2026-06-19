# Running Eshyra on a Claude Pro/Max Plan

Eshyra can drive the Claude Agent SDK with **either** an Anthropic Console
API key **or** a **Claude Pro/Max subscription** OAuth token. Short version:

- **The Agent SDK supports subscription auth.** It wraps the Claude Code CLI,
  which natively authenticates with either an API key or a subscription OAuth
  token.
- **The Eshyra CLI supports both.** `loadConfig`
  (`packages/core/src/config.ts`) accepts `ANTHROPIC_API_KEY` **or**
  `CLAUDE_CODE_OAUTH_TOKEN`, and the CLI injects whichever one is in use through
  the `AgentSdkModelClient` auth seam — never both, so an API key cannot shadow
  a subscription token.

## How the Agent SDK authenticates

The `@anthropic-ai/claude-agent-sdk` package does not talk to the Anthropic API
directly — it spawns the Claude Code process, which resolves credentials. When
multiple credentials are present, Claude Code picks one in this order (highest
first):

1. Cloud provider creds — `CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX` /
   `CLAUDE_CODE_USE_FOUNDRY`
2. `ANTHROPIC_AUTH_TOKEN` (LLM-gateway bearer token)
3. `ANTHROPIC_API_KEY` (Anthropic Console API key)
4. `apiKeyHelper` script output
5. `CLAUDE_CODE_OAUTH_TOKEN` (long-lived subscription OAuth token)
6. Subscription OAuth credentials from interactive `claude` `/login`

The critical consequence: inside Claude Code, **`ANTHROPIC_API_KEY` outranks the
subscription token.** If an API key reaches the SDK process, it silently wins —
you bill API credits while believing you are on your subscription.

**Eshyra does not mirror that precedence for gameplay (eshyra-oobh).** Released
gameplay must never silently fall back to API billing, so `loadConfig` selects a
credential *explicitly*:

- Only `CLAUDE_CODE_OAUTH_TOKEN` set → `oauth-token`.
- Only `ANTHROPIC_API_KEY` set → `api-key`.
- **Both set, no `ESHYRA_AUTH_MODE`** → **fail fast** with a `ConfigError` asking
  you to choose. Eshyra will not guess which credential to bill.
- `ESHYRA_AUTH_MODE=oauth-token` / `=api-key` forces that mode (and errors if its
  credential is missing); `ESHYRA_AUTH_MODE=auto` is the default behaviour above.

Whichever mode is selected, the CLI injects only that one credential, and the
child SDK environment then **strips every other inherited provider credential**
(`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`) before
the SDK runs — so a stray API key in the shell cannot override the choice. The
primary DM and the mechanics auditor share the one resolved selection.

To run on the subscription with an API key also present, set
`ESHYRA_AUTH_MODE=oauth-token` (or simply leave `ANTHROPIC_API_KEY` unset).

## Subscription setup

Generate a long-lived OAuth token rather than relying on cached interactive
`/login` credentials:

```bash
# 1. Generate a one-year OAuth token (requires an active Pro/Max/Team/Enterprise
#    plan). Walks through browser OAuth and prints the token; it is NOT saved.
claude setup-token

# 2. Export the printed token where Eshyra runs.
export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
#    PowerShell: $env:CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-..."

# 3. Make sure no API key shadows it (see precedence above).
unset ANTHROPIC_API_KEY
#    PowerShell: Remove-Item Env:ANTHROPIC_API_KEY

# 4. Run Eshyra as usual.
eshyra play
```

Eshyra reads `CLAUDE_CODE_OAUTH_TOKEN` when `ANTHROPIC_API_KEY` is absent,
resolves `auth.mode = 'oauth-token'`, and injects only the OAuth token into the
SDK process.

Interactive `claude` `/login` is *not* sufficient on its own: `loadConfig`
requires an explicit `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` in the
environment, and does not read the cached `~/.claude/.credentials.json` that
`/login` writes. Use `claude setup-token` to mint a token Eshyra can see.

## Limitations and policy constraints

- **Monthly Agent SDK credit.** Starting **June 15, 2026**, subscription plans
  receive a monthly credit that covers Agent SDK usage and `claude -p`,
  separate from interactive limits (Pro $20, Max 5x $100, Max 20x $200, Team
  Standard $20, Team Premium $100; Enterprise varies). API-key Console accounts
  do **not** receive this credit. Beyond the credit, subscription rate limits
  apply — a long campaign can exhaust them.
- **No third-party "Log in with Claude" for hosted Eshyra.** Anthropic does
  not allow third-party developers to offer claude.ai login in products built on
  the Agent SDK without prior approval. A *self-hosted* user authenticating
  their *own* subscription locally is fine; a hosted Eshyra service letting
  end-users log in with their Claude.ai accounts is not, absent approval. Hosted
  BYOK remains governed by [ADR 0002](adr/0002-hosted-web-pwa-byok-deployment-path.md).
- **Token scope.** `CLAUDE_CODE_OAUTH_TOKEN` is inference-only and cannot
  establish Remote Control sessions; Claude Code "bare mode" does not read it.

## Status in Eshyra

| Path | Supported by Agent SDK | Supported by Eshyra CLI |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | **yes** |
| `CLAUDE_CODE_OAUTH_TOKEN` (Pro/Max) | yes | **yes** |
| Interactive `/login` subscription creds | yes | no — `loadConfig` needs an explicit env var |
| Cloud providers (Bedrock/Vertex/Foundry) | yes | no — no adapter wired |

`loadConfig` resolves a `ProviderAuth` (`mode: 'api-key' | 'oauth-token'`) via
explicit selection — one present credential is used, both-present fails fast
unless `ESHYRA_AUTH_MODE` chooses — and the CLI injects exactly that credential
through the Agent SDK auth seam. The child SDK env then strips every other
inherited credential, so an API key in the environment never shadows a chosen
subscription token.

## Sources

- [Use the Claude Agent SDK with your Claude plan — Claude Help Center](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Authentication — Claude Code Docs](https://code.claude.com/docs/en/authentication)
- [Use Claude Code with your Pro or Max plan — Claude Help Center](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)
