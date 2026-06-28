/**
 * Tests for the playable-model audit gates (`src/rules/srdPlayabilityAudit.ts`,
 * eshyra-o9bd.11).
 *
 * Two layers:
 *  1. Fixture tests — each gate FIRES on a minimal record shaped like the
 *     committed pack's deficiency and is SILENT on the corrected shape. These
 *     guard gate correctness independently of the real pack.
 *  2. Real-pack baseline tests — each gate is run over the committed bundled
 *     pack. The genuinely-RED gates assert findings exist with a "flip to 0
 *     when eshyra-o9bd.N lands" note (so the modeling bead is forced to update
 *     this test as its done-marker); the already-GREEN gate asserts zero.
 *
 * The aggregate `re-freeze readiness` test uses `it.fails`: it currently passes
 * because the pack is not yet playable-clean, and will START FAILING (alarming)
 * once every gate is green — forcing eshyra-o9bd.14 to convert it to a hard
 * green assertion before re-freeze.
 */

import { describe, expect, it } from 'vitest';
import {
  auditSrdPlayability,
  countSrdPlayabilityByCategory,
  formatSrdPlayabilityReport,
  getBundledDnd5eSrdPack,
  type RulesPack,
  type RulesPackLicense,
  type RulesRecord,
  type SrdPlayabilityCategory,
  type SrdPlayabilityFinding,
  srdPlayabilityHasFindings,
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
    kind: 'class',
    key: 'class:fighter',
    name: 'Fighter',
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

const findingsByCategory = (
  findings: readonly SrdPlayabilityFinding[],
  category: SrdPlayabilityCategory,
): SrdPlayabilityFinding[] => findings.filter((f) => f.category === category);

// ---------------------------------------------------------------------------
// Fixture tests — gate correctness
// ---------------------------------------------------------------------------

describe('untyped-progression-marker gate', () => {
  it('fires on an advancement entry with an unknown kind', () => {
    const cls = record({
      key: 'class:barbarian',
      name: 'Barbarian',
      data: {
        progression: [{ level: 6, advancement: [{ kind: 'mysteryMarker' }] }],
      },
    });
    const findings = findingsByCategory(
      auditSrdPlayability(pack([cls])),
      'untyped-progression-marker',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('unknown/missing kind');
    expect(findings[0].bead).toBe('eshyra-o9bd.2');
  });

  it('fires on a row missing the typed advancement[] array', () => {
    const cls = record({
      key: 'class:barbarian',
      name: 'Barbarian',
      data: { progression: [{ level: 3 }] },
    });
    const findings = findingsByCategory(
      auditSrdPlayability(pack([cls])),
      'untyped-progression-marker',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('no typed advancement[] array');
  });

  it('is silent on typed advancement entries (grant, subclass slot)', () => {
    const cls = record({
      key: 'class:barbarian',
      name: 'Barbarian',
      data: {
        progression: [
          {
            level: 1,
            advancement: [
              {
                kind: 'featureGrant',
                ref: 'feature:barbarian:rage',
                name: 'Rage',
              },
            ],
          },
          {
            level: 6,
            advancement: [
              {
                kind: 'subclassFeatureSlot',
                slotName: 'Path feature',
                subclassLevel: 6,
              },
            ],
          },
        ],
      },
    });
    expect(
      findingsByCategory(
        auditSrdPlayability(pack([cls])),
        'untyped-progression-marker',
      ),
    ).toHaveLength(0);
  });
});

describe('null-spellcasting-value gate', () => {
  it('fires on a spellcastingProgression with a null numeric value', () => {
    const cls = record({
      key: 'class:ranger',
      name: 'Ranger',
      data: {
        progression: [
          {
            level: 1,
            advancement: [
              { kind: 'spellcastingProgression', spellsKnown: null },
            ],
          },
        ],
      },
    });
    const findings = findingsByCategory(
      auditSrdPlayability(pack([cls])),
      'null-spellcasting-value',
    );
    expect(findings).toHaveLength(1);
  });

  it('is silent on a populated spellcastingProgression', () => {
    const cls = record({
      key: 'class:ranger',
      name: 'Ranger',
      data: {
        progression: [
          {
            level: 2,
            advancement: [
              {
                kind: 'spellcastingProgression',
                spellsKnown: 2,
                slots: { '1': 2 },
              },
            ],
          },
        ],
      },
    });
    expect(
      findingsByCategory(
        auditSrdPlayability(pack([cls])),
        'null-spellcasting-value',
      ),
    ).toHaveLength(0);
  });
});

describe('missing-class-feature-record gate', () => {
  it('fires on a featureGrant whose ref owns no feature record (Thieves’ Cant)', () => {
    const cls = record({
      key: 'class:rogue',
      name: 'Rogue',
      data: {
        progression: [
          {
            level: 1,
            advancement: [
              {
                kind: 'featureGrant',
                ref: 'feature:rogue:thieves-cant',
                name: 'Thieves Cant',
              },
            ],
          },
        ],
      },
    });
    const findings = findingsByCategory(
      auditSrdPlayability(pack([cls])),
      'missing-class-feature-record',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].bead).toBe('eshyra-o9bd.3');
  });

  it('is silent once the granted feature record exists, and never fires on subclass slots', () => {
    const cls = record({
      key: 'class:rogue',
      name: 'Rogue',
      data: {
        progression: [
          {
            level: 1,
            advancement: [
              {
                kind: 'featureGrant',
                ref: 'feature:rogue:thieves-cant',
                name: 'Thieves Cant',
              },
            ],
          },
          {
            level: 9,
            advancement: [
              {
                kind: 'subclassFeatureSlot',
                slotName: 'Roguish Archetype feature',
                subclassLevel: 9,
              },
            ],
          },
        ],
      },
    });
    const thievesCant = record({
      kind: 'feature',
      key: 'feature:rogue:thieves-cant',
      name: 'Thieves’ Cant',
      data: { description: 'A secret cant.' },
    });
    const findings = findingsByCategory(
      auditSrdPlayability(pack([cls, thievesCant])),
      'missing-class-feature-record',
    );
    // Thieves' Cant now owned; subclass slots reference no feature record.
    expect(findings).toHaveLength(0);
  });
});

describe('overlay-dependence gate', () => {
  it('fires on prose-only ancestry/class creation facts', () => {
    const ancestry = record({
      kind: 'ancestry',
      key: 'ancestry:human',
      name: 'Human',
      data: { description: 'Humans...', traits: [] },
    });
    const cls = record({
      key: 'class:wizard',
      name: 'Wizard',
      data: {
        progression: [
          {
            level: 1,
            advancement: [
              { kind: 'spellcastingProgression', cantripsKnown: 3 },
            ],
          },
        ],
        // Frozen pack shape: prose `text` plus prose-string `entries`.
        startingEquipment: {
          text: '(a) a quarterstaff or (b) a dagger',
          entries: ['(a) a quarterstaff or (b) a dagger', 'A spellbook'],
        },
      },
    });
    const findings = findingsByCategory(
      auditSrdPlayability(pack([ancestry, cls])),
      'overlay-dependence',
    );
    const details = findings.map((f) => f.detail).join('\n');
    expect(details).toContain('abilityScoreIncreases');
    expect(details).toContain('languages');
    expect(details).toContain('spellcastingAbility');
    expect(details).toContain('startingEquipment is prose-only');
    expect(findings.every((f) => f.bead === 'eshyra-o9bd.5')).toBe(true);
  });

  it('is silent when the facts are structured in the pack', () => {
    const ancestry = record({
      kind: 'ancestry',
      key: 'ancestry:human',
      name: 'Human',
      data: {
        abilityScoreIncreases: [{ ability: 'all', amount: 1 }],
        languages: [{ fixed: 'Common' }, { choose: 1 }],
      },
    });
    const cls = record({
      key: 'class:wizard',
      name: 'Wizard',
      data: {
        spellcastingAbility: 'intelligence',
        progression: [
          {
            level: 1,
            advancement: [
              { kind: 'spellcastingProgression', cantripsKnown: 3 },
            ],
          },
        ],
        // Overlay-compatible structured shape (srdClassStartingEquipment.ts):
        // an entries[] of typed choose-one groups and fixed grants.
        startingEquipment: {
          entries: [
            {
              kind: 'choice',
              options: [{ label: 'a', text: 'a quarterstaff' }],
              sourceText: '(a) a quarterstaff',
            },
            { kind: 'fixed', text: 'A spellbook', sourceText: 'A spellbook' },
          ],
        },
      },
    });
    expect(
      findingsByCategory(
        auditSrdPlayability(pack([ancestry, cls])),
        'overlay-dependence',
      ),
    ).toHaveLength(0);
  });
});

describe('proficiency-note-bleed gate', () => {
  it('fires on a parenthetical mechanical note folded into a proficiency token', () => {
    const cls = record({
      key: 'class:druid',
      name: 'Druid',
      data: {
        armorProficiencies: [
          'Light armor',
          'shields (druids will not wear armor or use shields made of metal)',
        ],
      },
    });
    const findings = findingsByCategory(
      auditSrdPlayability(pack([cls])),
      'proficiency-note-bleed',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].bead).toBe('eshyra-o9bd.6');
  });

  it('is silent on clean tokens with the note lifted to proficiencyNotes', () => {
    const cls = record({
      key: 'class:druid',
      name: 'Druid',
      data: {
        armorProficiencies: ['Light armor', 'medium armor', 'shields'],
        proficiencyNotes: [
          { field: 'armorProficiencies', text: 'druids will not wear metal' },
        ],
      },
    });
    expect(
      findingsByCategory(
        auditSrdPlayability(pack([cls])),
        'proficiency-note-bleed',
      ),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Real committed-pack baselines (the RED/GREEN state the modeling beads move)
// ---------------------------------------------------------------------------

describe('committed SRD pack playable-model baseline', () => {
  const findings = auditSrdPlayability(getBundledDnd5eSrdPack());
  const counts = countSrdPlayabilityByCategory(findings);

  it('GREEN (eshyra-o9bd.2 landed): every progression row is typed', () => {
    // eshyra-o9bd.2 replaced the untyped feature markers with a typed
    // advancement[] union; the gate now passes against the committed pack.
    expect(counts['untyped-progression-marker']).toBe(0);
  });

  it('GREEN (eshyra-o9bd.2 landed): no null spellcasting placeholders', () => {
    // eshyra-o9bd.2 omits non-applicable spellcasting instead of emitting null.
    expect(counts['null-spellcasting-value']).toBe(0);
  });

  it('GREEN (eshyra-o9bd.3 landed): every granted feature record exists', () => {
    // eshyra-o9bd.3 (folded into .2) added feature:rogue:thieves-cant, so no
    // progression grant/improvement ref dangles.
    expect(counts['missing-class-feature-record']).toBe(0);
  });

  it('RED until eshyra-o9bd.5: overlay-dependence findings exist', () => {
    // Flip to `toBe(0)` when eshyra-o9bd.5 absorbs the creation overlays.
    expect(counts['overlay-dependence']).toBeGreaterThan(0);
  });

  it('GREEN (regression guard, eshyra-o9bd.6): no proficiency-note bleed', () => {
    // The committed pack already lifts the Druid metal restriction to
    // proficiencyNotes; this guards against regressing it.
    expect(counts['proficiency-note-bleed']).toBe(0);
  });

  it('every finding names an owning modeling bead', () => {
    expect(findings.every((f) => /^eshyra-o9bd\.\d+$/.test(f.bead))).toBe(true);
  });

  it('the report renders the remaining punch list', () => {
    const report = formatSrdPlayabilityReport('rules:dnd5e-srd-5.1', findings);
    expect(report).toContain('SRD playable-model audit');
    // overlay-dependence (eshyra-o9bd.5) is the remaining RED category.
    expect(report).toContain('overlay-dependence');
  });

  // Re-freeze readiness ratchet: the pack is not yet playable-clean (overlay
  // dependence remains until eshyra-o9bd.5/.9), so this expectation fails and
  // `it.fails` PASSES. When every gate goes green, the inner assertion starts
  // passing, `it.fails` flips to FAILING, and eshyra-o9bd.14 must convert this
  // to a plain green assertion before re-freeze.
  it.fails('re-freeze readiness: pack has zero playable-model findings (RED until eshyra-o9bd.5/.9 land)', () => {
    expect(srdPlayabilityHasFindings(findings)).toBe(false);
  });
});
