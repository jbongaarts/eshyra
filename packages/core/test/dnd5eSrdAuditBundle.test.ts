import { describe, expect, it } from 'vitest';
import {
  assertGameplayReadinessDispositions,
  buildGameplayReadinessReport,
  buildOverlayParityReport,
} from '../scripts/create-dnd5e-srd-audit-bundle/cli.js';
import {
  getBundledDnd5eSrdPack,
  type RulesPack,
  type RulesPackLicense,
  type RulesRecord,
} from '../src/internal.js';

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

describe('D&D SRD audit bundle gameplay-readiness report', () => {
  it('counts condition effects and exhaustion levels as partial structure, not prose-only', () => {
    const report = buildGameplayReadinessReport(
      pack([
        record({
          kind: 'condition',
          key: 'condition:blinded',
          name: 'Blinded',
          data: {
            description: 'A blinded creature cannot see.',
            effects: ['A blinded creature cannot see.'],
          },
        }),
        record({
          kind: 'condition',
          key: 'condition:exhaustion',
          name: 'Exhaustion',
          data: {
            description: 'Exhaustion is measured in six levels.',
            levels: [{ level: 1, effect: 'Disadvantage on ability checks' }],
          },
        }),
      ]),
      [],
    );

    expect(report.byKind.condition).toMatchObject({
      totalRecords: 2,
      recordsWithPartialStructure: 2,
      proseOnlyRecords: 0,
    });
    expect(report.byKind.condition.examples.partialStructure).toEqual([
      'condition:blinded',
      'condition:exhaustion',
    ]);
    expect(report.byKind.condition.examples.proseOnly).toEqual([]);
  });

  // eshyra-txxa: `hasMechanicsProjection` only checked top-level
  // `data.mechanics`/`data.projection`, `data.traits[].mechanics`, and
  // `data.feature.mechanics`, undercounting creature mechanics that live in
  // nested actions/reactions/legendary actions instead.
  it('counts mechanics nested in creature actions, reactions, and legendary actions', () => {
    const report = buildGameplayReadinessReport(
      pack([
        record({
          kind: 'creature',
          key: 'creature:action-only',
          name: 'Action Only',
          data: {
            actions: [
              {
                name: 'Bite',
                text: 'Melee attack.',
                mechanics: { attacks: [], damage: [] },
              },
            ],
          },
        }),
        record({
          kind: 'creature',
          key: 'creature:reaction-only',
          name: 'Reaction Only',
          data: {
            reactions: [
              {
                name: 'Parry',
                text: 'Reaction.',
                mechanics: { attacks: [] },
              },
            ],
          },
        }),
        record({
          kind: 'creature',
          key: 'creature:legendary-only',
          name: 'Legendary Only',
          data: {
            legendaryActions: {
              description: 'Can take 3 legendary actions.',
              entries: [
                {
                  name: 'Detect',
                  text: 'Perception check.',
                  mechanics: { attacks: [] },
                },
              ],
            },
          },
        }),
        record({
          kind: 'creature',
          key: 'creature:no-mechanics',
          name: 'No Mechanics',
          data: {
            actions: [{ name: 'Bite', text: 'Melee attack, no mechanics.' }],
          },
        }),
      ]),
      [],
    );

    expect(report.byKind.creature).toMatchObject({
      totalRecords: 4,
      recordsWithMechanicsProjections: 3,
    });
    expect(report.byKind.creature.examples.mechanicsProjections).toEqual([
      'creature:action-only',
      'creature:legendary-only',
      'creature:reaction-only',
    ]);
  });

  it('pins the committed pack creature mechanics-projection count to the documented 314/317 baseline', () => {
    // Matches docs/audits/dnd5e-srd-5.1-final/mechanics-projection-report.md
    // and the audit's own direct-scan count (eshyra-txxa) — before this fix
    // the report undercounted at 100/317 by only checking top-level fields.
    const report = buildGameplayReadinessReport(getBundledDnd5eSrdPack(), []);
    expect(report.byKind.creature).toMatchObject({
      totalRecords: 317,
      recordsWithMechanicsProjections: 314,
    });
  });
});

