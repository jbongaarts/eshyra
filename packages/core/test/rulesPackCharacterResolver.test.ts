import { describe, expect, it } from 'vitest';
import type {
  RulesPack,
  RulesPackLicense,
  RulesRecord,
} from '../src/internal.js';
import {
  createRulesPackCharacterResolver,
  getBundledDnd5eCharacterResolver,
  getBundledDnd5eSrdPack,
  resolveRulesStack,
} from '../src/internal.js';

const resolver = getBundledDnd5eCharacterResolver();

const EXPECTED_STRICT_LEVEL_UP_UNSUPPORTED_ROWS = [
  { className: 'Barbarian', level: 6, featureNames: ['Path feature'] },
  { className: 'Barbarian', level: 10, featureNames: ['Path feature'] },
  { className: 'Barbarian', level: 14, featureNames: ['Path feature'] },
  { className: 'Bard', level: 6, featureNames: ['Bard College feature'] },
  { className: 'Bard', level: 14, featureNames: ['Bard College feature'] },
  { className: 'Cleric', level: 2, featureNames: ['Divine Domain feature'] },
  { className: 'Cleric', level: 6, featureNames: ['Divine Domain feature'] },
  { className: 'Cleric', level: 8, featureNames: ['Divine Domain feature'] },
  { className: 'Cleric', level: 17, featureNames: ['Divine Domain feature'] },
  {
    className: 'Cleric',
    level: 20,
    featureNames: ['Divine Intervention improvement'],
  },
  { className: 'Druid', level: 4, featureNames: ['Wild Shape improvement'] },
  { className: 'Druid', level: 6, featureNames: ['Druid Circle feature'] },
  { className: 'Druid', level: 8, featureNames: ['Wild Shape improvement'] },
  { className: 'Druid', level: 10, featureNames: ['Druid Circle feature'] },
  { className: 'Druid', level: 14, featureNames: ['Druid Circle feature'] },
  {
    className: 'Fighter',
    level: 7,
    featureNames: ['Martial Archetype feature'],
  },
  {
    className: 'Fighter',
    level: 10,
    featureNames: ['Martial Archetype feature'],
  },
  {
    className: 'Fighter',
    level: 15,
    featureNames: ['Martial Archetype feature'],
  },
  {
    className: 'Fighter',
    level: 18,
    featureNames: ['Martial Archetype feature'],
  },
  {
    className: 'Monk',
    level: 6,
    featureNames: ['Monastic Tradition feature'],
  },
  {
    className: 'Monk',
    level: 9,
    featureNames: ['Unarmored Movement improvement'],
  },
  {
    className: 'Monk',
    level: 11,
    featureNames: ['Monastic Tradition feature'],
  },
  {
    className: 'Monk',
    level: 17,
    featureNames: ['Monastic Tradition feature'],
  },
  { className: 'Paladin', level: 7, featureNames: ['Sacred Oath feature'] },
  { className: 'Paladin', level: 15, featureNames: ['Sacred Oath feature'] },
  { className: 'Paladin', level: 18, featureNames: ['Aura improvements'] },
  { className: 'Paladin', level: 20, featureNames: ['Sacred Oath feature'] },
  {
    className: 'Ranger',
    level: 1,
    featureNames: [],
  },
  {
    className: 'Ranger',
    level: 6,
    featureNames: ['Favored Enemy and Natural Explorer improvements'],
  },
  {
    className: 'Ranger',
    level: 7,
    featureNames: ['Ranger Archetype feature'],
  },
  {
    className: 'Ranger',
    level: 10,
    featureNames: ['Natural Explorer improvement'],
  },
  {
    className: 'Ranger',
    level: 11,
    featureNames: ['Ranger Archetype feature'],
  },
  {
    className: 'Ranger',
    level: 14,
    featureNames: ['Favored Enemy improvement'],
  },
  {
    className: 'Ranger',
    level: 15,
    featureNames: ['Ranger Archetype feature'],
  },
  { className: 'Rogue', level: 1, featureNames: ['Thieves Cant'] },
  {
    className: 'Rogue',
    level: 9,
    featureNames: ['Roguish Archetype feature'],
  },
  {
    className: 'Rogue',
    level: 13,
    featureNames: ['Roguish Archetype feature'],
  },
  {
    className: 'Rogue',
    level: 17,
    featureNames: ['Roguish Archetype feature'],
  },
  {
    className: 'Sorcerer',
    level: 6,
    featureNames: ['Sorcerous Origin feature'],
  },
  {
    className: 'Sorcerer',
    level: 14,
    featureNames: ['Sorcerous Origin feature'],
  },
  {
    className: 'Sorcerer',
    level: 18,
    featureNames: ['Sorcerous Origin feature'],
  },
  {
    className: 'Warlock',
    level: 6,
    featureNames: ['Otherworldly Patron feature'],
  },
  {
    className: 'Warlock',
    level: 10,
    featureNames: ['Otherworldly Patron feature'],
  },
  {
    className: 'Warlock',
    level: 14,
    featureNames: ['Otherworldly Patron feature'],
  },
  {
    className: 'Wizard',
    level: 6,
    featureNames: ['Arcane Tradition feature'],
  },
  {
    className: 'Wizard',
    level: 10,
    featureNames: ['Arcane Tradition feature'],
  },
  {
    className: 'Wizard',
    level: 14,
    featureNames: ['Arcane Tradition feature'],
  },
  { className: 'Wizard', level: 20, featureNames: ['Signature Spell'] },
] as const;

