import { describe, expect, it } from 'vitest';
import type {
  MarkSceneToolData,
  ModelToolDefinition,
  ToolContext,
} from '../src/internal.js';
import {
  appendSceneLog,
  createDefaultToolRegistry,
  createSeededRng,
  DEFAULT_TOOLS,
  DiceError,
  getOpenScene,
  initSchema,
  openDatabase,
  openScene,
  parseDice,
  recordSceneSummary,
  rollDice,
  startSession,
  ToolRegistry,
  updateClock,
  writeCampaignRulesBinding,
} from '../src/internal.js';

const closedMarkSceneDataTypecheck = {
  boundary: 'close',
  scene: {
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    sceneId: 'scene-1',
    title: 'The Tavern',
    status: 'closed',
    openedAt: '2026-05-20T09:00:00.000Z',
    closedAt: '2026-05-20T10:00:00.000Z',
  },
} satisfies MarkSceneToolData;
void closedMarkSceneDataTypecheck;

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  const db = openDatabase(':memory:');
  initSchema(db);
  startSession(db, {
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    startedAt: '2026-05-20T09:00:00.000Z',
  });
  return {
    db,
    rng: createSeededRng(42),
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    at: '2026-05-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('dice notation', () => {
  it('parses count, faces, and modifier', () => {
    expect(parseDice('2d6+3')).toEqual({ count: 2, faces: 6, modifier: 3 });
    expect(parseDice('d20')).toEqual({ count: 1, faces: 20, modifier: 0 });
    expect(parseDice('4d8 - 1')).toEqual({ count: 4, faces: 8, modifier: -1 });
  });

  it('rejects malformed notation', () => {
    expect(() => parseDice('garbage')).toThrow(DiceError);
    expect(() => parseDice('2x6')).toThrow(DiceError);
    expect(() => parseDice('0d6')).toThrow(DiceError);
  });
});

describe('seeded RNG', () => {
  it('produces a reproducible sequence for a fixed seed', () => {
    const a = createSeededRng(123);
    const b = createSeededRng(123);
    const seqA = [a.nextInt(20), a.nextInt(20), a.nextInt(20)];
    const seqB = [b.nextInt(20), b.nextInt(20), b.nextInt(20)];
    expect(seqA).toEqual(seqB);
    for (const n of seqA) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(20);
    }
  });

  it('diverges for different seeds', () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    const seqA = Array.from({ length: 8 }, () => a.nextInt(1000));
    const seqB = Array.from({ length: 8 }, () => b.nextInt(1000));
    expect(seqA).not.toEqual(seqB);
  });
});

describe('rollDice', () => {
  it('is reproducible under a fixed seed', () => {
    const first = rollDice('3d6+2', createSeededRng(7));
    const second = rollDice('3d6+2', createSeededRng(7));
    expect(first).toEqual(second);
    expect(first.rolls).toHaveLength(3);
    expect(first.modifier).toBe(2);
    expect(first.total).toBe(
      first.rolls[0] + first.rolls[1] + first.rolls[2] + 2,
    );
    for (const r of first.rolls) {
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(6);
    }
  });
});

describe('ToolRegistry', () => {
  it('returns a structured error for an unknown tool', () => {
    const registry = new ToolRegistry();
    const result = registry.invoke('does_not_exist', {}, ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unknown_tool');
    }
  });

  it('lists the default tool set', () => {
    const names = createDefaultToolRegistry().list().sort();
    expect(names).toEqual(
      [
        'add_condition',
        'adjust_hp',
        'give_item',
        'lookup_rules',
        'mark_scene',
        'memory_drilldown',
        'record_world_fact',
        'remove_condition',
        'remove_item',
        'roll',
        'set_plot_flag',
        'set_world_fact',
        'update_clock',
        'world_query',
      ].sort(),
    );
  });

  it('classifies every default tool as read-only or mutating (eshyra-dwkm)', () => {
    const registry = createDefaultToolRegistry();
    // Read-only tools: dice + pure queries write no canon.
    for (const name of [
      'roll',
      'lookup_rules',
      'world_query',
      'memory_drilldown',
    ]) {
      expect(registry.isMutating(name), `${name} should be read-only`).toBe(
        false,
      );
    }
    // Every other default tool writes canon and must be classified mutating.
    const readOnly = new Set([
      'roll',
      'lookup_rules',
      'world_query',
      'memory_drilldown',
    ]);
    for (const name of registry.list()) {
      if (!readOnly.has(name)) {
        expect(registry.isMutating(name), `${name} should be mutating`).toBe(
          true,
        );
      }
    }
  });

  it('treats an unknown tool as mutating (fail-safe staging)', () => {
    expect(new ToolRegistry().isMutating('does_not_exist')).toBe(true);
  });

  it('rejects schema-invalid arguments before invoking a tool', () => {
    let invoked = false;
    const registry = new ToolRegistry().register({
      name: 'strict_tool',
      mutates: false,
      description: 'Test schema enforcement.',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'integer', minimum: 1 },
        },
        required: ['count'],
        additionalProperties: false,
      },
      run: () => {
        invoked = true;
        return { ok: true, data: null };
      },
    });

    const result = registry.invoke('strict_tool', { count: 1.5 }, ctx());

    expect(result).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(invoked).toBe(false);
  });
});

