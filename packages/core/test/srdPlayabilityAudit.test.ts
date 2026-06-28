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
 * The aggregate `re-freeze readiness` test is a hard green assertion: all
 * implemented playable-model gates are clean against the committed pack.
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
    expect(details).toContain('spellPreparation');
    expect(details).toContain('startingEquipment is prose-only');
    expect(findings.every((f) => f.bead === 'eshyra-o9bd.5')).toBe(true);
  });

  it('fires when a spellcasting class has ability metadata but no preparation metadata', () => {
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
        startingEquipment: {
          entries: [
            {
              kind: 'choice',
              options: [{ label: 'a', text: 'a quarterstaff' }],
              sourceText: '(a) a quarterstaff',
            },
          ],
        },
      },
    });
    const findings = findingsByCategory(
      auditSrdPlayability(pack([cls])),
      'overlay-dependence',
    );
    expect(findings.map((finding) => finding.detail)).toEqual([
      'spellcasting class has no structured spellPreparation (prepared/known/spellbook metadata is overlay-only)',
    ]);
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
        spellPreparation: {
          kind: 'prepared',
          spellbookStartingSpells: 6,
          sourceText: 'Wizard preparation text.',
        },
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

// A class that grants `featureKey` at `level` via a typed featureGrant row, so
// the feature is in the choice-coverage gate's in-scope universe.
function classGranting(
  classKey: string,
  featureKey: string,
  level: number,
): RulesRecord {
  return record({
    kind: 'class',
    key: classKey,
    name: classKey,
    data: {
      progression: [
        {
          level,
          advancement: [{ kind: 'featureGrant', ref: featureKey }],
        },
      ],
    },
  });
}

function feature(
  key: string,
  description: string,
  source: string,
  extra: Record<string, unknown> = {},
): RulesRecord {
  return record({
    kind: 'feature',
    key,
    name: key,
    data: { source, level: 1, description, ...extra },
  });
}

describe('choice-coverage gate (eshyra-o9bd.9)', () => {
  it('fires on a granted feature whose build choice is prose-only', () => {
    const cls = classGranting('class:fighter', 'feature:fighter:fs', 1);
    const fs = feature(
      'feature:fighter:fs',
      'Choose a Fighting Style of your choice.',
      'class:fighter',
    );
    const findings = findingsByCategory(
      auditSrdPlayability(pack([cls, fs])),
      'choice-coverage',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].key).toBe('feature:fighter:fs');
    expect(findings[0].bead).toBe('eshyra-o9bd.9.5');
    expect(findings[0].detail).toContain('fightingStyle');
  });

  it('is silent once the feature carries a structured choices[] entry', () => {
    const cls = classGranting('class:fighter', 'feature:fighter:fs', 1);
    const fs = feature(
      'feature:fighter:fs',
      'Choose a Fighting Style of your choice.',
      'class:fighter',
      {
        choices: [
          {
            id: 'fighting-style',
            category: 'fightingStyle',
            prompt: 'Choose a Fighting Style.',
            level: 1,
            choose: 1,
            from: ['Archery', 'Defense', 'Dueling'],
          },
        ],
      },
    );
    expect(
      findingsByCategory(
        auditSrdPlayability(pack([cls, fs])),
        'choice-coverage',
      ),
    ).toHaveLength(0);
  });

  it('is silent once the choice carries a named out-of-scope marker', () => {
    const cls = classGranting('class:fighter', 'feature:fighter:fs', 1);
    const fs = feature(
      'feature:fighter:fs',
      'Choose a Fighting Style of your choice.',
      'class:fighter',
      {
        choices: [
          {
            id: 'fighting-style',
            category: 'fightingStyle',
            prompt: 'Choose a Fighting Style.',
            level: 1,
            unsupported: { reason: 'Fighting Style options not modeled yet.' },
          },
        ],
      },
    );
    expect(
      findingsByCategory(
        auditSrdPlayability(pack([cls, fs])),
        'choice-coverage',
      ),
    ).toHaveLength(0);
  });

  it('ignores a feature not granted by any class progression row', () => {
    // An orphan feature (no featureGrant references it) is out of the
    // creation/level-up universe, so its prose is not a player choice.
    const fs = feature(
      'feature:homebrew:fs',
      'Choose a Fighting Style of your choice.',
      'class:fighter',
    );
    expect(
      findingsByCategory(auditSrdPlayability(pack([fs])), 'choice-coverage'),
    ).toHaveLength(0);
  });

  it('does not mistake a reference to an already-chosen favored enemy for a choice', () => {
    // Foe Slayer / Primeval Awareness mention the favored enemy/terrain the
    // player already picked; only the act of choosing is a build choice.
    const cls = classGranting('class:ranger', 'feature:ranger:foe-slayer', 20);
    const foeSlayer = feature(
      'feature:ranger:foe-slayer',
      'You can add your Wisdom modifier to the attack roll against a favored enemy.',
      'class:ranger',
    );
    expect(
      findingsByCategory(
        auditSrdPlayability(pack([cls, foeSlayer])),
        'choice-coverage',
      ),
    ).toHaveLength(0);
  });
});

