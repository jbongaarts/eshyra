import { describe, expect, it } from 'vitest';
import {
  AGENT_SDK_LEGACY_ADAPTER_CAPABILITIES,
  AGENT_SDK_MCP_ADAPTER_CAPABILITIES,
  ANTHROPIC_NATIVE_ADAPTER_CAPABILITIES,
  assertGameplayCapable,
  type ModelAdapterCapabilities,
  UnsupportedGameplayProviderError,
} from '../src/index.js';

/**
 * Provider capability enforcement for released gameplay (eshyra-qa9d, ADR 0010).
 *
 * A provider is supported for gameplay ONLY if its adapter forwards Eshyra's
 * provider-neutral tool definitions through a native tool channel. The two
 * gameplay adapters (agent-mcp, api-native) pass the gate; the fenced-text
 * legacy adapter is rejected before play begins.
 */
describe('assertGameplayCapable (eshyra-qa9d)', () => {
  it('accepts the agent-mcp gameplay adapter', () => {
    expect(() =>
      assertGameplayCapable(AGENT_SDK_MCP_ADAPTER_CAPABILITIES, 'primary DM'),
    ).not.toThrow();
  });

  it('accepts the api-native gameplay adapter', () => {
    expect(() =>
      assertGameplayCapable(ANTHROPIC_NATIVE_ADAPTER_CAPABILITIES),
    ).not.toThrow();
  });

  it('rejects the fenced-text adapter with an actionable, role-labelled error', () => {
    // The fenced-text adapter declares gameplayCapable: false; selecting it must
    // fail loudly rather than silently run a DM with no real tools.
    expect(AGENT_SDK_LEGACY_ADAPTER_CAPABILITIES.toolTransport).toBe(
      'fenced-text',
    );
    expect(AGENT_SDK_LEGACY_ADAPTER_CAPABILITIES.gameplayCapable).toBe(false);

    let thrown: unknown;
    try {
      assertGameplayCapable(
        AGENT_SDK_LEGACY_ADAPTER_CAPABILITIES,
        'mechanics auditor',
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UnsupportedGameplayProviderError);
    const message = (thrown as Error).message;
    // Names the failing role, the offending transport, and the supported fix.
    expect(message).toContain('mechanics auditor');
    expect(message).toContain('fenced-text');
    expect(message).toContain('AgentSdkMcpModelClient');
  });

  it('rejects any adapter declaring gameplayCapable: false regardless of transport', () => {
    const bogus: ModelAdapterCapabilities = {
      adapterFamily: 'api-native',
      toolTransport: 'api-native',
      turnLoopOwner: 'eshyra',
      vendor: 'acme',
      gameplayCapable: false,
    };
    expect(() => assertGameplayCapable(bogus)).toThrow(
      UnsupportedGameplayProviderError,
    );
  });

  it('confirms both released gameplay adapters are gameplay-capable', () => {
    expect(AGENT_SDK_MCP_ADAPTER_CAPABILITIES.gameplayCapable).toBe(true);
    expect(ANTHROPIC_NATIVE_ADAPTER_CAPABILITIES.gameplayCapable).toBe(true);
  });
});
