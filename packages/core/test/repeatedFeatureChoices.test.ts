/**
 * Tests for advancement-level-aware repeated feature choice instantiation
 * (`src/rules/repeatedFeatureChoices.ts`, eshyra-qhac).
 */

import { describe, expect, it } from 'vitest';
import {
  deriveFeatureChoiceInstances,
  featureGrantLevels,
  getBundledDnd5eSrdPack,
  type RulesPack,
  type RulesPackLicense,
  type RulesRecord,
} from '../src/internal.js';

const LICENSE: RulesPackLicense = {
  licenseClass: 'open',
  licenseName: 'Creative Commons Attribution 4.0 International',
  attributionText: 'fixture',
  requiresAttribution: true,
  commercialUseAllowed: true,
  hostedUseAllowed: true,
  redistributionAllowed: true,
  publicSharingAllowed: true,
  derivativeAllowed: true,
  containsUserSuppliedText: false,
  containsTrademarkedSettingMaterial: false,
  sourceMaterialDescription: 'fixture',
  provenancePolicy: 'fixture',
  outputRestrictions: 'fixture',
};

function record(
  partial: Pick<RulesRecord, 'kind' | 'key' | 'name' | 'data'>,
): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    source: 'fixture',
    license: LICENSE,
    provenance: { sourceRef: 'fixture', locator: 'p. 1' },
    ...partial,
  };
}

function pack(records: readonly RulesRecord[]): RulesPack {
  return {
    meta: {
      packId: 'rules:dnd5e-srd-5.1',
      title: 'Fixture',
      description: 'Fixture pack.',
      role: 'base',
      systemId: 'dnd5e-srd',
      version: '5.1',
      license: LICENSE,
    },
    records,
  };
}

function classGranting(
  classKey: string,
  rows: readonly { level: number; featureRef: string }[],
): RulesRecord {
  return record({
    kind: 'class',
    key: classKey,
    name: classKey,
    data: {
      progression: rows.map(({ level, featureRef }) => ({
        level,
        advancement: [{ kind: 'featureGrant', ref: featureRef }],
      })),
    },
  });
}

describe('featureGrantLevels', () => {
  it('collects every class-progression level that grants a feature, ascending and deduplicated', () => {
    const cls = classGranting('class:fighter', [
      { level: 4, featureRef: 'feature:fighter:ability-score-improvement' },
      { level: 6, featureRef: 'feature:fighter:ability-score-improvement' },
      { level: 1, featureRef: 'feature:fighter:fighting-style' },
    ]);
    expect(
      featureGrantLevels(
        pack([cls]),
        'feature:fighter:ability-score-improvement',
      ),
    ).toEqual([4, 6]);
  });

  it('returns an empty array for a feature no class progression grants', () => {
    expect(featureGrantLevels(pack([]), 'feature:fighter:nope')).toEqual([]);
  });
});

