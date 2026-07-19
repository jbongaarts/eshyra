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

  it('system prompt directs the auditor to evaluate roll visibility metadata', () => {
    const prompt = buildAuditSystemPrompt();
    expect(prompt).toContain('Player-affecting roll visibility');
    expect(prompt).toContain('visibility');
    expect(prompt).toContain('category');
    expect(prompt).toContain('visibility:"dm_only"');
    expect(prompt).toContain('death save');
    expect(prompt).toContain(
      'hand-written roll result contradicts tool output',
    );
    expect(prompt).toContain('enemy stealth/perception');
  });

  it('requires exact slot-spend and source-bound upcast evidence', () => {
    const prompt = buildAuditSystemPrompt();
    expect(prompt).toContain('narrated leveled-spell cast');
    expect(prompt).toContain('successful `spend_spell_slot`');
    expect(prompt).toContain('exact casting character and canonical spell');
    expect(prompt).toContain('selected slot must');
    expect(prompt).toContain('lookup alone does not substantiate a cast');
    expect(prompt).toContain('successful `resolve_spell_upcast`');
    expect(prompt).toContain('clause/source binding');
    expect(prompt).toContain('Reject hand-computed, mismatched, failed');
  });

  it('requires an embedded payment for identity-preserving repurchase', () => {
    const prompt = buildAuditSystemPrompt();
    expect(prompt).toContain('basis `repurchased`');
    expect(prompt).toContain('embedded nonempty');
    expect(prompt).toContain('separate unlinked `spend_currency`');
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

describe('audit prompt campaign overlay lore evidence', () => {
  it('instructs the auditor on lore recording, failed calls, and truth status', () => {
    const prompt = buildAuditSystemPrompt();
    expect(prompt).toContain('record_world_fact');
    expect(prompt).toContain(
      'Failed tool calls (`ok:false`) are never evidence',
    );
    expect(prompt).toContain('successful `record_world_fact`');
    expect(prompt).toContain('rumor/reported/believed');
    expect(prompt).toContain('does NOT support "X is true"');
    expect(prompt).toContain('Overlay visibility is binding');
    expect(prompt).toContain('`dm_only` overlay lore');
    expect(prompt).toContain('must not be narrated as player-facing support');
    expect(prompt).toContain('continuity_dressing');
    expect(prompt).toContain('descriptive');
    expect(prompt).toContain('not plot significance');
  });

  it('summarizes current-turn recorded overlay lore by canon tier', () => {
    const message = buildAuditUserMessage({
      playerInput: 'What is wrong in town?',
      candidateResponse:
        'Villagers report Old Renn is missing and his mule came back alone.',
      providedToolNames: ['record_world_fact', 'world_query'],
      executedToolCalls: [
        {
          tool: 'record_world_fact',
          args: { subjectText: 'Old Renn' },
          result: {
            ok: true,
            data: {
              canonTier: 'campaign_overlay_lore',
              record: {
                id: 'old-renn-rumor',
                fact: 'Old Renn is missing.',
                truthStatus: 'reported',
                visibility: 'player_visible',
              },
            },
          },
          mutates: true,
          source: 'native',
        },
      ],
    });

    expect(message).toContain('## Canon-Tier Evidence Summary');
    expect(message).toContain('campaign_overlay_lore');
    expect(message).toContain('old-renn-rumor');
    expect(message).toContain('reported');
    expect(message).toContain('player_visible');
  });

  it('summarizes continuity dressing without upgrading it to plot proof', () => {
    const message = buildAuditUserMessage({
      playerInput: 'What do I see in the square?',
      candidateResponse:
        'The ornate tapestry still hangs from the west market awning.',
      providedToolNames: ['world_query'],
      executedToolCalls: [
        {
          tool: 'world_query',
          args: { type: 'location', id: 'emberfall-square' },
          result: {
            ok: true,
            data: {
              ok: true,
              type: 'location',
              evidence: [
                {
                  tier: 'continuity_dressing',
                  id: 'emberfall-square-tapestry',
                  visibility: 'player_visible',
                  summary:
                    'Emberfall Square: An ornate tapestry hangs from the west market awning.',
                },
              ],
            },
          },
          mutates: false,
          source: 'native',
        },
      ],
    });

    expect(message).toContain('continuity_dressing');
    expect(message).toContain('emberfall-square-tapestry');
    expect(message).toContain('ornate tapestry');
  });

  it('exposes dm_only and mixed visibility in debug evidence summaries', () => {
    const message = buildAuditUserMessage({
      playerInput: 'What do I know about Old Renn?',
      candidateResponse: 'You do not know the hidden kidnapper yet.',
      providedToolNames: ['world_query'],
      executedToolCalls: [
        {
          tool: 'world_query',
          args: { type: 'search', query: 'Old Renn' },
          result: {
            ok: true,
            data: {
              ok: true,
              type: 'search',
              evidence: [
                {
                  tier: 'campaign_overlay_lore',
                  id: 'visible-hook',
                  visibility: 'player_visible',
                  summary: 'Old Renn is missing.',
                },
                {
                  tier: 'campaign_overlay_lore',
                  id: 'hidden-kidnapper',
                  visibility: 'dm_only',
                  summary: 'The reeve staged the disappearance.',
                },
                {
                  tier: 'campaign_overlay_lore',
                  id: 'mixed-rumor',
                  visibility: 'mixed',
                  summary: 'Villagers know only part of the rumor.',
                },
              ],
            },
          },
          mutates: false,
          source: 'native',
        },
      ],
    });

    expect(message).toContain('hidden-kidnapper');
    expect(message).toContain('dm_only');
    expect(message).toContain('mixed-rumor');
    expect(message).toContain('mixed');
  });

  it('marks failed world_query calls as non-evidence', () => {
    const message = buildAuditUserMessage({
      playerInput: 'What does the north gate show?',
      candidateResponse: 'The north gate has axe-cuts.',
      providedToolNames: ['world_query'],
      executedToolCalls: [
        {
          tool: 'world_query',
          args: { type: 'location', id: 'north-gate' },
          result: {
            ok: false,
            code: 'not_found',
            message: 'no location',
          },
          mutates: false,
          source: 'native',
        },
      ],
    });

    expect(message).toContain('failed_tool_call_not_evidence');
    expect(message).toContain('not_found');
  });
});

describe('audit prompt recent scene evidence', () => {
  it('instructs the auditor that recent scene evidence is weak same-scene support', () => {
    const prompt = buildAuditSystemPrompt();
    expect(prompt).toContain('Recent Scene Evidence');
    expect(prompt).toContain('accepted same-scene continuity evidence only');
    expect(prompt).toContain('weaker than module canon');
    expect(prompt).toContain('consequential long-term facts still require');
  });

  it('includes compact accepted scene facts in the audit evidence', () => {
    const message = buildAuditUserMessage({
      playerInput: 'What should I expect if I investigate?',
      candidateResponse:
        'The missing scouts suggest trouble along the north road.',
      providedToolNames: ['record_world_fact', 'world_query'],
      executedToolCalls: [],
      recentSceneEvidence: [
        {
          tier: 'scene_fact',
          source: 'scene_log',
          sceneId: 'scene-sela',
          turnId: 'turn-1',
          seq: 2,
          summary: 'Warden Sela says two scouts went north and did not return.',
        },
      ],
    });

    expect(message).toContain('## Recent Scene Evidence');
    expect(message).toContain('tier `scene_fact`');
    expect(message).toContain('Warden Sela says two scouts');
    expect(message).toContain('weaker than module canon');
  });

  it('marks recent scene evidence absent rather than inventing support', () => {
    const message = buildAuditUserMessage({
      playerInput: 'Remind me what Sela said last scene.',
      candidateResponse: 'She said two scouts were missing.',
      providedToolNames: ['record_world_fact', 'world_query'],
      executedToolCalls: [],
    });

    expect(message).toContain('## Recent Scene Evidence\n(none)');
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

  it('sanitizes set_plot_flag out of disallowedToolCalls and requires record_world_fact', async () => {
    const model = new FakeAuditModel(
      '{"verdict":"reject","missingRequiredTools":[],"disallowedToolCalls":["set_plot_flag"],"reason":"set_plot_flag is not valid lore support","repairInstruction":"do not use set_plot_flag"}',
    );
    const auditor = new ModelTurnAuditor(model, 'm');

    const verdict = await auditor.audit({
      playerInput: 'What did Sela say?',
      candidateResponse:
        'Bob learned that Warden Sela lost two scouts near the hollow.',
      providedToolNames: ['set_plot_flag', 'record_world_fact'],
      executedToolCalls: [
        {
          tool: 'set_plot_flag',
          args: {
            key: 'bob-learned-sela-scouts',
            value: true,
          },
          result: { ok: true, data: { applied: true } },
          mutates: true,
          source: 'native-mcp',
        },
      ],
      requiresExplicitActionTools: [],
    });

    expect(verdict.verdict).toBe('reject');
    expect(verdict.disallowedToolCalls).toEqual([]);
    expect(verdict.missingRequiredTools).toEqual(['record_world_fact']);
    expect(verdict.missingRequiredCalls).toEqual([
      {
        tool: 'record_world_fact',
        target: 'consequential improvised lore asserted with set_plot_flag',
      },
    ]);
    expect(verdict.reason).toContain(
      'Sanitized invalid disallowedToolCalls classification(s): set_plot_flag',
    );
    expect(verdict.repairInstruction).toContain('record_world_fact');
  });

  it('preserves truly explicit-action-only disallowed tools while filtering invalid ones', async () => {
    const model = new FakeAuditModel(
      '{"verdict":"reject","missingRequiredTools":[],"disallowedToolCalls":["give_item","set_plot_flag"],"reason":"bad mutation","repairInstruction":"do not mutate"}',
    );
    const auditor = new ModelTurnAuditor(model, 'm');

    const verdict = await auditor.audit({
      playerInput: 'What am I carrying?',
      candidateResponse: 'You gain a torch, and I mark the plot flag.',
      providedToolNames: ['give_item', 'set_plot_flag', 'record_world_fact'],
      executedToolCalls: [],
      requiresExplicitActionTools: ['give_item'],
    });

    expect(verdict.verdict).toBe('reject');
    expect(verdict.disallowedToolCalls).toEqual(['give_item']);
    expect(verdict.missingRequiredTools).toEqual(['record_world_fact']);
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
