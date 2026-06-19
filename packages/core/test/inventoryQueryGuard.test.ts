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
