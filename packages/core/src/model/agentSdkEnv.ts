/**
 * Child Agent SDK process environment construction (eshyra-oobh).
 *
 * The Agent SDK REPLACES the spawned process's environment when `options.env` is
 * set — it is not merged with the parent's. So an adapter that wants the child to
 * keep PATH/HOME must spread `process.env` itself. That spread is also the danger
 * point for provider auth: Claude Code ranks `ANTHROPIC_API_KEY` ABOVE
 * `CLAUDE_CODE_OAUTH_TOKEN`, so an ambient API key inherited from the parent would
 * silently shadow an explicitly selected subscription token and bill API tokens
 * instead of subscription usage.
 *
 * {@link buildChildSdkEnv} closes that hole: it strips EVERY provider credential
 * inherited from the parent, then applies exactly the one credential the caller
 * resolved. Auth is therefore explicit and mutually exclusive — there is no path
 * by which an unselected credential reaches the child.
 */

/**
 * Provider-credential environment variables that must never co-exist in a child
 * Agent SDK call. All three are stripped from the inherited environment before
 * the selected credential is applied, so none can shadow another.
 */
export const PROVIDER_CREDENTIAL_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
] as const;

/**
 * Build the environment for a child Agent SDK process under an EXPLICIT,
 * mutually exclusive provider credential.
 *
 * Order is load-bearing: spread `process.env` (to keep PATH/HOME/...), strip ALL
 * provider credentials inherited from the parent, apply any `extra` non-secret
 * vars, then apply exactly the selected `authEnv` credential last so it cannot be
 * shadowed. `authEnv` must contain a single credential variable (the config layer
 * guarantees this).
 *
 * @param authEnv The one resolved credential, e.g. `{ CLAUDE_CODE_OAUTH_TOKEN }`.
 * @param extra   Non-secret child env additions (e.g. `ENABLE_TOOL_SEARCH`).
 */
export function buildChildSdkEnv(
  authEnv: Record<string, string>,
  extra?: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  // Strip every inherited provider credential BEFORE applying the selected one,
  // so an ambient ANTHROPIC_API_KEY cannot outrank a chosen subscription token.
  for (const key of PROVIDER_CREDENTIAL_VARS) {
    delete env[key];
  }
  if (extra) {
    Object.assign(env, extra);
  }
  Object.assign(env, authEnv);
  return env;
}

/**
 * Spread `process.env` plus optional non-secret extras, WITHOUT touching provider
 * credentials. For the ambient-auth path (no explicit credential selected), where
 * the caller intentionally relies on whatever credential the parent environment
 * already carries.
 */
export function buildAmbientSdkEnv(
  extra?: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  if (extra) {
    Object.assign(env, extra);
  }
  return env;
}
