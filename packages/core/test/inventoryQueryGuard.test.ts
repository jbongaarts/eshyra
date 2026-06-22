/**
 * Tests for the inventory query vs. action guard (eshyra-4ia4).
 *
 * Verifies:
 * - give_item and remove_item are classified as requiresExplicitAction
 * - The system prompt includes the inventory guard section
 * - A query ("What am I equipped with?") with empty inventory produces no mutations
 * - A query with existing inventory reports items without mutation
 * - An explicit player action may call give_item
 */
import { describe, expect, it } from 'vitest';
import type {
  ModelCompleteInput,
  ModelCompleteResult,
} from '../src/internal.js';
import {
  buildSystemPrompt,
  createDefaultToolRegistry,
  DEFAULT_TOOLS,
  ModelTurnAuditor,
  openScene,
  runTurn,
  ToolRegistry,
} from '../src/internal.js';
import { freshDbWithSession } from './support/db.js';

const CAMPAIGN = 'campaign-1';
const SESSION = 'session-1';

/** A ModelClient that replays a fixed script of replies, one per call. */
class ScriptedModel {
  private index = 0;
  readonly seen: ModelCompleteInput[] = [];
  constructor(private readonly replies: string[]) {}
  complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    this.seen.push(input);
    const reply = this.replies[this.index] ?? '';
    this.index += 1;
    return Promise.resolve({ text: reply });
  }
}

const toolCall = (tool: string, args: unknown): string =>
  ['```tool_call', JSON.stringify({ tool, args }), '```'].join('\n');

/**
 * A stand-in for the auditor model that deterministically simulates the
 * intent-evaluation the live auditor performs (eshyra-4ia4). It reads the audit
 * message the orchestrator actually built, finds which explicit-action-only
 * tools the candidate executed, and rejects them when the player input shows no
 * explicit action intent — exactly the judgement the real model is prompted to
 * make. This exercises the full enforcement chain (orchestrator wiring →
 * buildAuditUserMessage → parseAuditVerdict → savepoint rollback) without a live
 * model call.
 */
class IntentSimulatingAuditModel {
  readonly seen: ModelCompleteInput[] = [];

  complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    this.seen.push(input);
    const message = String(input.messages[0]?.content ?? '');
    const section = (start: string, end: string): string => {
      const from = message.indexOf(start);
      if (from === -1) return '';
      const sliceStart = from + start.length;
      const to = message.indexOf(end, sliceStart);
      return message.slice(sliceStart, to === -1 ? undefined : to).trim();
    };

    const explicitTools = section(
      '## Explicit-Action-Only Tools\n',
      '\n\n## Executed Tool Calls This Turn',
    );
    const executed = section(
      '## Executed Tool Calls This Turn\n',
      '\n\n## Player Input',
    );
    const playerInput = section(
      '## Player Input\n',
      '\n\n## Candidate DM Response',
    );

    // Action intent: the player explicitly performs an action ("I buy a torch").
    const hasActionIntent =
      /\b(buy|buys|bought|purchase|purchases|pick(?:s)? up|take(?:s)?|grab(?:s)?|drop(?:s)?|equip(?:s)?|wield(?:s)?|loot(?:s)?|give(?:s)?|hand(?:s)?|accept(?:s)?)\b/i.test(
        playerInput,
      );

    // The section reads "give_item, remove_item — <description>"; the tool names
    // are the comma list before the em dash.
    const gatedNames = explicitTools
      .split('—')[0]
      .split(',')
      .map((t) => t.trim())
      .filter((t) => /^[a-z_]+$/.test(t));
    const disallowed = gatedNames.filter(
      (name) => executed.includes(`"tool":"${name}"`) && !hasActionIntent,
    );

    const verdict =
      disallowed.length > 0
        ? {
            verdict: 'reject',
            missingRequiredTools: [],
            disallowedToolCalls: disallowed,
            reason: 'explicit-action-only tool called to answer a state query',
            repairInstruction:
              'Report current inventory; do not mutate state to answer a query.',
          }
        : {
            verdict: 'accept',
            missingRequiredTools: [],
            disallowedToolCalls: [],
            reason: 'ok',
            repairInstruction: '',
          };
    return Promise.resolve({ text: JSON.stringify(verdict) });
  }
}

/** Accepts an empty-inventory answer only when the orchestrator supplies it. */
class SnapshotEvidenceAuditModel {
  readonly seen: ModelCompleteInput[] = [];

  complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    this.seen.push(input);
    const message = String(input.messages[0]?.content ?? '');
    const hasEmptyInventoryEvidence = message.includes('"inventory":[]');
    return Promise.resolve({
      text: JSON.stringify(
        hasEmptyInventoryEvidence
          ? {
              verdict: 'accept',
              missingRequiredCalls: [],
              disallowedToolCalls: [],
              reason: 'empty inventory is established by current state',
              repairInstruction: '',
            }
          : {
              verdict: 'reject',
              missingRequiredCalls: [
                { tool: 'memory_drilldown', target: 'inventory' },
              ],
              disallowedToolCalls: [],
              reason: 'inventory state is absent from supplied evidence',
              repairInstruction: 'Retrieve the inventory state.',
            },
      ),
    });
  }
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    campaignId: CAMPAIGN,
    sessionId: SESSION,
    turnId: 'turn-1',
    playerInput: 'What am I equipped with?',
    seed: 42,
    at: '2026-05-20T10:00:00.000Z',
    ...overrides,
  };
}

function withOpenScene(db: ReturnType<typeof freshDbWithSession>): void {
  openScene(db, {
    campaignId: CAMPAIGN,
    sessionId: SESSION,
    sceneId: 'scene-0',
    title: 'The Tavern',
    at: '2026-05-20T09:00:00.000Z',
  });
}

function inventoryCount(db: ReturnType<typeof freshDbWithSession>): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM inventory').get() as {
    n: number;
  };
  return row.n;
}

// ---------------------------------------------------------------------------
// Tool metadata
// ---------------------------------------------------------------------------

describe('inventory tool classification (eshyra-4ia4)', () => {
  it('give_item and remove_item are flagged requiresExplicitAction', () => {
    for (const tool of DEFAULT_TOOLS) {
      if (tool.name === 'give_item' || tool.name === 'remove_item') {
        expect(
          tool.requiresExplicitAction,
          `${tool.name} should have requiresExplicitAction: true`,
        ).toBe(true);
      }
    }
  });

  it('read-only tools do not have requiresExplicitAction', () => {
    const readOnly = [
      'roll',
      'lookup_rules',
      'world_query',
      'memory_drilldown',
    ];
    for (const tool of DEFAULT_TOOLS) {
      if (readOnly.includes(tool.name)) {
        expect(
          tool.requiresExplicitAction,
          `${tool.name} should not have requiresExplicitAction`,
        ).toBeFalsy();
      }
    }
  });

  it('listRequiresExplicitAction returns give_item and remove_item', () => {
    const registry = createDefaultToolRegistry();
    const names = registry.listRequiresExplicitAction().sort();
    expect(names).toContain('give_item');
    expect(names).toContain('remove_item');
  });

  it('give_item description warns against calling for queries', () => {
    const tool = DEFAULT_TOOLS.find((t) => t.name === 'give_item');
    expect(tool?.description.toLowerCase()).toContain('never');
    expect(tool?.description.toLowerCase()).toMatch(/question|query/);
  });

  it('remove_item description warns against calling for queries', () => {
    const tool = DEFAULT_TOOLS.find((t) => t.name === 'remove_item');
    expect(tool?.description.toLowerCase()).toContain('never');
    expect(tool?.description.toLowerCase()).toMatch(/question|query/);
  });
});

// ---------------------------------------------------------------------------
// System prompt guard section
// ---------------------------------------------------------------------------

describe('system prompt inventory guard (eshyra-4ia4)', () => {
  it('includes the Inventory and Equipment Guard section', () => {
    const prompt = buildSystemPrompt(createDefaultToolRegistry());
    expect(prompt).toContain('Inventory and Equipment Guard');
  });

  it('names give_item and remove_item as requiring explicit action', () => {
    const prompt = buildSystemPrompt(createDefaultToolRegistry());
    expect(prompt).toContain('give_item');
    expect(prompt).toContain('remove_item');
    expect(prompt).toContain('explicit player action intent');
  });

  it('instructs the model to report empty inventory rather than populating it', () => {
    const prompt = buildSystemPrompt(createDefaultToolRegistry());
    expect(prompt.toLowerCase()).toContain('empty');
    expect(prompt.toLowerCase()).toContain('equipment selection');
  });

  it('guard section appears in both fenced and native protocol variants', () => {
    for (const toolProtocol of ['fenced', 'native'] as const) {
      const prompt = buildSystemPrompt(createDefaultToolRegistry(), {
        toolProtocol,
      });
      expect(prompt, `${toolProtocol} prompt should contain guard`).toContain(
        'Inventory and Equipment Guard',
      );
    }
  });

  it('guard section is absent when no tools require explicit action', () => {
    const emptyRegistry = new ToolRegistry();
    const prompt = buildSystemPrompt(emptyRegistry);
    expect(prompt).not.toContain('Inventory and Equipment Guard');
  });
});

