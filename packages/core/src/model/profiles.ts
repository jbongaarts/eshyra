/**
 * Provider-neutral model profile configuration.
 *
 * Eshyra routes different tasks to different model "profiles" describing
 * CAPABILITY NEEDS, not provider names. A profile is mapped to a provider
 * adapter (selected by a neutral identifier) plus a model id. No code here
 * imports any vendor SDK — the only file permitted to touch the Claude Agent
 * SDK is `agentSdkClient.ts`. Adapter selection is by string identifier so the
 * core stays provider-agnostic; concrete adapters are wired up downstream.
 *
 * This module only makes profiles + provider selection representable and
 * configurable. Runtime model routing / evaluation harness is out of scope
 * (downstream bead ws9.1).
 */

/**
 * The seven capability-based model profiles. These describe what a task NEEDS,
 * independent of which provider ultimately serves it.
 *
 * - premium_dm            primary Dungeon Master narration + canon-changing turns
 * - state_extractor       structured state extraction from narration
 * - summarizer            draft / rollup summaries (auxiliary)
 * - rules_adjudicator     rules reasoning / adjudication support
 * - memory_reconciler     memory pyramid reconciliation
 * - embedding_provider    vector embeddings for retrieval
 * - economy_or_experimental cheap/experimental bounded tasks that CANNOT corrupt canon
 */
export const MODEL_PROFILES = [
  'premium_dm',
  'state_extractor',
  'summarizer',
  'rules_adjudicator',
  'memory_reconciler',
  'embedding_provider',
  'economy_or_experimental',
] as const;

export type ModelProfileName = (typeof MODEL_PROFILES)[number];

/**
 * Provider adapters selectable per profile, by neutral identifier. These are
 * NOT implemented here — they only make adapter selection representable. The
 * `anthropic` and `openai` both have concrete API-native adapters; the runtime
 * provider selection chooses between them independently of this registry.
 */
export const PROVIDER_IDS = [
  'anthropic',
  'openai',
  'bedrock',
  'gemini',
  'openrouter',
  'local',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Quality tier of a profile entry. */
export type ProfileTier = 'premium' | 'standard' | 'auxiliary' | 'experimental';

/**
 * A model profile entry that has been configured with a concrete provider and
 * model. Only configured entries can be used at runtime; {@link getProfile}
 * returns this type and throws for unconfigured entries.
 */
export interface ConfiguredProfileEntry {
  configured: true;
  /** Neutral provider-adapter identifier used to select an adapter. */
  provider: ProviderId;
  /** Provider-specific model id (opaque to the core). */
  model: string;
  /** Quality tier; `premium` is the canon-trusted DM-grade tier. */
  tier: ProfileTier;
  /**
   * Whether this profile is permitted to perform canon-changing operations.
   * Canon-changing operations require a `premium` tier model (or downstream
   * validation before commit). Economy/experimental profiles MUST be `false`.
   */
  canonChanging: boolean;
  /**
   * Documented quality/capability expectation. REQUIRED on `premium_dm`
   * (acceptance #3): it states an explicit capability FLOOR, not a price floor.
   */
  capabilityFloor?: string;
  /** Human-readable note on intended use / constraints. */
  notes?: string;
}

/**
 * A declared profile that has not yet been configured with a provider and
 * model. Accessing it via {@link getProfile} throws {@link ProfileConfigError}.
 * Enable it by setting both ESHYRA_PROFILE_<PROFILE>_PROVIDER and
 * ESHYRA_PROFILE_<PROFILE>_MODEL in the environment.
 */
export interface UnconfiguredProfileEntry {
  configured: false;
  /** Quality tier — declared even for unconfigured profiles. */
  tier: ProfileTier;
  /**
   * Whether this profile is permitted to perform canon-changing operations.
   * Declared even for unconfigured profiles.
   */
  canonChanging: boolean;
  /** Human-readable note on intended use / constraints. */
  notes?: string;
}

/** A profile registry entry — either configured (has provider+model) or not. */
export type ProfileEntry = ConfiguredProfileEntry | UnconfiguredProfileEntry;

export type ProfileRegistry = Record<ModelProfileName, ProfileEntry>;

/**
 * `premium_dm` capability-floor expectation (acceptance #3, discoverable in
 * code, not only prose):
 *
 * The primary DM profile targets Opus 4.6+ / GPT-5.5-class quality or a future
 * equivalent — a CAPABILITY FLOOR, not a price floor. Canon-changing
 * operations require the premium model or validation before commit. Economy
 * models are not the default DM and must not power the primary public demo
 * unless explicitly labeled experimental. Cheaper models are acceptable only
 * for bounded auxiliary tasks that cannot directly corrupt canon.
 */
export const PREMIUM_DM_CAPABILITY_FLOOR =
  'Opus 4.6+ / GPT-5.5-class quality or a future equivalent — a capability ' +
  'floor, not a price floor. Canon-changing operations require this premium ' +
  'tier (or validation before commit); economy models must never silently ' +
  'serve the primary DM or the public demo.';

/**
 * Default, provider-neutral profile registry.
 *
 * Only `premium_dm` ships with a configured default (Anthropic +
 * claude-opus-4-8). The provider can be overridden with `openai` and an OpenAI
 * model id; released gameplay selects its concrete adapter separately from the
 * auth-resolved provider. All other profiles are declared
 * (`configured: false`) — they carry capability metadata but have no
 * provider/model assignment. Accessing an unconfigured profile via
 * {@link getProfile} throws {@link ProfileConfigError}; set both
 * ESHYRA_PROFILE_<PROFILE>_PROVIDER and ESHYRA_PROFILE_<PROFILE>_MODEL
 * to enable a profile explicitly.
 */
export const DEFAULT_PROFILE_REGISTRY: ProfileRegistry = {
  premium_dm: {
    configured: true,
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    tier: 'premium',
    canonChanging: true,
    capabilityFloor: PREMIUM_DM_CAPABILITY_FLOOR,
    notes: 'Primary Dungeon Master. Canon-trusted; do not downgrade silently.',
  },
  state_extractor: {
    configured: false,
    tier: 'standard',
    canonChanging: false,
    notes: 'Structured extraction; outputs validated before any canon write.',
  },
  summarizer: {
    configured: false,
    tier: 'auxiliary',
    canonChanging: false,
    notes: 'Draft/rollup summaries; bounded auxiliary task.',
  },
  rules_adjudicator: {
    configured: false,
    tier: 'standard',
    canonChanging: false,
    notes: 'Rules reasoning support; deterministic tools own the final math.',
  },
  memory_reconciler: {
    configured: false,
    tier: 'standard',
    canonChanging: false,
    notes: 'Memory pyramid reconciliation; reconciled writes are validated.',
  },
  embedding_provider: {
    configured: false,
    tier: 'auxiliary',
    canonChanging: false,
    notes: 'Retrieval embeddings; no narrative authority.',
  },
  economy_or_experimental: {
    configured: false,
    tier: 'experimental',
    canonChanging: false,
    notes:
      'Cheap/experimental bounded tasks only (intent classification, ' +
      'retrieval routing, candidate extraction, formatting). Must NOT power ' +
      'the primary DM or public demo and cannot directly corrupt canon.',
  },
};

export class ProfileConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileConfigError';
  }
}

