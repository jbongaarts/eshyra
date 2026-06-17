import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFILE_REGISTRY,
  getProfile,
  MODEL_PROFILES,
  PROVIDER_IDS,
  ProfileConfigError,
  resolveProfileRegistry,
} from '../src/model/profiles.js';

describe('model profiles', () => {
  it('declares exactly the seven capability-based profiles', () => {
    expect([...MODEL_PROFILES].sort()).toEqual(
      [
        'economy_or_experimental',
        'embedding_provider',
        'memory_reconciler',
        'premium_dm',
        'rules_adjudicator',
        'state_extractor',
        'summarizer',
      ].sort(),
    );
  });

  it('declares provider adapters by neutral identifiers (no SDK/provider coupling in names)', () => {
    expect([...PROVIDER_IDS].sort()).toEqual(
      [
        'anthropic',
        'openai',
        'bedrock',
        'gemini',
        'openrouter',
        'local',
      ].sort(),
    );
  });

  it('default registry covers all profiles: premium_dm is configured, others are not', () => {
    for (const profile of MODEL_PROFILES) {
      const entry = DEFAULT_PROFILE_REGISTRY[profile];
      expect(entry).toBeDefined();
      if (profile === 'premium_dm') {
        expect(entry.configured).toBe(true);
        if (entry.configured) {
          expect(PROVIDER_IDS).toContain(entry.provider);
          expect(entry.model.length).toBeGreaterThan(0);
        }
      } else {
        // Auxiliary, helper, embedding, and economy profiles are declared but
        // have no default provider/model — they must be explicitly configured
        // via env vars before use.
        expect(entry.configured).toBe(false);
      }
    }
  });

  it('premium_dm carries documented quality/capability-floor expectations', () => {
    const premium = DEFAULT_PROFILE_REGISTRY.premium_dm;
    expect(premium.configured).toBe(true);
    if (!premium.configured) return;
    expect(premium.capabilityFloor).toBeDefined();
    expect(premium.capabilityFloor).toMatch(/Opus 4\.6|GPT-5\.5/i);
    expect(premium.canonChanging).toBe(true);
    expect(premium.tier).toBe('premium');
  });

  it('economy_or_experimental is flagged as not-canon-safe and experimental tier', () => {
    const eco = DEFAULT_PROFILE_REGISTRY.economy_or_experimental;
    expect(eco.canonChanging).toBe(false);
    expect(eco.tier).toBe('experimental');
  });

  it('getProfile returns the configured entry for premium_dm', () => {
    const entry = getProfile(DEFAULT_PROFILE_REGISTRY, 'premium_dm');
    expect(entry.configured).toBe(true);
    expect(entry.provider).toBe('anthropic');
    expect(entry.model).toBe('claude-opus-4-8');
  });

  it('getProfile throws ProfileConfigError for unconfigured profiles', () => {
    const unconfiguredProfiles = MODEL_PROFILES.filter(
      (p) => p !== 'premium_dm',
    );
    for (const profile of unconfiguredProfiles) {
      expect(
        () => getProfile(DEFAULT_PROFILE_REGISTRY, profile),
        `expected ${profile} to throw`,
      ).toThrow(ProfileConfigError);
    }
  });

  it('getProfile error message names the missing env vars', () => {
    expect(() =>
      getProfile(DEFAULT_PROFILE_REGISTRY, 'embedding_provider'),
    ).toThrowError(
      /ESHYRA_PROFILE_EMBEDDING_PROVIDER_PROVIDER.*ESHYRA_PROFILE_EMBEDDING_PROVIDER_MODEL/,
    );
  });

  it('resolveProfileRegistry allows per-profile provider/model override via env', () => {
    const reg = resolveProfileRegistry({
      ESHYRA_PROFILE_PREMIUM_DM_PROVIDER: 'bedrock',
      ESHYRA_PROFILE_PREMIUM_DM_MODEL: 'some-bedrock-model',
    });
    expect(reg.premium_dm).toMatchObject({
      configured: true,
      provider: 'bedrock',
      model: 'some-bedrock-model',
    });
    // Untouched profiles keep their defaults.
    expect(reg.summarizer).toEqual(DEFAULT_PROFILE_REGISTRY.summarizer);
  });

  it('resolveProfileRegistry enables an unconfigured profile when both env vars are set', () => {
    const reg = resolveProfileRegistry({
      ESHYRA_PROFILE_ECONOMY_OR_EXPERIMENTAL_PROVIDER: 'anthropic',
      ESHYRA_PROFILE_ECONOMY_OR_EXPERIMENTAL_MODEL: 'claude-haiku-4-5-20251001',
    });
    const entry = reg.economy_or_experimental;
    expect(entry.configured).toBe(true);
    if (!entry.configured) return;
    expect(entry.provider).toBe('anthropic');
    expect(entry.model).toBe('claude-haiku-4-5-20251001');
    // Structural metadata is preserved from the default.
    expect(entry.tier).toBe('experimental');
    expect(entry.canonChanging).toBe(false);
  });

  it('resolveProfileRegistry throws when only one env var is set for an unconfigured profile', () => {
    expect(() =>
      resolveProfileRegistry({
        ESHYRA_PROFILE_SUMMARIZER_MODEL: 'some-model',
        // ESHYRA_PROFILE_SUMMARIZER_PROVIDER intentionally missing
      }),
    ).toThrow(ProfileConfigError);

    expect(() =>
      resolveProfileRegistry({
        ESHYRA_PROFILE_SUMMARIZER_PROVIDER: 'anthropic',
        // ESHYRA_PROFILE_SUMMARIZER_MODEL intentionally missing
      }),
    ).toThrow(ProfileConfigError);
  });

  it('resolveProfileRegistry rejects an unknown provider id', () => {
    expect(() =>
      resolveProfileRegistry({
        ESHYRA_PROFILE_SUMMARIZER_PROVIDER: 'not-a-provider',
      }),
    ).toThrow(ProfileConfigError);
  });

  it('resolveProfileRegistry falls back to defaults with no env', () => {
    expect(resolveProfileRegistry({})).toEqual(DEFAULT_PROFILE_REGISTRY);
  });
});
