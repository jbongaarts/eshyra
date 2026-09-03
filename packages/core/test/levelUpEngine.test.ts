// Deterministic level-up application engine (eshyra-lupf.8). Tests assert exact
// pack-derived deltas for a martial class (Fighter) and a caster (Wizard),
// including proficiency-bonus crossings, spell DC recomputation, the HP floor,
// the live-row projection, the ledger audit row, and the fail-closed guards.

import { describe, expect, it } from 'vitest';
import {
  applyLevelUp,
  assembleContext,
  type CharacterSheet,
  CharacterSheetPackMismatchError,
  computeLevelUpChangeSet,
  createSqliteCharacterSheetStore,
  detectLevelUpRequiredChoices,
  getBundledDnd5eCharacterResolver,
  getProgressionState,
  LevelUpEngineError,
  LevelUpRequiredChoicesError,
  listProgressionEvents,
  mutateState,
  previewLevelUpChangeSet,
  readSpellSlots,
  renderContextMessage,
  spendSpellSlot,
  syncSpellSlots,
  UnsupportedCharacterBuildError,
} from '../src/internal.js';
import {
  bareDb,
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const AT = '2026-05-27T12:00:00.000Z';
const APPLY = {
  source: 'guided-level-up',
  provenance: 'engine:level-up',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: AT,
};

const ABILITIES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

interface SheetOverrides {
  classKey?: string;
  className?: string;
  level?: number;
  maxHitPoints?: number;
  proficiencyBonus?: number;
  modifiers?: Partial<Record<(typeof ABILITIES)[number], number>>;
  finalScores?: Partial<Record<(typeof ABILITIES)[number], number>>;
  proficientSaves?: readonly (typeof ABILITIES)[number][];
  spellSaveDc?: number;
  spellAttackModifier?: number;
  subclass?: { readonly key: string; readonly name: string };
  system?: string;
  rulesPackId?: string;
  feats?: CharacterSheet['feats'];
}

/** Build a minimal-but-valid CharacterSheet for the engine to advance. */
function buildSheet(overrides: SheetOverrides = {}): CharacterSheet {
  const modifiers = overrides.modifiers ?? {};
  const abilityScores = {} as CharacterSheet['abilityScores'];
  const savingThrows = {} as CharacterSheet['savingThrows'];
  for (const name of ABILITIES) {
    const modifier = modifiers[name] ?? 0;
    abilityScores[name] = {
      base: 10,
      final: overrides.finalScores?.[name] ?? 10 + modifier * 2,
      modifier,
    };
    const proficient = overrides.proficientSaves?.includes(name) ?? false;
    savingThrows[name] = {
      modifier: modifier + (proficient ? (overrides.proficiencyBonus ?? 2) : 0),
      proficient,
    };
  }
  return {
    schemaVersion: 1,
    system: overrides.system ?? 'dnd5e-srd',
    rulesPackId: overrides.rulesPackId ?? 'rules:dnd5e-srd-5.1',
    recipeId: 'dnd5e-srd-character',
    creationMode: 'test',
    level: overrides.level ?? 1,
    identity: { name: 'Test Hero' },
    class: {
      key: overrides.classKey ?? 'class:fighter',
      name: overrides.className ?? 'Fighter',
    },
    ...(overrides.subclass !== undefined
      ? { subclass: overrides.subclass }
      : {}),
    ancestry: { key: 'ancestry:human', name: 'Human' },
    ...(overrides.feats !== undefined ? { feats: overrides.feats } : {}),
    abilityScores,
    proficiencyBonus: overrides.proficiencyBonus ?? 2,
    maxHitPoints: overrides.maxHitPoints ?? 12,
    savingThrows,
    ...(overrides.spellSaveDc !== undefined
      ? { spellSaveDc: overrides.spellSaveDc }
      : {}),
    ...(overrides.spellAttackModifier !== undefined
      ? { spellAttackModifier: overrides.spellAttackModifier }
      : {}),
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: [],
    spells: [],
    metadata: { createdAt: AT },
  };
}

function seedLiveHp(
  db: ReturnType<typeof bareDb>,
  hpMax: number,
  hpCurrent: number,
): void {
  for (const [field, value] of [
    ['hp_max', hpMax],
    ['hp_current', hpCurrent],
  ] as const) {
    mutateState(db, {
      target: 'character',
      field,
      op: 'set',
      value,
      provenance: 'test:init',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: AT,
    });
  }
}

describe('applyLevelUp — martial (Fighter)', () => {
  it('raises proficient saves at the level-4→5 proficiency boundary', () => {
    const db = freshDbWithSession();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save(
      'pc-1',
      buildSheet({
        level: 4,
        proficiencyBonus: 2,
        maxHitPoints: 30,
        modifiers: { strength: 3, constitution: 2, dexterity: 1 },
        proficientSaves: ['strength', 'constitution'],
      }),
    );
    seedLiveHp(db, 30, 30);
    const result = applyLevelUp(db, { store, ...APPLY });
    expect(result.sheet.proficiencyBonus).toBe(3);
    expect(result.sheet.savingThrows.strength.modifier).toBe(6);
    expect(result.sheet.savingThrows.constitution.modifier).toBe(5);
    expect(result.sheet.savingThrows.dexterity.modifier).toBe(1);
    expect(result.changeSet.savingThrows?.strength.to.modifier).toBe(6);
    expect(listProgressionEvents(db)[0]?.appliedChanges).toMatchObject({
      proficiencyBonus: { from: 2, to: 3 },
    });
    db.close();
  });

  it('applies a level-1→2 step with exact pack-derived deltas', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    // CON 14 (modifier +2); Fighter d10 → fixed average 6 → +8 HP.
    store.save(
      'pc-1',
      buildSheet({ maxHitPoints: 12, modifiers: { constitution: 2 } }),
    );
    seedLiveHp(db, 12, 9);

    const result = applyLevelUp(db, { store, ...APPLY });

    expect(result.changeSet).toMatchObject({
      classKey: 'class:fighter',
      level: { from: 1, to: 2 },
      proficiencyBonus: { from: 2, to: 2 },
      hitPoints: {
        method: 'fixed-average',
        hitDie: 10,
        constitutionModifier: 2,
        increment: 8,
        maxHitPoints: { from: 12, to: 20 },
      },
      featuresGained: ['feature:fighter:action-surge'],
    });
    expect(result.changeSet.spellcasting).toBeUndefined();

    // Authoritative sheet updated.
    const saved = store.load('pc-1');
    expect(saved?.level).toBe(2);
    expect(saved?.maxHitPoints).toBe(20);

    // Live projection: level + hp_max bumped, hp_current raised by the increment.
    const row = db
      .prepare('SELECT level, hp_max, hp_current FROM character WHERE id = ?')
      .get('pc-1') as { level: number; hp_max: number; hp_current: number };
    expect(row).toEqual({ level: 2, hp_max: 20, hp_current: 17 });
    expect(getProgressionState(db).level).toBe(2);
    db.close();
  });

  it('crosses the proficiency-bonus boundary at level 5 and audits the event', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save(
      'pc-1',
      buildSheet({
        level: 4,
        proficiencyBonus: 2,
        maxHitPoints: 30,
        modifiers: { constitution: 1 },
      }),
    );
    seedLiveHp(db, 30, 30);

    const result = applyLevelUp(db, { store, ...APPLY });
    expect(result.changeSet).toMatchObject({
      level: { from: 4, to: 5 },
      proficiencyBonus: { from: 2, to: 3 },
      hitPoints: { increment: 7, maxHitPoints: { from: 30, to: 37 } },
      featuresGained: ['feature:fighter:extra-attack'],
    });

    const events = listProgressionEvents(db);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'level-up',
      resultingLevel: 5,
      source: 'guided-level-up',
    });
    expect(events[0].appliedChanges).toMatchObject({
      level: { from: 4, to: 5 },
      proficiencyBonus: { from: 2, to: 3 },
    });
    expect(result.event.id).toBe(events[0].id);
    db.close();
  });
});

