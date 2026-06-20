import { ModelClientError } from './client.js';

/**
 * Lazy loader for the Claude Agent SDK (eshyra-ern3).
 *
 * The Claude Agent SDK ships a large per-platform CLI binary and is gated by the
 * installer-edition packaging (ADR 0011): the `api` and `codex` editions prune
 * it out. So importing `@anthropic-ai/claude-agent-sdk` at module scope would
 * make the `@eshyra/core` barrel — and therefore the CLI's no-config startup —
 * fail to load in those editions, even when the user never selects the Claude
 * provider. The Claude adapter modules therefore import only TYPES from the SDK
 * (erased at compile time) and call this loader to obtain the runtime surface on
 * the first `complete()` of a Claude turn.
 *
 * When the package is genuinely absent (a non-Claude edition that nonetheless
 * tries to drive a Claude turn), this surfaces a clear, actionable
 * {@link ModelClientError} instead of a raw module-resolution stack — mirroring
 * the Codex adapter's missing-SDK behavior.
 */

/** Runtime surface the Claude adapters use from the Agent SDK. */
export interface AgentSdkRuntime {
  query: typeof import('@anthropic-ai/claude-agent-sdk').query;
  tool: typeof import('@anthropic-ai/claude-agent-sdk').tool;
  createSdkMcpServer: typeof import('@anthropic-ai/claude-agent-sdk').createSdkMcpServer;
}

/**
 * True when an error is a genuine module-resolution failure for the Claude Agent
 * SDK (the package is not installed in this edition). Matched narrowly on the
 * Node resolution error code or a "cannot find module/package" message — NOT on
 * any text mentioning the package name, so an unrelated error thrown from inside
 * a loaded SDK (or a test mock's export-validation message) is not misreported
 * as "not installed".
 */
export function isMissingAgentSdk(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /cannot find (module|package)/i.test(msg) &&
    msg.includes('@anthropic-ai/claude-agent-sdk')
  );
}

/**
 * Dynamically import the Claude Agent SDK runtime surface. Throws a clear
 * {@link ModelClientError} if the package is not installed in this edition.
 */
export async function loadAgentSdk(): Promise<AgentSdkRuntime> {
  try {
    const mod = await import('@anthropic-ai/claude-agent-sdk');
    return {
      query: mod.query,
      tool: mod.tool,
      createSdkMcpServer: mod.createSdkMcpServer,
    };
  } catch (err) {
    if (isMissingAgentSdk(err)) {
      throw new ModelClientError(
        'The Claude Agent SDK (@anthropic-ai/claude-agent-sdk) is not installed ' +
          'in this edition. Install the "claude" or "full" edition to use the ' +
          'Claude provider.',
      );
    }
    throw err;
  }
}
