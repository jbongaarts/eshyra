import { describe, expect, it, vi } from 'vitest';
import {
  isMissingAgentSdk,
  loadAgentSdk,
} from '../src/model/agentSdkLoader.js';

/**
 * Coverage for the lazy Claude Agent SDK loader (eshyra-ern3). The loader is the
 * single runtime boundary to `@anthropic-ai/claude-agent-sdk`; it must surface a
 * clear edition error only for a genuine module-resolution failure (api/codex
 * editions prune the package), and not misreport other failures as "missing".
 */

describe('isMissingAgentSdk', () => {
  it('is true for a Node module-resolution error code', () => {
    expect(
      isMissingAgentSdk(
        Object.assign(new Error('x'), { code: 'ERR_MODULE_NOT_FOUND' }),
      ),
    ).toBe(true);
    expect(
      isMissingAgentSdk(
        Object.assign(new Error('x'), { code: 'MODULE_NOT_FOUND' }),
      ),
    ).toBe(true);
  });

  it('is true for a "cannot find package" message naming the SDK', () => {
    expect(
      isMissingAgentSdk(
        new Error(
          "Cannot find package '@anthropic-ai/claude-agent-sdk' imported from x",
        ),
      ),
    ).toBe(true);
  });

  it('is FALSE for an unrelated error that merely mentions the package name', () => {
    // e.g. a mock export-validation message or an SDK-internal runtime error —
    // these must not be misreported as "the package is not installed".
    expect(
      isMissingAgentSdk(
        new Error(
          'No "tool" export defined on the @anthropic-ai/claude-agent-sdk mock',
        ),
      ),
    ).toBe(false);
    expect(isMissingAgentSdk(new Error('connect ECONNREFUSED'))).toBe(false);
  });
});

describe('loadAgentSdk', () => {
  it('returns the SDK runtime surface when the package resolves', async () => {
    vi.resetModules();
    const query = vi.fn();
    const tool = vi.fn();
    const createSdkMcpServer = vi.fn();
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query,
      tool,
      createSdkMcpServer,
    }));
    const { loadAgentSdk: load } = await import(
      '../src/model/agentSdkLoader.js'
    );
    const rt = await load();
    expect(rt.query).toBe(query);
    expect(rt.tool).toBe(tool);
    expect(rt.createSdkMcpServer).toBe(createSdkMcpServer);
    vi.doUnmock('@anthropic-ai/claude-agent-sdk');
  });
});
