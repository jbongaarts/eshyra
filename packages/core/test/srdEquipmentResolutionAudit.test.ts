/**
 * Tests for the SRD equipment filter / proficiency resolution audit
 * (`src/rules/srdEquipmentResolutionAudit.ts`, eshyra-erf5.3.3).
 *
 * Two layers, mirroring srdPlayabilityAudit.test.ts:
 *  1. Fixture tests — synthetic packs prove the resolver logic (weapon
 *     category/range, equipment groups, named single-item phrases, and the
 *     fail-closed behaviors) independently of the real pack.
 *  2. Real-pack tests — the committed bundled pack resolves every filter and
 *     proficiency phrase to at least one candidate, so the gate is GREEN
 *     today and any future regression in weaponCategory/weaponRange/
 *     equipmentGroup tagging or a newly-introduced unreviewed proficiency
 *     phrase fails this suite.
 */

import { describe, expect, it } from 'vitest';
import {
  assertEquipmentResolution,
  auditEquipmentResolution,
  EquipmentResolutionEmptyError,
  getBundledDnd5eSrdPack,
  type RulesPack,
  type RulesPackLicense,
  type RulesRecord,
  UnresolvedProficiencyPhraseError,
} from '../src/internal.js';

const LICENSE: RulesPackLicense = {
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

function record(overrides: Partial<RulesRecord>): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'equipment',
    key: 'equipment:example',
    name: 'Example',
    data: {},
    source: 'Example SRD p. 1',
    license: LICENSE,
    provenance: { sourceRef: 'https://example.test', locator: 'p. 1' },
    ...overrides,
  };
}

function pack(records: readonly RulesRecord[]): RulesPack {
  return {
    meta: {
      packId: 'rules:dnd5e-srd-5.1',
      title: 'D&D 5e SRD 5.1',
      description: 'Fixture pack.',
      role: 'base',
      systemId: 'dnd5e-srd',
      version: '5.1',
      license: LICENSE,
      source: {
        sourceTitle: 'Example SRD',
        sourceVersion: '5.1',
        sourceUrl: 'https://example.test',
        recordProvenancePolicy: 'cite page',
      },
    },
    records,
  };
}

const CLUB = record({
  key: 'equipment:club',
  name: 'Club',
  data: { category: 'weapon', weaponCategory: 'simple', weaponRange: 'melee' },
});
const LONGSWORD = record({
  key: 'equipment:longsword',
  name: 'Longsword',
  data: {
    category: 'weapon',
    weaponCategory: 'martial',
    weaponRange: 'melee',
  },
});
const LONGBOW = record({
  key: 'equipment:longbow',
  name: 'Longbow',
  data: {
    category: 'weapon',
    weaponCategory: 'martial',
    weaponRange: 'ranged',
  },
});
const CRYSTAL = record({
  key: 'equipment:crystal',
  name: 'Crystal',
  data: { category: 'gear', equipmentGroup: 'arcane-focus' },
});
const LEATHER = record({
  key: 'equipment:leather',
  name: 'Leather',
  data: { category: 'armor', armorType: 'light' },
});
const SHIELD = record({
  key: 'equipment:shield',
  name: 'Shield',
  data: { category: 'armor', armorType: 'shield' },
});
const DAGGER = record({
  key: 'equipment:dagger',
  name: 'Dagger',
  data: { category: 'weapon', weaponCategory: 'simple', weaponRange: 'melee' },
});

const FIGHTER = record({
  kind: 'class',
  key: 'class:fighter',
  name: 'Fighter',
  data: {
    armorProficiencies: ['All armor', 'shields'],
    weaponProficiencies: ['Simple weapons', 'martial weapons'],
    toolProficiencies: [],
    startingEquipment: {
      entries: [
        {
          kind: 'fixed',
          text: 'a martial weapon',
          sourceText: 'a martial weapon',
          grants: [
            {
              kind: 'filter',
              select: 'weapon',
              quantity: 1,
              weaponCategory: 'martial',
            },
          ],
        },
      ],
    },
  },
});

describe('auditEquipmentResolution — starting-equipment filters', () => {
  it('resolves a weapon filter by category and range', () => {
    const results = auditEquipmentResolution(
      pack([CLUB, LONGSWORD, LONGBOW, FIGHTER]),
    );
    const martial = results.find(
      (r) =>
        r.source === 'starting-equipment-filter' &&
        r.phrase.startsWith('weapon/martial'),
    );
    expect(martial?.candidateKeys).toEqual([
      'equipment:longbow',
      'equipment:longsword',
    ]);
  });

  it('resolves a focus/symbol/instrument filter by equipmentGroup', () => {
    // Mirrors the real background equipmentGrants[] shape: a bare `select`
    // field, not nested under `kind: 'filter'` the way class starting
    // equipment grants are.
    const acolyte = record({
      kind: 'background',
      key: 'background:example',
      data: {
        equipmentGrants: [
          { quantity: 1, name: 'an arcane focus', select: 'arcane-focus' },
        ],
      },
    });
    const results = auditEquipmentResolution(pack([CRYSTAL, acolyte]));
    const focus = results.find((r) => r.phrase === 'arcane-focus');
    expect(focus?.candidateKeys).toEqual(['equipment:crystal']);
  });

  it('fails closed when a filter resolves to zero candidates', () => {
    const results = auditEquipmentResolution(pack([FIGHTER]));
    expect(() => assertEquipmentResolution(results)).toThrow(
      EquipmentResolutionEmptyError,
    );
  });
});