describe('applyLevelUp — ASI canonical recomputation', () => {
  it('takes the canonical Grappler feat instead of an ASI and persists it', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    const sheet = buildSheet({
      level: 3,
      finalScores: { strength: 13 },
      modifiers: { strength: 1, constitution: 1 },
    });
    store.save('pc-1', sheet);
    seedLiveHp(db, 12, 12);
    const result = applyLevelUp(db, {
      store,
      choices: { 'level.4.ability-score-improvement': ['feat:grappler'] },
      ...APPLY,
    });
    expect(result.sheet.feats).toEqual([
      { key: 'feat:grappler', name: 'Grappler' },
    ]);
    expect(result.changeSet.featsGained).toEqual(['feat:grappler']);
    expect(result.changeSet.abilityScoreIncreases).toEqual([]);
    db.close();
  });

  it('rejects unmet prerequisites, duplicate feats, and noncanonical feat names', () => {
    const choice = { 'level.4.ability-score-improvement': ['feat:grappler'] };
    const weak = previewLevelUpChangeSet(
      buildSheet({ level: 3, finalScores: { strength: 12 } }),
      { choices: choice },
    );
    expect(weak.ok).toBe(false);
    if (!weak.ok)
      expect(weak.requiredChoices[0]?.reason).toMatch(/Strength 13/);

    const duplicate = previewLevelUpChangeSet(
      buildSheet({
        level: 3,
        finalScores: { strength: 13 },
        feats: [{ key: 'feat:grappler', name: 'Grappler' }],
      }),
      { choices: choice },
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok)
      expect(duplicate.requiredChoices[0]?.reason).toMatch(/only once/);

    const byName = previewLevelUpChangeSet(buildSheet({ level: 3 }), {
      choices: { 'level.4.ability-score-improvement': ['Grappler'] },
    });
    expect(byName.ok).toBe(false);
  });

  it('updates caster scores, saves, spellcasting, live state, HP, and ledger atomically', () => {
    const db = freshDbWithSession();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save(
      'pc-1',
      buildSheet({
        classKey: 'class:cleric',
        className: 'Cleric',
        level: 3,
        maxHitPoints: 20,
        modifiers: { wisdom: 3, constitution: 0 },
        finalScores: { wisdom: 17, constitution: 11 },
        spellSaveDc: 13,
        spellAttackModifier: 5,
        proficientSaves: ['wisdom'],
      }),
    );
    seedLiveHp(db, 20, 15);
    const baseResolver = getBundledDnd5eCharacterResolver();
    const resolver = {
      ...baseResolver,
      resolveClassLevel: (name: string, level: number) => {
        const resolved = baseResolver.resolveClassLevel(name, level);
        if (resolved.ok && name === 'class:cleric' && level === 4) {
          return {
            ...resolved,
            record: { ...resolved.record, spellcasting: undefined },
          };
        }
        return resolved;
      },
    };
    const result = applyLevelUp(db, {
      store,
      resolver,
      choices: {
        'level.4.ability-score-improvement': ['Wisdom', 'Constitution'],
      },
      ...APPLY,
    });
    expect(result.changeSet.abilityScoreIncreases).toHaveLength(2);
    expect(result.changeSet.hitPoints).toMatchObject({
      increment: 6,
      retroactiveConstitutionAdjustment: 3,
      maxHitPoints: { from: 20, to: 29 },
    });
    expect(result.sheet.abilityScores.wisdom).toMatchObject({
      final: 18,
      modifier: 4,
    });
    expect(result.sheet.abilityScores.constitution).toMatchObject({
      final: 12,
      modifier: 1,
    });
    expect(result.sheet.spellSaveDc).toBe(14);
    expect(result.sheet.spellAttackModifier).toBe(6);
    expect(result.sheet.savingThrows.wisdom.modifier).toBe(6);
    const row = db
      .prepare(
        'SELECT level, hp_max, hp_current, ability_scores_json FROM character WHERE id = ?',
      )
      .get('pc-1') as {
      level: number;
      hp_max: number;
      hp_current: number;
      ability_scores_json: string;
    };
    expect(row.level).toBe(4);
    expect(row.hp_max).toBe(29);
    expect(row.hp_current).toBe(24);
    expect(JSON.parse(row.ability_scores_json)).toMatchObject({
      wisdom: 18,
      constitution: 12,
    });
    expect(listProgressionEvents(db)).toHaveLength(1);
    db.close();
  });
});

