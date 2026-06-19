import { afterEach, describe, expect, it } from 'vitest';
import {
  buildAmbientSdkEnv,
  buildChildSdkEnv,
  PROVIDER_CREDENTIAL_VARS,
} from '../src/model/agentSdkEnv.js';

/**
 * Unit coverage for child Agent SDK environment construction (eshyra-oobh). The
 * load-bearing property is auth exclusivity: an ambient `ANTHROPIC_API_KEY` must
 * never survive into a child call that selected a subscription token, because
 * Claude Code ranks the API key higher and would silently bill API tokens.
 */

const TOUCHED = [...PROVIDER_CREDENTIAL_VARS, 'ESHYRA_ENV_TEST_KEEP'];

afterEach(() => {
  for (const key of TOUCHED) {
    Reflect.deleteProperty(process.env, key);
  }
});

describe('buildChildSdkEnv', () => {
  it('strips an inherited API key when a subscription token is selected', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ambient-should-be-removed';
    process.env.ESHYRA_ENV_TEST_KEEP = 'keep-me';

    const env = buildChildSdkEnv({
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-selected',
    });

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-selected');
    expect('ANTHROPIC_API_KEY' in env).toBe(false);
    // Non-credential inherited vars are preserved (PATH/HOME-style).
    expect(env.ESHYRA_ENV_TEST_KEEP).toBe('keep-me');
  });

  it('strips an inherited subscription token when an API key is selected', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-should-be-removed';

    const env = buildChildSdkEnv({ ANTHROPIC_API_KEY: 'sk-selected' });

    expect(env.ANTHROPIC_API_KEY).toBe('sk-selected');
    expect('CLAUDE_CODE_OAUTH_TOKEN' in env).toBe(false);
  });

  it('strips ALL provider credentials before applying the selected one', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-x';
    process.env.ANTHROPIC_AUTH_TOKEN = 'bearer-x';
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-x';

    const env = buildChildSdkEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth-selected' });

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-selected');
    expect('ANTHROPIC_API_KEY' in env).toBe(false);
    expect('ANTHROPIC_AUTH_TOKEN' in env).toBe(false);
  });

  it('applies non-secret extras (the selected credential still wins)', () => {
    const env = buildChildSdkEnv(
      { CLAUDE_CODE_OAUTH_TOKEN: 'oauth' },
      { ENABLE_TOOL_SEARCH: 'false' },
    );
    expect(env.ENABLE_TOOL_SEARCH).toBe('false');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth');
  });
});

describe('buildAmbientSdkEnv', () => {
  it('preserves inherited provider credentials (ambient path)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ambient';
    const env = buildAmbientSdkEnv({ ENABLE_TOOL_SEARCH: 'false' });
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ambient');
    expect(env.ENABLE_TOOL_SEARCH).toBe('false');
  });
});
