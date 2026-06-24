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

  it('lists every SRD class in canonical-key order', () => {
    const classes = resolver.listClasses();
    expect(classes).toHaveLength(12);
    const keys = classes.map((c) => c.key);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
    expect(keys).toContain('class:fighter');
    expect(keys).toContain('class:warlock');
    const fighter = classes.find((c) => c.key === 'class:fighter');
    expect(fighter?.hitDie).toBe(10);
    expect(fighter?.primaryAbilities).toContain('Strength');
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

  it('exposes structured class option/progression metadata for level-1 creation', () => {
    const fighter = resolver.resolveClass('Fighter');
    expect(fighter.ok).toBe(true);
    if (fighter.ok) {
      expect(fighter.record.skillChoices?.[0]).toMatchObject({ choose: 2 });
      expect(fighter.record.skillChoices?.[0].from).toContain('Athletics');
      expect(fighter.record.startingEquipment?.entries.length).toBeGreaterThan(
        0,
      );
      expect(fighter.record.level1?.featureRefs).toContain(
        'feature:fighter:second-wind',
      );
      // A martial class has no level-1 spellcasting block.
      expect(fighter.record.level1?.spellcasting).toBeUndefined();
    }

    const wizard = resolver.resolveClass('Wizard');
    expect(wizard.ok).toBe(true);
    if (wizard.ok) {
      expect(wizard.record.level1?.spellcasting).toMatchObject({
        cantripsKnown: 3,
        slots: { '1': 2 },
      });
    }

    const bard = resolver.resolveClass('Bard');
    if (bard.ok) {
      expect(bard.record.level1?.spellcasting?.spellsKnown).toBe(4);
    }
  });

  it('exposes ancestry traits and resolves the background record', () => {
    const elf = resolver.resolveAncestry('Elf');
    expect(elf.ok).toBe(true);
    if (elf.ok) {
      expect(elf.record.speed).toBe(30);
      const increase = elf.record.traits?.find((t) =>
        /ability score increase/i.test(t.name),
      );
      expect(increase?.text).toMatch(/Dexterity/);
    }

    const acolyte = resolver.resolveBackground('Acolyte');
    expect(acolyte.ok).toBe(true);
    if (acolyte.ok) {
      expect(acolyte.record.skillProficiencies).toEqual(
        expect.arrayContaining(['Insight', 'Religion']),
      );
      expect(acolyte.record.languages).toMatch(/choice/i);
    }
    expect(resolver.resolveBackground('Noble').ok).toBe(false);
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