describe('applyLevelUp — spell-slot reconciliation', () => {
  it('immediately exposes increased ordinary slot capacity with prior expenditure retained', () => {
    const db = freshDbWithSession();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save(
      'pc-1',
      buildSheet({
        classKey: 'class:cleric',
        className: 'Cleric',
        maxHitPoints: 9,
        modifiers: { constitution: 1, wisdom: 3 },
        spellSaveDc: 13,
        spellAttackModifier: 5,
        subclass: { key: 'subclass:life-domain', name: 'Life Domain' },
      }),
    );
    seedLiveHp(db, 9, 9);
    syncSpellSlots(db, APPLY);
    spendSpellSlot(db, { spellLevel: 1, ...APPLY });
    spendSpellSlot(db, { spellLevel: 1, ...APPLY });

    applyLevelUp(db, { store, ...APPLY });

    expect(readSpellSlots(db)).toEqual([
      expect.objectContaining({
        pool: 'spellcasting',
        spellLevel: 1,
        slotsMax: 3,
        slotsUsed: 2,
        slotsRemaining: 1,
      }),
    ]);
    const context = assembleContext({
      db,
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      campaignPosition: 'test-position',
      sessionId: DEFAULT_TEST_SESSION_ID,
      playerInput: 'I prepare another spell.',
    });
    expect(context.state.spentSpellSlots).toEqual([
      expect.objectContaining({ slotsMax: 3, slotsUsed: 2, slotsRemaining: 1 }),
    ]);
    expect(renderContextMessage(context)).toContain(
      'Spell slots spent: level 1: 2/3',
    );
    db.close();
  });

  it('immediately migrates spent Pact Magic slots to their new level', () => {
    const db = freshDbWithSession();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save(
      'pc-1',
      buildSheet({
        classKey: 'class:warlock',
        className: 'Warlock',
        level: 2,
        maxHitPoints: 14,
      }),
    );
    seedLiveHp(db, 14, 14);
    mutateState(db, {
      target: 'character',
      field: 'level',
      op: 'set',
      value: 2,
      provenance: 'test:init',
      sessionId: DEFAULT_TEST_SESSION_ID,
      at: AT,
    });
    syncSpellSlots(db, APPLY);
    spendSpellSlot(db, { spellLevel: 1, ...APPLY });
    spendSpellSlot(db, { spellLevel: 1, ...APPLY });

    // Warlock's real level-3 row has player choices the current level-up
    // engine correctly blocks. Keep this integration focused on the committed
    // F4 projection by supplying a source-shaped row with those unrelated
    // choices already resolved; its Pact Magic capacity remains 2 level-2
    // slots, exactly as the bundled progression specifies.
    const bundled = getBundledDnd5eCharacterResolver();
    const resolver = {
      ...bundled,
      resolveClass(nameOrRef: string) {
        const resolved = bundled.resolveClass(nameOrRef);
        if (!resolved.ok || resolved.record.key !== 'class:warlock') {
          return resolved;
        }
        return {
          ok: true as const,
          record: {
            ...resolved.record,
            progression: resolved.record.progression?.map((row) =>
              row.level === 3
                ? {
                    ...row,
                    featureRefs: [],
                    subclassFeatureSlots: [],
                    featureImprovements: [],
                    spellcasting:
                      row.spellcasting === undefined
                        ? undefined
                        : {
                            ...row.spellcasting,
                            spellsKnown: 3,
                            invocationsKnown: 2,
                          },
                  }
                : row,
            ),
          },
        };
      },
      resolveClassLevel(nameOrRef: string, level: number) {
        const resolved = bundled.resolveClassLevel(nameOrRef, level);
        if (!resolved.ok || nameOrRef !== 'class:warlock' || level !== 3) {
          return resolved;
        }
        return {
          ok: true as const,
          record: {
            ...resolved.record,
            featureRefs: [],
            subclassFeatureSlots: [],
            featureImprovements: [],
            spellcasting:
              resolved.record.spellcasting === undefined
                ? undefined
                : {
                    ...resolved.record.spellcasting,
                    spellsKnown: 3,
                    invocationsKnown: 2,
                  },
          },
        };
      },
    };

    applyLevelUp(db, { store, resolver, ...APPLY });

    expect(readSpellSlots(db)).toEqual([
      expect.objectContaining({
        pool: 'pact_magic',
        spellLevel: 2,
        slotsMax: 2,
        slotsUsed: 2,
        slotsRemaining: 0,
      }),
    ]);
    const context = assembleContext({
      db,
      campaignId: DEFAULT_TEST_CAMPAIGN_ID,
      campaignPosition: 'test-position',
      sessionId: DEFAULT_TEST_SESSION_ID,
      playerInput: 'I summon another blast.',
    });
    expect(context.state.spentSpellSlots).toEqual([
      expect.objectContaining({
        pool: 'pact_magic',
        spellLevel: 2,
        slotsUsed: 2,
      }),
    ]);
    expect(renderContextMessage(context)).toContain(
      'Spell slots spent: Pact Magic level 2: 2/2',
    );
    db.close();
  });
});

