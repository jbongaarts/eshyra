import { describe, expect, it } from 'vitest';
import {
  createRulesPackCharacterResolver,
  getBundledDnd5eCharacterResolver,
  getBundledDnd5eSrdPack,
  resolveRulesStack,
} from '../src/internal.js';

const resolver = getBundledDnd5eCharacterResolver();

describe('rules-pack character resolver', () => {
  it('resolves every SRD class by display name with its hit die', () => {
    const fighter = resolver.resolveClass('Fighter');
    expect(fighter.ok).toBe(true);
    if (fighter.ok) {
      expect(fighter.record.key).toBe('class:fighter');
      expect(fighter.record.hitDie).toBe(10);
      expect(fighter.record.savingThrowProficiencies).toContain('Constitution');
    }

    // Warlock was absent from the retired SRD_CATALOG seed; the generated pack
    // carries all twelve SRD classes.
    const warlock = resolver.resolveClass('Warlock');
    expect(warlock.ok).toBe(true);
    if (warlock.ok) {
      expect(warlock.record.hitDie).toBe(8);
    }
  });

  it('resolves a class by canonical key as well as by name', () => {
    const byKey = resolver.resolveClass('class:wizard');
    expect(byKey.ok).toBe(true);
    if (byKey.ok) {
      expect(byKey.record.name).toBe('Wizard');
      expect(byKey.record.hitDie).toBe(6);
    }
  });

  it('reports a not_found result for an unknown class', () => {
    const result = resolver.resolveClass('Artificer');
    expect(result).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('resolves spells with their legal class list', () => {
    const fireBolt = resolver.resolveSpell('Fire Bolt');
    expect(fireBolt.ok).toBe(true);
    if (fireBolt.ok) {
      expect(fireBolt.record.level).toBe(0);
      expect(fireBolt.record.classes).toEqual(
        expect.arrayContaining(['Sorcerer', 'Wizard']),
      );
      expect(fireBolt.record.classes).not.toContain('Fighter');
    }
  });

  it('resolves ancestries beyond the single legacy Human seed', () => {
    expect(resolver.resolveAncestry('Human').ok).toBe(true);
    expect(resolver.resolveAncestry('Elf').ok).toBe(true);
    expect(resolver.resolveAncestry('Dragonborn').ok).toBe(true);
    expect(resolver.resolveAncestry('Gobbo').ok).toBe(false);
  });

  it('can be built over an explicit resolved stack', () => {
    const stack = resolveRulesStack({ base: getBundledDnd5eSrdPack() });
    const explicit = createRulesPackCharacterResolver(stack);
    expect(explicit.resolveClass('Rogue').ok).toBe(true);
  });
});
