# Codex SDK MCP Subscription Gameplay Adapter

`CodexSdkMcpModelClient` (`packages/core/src/model/codexSdkMcpClient.ts`) is the
OpenAI/Codex sibling of the Claude Agent SDK MCP adapter
(`docs/agent-sdk-auth.md`, [ADR 0010](adr/0010-api-native-vs-agent-harness-adapter-seam.md)).
It is a **second subscription-backed gameplay provider** (bead `eshyra-jl8n`,
epic `eshyra-dcln`) so development and gameplay cost can be spread across two
subscriptions.

It sits in the **agent-harness** adapter family: the Codex SDK
(`@openai/codex-sdk`) wraps the `codex` CLI and owns its own agentic loop, and
Eshyra tools are forwarded over **MCP**, never fenced text.

## How tools reach Codex without leaving the turn process

The Claude Agent SDK offers an *in-process* MCP server (`createSdkMcpServer`), so
its tool handlers run in the same process — and the same live, SAVEPOINT-wrapped
turn transaction — as the deterministic Eshyra executor. Codex has no in-process
option: the `codex` CLI connects to MCP servers as stdio subprocesses or over
**Streamable HTTP**.

To keep tool execution in the parent process, the adapter hosts an **in-process
Streamable-HTTP MCP server bound to `127.0.0.1`** on an ephemeral port
(`codexMcpHttpServer.ts`) and points Codex at it via
`mcp_servers.eshyra.url`. The Codex CLI is the MCP *client*; the tool handlers
run in the parent and delegate to the `ModelCompleteInput.executeTool` bridge —
exactly the provider-executed-call pattern the Claude adapter uses. The adapter
never reimplements gameplay semantics. `complete()` returns the final narration
plus the `executedToolCalls` Codex ran, for the transcript.

Access control: the loopback server requires a fresh per-call 256-bit bearer
token, passed to Codex through `mcp_servers.eshyra.bearer_token_env_var`
(`ESHYRA_MCP_TOKEN`). Requests without the exact token get a 401. The server is
torn down in a `finally` at the end of each `complete()`.

## Subscription auth — no silent API-key fallback

Released Codex gameplay authenticates from a **ChatGPT/Codex subscription**
login stored under `CODEX_HOME` (default `~/.codex`). ADR 0010 forbids a silent
fallback to API billing, so `codexEnv.ts` strips `OPENAI_API_KEY`,
`CODEX_API_KEY`, and `OPENAI_BASE_URL` from the spawned CLI environment. The
subscription login under `CODEX_HOME` is preserved (it is not an env
credential), so this only removes the API-billing path; it never injects an API
key. An auth failure is reported clearly (run `codex login`) and is **not**
retried against an API key.

## Sterile harness

Each turn runs:

- in a throwaway temp working directory (`os.tmpdir()`/`eshyra-codex-*`), **not**
  the Eshyra repo, removed in a `finally`;
- with `sandbox_mode = read-only`, `networkAccessEnabled = false`,
  `webSearchEnabled = false`, `approvalPolicy = never`;
- with `project_doc_max_bytes = 0`, so no `AGENTS.md` / project instructions load
  into the gameplay context;
- with only the `eshyra` MCP server configured — no other tools.

## Debug records

Every `complete()` emits one structural `ModelCallDebugEvent` when a debug sink
is wired (`docs/session-debug-logging.md`):

- `toolProtocolMode = "codex-mcp"` (never `fenced-text`);
- `clientName = "codex-sdk"`;
- `forwardedToolNames` = `mcp__eshyra__<tool>` (matching the Claude adapter's
  convention so cross-provider diagnostics read the same);
- `authMode` defaults to `codex-subscription`;
- `mcpServers` = `[{ name: "eshyra", status: "connected" }]` once the turn
  completes.

## Editions / dependency

`@openai/codex-sdk` and `@modelcontextprotocol/sdk` are **optional
dependencies** and are imported lazily, so `@eshyra/core` still loads in
installer editions that omit the Codex CLI binary. When the SDK is absent the
adapter throws a clear `ModelClientError` telling the user to install the
`codex` or `full` edition. See the installer-editions ADR for how the Codex
binary is packaged.

## Live-validation caveats (confirm when Codex usage is available)

The adapter's offline unit tests mock the Codex SDK, so the CLI config surface
is built from the published config reference
(`developers.openai.com/codex/config-reference`) and
`@openai/codex-sdk@0.141.0` types. Two config keys are the most likely to drift
across `codex` releases and **must** be confirmed with the manual smoke test:

- `experimental_use_rmcp_client = true` — enables the Streamable-HTTP MCP client
  for `url`-based servers. If a future `codex` ships HTTP MCP as the default (or
  renames the flag), update `ENABLE_RMCP_CLIENT` / `#buildCodexConfig`.
- `project_doc_max_bytes = 0` — the AGENTS.md suppression key.

### Manual smoke test

Run once Codex subscription usage is available (the epic is queued behind Codex
weekly-limit availability). From a checkout with the `codex`/`full` edition
dependencies installed:

```bash
# 1. Authenticate the Codex subscription (writes the login under CODEX_HOME).
codex login

# 2. Make sure no API key can shadow the subscription (the adapter also strips
#    these, but prove the environment first).
unset OPENAI_API_KEY CODEX_API_KEY

# 3. Drive one gameplay turn that REQUIRES a d20 roll, with debug logging on, so
#    you can confirm Codex invoked the eshyra MCP `roll` tool.
ESHYRA_DEBUG=1 \
ESHYRA_PROFILE_PREMIUM_DM_PROVIDER=openai \
ESHYRA_PROFILE_PREMIUM_DM_MODEL=gpt-5-codex \
  eshyra play
```

Confirm in the debug log that the model call shows `toolProtocolMode:
"codex-mcp"` (not `fenced-text`), that `mcp__eshyra__roll` appears in
`forwardedToolNames`, and that an executed `roll` tool call is recorded for the
turn. Confirm no `AGENTS.md` content appears in the prompt context and that a
forced auth failure (e.g. logging out) is reported without any API-key retry.

> CLI/config provider selection for `openai` is wired in a follow-up bead — see
> `eshyra-jl8n`'s follow-ups. Until then, instantiate `CodexSdkMcpModelClient`
> directly (as the unit tests do) to exercise the adapter.
