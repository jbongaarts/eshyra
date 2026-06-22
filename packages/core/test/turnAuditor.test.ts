import { describe, expect, it } from 'vitest';
import type {
  ModelClient,
  ModelCompleteInput,
  ModelCompleteResult,
} from '../src/model/client.js';
import type { StateSnapshot } from '../src/orchestrator/contextAssembler.js';
import {
  AuditError,
  buildAuditSystemPrompt,
  buildAuditUserMessage,
  formatMissingCall,
  ModelTurnAuditor,
  parseAuditVerdict,
} from '../src/orchestrator/turnAuditor.js';
import type { ExecutedToolCall } from '../src/orchestrator/turnLoop.js';

/**
 * Unit coverage for the mechanics-audit gate (eshyra-oobh): strict-JSON verdict
 * parsing and the model-backed auditor. No live model call — the auditor's model
 * client is a deterministic fake.
 */

/** A model client that records its input and returns a fixed text reply. */
class FakeAuditModel implements ModelClient {
  readonly seen: ModelCompleteInput[] = [];
  constructor(private readonly reply: string) {}
  complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    this.seen.push(input);
    return Promise.resolve({ text: this.reply });
  }
}

const rollExecuted: ExecutedToolCall = {
  tool: 'roll',
  args: { dice: '2d8' },
  result: { ok: true, data: { total: 11 } },
  mutates: false,
  source: 'native-mcp',
};

const emptyInventorySnapshot: StateSnapshot = {
  character: {
    id: 'pc-1',
    name: 'Mira',
    ancestry: 'Human',
    className: 'Fighter',
    level: 1,
    hpCurrent: 10,
    hpMax: 10,
    abilityScores: {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    },
    conditions: [],
    role: 'pc',
  },
  inventory: [],
  plotFlags: {},
  clock: { inGameTime: '', currentLocationId: undefined },
};

class QuantityEvidenceAuditModel implements ModelClient {
  readonly seen: ModelCompleteInput[] = [];
  complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    this.seen.push(input);
    const evidence = input.messages[0]?.content ?? '';
    const supported =
      evidence.includes('\\"id\\":\\"torch\\"') &&
      evidence.includes('\\"quantity\\":10');
    return Promise.resolve({
      text: supported
        ? '{"verdict":"accept","missingRequiredTools":[]}'
        : '{"verdict":"reject","missingRequiredTools":["give_item"],"reason":"quantity unsupported","repairInstruction":"give 10 torches"}',
    });
  }
}

