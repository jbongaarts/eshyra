/**
 * Unit evidence for the source-derived Spellcasting/Pact Magic section parity
 * gate (eshyra-o9bd.19.2.2.4). The corpus-wide proof is the importer run
 * itself: `runImporter` calls `assertSpellcastingSections` over the full SRD
 * extraction, and CI's srd-importer-reproducibility job runs
 * `verify:dnd5e-srd-pack` whenever importer or pack files change.
 */
import { describe, expect, it } from 'vitest';
import {
  assertSpellcastingSections,
  auditSpellcastingSections,
  SpellcastingSectionsError,
} from '../../../scripts/importers/dnd5e-srd-5.1/spellcastingSections.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import type { RulesRecord } from '../../../src/rules/types.js';

function classRecord(
  key: string,
  name: string,
  grantedRefs: readonly string[],
): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'class',
    key,
    name,
    data: {
      progression: [
        {
          level: 1,
          advancement: grantedRefs.map((ref) => ({
            kind: 'featureGrant',
            ref,
          })),
        },
      ],
    },
  } as unknown as RulesRecord;
}

function featureRecord(
  key: string,
  name: string,
  source: string,
  sections: readonly string[],
): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'feature',
    key,
    name,
    data: {
      source,
      level: 1,
      description: 'Intro prose.',
      sections: sections.map((sectionName) => ({
        name: sectionName,
        text: `${sectionName} body.`,
      })),
    },
  } as unknown as RulesRecord;
}

// A minimal real-PDF-shaped slice: "Wizard" chapter heading, its
// "Spellcasting" feature heading, two printed subheadings, then the next
// class's chapter heading (which bounds the subsection scan).
const SOURCE: PageText[] = [
  {
    pageNumber: 52,
    lines: ['Wizard', 'Spellcasting', 'Cantrips', 'Spellbook', 'Sorcerer'],
    lineHeights: [25.92, 13.92, 12, 12, 25.92],
  },
];

const WIZARD = classRecord('class:wizard', 'Wizard', [
  'feature:wizard:spellcasting',
]);

function wizardSpellcasting(sections: readonly string[]): RulesRecord {
  return featureRecord(
    'feature:wizard:spellcasting',
    'Spellcasting',
    'class:wizard',
    sections,
  );
}

describe('Spellcasting/Pact Magic section parity gate', () => {
  it('passes when data.sections matches the printed subheadings exactly', () => {
    const spellcasting = wizardSpellcasting(['Cantrips', 'Spellbook']);
    const audit = auditSpellcastingSections([WIZARD, spellcasting], SOURCE);
    expect(audit.perClass).toEqual([
      expect.objectContaining({
        className: 'Wizard',
        featureHeading: 'Spellcasting',
        sourceSectionNames: ['Cantrips', 'Spellbook'],
        emittedFeatureKey: 'feature:wizard:spellcasting',
        missing: [],
        extra: [],
        reordered: false,
      }),
    ]);
    expect(() =>
      assertSpellcastingSections([WIZARD, spellcasting], SOURCE, {
        requireComplete: false,
      }),
    ).not.toThrow();
  });

  it('fails when a printed subsection is missing from data.sections', () => {
    const spellcasting = wizardSpellcasting(['Cantrips']);
    expect(() =>
      assertSpellcastingSections([WIZARD, spellcasting], SOURCE, {
        requireComplete: false,
      }),
    ).toThrow(
      /feature:wizard:spellcasting: printed subsection "Spellbook" is missing/,
    );
  });

  it('fails when data.sections has a section the source does not print', () => {
    const spellcasting = wizardSpellcasting([
      'Cantrips',
      'Spellbook',
      'Extra Thing',
    ]);
    expect(() =>
      assertSpellcastingSections([WIZARD, spellcasting], SOURCE, {
        requireComplete: false,
      }),
    ).toThrow(/data\.sections has "Extra Thing"/);
  });

  it('fails when data.sections is reordered relative to the printed order', () => {
    const spellcasting = wizardSpellcasting(['Spellbook', 'Cantrips']);
    expect(() =>
      assertSpellcastingSections([WIZARD, spellcasting], SOURCE, {
        requireComplete: false,
      }),
    ).toThrow(SpellcastingSectionsError);
    expect(() =>
      assertSpellcastingSections([WIZARD, spellcasting], SOURCE, {
        requireComplete: false,
      }),
    ).toThrow(/does not match the printed order/);
  });

  it('fails when a class-sourced feature has no class-table anchor', () => {
    const spellcasting = wizardSpellcasting(['Cantrips', 'Spellbook']);
    const phantom = featureRecord(
      'feature:wizard:phantom',
      'Phantom Feature',
      'class:wizard',
      [],
    );
    expect(() =>
      assertSpellcastingSections([WIZARD, spellcasting, phantom], SOURCE, {
        requireComplete: false,
      }),
    ).toThrow(
      /feature:wizard:phantom: class-sourced feature is not referenced by any featureGrant\/featureImprovement/,
    );
  });

  it('passes a class-sourced feature reached only through featureImprovement', () => {
    const improved = classRecord('class:wizard', 'Wizard', []);
    const withImprovement: RulesRecord = {
      ...improved,
      data: {
        progression: [
          {
            level: 1,
            advancement: [
              { kind: 'featureGrant', ref: 'feature:wizard:spellcasting' },
            ],
          },
          {
            level: 18,
            advancement: [
              {
                kind: 'featureImprovement',
                targetRefs: ['feature:wizard:spellcasting'],
                label: 'Spell Mastery',
              },
            ],
          },
        ],
      },
    };
    const spellcasting = wizardSpellcasting(['Cantrips', 'Spellbook']);
    expect(() =>
      assertSpellcastingSections([withImprovement, spellcasting], SOURCE, {
        requireComplete: false,
      }),
    ).not.toThrow();
  });

  it('requires all 8 caster classes only on the complete import', () => {
    const noSpellcasting: PageText[] = [
      { pageNumber: 1, lines: ['Barbarian'], lineHeights: [25.92] },
    ];
    expect(() =>
      assertSpellcastingSections([], noSpellcasting, {
        requireComplete: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertSpellcastingSections([], noSpellcasting, {
        requireComplete: true,
      }),
    ).toThrow(/expected all 8 SRD 5\.1 caster classes/);
  });
});
