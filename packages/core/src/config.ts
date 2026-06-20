import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  type ConfiguredProfileEntry,
  ProfileConfigError,
  type ProfileRegistry,
  resolveProfileRegistry,
} from './model/profiles.js';

/**
 * The four discrete gameplay providers (eshyra-6ygw). Provider and auth are not
 * separate axes: the agent-harness adapters exist precisely to enable
 * subscription auth, so each provider is one (vendor × auth) pair that maps 1:1
 * to a concrete model adapter (ADR 0010):
 *
 * - `claude-sub`    — Claude Pro/Max subscription (`CLAUDE_CODE_OAUTH_TOKEN`),
 *                     agent-harness, `AgentSdkMcpModelClient`.
 * - `codex-sub`     — ChatGPT/Codex subscription (a `codex login` session under
 *                     `CODEX_HOME`, no env credential), agent-harness,
 *                     `CodexSdkMcpModelClient`.
 * - `anthropic-api` — Anthropic Console key (`ANTHROPIC_API_KEY`), api-native,
 *                     `AnthropicNativeModelClient`.
 * - `openai-api`    — OpenAI API key (`OPENAI_API_KEY`), api-native; the adapter
 *                     is not built yet (eshyra-fxxf), so selecting it resolves in
 *                     config but fails with a clear message at adapter wiring.
 */
export type GameplayProvider =
  | 'claude-sub'
  | 'codex-sub'
  | 'anthropic-api'
  | 'openai-api';

/** All gameplay providers, in a stable order (used for messages and tests). */
export const GAMEPLAY_PROVIDERS: readonly GameplayProvider[] = [
  'claude-sub',
  'codex-sub',
  'anthropic-api',
  'openai-api',
];

/**
 * Explicit selection from `ESHYRA_AUTH_MODE`: one of the four providers to force
 * it, or `auto` (the default) to use whichever single provider's auth is
 * present. Provider and auth are the same concern, so this single knob selects
 * both (eshyra-6ygw).
 */
export type ProviderSelection = GameplayProvider | 'auto';

/** Vendor behind a provider — selects the credential-stripping policy. */
export type ProviderVendor = 'anthropic' | 'openai';

/** Adapter family (ADR 0010): how the provider talks to the model. */
export type AdapterFamily = 'agent-harness' | 'api-native';

/**
 * Default per-vendor primary-DM model when `ESHYRA_MODEL` is unset. A capability
 * floor, not a hard pin — override with `ESHYRA_MODEL`.
 */
const DEFAULT_DM_MODEL: Record<ProviderVendor, string> = {
  anthropic: 'claude-opus-4-8',
  openai: 'gpt-5.5',
};

/**
 * Default per-vendor mechanics-audit model when `ESHYRA_AUDIT_MODEL` is unset.
 * The audit is a bounded tool-use judgement, so a fast tier is appropriate where
 * one exists; it runs under the SAME provider as the DM (never independently
 * billed), so it must be entitled on that subscription/key. Override with
 * `ESHYRA_AUDIT_MODEL` (e.g. point it at the primary model if no cheaper tier is
 * available on the subscription).
 */
const DEFAULT_AUDIT_MODEL_BY_VENDOR: Record<ProviderVendor, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-5.4-mini',
};

/**
 * Default mechanics-audit model (Anthropic). Retained as a stable export for
 * callers/tests; the runtime default is now vendor-aware
 * ({@link DEFAULT_AUDIT_MODEL_BY_VENDOR}).
 */
export const DEFAULT_AUDIT_MODEL = DEFAULT_AUDIT_MODEL_BY_VENDOR.anthropic;

/** Static metadata for each provider (vendor + adapter family). */
const PROVIDER_META: Record<
  GameplayProvider,
  {
    vendor: ProviderVendor;
    adapterFamily: AdapterFamily;
    credentialVar?: string;
  }
> = {
  'claude-sub': {
    vendor: 'anthropic',
    adapterFamily: 'agent-harness',
    credentialVar: 'CLAUDE_CODE_OAUTH_TOKEN',
  },
  'codex-sub': {
    vendor: 'openai',
    adapterFamily: 'agent-harness',
    // No env credential — authenticates from the codex login under CODEX_HOME.
  },
  'anthropic-api': {
    vendor: 'anthropic',
    adapterFamily: 'api-native',
    credentialVar: 'ANTHROPIC_API_KEY',
  },
  'openai-api': {
    vendor: 'openai',
    adapterFamily: 'api-native',
    credentialVar: 'OPENAI_API_KEY',
  },
};

