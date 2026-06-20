import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSterileCodexEnv,
  ESHYRA_MCP_TOKEN_VAR,
  OPENAI_CREDENTIAL_VARS,
} from '../src/model/codexEnv.js';

/**
 * Unit coverage for the sterile Codex CLI environment builder (eshyra-jl8n).
 * The adapter must never let an inherited OpenAI/Codex API credential reach the
 * spawned CLI — that is the only thing standing between subscription gameplay
 * and silent API billing (ADR 0010).
 */

describe('buildSterileCodexEnv', () => {
  const touched: string[] = [];
  const setEnv = (key: string, value: string): void => {
    touched.push(key);
    process.env[key] = value;
  };

  afterEach(() => {
    for (const key of touched) {
      Reflect.deleteProperty(process.env, key);
    }
    touched.length = 0;
  });

  it('strips every OpenAI/Codex API credential so API billing is unreachable', () => {
    setEnv('OPENAI_API_KEY', 'sk-must-not-bill');
    setEnv('CODEX_API_KEY', 'codex-must-not-bill');
    setEnv('OPENAI_BASE_URL', 'https://api.openai.com/v1');

    const env = buildSterileCodexEnv('tok');

    for (const key of OPENAI_CREDENTIAL_VARS) {
      expect(key in env).toBe(false);
    }
  });

  it('injects the MCP bearer token under the fixed env var', () => {
    const env = buildSterileCodexEnv('bearer-123');
    expect(env[ESHYRA_MCP_TOKEN_VAR]).toBe('bearer-123');
  });

  it('preserves CODEX_HOME (the subscription login) and PATH', () => {
    setEnv('CODEX_HOME', '/home/u/.codex');
    const env = buildSterileCodexEnv('tok');
    expect(env.CODEX_HOME).toBe('/home/u/.codex');
    expect(env.PATH).toBe(process.env.PATH);
  });

  it('applies non-secret extras but the token always wins last', () => {
    const env = buildSterileCodexEnv('the-token', {
      EXTRA: 'x',
      [ESHYRA_MCP_TOKEN_VAR]: 'should-be-overwritten',
    });
    expect(env.EXTRA).toBe('x');
    expect(env[ESHYRA_MCP_TOKEN_VAR]).toBe('the-token');
  });

  it('does not mutate process.env', () => {
    setEnv('OPENAI_API_KEY', 'sk-present');
    buildSterileCodexEnv('tok');
    expect(process.env.OPENAI_API_KEY).toBe('sk-present');
  });
});
