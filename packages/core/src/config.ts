import {
  type ConfiguredProfileEntry,
  ProfileConfigError,
  type ProfileRegistry,
  resolveProfileRegistry,
} from './model/profiles.js';

/**
 * Which provider credential the Agent SDK adapter authenticates with:
 * - `api-key`     — an Anthropic Console `ANTHROPIC_API_KEY`.
 * - `oauth-token` — a Claude Pro/Max subscription token in
 *                   `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`).
 */
export type ProviderAuthMode = 'api-key' | 'oauth-token';

/**
 * Default mechanics-audit model (eshyra-oobh): the cheapest/fastest current
 * Claude tier, appropriate for the bounded tool-use judgement the auditor makes.
 * Overridable via `ESHYRA_AUDIT_MODEL`. The auditor always uses the same provider
 * auth as the primary DM, so this must be entitled on that subscription/key.
 */
export const DEFAULT_AUDIT_MODEL = 'claude-haiku-4-5-20251001';

/** Resolved provider authentication for the Agent SDK adapter. */
export interface ProviderAuth {
  mode: ProviderAuthMode;
  /**
   * Environment variables to inject into the Agent SDK process — exactly the
   * one credential variable in use (`ANTHROPIC_API_KEY` for `api-key`,
   * `CLAUDE_CODE_OAUTH_TOKEN` for `oauth-token`), never both. Injecting only
   * one matters: in Claude Code's credential precedence `ANTHROPIC_API_KEY`
   * outranks `CLAUDE_CODE_OAUTH_TOKEN`, so a stray API key would otherwise
   * silently shadow a subscription token.
   */
  env: Record<string, string>;
}

export interface EshyraConfig {
  /**
   * Explicit campaign database path from `ESHYRA_DB_PATH`, or `undefined`
   * when it is unset. The CLI resolves the campaign to open from its
   * registry/picker (ADR 0004) when this is absent; only provider auth and the
   * model profile are mandatory here.
   */
  campaignDbPath?: string;
  /**
   * Resolved primary-DM model id. This is the `premium_dm` profile's model,
   * unless the legacy flat `ESHYRA_MODEL` override is set — that still
   * wins, for backward compatibility with the pre-registry flat config path.
   */
  model: string;
  /**
   * Model id for the mechanics-audit / turn-referee call (eshyra-oobh). A small,
   * fast model is appropriate — the audit is a bounded tool-use judgement, not
   * narration. Resolved from `ESHYRA_AUDIT_MODEL`, defaulting to
   * {@link DEFAULT_AUDIT_MODEL}. It runs under the SAME provider auth as the
   * primary DM (never independently API-billed), so it must be a model the
   * resolved subscription/credential is entitled to. Set `ESHYRA_AUDIT_MODEL` to
   * the primary model if a smaller model is not available on the subscription.
   */
  auditModel: string;
  /**
   * Resolved `premium_dm` profile entry (provider + model + tier) from the
   * profile registry, including any `ESHYRA_PROFILE_PREMIUM_DM_*` overrides.
   * Always a configured entry — `premium_dm` ships with a default provider+model.
   */
  dmProfile: ConfiguredProfileEntry;
  /**
   * Resolved provider authentication — an Anthropic Console API key or a
   * Claude Pro/Max subscription OAuth token.
   */
  auth: ProviderAuth;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Resolve provider auth from the environment. Accepts either an Anthropic
 * Console API key or a Claude Pro/Max subscription OAuth token. When both are
 * set the API key is authoritative, mirroring Claude Code's own credential
 * precedence (`ANTHROPIC_API_KEY` outranks `CLAUDE_CODE_OAUTH_TOKEN`).
 */
function resolveProviderAuth(
  env: Record<string, string | undefined>,
): ProviderAuth {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) {
    return { mode: 'api-key', env: { ANTHROPIC_API_KEY: apiKey } };
  }
  const oauthToken = env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (oauthToken) {
    return {
      mode: 'oauth-token',
      env: { CLAUDE_CODE_OAUTH_TOKEN: oauthToken },
    };
  }
  throw new ConfigError(
    'provider auth is required: set ANTHROPIC_API_KEY (an Anthropic Console ' +
      'API key) or CLAUDE_CODE_OAUTH_TOKEN (a Claude Pro/Max subscription ' +
      'token from `claude setup-token`)',
  );
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): EshyraConfig {
  // ESHYRA_DB_PATH is optional: when set it names an explicit campaign
  // database; when unset the CLI resolves the campaign from its registry.
  const campaignDbPath = env.ESHYRA_DB_PATH?.trim() || undefined;
  const auth = resolveProviderAuth(env);

  // The primary-DM model is resolved from the provider-neutral profile
  // registry. resolveProfileRegistry reports malformed profile overrides via
  // ProfileConfigError; surface those through the CLI's single ConfigError
  // channel so they reach formatConfigError like any other config failure.
  let registry: ProfileRegistry;
  try {
    registry = resolveProfileRegistry(env);
  } catch (err) {
    if (err instanceof ProfileConfigError) {
      throw new ConfigError(err.message);
    }
    throw err;
  }
  const dmRaw = registry.premium_dm;
  // premium_dm ships with a configured default; guard defensively in case
  // some future code path leaves it unconfigured.
  if (!dmRaw.configured) {
    throw new ConfigError(
      'internal: premium_dm profile was not configured — this should not happen',
    );
  }
  const dmProfile = dmRaw;

  // ESHYRA_MODEL is the legacy flat override and still wins when set;
  // otherwise the runtime DM model comes from the premium_dm profile entry
  // (its own ESHYRA_PROFILE_PREMIUM_DM_MODEL override, or the default).
  const model = env.ESHYRA_MODEL?.trim() || dmProfile.model;

  // The mechanics-audit model defaults to a fast tier and runs under the same
  // provider auth as the primary DM (eshyra-oobh).
  const auditModel = env.ESHYRA_AUDIT_MODEL?.trim() || DEFAULT_AUDIT_MODEL;

  // The CLI ships only the Claude Agent SDK adapter, so the resolved DM
  // profile must select the `anthropic` provider. A non-anthropic override
  // would otherwise be silently ignored.
  if (dmProfile.provider !== 'anthropic') {
    throw new ConfigError(
      `premium_dm profile resolves to provider '${dmProfile.provider}', but the CLI ships only the Anthropic (Claude Agent SDK) adapter. Unset ESHYRA_PROFILE_PREMIUM_DM_PROVIDER or set it to "anthropic".`,
    );
  }

  return { campaignDbPath, model, auditModel, dmProfile, auth };
}