describe('computeLevelUpChangeSet — caster (Wizard) preview', () => {
  // Wizard levels carry required choices (see the fail-closed block below), so
  // these caster deltas are previews via the pure compute function, not applies.
  it('previews the new spell slots, keeping the DC steady when prof is unchanged', () => {
    // Wizard d6, INT 16 (+3): DC 8+2+3=13, attack +5 at level 1.
    const changeSet = computeLevelUpChangeSet(
      buildSheet({
        classKey: 'class:wizard',
        className: 'Wizard',
        level: 1,
        maxHitPoints: 8,
        modifiers: { constitution: 1, intelligence: 3 },
        spellSaveDc: 13,
        spellAttackModifier: 5,
      }),
    );
    expect(changeSet).toMatchObject({
      level: { from: 1, to: 2 },
      proficiencyBonus: { from: 2, to: 2 },
      hitPoints: { hitDie: 6, increment: 5 },
      featuresGained: ['feature:wizard:arcane-tradition'],
      spellcasting: { cantripsKnown: 3, slots: { '1': 3 } },
      spellSaveDc: { from: 13, to: 13 },
      spellAttackModifier: { from: 5, to: 5 },
    });
  });

  it('previews the recomputed spell DC when level 5 raises the proficiency bonus', () => {
    const changeSet = computeLevelUpChangeSet(
      buildSheet({
        classKey: 'class:wizard',
        className: 'Wizard',
        level: 4,
        proficiencyBonus: 2,
        maxHitPoints: 22,
        modifiers: { constitution: 1, intelligence: 3 },
        spellSaveDc: 13,
        spellAttackModifier: 5,
      }),
    );
    expect(changeSet).toMatchObject({
      proficiencyBonus: { from: 2, to: 3 },
      spellcasting: { cantripsKnown: 4, slots: { '1': 4, '2': 3, '3': 2 } },
      spellSaveDc: { from: 13, to: 14 },
      spellAttackModifier: { from: 5, to: 6 },
    });
  });
});