/** Type guard for neutral provider identifiers. */
export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Look up the resolved entry for a profile by name.
 *
 * @throws {ProfileConfigError} if the profile is not configured. Configure it
 *   with ESHYRA_PROFILE_<PROFILE>_PROVIDER and
 *   ESHYRA_PROFILE_<PROFILE>_MODEL environment variables.
 */
export function getProfile(
  registry: ProfileRegistry,
  profile: ModelProfileName,
): ConfiguredProfileEntry {
  const entry = registry[profile];
  if (!entry.configured) {
    throw new ProfileConfigError(
      `Profile '${profile}' is not configured. Set ${envKey(profile, 'PROVIDER')} and ${envKey(profile, 'MODEL')} to enable this profile.`,
    );
  }
  return entry;
}

function envKey(
  profile: ModelProfileName,
  suffix: 'PROVIDER' | 'MODEL',
): string {
  return `ESHYRA_PROFILE_${profile.toUpperCase()}_${suffix}`;
}

/**
 * Resolve the profile registry, applying optional per-profile overrides from
 * the environment. Each profile supports:
 *   ESHYRA_PROFILE_<PROFILE>_PROVIDER  (a neutral provider id)
 *   ESHYRA_PROFILE_<PROFILE>_MODEL     (a provider-specific model id)
 *
 * For profiles that already have a configured default (currently only
 * `premium_dm`), env vars override individual fields.
 *
 * For profiles with no configured default, BOTH variables must be set together
 * to enable the profile. Setting only one throws {@link ProfileConfigError}.
 * Setting neither leaves the profile unconfigured.
 *
 * Overrides intentionally do NOT recompute `tier`/`canonChanging`: pointing a
 * profile at a cheaper provider/model never relaxes its declared capability
 * tier, and capability-floor enforcement is deferred to downstream bead ws9.1.
 */
export function resolveProfileRegistry(
  env: Record<string, string | undefined> = process.env,
): ProfileRegistry {
  const resolved = {} as ProfileRegistry;
  for (const profile of MODEL_PROFILES) {
    const base = DEFAULT_PROFILE_REGISTRY[profile];
    const providerOverride = env[envKey(profile, 'PROVIDER')]?.trim();
    const modelOverride = env[envKey(profile, 'MODEL')]?.trim();

    if (base.configured) {
      // Configured profile: apply optional per-field overrides.
      let provider = base.provider;
      if (providerOverride) {
        if (!isProviderId(providerOverride)) {
          throw new ProfileConfigError(
            `${envKey(profile, 'PROVIDER')} is not a known provider id: ` +
              `'${providerOverride}' (expected one of ${PROVIDER_IDS.join(', ')})`,
          );
        }
        provider = providerOverride;
      }
      resolved[profile] = {
        ...base,
        provider,
        model: modelOverride || base.model,
      };
    } else if (!providerOverride && !modelOverride) {
      // Unconfigured profile, no env vars: leave unconfigured.
      resolved[profile] = base;
    } else if (!providerOverride || !modelOverride) {
      // Partial env config for an unconfigured profile: explicit error.
      const missing = !providerOverride
        ? envKey(profile, 'PROVIDER')
        : envKey(profile, 'MODEL');
      throw new ProfileConfigError(
        `Profile '${profile}' has no default configuration; both ` +
          `${envKey(profile, 'PROVIDER')} and ${envKey(profile, 'MODEL')} ` +
          `must be set together to enable it. Missing: ${missing}.`,
      );
    } else {
      // Both env vars set for an unconfigured profile: validate and enable.
      if (!isProviderId(providerOverride)) {
        throw new ProfileConfigError(
          `${envKey(profile, 'PROVIDER')} is not a known provider id: ` +
            `'${providerOverride}' (expected one of ${PROVIDER_IDS.join(', ')})`,
        );
      }
      resolved[profile] = {
        configured: true,
        provider: providerOverride,
        model: modelOverride,
        tier: base.tier,
        canonChanging: base.canonChanging,
        ...(base.notes ? { notes: base.notes } : {}),
      };
    }
  }
  return resolved;
}
