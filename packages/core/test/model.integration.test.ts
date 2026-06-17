import { describe, expect, it } from 'vitest';
import { AgentSdkModelClient } from '../src/model/agentSdkClient.js';
import { resolveLiveModelAuth } from './support/liveModelAuth.js';

// Gated on either ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (API key wins
// when both are set). Defaults to Opus 4.8; ESHYRA_MODEL overrides. See
// docs/agent-sdk-auth.md and AGENTS.md.
const liveAuth = resolveLiveModelAuth();

describe.skipIf(!liveAuth.available)('AgentSdkModelClient round-trip', () => {
  it('returns non-empty assistant text from a real call', async () => {
    if (!liveAuth.available) return; // narrows the union; describe already skips
    const client = new AgentSdkModelClient(liveAuth.model, liveAuth.auth);
    const out = await client.complete({
      system: 'Reply with exactly the word: pong',
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(out.text.trim().length).toBeGreaterThan(0);
  }, 30_000);
});
