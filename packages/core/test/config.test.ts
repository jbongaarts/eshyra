import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_AUDIT_MODEL, loadConfig } from '../src/config.js';
import { DEFAULT_PROFILE_REGISTRY, getProfile } from '../src/model/profiles.js';

describe('loadConfig', () => {
  it('returns a valid config from a complete env', () => {
    const cfg = loadConfig({
      ESHYRA_DB_PATH: './campaigns/x.db',
      ESHYRA_MODEL: 'claude-opus-4-7',
      ANTHROPIC_API_KEY: 'sk-test',
    });
    expect(cfg).toEqual({
      campaignDbPath: './campaigns/x.db',
      model: 'claude-opus-4-7',
      auditModel: DEFAULT_AUDIT_MODEL,
      dmProfile: DEFAULT_PROFILE_REGISTRY.premium_dm,
      auth: { mode: 'api-key', env: { ANTHROPIC_API_KEY: 'sk-test' } },
    });
  });

  it('resolves the audit model from ESHYRA_AUDIT_MODEL, else the fast default', () => {
    const def = loadConfig({ ANTHROPIC_API_KEY: 'sk-test' });
    expect(def.auditModel).toBe(DEFAULT_AUDIT_MODEL);
    const overridden = loadConfig({
      ANTHROPIC_API_KEY: 'sk-test',
      ESHYRA_AUDIT_MODEL: 'claude-custom-audit',
    });
    expect(overridden.auditModel).toBe('claude-custom-audit');
  });

  it('defaults the model to the premium_dm profile when unset', () => {
    const cfg = loadConfig({
      ESHYRA_DB_PATH: './x.db',
      ANTHROPIC_API_KEY: 'sk-test',
    });
    const premiumDm = getProfile(DEFAULT_PROFILE_REGISTRY, 'premium_dm');
    expect(cfg.model).toBe(premiumDm.model);
    expect(cfg.dmProfile).toEqual(premiumDm);
  });

  it('resolves the runtime DM model from a premium_dm profile override', () => {
    const cfg = loadConfig({
      ESHYRA_DB_PATH: './x.db',
      ANTHROPIC_API_KEY: 'sk-test',
      ESHYRA_PROFILE_PREMIUM_DM_MODEL: 'claude-future-1',
    });
    expect(cfg.model).toBe('claude-future-1');
    expect(cfg.dmProfile.model).toBe('claude-future-1');
  });

  it('lets the legacy flat ESHYRA_MODEL override win over the profile', () => {
    const cfg = loadConfig({
      ESHYRA_DB_PATH: './x.db',
      ANTHROPIC_API_KEY: 'sk-test',
      ESHYRA_MODEL: 'claude-flat-override',
      ESHYRA_PROFILE_PREMIUM_DM_MODEL: 'claude-profile-model',
    });
    expect(cfg.model).toBe('claude-flat-override');
    // The resolved profile entry still reflects the profile-level override.
    expect(cfg.dmProfile.model).toBe('claude-profile-model');
  });

  it('throws ConfigError when the premium_dm profile selects a non-anthropic provider', () => {
    expect(() =>
      loadConfig({
        ESHYRA_DB_PATH: './x.db',
        ANTHROPIC_API_KEY: 'sk-test',
        ESHYRA_PROFILE_PREMIUM_DM_PROVIDER: 'openai',
      }),
    ).toThrow(ConfigError);
  });

  it('throws ConfigError when a profile provider override is not a known provider id', () => {
    expect(() =>
      loadConfig({
        ESHYRA_DB_PATH: './x.db',
        ANTHROPIC_API_KEY: 'sk-test',
        ESHYRA_PROFILE_PREMIUM_DM_PROVIDER: 'not-a-provider',
      }),
    ).toThrow(ConfigError);
  });

  it('leaves campaignDbPath undefined when ESHYRA_DB_PATH is missing', () => {
    // ESHYRA_DB_PATH is optional (ADR 0004): the CLI resolves the campaign
    // from its registry when it is unset. Provider auth is still mandatory.
    const cfg = loadConfig({ ANTHROPIC_API_KEY: 'sk-test' });
    expect(cfg.campaignDbPath).toBeUndefined();
  });

  it('leaves campaignDbPath undefined when ESHYRA_DB_PATH is blank', () => {
    const cfg = loadConfig({
      ESHYRA_DB_PATH: '   ',
      ANTHROPIC_API_KEY: 'sk-test',
    });
    expect(cfg.campaignDbPath).toBeUndefined();
  });

  describe('provider auth', () => {
    it('resolves api-key auth from ANTHROPIC_API_KEY', () => {
      const cfg = loadConfig({
        ESHYRA_DB_PATH: './x.db',
        ANTHROPIC_API_KEY: 'sk-test',
      });
      expect(cfg.auth).toEqual({
        mode: 'api-key',
        env: { ANTHROPIC_API_KEY: 'sk-test' },
      });
    });

    it('resolves oauth-token auth from CLAUDE_CODE_OAUTH_TOKEN (Pro/Max plan)', () => {
      const cfg = loadConfig({
        ESHYRA_DB_PATH: './x.db',
        CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-test',
      });
      expect(cfg.auth).toEqual({
        mode: 'oauth-token',
        env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-test' },
      });
    });

    it('fails fast when both credentials are set and no explicit mode is given', () => {
      // Released gameplay must never silently fall back to API billing: when
      // both are present, loadConfig refuses to guess (eshyra-oobh).
      expect(() =>
        loadConfig({
          ESHYRA_DB_PATH: './x.db',
          ANTHROPIC_API_KEY: 'sk-test',
          CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-test',
        }),
      ).toThrow(ConfigError);
    });

    it('selects oauth-token when both are set and ESHYRA_AUTH_MODE=oauth-token', () => {
      const cfg = loadConfig({
        ESHYRA_DB_PATH: './x.db',
        ANTHROPIC_API_KEY: 'sk-test',
        CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-test',
        ESHYRA_AUTH_MODE: 'oauth-token',
      });
      // Only the subscription token is injected — never the API key.
      expect(cfg.auth).toEqual({
        mode: 'oauth-token',
        env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-test' },
      });
    });

    it('selects api-key when both are set and ESHYRA_AUTH_MODE=api-key', () => {
      const cfg = loadConfig({
        ESHYRA_DB_PATH: './x.db',
        ANTHROPIC_API_KEY: 'sk-test',
        CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-test',
        ESHYRA_AUTH_MODE: 'api-key',
      });
      expect(cfg.auth).toEqual({
        mode: 'api-key',
        env: { ANTHROPIC_API_KEY: 'sk-test' },
      });
    });

    it('throws ConfigError when ESHYRA_AUTH_MODE=oauth-token but the token is missing', () => {
      expect(() =>
        loadConfig({
          ESHYRA_DB_PATH: './x.db',
          ANTHROPIC_API_KEY: 'sk-test',
          ESHYRA_AUTH_MODE: 'oauth-token',
        }),
      ).toThrow(ConfigError);
    });

    it('throws ConfigError when ESHYRA_AUTH_MODE=api-key but the key is missing', () => {
      expect(() =>
        loadConfig({
          ESHYRA_DB_PATH: './x.db',
          CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-test',
          ESHYRA_AUTH_MODE: 'api-key',
        }),
      ).toThrow(ConfigError);
    });

    it('throws ConfigError for an unrecognized ESHYRA_AUTH_MODE', () => {
      expect(() =>
        loadConfig({
          ESHYRA_DB_PATH: './x.db',
          ANTHROPIC_API_KEY: 'sk-test',
          ESHYRA_AUTH_MODE: 'bogus',
        }),
      ).toThrow(ConfigError);
    });

    it('uses the single present credential under explicit auto mode', () => {
      const apiOnly = loadConfig({
        ANTHROPIC_API_KEY: 'sk-test',
        ESHYRA_AUTH_MODE: 'auto',
      });
      expect(apiOnly.auth.mode).toBe('api-key');
      const oauthOnly = loadConfig({
        CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-test',
        ESHYRA_AUTH_MODE: 'auto',
      });
      expect(oauthOnly.auth.mode).toBe('oauth-token');
    });

    it('throws ConfigError when neither credential is set', () => {
      expect(() => loadConfig({ ESHYRA_DB_PATH: './x.db' })).toThrow(
        ConfigError,
      );
    });

    it('treats a blank ANTHROPIC_API_KEY as unset and falls back to the OAuth token', () => {
      const cfg = loadConfig({
        ESHYRA_DB_PATH: './x.db',
        ANTHROPIC_API_KEY: '   ',
        CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-test',
      });
      expect(cfg.auth.mode).toBe('oauth-token');
    });
  });
});