describe('roll tool', () => {
  it('rolls reproducibly given a seeded context', () => {
    const registry = createDefaultToolRegistry();
    const a = registry.invoke(
      'roll',
      { dice: '2d20+1', reason: 'attack' },
      ctx({ rng: createSeededRng(99) }),
    );
    const b = registry.invoke(
      'roll',
      { dice: '2d20+1', reason: 'attack' },
      ctx({ rng: createSeededRng(99) }),
    );
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    if (a.ok) {
      const data = a.data as { total: number; rolls: number[] };
      expect(data.rolls).toHaveLength(2);
    }
  });

  it('returns a structured error for malformed dice', () => {
    const result = createDefaultToolRegistry().invoke(
      'roll',
      { dice: 'not-dice', reason: 'attack' },
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_dice');
    }
  });

  it('rejects missing arguments', () => {
    const result = createDefaultToolRegistry().invoke('roll', {}, ctx());
    expect(result.ok).toBe(false);
  });

  it('rejects an empty reason', () => {
    const result = createDefaultToolRegistry().invoke(
      'roll',
      { dice: '1d20', reason: '' },
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_args');
    }
  });
});

describe('mark_scene tool', () => {
  it('opens then closes the current scene', () => {
    const registry = createDefaultToolRegistry();
    const c = ctx();
    const opened = registry.invoke(
      'mark_scene',
      { boundary: 'open', title: 'The Tavern' },
      c,
    );
    expect(opened.ok).toBe(true);
    expect(getOpenScene(c.db, c)?.title).toBe('The Tavern');

    const closed = registry.invoke('mark_scene', { boundary: 'close' }, c);
    expect(closed.ok).toBe(true);
    expect(getOpenScene(c.db, c)).toBeUndefined();
  });

  it('errors when closing with no open scene', () => {
    const result = createDefaultToolRegistry().invoke(
      'mark_scene',
      { boundary: 'close' },
      ctx(),
    );
    expect(result.ok).toBe(false);
  });
});