describe('parseAuditVerdict', () => {
  it('parses a clean accept verdict', () => {
    const v = parseAuditVerdict(
      '{"verdict":"accept","missingRequiredTools":[],"reason":"ok","repairInstruction":""}',
    );
    expect(v.verdict).toBe('accept');
    expect(v.missingRequiredTools).toEqual([]);
  });

  it('parses a reject verdict with missing tools', () => {
    const v = parseAuditVerdict(
      '{"verdict":"reject","missingRequiredTools":["roll"],"reason":"dice without roll","repairInstruction":"call roll"}',
    );
    expect(v.verdict).toBe('reject');
    expect(v.missingRequiredTools).toEqual(['roll']);
    expect(v.repairInstruction).toBe('call roll');
  });

  it('tolerates a fenced JSON block', () => {
    const v = parseAuditVerdict(
      '```json\n{"verdict":"accept","missingRequiredTools":[]}\n```',
    );
    expect(v.verdict).toBe('accept');
  });

  it('tolerates surrounding prose by extracting the object', () => {
    const v = parseAuditVerdict(
      'Here is my verdict: {"verdict":"reject","missingRequiredTools":["roll"]} done.',
    );
    expect(v.verdict).toBe('reject');
    expect(v.missingRequiredTools).toEqual(['roll']);
  });

  it('throws AuditError on a non-JSON reply', () => {
    expect(() => parseAuditVerdict('I think it is fine')).toThrowError(
      AuditError,
    );
  });

  it('throws AuditError on an invalid verdict value', () => {
    expect(() =>
      parseAuditVerdict('{"verdict":"maybe","missingRequiredTools":[]}'),
    ).toThrowError(AuditError);
  });

  it('parses disallowedToolCalls on an explicit-action violation (eshyra-4ia4)', () => {
    const v = parseAuditVerdict(
      '{"verdict":"reject","missingRequiredTools":[],"disallowedToolCalls":["give_item"],"reason":"mutated to answer a query","repairInstruction":"do not mutate"}',
    );
    expect(v.verdict).toBe('reject');
    expect(v.missingRequiredTools).toEqual([]);
    expect(v.disallowedToolCalls).toEqual(['give_item']);
  });

  it('defaults disallowedToolCalls to empty when the field is absent', () => {
    const v = parseAuditVerdict(
      '{"verdict":"accept","missingRequiredTools":[]}',
    );
    expect(v.disallowedToolCalls).toEqual([]);
  });

  it('parses target-specific missingRequiredCalls (eshyra-znzn)', () => {
    const v = parseAuditVerdict(
      '{"verdict":"reject","missingRequiredCalls":[{"tool":"lookup_rules","target":"chain mail"},{"tool":"lookup_rules","target":"shield"},{"tool":"lookup_rules","target":"longsword"}],"reason":"r","repairInstruction":"look each up"}',
    );
    expect(v.missingRequiredCalls).toEqual([
      { tool: 'lookup_rules', target: 'chain mail' },
      { tool: 'lookup_rules', target: 'shield' },
      { tool: 'lookup_rules', target: 'longsword' },
    ]);
    // The coarse tool-name projection deduplicates the repeated tool.
    expect(v.missingRequiredTools).toEqual(['lookup_rules']);
  });

  it('derives missingRequiredCalls from a legacy tool-only verdict (eshyra-znzn)', () => {
    const v = parseAuditVerdict(
      '{"verdict":"reject","missingRequiredTools":["roll"],"reason":"r","repairInstruction":"call roll"}',
    );
    // A verdict that only knows the tool name still yields a structured entry
    // (with no target), so downstream consumers can read one shape.
    expect(v.missingRequiredCalls).toEqual([{ tool: 'roll' }]);
    expect(v.missingRequiredTools).toEqual(['roll']);
  });

  it('folds a legacy tool only when not already covered by structured calls (eshyra-znzn)', () => {
    const v = parseAuditVerdict(
      '{"verdict":"reject","missingRequiredCalls":[{"tool":"lookup_rules","target":"shield"}],"missingRequiredTools":["lookup_rules","roll"]}',
    );
    // lookup_rules already has a target-specific entry, so the redundant coarse
    // name is not appended; roll (uncovered) is folded in.
    expect(v.missingRequiredCalls).toEqual([
      { tool: 'lookup_rules', target: 'shield' },
      { tool: 'roll' },
    ]);
    expect(v.missingRequiredTools).toEqual(['lookup_rules', 'roll']);
  });

  it('drops a blank target to a tool-only entry (eshyra-znzn)', () => {
    const v = parseAuditVerdict(
      '{"verdict":"reject","missingRequiredCalls":[{"tool":"roll","target":"  "}]}',
    );
    expect(v.missingRequiredCalls).toEqual([{ tool: 'roll' }]);
  });

  it('ignores malformed missingRequiredCalls entries (eshyra-znzn)', () => {
    const v = parseAuditVerdict(
      '{"verdict":"reject","missingRequiredCalls":[{"target":"no tool"},null,42,{"tool":"roll"}]}',
    );
    expect(v.missingRequiredCalls).toEqual([{ tool: 'roll' }]);
  });
});

describe('formatMissingCall (eshyra-znzn)', () => {
  it('renders tool and target when target is present', () => {
    expect(
      formatMissingCall({ tool: 'lookup_rules', target: 'chain mail' }),
    ).toBe('lookup_rules (target: chain mail)');
  });

  it('renders the tool alone when no target is known', () => {
    expect(formatMissingCall({ tool: 'roll' })).toBe('roll');
  });
});