describe('auditEquipmentResolution — class equipment proficiencies', () => {
  it('resolves broad armor/weapon categories via structured tags', () => {
    const results = auditEquipmentResolution(
      pack([CLUB, LONGSWORD, LEATHER, SHIELD, FIGHTER]),
    );
    const allArmor = results.find(
      (r) => r.source === 'class-proficiency' && r.phrase === 'All armor',
    );
    expect(allArmor?.candidateKeys.sort()).toEqual([
      'equipment:leather',
      'equipment:shield',
    ]);
    const shields = results.find((r) => r.phrase === 'shields');
    expect(shields?.candidateKeys).toEqual(['equipment:shield']);
    const simple = results.find((r) => r.phrase === 'Simple weapons');
    expect(simple?.candidateKeys).toEqual(['equipment:club']);
    const martial = results.find((r) => r.phrase === 'martial weapons');
    expect(martial?.candidateKeys).toEqual(['equipment:longsword']);
  });

  it('resolves a named single-weapon proficiency to its one equipment key', () => {
    const rogue = record({
      kind: 'class',
      key: 'class:rogue',
      data: {
        armorProficiencies: [],
        weaponProficiencies: ['Simple weapons', 'hand crossbows'],
        toolProficiencies: ['Thieves’ tools'],
      },
    });
    const crossbowHand = record({
      key: 'equipment:crossbow-hand',
      name: 'Crossbow, hand',
      data: {
        category: 'weapon',
        weaponCategory: 'martial',
        weaponRange: 'ranged',
      },
    });
    const thievesTools = record({
      key: 'equipment:thieves-tools',
      name: 'Thieves’ tools',
      data: { category: 'tool' },
    });
    const results = auditEquipmentResolution(
      pack([DAGGER, crossbowHand, thievesTools, rogue]),
    );
    expect(
      results.find((r) => r.phrase === 'hand crossbows')?.candidateKeys,
    ).toEqual(['equipment:crossbow-hand']);
    expect(
      results.find((r) => r.phrase === 'Thieves’ tools')?.candidateKeys,
    ).toEqual(['equipment:thieves-tools']);
  });

  it('fails closed on an unreviewed proficiency phrase', () => {
    const weird = record({
      kind: 'class',
      key: 'class:weird',
      data: {
        armorProficiencies: ['Exotic armor'],
        weaponProficiencies: [],
        toolProficiencies: [],
      },
    });
    expect(() => auditEquipmentResolution(pack([weird]))).toThrow(
      UnresolvedProficiencyPhraseError,
    );
  });
});

describe('auditEquipmentResolution — committed SRD 5.1 pack', () => {
  const results = auditEquipmentResolution(getBundledDnd5eSrdPack());

  it('resolves every starting-equipment filter and class proficiency phrase to at least one candidate', () => {
    expect(() => assertEquipmentResolution(results)).not.toThrow();
    expect(results.length).toBeGreaterThan(20);
  });

  it('reports the four focus/symbol/instrument filters with their full candidate sets', () => {
    const byPhrase = new Map(results.map((r) => [r.phrase, r]));
    expect(byPhrase.get('arcane-focus')?.candidateKeys).toEqual([
      'equipment:crystal',
      'equipment:orb',
      'equipment:rod',
      'equipment:staff',
      'equipment:wand',
    ]);
    expect(byPhrase.get('druidic-focus')?.candidateKeys?.length).toBe(4);
    expect(byPhrase.get('holy-symbol')?.candidateKeys?.length).toBe(3);
    expect(byPhrase.get('musical-instrument')?.candidateKeys?.length).toBe(10);
  });

  it('resolves martial melee weapon starting-equipment filters to concrete candidates', () => {
    const martialMelee = results.find(
      (r) =>
        r.source === 'starting-equipment-filter' &&
        r.phrase === 'weapon/martial/melee',
    );
    expect(martialMelee?.candidateKeys.length).toBeGreaterThan(0);
    expect(martialMelee?.candidateKeys).toContain('equipment:longsword');
  });

  it('resolves every class Simple/martial weapon and armor-category proficiency', () => {
    const simple = results.find((r) => r.phrase === 'Simple weapons');
    const martial = results.find((r) => r.phrase === 'martial weapons');
    const allArmor = results.find((r) => r.phrase === 'All armor');
    const light = results.find((r) => r.phrase === 'Light armor');
    const medium = results.find((r) => r.phrase === 'medium armor');
    const shields = results.find((r) => r.phrase === 'shields');
    for (const found of [simple, martial, allArmor, light, medium, shields]) {
      expect(found?.candidateKeys.length ?? 0).toBeGreaterThan(0);
    }
  });
});