// ---------------------------------------------------------------------------
// AC1: query with empty inventory — no mutations
// ---------------------------------------------------------------------------

describe('AC1: inventory query with empty inventory does not mutate (eshyra-4ia4)', () => {
  it('accepts "What equipment do I have?" from the empty current snapshot without drilldown (eshyra-n01v)', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel([
      'You have nothing recorded in your inventory.',
    ]);
    const auditModel = new SnapshotEvidenceAuditModel();
    const auditor = new ModelTurnAuditor(auditModel, 'snapshot-audit');

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry(), auditor },
      baseInput({ playerInput: 'What equipment do I have?' }),
    );

    expect(result.ok).toBe(true);
    expect(result.toolCalls).toHaveLength(0);
    expect(inventoryCount(db)).toBe(0);
    expect(auditModel.seen).toHaveLength(1);
    expect(auditModel.seen[0].messages[0].content).toContain('"inventory":[]');
    db.close();
  });

  it('reports empty inventory without calling give_item', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    // Model correctly follows the protocol: reports empty inventory, no tool call.
    const model = new ScriptedModel([
      'You have nothing recorded in your inventory. Would you like to begin selecting your starting equipment?',
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput({ playerInput: 'What am I equipped with?' }),
    );

    expect(result.ok).toBe(true);
    expect(result.toolCalls).toHaveLength(0);
    expect(inventoryCount(db)).toBe(0);
    expect(result.narration).toContain('nothing');
    db.close();
  });

  it('no mutation when player asks about pack contents with empty inventory', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel([
      'You have nothing in your inventory. Shall we set up your starting equipment?',
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput({ playerInput: 'What do I have in my pack?' }),
    );

    expect(result.ok).toBe(true);
    expect(inventoryCount(db)).toBe(0);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// AC2: query with existing inventory — reports items, no mutation
// ---------------------------------------------------------------------------

describe('AC2: inventory query with existing items does not mutate (eshyra-4ia4)', () => {
  it('reports existing inventory without additional give_item calls', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);

    // Pre-populate inventory directly (simulating prior gameplay).
    db.prepare(
      `INSERT INTO inventory (id, character_id, name, quantity, location, properties_json, provenance, session_id, updated_at)
       VALUES ('longsword', 'pc-1', 'Longsword', 1, 'worn', '{}', 'test:setup', ?, ?)`,
    ).run(SESSION, '2026-05-20T09:00:00.000Z');
    db.prepare(
      `INSERT INTO inventory (id, character_id, name, quantity, location, properties_json, provenance, session_id, updated_at)
       VALUES ('shield', 'pc-1', 'Shield', 1, 'worn', '{}', 'test:setup', ?, ?)`,
    ).run(SESSION, '2026-05-20T09:00:00.000Z');

    // Model correctly reads context and reports items — no tool call.
    const model = new ScriptedModel([
      'You are carrying a Longsword and a Shield, both worn.',
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput({ playerInput: 'What am I equipped with?' }),
    );

    expect(result.ok).toBe(true);
    expect(result.toolCalls).toHaveLength(0);
    // Row count unchanged — still exactly 2 items.
    expect(inventoryCount(db)).toBe(2);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// AC3: explicit equipment-selection action may call give_item
// ---------------------------------------------------------------------------

describe('AC3: explicit action may call give_item (eshyra-4ia4)', () => {
  it('give_item succeeds when the player explicitly requests an item', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel([
      toolCall('give_item', { id: 'longsword', name: 'Longsword' }),
      'The blacksmith hands you a gleaming longsword.',
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput({ playerInput: 'I purchase a longsword from the blacksmith.' }),
    );

    expect(result.ok).toBe(true);
    expect(result.toolCalls.map((c) => c.tool)).toEqual(['give_item']);
    expect(result.toolCalls[0].result.ok).toBe(true);
    expect(inventoryCount(db)).toBe(1);
    const row = db
      .prepare('SELECT name FROM inventory WHERE id = ?')
      .get('longsword') as { name: string } | undefined;
    expect(row?.name).toBe('Longsword');
    db.close();
  });

  it('give_item is not blocked by any tool-gating mechanism for valid actions', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel([
      toolCall('give_item', { id: 'torch', name: 'Torch', quantity: 5 }),
      'You pack five torches into your bag.',
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput({ playerInput: 'I buy five torches.' }),
    );

    expect(result.ok).toBe(true);
    const row = db
      .prepare('SELECT quantity FROM inventory WHERE id = ?')
      .get('torch') as { quantity: number } | undefined;
    expect(row?.quantity).toBe(5);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// AC4: runtime auditor enforcement of requiresExplicitAction (eshyra-4ia4)
//
// The prompt guard tells the model not to mutate on a query; these tests prove
// the auditor ENFORCES it at runtime even when the model ignores the guard and
// calls give_item anyway. The rejected candidate's mutation is rolled back and
// the accepted turn persists nothing.
// ---------------------------------------------------------------------------

describe('AC4: auditor rejects explicit-action tool on a query (eshyra-4ia4)', () => {
  it('rejects a give_item attempt for "What am I equipped with?" and persists nothing', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    // The model disobeys the prompt guard: attempt 1 calls give_item to "answer"
    // the query. The auditor must reject it; attempt 2 reports the empty
    // inventory with no tool call and is accepted.
    const model = new ScriptedModel([
      toolCall('give_item', { id: 'longsword', name: 'Longsword' }),
      'You are not carrying anything yet. Would you like to choose starting gear?',
      'You are not carrying anything yet. Would you like to choose starting gear?',
    ]);
    const auditModel = new IntentSimulatingAuditModel();
    const auditor = new ModelTurnAuditor(auditModel, 'sim-audit');

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry(), auditor },
      baseInput({ playerInput: 'What am I equipped with?' }),
    );

    expect(result.ok).toBe(true);
    // The rejected give_item mutation was rolled back: inventory stays empty.
    expect(inventoryCount(db)).toBe(0);
    expect(
      db.prepare('SELECT 1 FROM inventory WHERE id = ?').get('longsword'),
    ).toBeUndefined();
    // The accepted (final) turn carries no executed tool calls.
    expect(result.toolCalls.map((c) => c.tool)).not.toContain('give_item');
    expect(result.narration).toContain('not carrying anything');
    // The orchestrator handed the auditor the explicit-action gating list so it
    // could evaluate intent — without it the auditor cannot enforce the rule.
    expect(auditModel.seen.length).toBeGreaterThanOrEqual(1);
    const firstAudit = auditModel.seen[0].messages[0].content as string;
    expect(firstAudit).toContain('## Explicit-Action-Only Tools');
    expect(firstAudit).toContain('give_item');
    expect(firstAudit).toContain('What am I equipped with?');
    db.close();
  });

  it('fails the turn when the model keeps mutating on a query across both attempts', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    // The model never complies: both attempts call give_item on a query. The
    // auditor rejects both, so the turn fails and nothing is persisted.
    const model = new ScriptedModel([
      toolCall('give_item', { id: 'longsword', name: 'Longsword' }),
      'Here is your longsword.',
      toolCall('give_item', { id: 'longsword', name: 'Longsword' }),
      'Here is your longsword.',
    ]);
    const auditor = new ModelTurnAuditor(
      new IntentSimulatingAuditModel(),
      'sim-audit',
    );

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry(), auditor },
      baseInput({ playerInput: 'What am I equipped with?' }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('give_item');
    expect(inventoryCount(db)).toBe(0);
    db.close();
  });
});

describe('AC4: auditor allows explicit-action tool on real action (eshyra-4ia4)', () => {
  it('accepts give_item for "I buy a torch" and persists the item', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel([
      toolCall('give_item', { id: 'torch', name: 'Torch' }),
      'The merchant hands you a torch.',
    ]);
    const auditModel = new IntentSimulatingAuditModel();
    const auditor = new ModelTurnAuditor(auditModel, 'sim-audit');

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry(), auditor },
      baseInput({ playerInput: 'I buy a torch.' }),
    );

    expect(result.ok).toBe(true);
    expect(result.toolCalls.map((c) => c.tool)).toEqual(['give_item']);
    expect(inventoryCount(db)).toBe(1);
    const row = db
      .prepare('SELECT name FROM inventory WHERE id = ?')
      .get('torch') as { name: string } | undefined;
    expect(row?.name).toBe('Torch');
    // The auditor accepted on the first attempt — no retry needed.
    expect(auditModel.seen).toHaveLength(1);
    db.close();
  });
});