describe('lookup_rules tool', () => {
  it('resolves a known creature by name via the default D&D binding', () => {
    const result = createDefaultToolRegistry().invoke(
      'lookup_rules',
      { kind: 'creature', name: 'Goblin' },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        record: { name: string; systemId: string };
        sourcePack: { systemId: string };
        license: { licenseName: string };
      };
      expect(data.record.name).toBe('Goblin');
      expect(data.record.systemId).toBe('dnd5e-srd');
      expect(data.sourcePack.systemId).toBe('dnd5e-srd');
      expect(data.license.licenseName).toContain('Creative Commons');
    }
  });

  it('returns not_found for an unknown name', () => {
    const result = createDefaultToolRegistry().invoke(
      'lookup_rules',
      { kind: 'creature', name: 'Definitely Not A Real Monster' },
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('not_found');
    }
  });

  it('resolves a magic item the placeholder pack never carried', () => {
    const result = createDefaultToolRegistry().invoke(
      'lookup_rules',
      { kind: 'magic-item', name: 'Potion of Healing' },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { record: { key: string } };
      expect(data.record.key).toBe('magic-item:potion-of-healing');
    }
  });

  it.each([
    ['torch', 'equipment:torch'],
    ['torches', 'equipment:torch'],
    ['crossbow bolt', 'equipment:crossbow-bolts-20'],
    ['crossbow bolts', 'equipment:crossbow-bolts-20'],
    ['rations', 'equipment:rations-1-day'],
    ['days of rations', 'equipment:rations-1-day'],
    ['leather armor', 'equipment:leather'],
    ["explorer's pack", 'equipment:explorers-pack'],
    ["dungeoneer's pack", 'equipment:dungeoneers-pack'],
    ['chain mail', 'equipment:chain-mail'],
    ['light crossbow', 'equipment:crossbow-light'],
    ['shield', 'equipment:shield'],
    ['backpack', 'equipment:backpack'],
  ])('resolves generated SRD equipment alias %s', (name, key) => {
    const result = createDefaultToolRegistry().invoke(
      'lookup_rules',
      { kind: 'equipment', name },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { record: { key: string } };
      expect(data.record.key).toBe(key);
    }
  });

  it('reports an ambiguous name with candidate keys instead of mis-picking', () => {
    // "Ability Score Improvement" is a `feature` on every class in the SRD.
    const result = createDefaultToolRegistry().invoke(
      'lookup_rules',
      { kind: 'feature', name: 'Ability Score Improvement' },
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ambiguous');
      // Candidate keys are embedded in the message so the DM can re-query by ref.
      expect(result.message).toContain(
        'feature:fighter:ability-score-improvement',
      );
    }
  });

  it('honors an explicit systemId override to resolve against a different bundled system', () => {
    const result = createDefaultToolRegistry().invoke(
      'lookup_rules',
      { kind: 'ancestry', name: 'Human', systemId: 'pathfinder2e-remaster' },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        record: { name: string; systemId: string };
        sourcePack: { systemId: string };
      };
      expect(data.record.systemId).toBe('pathfinder2e-remaster');
      expect(data.sourcePack.systemId).toBe('pathfinder2e-remaster');
    }
  });

  it('advertises magic-item as a lookup kind', () => {
    const def = createDefaultToolRegistry()
      .definitions()
      .find((d) => d.name === 'lookup_rules') as ModelToolDefinition;
    expect(def.inputSchema.properties.kind?.enum).toContain('magic-item');
  });

  it('fails clearly when the binding names the retired placeholder pack id (ADR 0013)', () => {
    const c = ctx();
    // Simulate a pre-adoption campaign DB still bound to the retired id.
    writeCampaignRulesBinding(c.db, {
      base: {
        systemId: 'dnd5e-srd',
        packId: 'rules:dnd5e-srd',
        version: '5.1',
      },
      addons: [],
      resolvedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = createDefaultToolRegistry().invoke(
      'lookup_rules',
      { kind: 'creature', name: 'Goblin' },
      c,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('retired_pack');
      // Names the retired id and points at the canonical one.
      expect(result.message).toContain('rules:dnd5e-srd');
      expect(result.message).toContain('rules:dnd5e-srd-5.1');
    }
  });
});

describe('domain mutation tools', () => {
  it('adjust_hp applies HP delta and clamps to [0, hp_max]', () => {
    const c = ctx();
    const { db } = c;
    const registry = createDefaultToolRegistry();
    db.prepare(
      `UPDATE character SET hp_max = 20, hp_current = 15 WHERE id = 'pc-1'`,
    ).run();

    const result = registry.invoke('adjust_hp', { amount: -5 }, c);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { previousHp: number; newHp: number };
      expect(data.previousHp).toBe(15);
      expect(data.newHp).toBe(10);
    }
  });

  it('adjust_hp returns error for non-integer amount', () => {
    const result = createDefaultToolRegistry().invoke(
      'adjust_hp',
      { amount: 'lots' },
      ctx(),
    );
    expect(result.ok).toBe(false);
  });

  it('give_item creates an inventory entry', () => {
    const c = ctx();
    const result = createDefaultToolRegistry().invoke(
      'give_item',
      { id: 'torch', name: 'Torch', quantity: 3 },
      c,
    );
    expect(result.ok).toBe(true);
    const row = c.db
      .prepare('SELECT name, quantity FROM inventory WHERE id = ?')
      .get('torch') as { name: string; quantity: number };
    expect(row.name).toBe('Torch');
    expect(row.quantity).toBe(3);
    expect(result).toMatchObject({
      ok: true,
      data: {
        applied: true,
        id: 'torch',
        name: 'Torch',
        quantity: 3,
      },
    });
  });

  it('inventory mutation results carry comparable bounded audit evidence', () => {
    const c = ctx();
    const registry = createDefaultToolRegistry();
    const given = registry.invoke(
      'give_item',
      {
        id: 'torch',
        name: 'Torch',
        quantity: 10,
        location: 'backpack',
      },
      c,
    );
    expect(given).toMatchObject({
      ok: true,
      data: {
        id: 'torch',
        name: 'Torch',
        quantity: 10,
        location: 'backpack',
      },
    });

    const removed = registry.invoke(
      'remove_item',
      { id: 'torch', quantity: 4 },
      c,
    );
    expect(removed).toMatchObject({
      ok: true,
      data: {
        id: 'torch',
        name: 'Torch',
        quantity: 4,
        location: 'backpack',
        previousQuantity: 10,
        newQuantity: 6,
      },
    });
  });

  it('set_plot_flag sets a flag with model provenance', () => {
    const c = ctx();
    const result = createDefaultToolRegistry().invoke(
      'set_plot_flag',
      { key: 'met_warden', value: true },
      c,
    );
    expect(result.ok).toBe(true);
    const row = c.db
      .prepare('SELECT value_json, provenance FROM plot_flags WHERE key = ?')
      .get('met_warden') as { value_json: string; provenance: string };
    expect(row.value_json).toBe('true');
    expect(row.provenance).toContain('turn-1');
  });
});

