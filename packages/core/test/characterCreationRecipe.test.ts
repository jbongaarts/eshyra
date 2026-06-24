import { describe, expect, it } from 'vitest';
import {
  DND5E_SRD_CHARACTER_RECIPE,
  resolveCharacterCreationRecipe,
} from '../src/internal.js';

const recipe = DND5E_SRD_CHARACTER_RECIPE;

const validDraft = {
  name: 'Mira',
  ancestry: 'Human',
  className: 'Fighter',
  level: 1,
  abilityScoreMethod: 'point_buy',
  abilityScores: {
    strength: 15,
    dexterity: 14,
    constitution: 14,
    intelligence: 10,
    wisdom: 10,
    charisma: 8,
  },
  maxHitPoints: 12,
  spells: [],
} as const;

const metadata = {
  provenance: 'character_creation:recipe-test',
  sessionId: 'recipe-test',
  at: '2026-06-23T00:00:00.000Z',
} as const;

describe('D&D 5e character creation recipe boundary', () => {
  it('identifies itself against the bundled SRD pack', () => {
    expect(recipe.recipeId).toBe('dnd5e-srd');
    expect(recipe.rulesPackId).toBe('rules:dnd5e-srd-5.1');
  });

  it('declares the two canonical creation modes in display order', () => {
    expect(recipe.getModes().map((mode) => mode.id)).toEqual([
      'concept-first',
      'ability-first',
    ]);
    for (const mode of recipe.getModes()) {
      expect(mode.label.length).toBeGreaterThan(0);
      expect(mode.summary.length).toBeGreaterThan(0);
    }
  });

  it('produces the concept-first step order', () => {
    expect(recipe.getStepOrder('concept-first').map((step) => step.id)).toEqual(
      [
        'identity',
        'class',
        'ancestry',
        'background',
        'ability-scores',
        'class-choices',
        'spells-equipment',
        'review',
      ],
    );
  });

  it('produces the ability-first step order with scores before class', () => {
    const stepIds = recipe.getStepOrder('ability-first').map((step) => step.id);
    expect(stepIds).toEqual([
      'identity',
      'ability-method',
      'ability-scores',
      'class-recommendations',
      'class',
      'ancestry',
      'background',
      'class-choices',
      'spells-equipment',
      'review',
    ]);
    expect(stepIds.indexOf('ability-scores')).toBeLessThan(
      stepIds.indexOf('class'),
    );
  });

  it('labels each step with recipe terminology', () => {
    const steps = recipe.getStepOrder('concept-first');
    const classStep = steps.find((step) => step.id === 'class');
    expect(classStep?.label).toBe('Class');
  });

  it('throws on an unknown mode id', () => {
    expect(() => recipe.getStepOrder('rolled-first')).toThrow();
  });

  it('validates an SRD-legal draft through the recipe seam', () => {
    const result = recipe.validateDraft(validDraft);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.character.className).toBe('Fighter');
    }
  });

  it('returns validation errors rather than throwing on a bad draft', () => {
    const result = recipe.validateDraft({
      ...validDraft,
      className: 'Artificer',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('computes level-1 derived values', () => {
    const derived = recipe.computeDerivedValues(validDraft);
    expect(derived).toMatchObject({
      proficiencyBonus: 2,
      maxHitPoints: 12,
      abilityModifiers: {
        strength: 2,
        constitution: 2,
        charisma: -1,
      },
    });
  });

  it('finalizes a valid draft into canon mutations and a completion prompt', () => {
    const result = recipe.finalize(validDraft, metadata, 'pc-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mutations.length).toBeGreaterThan(0);
      expect(result.mutations.every((m) => m.id === 'pc-1')).toBe(true);
      expect(result.prompt).toContain('Mira');
      expect(result.prompt).toContain('Fighter');
    }
  });

  it('reports finalization errors for an invalid draft', () => {
    const result = recipe.finalize(
      { ...validDraft, className: 'Artificer' },
      metadata,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('resolves the D&D recipe by system id and only that system', () => {
    expect(resolveCharacterCreationRecipe('dnd5e-srd')).toBe(recipe);
    expect(
      resolveCharacterCreationRecipe('pathfinder2e-remaster'),
    ).toBeUndefined();
  });
});
