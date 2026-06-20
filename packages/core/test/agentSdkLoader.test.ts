import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AgentSdkRuntime,
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
  it('is true for a Node module-resolution error naming the SDK package', () => {
    expect(
      isMissingAgentSdk(
        Object.assign(
          new Error(
            "Cannot find package '@anthropic-ai/claude-agent-sdk' imported from x",
          ),
          { code: 'ERR_MODULE_NOT_FOUND' },
        ),
      ),
    ).toBe(true);
    expect(
      isMissingAgentSdk(
        Object.assign(
          new Error("Cannot find module '@anthropic-ai/claude-agent-sdk'"),
          { code: 'MODULE_NOT_FOUND' },
        ),
      ),
    ).toBe(true);
  });

  it('is false for a Node module-resolution error naming another package', () => {
    expect(
      isMissingAgentSdk(
        Object.assign(
          new Error(
            "Cannot find package 'some-sdk-internal-dep' imported from x",
          ),
          { code: 'ERR_MODULE_NOT_FOUND' },
        ),
      ),
    ).toBe(false);
    expect(
      isMissingAgentSdk(
        Object.assign(
          new Error(
            "Cannot find package 'some-sdk-internal-dep' imported from /repo/node_modules/@anthropic-ai/claude-agent-sdk/dist/index.js",
          ),
          { code: 'ERR_MODULE_NOT_FOUND' },
        ),
      ),
    ).toBe(false);
    expect(
      isMissingAgentSdk(
        Object.assign(new Error("Cannot find module 'some-sdk-internal-dep'"), {
          code: 'MODULE_NOT_FOUND',
        }),
      ),
    ).toBe(false);
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
  afterEach(() => {
    vi.doUnmock('@anthropic-ai/claude-agent-sdk');
    vi.resetModules();
  });

  it('returns the SDK runtime surface when the package resolves', async () => {
    const query = vi.fn();
    const tool = vi.fn();
    const createSdkMcpServer = vi.fn();
    const rt = await loadAgentSdk(
      async () =>
        ({
          query,
          tool,
          createSdkMcpServer,
        }) as AgentSdkRuntime,
    );

    expect(rt.query).toBe(query);
    expect(rt.tool).toBe(tool);
    expect(rt.createSdkMcpServer).toBe(createSdkMcpServer);
  });

  it('converts a missing Claude SDK package into the friendly edition error', async () => {
    const importSdk = async (): Promise<AgentSdkRuntime> => {
      throw Object.assign(
        new Error(
          "Cannot find package '@anthropic-ai/claude-agent-sdk' imported from x",
        ),
        { code: 'ERR_MODULE_NOT_FOUND' },
      );
    };

    await expect(loadAgentSdk(importSdk)).rejects.toMatchObject({
      name: 'ModelClientError',
      message: expect.stringContaining(
        'Install the "claude" or "full" edition',
      ),
    });
  });

  it('preserves module-resolution errors for SDK-internal dependencies', async () => {
    const original = Object.assign(
      new Error(
        "Cannot find package 'some-sdk-internal-dep' imported from /repo/node_modules/@anthropic-ai/claude-agent-sdk/dist/index.js",
      ),
      { code: 'ERR_MODULE_NOT_FOUND' },
    );
    const importSdk = async (): Promise<AgentSdkRuntime> => {
      throw original;
    };

    await expect(loadAgentSdk(importSdk)).rejects.toBe(original);
  });

  it('preserves unrelated runtime errors that mention the SDK package', async () => {
    const original = new Error(
      'No "tool" export defined on the @anthropic-ai/claude-agent-sdk mock',
    );
    const importSdk = async (): Promise<AgentSdkRuntime> => {
      throw original;
    };

    await expect(loadAgentSdk(importSdk)).rejects.toBe(original);
  });
});