describe('audit prompt explicit-action policy (eshyra-4ia4)', () => {
  it('system prompt directs the auditor to evaluate explicit player action intent', () => {
    const prompt = buildAuditSystemPrompt();
    expect(prompt).toContain('explicit-action-only');
    expect(prompt).toContain('explicit action intent');
    expect(prompt).toContain('disallowedToolCalls');
  });

  it('user message lists the explicit-action-only tools for the turn', () => {
    const message = buildAuditUserMessage({
      playerInput: 'What am I equipped with?',
      candidateResponse: 'I add a sword to your pack.',
      providedToolNames: ['give_item', 'world_query'],
      executedToolCalls: [],
      requiresExplicitActionTools: ['give_item', 'remove_item'],
    });
    expect(message).toContain('## Explicit-Action-Only Tools');
    expect(message).toContain('give_item, remove_item');
    expect(message).toContain('What am I equipped with?');
  });

  it('user message renders (none) when no tools gate on explicit action', () => {
    const message = buildAuditUserMessage({
      playerInput: 'roll 2d8',
      candidateResponse: 'You rolled an 11.',
      providedToolNames: ['roll'],
      executedToolCalls: [],
    });
    expect(message).toContain('## Explicit-Action-Only Tools\n(none)');
  });
});

describe('audit prompt current-state evidence (eshyra-n01v)', () => {
  it('treats the current snapshot as evidence and limits drilldown to absent state', () => {
    const prompt = buildAuditSystemPrompt();
    expect(prompt).toContain('Current State Snapshot is evidence');
    expect(prompt).toContain('empty inventory array supports');
    expect(prompt).toContain('older,');
    expect(prompt).toContain('archived, or otherwise absent state');
    expect(prompt).toContain('Reject claims that contradict or add');
  });

  it('includes an empty inventory snapshot in the audit evidence', () => {
    const message = buildAuditUserMessage({
      playerInput: 'What equipment do I have?',
      candidateResponse: 'You have no equipment recorded.',
      providedToolNames: ['memory_drilldown'],
      executedToolCalls: [],
      currentStateSnapshot: emptyInventorySnapshot,
    });

    expect(message).toContain('## Current State Snapshot');
    expect(message).toContain('"inventory":[]');
    expect(message).toContain('You have no equipment recorded.');
  });

  it('marks the snapshot absent instead of implying current-state evidence', () => {
    const message = buildAuditUserMessage({
      playerInput: 'What sword did I lose last year?',
      candidateResponse: 'It was a silver longsword.',
      providedToolNames: ['memory_drilldown'],
      executedToolCalls: [],
    });

    expect(message).toContain('## Current State Snapshot\n(not supplied)');
  });
});

