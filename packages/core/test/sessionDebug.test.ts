import { describe, expect, it } from 'vitest';
import {
  approxTokens,
  buildModelCallEvent,
  sanitizePromptSectionName,
  splitPromptSections,
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

describe('sanitizePromptSectionName', () => {
  it('passes known template labels through unchanged', () => {
    for (const label of [
      '## Game State',
      '## Player Input',
      '## Available Tools',
      '## Character Chronicle',
      '## Adventure Module (DM-only)',
      '## Campaign Rules',
    ]) {
      expect(sanitizePromptSectionName(label)).toBe(label);
    }
    expect(sanitizePromptSectionName('(preamble)')).toBe('(preamble)');
  });

  it('drops the title from the dynamic Current Scene heading', () => {
    expect(
      sanitizePromptSectionName('## Current Scene: The Bloody Vault'),
    ).toBe('## Current Scene');
    expect(sanitizePromptSectionName('## Current Scene')).toBe(
      '## Current Scene',
    );
  });

  it('replaces any unrecognized heading with a generic placeholder', () => {
    // The only way untrusted player/narrative text reaches a heading.
    expect(sanitizePromptSectionName('## my password is hunter2')).toBe(
      '## (content)',
    );
    expect(sanitizePromptSectionName('## Game State extra')).toBe(
      '## (content)',
    );
  });
});

describe('splitPromptSections', () => {
  it('reports sizes but sanitizes every section label', () => {
    const text = ['## Alpha', 'one', 'two', '## Beta', 'three'].join('\n');
    const sections = splitPromptSections(text);
    // Alpha/Beta are not template labels, so only the size survives.
    expect(sections.map((s) => s.name)).toEqual([
      '## (content)',
      '## (content)',
    ]);
    expect(sections[0].chars).toBe('one\ntwo'.length);
    expect(sections[1].chars).toBe('three'.length);
    expect(sections[1].approxTokens).toBe(approxTokens('three'.length));
  });

  it('labels content before the first header as preamble', () => {
    const text = ['You are the DM.', '', '## Available Tools', '- roll'].join(
      '\n',
    );
    const sections = splitPromptSections(text);
    expect(sections[0].name).toBe('(preamble)');
    expect(sections[1].name).toBe('## Available Tools');
  });

  it('does not emit an empty leading preamble', () => {
    const sections = splitPromptSections('## Game State\nbody');
    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe('## Game State');
  });

  it('never echoes an injected heading, even forging a known label prefix', () => {
    // A player typing a "## ..." line cannot smuggle its text into a label.
    const injected = '## TOTALLY-SECRET-NARRATIVE-PHRASE';
    const sections = splitPromptSections(
      ['## Player Input', injected, 'and more'].join('\n'),
    );
    expect(JSON.stringify(sections)).not.toContain('SECRET-NARRATIVE');
    expect(sections.map((s) => s.name)).toEqual([
      '## Player Input',
      '## (content)',
    ]);
  });

  it('does not run slowly on a heading-like line of pure whitespace (ReDoS guard)', () => {
    // Regression for js/polynomial-redos: literal-prefix detection, no quantifier
    // backtracking on `## ` followed by a long whitespace run.
    const pathological = `## ${' '.repeat(100_000)}`;
    const start = performance.now();
    splitPromptSections(pathological);
    expect(performance.now() - start).toBeLessThan(250);
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
      system: 'You are the DM.\n\n## The Hybrid Contract\nrules',
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
    // System and first user message are broken into named (sanitized) sections.
    expect(event.system?.sections.map((s) => s.name)).toEqual([
      '(preamble)',
      '## The Hybrid Contract',
    ]);
    expect(event.contextSections.map((s) => s.name)).toEqual([
      '## Game State',
      '## Player Input',
    ]);
    expect(event.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(event.messages[1].stopReason).toBe('end_turn');
    expect(event.totalChars).toBe(
      'You are the DM.\n\n## The Hybrid Contract\nrules'.length +
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

  it('keeps injected narrative/secret headings out of the structural event', () => {
    // Mimic renderContextMessage appending raw player input under ## Player
    // Input, where the player typed their own "## ..." heading line.
    const secret = 'SUPER-SECRET-PASSWORD-1234';
    const narrative = 'the-amulet-of-betrayal';
    const event = buildModelCallEvent({
      model: 'm',
      toolProtocolMode: 'fenced-text',
      system: `## Available Tools\n- roll\n## ${secret}\nleak?`,
      messages: [
        {
          role: 'user',
          content: `## Game State\nHP\n\n## Player Input\n## ${narrative}\nI sneak off`,
        },
      ],
      outcome: { ok: true, resultChars: 1, resultApproxTokens: 1 },
      captureContent: false,
    });
    // Structural event carries no content and no injected heading text.
    expect(event.content).toBeUndefined();
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(narrative);
    // The injected headings collapse to the generic placeholder; sizes survive.
    expect(event.system?.sections.map((s) => s.name)).toEqual([
      '## Available Tools',
      '## (content)',
    ]);
    expect(event.contextSections.map((s) => s.name)).toEqual([
      '## Game State',
      '## Player Input',
      '## (content)',
    ]);
  });
});
