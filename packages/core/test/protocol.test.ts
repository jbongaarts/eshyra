import { describe, expect, it } from 'vitest';
import type { ToolResult } from '../src/internal.js';
import {
  buildSystemPrompt,
  createDefaultToolRegistry,
  parseToolCalls,
  renderToolResults,
} from '../src/internal.js';

describe('DM system prompt', () => {
  it('encodes the Hybrid rules contract', () => {
    const prompt = buildSystemPrompt(createDefaultToolRegistry());
    expect(prompt.toLowerCase()).toContain('narrate');
    // All mechanics go through tools, not prose.
    expect(prompt).toMatch(/tool/i);
    // lookup_rules before running any creature or rules mechanic.
    expect(prompt).toContain('lookup_rules');
    expect(prompt.toLowerCase()).toContain('creature');
    // Prompt should be system-neutral.
    expect(prompt).not.toContain('lookup_srd');
    expect(prompt).not.toContain('SRD');
    // state changes must go through domain mutation tools, not narration.
    expect(prompt).toContain('adjust_hp');
  });

  it('lists the available tools and a tool-call protocol section', () => {
    const prompt = buildSystemPrompt(createDefaultToolRegistry());
    for (const name of [
      'roll',
      'mark_scene',
      'lookup_rules',
      'record_world_fact',
    ]) {
      expect(prompt).toContain(name);
    }
    expect(prompt).toContain('## Tool-Call Protocol');
  });

  it('teaches when to promote consequential improvised lore', () => {
    const prompt = buildSystemPrompt(createDefaultToolRegistry());
    expect(prompt).toContain('## Improvised Lore Canon');
    expect(prompt).toContain(
      'Campaign overlay lore is for consequential facts',
    );
    expect(prompt).toContain('Old Renn');
    expect(prompt).toContain('ornate tapestry');
    expect(prompt).toContain('significance "continuity"');
    expect(prompt).toContain('torchlight');
    expect(prompt).toContain('Truth status matters');
  });

  it('teaches roll visibility metadata and engine-owned ledger rendering', () => {
    const prompt = buildSystemPrompt(createDefaultToolRegistry());
    expect(prompt).toContain('Roll visibility metadata');
    expect(prompt).toContain('visibility:"player_visible"');
    expect(prompt).toContain('visibility:"dm_only"');
    expect(prompt).toContain('category');
    expect(prompt).toContain('player attack rolls');
    expect(prompt).toContain('attack rolls against a PC');
    expect(prompt).toContain('hidden enemy stealth/perception');
    expect(prompt).toContain('engine appends the authoritative');
  });

  it('defaults to the native protocol with no fenced tool_call instructions (eshyra-qa9d)', () => {
    // Released gameplay runs on native tool transport (ADR 0010), so the
    // default prompt must describe the native interface and must NOT teach the
    // model to emit fenced ```tool_call blocks — the fenced default was the
    // footgun that made native-tool models report tools as "not present".
    const prompt = buildSystemPrompt(createDefaultToolRegistry());
    expect(prompt).not.toContain('```tool_call');
    expect(prompt).toContain('native tool interface');
  });

  it('describes the fenced protocol only when explicitly requested (legacy/test path)', () => {
    const prompt = buildSystemPrompt(createDefaultToolRegistry(), {
      toolProtocol: 'fenced',
    });
    expect(prompt).toContain('```tool_call');
  });

  it('does not instruct fenced tool_call blocks in native mode (eshyra-eznk)', () => {
    const prompt = buildSystemPrompt(createDefaultToolRegistry(), {
      toolProtocol: 'native',
    });
    // The native tool channel carries the tools; the prompt must NOT tell the
    // model to emit fenced ```tool_call blocks — that confused native-tool
    // models into reporting the described tools were not present.
    expect(prompt).not.toContain('```tool_call');
    expect(prompt).toContain('native tool interface');
    // The tool roster and Hybrid contract still appear so the model knows what
    // is available and what must go through tools.
    for (const name of ['roll', 'mark_scene', 'lookup_rules']) {
      expect(prompt).toContain(name);
    }
    expect(prompt).toContain('## Available Tools');
  });
});

describe('parseToolCalls', () => {
  it('returns no calls for pure narration', () => {
    expect(parseToolCalls('The tavern is warm and loud.')).toEqual([]);
  });

  it('extracts a single tool call', () => {
    const text = [
      'I need to roll for that.',
      '```tool_call',
      '{"tool": "roll", "args": {"dice": "1d20+5", "reason": "attack"}}',
      '```',
    ].join('\n');
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].ok).toBe(true);
    if (calls[0].ok) {
      expect(calls[0].tool).toBe('roll');
      expect(calls[0].args).toEqual({ dice: '1d20+5', reason: 'attack' });
    }
  });

  it('extracts multiple tool calls in order', () => {
    const text = [
      '```tool_call',
      '{"tool": "lookup_rules", "args": {"kind": "creature", "name": "Goblin"}}',
      '```',
      'then',
      '```tool_call',
      '{"tool": "roll", "args": {"dice": "1d20", "reason": "init"}}',
      '```',
    ].join('\n');
    const calls = parseToolCalls(text);
    expect(calls.map((c) => (c.ok ? c.tool : 'ERR'))).toEqual([
      'lookup_rules',
      'roll',
    ]);
  });

  it('reports malformed JSON as a parse error rather than throwing', () => {
    const text = ['```tool_call', '{not json}', '```'].join('\n');
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].ok).toBe(false);
  });

  it('reports a missing tool name as a parse error', () => {
    const text = ['```tool_call', '{"args": {}}', '```'].join('\n');
    const calls = parseToolCalls(text);
    expect(calls[0].ok).toBe(false);
  });
});

describe('renderToolResults', () => {
  it('round-trips results back into a model-readable message', () => {
    const results: Array<{ tool: string; result: ToolResult }> = [
      { tool: 'roll', result: { ok: true, data: { total: 17 } } },
      {
        tool: 'mutate_state',
        result: { ok: false, code: 'mutate_error', message: 'bad field' },
      },
    ];
    const message = renderToolResults(results);
    expect(message).toContain('tool_result');
    expect(message).toContain('roll');
    expect(message).toContain('17');
    expect(message).toContain('mutate_error');
    expect(message).toContain('bad field');
  });
});
