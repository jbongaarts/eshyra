import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT_MECHANICS_SPECS,
  equipmentMechanicsFor,
} from '../scripts/importers/dnd5e-srd-5.1/equipmentMechanics.js';
import { EQUIPMENT_MECHANICS_REVIEW } from '../scripts/importers/dnd5e-srd-5.1/equipmentMechanicsReview.js';
import {
  parseWeaponProperties,
  WeaponPropertyShapeError,
} from '../scripts/importers/dnd5e-srd-5.1/parseEquipment.js';
import { validateRecordKindSchema } from '../src/rules/kindSchemas.js';
import type { RulesRecord } from '../src/rules/types.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const records = JSON.parse(
  readFileSync(
    resolve(
      ROOT,
      'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
    ),
    'utf8',
  ),
) as RulesRecord[];
const equipment = records.filter((record) => record.kind === 'equipment');
const byKey = new Map(equipment.map((record) => [record.key, record]));
const inventory = JSON.parse(
  readFileSync(
    resolve(
      ROOT,
      'docs/audits/dnd5e-srd-5.1-final/o9bd-18-7-6-equipment-mechanics-inventory.json',
    ),
    'utf8',
  ),
) as {
  recordCount: number;
  mechanicallyActiveRecords: number;
  curatedProjectionRecords: number;
  clauseCount: number;
  records: Array<{
    recordKey: string;
    disposition: string;
    requiredDeterministicRepresentation: string[];
    sourceBindings: Array<{ clauseId: string; phrase: string }>;
  }>;
};

// Independent reviewed membership: this list is deliberately not derived from
// EQUIPMENT_MECHANICS_SPECS or generated output.
const EXPECTED_CURATED_KEYS = [
  'equipment:acid-vial',
  'equipment:alchemists-fire-flask',
  'equipment:antitoxin-vial',
  'equipment:ball-bearings-bag-of-1-000',
  'equipment:block-and-tackle',
  'equipment:caltrops-bag-of-20',
  'equipment:candle',
  'equipment:case-crossbow-bolt',
  'equipment:case-map-or-scroll',
  'equipment:chain-10-feet',
  'equipment:climbers-kit',
  'equipment:crowbar',
  'equipment:healers-kit',
  'equipment:holy-water-flask',
  'equipment:hunting-trap',
  'equipment:lamp',
  'equipment:lance',
  'equipment:lantern-bullseye',
  'equipment:lantern-hooded',
  'equipment:lock',
  'equipment:magnifying-glass',
  'equipment:manacles',
  'equipment:net',
  'equipment:oil-flask',
  'equipment:poison-basic-vial',
  'equipment:quiver',
  'equipment:ram-portable',
  'equipment:rope-hempen-50-feet',
  'equipment:rope-silk-50-feet',
  'equipment:scale-merchants',
  'equipment:spellbook',
  'equipment:spyglass',
  'equipment:tent-two-person',
  'equipment:tinderbox',
  'equipment:torch',
] as const;

