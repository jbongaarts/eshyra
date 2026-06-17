import type { AgentSdkAuth } from '../../src/model/agentSdkClient.js';

/**
 * Shared auth resolver for the live-API model integration tests.
 *
 * The live tests (`model.integration.test.ts`,
 * `campaignBibleFaithfulness.integration.test.ts`) make real Agent SDK calls,
 * so they only run when a provider credential is present. Eshyra accepts
 * either an Anthropic Console API key (`ANTHROPIC_API_KEY`) or a Claude Pro/Max
 * subscription OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`) — see
 * `docs/agent-sdk-auth.md`. This helper mirrors that production precedence for
 * the test gate: when both are set, `ANTHROPIC_API_KEY` wins.
 *
 * The resolved {@link AgentSdkAuth} carries exactly ONE credential variable so
 * a stray API key cannot shadow a chosen subscription token (Claude Code ranks
 * `ANTHROPIC_API_KEY` above `CLAUDE_CODE_OAUTH_TOKEN`). The secret value is held
 * only inside `auth.env` and is forwarded only into the SDK subprocess — this
 * helper never returns, logs, or otherwise exposes the token string. The
 * diagnostic `mode` is a non-secret label (`api-key` / `oauth-token`) safe to
 * print in skip reasons or failure messages.
 */

/** Default live model id when `ESHYRA_MODEL` is unset (Opus 4.8). */
export const DEFAULT_LIVE_MODEL = 'claude-opus-4-8';

/** Non-secret label describing which credential the live test selected. */
export type LiveModelAuthMode = 'api-key' | 'oauth-token';

/** Live auth is available — at least one provider credential is present. */
export interface LiveModelAuthAvailable {
  available: true;
  /** Diagnostic label only — never the token value. */
  mode: LiveModelAuthMode;
  /** Explicit auth to hand the `AgentSdkModelClient` constructor. */
  auth: AgentSdkAuth;
  /** Model id to drive: `ESHYRA_MODEL` override, else {@link DEFAULT_LIVE_MODEL}. */
  model: string;
}

/** No provider credential is present — the live test must skip. */
export interface LiveModelAuthUnavailable {
  available: false;
}

export type LiveModelAuth = LiveModelAuthAvailable | LiveModelAuthUnavailable;

/**
 * Resolve live-model auth from the environment.
 *
 * Considers the test runnable when either `ANTHROPIC_API_KEY` or
 * `CLAUDE_CODE_OAUTH_TOKEN` is present; prefers the API key when both are set,
 * matching documented Eshyra/Claude Code precedence. The returned object never
 * exposes the token outside of `auth.env`.
 */
export function resolveLiveModelAuth(
  env: Record<string, string | undefined> = process.env,
): LiveModelAuth {
  const model = env.ESHYRA_MODEL?.trim() || DEFAULT_LIVE_MODEL;

  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) {
    return {
      available: true,
      mode: 'api-key',
      auth: { env: { ANTHROPIC_API_KEY: apiKey } },
      model,
    };
  }

  const oauthToken = env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (oauthToken) {
    return {
      available: true,
      mode: 'oauth-token',
      auth: { env: { CLAUDE_CODE_OAUTH_TOKEN: oauthToken } },
      model,
    };
  }

  return { available: false };
}