describe('deriveFeatureChoiceInstances', () => {
  it('repeats a single-level-modeled choice at every grant level, overriding level on the copies', () => {
    const cls = classGranting('class:fighter', [
      { level: 4, featureRef: 'feature:fighter:ability-score-improvement' },
      { level: 6, featureRef: 'feature:fighter:ability-score-improvement' },
      { level: 14, featureRef: 'feature:fighter:ability-score-improvement' },
    ]);
    const feature = record({
      kind: 'feature',
      key: 'feature:fighter:ability-score-improvement',
      name: 'Ability Score Improvement',
      data: {
        choices: [
          {
            id: 'ability-score-improvement',
            category: 'asiOrFeat',
            prompt: 'Increase ability scores.',
            level: 4,
            choose: 2,
            from: ['strength', 'dexterity'],
          },
        ],
      },
    });
    const instances = deriveFeatureChoiceInstances(
      pack([cls, feature]),
      feature,
    );
    expect(instances).toHaveLength(3);
    expect(instances.map((i) => i.grantLevel)).toEqual([4, 6, 14]);
    // The level-4 instance is the source entry itself, unmodified.
    expect(instances[0].sourceLevel).toBe(4);
    expect(instances[0].choice.level).toBe(4);
    expect(instances[0].choice).toBe(feature.data.choices[0]);
    // Levels 6 and 14 are repeated copies: same choose/from, level overridden.
    for (const i of [instances[1], instances[2]]) {
      expect(i.sourceLevel).toBe(4);
      expect(i.choice.level).toBe(i.grantLevel);
      expect(i.choice.choose).toBe(2);
      expect(i.choice.from).toEqual(['strength', 'dexterity']);
    }
  });

  it('does not duplicate a feature whose choices already have one correctly-leveled entry per grant level', () => {
    const cls = classGranting('class:warlock', [
      { level: 11, featureRef: 'feature:warlock:mystic-arcanum' },
      { level: 13, featureRef: 'feature:warlock:mystic-arcanum' },
    ]);
    const feature = record({
      kind: 'feature',
      key: 'feature:warlock:mystic-arcanum',
      name: 'Mystic Arcanum',
      data: {
        choices: [
          {
            id: 'arcanum-6',
            category: 'spell',
            prompt: 'Choose a 6th-level spell.',
            level: 11,
            choose: 1,
          },
          {
            id: 'arcanum-7',
            category: 'spell',
            prompt: 'Choose a 7th-level spell.',
            level: 13,
            choose: 1,
          },
        ],
      },
    });
    const instances = deriveFeatureChoiceInstances(
      pack([cls, feature]),
      feature,
    );
    expect(instances).toHaveLength(2);
    expect(instances.map((i) => `${i.choiceId}@${i.grantLevel}`)).toEqual([
      'arcanum-6@11',
      'arcanum-7@13',
    ]);
    // Returned as-is, not cloned.
    expect(instances[0].choice).toBe(feature.data.choices[0]);
    expect(instances[1].choice).toBe(feature.data.choices[1]);
  });

  it('returns an empty array when the feature has no choices or no class grants it', () => {
    const noChoices = record({
      kind: 'feature',
      key: 'feature:x',
      name: 'X',
      data: {},
    });
    expect(deriveFeatureChoiceInstances(pack([]), noChoices)).toEqual([]);

    const ungranted = record({
      kind: 'feature',
      key: 'feature:y',
      name: 'Y',
      data: {
        choices: [
          { id: 'y', category: 'other', prompt: 'p', level: 1, choose: 1 },
        ],
      },
    });
    expect(deriveFeatureChoiceInstances(pack([]), ungranted)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Real committed-pack regression coverage
// ---------------------------------------------------------------------------

function featureRecord(srdPack: RulesPack, key: string): RulesRecord {
  const found = srdPack.records.find((r) => r.key === key);
  if (found === undefined) throw new Error(`fixture gap: ${key} not found`);
  return found;
}

describe('committed SRD pack: repeated feature choices (eshyra-qhac)', () => {
  const srdPack = getBundledDnd5eSrdPack();

  it('Fighter Ability Score Improvement: 7 grant levels (4, 6, 8, 12, 14, 16, 19), 2 choices each', () => {
    const feature = featureRecord(
      srdPack,
      'feature:fighter:ability-score-improvement',
    );
    expect(
      featureGrantLevels(srdPack, 'feature:fighter:ability-score-improvement'),
    ).toEqual([4, 6, 8, 12, 14, 16, 19]);
    const instances = deriveFeatureChoiceInstances(srdPack, feature);
    expect(instances).toHaveLength(14); // 7 levels x 2 choice ids (asi + feat)
    const byLevel = new Map<number, string[]>();
    for (const i of instances) {
      byLevel.set(i.grantLevel, [
        ...(byLevel.get(i.grantLevel) ?? []),
        i.choiceId,
      ]);
    }
    expect([...byLevel.keys()].sort((a, b) => a - b)).toEqual([
      4, 6, 8, 12, 14, 16, 19,
    ]);
    // Non-4 grants (eshyra-qhac explicitly calls out 6 and 14) carry the same
    // choice shape as the source entry, with only level overridden.
    for (const level of [6, 14]) {
      const asi = instances.find(
        (i) =>
          i.grantLevel === level && i.choiceId === 'ability-score-improvement',
      );
      expect(asi?.sourceLevel).toBe(4);
      expect(asi?.choice.level).toBe(level);
      expect(asi?.choice.choose).toBe(2);
      expect(asi?.choice.from).toEqual([
        'strength',
        'dexterity',
        'constitution',
        'intelligence',
        'wisdom',
        'charisma',
      ]);
      const feat = instances.find(
        (i) => i.grantLevel === level && i.choiceId === 'feat',
      );
      expect(feat?.choice.level).toBe(level);
      expect(feat?.choice.unsupported).toBeDefined();
    }
  });

  it.each([
    'feature:barbarian:ability-score-improvement',
    'feature:cleric:ability-score-improvement',
    'feature:rogue:ability-score-improvement',
  ])('%s: every grant level produces an instance with level overridden', (key) => {
    const feature = featureRecord(srdPack, key);
    const grantLevels = featureGrantLevels(srdPack, key);
    expect(grantLevels.length).toBeGreaterThan(1);
    const instances = deriveFeatureChoiceInstances(srdPack, feature);
    const grantLevelsCovered = new Set(instances.map((i) => i.grantLevel));
    expect([...grantLevelsCovered].sort((a, b) => a - b)).toEqual(grantLevels);
    for (const i of instances) expect(i.choice.level).toBe(i.grantLevel);
  });

  it('Cleric Channel Divinity (2, 6, 18): repeats the level-2 template at 6 and 18', () => {
    const key = 'feature:cleric:channel-divinity';
    const feature = featureRecord(srdPack, key);
    expect(featureGrantLevels(srdPack, key)).toEqual([2, 6, 18]);
    const instances = deriveFeatureChoiceInstances(srdPack, feature);
    expect(instances.map((i) => i.grantLevel)).toEqual([2, 6, 18]);
    expect(instances.every((i) => i.sourceLevel === 2)).toBe(true);
  });

  it('Rogue Expertise (1, 6): repeats the level-1 template at 6', () => {
    const key = 'feature:rogue:expertise';
    const feature = featureRecord(srdPack, key);
    expect(featureGrantLevels(srdPack, key)).toEqual([1, 6]);
    const instances = deriveFeatureChoiceInstances(srdPack, feature);
    expect(instances.map((i) => i.grantLevel)).toEqual([1, 6]);
  });

  it('Sorcerer Metamagic (3, 10, 17): repeats the level-3 template at 10 and 17', () => {
    const key = 'feature:sorcerer:metamagic';
    const feature = featureRecord(srdPack, key);
    expect(featureGrantLevels(srdPack, key)).toEqual([3, 10, 17]);
    const instances = deriveFeatureChoiceInstances(srdPack, feature);
    expect(instances.map((i) => i.grantLevel)).toEqual([3, 10, 17]);
  });

  it('Warlock Mystic Arcanum (11, 13, 15, 17): already one choice per grant level, no duplication', () => {
    const key = 'feature:warlock:mystic-arcanum';
    const feature = featureRecord(srdPack, key);
    expect(featureGrantLevels(srdPack, key)).toEqual([11, 13, 15, 17]);
    const instances = deriveFeatureChoiceInstances(srdPack, feature);
    expect(instances).toHaveLength(4);
    expect(instances.map((i) => i.grantLevel)).toEqual([11, 13, 15, 17]);
    expect(instances.map((i) => i.sourceLevel)).toEqual([11, 13, 15, 17]);
  });
});