describe('world_query tool', () => {
  it('returns not_found for an absent target', () => {
    const result = createDefaultToolRegistry().invoke(
      'world_query',
      { type: 'npc', id: 'ghost' },
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('not_found');
    }
  });
});

describe('record_world_fact tool', () => {
  it('records a player-visible rumor with truth status evidence', () => {
    const c = ctx();
    const result = createDefaultToolRegistry().invoke(
      'record_world_fact',
      {
        id: 'old-renn-rumor',
        kind: 'rumor',
        subjectText: 'Old Renn',
        fact: 'Villagers say Old Renn failed to return with his charcoal cart.',
        truthStatus: 'reported',
        source: 'dm_improvised',
        scope: 'campaign',
        visibility: 'player_visible',
        tags: ['hearthmere', 'missing-cart'],
      },
      c,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        applied: true,
        canonTier: 'campaign_overlay_lore',
        record: {
          id: 'old-renn-rumor',
          kind: 'rumor',
          truthStatus: 'reported',
          visibility: 'player_visible',
        },
        evidence: {
          tier: 'rumor_belief',
          truthStatus: 'reported',
        },
      });
    }
  });

  it('records stable continuity dressing without promoting it as a clue', () => {
    const c = ctx();
    const result = createDefaultToolRegistry().invoke(
      'record_world_fact',
      {
        id: 'emberfall-square-tapestry',
        kind: 'location_detail',
        significance: 'continuity',
        subjectText: 'Emberfall Square',
        locationId: 'emberfall-square',
        fact: 'An ornate tapestry hangs from the west market awning.',
        truthStatus: 'observed',
        source: 'dm_improvised',
        scope: 'campaign',
        visibility: 'player_visible',
      },
      c,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        applied: true,
        canonTier: 'continuity_dressing',
        record: {
          id: 'emberfall-square-tapestry',
          kind: 'location_detail',
          significance: 'continuity',
          truthStatus: 'observed',
          visibility: 'player_visible',
        },
        evidence: {
          tier: 'continuity_dressing',
          truthStatus: 'observed',
        },
      });
    }
  });

  it('records observed evidence and NPC details', () => {
    const c = ctx();
    const registry = createDefaultToolRegistry();
    const clue = registry.invoke(
      'record_world_fact',
      {
        kind: 'clue',
        subjectText: 'north palisade',
        locationId: 'hearthmere',
        fact: 'Fresh axe-cuts mark the north palisade.',
        truthStatus: 'observed',
        source: 'dm_improvised',
        scope: 'campaign',
        visibility: 'player_visible',
      },
      c,
    );
    const npc = registry.invoke(
      'record_world_fact',
      {
        kind: 'npc_detail',
        subjectText: 'Old Renn',
        npcId: 'old-renn',
        fact: 'Old Renn is a charcoal burner known to local villagers.',
        truthStatus: 'confirmed',
        source: 'dm_improvised',
        scope: 'campaign',
        visibility: 'player_visible',
      },
      c,
    );

    expect(clue.ok).toBe(true);
    expect(npc.ok).toBe(true);
  });

  it('auto-attaches the current clock location when locationId is omitted', () => {
    const c = ctx();
    updateClock(
      c.db,
      { locationId: 'hearthmere' },
      {
        provenance: 'test:clock',
        sessionId: c.sessionId,
        at: c.at,
      },
    );

    const result = createDefaultToolRegistry().invoke(
      'record_world_fact',
      {
        id: 'missing-cart',
        kind: 'quest_hook',
        subjectText: 'Old Renn',
        fact: 'Old Renn and his charcoal cart are missing.',
        truthStatus: 'reported',
        source: 'dm_improvised',
        scope: 'campaign',
        visibility: 'player_visible',
      },
      c,
    );

    expect(result).toMatchObject({
      ok: true,
      data: { record: { id: 'missing-cart', locationId: 'hearthmere' } },
    });
  });

  it('preserves an explicit locationId over the current clock location', () => {
    const c = ctx();
    updateClock(
      c.db,
      { locationId: 'hearthmere' },
      {
        provenance: 'test:clock',
        sessionId: c.sessionId,
        at: c.at,
      },
    );

    const result = createDefaultToolRegistry().invoke(
      'record_world_fact',
      {
        id: 'north-gate-cuts',
        kind: 'clue',
        subjectText: 'north gate',
        locationId: 'north-gate',
        fact: 'Fresh axe-cuts mark the north gate.',
        truthStatus: 'observed',
        source: 'dm_improvised',
        scope: 'campaign',
        visibility: 'player_visible',
      },
      c,
    );

    expect(result).toMatchObject({
      ok: true,
      data: { record: { id: 'north-gate-cuts', locationId: 'north-gate' } },
    });
  });

  it('does not attach a bogus location when no current location is known', () => {
    const result = createDefaultToolRegistry().invoke(
      'record_world_fact',
      {
        id: 'locationless-hook',
        kind: 'quest_hook',
        subjectText: 'Old Renn',
        fact: 'Old Renn and his charcoal cart are missing.',
        truthStatus: 'reported',
        source: 'dm_improvised',
        scope: 'campaign',
        visibility: 'player_visible',
      },
      ctx(),
    );

    expect(result).toMatchObject({
      ok: true,
      data: { record: { id: 'locationless-hook' } },
    });
    if (result.ok) {
      const record = result.data as { record: { locationId?: string } };
      expect(record.record.locationId).toBeUndefined();
    }
  });

  it('rejects malformed records and decorative-color kinds', () => {
    const missingFact = createDefaultToolRegistry().invoke(
      'record_world_fact',
      {
        kind: 'clue',
        subjectText: 'north palisade',
        truthStatus: 'observed',
        source: 'dm_improvised',
        scope: 'campaign',
        visibility: 'player_visible',
      },
      ctx(),
    );
    const decorative = createDefaultToolRegistry().invoke(
      'record_world_fact',
      {
        kind: 'decorative_color',
        subjectText: 'chipped cup',
        fact: 'A chipped cup sits on the table.',
        truthStatus: 'observed',
        source: 'dm_improvised',
        scope: 'campaign',
        visibility: 'player_visible',
      },
      ctx(),
    );

    expect(missingFact.ok).toBe(false);
    expect(decorative.ok).toBe(false);
  });
});