describe('SRD equipment mechanics inventory', () => {
  it('pins exact corpus and curated membership', () => {
    expect(equipment).toHaveLength(218);
    expect(inventory.recordCount).toBe(218);
    expect(inventory.mechanicallyActiveRecords).toBe(174);
    expect(inventory.curatedProjectionRecords).toBe(35);
    expect(inventory.clauseCount).toBe(75);
    expect(
      EQUIPMENT_MECHANICS_SPECS.map((spec) => spec.recordKey).sort(),
    ).toEqual([...EXPECTED_CURATED_KEYS].sort());
    expect(inventory.records.map((row) => row.recordKey).sort()).toEqual(
      equipment.map((record) => record.key).sort(),
    );
    expect([...EQUIPMENT_MECHANICS_REVIEW.keys()].sort()).toEqual(
      equipment.map((record) => record.key).sort(),
    );
    expect(
      inventory.records
        .filter((row) => row.disposition !== 'not mechanical')
        .every((row) => row.disposition.length > 0),
    ).toBe(true);
  });

  it('binds every projected value to retained source evidence', () => {
    for (const spec of EQUIPMENT_MECHANICS_SPECS) {
      const record = byKey.get(spec.recordKey);
      expect(record).toBeDefined();
      const description = (record?.data as { description: string })
        ?.description;
      for (const clause of spec.clauses)
        expect(description).toContain(clause.sourcePhrase);
      const inventoryRow = inventory.records.find(
        (row) => row.recordKey === spec.recordKey,
      );
      const expectedBindingIds = [
        ...spec.clauses.map((clause) => clause.id),
        ...(spec.consumptionSourcePhrase ? ['consumption'] : []),
        ...(spec.modelAdjudicatedQualifiers ?? []).map(() => 'model-qualifier'),
      ];
      expect(
        inventoryRow?.sourceBindings.map((binding) => binding.clauseId),
      ).toEqual(expectedBindingIds);
    }
  });

  it('fails closed when consumption, creator, or fuel evidence drifts', () => {
    const drift = (key: string, from: string, to: string) => {
      const record = byKey.get(key) as RulesRecord;
      const spec = EQUIPMENT_MECHANICS_SPECS.find(
        (candidate) => candidate.recordKey === key,
      );
      expect(spec).toBeDefined();
      const data = record.data as {
        category: string;
        description: string;
      };
      expect(data.description).toContain(from);
      expect(() =>
        equipmentMechanicsFor(
          {
            name: record.name,
            category: data.category,
            sourcePage: spec?.pages[0] ?? 0,
            descriptionSourcePage: spec?.pages.at(-1),
            description: data.description.replace(from, to),
          },
          key,
        ),
      ).toThrow(/source phrase drifted/i);
    };

    drift('equipment:healers-kit', 'ten uses', 'eleven uses');
    drift('equipment:holy-water-flask', 'A cleric or paladin', 'A cleric');
    drift('equipment:lamp', '6 hours', '5 hours');
    drift('equipment:lantern-bullseye', '6 hours', '5 hours');
    drift('equipment:lantern-hooded', '6 hours', '5 hours');
  });

  it('pins the re-reviewed closed capacities and external potion owner', () => {
    const semantics = (key: string) =>
      (
        byKey.get(key)?.data as {
          useProfile: { clauses: Array<{ semantics: unknown }> };
        }
      )?.useProfile.clauses.map((entry) => entry.semantics);

    expect(semantics('equipment:case-crossbow-bolt')).toEqual([
      { capacity: { item: 'crossbow-bolt', maximum: 20 } },
    ]);
    expect(semantics('equipment:case-map-or-scroll')).toEqual([
      {
        capacity: {
          alternatives: [
            { item: 'paper-sheet', maximum: 10 },
            { item: 'parchment-sheet', maximum: 5 },
          ],
        },
      },
    ]);
    expect(semantics('equipment:spellbook')).toEqual([
      { capacity: { item: 'recorded-spell-page', maximum: 100 } },
    ]);
    expect(
      EQUIPMENT_MECHANICS_REVIEW.get('equipment:potion-of-healing'),
    ).toMatchObject({
      disposition: 'externally owned runtime behavior',
      owners: ['magic-item:potion-of-healing', 'eshyra-o9bd.18.7.7.4'],
    });
  });

  it('pins owner-specific requirements for every external category', () => {
    const required = (key: string) =>
      inventory.records.find((row) => row.recordKey === key)
        ?.requiredDeterministicRepresentation;

    expect(required('equipment:arrows-20')).toEqual([
      'inventory quantity and remove_item',
    ]);
    expect(required('equipment:potion-of-healing')).toEqual([
      'canonical magic-item:potion-of-healing implementation',
    ]);
    expect(required('equipment:alchemists-supplies')).toEqual([
      'applicable canonical tool/focus rule-owned procedure',
    ]);
    expect(required('equipment:amulet')).toEqual([
      'applicable canonical tool/focus rule-owned procedure',
    ]);
  });
});