describe('detectLevelUpRequiredChoices / fail-closed apply', () => {
  it('reports no required choices for a deterministic martial row (Fighter 1→2)', () => {
    expect(detectLevelUpRequiredChoices(buildSheet({ level: 1 }))).toEqual([]);
  });

  it('applies a supported subclass choice from structured pack options (Fighter 2→3)', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    const sheet = buildSheet({
      level: 2,
      maxHitPoints: 20,
      modifiers: { constitution: 2 },
    });
    store.save('pc-1', sheet);
    seedLiveHp(db, 20, 14);

    const choices = detectLevelUpRequiredChoices(sheet);
    expect(choices).toEqual([
      expect.objectContaining({
        id: 'level.3.subclass',
        kind: 'subclass',
        status: 'supported',
        choose: 1,
        from: ['Champion'],
      }),
    ]);

    const result = applyLevelUp(db, {
      store,
      choices: { 'level.3.subclass': ['Champion'] },
      ...APPLY,
    });

    expect(result.sheet.subclass).toEqual({
      key: 'subclass:champion',
      name: 'Champion',
    });
    expect(result.changeSet).toMatchObject({
      level: { from: 2, to: 3 },
      featuresGained: [
        'feature:fighter:martial-archetype',
        'feature:champion:improved-critical',
      ],
      choicesApplied: [
        {
          id: 'level.3.subclass',
          kind: 'subclass',
          value: 'subclass:champion',
          label: 'Champion',
          featureRefs: ['feature:champion:improved-critical'],
        },
      ],
    });
    expect(listProgressionEvents(db)[0]?.appliedChanges).toMatchObject({
      featuresGained: [
        'feature:fighter:martial-archetype',
        'feature:champion:improved-critical',
      ],
    });
    expect(store.load('pc-1')?.level).toBe(3);
    expect(listProgressionEvents(db)).toHaveLength(1);
    db.close();
  });

  it('blocks a subclass + spell level (Wizard 1→2) and applies nothing', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    const sheet = buildSheet({
      classKey: 'class:wizard',
      className: 'Wizard',
      level: 1,
      modifiers: { intelligence: 3 },
    });
    store.save('pc-1', sheet);

    const choices = detectLevelUpRequiredChoices(sheet);
    expect(choices.map((c) => c.kind)).toEqual(
      expect.arrayContaining(['subclass', 'spell-selection']),
    );
    expect(choices.find((c) => c.kind === 'subclass')).toMatchObject({
      id: 'level.2.subclass',
      status: 'supported',
      featureRef: 'feature:wizard:arcane-tradition',
      from: ['School of Evocation'],
    });
    expect(choices.find((c) => c.kind === 'spell-selection')).toMatchObject({
      id: 'level.2.spell-selection',
      status: 'unsupported',
      unsupportedReason: expect.stringContaining(
        'deterministic spell application is not implemented yet',
      ),
    });

    let thrown: unknown;
    try {
      applyLevelUp(db, {
        store,
        choices: { 'level.2.subclass': ['School of Evocation'] },
        ...APPLY,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LevelUpRequiredChoicesError);
    expect((thrown as LevelUpRequiredChoicesError).requiredChoices.length).toBe(
      1,
    );
    expect(
      (thrown as LevelUpRequiredChoicesError).requiredChoices[0],
    ).toMatchObject({
      id: 'level.2.spell-selection',
      status: 'unsupported',
    });

    // Nothing advanced: the stored sheet is untouched and no ledger row exists.
    expect(store.load('pc-1')?.level).toBe(1);
    expect(listProgressionEvents(db)).toHaveLength(0);
    db.close();
  });

  it('blocks an Ability Score Improvement level (Fighter 3→4)', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    const sheet = buildSheet({ level: 3, proficiencyBonus: 2 });
    store.save('pc-1', sheet);

    expect(detectLevelUpRequiredChoices(sheet).map((c) => c.kind)).toContain(
      'ability-score-improvement',
    );
    expect(() => applyLevelUp(db, { store, ...APPLY })).toThrow(
      LevelUpRequiredChoicesError,
    );
    expect(listProgressionEvents(db)).toHaveLength(0);
    db.close();
  });

  it('blocks typed feature improvements instead of dropping them (Cleric 19→20)', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    const sheet = buildSheet({
      classKey: 'class:cleric',
      className: 'Cleric',
      level: 19,
      proficiencyBonus: 6,
      maxHitPoints: 136,
      subclass: { key: 'subclass:life-domain', name: 'Life Domain' },
      modifiers: { wisdom: 3 },
      spellSaveDc: 17,
      spellAttackModifier: 9,
    });
    store.save('pc-1', sheet);

    const choices = detectLevelUpRequiredChoices(sheet);
    expect(choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'level.20.feature-improvement.divine-intervention-improvement',
          kind: 'class-feature-choice',
          status: 'unsupported',
          label: 'Divine Intervention improvement',
          unsupportedReason: expect.stringContaining(
            'Feature improvements change an existing feature',
          ),
        }),
      ]),
    );
    expect(() => applyLevelUp(db, { store, ...APPLY })).toThrow(
      LevelUpRequiredChoicesError,
    );
    expect(store.load('pc-1')?.level).toBe(19);
    expect(listProgressionEvents(db)).toHaveLength(0);
    db.close();
  });
});