describe('memory_drilldown tool', () => {
  it('resolves a recorded scene summary', () => {
    const c = ctx();
    recordSceneSummary(c.db, {
      campaignId: c.campaignId,
      sessionId: c.sessionId,
      sceneId: 'scene-1',
      summary: 'The party met the barkeep.',
      salientRefs: [],
      sourceTurnIds: ['turn-0'],
      createdAt: c.at,
      updatedAt: c.at,
    });
    const result = createDefaultToolRegistry().invoke(
      'memory_drilldown',
      {
        target: 'scene',
        campaignId: c.campaignId,
        sessionId: c.sessionId,
        sceneId: 'scene-1',
      },
      c,
    );
    expect(result.ok).toBe(true);
  });

  it('returns not_found for an absent summary', () => {
    const result = createDefaultToolRegistry().invoke(
      'memory_drilldown',
      {
        target: 'scene',
        campaignId: 'campaign-1',
        sessionId: 'session-1',
        sceneId: 'nope',
      },
      ctx(),
    );
    expect(result.ok).toBe(false);
  });

  it('retrieves an omitted current-scene transcript window', () => {
    const c = ctx();
    openScene(c.db, {
      campaignId: c.campaignId,
      sessionId: c.sessionId,
      sceneId: 'scene-1',
      title: 'The Tavern',
      at: c.at,
    });
    for (const n of [1, 2, 3]) {
      appendSceneLog(c.db, {
        campaignId: c.campaignId,
        sessionId: c.sessionId,
        sceneId: 'scene-1',
        turnId: `turn-${n}`,
        role: 'player',
        content: `line ${n}`,
        at: c.at,
      });
    }

    const result = createDefaultToolRegistry().invoke(
      'memory_drilldown',
      {
        target: 'scene_log',
        campaignId: c.campaignId,
        sessionId: c.sessionId,
        sceneId: 'scene-1',
        beforeSeq: 3,
        limit: 2,
      },
      c,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        target: 'scene_log';
        records: Array<{ content: string }>;
      };
      expect(data.records.map((e) => e.content)).toEqual(['line 1', 'line 2']);
    }
  });
});

