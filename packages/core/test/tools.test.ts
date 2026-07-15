import { describe, expect, it } from 'vitest';
import type {
  JsonSchema,
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
  upsertCampaignActor,
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
  const duplicateTool = {
    name: 'duplicate',
    mutates: false,
    description: 'Duplicate registration fixture.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    run: () => ({ ok: true, data: null }),
  } as const;

  it('returns a structured error for an unknown tool', () => {
    const registry = new ToolRegistry();
    const result = registry.invoke('does_not_exist', {}, ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unknown_tool');
    }
  });

  it('rejects duplicate tool registration with the tool name', () => {
    const registry = new ToolRegistry().register(duplicateTool);

    expect(() => registry.register(duplicateTool)).toThrow(
      /duplicate tool registration: duplicate/,
    );
  });

  it('lists the default tool set', () => {
    const names = createDefaultToolRegistry().list().sort();
    expect(names).toEqual(
      [
        'add_condition',
        'adjust_hp',
        'advance_time',
        'attune_item',
        'award_inspiration',
        'begin_turn',
        'calc',
        'close_combat_instance',
        'complete_long_rest',
        'complete_short_rest',
        'convert_currency',
        'end_attunement',
        'end_effect',
        'finish_short_rest_recovery',
        'gain_currency',
        'give_item',
        'grant_temporary_hp',
        'lookup_rules',
        'mark_scene',
        'memory_drilldown',
        'record_death_save',
        'record_world_fact',
        'remove_condition',
        'remove_item',
        'reset_usage',
        'resolve_check',
        'resolve_contest',
        'resolve_damage',
        'refresh_effect',
        'remove_effect_target',
        'resolve_concentration',
        'suppress_effect',
        'restore_usage',
        'roll',
        'set_plot_flag',
        'set_surprised',
        'set_world_fact',
        'spend_currency',
        'spend_rest_hit_die',
        'spend_spell_slot',
        'spend_turn_resource',
        'spend_usage',
        'stabilize_character',
        'start_effect',
        'start_encounter',
        'update_clock',
        'update_combatant',
        'unsuppress_effect',
        'use_inspiration',
        'world_query',
      ].sort(),
    );
  });

  it('classifies every default tool as read-only or mutating (eshyra-dwkm)', () => {
    const registry = createDefaultToolRegistry();
    // Read-only tools: dice + pure queries write no canon.
    for (const name of [
      'roll',
      'resolve_check',
      'resolve_contest',
      'resolve_damage',
      'calc',
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
      'resolve_check',
      'resolve_contest',
      'resolve_damage',
      'calc',
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

  it('exposes no generic mutate_state tool (F3 mutation audit §5)', () => {
    // The historical general canon-write wrapper was deleted: a generic
    // model-facing setter over lifecycle-owned fields (HP, life state,
    // death saves, conditions) would bypass the F6/F3 semantic operations.
    // The mutateState primitive remains a trusted /internal-only seam.
    const registry = createDefaultToolRegistry();
    expect(registry.has('mutate_state')).toBe(false);
    expect(
      registry.definitions().map((definition) => definition.name),
    ).not.toContain('mutate_state');
    expect(DEFAULT_TOOLS.map((tool) => tool.name)).not.toContain(
      'mutate_state',
    );
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

  it('echoes player-visible roll metadata', () => {
    const result = createDefaultToolRegistry().invoke(
      'roll',
      {
        dice: '1d20+5',
        reason: 'Bob longsword attack',
        visibility: 'player_visible',
        category: 'attack',
      },
      ctx({ rng: createSeededRng(99) }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        dice: '1d20+5',
        reason: 'Bob longsword attack',
        visibility: 'player_visible',
        category: 'attack',
      });
    }
  });

  it('echoes dm-only roll metadata', () => {
    const result = createDefaultToolRegistry().invoke(
      'roll',
      {
        dice: '1d20+6',
        reason: 'hidden goblin stealth check',
        visibility: 'dm_only',
        category: 'ability_check',
      },
      ctx({ rng: createSeededRng(99) }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        visibility: 'dm_only',
        category: 'ability_check',
      });
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
      // ...and carried as structured data so a caller can act on it without
      // parsing prose (eshyra-o9bd.18.8.6).
      const data = result.data as { candidateKeys: readonly string[] };
      expect(data.candidateKeys).toContain(
        'feature:fighter:ability-score-improvement',
      );
    }
  });

  it('reports every class Spellcasting feature as ambiguous candidates (eshyra-o9bd.18.8.6)', () => {
    // "Spellcasting" is a repeated `feature` name across seven full-caster
    // classes; each has a unique key, so this exercises the same-kind
    // ambiguous path with a larger candidate group than ASI.
    const result = createDefaultToolRegistry().invoke(
      'lookup_rules',
      { kind: 'feature', name: 'Spellcasting' },
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ambiguous');
      const data = result.data as { candidateKeys: readonly string[] };
      for (const cls of [
        'bard',
        'cleric',
        'druid',
        'paladin',
        'ranger',
        'sorcerer',
        'wizard',
      ]) {
        expect(data.candidateKeys).toContain(`feature:${cls}:spellcasting`);
      }
    }
  });

  it('resolves a feature card with grantor class ref and grant level', () => {
    const result = createDefaultToolRegistry().invoke(
      'lookup_rules',
      { kind: 'feature', ref: 'feature:wizard:spellcasting' },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        card: {
          key: string;
          kind: string;
          name: string;
          parent?: { ref: string; relation: string };
        };
      };
      expect(data.card.key).toBe('feature:wizard:spellcasting');
      expect(data.card.kind).toBe('feature');
      expect(data.card.parent?.ref).toBe('class:wizard');
      expect(data.card.parent?.relation).toBe('grantedBy');
    }
  });

  it('resolves a subclass card with parentClass ref', () => {
    const result = createDefaultToolRegistry().invoke(
      'lookup_rules',
      { kind: 'subclass', name: 'Champion' },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        card: { parent?: { ref: string; relation: string } };
      };
      expect(data.card.parent?.ref).toBe('class:fighter');
      expect(data.card.parent?.relation).toBe('parentClass');
    }
  });

  it.each([
    ['action', 'Hide'],
    ['rule', 'Hide'],
  ])('resolves cross-kind duplicate name %s:Hide unambiguously by kind', (kind, name) => {
    const result = createDefaultToolRegistry().invoke(
      'lookup_rules',
      { kind, name },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { card: { kind: string; name: string } };
      expect(data.card.kind).toBe(kind);
    }
  });

  it.each([
    ['spell', 'Shield'],
    ['equipment', 'Shield'],
  ])('resolves cross-kind duplicate name %s:Shield unambiguously by kind', (kind, name) => {
    const result = createDefaultToolRegistry().invoke(
      'lookup_rules',
      { kind, name },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { card: { kind: string; name: string } };
      expect(data.card.kind).toBe(kind);
    }
  });

  it.each([
    ['equipment', 'equipment:potion-of-healing'],
    ['magic-item', 'magic-item:potion-of-healing'],
  ])('resolves near-duplicate name "Potion of Healing" (%s) by kind, distinct from the other kind', (kind, expectedKey) => {
    const result = createDefaultToolRegistry().invoke(
      'lookup_rules',
      { kind, name: 'Potion of Healing' },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { card: { key: string; kind: string } };
      expect(data.card.key).toBe(expectedKey);
      expect(data.card.kind).toBe(kind);
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

describe('active-effect tools (F3, eshyra-2n1t.5)', () => {
  const blessArgs = (effectId: string) => ({
    effectId,
    kind: 'spell-effect',
    displayName: 'Bless',
    source: { kind: 'spell', ref: 'spell:bless' },
    concentrationOwner: { kind: 'character', ref: 'pc-1' },
    duration: {
      kind: 'timed',
      amount: 1,
      unit: 'minute',
      anchor: 'spell-cast',
    },
    conditions: [
      {
        target: { kind: 'character', ref: 'pc-1' },
        condition: { id: `blessed:${effectId}` },
      },
    ],
  });

  function conditionIds(db: import('../src/index.js').Db): string[] {
    const row = db
      .prepare(`SELECT conditions_json FROM character WHERE id = 'pc-1'`)
      .get() as { conditions_json: string };
    return (JSON.parse(row.conditions_json) as { id: string }[]).map(
      (entry) => entry.id,
    );
  }

  it('start_effect creates the effect and reports concentration replacement', () => {
    const c = ctx();
    const registry = createDefaultToolRegistry();
    const first = registry.invoke('start_effect', blessArgs('fx-1'), c);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.data).toMatchObject({
        effect: { effectId: 'fx-1', status: 'active' },
      });
    }
    expect(conditionIds(c.db)).toEqual(['blessed:fx-1']);

    const second = registry.invoke('start_effect', blessArgs('fx-2'), c);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.data).toMatchObject({
        effect: { effectId: 'fx-2' },
        replaced: { effectId: 'fx-1' },
      });
    }
    // Exactly the replaced effect's projection was cleaned up.
    expect(conditionIds(c.db)).toEqual(['blessed:fx-2']);
  });

  it('preserves exact campaign-actor refs through start_effect and remove_effect_target', () => {
    const c = ctx();
    const registry = createDefaultToolRegistry();
    upsertCampaignActor(c.db, {
      campaignId: c.campaignId,
      actorId: 'pc-1',
      displayName: 'Durable PC One',
      actorKind: 'companion',
      sourceKind: 'campaign_created',
      rulesRef: 'creature:wolf',
      hpCurrent: 11,
      hpMax: 11,
      status: 'alive',
      provenance: 'test',
      sessionId: c.sessionId,
      at: c.at,
    });
    const started = registry.invoke(
      'start_effect',
      {
        effectId: 'fx-actor-ref',
        kind: 'curse',
        displayName: 'Actor Mark',
        source: {
          kind: 'ruling',
          actor: { kind: 'campaign_actor', ref: 'pc-1' },
        },
        duration: { kind: 'until-removed' },
        targets: [{ kind: 'campaign_actor', ref: 'pc-1' }],
      },
      c,
    );
    expect(started).toMatchObject({
      ok: true,
      data: {
        effect: {
          source: { actor: { kind: 'campaign_actor', ref: 'pc-1' } },
          targets: [{ kind: 'campaign_actor', ref: 'pc-1', status: 'active' }],
        },
      },
    });
    expect(
      registry.invoke(
        'remove_effect_target',
        {
          effectId: 'fx-actor-ref',
          target: { kind: 'campaign_actor', ref: 'pc-1' },
          reason: 'saved',
        },
        c,
      ),
    ).toMatchObject({
      ok: true,
      data: {
        effect: {
          targets: [{ kind: 'campaign_actor', ref: 'pc-1', status: 'removed' }],
        },
      },
    });
  });

  it('start_effect rejects schema violations and lifecycle violations distinctly', () => {
    const c = ctx();
    const registry = createDefaultToolRegistry();
    const missingDuration = registry.invoke(
      'start_effect',
      {
        effectId: 'fx-x',
        kind: 'spell-effect',
        displayName: 'X',
        source: { kind: 'ruling' },
      },
      c,
    );
    expect(missingDuration).toMatchObject({ ok: false, code: 'invalid_args' });

    const instantaneous = registry.invoke(
      'start_effect',
      {
        effectId: 'fx-cure',
        kind: 'spell-effect',
        displayName: 'Cure Wounds',
        source: { kind: 'spell', ref: 'spell:cure-wounds' },
        duration: { kind: 'until-removed' },
      },
      c,
    );
    expect(instantaneous).toMatchObject({ ok: false, code: 'effect_error' });
    if (!instantaneous.ok) {
      expect(instantaneous.message).toMatch(/instantaneous/);
    }
  });

  it('resolve_concentration rolls the save itself — outcome is never declared', () => {
    const c = ctx();
    const registry = createDefaultToolRegistry();
    registry.invoke('start_effect', blessArgs('fx-1'), c);

    // A declared outcome is a schema violation, not an accepted input.
    const declaredOutcome = registry.invoke(
      'resolve_concentration',
      {
        owner: { kind: 'character', ref: 'pc-1' },
        damage: 22,
        outcome: 'success',
      },
      c,
    );
    expect(declaredOutcome).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(conditionIds(c.db)).toEqual(['blessed:fx-1']);

    // A +100 modifier makes total >= DC certain: the engine derives success
    // from its own roll and the effect survives.
    const succeeded = registry.invoke(
      'resolve_concentration',
      {
        owner: { kind: 'character', ref: 'pc-1' },
        damage: 22,
        modifiers: [{ label: 'war caster (test)', value: 100 }],
      },
      c,
    );
    expect(succeeded).toMatchObject({
      ok: true,
      data: {
        category: 'saving_throw',
        effectId: 'fx-1',
        dc: 11,
        outcome: 'success',
        broken: false,
      },
    });
    if (succeeded.ok) {
      const data = succeeded.data as {
        resolution: { dice: string; rolls: number[]; total: number };
      };
      expect(data.resolution.dice).toBe('1d20');
      expect(data.resolution.rolls).toHaveLength(1);
      expect(data.resolution.total).toBeGreaterThanOrEqual(11);
    }
    expect(conditionIds(c.db)).toEqual(['blessed:fx-1']);

    // A -100 modifier makes failure certain: the effect ends with cleanup.
    const failed = registry.invoke(
      'resolve_concentration',
      {
        owner: { kind: 'character', ref: 'pc-1' },
        damage: 22,
        modifiers: [{ label: 'cursed (test)', value: -100 }],
      },
      c,
    );
    expect(failed).toMatchObject({
      ok: true,
      data: { effectId: 'fx-1', dc: 11, outcome: 'failure', broken: true },
    });
    expect(conditionIds(c.db)).toEqual([]);
  });

  it('end_effect maps lifecycle refusals and performs voluntary breaks', () => {
    const c = ctx();
    const registry = createDefaultToolRegistry();
    registry.invoke('start_effect', blessArgs('fx-1'), c);

    const dismissed = registry.invoke(
      'end_effect',
      { effectId: 'fx-1', reason: 'dismissed' },
      c,
    );
    expect(dismissed).toMatchObject({ ok: false, code: 'effect_error' });

    const broken = registry.invoke(
      'end_effect',
      { effectId: 'fx-1', reason: 'concentration-broken', detail: 'voluntary' },
      c,
    );
    expect(broken).toMatchObject({ ok: true, data: { changed: true } });
    expect(conditionIds(c.db)).toEqual([]);
  });

  it('adjust_hp surfaces the concentration save through the tool result', () => {
    const c = ctx();
    const registry = createDefaultToolRegistry();
    c.db
      .prepare(
        `UPDATE character SET hp_max = 20, hp_current = 20 WHERE id = 'pc-1'`,
      )
      .run();
    registry.invoke('start_effect', blessArgs('fx-1'), c);

    const damaged = registry.invoke('adjust_hp', { amount: -9 }, c);
    expect(damaged).toMatchObject({
      ok: true,
      data: {
        concentrationCheck: { effectId: 'fx-1', dc: 10, damage: 9 },
      },
    });

    const downed = registry.invoke('adjust_hp', { amount: -20 }, c);
    expect(downed).toMatchObject({
      ok: true,
      data: {
        concentrationBroken: { effectId: 'fx-1', cause: 'incapacitated' },
      },
    });
  });

  it('exposes suppression through the registered tools without cleanup', () => {
    const c = ctx();
    const registry = createDefaultToolRegistry();
    expect(
      registry.list().filter((name) => name === 'suppress_effect'),
    ).toHaveLength(1);
    expect(
      registry.list().filter((name) => name === 'unsuppress_effect'),
    ).toHaveLength(1);
    expect(registry.listRequiresExplicitAction()).not.toContain(
      'suppress_effect',
    );
    expect(registry.listRequiresExplicitAction()).not.toContain(
      'unsuppress_effect',
    );

    expect(
      registry.invoke('start_effect', blessArgs('fx-suppressed'), c).ok,
    ).toBe(true);
    const beforeLinks = c.db
      .prepare(`SELECT link_kind, target_kind, target_ref, projection_ref, status
        FROM active_effect_link WHERE effect_id = 'fx-suppressed'`)
      .all();
    const beforeTargets = c.db
      .prepare(`SELECT target_kind, target_ref, status
        FROM active_effect_target WHERE effect_id = 'fx-suppressed'`)
      .all();

    expect(
      registry.invoke(
        'suppress_effect',
        { effectId: 'fx-suppressed', note: 'antimagic field' },
        c,
      ),
    ).toMatchObject({ ok: true, data: { status: 'suppressed' } });
    expect(
      c.db
        .prepare(
          `SELECT status FROM active_effect WHERE effect_id = 'fx-suppressed'`,
        )
        .pluck()
        .get(),
    ).toBe('suppressed');
    expect(
      c.db
        .prepare(
          `SELECT COUNT(*) FROM character WHERE id = 'pc-1' AND conditions_json LIKE '%blessed:fx-suppressed%'`,
        )
        .pluck()
        .get(),
    ).toBe(1);
    expect(
      c.db
        .prepare(
          `SELECT effect_id FROM active_effect WHERE campaign_id = 'campaign-1' AND concentration_owner_ref = 'pc-1' AND status IN ('active', 'suppressed')`,
        )
        .pluck()
        .get(),
    ).toBe('fx-suppressed');
    expect(
      c.db
        .prepare(
          `SELECT link_kind, target_kind, target_ref, projection_ref, status FROM active_effect_link WHERE effect_id = 'fx-suppressed'`,
        )
        .all(),
    ).toEqual(beforeLinks);
    expect(
      c.db
        .prepare(
          `SELECT target_kind, target_ref, status FROM active_effect_target WHERE effect_id = 'fx-suppressed'`,
        )
        .all(),
    ).toEqual(beforeTargets);

    const events = c.db
      .prepare(
        `SELECT event_kind, provenance, detail_json FROM active_effect_event WHERE effect_id = 'fx-suppressed' ORDER BY seq`,
      )
      .all() as {
      event_kind: string;
      provenance: string;
      detail_json: string;
    }[];
    expect(events.at(-1)).toMatchObject({
      event_kind: 'suppressed',
      provenance: 'model:turn-1',
    });
    expect(JSON.parse(events.at(-1)?.detail_json ?? '{}')).toEqual({
      note: 'antimagic field',
    });

    expect(
      registry.invoke('unsuppress_effect', { effectId: 'fx-suppressed' }, c),
    ).toMatchObject({ ok: true, data: { status: 'active' } });
    expect(
      c.db
        .prepare(
          `SELECT event_kind, provenance FROM active_effect_event WHERE effect_id = 'fx-suppressed' ORDER BY seq`,
        )
        .all()
        .at(-1),
    ).toEqual({ event_kind: 'unsuppressed', provenance: 'model:turn-1' });
  });

  it('preserves suppression errors and cleans normally on a terminal end', () => {
    const c = ctx();
    const registry = createDefaultToolRegistry();
    registry.invoke('start_effect', blessArgs('fx-terminal-suppressed'), c);
    registry.invoke(
      'suppress_effect',
      { effectId: 'fx-terminal-suppressed' },
      c,
    );
    const ledgerBefore = c.db
      .prepare(
        `SELECT event_kind, detail_json FROM active_effect_event WHERE effect_id = 'fx-terminal-suppressed' ORDER BY seq`,
      )
      .all();
    expect(
      registry.invoke(
        'suppress_effect',
        { effectId: 'fx-terminal-suppressed' },
        c,
      ),
    ).toMatchObject({ ok: false, code: 'effect_error' });
    expect(
      registry.invoke('unsuppress_effect', { effectId: 'missing' }, c),
    ).toMatchObject({ ok: false, code: 'effect_error' });
    expect(
      c.db
        .prepare(
          `SELECT event_kind, detail_json FROM active_effect_event WHERE effect_id = 'fx-terminal-suppressed' ORDER BY seq`,
        )
        .all(),
    ).toEqual(ledgerBefore);
    expect(
      registry.invoke(
        'end_effect',
        {
          effectId: 'fx-terminal-suppressed',
          reason: 'concentration-broken',
          detail: 'voluntary',
        },
        c,
      ),
    ).toMatchObject({ ok: true, data: { changed: true } });
    expect(conditionIds(c.db)).toEqual([]);
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
  const VALIDATED_SCHEMA_KEYWORDS = new Set([
    'additionalProperties',
    'anyOf',
    'enum',
    'items',
    'maximum',
    'maxItems',
    'maxLength',
    'minimum',
    'minItems',
    'minLength',
    'oneOf',
    'pattern',
    'properties',
    'required',
    'type',
  ]);
  const DOCUMENTATION_ONLY_SCHEMA_KEYWORDS = new Set([
    // Descriptions are provider-facing metadata, not runtime validation rules.
    'description',
  ]);

  function collectSchemaKeywords(
    schema: JsonSchema,
    into = new Set<string>(),
  ): Set<string> {
    for (const key of Object.keys(schema)) {
      into.add(key);
    }
    for (const child of Object.values(schema.properties ?? {})) {
      collectSchemaKeywords(child, into);
    }
    const additionalProperties = schema.additionalProperties;
    if (
      typeof additionalProperties === 'object' &&
      additionalProperties !== null
    ) {
      collectSchemaKeywords(additionalProperties, into);
    }
    if (schema.items) {
      collectSchemaKeywords(schema.items, into);
    }
    for (const child of [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])]) {
      collectSchemaKeywords(child, into);
    }
    return into;
  }

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

  it('uses only validated or documented provider-only schema keywords', () => {
    const observed = new Set<string>();
    for (const tool of DEFAULT_TOOLS) {
      collectSchemaKeywords(tool.inputSchema, observed);
    }

    const allowed = new Set([
      ...VALIDATED_SCHEMA_KEYWORDS,
      ...DOCUMENTATION_ONLY_SCHEMA_KEYWORDS,
    ]);
    expect([...observed].filter((key) => !allowed.has(key)).sort()).toEqual([]);
  });

  it('exposes provider-neutral definitions through ToolRegistry.definitions()', () => {
    const definitions = createDefaultToolRegistry().definitions();
    const names = definitions.map((d) => d.name).sort();
    expect(names).toEqual(
      [
        'add_condition',
        'adjust_hp',
        'advance_time',
        'attune_item',
        'award_inspiration',
        'begin_turn',
        'calc',
        'close_combat_instance',
        'complete_long_rest',
        'complete_short_rest',
        'convert_currency',
        'end_attunement',
        'end_effect',
        'finish_short_rest_recovery',
        'gain_currency',
        'give_item',
        'grant_temporary_hp',
        'lookup_rules',
        'mark_scene',
        'memory_drilldown',
        'record_death_save',
        'record_world_fact',
        'remove_condition',
        'remove_item',
        'reset_usage',
        'resolve_check',
        'resolve_contest',
        'resolve_damage',
        'refresh_effect',
        'remove_effect_target',
        'resolve_concentration',
        'suppress_effect',
        'restore_usage',
        'roll',
        'set_plot_flag',
        'set_surprised',
        'set_world_fact',
        'spend_currency',
        'spend_rest_hit_die',
        'spend_spell_slot',
        'spend_turn_resource',
        'spend_usage',
        'stabilize_character',
        'start_effect',
        'start_encounter',
        'update_clock',
        'update_combatant',
        'unsuppress_effect',
        'use_inspiration',
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
    expect(def.inputSchema.properties.visibility?.enum).toEqual([
      'player_visible',
      'dm_only',
    ]);
    expect(def.inputSchema.properties.category?.enum).toEqual([
      'attack',
      'damage',
      'initiative',
      'saving_throw',
      'death_save',
      'hit_die',
      'ability_check',
      'other',
    ]);
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