describe('applyLevelUp — HP floor and fail-closed guards', () => {
  it('refuses an advancement target in preview and apply before any state change', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    const sheet = buildSheet({
      maxHitPoints: 12,
      modifiers: { constitution: 2 },
    });
    store.save('pc-1', sheet);
    seedLiveHp(db, 12, 9);
    const before = db
      .prepare('SELECT level, hp_max, hp_current FROM character WHERE id = ?')
      .get('pc-1');
    const input = { targetClass: 'Wizard' } as Parameters<
      typeof previewLevelUpChangeSet
    >[1];

    expect(() => previewLevelUpChangeSet(sheet, input)).toThrow(
      UnsupportedCharacterBuildError,
    );
    expect(() =>
      applyLevelUp(db, { store, ...APPLY, targetClass: 'Wizard' } as Parameters<
        typeof applyLevelUp
      >[1]),
    ).toThrow(UnsupportedCharacterBuildError);
    expect(store.load('pc-1')).toEqual(sheet);
    expect(
      db
        .prepare('SELECT level, hp_max, hp_current FROM character WHERE id = ?')
        .get('pc-1'),
    ).toEqual(before);
    expect(listProgressionEvents(db)).toEqual([]);
    db.close();
  });

  it('rejects multiclass-shaped preview and apply inputs before deriving or committing a change set', () => {
    const db = bareDb();
    const invalid = {
      ...buildSheet(),
      totalLevel: 8,
    } as CharacterSheet;
    expect(() => previewLevelUpChangeSet(invalid)).toThrow(
      UnsupportedCharacterBuildError,
    );

    let saves = 0;
    const store = {
      load: () => invalid,
      save: () => {
        saves += 1;
      },
      list: () => [],
    };
    expect(() => applyLevelUp(db, { store, ...APPLY })).toThrow(
      UnsupportedCharacterBuildError,
    );
    expect(saves).toBe(0);
    expect(listProgressionEvents(db)).toEqual([]);
    expect(getProgressionState(db).level).toBe(1);
    db.close();
  });

  it('floors the HP increment at 1 for a very low Constitution', () => {
    // CON 3 → modifier -4; Wizard d6 average 4 → 4 + (-4) = 0, floored to 1.
    const sheet = buildSheet({
      classKey: 'class:wizard',
      className: 'Wizard',
      modifiers: { constitution: -4 },
    });
    const changeSet = computeLevelUpChangeSet(sheet);
    expect(changeSet.hitPoints.increment).toBe(1);
  });

  it('throws when no sheet is stored for the character', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    expect(() => applyLevelUp(db, { store, ...APPLY })).toThrow(
      LevelUpEngineError,
    );
    db.close();
  });

  it('fails closed when the sheet pack does not match the campaign binding', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save('pc-1', buildSheet({ system: 'pathfinder-2e' }));
    expect(() => applyLevelUp(db, { store, ...APPLY })).toThrow(
      CharacterSheetPackMismatchError,
    );
    // No ledger row written on a failed step.
    expect(listProgressionEvents(db)).toHaveLength(0);
    db.close();
  });

  it('throws when the target level is past the tabulated maximum', () => {
    const sheet = buildSheet({ level: 20 });
    expect(() => computeLevelUpChangeSet(sheet)).toThrow(LevelUpEngineError);
  });
});

