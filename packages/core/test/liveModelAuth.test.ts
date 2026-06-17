import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIVE_MODEL,
  resolveLiveModelAuth,
} from './support/liveModelAuth.js';

// Sentinels used only in this test. They are deliberately NOT real-looking
// tokens; assertions below also confirm they never reach failure messages.
const API_KEY = 'test-api-key-value';
const OAUTH_TOKEN = 'test-oauth-token-value';

/**
 * Assert without leaking a secret: vitest embeds the matcher arguments in the
 * failure message, so we never pass a token (or an object containing one) into
 * `expect(...)`. Instead we reduce to booleans / mode labels first.
 */
describe('resolveLiveModelAuth', () => {
  it('is unavailable when no credential is present', () => {
    const result = resolveLiveModelAuth({});
    expect(result.available).toBe(false);
  });

  it('is available via api-key when only ANTHROPIC_API_KEY is set', () => {
    const result = resolveLiveModelAuth({ ANTHROPIC_API_KEY: API_KEY });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.mode).toBe('api-key');
    // Compare booleans, not the secret, so a failure never prints the token.
    expect(Object.keys(result.auth.env)).toEqual(['ANTHROPIC_API_KEY']);
    expect(result.auth.env.ANTHROPIC_API_KEY === API_KEY).toBe(true);
  });

  it('is available via oauth-token when only CLAUDE_CODE_OAUTH_TOKEN is set', () => {
    const result = resolveLiveModelAuth({
      CLAUDE_CODE_OAUTH_TOKEN: OAUTH_TOKEN,
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.mode).toBe('oauth-token');
    expect(Object.keys(result.auth.env)).toEqual(['CLAUDE_CODE_OAUTH_TOKEN']);
    expect(result.auth.env.CLAUDE_CODE_OAUTH_TOKEN === OAUTH_TOKEN).toBe(true);
  });

  it('prefers ANTHROPIC_API_KEY when both credentials are set', () => {
    const result = resolveLiveModelAuth({
      ANTHROPIC_API_KEY: API_KEY,
      CLAUDE_CODE_OAUTH_TOKEN: OAUTH_TOKEN,
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.mode).toBe('api-key');
    // Only the API key is injected — the OAuth token must not ride along, or it
    // could shadow precedence in the SDK subprocess.
    expect(Object.keys(result.auth.env)).toEqual(['ANTHROPIC_API_KEY']);
    expect(result.auth.env.ANTHROPIC_API_KEY === API_KEY).toBe(true);
  });

  it('defaults the model to Opus 4.8 and honors ESHYRA_MODEL override', () => {
    const def = resolveLiveModelAuth({ ANTHROPIC_API_KEY: API_KEY });
    if (!def.available) throw new Error('expected available auth');
    expect(def.model).toBe(DEFAULT_LIVE_MODEL);
    expect(DEFAULT_LIVE_MODEL).toBe('claude-opus-4-8');

    const overridden = resolveLiveModelAuth({
      ANTHROPIC_API_KEY: API_KEY,
      ESHYRA_MODEL: 'claude-sonnet-4-6',
    });
    if (!overridden.available) throw new Error('expected available auth');
    expect(overridden.model).toBe('claude-sonnet-4-6');
  });
});
