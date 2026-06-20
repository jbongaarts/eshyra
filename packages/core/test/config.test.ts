import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  DEFAULT_AUDIT_MODEL,
  loadConfig,
  type ProviderProbes,
} from '../src/config.js';
import { DEFAULT_PROFILE_REGISTRY } from '../src/model/profiles.js';

/**
 * loadConfig resolves one of four gameplay providers (eshyra-6ygw). Provider and
 * auth are one concern; selection is auto when exactly one provider's auth is
 * present, else ESHYRA_AUTH_MODE forces it.
 *
 * The default Codex-subscription probe reads the real `$CODEX_HOME/auth.json`, so
 * every test injects an explicit `codexLoginPresent` to stay hermetic (otherwise
 * a developer machine with a `codex login` would add a second present provider).
 */
function load(
  env: Record<string, string | undefined>,
  probes: ProviderProbes = { codexLoginPresent: () => false },
) {
  return loadConfig(env, probes);
}

const CODEX_PRESENT: ProviderProbes = { codexLoginPresent: () => true };

describe('loadConfig provider selection', () => {
  it('returns a full config for a single Anthropic API key', () => {
    const cfg = load({
      ESHYRA_DB_PATH: './campaigns/x.db',
      ESHYRA_MODEL: 'claude-opus-4-7',
      ANTHROPIC_API_KEY: 'sk-test',
    });
    expect(cfg).toEqual({
      campaignDbPath: './campaigns/x.db',
      model: 'claude-opus-4-7',
      auditModel: DEFAULT_AUDIT_MODEL,
      dmProfile: DEFAULT_PROFILE_REGISTRY.premium_dm,
      auth: {
        id: 'anthropic-api',
        vendor: 'anthropic',
        adapterFamily: 'api-native',
        env: { ANTHROPIC_API_KEY: 'sk-test' },
      },
    });
  });

  it('resolves claude-sub from CLAUDE_CODE_OAUTH_TOKEN', () => {
    const cfg = load({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-test' });
    expect(cfg.auth).toEqual({
      id: 'claude-sub',
      vendor: 'anthropic',
      adapterFamily: 'agent-harness',
      env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-test' },
    });
  });

  it('resolves openai-api from OPENAI_API_KEY', () => {
    const cfg = load({ OPENAI_API_KEY: 'sk-openai-test' });
    expect(cfg.auth).toEqual({
      id: 'openai-api',
      vendor: 'openai',
      adapterFamily: 'api-native',
      env: { OPENAI_API_KEY: 'sk-openai-test' },
    });
  });

  it('resolves codex-sub from a Codex login with no env credential', () => {
    const cfg = loadConfig({}, CODEX_PRESENT);
    expect(cfg.auth).toEqual({
      id: 'codex-sub',
      vendor: 'openai',
      adapterFamily: 'agent-harness',
      env: {},
    });
  });

  it('defaults the model per vendor and honors ESHYRA_MODEL / ESHYRA_AUDIT_MODEL', () => {
    const claude = load({ CLAUDE_CODE_OAUTH_TOKEN: 'tok' });
    expect(claude.model).toBe('claude-opus-4-8');
    expect(claude.auditModel).toBe('claude-haiku-4-5-20251001');

    const codex = loadConfig({}, CODEX_PRESENT);
    expect(codex.model).toBe('gpt-5.5');
    expect(codex.auditModel).toBe('gpt-5.4-mini');

    const overridden = load({
      ANTHROPIC_API_KEY: 'sk',
      ESHYRA_MODEL: 'claude-custom',
      ESHYRA_AUDIT_MODEL: 'claude-audit-custom',
    });
    expect(overridden.model).toBe('claude-custom');
    expect(overridden.auditModel).toBe('claude-audit-custom');
  });
});

describe('loadConfig auto vs forced selection', () => {
  it('uses the single present provider under auto (default)', () => {
    expect(load({ ANTHROPIC_API_KEY: 'sk' }).auth.id).toBe('anthropic-api');
    expect(load({ CLAUDE_CODE_OAUTH_TOKEN: 'tok' }).auth.id).toBe('claude-sub');
  });

  it('fails fast when more than one provider is available and no mode is set', () => {
    expect(() =>
      load({ ANTHROPIC_API_KEY: 'sk', CLAUDE_CODE_OAUTH_TOKEN: 'tok' }),
    ).toThrow(ConfigError);
    // A real Codex login alongside an env credential is also ambiguous.
    expect(() =>
      loadConfig({ ANTHROPIC_API_KEY: 'sk' }, CODEX_PRESENT),
    ).toThrow(ConfigError);
  });

  it('ESHYRA_AUTH_MODE forces one provider when several are available', () => {
    const env = {
      ANTHROPIC_API_KEY: 'sk',
      CLAUDE_CODE_OAUTH_TOKEN: 'tok',
      OPENAI_API_KEY: 'sk-oai',
    };
    expect(load({ ...env, ESHYRA_AUTH_MODE: 'claude-sub' }).auth.id).toBe(
      'claude-sub',
    );
    expect(load({ ...env, ESHYRA_AUTH_MODE: 'anthropic-api' }).auth).toEqual({
      id: 'anthropic-api',
      vendor: 'anthropic',
      adapterFamily: 'api-native',
      env: { ANTHROPIC_API_KEY: 'sk' },
    });
  });

  it('forcing codex-sub uses the login and injects no env credential', () => {
    const cfg = loadConfig(
      { ANTHROPIC_API_KEY: 'sk', ESHYRA_AUTH_MODE: 'codex-sub' },
      CODEX_PRESENT,
    );
    expect(cfg.auth.id).toBe('codex-sub');
    expect(cfg.auth.env).toEqual({});
  });

  it('throws when ESHYRA_AUTH_MODE forces a provider whose auth is absent', () => {
    expect(() =>
      load({ ANTHROPIC_API_KEY: 'sk', ESHYRA_AUTH_MODE: 'claude-sub' }),
    ).toThrow(ConfigError);
    expect(() =>
      load({ ANTHROPIC_API_KEY: 'sk', ESHYRA_AUTH_MODE: 'codex-sub' }),
    ).toThrow(ConfigError);
  });

  it('throws for an unrecognized ESHYRA_AUTH_MODE', () => {
    expect(() =>
      load({ ANTHROPIC_API_KEY: 'sk', ESHYRA_AUTH_MODE: 'bogus' }),
    ).toThrow(ConfigError);
  });

  it('throws when no provider auth is present', () => {
    expect(() => load({ ESHYRA_DB_PATH: './x.db' })).toThrow(ConfigError);
  });

  it('treats a blank credential as unset', () => {
    expect(() =>
      load({ ANTHROPIC_API_KEY: '   ', ESHYRA_DB_PATH: './x.db' }),
    ).toThrow(ConfigError);
    const cfg = load({
      ANTHROPIC_API_KEY: '  ',
      CLAUDE_CODE_OAUTH_TOKEN: 'tok',
    });
    expect(cfg.auth.id).toBe('claude-sub');
  });
});

describe('loadConfig misc', () => {
  it('leaves campaignDbPath undefined when ESHYRA_DB_PATH is missing or blank', () => {
    expect(load({ ANTHROPIC_API_KEY: 'sk' }).campaignDbPath).toBeUndefined();
    expect(
      load({ ANTHROPIC_API_KEY: 'sk', ESHYRA_DB_PATH: '  ' }).campaignDbPath,
    ).toBeUndefined();
  });

  it('surfaces a malformed profile override as a ConfigError', () => {
    expect(() =>
      load({
        ANTHROPIC_API_KEY: 'sk',
        ESHYRA_PROFILE_PREMIUM_DM_PROVIDER: 'not-a-provider',
      }),
    ).toThrow(ConfigError);
  });
});