function license(): RulesPackLicense {
  return {
    licenseClass: 'open',
    licenseName: 'Creative Commons Attribution 4.0 International',
    attributionText: 'Rules text derived from an open SRD fixture.',
    requiresAttribution: true,
    commercialUseAllowed: true,
    hostedUseAllowed: true,
    redistributionAllowed: true,
    publicSharingAllowed: true,
    derivativeAllowed: true,
    containsUserSuppliedText: false,
    containsTrademarkedSettingMaterial: false,
    sourceMaterialDescription: 'Open fantasy rules reference.',
    provenancePolicy: 'Every record includes source and license metadata.',
    outputRestrictions: 'Preserve attribution on redistributed records.',
  };
}

function record(overrides: Partial<RulesRecord>): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'class',
    key: 'class:example',
    name: 'Example',
    data: {},
    source: 'Example SRD p. 1',
    license: license(),
    ...overrides,
  };
}

/** A minimal base pack carrying exactly the supplied records. */
function packWith(records: readonly RulesRecord[]): RulesPack {
  return {
    meta: {
      packId: 'rules:dnd5e-srd',
      title: 'D&D 5e SRD',
      description: 'Provider-neutral rules fixture.',
      role: 'base',
      systemId: 'dnd5e-srd',
      version: '5.1',
      license: license(),
    },
    records,
  };
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortedUnsupportedRows(
  rows: ReadonlyArray<{
    readonly className: string;
    readonly level: number;
    readonly featureNames: readonly string[];
  }>,
) {
  return [...rows].sort(
    (left, right) =>
      left.className.localeCompare(right.className) || left.level - right.level,
  );
}

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

  it('resolves martial class progression rows across levels', () => {
    const fighter = resolver.resolveClassLevel('Fighter', 5);
    expect(fighter.ok).toBe(true);
    if (fighter.ok) {
      expect(fighter.record).toMatchObject({
        level: 5,
        proficiencyBonus: 3,
        featureRefs: expect.arrayContaining(['feature:fighter:extra-attack']),
      });
      expect(fighter.record.spellcasting).toBeUndefined();
    }
  });

  it('resolves caster class progression rows with spellcasting slots', () => {
    const wizard = resolver.resolveClassLevel('class:wizard', 3);
    expect(wizard.ok).toBe(true);
    if (wizard.ok) {
      expect(wizard.record).toMatchObject({
        level: 3,
        proficiencyBonus: 2,
        spellcasting: {
          cantripsKnown: 3,
          slots: { '1': 4, '2': 2 },
        },
      });
    }
  });

  it('keeps the frozen SRD strict level-up unsupported row set explicit', () => {
    const actualUnsupportedRows: Array<{
      className: string;
      level: number;
      featureNames: string[];
    }> = [];

    for (const record of getBundledDnd5eSrdPack().records) {
      if (record.kind !== 'class' || !isRecordValue(record.data)) {
        continue;
      }
      const progression = record.data.progression;
      if (!Array.isArray(progression)) {
        continue;
      }
      for (const row of progression) {
        if (!isRecordValue(row) || typeof row.level !== 'number') {
          continue;
        }
        const result = resolver.resolveClassLevel(record.name, row.level);
        if (!result.ok && result.code === 'malformed') {
          const featureNames = Array.isArray(row.features)
            ? row.features
                .filter(
                  (feature): feature is { readonly name: string } =>
                    isRecordValue(feature) &&
                    typeof feature.name === 'string' &&
                    typeof feature.ref !== 'string',
                )
                .map((feature) => feature.name)
            : [];
          actualUnsupportedRows.push({
            className: record.name,
            level: row.level,
            featureNames,
          });
        }
      }
    }

    expect(sortedUnsupportedRows(actualUnsupportedRows)).toEqual(
      sortedUnsupportedRows(EXPECTED_STRICT_LEVEL_UP_UNSUPPORTED_ROWS),
    );
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

  describe('list methods (guided-creation list/search)', () => {
    it('lists ancestries in canonical-key order', () => {
      const ancestries = resolver.listAncestries();
      expect(ancestries.length).toBeGreaterThan(0);
      const keys = ancestries.map((a) => a.key);
      expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
      expect(ancestries.map((a) => a.name)).toContain('High Elf');
    });

    it('lists backgrounds and spells through the same resolver as lookups', () => {
      expect(resolver.listBackgrounds().map((b) => b.name)).toContain(
        'Acolyte',
      );
      const fireBolt = resolver
        .listSpells()
        .find((s) => s.name === 'Fire Bolt');
      expect(fireBolt?.level).toBe(0);
      expect(fireBolt?.classes).toContain('Wizard');
    });

    it('only lists well-formed records (skips malformed)', () => {
      const stack = resolveRulesStack({
        base: packWith([
          record({
            kind: 'ancestry',
            key: 'ancestry:good',
            name: 'Good Folk',
            data: { speed: 30, traits: [] },
          }),
          // Spell missing its level → fails the spell guard → skipped.
          record({
            kind: 'spell',
            key: 'spell:bad',
            name: 'Bad Spell',
            data: { classes: ['Wizard'] },
          }),
        ]),
      });
      const built = createRulesPackCharacterResolver(stack);
      expect(built.listAncestries().map((a) => a.name)).toEqual(['Good Folk']);
      expect(built.listSpells()).toEqual([]);
    });
  });

  describe('generated-data typed guards', () => {
    it('reports a malformed result for a class missing required fields', () => {
      const stack = resolveRulesStack({
        base: packWith([
          // hitDie is required by the class typed guard; omit it.
          record({
            key: 'class:brokenfighter',
            name: 'Broken Fighter',
            data: {
              primaryAbilities: ['Strength'],
              savingThrowProficiencies: ['Strength', 'Constitution'],
            },
          }),
        ]),
      });
      const result =
        createRulesPackCharacterResolver(stack).resolveClass('Broken Fighter');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('malformed');
        expect(result.message).toMatch(/class:brokenfighter/);
      }
    });

    it('reports a malformed result for a spell missing its level', () => {
      const stack = resolveRulesStack({
        base: packWith([
          record({
            kind: 'spell',
            key: 'spell:brokenbolt',
            name: 'Broken Bolt',
            // level is required by the spell typed guard; omit it.
            data: { classes: ['Wizard'] },
          }),
        ]),
      });
      const result =
        createRulesPackCharacterResolver(stack).resolveSpell('Broken Bolt');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('malformed');
        expect(result.message).toMatch(/spell:brokenbolt/);
      }
    });

    it('distinguishes malformed from not_found', () => {
      const stack = resolveRulesStack({ base: packWith([]) });
      const result =
        createRulesPackCharacterResolver(stack).resolveClass('Nonexistent');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('not_found');
      }
    });

    it('reports a malformed result for an unusable class progression row', () => {
      const stack = resolveRulesStack({
        base: packWith([
          record({
            key: 'class:brokenprogression',
            name: 'Broken Progression',
            data: {
              hitDie: 10,
              primaryAbilities: ['Strength'],
              savingThrowProficiencies: ['Strength', 'Constitution'],
              progression: [
                {
                  level: 1,
                  proficiencyBonus: 'two',
                  features: [],
                },
              ],
            },
          }),
        ]),
      });
      const result = createRulesPackCharacterResolver(stack).resolveClassLevel(
        'Broken Progression',
        1,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('malformed');
        expect(result.message).toMatch(/class:brokenprogression/);
      }
    });

    it('reports a malformed result for a class progression row with malformed feature entries', () => {
      const stack = resolveRulesStack({
        base: packWith([
          record({
            key: 'class:brokenfeatures',
            name: 'Broken Features',
            data: {
              hitDie: 10,
              primaryAbilities: ['Strength'],
              savingThrowProficiencies: ['Strength', 'Constitution'],
              progression: [
                {
                  level: 5,
                  proficiencyBonus: '+3',
                  features: [
                    { ref: 'feature:fighter:extra-attack' },
                    { name: 'Bad Feature' },
                  ],
                },
              ],
            },
          }),
        ]),
      });
      const result = createRulesPackCharacterResolver(stack).resolveClassLevel(
        'Broken Features',
        5,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('malformed');
        expect(result.message).toMatch(/class:brokenfeatures/);
      }
    });

    it('reports a not_found result for a missing class progression level', () => {
      const stack = resolveRulesStack({
        base: packWith([
          record({
            key: 'class:onelevel',
            name: 'One Level',
            data: {
              hitDie: 10,
              primaryAbilities: ['Strength'],
              savingThrowProficiencies: ['Strength', 'Constitution'],
              progression: [
                {
                  level: 1,
                  proficiencyBonus: '+2',
                  features: [],
                },
              ],
            },
          }),
        ]),
      });
      const result = createRulesPackCharacterResolver(stack).resolveClassLevel(
        'One Level',
        2,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('not_found');
        expect(result.message).toMatch(/level 2/);
      }
    });
  });
});
