/**
 * Unit tests for the feature-choice deriver (eshyra-o9bd.9).
 *
 * `deriveFeatureChoices` is a pure post-emit pass that reads the assembled
 * class/subclass/feature records and attaches structured `data.choices[]` to
 * the feature each player build choice hangs off. These tests build minimal
 * records and assert the derived choice shape per modeling slice; the committed
 * pack's real coverage is asserted by the `choice-coverage` gate baseline in
 * `srdPlayabilityAudit.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { deriveFeatureChoices } from '../../../scripts/importers/dnd5e-srd-5.1/deriveFeatureChoices.js';
import type {
  RulesPackLicense,
  RulesRecord,
} from '../../../src/internal.js';

const LICENSE: RulesPackLicense = {
  licenseClass: 'open',
  licenseName: 'CC-BY-4.0',
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

function rec(
  kind: RulesRecord['kind'],
  key: string,
  name: string,
  data: Record<string, unknown>,
): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind,
    key,
    name,
    data,
    source: 'SRD p. 1',
    license: LICENSE,
    provenance: { sourceRef: 'https://example.test', locator: 'p. 1' },
  };
}

/** A class record granting `featureKey` at `level`, with a subclass-feature
 * slot labelled `slotName` so the subclass deriver can find the group base. */
function classRec(
  key: string,
  name: string,
  opts: {
    grants: ReadonlyArray<{ ref: string; level: number }>;
    slotName?: string;
    slotLevel?: number;
  },
): RulesRecord {
  const progression: Array<Record<string, unknown>> = opts.grants.map((g) => ({
    level: g.level,
    advancement: [{ kind: 'featureGrant', ref: g.ref }],
  }));
  if (opts.slotName !== undefined) {
    progression.push({
      level: opts.slotLevel ?? 6,
      advancement: [
        {
          kind: 'subclassFeatureSlot',
          slotName: opts.slotName,
          subclassLevel: opts.slotLevel ?? 6,
        },
      ],
    });
  }
  return rec('class', key, name, { progression });
}

function featureChoices(
  records: readonly RulesRecord[],
  key: string,
): Array<Record<string, unknown>> {
  const feature = records.find((r) => r.key === key);
  const choices = (feature?.data as { choices?: unknown }).choices;
  return Array.isArray(choices)
    ? (choices as Array<Record<string, unknown>>)
    : [];
}

describe('deriveFeatureChoices — subclass selection (eshyra-o9bd.9.2)', () => {
  it('attaches a subclass choice to the selector feature named after the slot base', () => {
    const classRecords = [
      classRec('class:fighter', 'Fighter', {
        grants: [{ ref: 'feature:fighter:martial-archetype', level: 3 }],
        slotName: 'Martial Archetype feature',
        slotLevel: 7,
      }),
    ];
    const subclassRecords = [
      rec('subclass', 'subclass:champion', 'Champion', {
        parentClass: 'class:fighter',
        description: 'A champion.',
      }),
    ];
    const featureRecords = [
      rec('feature', 'feature:fighter:martial-archetype', 'Martial Archetype', {
        source: 'class:fighter',
        level: 3,
        description: 'At 3rd level, you choose an archetype.',
      }),
    ];

    const out = deriveFeatureChoices({
      classRecords,
      subclassRecords,
      featureRecords,
    });
    const choices = featureChoices(out, 'feature:fighter:martial-archetype');
    expect(choices).toEqual([
      {
        id: 'subclass',
        category: 'subclass',
        prompt: 'Choose your Martial Archetype.',
        level: 3,
        choose: 1,
        from: ['subclass:champion'],
      },
    ]);
  });

  it('matches a selector whose name has the slot base as a trailing word (Barbarian Primal Path)', () => {
    const classRecords = [
      classRec('class:barbarian', 'Barbarian', {
        grants: [{ ref: 'feature:barbarian:primal-path', level: 3 }],
        slotName: 'Path feature',
      }),
    ];
    const subclassRecords = [
      rec('subclass', 'subclass:path-of-the-berserker', 'Berserker', {
        parentClass: 'class:barbarian',
        description: 'Rage.',
      }),
    ];
    const featureRecords = [
      rec('feature', 'feature:barbarian:primal-path', 'Primal Path', {
        source: 'class:barbarian',
        level: 3,
        description: 'At 3rd level, you choose a path.',
      }),
    ];
    const out = deriveFeatureChoices({
      classRecords,
      subclassRecords,
      featureRecords,
    });
    const choices = featureChoices(out, 'feature:barbarian:primal-path');
    expect(choices).toHaveLength(1);
    expect(choices[0].category).toBe('subclass');
    expect(choices[0].from).toEqual(['subclass:path-of-the-berserker']);
  });

  it('sorts multiple subclass options and leaves classes without subclasses untouched', () => {
    const classRecords = [
      classRec('class:cleric', 'Cleric', {
        grants: [{ ref: 'feature:cleric:divine-domain', level: 1 }],
        slotName: 'Divine Domain feature',
        slotLevel: 1,
      }),
    ];
    const subclassRecords = [
      rec('subclass', 'subclass:life-domain', 'Life', {
        parentClass: 'class:cleric',
        description: 'x',
      }),
      rec('subclass', 'subclass:war-domain', 'War', {
        parentClass: 'class:cleric',
        description: 'x',
      }),
    ];
    const featureRecords = [
      rec('feature', 'feature:cleric:divine-domain', 'Divine Domain', {
        source: 'class:cleric',
        level: 1,
        description: 'Choose one domain.',
      }),
    ];
    const out = deriveFeatureChoices({
      classRecords,
      subclassRecords,
      featureRecords,
    });
    expect(featureChoices(out, 'feature:cleric:divine-domain')[0].from).toEqual([
      'subclass:life-domain',
      'subclass:war-domain',
    ]);
  });

  it('leaves features with no derived choice unchanged (no empty choices array)', () => {
    const featureRecords = [
      rec('feature', 'feature:fighter:second-wind', 'Second Wind', {
        source: 'class:fighter',
        level: 1,
        description: 'Regain hit points.',
      }),
    ];
    const out = deriveFeatureChoices({
      classRecords: [],
      subclassRecords: [],
      featureRecords,
    });
    expect((out[0].data as { choices?: unknown }).choices).toBeUndefined();
  });
});
