/**
 * Sterile Codex CLI process environment construction (eshyra-jl8n).
 *
 * The Codex SDK spawns the `codex` CLI as a subprocess. When `CodexOptions.env`
 * is provided the SDK does NOT inherit `process.env` for the child — it uses
 * exactly the environment given (then layers its own required variables on top).
 * So an adapter that wants the child to keep PATH/HOME/CODEX_HOME must spread
 * `process.env` itself.
 *
 * That spread is the danger point for billing. Codex authenticates released
 * gameplay from a ChatGPT/Codex **subscription** login (stored under
 * `CODEX_HOME`, default `~/.codex`). If an `OPENAI_API_KEY` (or `CODEX_API_KEY`)
 * reaches the CLI it can silently switch to **API billing** instead of the
 * subscription. ADR 0010 forbids that silent fallback, so {@link
 * buildSterileCodexEnv} strips every OpenAI/Codex API credential inherited from
 * the parent before the CLI runs. The subscription login under `CODEX_HOME` is
 * preserved (it is not an env credential), so this never breaks subscription
 * auth — it only removes the API-billing path.
 *
 * The bearer token that authorizes the in-process MCP HTTP server (see
 * `codexMcpHttpServer.ts`) is injected here under a fixed env var so the Codex
 * config can reference it via `mcp_servers.eshyra.bearer_token_env_var`.
 */

/**
 * Env var the Codex config's `mcp_servers.eshyra.bearer_token_env_var` points
 * at. Codex reads it from the CLI process environment and sends its value as the
 * `Authorization: Bearer <token>` header on every MCP HTTP request, which the
 * in-process Eshyra MCP server validates.
 */
export const ESHYRA_MCP_TOKEN_VAR = 'ESHYRA_MCP_TOKEN';

/**
 * Stable MCP server name. Tools surface to Codex as `eshyra/<tool>`. Lives in
 * this zero-heavy-dependency module so both the adapter client and the HTTP
 * server module can share it without the client statically importing the MCP
 * SDK (which must stay lazily loaded for editions that omit Codex).
 */
export const ESHYRA_MCP_SERVER_NAME = 'eshyra';

/**
 * OpenAI/Codex API-credential environment variables that must never reach the
 * Codex CLI for subscription gameplay. Stripping them makes API billing
 * unreachable, so a subscription turn cannot silently fall back to it
 * (ADR 0010). `CODEX_HOME` is intentionally NOT in this list — it locates the
 * subscription login and must survive.
 */
export const OPENAI_CREDENTIAL_VARS = [
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'OPENAI_BASE_URL',
] as const;

/**
 * Build the environment for the spawned Codex CLI under subscription auth.
 *
 * Order is load-bearing: spread `process.env` (to keep PATH/HOME/CODEX_HOME),
 * strip every OpenAI/Codex API credential inherited from the parent, apply any
 * non-secret `extra` vars, then inject the MCP bearer token last under
 * {@link ESHYRA_MCP_TOKEN_VAR}.
 *
 * @param mcpBearerToken Per-call token the Eshyra MCP HTTP server will require.
 * @param extra          Non-secret child env additions.
 */
export function buildSterileCodexEnv(
  mcpBearerToken: string,
  extra?: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  // Remove the API-billing path BEFORE injecting anything else so no inherited
  // OPENAI_API_KEY can outrank the subscription login.
  for (const key of OPENAI_CREDENTIAL_VARS) {
    delete env[key];
  }
  if (extra) {
    Object.assign(env, extra);
  }
  env[ESHYRA_MCP_TOKEN_VAR] = mcpBearerToken;
  return env;
}
