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
 *     this test as its done-marker); the already-GREEN gates assert zero.
 *
 * The aggregate `re-freeze readiness` test asserts every implemented gate EXCEPT
 * choice-coverage is green: choice-coverage is intentionally RED until the
 * eshyra-o9bd.9 modeling slices land (this slice, eshyra-o9bd.9.1, ships the
 * schema + gate as a per-slice punch list). Re-freeze (epic bar #9) requires it
 * to reach zero.
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

describe('unresolvable-inline-option-ref gate (eshyra-ldqb)', () => {
  it('fires on a pactBoon prerequisite ref that no choice offers', () => {
    const invocations = feature(
      'feature:warlock:eldritch-invocations',
      'Choose two invocations.',
      'class:warlock',
      {
        choices: [
          {
            id: 'eldritch-invocations',
            category: 'invocation',
            prompt: 'Choose two Eldritch Invocations.',
            level: 2,
            choose: 2,
            from: ['eldritch-invocation:thief-of-five-fates'],
            options: [
              {
                id: 'eldritch-invocation:thief-of-five-fates',
                name: 'Thief of Five Fates',
                text: 'You can cast bestow curse once.',
                prerequisite: '9th level',
                prerequisites: [
                  { kind: 'pactBoon', ref: 'pact-boon:pact-of-the-undead' },
                ],
                source: 'SRD 5.1 p. 49',
              },
            ],
          },
        ],
      },
    );
    const findings = findingsByCategory(
      auditSrdPlayability(pack([invocations])),
      'unresolvable-inline-option-ref',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].bead).toBe('eshyra-ldqb');
    expect(findings[0].detail).toContain('pact-boon:pact-of-the-undead');
  });

  it('fires on a from.requiresFeatureOption ref that no choice offers', () => {
    const pactBoon = feature(
      'feature:warlock:pact-boon',
      'Choose a Pact Boon.',
      'class:warlock',
      {
        choices: [
          {
            id: 'tome-cantrips',
            category: 'cantrip',
            prompt: 'If you choose Pact of the Tome, choose three cantrips.',
            level: 3,
            choose: 3,
            from: { requiresFeatureOption: 'pact-boon:pact-of-the-tome' },
          },
        ],
      },
    );
    const findings = findingsByCategory(
      auditSrdPlayability(pack([pactBoon])),
      'unresolvable-inline-option-ref',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('pact-boon:pact-of-the-tome');
  });

  it('fires when a pactBoon ref resolves, but not on the clause featureRef (eshyra-o9bd.18.4)', () => {
    // The option id exists pack-wide (offered by a different feature), so the
    // bare-resolution check passes — the ownership check must still fire.
    const wrongOwner = feature(
      'feature:warlock:other-boons',
      'A different boon list.',
      'class:warlock',
      {
        choices: [
          {
            id: 'other-boons',
            category: 'other',
            prompt: 'Choose a boon.',
            level: 3,
            choose: 1,
            from: ['pact-boon:pact-of-the-blade'],
            options: [
              {
                id: 'pact-boon:pact-of-the-blade',
                name: 'Pact of the Blade',
                text: 'You can create a pact weapon.',
                source: 'SRD 5.1 p. 47',
              },
            ],
          },
        ],
      },
    );
    const invocations = feature(
      'feature:warlock:eldritch-invocations',
      'Choose two invocations.',
      'class:warlock',
      {
        choices: [
          {
            id: 'eldritch-invocations',
            category: 'invocation',
            prompt: 'Choose two Eldritch Invocations.',
            level: 2,
            choose: 2,
            from: ['eldritch-invocation:thirsting-blade'],
            options: [
              {
                id: 'eldritch-invocation:thirsting-blade',
                name: 'Thirsting Blade',
                text: 'You can attack twice with your pact weapon.',
                prerequisite: '5th level, Pact of the Blade feature',
                prerequisites: [
                  {
                    kind: 'pactBoon',
                    featureRef: 'feature:warlock:pact-boon',
                    ref: 'pact-boon:pact-of-the-blade',
                  },
                ],
                source: 'SRD 5.1 p. 50',
              },
            ],
          },
        ],
      },
    );
    const findings = findingsByCategory(
      auditSrdPlayability(pack([wrongOwner, invocations])),
      'unresolvable-inline-option-ref',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].bead).toBe('eshyra-o9bd.18.4');
    expect(findings[0].detail).toContain(
      "requires option 'pact-boon:pact-of-the-blade' from 'feature:warlock:pact-boon'",
    );
    expect(findings[0].detail).toContain(
      'choices[0].options[0].prerequisites[0]',
    );
  });

  it('is silent when the referenced inline option id is offered by some choice', () => {
    const pactBoon = feature(
      'feature:warlock:pact-boon',
      'Choose a Pact Boon.',
      'class:warlock',
      {
        choices: [
          {
            id: 'pact-boon',
            category: 'other',
            prompt: 'Choose a Pact Boon option.',
            level: 3,
            choose: 1,
            from: ['pact-boon:pact-of-the-tome'],
            options: [
              {
                id: 'pact-boon:pact-of-the-tome',
                name: 'Pact of the Tome',
                text: 'Your patron gives you a grimoire.',
                source: 'SRD 5.1 p. 48',
              },
            ],
          },
          {
            id: 'tome-cantrips',
            category: 'cantrip',
            prompt: 'If you choose Pact of the Tome, choose three cantrips.',
            level: 3,
            choose: 3,
            from: { requiresFeatureOption: 'pact-boon:pact-of-the-tome' },
          },
        ],
      },
    );
    expect(
      findingsByCategory(
        auditSrdPlayability(pack([pactBoon])),
        'unresolvable-inline-option-ref',
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

  it('GREEN (eshyra-o9bd.5 landed): no overlay-dependence findings remain', () => {
    // Creation facts now live in generated pack data; overlay retirement is .15.
    expect(counts['overlay-dependence']).toBe(0);
  });

  it('GREEN (regression guard, eshyra-o9bd.6): no proficiency-note bleed', () => {
    // The committed pack already lifts the Druid metal restriction to
    // proficiencyNotes; this guards against regressing it.
    expect(counts['proficiency-note-bleed']).toBe(0);
  });

  it('GREEN (eshyra-o9bd.9 landed): every level-1/level-up player choice is structured', () => {
    // All five modeling slices (eshyra-o9bd.9.2–.9.6) have landed: every granted
    // class-feature build choice now carries a structured choices[] entry or a
    // named out-of-scope marker, so the choice-coverage gate is clean.
    expect(counts['choice-coverage']).toBe(0);
  });

  it('GREEN (eshyra-ldqb): every inline-option reference resolves (Warlock invocation prerequisites included)', () => {
    // Eldritch Invocation pactBoon prerequisites and the Pact of the Tome
    // cantrip choice's requiresFeatureOption filter all address real options
    // offered by feature:warlock:pact-boon's choices.
    expect(counts['unresolvable-inline-option-ref']).toBe(0);
  });

  it('no finding remains to name an owning modeling bead', () => {
    expect(findings).toHaveLength(0);
  });

  it('the report renders the clean (no-findings) state', () => {
    const report = formatSrdPlayabilityReport('rules:dnd5e-srd-5.1', findings);
    expect(report).toContain('SRD playable-model audit');
    expect(report).toContain('(no findings');
  });

  it('re-freeze readiness: the pack has zero playable-model findings', () => {
    // Every implemented playable-model gate — including choice-coverage
    // (eshyra-o9bd.9) — is green. The pack clears epic bar #9.
    expect(srdPlayabilityHasFindings(findings)).toBe(false);
  });
});