describe('subclass choice-coverage gate (eshyra-o9bd.9.2)', () => {
  const subclassRecord = record({
    kind: 'subclass',
    key: 'subclass:champion',
    name: 'Champion',
    data: { parentClass: 'class:fighter', description: 'A champion.' },
  });

  it('fires when no granted feature of a subclassed class carries a subclass choice', () => {
    const cls = classGranting(
      'class:fighter',
      'feature:fighter:martial-archetype',
      3,
    );
    const sel = feature(
      'feature:fighter:martial-archetype',
      'At 3rd level, you choose an archetype such as Champion.',
      'class:fighter',
    );
    const findings = findingsByCategory(
      auditSrdPlayability(pack([cls, sel, subclassRecord])),
      'choice-coverage',
    );
    const subclassFindings = findings.filter(
      (f) => f.bead === 'eshyra-o9bd.9.2',
    );
    expect(subclassFindings).toHaveLength(1);
    expect(subclassFindings[0].key).toBe('class:fighter');
  });

  it('is silent once a granted feature carries a structured subclass choice', () => {
    const cls = classGranting(
      'class:fighter',
      'feature:fighter:martial-archetype',
      3,
    );
    const sel = feature(
      'feature:fighter:martial-archetype',
      'At 3rd level, you choose an archetype such as Champion.',
      'class:fighter',
      {
        choices: [
          {
            id: 'martial-archetype',
            category: 'subclass',
            prompt: 'Choose a Martial Archetype.',
            level: 3,
            choose: 1,
            from: ['subclass:champion'],
          },
        ],
      },
    );
    const findings = findingsByCategory(
      auditSrdPlayability(pack([cls, sel, subclassRecord])),
      'choice-coverage',
    ).filter((f) => f.bead === 'eshyra-o9bd.9.2');
    expect(findings).toHaveLength(0);
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

  it('GREEN (eshyra-o9bd.5 landed): no overlay-dependence findings remain', () => {
    // Creation facts now live in generated pack data; overlay retirement is .15.
    expect(counts['overlay-dependence']).toBe(0);
  });

  it('GREEN (regression guard, eshyra-o9bd.6): no proficiency-note bleed', () => {
    // The committed pack already lifts the Druid metal restriction to
    // proficiencyNotes; this guards against regressing it.
    expect(counts['proficiency-note-bleed']).toBe(0);
  });

  it('RED (eshyra-o9bd.9): every level-1/level-up player choice is structured', () => {
    // The choice-coverage gate (eshyra-o9bd.9.1) lands the schema + detector;
    // the committed pack still carries every feature build choice as prose.
    // Each modeling slice below flips its bucket to 0; update these counts as
    // they land, and remove the RED assertion when the total reaches 0.
    const choiceFindings = findingsByCategory(findings, 'choice-coverage');
    const byBead = new Map<string, number>();
    for (const f of choiceFindings) {
      byBead.set(f.bead, (byBead.get(f.bead) ?? 0) + 1);
    }
    expect(counts['choice-coverage']).toBe(48);
    // Per-slice punch list (the done-marker each modeling bead must drive to 0).
    expect(byBead.get('eshyra-o9bd.9.2')).toBe(12); // subclass selection (per class)
    expect(byBead.get('eshyra-o9bd.9.3')).toBe(12); // spell/cantrip choices
    expect(byBead.get('eshyra-o9bd.9.4')).toBe(12); // ASI-vs-feat
    expect(byBead.get('eshyra-o9bd.9.5')).toBe(7); // fighting-style/metamagic/invocation/terrain-enemy
    expect(byBead.get('eshyra-o9bd.9.6')).toBe(5); // channel-divinity / expertise
  });

  it('every finding names an owning modeling bead', () => {
    expect(
      findings.every((f) => /^eshyra-o9bd\.\d+(?:\.\d+)?$/.test(f.bead)),
    ).toBe(true);
  });

  it('the report renders the remaining punch list', () => {
    const report = formatSrdPlayabilityReport('rules:dnd5e-srd-5.1', findings);
    expect(report).toContain('SRD playable-model audit');
    expect(report).toContain('choice-coverage');
  });

  it('re-freeze readiness: only choice-coverage (eshyra-o9bd.9) is still RED', () => {
    // Every other implemented playable-model gate is green; choice coverage is
    // the remaining work before the pack is re-freeze-ready (epic bar #9).
    expect(srdPlayabilityHasFindings(findings)).toBe(true);
    const nonChoice = findings.filter((f) => f.category !== 'choice-coverage');
    expect(nonChoice).toHaveLength(0);
  });
});