describe('ModelTurnAuditor', () => {
  it.each([
    { quantity: 10, expected: 'accept' },
    { quantity: 1, expected: 'reject' },
    { quantity: undefined, expected: 'reject' },
  ] as const)('accepts a 10-torch claim only with quantity 10 evidence ($quantity)', async ({
    quantity,
    expected,
  }) => {
    const model = new QuantityEvidenceAuditModel();
    const auditor = new ModelTurnAuditor(model, 'm');
    const args = {
      id: 'torch',
      name: 'Torch',
      ...(quantity === undefined ? {} : { quantity }),
    };

    const verdict = await auditor.audit({
      playerInput: 'Give Bob ten torches.',
      candidateResponse: 'Bob now has 10 torches.',
      providedToolNames: ['give_item'],
      executedToolCalls: [
        {
          tool: 'give_item',
          args,
          result: {
            ok: true,
            data: {
              applied: true,
              id: 'torch',
              name: 'Torch',
              quantity: quantity ?? 1,
            },
          },
          mutates: true,
          source: 'native-mcp',
        },
      ],
    });

    expect(verdict.verdict).toBe(expected);
  });

  it('bounds and redacts original tool arguments in audit evidence', () => {
    const message = buildAuditUserMessage({
      playerInput: 'Give Bob a torch.',
      candidateResponse: 'Done.',
      providedToolNames: ['give_item'],
      executedToolCalls: [
        {
          tool: 'give_item',
          args: {
            id: 'torch',
            token: 'sk-test-abcdefghijklmnopqrstuvwxyz',
            properties: { notes: 'x'.repeat(2_000) },
          },
          result: { ok: true, data: { applied: true } },
          mutates: true,
          source: 'native-mcp',
        },
      ],
    });

    expect(message).toContain('[redacted]');
    expect(message).not.toContain('sk-test-abcdefghijklmnopqrstuvwxyz');
    expect(message.length).toBeLessThan(2_000);
  });

  it('delegates to the model and returns the parsed verdict', async () => {
    const model = new FakeAuditModel(
      '{"verdict":"reject","missingRequiredTools":["roll"],"reason":"r","repairInstruction":"call roll"}',
    );
    const auditor = new ModelTurnAuditor(model, 'claude-haiku-test');

    const verdict = await auditor.audit({
      playerInput: 'roll 2d8',
      candidateResponse: 'You rolled an 11.',
      providedToolNames: ['roll', 'world_query'],
      executedToolCalls: [],
    });

    expect(verdict.verdict).toBe('reject');
    expect(auditor.modelId).toBe('claude-haiku-test');
    // The auditor asks for JSON and carries NO Eshyra tools (it only judges).
    expect(model.seen).toHaveLength(1);
    expect(model.seen[0].responseFormat).toBe('json');
    expect(model.seen[0].tools).toBeUndefined();
  });

  it('includes executed tool calls (incl. native-mcp) and provided tools in the prompt', async () => {
    const model = new FakeAuditModel(
      '{"verdict":"accept","missingRequiredTools":[]}',
    );
    const auditor = new ModelTurnAuditor(model, 'm');

    await auditor.audit({
      playerInput: 'roll 2d8',
      candidateResponse: 'You rolled an 11.',
      providedToolNames: ['roll'],
      executedToolCalls: [rollExecuted],
    });

    const userMessage = model.seen[0].messages[0].content;
    expect(userMessage).toContain('roll');
    expect(userMessage).toContain('native-mcp');
    // The candidate and player input are presented for judgement.
    expect(userMessage).toContain('You rolled an 11.');
    expect(userMessage).toContain('roll 2d8');
  });

  it('forwards explicit-action-only tools and returns disallowedToolCalls (eshyra-4ia4)', async () => {
    const model = new FakeAuditModel(
      '{"verdict":"reject","missingRequiredTools":[],"disallowedToolCalls":["give_item"],"reason":"r","repairInstruction":"do not mutate"}',
    );
    const auditor = new ModelTurnAuditor(model, 'm');

    const verdict = await auditor.audit({
      playerInput: 'What am I equipped with?',
      candidateResponse: 'I add a longsword to your pack.',
      providedToolNames: ['give_item', 'world_query'],
      executedToolCalls: [
        {
          tool: 'give_item',
          args: { id: 'longsword', name: 'Longsword' },
          result: { ok: true, data: { id: 'longsword' } },
          mutates: true,
          source: 'native-mcp',
        },
      ],
      requiresExplicitActionTools: ['give_item', 'remove_item'],
    });

    expect(verdict.verdict).toBe('reject');
    expect(verdict.disallowedToolCalls).toEqual(['give_item']);
    // The auditor was told which tools require explicit action.
    expect(model.seen[0].messages[0].content).toContain(
      '## Explicit-Action-Only Tools',
    );
    expect(model.seen[0].messages[0].content).toContain(
      'give_item, remove_item',
    );
  });

  it('forwards the audit trace purpose for debug labelling', async () => {
    const model = new FakeAuditModel(
      '{"verdict":"accept","missingRequiredTools":[]}',
    );
    const auditor = new ModelTurnAuditor(model, 'm');
    await auditor.audit({
      playerInput: 'p',
      candidateResponse: 'c',
      providedToolNames: [],
      executedToolCalls: [],
      trace: { sessionId: 's1', extra: { purpose: 'turn_audit' } },
    });
    expect(model.seen[0].trace?.extra?.purpose).toBe('turn_audit');
  });
});