describe('D&D SRD audit bundle overlay-vs-pack parity report (eshyra-jk4d)', () => {
  it('does not flag a prepared-caster class whose pack data matches the overlay, including preparationFormula', () => {
    const report = buildOverlayParityReport(
      pack([
        record({
          kind: 'class',
          key: 'class:cleric',
          name: 'Cleric',
          data: {
            spellcastingAbility: 'wisdom',
            spellPreparation: {
              kind: 'prepared',
              preparationFormula: {
                ability: 'wisdom',
                classLevelDivisor: 1,
                minimum: 1,
              },
              sourceText:
                'You prepare the list of cleric spells that are available for you to cast, choosing from the cleric spell list. When you do so, choose a number of cleric spells equal to your Wisdom modifier + your cleric level (minimum of one spell). Wisdom is your spellcasting ability for your cleric spells.',
            },
          },
        }),
      ]),
    );

    expect(report.summary.mismatchedFacts).toBe(0);
    expect(
      report.checks.filter(
        (check) =>
          check.key === 'class:cleric' && check.field === 'spellPreparation',
      ),
    ).toEqual([
      expect.objectContaining({ key: 'class:cleric', status: 'match' }),
    ]);
  });

  it('still flags a genuine spellPreparation mismatch (e.g. wrong preparationFormula divisor)', () => {
    const report = buildOverlayParityReport(
      pack([
        record({
          kind: 'class',
          key: 'class:cleric',
          name: 'Cleric',
          data: {
            spellcastingAbility: 'wisdom',
            spellPreparation: {
              kind: 'prepared',
              preparationFormula: {
                ability: 'wisdom',
                classLevelDivisor: 2,
                minimum: 1,
              },
              sourceText:
                'You prepare the list of cleric spells that are available for you to cast, choosing from the cleric spell list. When you do so, choose a number of cleric spells equal to your Wisdom modifier + your cleric level (minimum of one spell). Wisdom is your spellcasting ability for your cleric spells.',
            },
          },
        }),
      ]),
    );

    expect(report.summary.mismatchedFacts).toBe(1);
    expect(
      report.checks.find(
        (check) =>
          check.key === 'class:cleric' && check.field === 'spellPreparation',
      ),
    ).toMatchObject({ status: 'mismatch' });
  });
});

describe('gameplay-readiness dispositions (eshyra-o9bd.18.9.6)', () => {
  it('is fail-closed on a not-yet-modeled bucket without a policy entry', () => {
    const report = buildGameplayReadinessReport(
      pack([
        record({
          kind: 'deity',
          key: 'deity:prose-only',
          name: 'Prose Only',
          data: { description: 'A deity described only in prose.' },
        }),
      ]),
      [],
    );

    // Fixture packs also leave the committed-pack policy entries stale;
    // only the uncovered-bucket error matters here.
    expect(
      report.dispositionErrors.filter((error) =>
        error.startsWith('deity#prose-only'),
      ),
    ).toEqual([expect.stringContaining('no reviewed disposition')]);
    expect(() => assertGameplayReadinessDispositions(report)).toThrow(
      /deity#prose-only/,
    );
  });

  it('does not require dispositions for modeled records', () => {
    const report = buildGameplayReadinessReport(
      pack([
        record({
          kind: 'deity',
          key: 'deity:modeled',
          name: 'Modeled',
          data: {
            description: 'Prose plus a mechanics projection.',
            mechanics: { effects: [] },
          },
        }),
      ]),
      [],
    );

    const deityErrors = report.dispositionErrors.filter((error) =>
      error.startsWith('deity#'),
    );
    expect(deityErrors).toEqual([]);
  });

  it('categorizes every committed-pack bucket via the reviewed policy and passes fail-closed', () => {
    const report = buildGameplayReadinessReport(getBundledDnd5eSrdPack(), []);

    expect(report.dispositionErrors).toEqual([]);
    expect(() => assertGameplayReadinessDispositions(report)).not.toThrow();
    // Every disposition is one of the reviewed categories, and every
    // finding is linked to a bead so a future audit cannot rediscover the
    // bucket without a tracked closure decision.
    for (const disposition of report.dispositions) {
      expect(['accepted-prose-only', 'unsupported', 'finding']).toContain(
        disposition.status,
      );
      if (disposition.status === 'finding') {
        expect(disposition.bead).toMatch(/^eshyra-/);
      }
      expect(disposition.count).toBeGreaterThan(0);
      expect(disposition.reason.length).toBeGreaterThan(0);
    }
    // The broad buckets the 2026-07-01 review flagged are all present and
    // linked to their modeling beads.
    const byKey = new Map(
      report.dispositions.map((d) => [`${d.kind}#${d.bucket}`, d]),
    );
    expect(byKey.get('magic-item#prose-only')?.bead).toBe('eshyra-o9bd.18.7.7');
    expect(byKey.get('rule#prose-only')?.bead).toBe('eshyra-o9bd.18.7.8');
    expect(byKey.get('equipment#prose-only')?.bead).toBe('eshyra-o9bd.18.7.6');
    expect(byKey.get('feature#prose-only')?.bead).toBe('eshyra-o9bd.18.7.5');
    expect(byKey.get('creature#partial-structure')?.bead).toBe(
      'eshyra-o9bd.18.7.3',
    );
  });

  it('reports a stale policy entry when its bucket is empty', () => {
    // The full policy names magic-item#prose-only (among others); a pack
    // with no magic items leaves those entries stale, which must fail.
    const report = buildGameplayReadinessReport(
      pack([
        record({
          kind: 'creature',
          key: 'creature:with-traits',
          name: 'With Traits',
          data: {
            traits: [{ name: 'Amphibious', text: 'Breathes air and water.' }],
          },
        }),
      ]),
      [],
    );

    expect(report.dispositionErrors).toEqual(
      expect.arrayContaining([expect.stringContaining('stale disposition')]),
    );
    expect(() => assertGameplayReadinessDispositions(report)).toThrow(
      /stale disposition/,
    );
  });
});
