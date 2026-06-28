import { describe, expect, it } from 'vitest';
import type {
  RulesPack,
  RulesPackLicense,
  RulesRecord,
} from '../src/internal.js';
import {
  ADVANCEMENT_TABLE_REF,
  AdvancementTableError,
  getBundledAdvancementTable,
  getBundledDnd5eSrdPack,
  levelForXp,
  maxAdvancementLevel,
  resolveAdvancementTable,
  resolveRulesStack,
  xpThresholdForLevel,
} from '../src/internal.js';

// The canonical SRD 5.1 Character Advancement table (p. 56), level -> XP.
const SRD_THRESHOLDS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [2, 300],
  [3, 900],
  [4, 2700],
  [5, 6500],
  [6, 14000],
  [7, 23000],
  [8, 34000],
  [9, 48000],
  [10, 64000],
  [11, 85000],
  [12, 100000],
  [13, 120000],
  [14, 140000],
  [15, 165000],
  [16, 195000],
  [17, 225000],
  [18, 265000],
  [19, 305000],
  [20, 355000],
];

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

function packWith(records: readonly RulesRecord[]): RulesPack {
  return {
    meta: {
      packId: 'rules:dnd5e-srd',
      title: 'D&D 5e SRD',
      description: 'fixture',
      role: 'base',
      systemId: 'dnd5e-srd',
      version: '5.1',
      license: license(),
    },
    records,
  };
}

function tableRecord(data: unknown): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'table',
    key: ADVANCEMENT_TABLE_REF,
    name: 'Character Advancement',
    data,
    source: 'SRD 5.1 p. 56',
    license: license(),
  };
}

describe('resolveAdvancementTable (bundled pack)', () => {
  it('locates the character-advancement table in the bundled SRD pack', () => {
    const stack = resolveRulesStack({ base: getBundledDnd5eSrdPack() });
    const result = resolveAdvancementTable(stack);
    expect(result.ok).toBe(true);
  });

  it('parses the table into the exact canonical level -> XP thresholds', () => {
    const table = getBundledAdvancementTable();
    expect(table.thresholds.map((t) => [t.level, t.xpThreshold])).toEqual(
      SRD_THRESHOLDS.map((row) => [row[0], row[1]]),
    );
  });

  it('parses proficiency bonus from the "+N" column to integers', () => {
    const table = getBundledAdvancementTable();
    expect(table.thresholds[0].proficiencyBonus).toBe(2); // level 1
    expect(table.thresholds[19].proficiencyBonus).toBe(6); // level 20
  });

  it('covers levels 1..20 with strictly increasing thresholds', () => {
    const table = getBundledAdvancementTable();
    expect(table.thresholds).toHaveLength(20);
    table.thresholds.forEach((row, i) => {
      expect(row.level).toBe(i + 1);
      if (i > 0) {
        expect(row.xpThreshold).toBeGreaterThan(
          table.thresholds[i - 1].xpThreshold,
        );
      }
    });
    expect(maxAdvancementLevel(table)).toBe(20);
  });
});

describe('threshold lookups', () => {
  const table = getBundledAdvancementTable();

  it('maps each level to its canonical XP threshold', () => {
    for (const [level, xp] of SRD_THRESHOLDS) {
      expect(xpThresholdForLevel(table, level)).toBe(xp);
    }
  });

  it('returns undefined for an out-of-range level', () => {
    expect(xpThresholdForLevel(table, 21)).toBeUndefined();
    expect(xpThresholdForLevel(table, 0)).toBeUndefined();
  });

  it('finds the highest level reached for a given XP total', () => {
    expect(levelForXp(table, 0)).toBe(1);
    expect(levelForXp(table, 299)).toBe(1);
    expect(levelForXp(table, 300)).toBe(2);
    expect(levelForXp(table, 2699)).toBe(3);
    expect(levelForXp(table, 2700)).toBe(4);
    expect(levelForXp(table, 355000)).toBe(20);
    expect(levelForXp(table, 9_999_999)).toBe(20);
  });
});

describe('malformed / missing tables (synthetic packs)', () => {
  it('reports not_found when the table is absent', () => {
    const stack = resolveRulesStack({ base: packWith([]) });
    const result = resolveAdvancementTable(stack);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_found');
  });

  it('reports malformed when required columns are missing', () => {
    const stack = resolveRulesStack({
      base: packWith([tableRecord({ columns: ['Level'], rows: [[1]] })]),
    });
    const result = resolveAdvancementTable(stack);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('malformed');
  });

  it('reports malformed when levels are non-contiguous', () => {
    const stack = resolveRulesStack({
      base: packWith([
        tableRecord({
          columns: ['Experience Points', 'Level', 'Proficiency Bonus'],
          rows: [
            [0, 1, '+2'],
            [900, 3, '+2'],
          ],
        }),
      ]),
    });
    const result = resolveAdvancementTable(stack);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('malformed');
  });

  it('reports malformed when XP thresholds do not strictly increase', () => {
    const stack = resolveRulesStack({
      base: packWith([
        tableRecord({
          columns: ['Experience Points', 'Level', 'Proficiency Bonus'],
          rows: [
            [0, 1, '+2'],
            [0, 2, '+2'],
          ],
        }),
      ]),
    });
    const result = resolveAdvancementTable(stack);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('malformed');
  });

  it('getBundledAdvancementTable throws only on a real pack defect', () => {
    // The bundled pack is audited, so this resolves; the throwing path is the
    // documented contract for a malformed bundled table.
    expect(() => getBundledAdvancementTable()).not.toThrow();
    expect(AdvancementTableError).toBeTypeOf('function');
  });
});