describe('closed armor and weapon table semantics', () => {
  it('reconstructs every armor AC cell', () => {
    for (const record of equipment.filter(
      (entry) => (entry.data as { category?: string }).category === 'armor',
    )) {
      const data = record.data as {
        ac: string;
        armorType: string;
        armorClass: {
          base?: number;
          bonus?: number;
          dexModifier?: string;
          dexModifierCap?: number;
        };
      };
      const reconstructed =
        data.armorType === 'shield'
          ? `+${data.armorClass.bonus}`
          : data.armorClass.dexModifier === 'unlimited'
            ? `${data.armorClass.base} + Dex modifier`
            : data.armorClass.dexModifier === 'capped'
              ? `${data.armorClass.base} + Dex modifier (max ${data.armorClass.dexModifierCap})`
              : `${data.armorClass.base}`;
      expect(reconstructed).toBe(data.ac);
    }
  });

  it('reconstructs every raw weapon property and rejects unknown grammar', () => {
    for (const record of equipment.filter(
      (entry) => (entry.data as { category?: string }).category === 'weapon',
    )) {
      const data = record.data as {
        properties: string[];
        weaponProperties: Array<{ source: string }>;
      };
      expect(data.weaponProperties.map((property) => property.source)).toEqual(
        data.properties,
      );
    }
    expect(() => parseWeaponProperties(['Exploding (range maybe)'])).toThrow(
      WeaponPropertyShapeError,
    );
  });

  it('represents the complete special-weapon membership', () => {
    const special = equipment.filter((record) =>
      (
        (record.data as { weaponProperties?: Array<{ kind: string }> })
          .weaponProperties ?? []
      ).some((property) => property.kind === 'special'),
    );
    expect(special.map((record) => record.key).sort()).toEqual([
      'equipment:lance',
      'equipment:net',
    ]);
    expect(
      (
        byKey.get('equipment:net')?.data as {
          useProfile: { clauses: Array<{ id: string }> };
        }
      )?.useProfile.clauses.map((clause) => clause.id),
    ).toEqual(['restrain', 'ineffective', 'escape', 'destroy', 'one-attack']);
  });
});

describe('equipment use-profile schema', () => {
  const acid = byKey.get('equipment:acid-vial') as RulesRecord;
  it('keeps reusable, inventory-unit, source-defined, and finite-use economies distinct', () => {
    const kind = (key: string) =>
      (
        byKey.get(key)?.data as {
          useProfile: { consumption: { kind: string } };
        }
      )?.useProfile.consumption.kind;
    expect(kind('equipment:acid-vial')).toBe('inventory-unit');
    expect(kind('equipment:healers-kit')).toBe('finite-uses');
    expect(kind('equipment:net')).toBe('not-consumed');
    expect(kind('equipment:torch')).toBe('source-defined');
    expect(
      (
        byKey.get('equipment:healers-kit')?.data as {
          useProfile: { consumption: { maximum: number; reset: string } };
        }
      )?.useProfile.consumption,
    ).toMatchObject({ maximum: 10, reset: 'none' });
  });

  it('rejects unknown fields, incompatible consumption, and empty semantics', () => {
    const mutate = (
      fn: (profile: Record<string, unknown>) => void,
    ): RulesRecord => {
      const copy = structuredClone(acid) as RulesRecord;
      fn((copy.data as { useProfile: Record<string, unknown> }).useProfile);
      return copy;
    };
    expect(() =>
      validateRecordKindSchema(
        mutate((profile) => {
          profile.extra = true;
        }),
        'record',
      ),
    ).toThrow(/unsupported key/);
    expect(() =>
      validateRecordKindSchema(
        mutate((profile) => {
          profile.consumption = {
            kind: 'finite-uses',
            maximum: 10,
            usesPerActivation: 1,
            reset: 'daily',
          };
        }),
        'record',
      ),
    ).toThrow(/reset must be "none"/);
    expect(() =>
      validateRecordKindSchema(
        mutate((profile) => {
          const clauses = profile.clauses as Array<{ semantics: object }>;
          clauses[0].semantics = {};
        }),
        'record',
      ),
    ).toThrow(/semantics must not be empty/);
    expect(() =>
      validateRecordKindSchema(
        mutate((profile) => {
          const clauses = profile.clauses as Array<{
            semantics: Record<string, unknown>;
          }>;
          clauses[0].semantics.whatever = 'prose';
        }),
        'record',
      ),
    ).toThrow(/unsupported key/);
  });
});