describe('applyLevelUp — F6 life-state gate (eshyra-2n1t.8)', () => {
  // The live projection raises hp_current outside the adjustHp death machine,
  // so applying a level-up to a dying/stable/dead character would strand them
  // at positive HP in a non-alive state (e.g. dying at 7 HP, still accruing
  // death saves). The engine fails closed before any write instead.
  function seedLifeState(
    db: ReturnType<typeof bareDb>,
    lifeState: string,
    failures = 0,
  ): void {
    for (const [field, value] of [
      ['life_state', lifeState],
      ['death_save_failures', failures],
    ] as const) {
      mutateState(db, {
        target: 'character',
        field,
        op: 'set',
        value,
        provenance: 'test:init',
        sessionId: DEFAULT_TEST_SESSION_ID,
        at: AT,
      });
    }
  }

  it.each(['dying', 'stable', 'dead'] as const)(
    'refuses to apply a level-up to a %s character, leaving all state untouched',
    (lifeState) => {
      const db = bareDb();
      const store = createSqliteCharacterSheetStore(db, () => AT);
      store.save(
        'pc-1',
        buildSheet({ maxHitPoints: 12, modifiers: { constitution: 2 } }),
      );
      seedLiveHp(db, 12, 0);
      seedLifeState(db, lifeState, 2);

      expect(() => applyLevelUp(db, { store, ...APPLY })).toThrow(
        LevelUpEngineError,
      );

      // Nothing advanced: sheet, live row, and ledger are all untouched.
      expect(store.load('pc-1')?.level).toBe(1);
      const row = db
        .prepare(
          `SELECT level, hp_current, life_state, death_save_failures
           FROM character WHERE id = 'pc-1'`,
        )
        .get() as Record<string, unknown>;
      expect(row).toEqual({
        level: 1,
        hp_current: 0,
        life_state: lifeState,
        death_save_failures: 2,
      });
      expect(listProgressionEvents(db)).toHaveLength(0);
      db.close();
    },
  );

  it('still applies normally to an alive character at low HP', () => {
    const db = bareDb();
    const store = createSqliteCharacterSheetStore(db, () => AT);
    store.save(
      'pc-1',
      buildSheet({ maxHitPoints: 12, modifiers: { constitution: 2 } }),
    );
    seedLiveHp(db, 12, 1);

    const result = applyLevelUp(db, { store, ...APPLY });

    expect(result.changeSet.level).toEqual({ from: 1, to: 2 });
    const row = db
      .prepare("SELECT hp_current, life_state FROM character WHERE id = 'pc-1'")
      .get() as Record<string, unknown>;
    expect(row).toEqual({ hp_current: 9, life_state: 'alive' });
    db.close();
  });
});
