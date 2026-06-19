# ADR 0010: API-native vs Agent-harness Model Adapter Seam

- **Status:** Accepted
- **Date:** 2026-06-18
- **Bead:** eshyra-ckrg

## Context

Eshyra must support two fundamentally different ways of calling a language model.

**API-native adapters** talk to a provider's REST API directly (e.g. the Anthropic Messages API via `@anthropic-ai/sdk`). Eshyra owns the entire call lifecycle: prompt assembly, tool declaration, tool call parsing, tool execution, turn management, replay, and diagnostics. The provider is a stateless function from prompt + tools → completion.

**Agent-harness adapters** run an SDK that owns its own agentic loop (e.g. the Claude Agent SDK). The SDK manages its own tool dispatch, model retries, and conversation flow internally. Eshyra bridges into the harness's tool execution points rather than driving the loop directly.

The two families have different tradeoffs. API-native is architecturally cleaner: every observable behaviour (retry policy, tool execution order, stop conditions) is deterministic and owned by Eshyra. Agent-harness is more affordable: the Claude Agent SDK can authenticate with a Claude Pro/Max subscription OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`) and consume from the monthly Agent SDK credit rather than billing API tokens, making it the only practical path for sustained local development and released gameplay today.

### The fenced-text anti-pattern

Before the in-process MCP path was implemented, an earlier `AgentSdkModelClient` attempted gameplay by describing tool calls in the system prompt as fenced JSON blocks (`tool_call { … }`), relying on the model to produce them voluntarily. This is not a supported protocol: the underlying model explicitly has no tools, it can report that truthfully, and the fenced-text output is fragile under model updates. Fenced-text is retained in the codebase solely as a historical adapter for research/non-tool use; it is not a supported gameplay fallback.

## Decision

### 1. Maintain separate adapter families

API-native and agent-harness adapters are separate provider modes, not interchangeable auth variants hidden behind one class. The `ModelClient` interface is the only shared surface.

Metadata types (`ModelAdapterCapabilities`) make the adapter family, tool transport, and turn-loop ownership explicit at the class level. Every concrete adapter declares a `capabilities` property so callers can inspect these properties programmatically.

Currently implemented adapters:

| Adapter | Family | Tool transport | Turn loop | Gameplay-capable |
|---|---|---|---|---|
| `AgentSdkMcpModelClient` | agent-harness | `agent-mcp` | provider-harness | yes |
| `AnthropicNativeModelClient` | api-native | `api-native` | eshyra | yes |
| `AgentSdkModelClient` | agent-harness | `fenced-text` | provider-harness | **no** |

### 2. A provider is gameplay-capable only if it can forward tools natively

A provider is supported for gameplay only if its adapter can expose Eshyra tools through native API tools or harness-supported MCP/native tools. Fenced-text tool calls are not a supported gameplay protocol.

`AgentSdkModelClient` (fenced-text) signals this by setting `capabilities.gameplayCapable = false` and by throwing a `ModelClientError` at `complete()` time when tools are provided, so a misconfiguration is loud rather than silent.

Enforcement happens at two layers (eshyra-qa9d):

- **Startup gate.** `assertGameplayCapable(capabilities, role)` is called when the gameplay deps are wired (the CLI asserts both the primary DM and the mechanics auditor before play begins). A non-gameplay-capable adapter throws `UnsupportedGameplayProviderError` with an actionable message *before* the first turn — gameplay never starts with tools that are described but not transported.
- **Prompt default.** The core owns provider-neutral tool *semantics*; the adapter owns provider-native *transport*. `buildSystemPrompt` therefore defaults to the `native` protocol: it instructs the model to use its native tool interface and explicitly NOT to emit fenced ```tool_call blocks. The `fenced` protocol is opt-in and exists only for the deterministic offline test harness; no released gameplay path selects it.

### 3. Agent-harness adapters use the in-process MCP path

The `AgentSdkMcpModelClient` is the reference implementation for agent-harness adapters. It exposes Eshyra tools through the SDK's supported in-process MCP server channel (`createSdkMcpServer` + `tool()`), pre-approves the generated `mcp__eshyra__*` tool names, and delegates tool execution to the deterministic Eshyra executor via the `ModelCompleteInput.executeTool` bridge. The adapter never reimplements gameplay semantics.

### 4. Auth mode is explicit and mutually exclusive

Subscription-backed adapters must not silently inherit or prefer API keys when a subscription/OAuth path is selected. `loadConfig` selects a credential explicitly:

- Exactly one credential present → use it.
- Both `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` present, no `ESHYRA_AUTH_MODE` → fail fast (never guess which to bill).
- `ESHYRA_AUTH_MODE=api-key` or `=oauth-token` → force that mode, fail if missing.

The CLI injects exactly the selected credential into the adapter. For agent-harness adapters, `buildChildSdkEnv` strips every other inherited provider credential from the SDK subprocess environment so an ambient `ANTHROPIC_API_KEY` cannot shadow a chosen subscription token (Claude Code ranks API keys above OAuth tokens).

### 5. Subscription gameplay calls stay on the subscription-backed adapter

Subscription-backed gameplay calls — primary DM turns, mechanics auditor calls, retries, recap summaries — all use the same resolved auth and the same adapter family. There is no separate API-billed path for auditor or retry work. Both the primary `AgentSdkMcpModelClient` and the auditor's `AgentSdkMcpModelClient` receive the same `auth` object from `buildPlayDeps`.

### 6. Accepted cost/testing tradeoff

API-key usage is likely too expensive for day-to-day development and sustained gameplay. Subscription-backed adapters will therefore be exercised far more frequently than API-native adapters. The codebase reduces risk through:

- A clear `ModelClient` abstraction that keeps gameplay provider-neutral.
- Explicit `ModelAdapterCapabilities` declarations.
- Deterministic offline unit tests for both adapter families (provider SDKs are mocked).
- Structural debug logs that record `toolProtocolMode`, `authMode`, `profile`, `tier`, and forwarded tool names for every model call.
- The `trace.purpose` field to distinguish primary DM calls (`turn_model_loop`), auditor calls (`turn_audit`), and summary/recap calls.

We do not require live API-key smoke tests as a merge gate. Subscription-backed live tests can run when `CLAUDE_CODE_OAUTH_TOKEN` is present.

## Consequences

- **Positive:** The adapter seam is explicit and inspectable. Silent tool-forwarding failures are caught at `complete()` time.
- **Positive:** Subscription users need no Console API key for local gameplay.
- **Positive:** Debug logs make every model call reconstructable across adapter families.
- **Neutral:** `AnthropicNativeModelClient` exists and is tested offline but is not the default gameplay adapter. It is the correct choice for API-key-only deployments and for future hosted BYOK.
- **Risk:** API-native adapters (`AnthropicNativeModelClient`) are exercised less frequently in development. Mitigated by unit tests and the shared `ModelClient` interface; live integration tests can run with `ANTHROPIC_API_KEY`.
- **Out of scope:** OpenAI API-native adapter, Codex SDK MCP subscription adapter (see follow-up beads).

## Related decisions

- [ADR 0001](0001-product-model-deployment-content-strategy.md) — Provider-neutral core architecture
- [ADR 0002](0002-hosted-web-pwa-byok-deployment-path.md) — BYOK hosted deployment path
- `docs/agent-sdk-auth.md` — Auth mode configuration and credential precedence
