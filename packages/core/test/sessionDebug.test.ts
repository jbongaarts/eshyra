import { describe, expect, it } from 'vitest';
import {
  approxTokens,
  buildModelCallEvent,
  splitMarkdownSections,
} from '../src/debug/sessionDebug.js';
import type { ModelMessage } from '../src/model/client.js';
import type { ModelToolDefinition } from '../src/model/toolSchema.js';

const tool = (name: string): ModelToolDefinition => ({
  name,
  description: `the ${name} tool`,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
});

describe('approxTokens', () => {
  it('estimates ~4 chars per token, rounding up', () => {
    expect(approxTokens(0)).toBe(0);
    expect(approxTokens(1)).toBe(1);
    expect(approxTokens(4)).toBe(1);
    expect(approxTokens(5)).toBe(2);
    expect(approxTokens(400)).toBe(100);
  });
});

describe('splitMarkdownSections', () => {
  it('splits on ## headers and reports each section size', () => {
    const text = ['## Alpha', 'one', 'two', '## Beta', 'three'].join('\n');
    const sections = splitMarkdownSections(text);
    expect(sections.map((s) => s.name)).toEqual(['## Alpha', '## Beta']);
    expect(sections[0].chars).toBe('one\ntwo'.length);
    expect(sections[1].chars).toBe('three'.length);
    expect(sections[1].approxTokens).toBe(approxTokens('three'.length));
  });

  it('labels content before the first header as preamble', () => {
    const text = ['You are the DM.', '', '## Tools', '- roll'].join('\n');
    const sections = splitMarkdownSections(text);
    expect(sections[0].name).toBe('(preamble)');
    expect(sections[1].name).toBe('## Tools');
  });

  it('does not emit an empty leading preamble', () => {
    const sections = splitMarkdownSections('## Only\nbody');
    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe('## Only');
  });
});

describe('buildModelCallEvent', () => {
  const messages: ModelMessage[] = [
    { role: 'user', content: '## Game State\nHP 10/10\n\n## Player Input\ngo' },
    {
      role: 'assistant',
      content: 'You stride forward.',
      stopReason: 'end_turn',
    },
  ];

  it('captures structure, labels, and the provided-vs-forwarded tool gap', () => {
    const event = buildModelCallEvent({
      trace: { campaignId: 'c1', sessionId: 's1', turnId: 't1', round: '1' },
      model: 'claude-test',
      profile: 'premium_dm',
      tier: 'premium',
      authMode: 'oauth-token',
      toolProtocolMode: 'fenced-text',
      system: '## Persona\nbe a DM',
      messages,
      providedTools: [tool('roll'), tool('world_query')],
      forwardedToolNames: [],
      outcome: { ok: true, resultChars: 19, resultApproxTokens: 5 },
      captureContent: false,
    });

    expect(event.kind).toBe('model_call');
    expect(event.trace.round).toBe('1');
    expect(event.model).toBe('claude-test');
    expect(event.profile).toBe('premium_dm');
    expect(event.authMode).toBe('oauth-token');
    expect(event.toolProtocolMode).toBe('fenced-text');
    // The core handed two tools to the client; the adapter forwarded none.
    expect(event.providedToolNames).toEqual(['roll', 'world_query']);
    expect(event.forwardedToolNames).toEqual([]);
    // System and first user message are broken into named sections.
    expect(event.system?.sections.map((s) => s.name)).toEqual(['## Persona']);
    expect(event.contextSections.map((s) => s.name)).toEqual([
      '## Game State',
      '## Player Input',
    ]);
    expect(event.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(event.messages[1].stopReason).toBe('end_turn');
    expect(event.totalChars).toBe(
      '## Persona\nbe a DM'.length +
        messages[0].content.length +
        messages[1].content.length,
    );
  });

  it('omits content by default (structural only)', () => {
    const event = buildModelCallEvent({
      model: 'm',
      toolProtocolMode: 'fenced-text',
      system: 'sys',
      messages,
      outcome: { ok: true, resultChars: 1, resultApproxTokens: 1 },
      captureContent: false,
    });
    expect(event.content).toBeUndefined();
  });

  it('attaches sanitized content when capture is requested', () => {
    const event = buildModelCallEvent({
      model: 'm',
      toolProtocolMode: 'fenced-text',
      system: 'authorization: Bearer sk-ant-shh-secret-token',
      messages: [
        { role: 'user', content: 'my api_key=sk-supersecretvalue please' },
      ],
      providedTools: [tool('roll')],
      outcome: { ok: false, error: 'boom' },
      captureContent: true,
    });
    expect(event.content).toBeDefined();
    expect(event.content?.system).not.toContain('sk-ant-shh-secret-token');
    expect(event.content?.system).toContain('[redacted]');
    expect(event.content?.messages[0].content).not.toContain(
      'sk-supersecretvalue',
    );
    expect(event.content?.providedTools.map((t) => t.name)).toEqual(['roll']);
  });

  it('reports a null system when no system prompt is given', () => {
    const event = buildModelCallEvent({
      model: 'm',
      toolProtocolMode: 'fenced-text',
      messages,
      outcome: { ok: true, resultChars: 0, resultApproxTokens: 0 },
      captureContent: false,
    });
    expect(event.system).toBeNull();
  });
});
