/**
 * Tests for the inline-option resolver (`src/rules/inlineFeatureOptions.ts`,
 * eshyra-ldqb): addressable ids for SRD options nested under
 * `feature.data.choices[].options[]` (Fighting Styles, Metamagic, Eldritch
 * Invocations, Pact Boons, ...).
 */

import { describe, expect, it } from 'vitest';
import {
  buildInlineFeatureOptionIndex,
  buildInlineFeatureOptionIndexForPack,
  getBundledDnd5eSrdPack,
  type RulesPackLicense,
  type RulesRecord,
  resolveInlineFeatureOption,
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

function feature(key: string, data: Record<string, unknown>): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'feature',
    key,
    name: key,
    data,
    source: 'Example SRD p. 1',
    license: LICENSE,
    provenance: { sourceRef: 'https://example.test', locator: 'p. 1' },
  };
}

describe('buildInlineFeatureOptionIndex', () => {
  it('indexes every option under every choice on every feature record', () => {
    const pactBoon = feature('feature:warlock:pact-boon', {
      choices: [
        {
          id: 'pact-boon',
          options: [
            { id: 'pact-boon:pact-of-the-chain', name: 'Pact of the Chain' },
            { id: 'pact-boon:pact-of-the-blade', name: 'Pact of the Blade' },
          ],
        },
      ],
    });
    const index = buildInlineFeatureOptionIndex([pactBoon]);
    expect(
      resolveInlineFeatureOption(index, 'pact-boon:pact-of-the-blade'),
    ).toEqual([
      {
        id: 'pact-boon:pact-of-the-blade',
        name: 'Pact of the Blade',
        featureKey: 'feature:warlock:pact-boon',
        choiceId: 'pact-boon',
      },
    ]);
  });

  it('returns undefined for an id no choice offers', () => {
    const index = buildInlineFeatureOptionIndex([]);
    expect(
      resolveInlineFeatureOption(index, 'pact-boon:pact-of-the-undead'),
    ).toBeUndefined();
  });

  it('collects every occurrence when the same option id is reprinted across multiple granting features', () => {
    const fighterStyle = feature('feature:fighter:fighting-style', {
      choices: [
        {
          id: 'fighting-style',
          options: [{ id: 'fighting-style:archery', name: 'Archery' }],
        },
      ],
    });
    const rangerStyle = feature('feature:ranger:fighting-style', {
      choices: [
        {
          id: 'fighting-style',
          options: [{ id: 'fighting-style:archery', name: 'Archery' }],
        },
      ],
    });
    const index = buildInlineFeatureOptionIndex([fighterStyle, rangerStyle]);
    const occurrences = resolveInlineFeatureOption(
      index,
      'fighting-style:archery',
    );
    expect(occurrences).toHaveLength(2);
    expect(occurrences?.map((o) => o.featureKey).sort()).toEqual([
      'feature:fighter:fighting-style',
      'feature:ranger:fighting-style',
    ]);
  });

  it('ignores non-feature records, choices without options, and malformed entries', () => {
    const notAFeature: RulesRecord = {
      ...feature('class:fighter', {
        choices: [{ id: 'x', options: [{ id: 'y', name: 'Y' }] }],
      }),
      kind: 'class',
    };
    const noOptions = feature('feature:no-options', {
      choices: [{ id: 'x' }],
    });
    const index = buildInlineFeatureOptionIndex([notAFeature, noOptions]);
    expect(index.size).toBe(0);
  });
});

describe('Warlock invocation prerequisites resolve against the committed pack (eshyra-ldqb)', () => {
  it('resolves every structured pactBoon prerequisite ref to a real Pact Boon option', () => {
    const pack = getBundledDnd5eSrdPack();
    const index = buildInlineFeatureOptionIndexForPack(pack);
    const invocations = pack.records.find(
      (r) => r.key === 'feature:warlock:eldritch-invocations',
    );
    expect(invocations).toBeDefined();
    const data = invocations?.data as { choices?: unknown[] } | undefined;
    const choices = (data?.choices ?? []) as {
      options?: { prerequisites?: { kind: string; ref: string }[] }[];
    }[];
    const pactBoonRefs = choices
      .flatMap((c) => c.options ?? [])
      .flatMap((o) => o.prerequisites ?? [])
      .filter((p) => p.kind === 'pactBoon')
      .map((p) => p.ref);
    expect(pactBoonRefs.length).toBeGreaterThan(0);
    for (const ref of pactBoonRefs) {
      const resolved = resolveInlineFeatureOption(index, ref);
      expect(resolved, `${ref} should resolve`).toBeDefined();
      expect(resolved?.length).toBeGreaterThan(0);
    }
  });

  it('resolves the Pact of the Tome requiresFeatureOption filter', () => {
    const pack = getBundledDnd5eSrdPack();
    const index = buildInlineFeatureOptionIndexForPack(pack);
    const resolved = resolveInlineFeatureOption(
      index,
      'pact-boon:pact-of-the-tome',
    );
    expect(resolved).toBeDefined();
    expect(resolved?.[0].featureKey).toBe('feature:warlock:pact-boon');
  });
});