/**
 * The resolved gameplay provider plus the single credential (if any) to inject
 * into its adapter. `env` carries exactly the one credential variable for that
 * provider (and is empty for the login-based `codex-sub`); the CLI injects only
 * this, and the adapter strips every other inherited provider credential so a
 * stray key can never shadow the selection.
 */
export interface ResolvedProvider {
  /** Which of the four providers was selected. */
  id: GameplayProvider;
  /** Provider vendor. */
  vendor: ProviderVendor;
  /** Adapter family (ADR 0010). */
  adapterFamily: AdapterFamily;
  /** The one credential variable to inject, or `{}` for a login-based provider. */
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
   * Resolved primary-DM model id. `ESHYRA_MODEL` wins when set; otherwise the
   * per-vendor default for the resolved provider ({@link DEFAULT_DM_MODEL}).
   */
  model: string;
  /**
   * Model id for the mechanics-audit / turn-referee call. `ESHYRA_AUDIT_MODEL`
   * wins when set; otherwise the per-vendor default
   * ({@link DEFAULT_AUDIT_MODEL_BY_VENDOR}). Runs under the SAME provider as the
   * primary DM (eshyra-oobh).
   */
  auditModel: string;
  /**
   * Resolved `premium_dm` profile entry (tier + canon metadata) from the profile
   * registry. The runtime provider and model now come from {@link auth} /
   * {@link model}; this entry is retained for tier/canon-changing metadata.
   */
  dmProfile: ConfiguredProfileEntry;
  /** The resolved gameplay provider and its injected credential (eshyra-6ygw). */
  auth: ResolvedProvider;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Probe whether a given provider's auth is present in the environment. */
export interface ProviderProbes {
  /**
   * Whether a Codex subscription login exists. Default reads
   * `${CODEX_HOME:-~/.codex}/auth.json` and checks `auth_mode === 'chatgpt'`
   * (an OAuth/ChatGPT login, not an API-key login). Injectable for tests.
   */
  codexLoginPresent?: (env: Record<string, string | undefined>) => boolean;
}

/**
 * Default Codex-subscription detection: a `codex login` writes
 * `${CODEX_HOME:-~/.codex}/auth.json`; a ChatGPT/Codex *subscription* login is
 * marked by `auth_mode === "chatgpt"` (vs `"apikey"`). `auth_mode` is a
 * non-secret discriminator — the credential tokens are never read or returned.
 */
export function defaultCodexLoginPresent(
  env: Record<string, string | undefined>,
): boolean {
  const home = env.CODEX_HOME?.trim() || join(homedir(), '.codex');
  const authPath = join(home, 'auth.json');
  if (!existsSync(authPath)) {
    return false;
  }
  try {
    const parsed = JSON.parse(readFileSync(authPath, 'utf8')) as {
      auth_mode?: unknown;
    };
    return parsed.auth_mode === 'chatgpt';
  } catch {
    return false;
  }
}

/** Parse and validate the explicit `ESHYRA_AUTH_MODE` selection. */
function parseSelection(raw: string | undefined): ProviderSelection {
  const value = raw?.trim().toLowerCase();
  if (!value || value === 'auto') {
    return 'auto';
  }
  if ((GAMEPLAY_PROVIDERS as readonly string[]).includes(value)) {
    return value as GameplayProvider;
  }
  throw new ConfigError(
    `ESHYRA_AUTH_MODE must be one of ${GAMEPLAY_PROVIDERS.join(', ')} or "auto" (got "${raw}")`,
  );
}

/** Build the {@link ResolvedProvider} for a chosen provider id. */
function buildResolvedProvider(
  id: GameplayProvider,
  env: Record<string, string | undefined>,
): ResolvedProvider {
  const meta = PROVIDER_META[id];
  const credEnv: Record<string, string> = {};
  if (meta.credentialVar) {
    const value = env[meta.credentialVar]?.trim();
    if (value) {
      credEnv[meta.credentialVar] = value;
    }
  }
  return {
    id,
    vendor: meta.vendor,
    adapterFamily: meta.adapterFamily,
    env: credEnv,
  };
}

/**
 * Resolve the gameplay provider from the environment (eshyra-6ygw). Provider and
 * auth are one concern, so this generalizes the prior Anthropic logic across all
 * four providers: detect which providers' auth is present, then
 *  - if `ESHYRA_AUTH_MODE` names a provider, force it (error if its auth is
 *    absent);
 *  - else use the single present provider; with none present, or more than one
 *    present, fail loudly rather than guess (released gameplay must never
 *    silently pick which credential/subscription to bill).
 */
function resolveProvider(
  env: Record<string, string | undefined>,
  probes: ProviderProbes,
): ResolvedProvider {
  const codexLoginPresent =
    probes.codexLoginPresent ?? defaultCodexLoginPresent;
  const present = new Set<GameplayProvider>();
  if (env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) present.add('claude-sub');
  if (env.ANTHROPIC_API_KEY?.trim()) present.add('anthropic-api');
  if (env.OPENAI_API_KEY?.trim()) present.add('openai-api');
  if (codexLoginPresent(env)) present.add('codex-sub');

  const selection = parseSelection(env.ESHYRA_AUTH_MODE);

  if (selection !== 'auto') {
    if (!present.has(selection)) {
      throw new ConfigError(
        `ESHYRA_AUTH_MODE=${selection}, but that provider's auth is not present (${authHint(selection)})`,
      );
    }
    return buildResolvedProvider(selection, env);
  }

  if (present.size === 0) {
    throw new ConfigError(
      'no gameplay provider auth found. Provide exactly one of:\n' +
        GAMEPLAY_PROVIDERS.map((p) => `  - ${p}: ${authHint(p)}`).join('\n'),
    );
  }
  if (present.size > 1) {
    const found = GAMEPLAY_PROVIDERS.filter((p) => present.has(p));
    throw new ConfigError(
      `multiple gameplay providers are available (${found.join(', ')}) — Eshyra ` +
        'will not guess which to use. Set ESHYRA_AUTH_MODE to one of them, or ' +
        'remove the auth you are not using.',
    );
  }
  const [only] = present;
  return buildResolvedProvider(only, env);
}

/** A short, non-secret hint of how a provider authenticates (for errors). */
function authHint(id: GameplayProvider): string {
  switch (id) {
    case 'claude-sub':
      return 'set CLAUDE_CODE_OAUTH_TOKEN (a Claude Pro/Max token from `claude setup-token`)';
    case 'codex-sub':
      return 'run `codex login` (a ChatGPT/Codex subscription session under CODEX_HOME)';
    case 'anthropic-api':
      return 'set ANTHROPIC_API_KEY (an Anthropic Console key)';
    case 'openai-api':
      return 'set OPENAI_API_KEY (an OpenAI API key)';
  }
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  probes: ProviderProbes = {},
): EshyraConfig {
  // ESHYRA_DB_PATH is optional: when set it names an explicit campaign
  // database; when unset the CLI resolves the campaign from its registry.
  const campaignDbPath = env.ESHYRA_DB_PATH?.trim() || undefined;
  const auth = resolveProvider(env, probes);

  // The profile registry is retained for tier / canon-changing metadata.
  // resolveProfileRegistry reports malformed profile overrides via
  // ProfileConfigError; surface those through the single ConfigError channel.
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
  if (!dmRaw.configured) {
    throw new ConfigError(
      'internal: premium_dm profile was not configured — this should not happen',
    );
  }
  const dmProfile = dmRaw;

  // Runtime model: ESHYRA_MODEL override wins; otherwise the per-vendor default
  // for the resolved provider (the prior premium_dm profile model is no longer
  // authoritative now that the provider is auth-resolved, not profile-pinned).
  const model = env.ESHYRA_MODEL?.trim() || DEFAULT_DM_MODEL[auth.vendor];

  // Audit model: ESHYRA_AUDIT_MODEL override wins; otherwise the per-vendor
  // default. Runs under the same provider as the DM (eshyra-oobh).
  const auditModel =
    env.ESHYRA_AUDIT_MODEL?.trim() ||
    DEFAULT_AUDIT_MODEL_BY_VENDOR[auth.vendor];

  return { campaignDbPath, model, auditModel, dmProfile, auth };
}