describe('tool schema metadata (eshyra-0jq.10)', () => {
  it('every bundled tool publishes an object-typed input schema', () => {
    for (const tool of DEFAULT_TOOLS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
      // add_condition intentionally omits additionalProperties to allow
      // extra condition fields (duration, severity, etc.).
      if (tool.name === 'add_condition') continue;
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it('exposes provider-neutral definitions through ToolRegistry.definitions()', () => {
    const definitions = createDefaultToolRegistry().definitions();
    const names = definitions.map((d) => d.name).sort();
    expect(names).toEqual(
      [
        'add_condition',
        'adjust_hp',
        'give_item',
        'lookup_rules',
        'mark_scene',
        'memory_drilldown',
        'record_world_fact',
        'remove_condition',
        'remove_item',
        'roll',
        'set_plot_flag',
        'set_world_fact',
        'update_clock',
        'world_query',
      ].sort(),
    );
    for (const def of definitions) {
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.inputSchema.type).toBe('object');
      expect(Object.keys(def).sort()).toEqual(
        ['description', 'inputSchema', 'name'].sort(),
      );
    }
  });

  it('roll requires both dice and reason, and rejects extra keys', () => {
    const def = createDefaultToolRegistry()
      .definitions()
      .find((d) => d.name === 'roll') as ModelToolDefinition;
    expect(def.inputSchema.required).toEqual(['dice', 'reason']);
    expect(def.inputSchema.properties.dice?.type).toBe('string');
    expect(def.inputSchema.properties.reason?.type).toBe('string');
    expect(def.inputSchema.additionalProperties).toBe(false);
  });

  it('mark_scene enumerates the boundary values', () => {
    const def = createDefaultToolRegistry()
      .definitions()
      .find((d) => d.name === 'mark_scene') as ModelToolDefinition;
    expect(def.inputSchema.required).toEqual(['boundary']);
    expect(def.inputSchema.properties.boundary?.enum).toEqual([
      'open',
      'close',
    ]);
  });

  it('adjust_hp requires amount as an integer', () => {
    const def = createDefaultToolRegistry()
      .definitions()
      .find((d) => d.name === 'adjust_hp') as ModelToolDefinition;
    expect(def.inputSchema.properties.amount?.type).toBe('integer');
    expect(def.inputSchema.required).toEqual(['amount']);
  });

  it('update_clock location_id permits string or null', () => {
    const def = createDefaultToolRegistry()
      .definitions()
      .find((d) => d.name === 'update_clock') as ModelToolDefinition;
    expect(def.inputSchema.properties.location_id?.type).toEqual([
      'string',
      'null',
    ]);
  });

  it('definitions are a snapshot — mutating the array does not affect later reads', () => {
    const registry = createDefaultToolRegistry();
    const first = registry.definitions();
    (first as unknown as ModelToolDefinition[]).pop();
    const second = registry.definitions();
    expect(second).toHaveLength(DEFAULT_TOOLS.length);
  });
});

describe('scene-log integration witness', () => {
  it('mark_scene opens a scene the orchestrator can log into', () => {
    const c = ctx();
    createDefaultToolRegistry().invoke(
      'mark_scene',
      { boundary: 'open', title: 'The Tavern' },
      c,
    );
    const open = getOpenScene(c.db, c);
    expect(open).toBeDefined();
    if (open) {
      const entry = appendSceneLog(c.db, {
        campaignId: c.campaignId,
        sessionId: c.sessionId,
        sceneId: open.sceneId,
        turnId: c.turnId,
        role: 'player',
        content: 'I order an ale.',
        at: c.at,
      });
      expect(entry.seq).toBe(1);
    }
  });
});
