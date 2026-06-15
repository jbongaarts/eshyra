/**
 * Tests for the SRD-specific structure/coverage audit (`src/rules/srdAudit.ts`).
 *
 * Each failure mode the 2026-06-07 manual SRD audit found (eshyra-0m9.24) gets
 * a pair of assertions: the check FIRES on a fixture that mirrors the real
 * parser bleed, and is SILENT on the corrected output. Fixtures are minimal but
 * shaped exactly like the committed pack's contaminated records (see the bead
 * description) so the heuristics are exercised against representative garbage,
 * not strawmen.
 */

import { describe, expect, it } from 'vitest';
import {
  EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES,
  EXPECTED_SRD_5_1_TABLE_NAMES,
} from '../scripts/importers/dnd5e-srd-5.1/index.js';
import {
  SOURCE_EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES,
  SOURCE_EXPECTED_SRD_5_1_TABLE_NAMES,
  SRD_5_1_SOURCE_MAGIC_ITEM_GAPS,
  SRD_5_1_SOURCE_TABLE_GAPS,
} from '../scripts/importers/dnd5e-srd-5.1/sourceCoverage.js';
import type {
  RecordProvenance,
  RulesPack,
  RulesPackLicense,
  RulesPackSource,
  RulesRecord,
} from '../src/internal.js';
import {
  auditSrd,
  auditSrdCoverage,
  auditSrdStructure,
  formatSrdAuditReport,
  srdAuditHasFindings,
} from '../src/internal.js';

const SOURCE_URL = 'https://example.test/srd/5.1';

function packSource(): RulesPackSource {
  return {
    sourceTitle: 'Example SRD',
    sourceVersion: '5.1',
    sourceUrl: SOURCE_URL,
    recordProvenancePolicy: 'Every record cites the SRD page it came from.',
  };
}

function provenance(): RecordProvenance {
  return { sourceRef: SOURCE_URL, locator: 'p. 1' };
}

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

function record(overrides: Partial<RulesRecord>): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'class',
    key: 'class:fighter',
    name: 'Fighter',
    data: {},
    source: 'Example SRD p. 1',
    license: license(),
    provenance: provenance(),
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
      license: license(),
      source: packSource(),
    },
    records,
  };
}

// ---------------------------------------------------------------------------
// Class proficiency table-row / prose bleed
// ---------------------------------------------------------------------------

describe('class proficiency bleed', () => {
  // Mirrors the committed pack's class:bard armorProficiencies[0].
  const contaminated = record({
    key: 'class:bard',
    name: 'Bard',
    data: {
      hitDie: 8,
      primaryAbilities: ['Charisma'],
      savingThrowProficiencies: ['Dexterity', 'Charisma'],
      armorProficiencies: [
        'Light armor The Bard Proficiency Cantrips Level Bonus Features Known 1st +2 Spellcasting',
      ],
      weaponProficiencies: ['Simple weapons', 'hand crossbows', 'longswords'],
    },
  });

  const corrected = record({
    key: 'class:bard',
    name: 'Bard',
    data: {
      hitDie: 8,
      primaryAbilities: ['Charisma'],
      savingThrowProficiencies: ['Dexterity', 'Charisma'],
      armorProficiencies: ['Light armor'],
      weaponProficiencies: ['Simple weapons', 'hand crossbows', 'longswords'],
    },
  });

  it('fires on a proficiency token carrying a class-progression table row', () => {
    const findings = auditSrdStructure(pack([contaminated]));
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('class-proficiency-bleed');
    expect(findings[0].key).toBe('class:bard');
    expect(findings[0].detail).toContain('armorProficiencies[0]');
    expect(findings[0].detail).toContain('level ordinal');
  });

  it('is silent on the corrected proficiency arrays', () => {
    expect(auditSrdStructure(pack([corrected]))).toEqual([]);
  });

  it('flags a "+N" proficiency-bonus cell even without an ordinal word', () => {
    const findings = auditSrdStructure(
      pack([
        record({
          key: 'class:monk',
          name: 'Monk',
          data: {
            hitDie: 8,
            primaryAbilities: ['Dexterity'],
            savingThrowProficiencies: ['Strength', 'Dexterity'],
            armorProficiencies: ['None'],
            weaponProficiencies: ['Simple weapons +2 Unarmored Defense'],
          },
        }),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('proficiency-bonus table cell');
  });
});

// ---------------------------------------------------------------------------
// Class setup labels inside feature bodies
// ---------------------------------------------------------------------------

describe('feature setup-label bleed', () => {
  // Mirrors the committed pack's feature:cleric:spellcasting.
  const contaminated = record({
    kind: 'feature',
    key: 'feature:cleric:spellcasting',
    name: 'Spellcasting',
    data: {
      source: 'class:cleric',
      level: 1,
      description:
        'As a conduit for divine power, you can cast cleric spells. Tools: None Saving Throws: Wisdom, Charisma Skills: Choose two from History, Insight, Medicine, Persuasion, and Religion',
    },
  });

  const corrected = record({
    kind: 'feature',
    key: 'feature:cleric:spellcasting',
    name: 'Spellcasting',
    data: {
      source: 'class:cleric',
      level: 1,
      description: 'As a conduit for divine power, you can cast cleric spells.',
    },
  });

  it('fires when a feature body carries the class header setup block', () => {
    const findings = auditSrdStructure(pack([contaminated]));
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('feature-setup-label-bleed');
    expect(findings[0].detail).toContain('"Saving Throws:"');
    expect(findings[0].detail).toContain('"Skills:"');
    expect(findings[0].detail).toContain('"Tools:"');
  });

  it('is silent on a clean feature body', () => {
    expect(auditSrdStructure(pack([corrected]))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Swallowed adjacent feature headings
// ---------------------------------------------------------------------------

describe('swallowed adjacent features', () => {
  // Mirrors the committed pack's subclass:champion description.
  const contaminated = record({
    kind: 'subclass',
    key: 'subclass:champion',
    name: 'Champion',
    data: {
      parentClass: 'class:fighter',
      description:
        'The archetypal Champion focuses on the development of raw physical power honed to deadly perfection. Improved Critical Beginning when you choose this archetype at 3rd level, your weapon attacks score a critical hit on a roll of 19 or 20. Remarkable Athlete Starting at 7th level, you can add half your proficiency bonus. Survivor At 18th level, you attain the pinnacle of resilience in battle.',
    },
  });

  const corrected = record({
    kind: 'subclass',
    key: 'subclass:champion',
    name: 'Champion',
    data: {
      parentClass: 'class:fighter',
      description:
        'The archetypal Champion focuses on the development of raw physical power honed to deadly perfection. Those who model themselves on this archetype combine rigorous training with physical excellence to deal devastating blows.',
      features: [
        'feature:champion:improved-critical',
        'feature:champion:remarkable-athlete',
        'feature:champion:survivor',
      ],
    },
  });

  it('fires when a subclass description swallows adjacent feature headings', () => {
    const findings = auditSrdStructure(pack([contaminated]));
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('swallowed-feature-heading');
    expect(findings[0].detail).toContain('Remarkable Athlete');
    expect(findings[0].detail).toContain('Survivor');
  });

  it('is silent on a subclass blurb with features extracted to their own records', () => {
    expect(auditSrdStructure(pack([corrected]))).toEqual([]);
  });

  it('does not flag the "Spells Known of 1st Level and Higher" spellcasting sub-heading (eshyra-tzl)', () => {
    // Mirrors the committed feature:warlock:pact-magic body. "Spells Known of
    // 1st Level and Higher" is a legitimate spellcasting sub-heading; the "At
    // 1st level" that opens its body is NOT a swallowed feature grant, so the
    // capture "Higher" must not be reported as a swallowed heading.
    const pactMagic = record({
      kind: 'feature',
      key: 'feature:warlock:pact-magic',
      name: 'Pact Magic',
      data: {
        source: 'class:warlock',
        level: 1,
        description:
          'Your arcane research and the magic bestowed on you by your patron have given you facility with spells. Spells Known of 1st Level and Higher At 1st level, you know two 1st-level spells of your choice from the warlock spell list.',
      },
    });
    expect(auditSrdStructure(pack([pactMagic]))).toEqual([]);
  });

  it('does not flag a standalone feature that contains only its own lead-in', () => {
    const standalone = record({
      kind: 'feature',
      key: 'feature:bard:ability-score-improvement',
      name: 'Ability Score Improvement',
      data: {
        source: 'class:bard',
        level: 4,
        description:
          'When you reach 4th level, and again at 8th, 12th, 16th, and 19th level, you can increase one ability score of your choice by 2.',
      },
    });
    expect(auditSrdStructure(pack([standalone]))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ancestry bogus / wrapped traits
// ---------------------------------------------------------------------------

describe('ancestry bogus traits', () => {
  // Mirrors the committed pack's ancestry:dragonborn traits.
  const contaminated = record({
    kind: 'ancestry',
    key: 'ancestry:dragonborn',
    name: 'Dragonborn',
    data: {
      source: 'race',
      description: 'Your draconic heritage manifests in a variety of traits.',
      size: 'Medium',
      speed: 30,
      traits: [
        {
          name: 'Speed',
          text: 'Your base walking speed is 30 feet. Black Acid 5 by 30 ft. line (Dex. save) Blue Lightning 5 by 30 ft. line (Dex. save) Gold Fire 15 ft. cone (Dex. save)',
        },
        {
          name: 'Languages',
          text: 'You can speak, read, and write',
        },
        {
          name: 'Common and Draconic',
          text: 'Draconic is thought to be one of the oldest languages.',
        },
        {
          name: 'Ancestry table',
          text: 'Your breath weapon and damage resistance are determined by the dragon type.',
        },
      ],
    },
  });

  const corrected = record({
    kind: 'ancestry',
    key: 'ancestry:dragonborn',
    name: 'Dragonborn',
    data: {
      source: 'race',
      description: 'Your draconic heritage manifests in a variety of traits.',
      size: 'Medium',
      speed: 30,
      traits: [
        {
          name: 'Speed',
          text: 'Your base walking speed is 30 feet.',
        },
        {
          name: 'Languages',
          text: 'You can speak, read, and write Common and Draconic.',
        },
      ],
    },
  });

  it('flags a trait name that is a wrapped line fragment', () => {
    const findings = auditSrdStructure(pack([contaminated])).filter(
      (f) => f.category === 'ancestry-bogus-trait',
    );
    const fragmentFindings = findings.filter((f) =>
      f.detail.includes('wrapped line fragment'),
    );
    expect(
      fragmentFindings.some((f) => f.detail.includes('Common and Draconic')),
    ).toBe(true);
    expect(
      fragmentFindings.some((f) => f.detail.includes('Ancestry table')),
    ).toBe(true);
  });

  it('flags a truncated (mid-phrase) trait body', () => {
    const findings = auditSrdStructure(pack([contaminated]));
    expect(
      findings.some(
        (f) =>
          f.category === 'ancestry-bogus-trait' &&
          f.detail.includes('Languages') &&
          f.detail.includes('truncated'),
      ),
    ).toBe(true);
  });

  it('flags a trait body with a bled-in table', () => {
    const findings = auditSrdStructure(pack([contaminated]));
    expect(
      findings.some(
        (f) =>
          f.category === 'ancestry-bogus-trait' &&
          f.detail.includes('Speed') &&
          f.detail.includes('bled-in table'),
      ),
    ).toBe(true);
  });

  it('is silent on corrected ancestry traits', () => {
    expect(auditSrdStructure(pack([corrected]))).toEqual([]);
  });
});

describe('ancestry option-table linkage (eshyra-4a7.7)', () => {
  const unlinked = record({
    kind: 'ancestry',
    key: 'ancestry:dragonborn',
    name: 'Dragonborn',
    data: {
      source: 'race',
      description: 'Your draconic heritage manifests in a variety of traits.',
      traits: [
        {
          name: 'Draconic Ancestry',
          text: 'You have draconic ancestry. Choose one type of dragon from the Draconic Ancestry table.',
        },
      ],
    },
  });

  const linked = record({
    kind: 'ancestry',
    key: 'ancestry:dragonborn',
    name: 'Dragonborn',
    data: {
      source: 'race',
      description: 'Your draconic heritage manifests in a variety of traits.',
      traits: [
        {
          name: 'Draconic Ancestry',
          text: 'You have draconic ancestry. Choose one type of dragon from the Draconic Ancestry table.',
          tableRefs: ['table:draconic-ancestry'],
        },
      ],
    },
  });

  it('flags an option-table prose reference with no tableRefs link', () => {
    const findings = auditSrdStructure(pack([unlinked])).filter(
      (f) => f.category === 'ancestry-unlinked-table',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('Draconic Ancestry');
  });

  it('is silent once the trait carries a tableRefs link', () => {
    const findings = auditSrdStructure(pack([linked])).filter(
      (f) => f.category === 'ancestry-unlinked-table',
    );
    expect(findings).toEqual([]);
  });
});

describe('spell-embedded table linkage (eshyra-o4j7)', () => {
  const confusion = record({
    kind: 'spell',
    key: 'spell:confusion',
    name: 'Confusion',
    data: {
      level: 4,
      school: 'enchantment',
      tableRefs: ['table:confusion-behavior'],
    },
  });
  const behavior = record({
    kind: 'table',
    key: 'table:confusion-behavior',
    name: 'Confusion Behavior',
    data: { columns: ['d10', 'Behavior'], rows: [['1', 'Move randomly.']] },
  });

  it('is silent when an embedded table is linked exactly once by its owner', () => {
    expect(
      auditSrdStructure(pack([confusion, behavior])).filter(
        (finding) => finding.category === 'spell-table-link',
      ),
    ).toEqual([]);
  });

  it('flags an emitted spell table with no owner link', () => {
    const unlinked = {
      ...confusion,
      data: { ...(confusion.data as Record<string, unknown>), tableRefs: [] },
    };
    const findings = auditSrdStructure(pack([unlinked, behavior])).filter(
      (finding) => finding.category === 'spell-table-link',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('must be referenced exactly once');
  });

  it('flags a spell tableRef that points to a missing table record', () => {
    const findings = auditSrdStructure(pack([confusion])).filter(
      (finding) => finding.category === 'spell-table-link',
    );
    expect(
      findings.some((finding) => finding.detail.includes('missing table')),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Creature stat-block prose bleed (eshyra-76b7)
// ---------------------------------------------------------------------------

describe('creature stat-block prose bleed (eshyra-76b7)', () => {
  function creature(data: Record<string, unknown>): RulesRecord {
    return record({
      kind: 'creature',
      key: 'creature:test-beast',
      name: 'Test Beast',
      data,
    });
  }

  it('flags document/appendix prose appended to a creature action', () => {
    // The Ogre Zombie failure class: Appendix MM-A intro prose bled into the
    // last action's text.
    const findings = auditSrdStructure(
      pack([
        creature({
          actions: [
            {
              name: 'Morningstar',
              text: 'Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 13 (2d8 + 4) bludgeoning damage. This appendix contains statistics for various animals, vermin, and other critters.',
            },
          ],
        }),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('creature-stat-block-prose-bleed');
    expect(findings[0].key).toBe('creature:test-beast');
    expect(findings[0].detail).toContain('actions[0]');
    expect(findings[0].detail).toContain('document-structure prose');
  });

  it('flags description flavor that is duplicated into a reaction', () => {
    const findings = auditSrdStructure(
      pack([
        creature({
          reactions: [
            {
              name: 'Parry',
              text: 'The knight adds 2 to its AC. Knights are warriors who pledge service to rulers, religious orders, and noble causes.',
            },
          ],
          description:
            'Knights are warriors who pledge service to rulers, religious orders, and noble causes.',
        }),
      ]),
    );
    expect(
      findings.some(
        (f) =>
          f.category === 'creature-stat-block-prose-bleed' &&
          f.detail.includes('reactions[0]') &&
          f.detail.includes('repeats data.description'),
      ),
    ).toBe(true);
  });

  it('does not flag a clean stat block with separated description', () => {
    const findings = auditSrdStructure(
      pack([
        creature({
          actions: [
            {
              name: 'Club',
              text: 'Melee Weapon Attack: +2 to hit, reach 5 ft., one target. Hit: 2 (1d4) bludgeoning damage.',
            },
          ],
          description:
            'Acolytes are junior members of a clergy, usually answerable to a priest.',
        }),
      ]),
    );
    expect(
      findings.filter((f) => f.category === 'creature-stat-block-prose-bleed'),
    ).toEqual([]);
  });

  it('does not flag legitimate mechanical text that mentions an appendix incidentally', () => {
    // A real Quipper line references "this appendix" but is mechanical/flavor in
    // the description, not the action — the marker only matches the specific
    // document-structure framing, so normal mechanical prose is untouched.
    const findings = auditSrdStructure(
      pack([
        creature({
          actions: [
            {
              name: 'Bite',
              text: 'Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 1 piercing damage.',
            },
          ],
        }),
      ]),
    );
    expect(
      findings.filter((f) => f.category === 'creature-stat-block-prose-bleed'),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

describe('coverage', () => {
  const present = record({
    kind: 'magic-item',
    key: 'magic-item:adamantine-armor',
    name: 'Adamantine Armor',
    data: {
      itemType: 'Armor',
      rarity: 'uncommon',
      requiresAttunement: false,
      description: 'Reinforced with adamantine.',
    },
  });

  it('reports an expected magic item that is missing (Orb of Dragonkind)', () => {
    const findings = auditSrdCoverage(pack([present]), {
      requiredNamesByKind: {
        'magic-item': ['Adamantine Armor', 'Orb of Dragonkind'],
      },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('missing-coverage');
    expect(findings[0].name).toBe('Orb of Dragonkind');
    expect(findings[0].key).toBe('coverage:magic-item:orb-of-dragonkind');
  });

  it('matches expected names case-insensitively', () => {
    const findings = auditSrdCoverage(pack([present]), {
      requiredNamesByKind: { 'magic-item': ['ADAMANTINE ARMOR'] },
    });
    expect(findings).toEqual([]);
  });

  it('reports a missing required key', () => {
    const findings = auditSrdCoverage(pack([present]), {
      requiredKeys: ['rule:resting', 'magic-item:adamantine-armor'],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].name).toBe('rule:resting');
  });

  it('is silent when all expectations are met', () => {
    const findings = auditSrdCoverage(pack([present]), {
      requiredNamesByKind: { 'magic-item': ['Adamantine Armor'] },
      requiredKeys: ['magic-item:adamantine-armor'],
    });
    expect(findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Source-coverage expectation layer (the EXPECTED_* vs SOURCE_* distinction)
// ---------------------------------------------------------------------------

describe('source-coverage expectations', () => {
  function magicItemKey(name: string): string {
    return `magic-item:${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')}`;
  }

  function magicItem(name: string): RulesRecord {
    return record({
      kind: 'magic-item',
      key: magicItemKey(name),
      name,
      data: {
        itemType: 'Wondrous item',
        rarity: 'rare',
        requiresAttunement: false,
        description: 'Fixture magic item.',
      },
    });
  }

  // Every emitted magic item except the Orb. After eshyra-0m9.16 the importer
  // emits Orb of Dragonkind, so it is in `EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES`;
  // this set models a pack that has every other emitted item but has dropped
  // (regressed) the Orb.
  const EMITTED_WITHOUT_ORB = EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES.filter(
    (name) => name !== 'Orb of Dragonkind',
  );

  it('retains the Orb in the source gap list as durable source truth after the importer emits it', () => {
    // Lifecycle (see sourceCoverage.ts): eshyra-0m9.16 added Orb of Dragonkind to
    // the emitted baseline, so it is now in BOTH the emitted list and the source
    // gap list. The gap entry is kept on purpose — it is the durable source-truth
    // assertion that the Orb must appear in any conformant pack, so a future
    // regression that drops it from the importer is still caught by the
    // SOURCE-keyed coverage audit. `dedupe` keeps the source list duplicate-free.
    expect(EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES).toContain('Orb of Dragonkind');
    expect(SRD_5_1_SOURCE_MAGIC_ITEM_GAPS).toContain('Orb of Dragonkind');
    expect(SOURCE_EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES).toContain(
      'Orb of Dragonkind',
    );
    // The source list stays a superset of the emitted baseline, with no
    // duplicate Orb entry introduced by the now-overlapping gap list.
    for (const name of EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES) {
      expect(SOURCE_EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES).toContain(name);
    }
    expect(new Set(SOURCE_EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES).size).toBe(
      SOURCE_EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES.length,
    );
  });

  it('reports Orb of Dragonkind missing when a pack drops it but keeps every other emitted item', () => {
    const packMissingOrb = pack(EMITTED_WITHOUT_ORB.map(magicItem));
    const findings = auditSrdCoverage(packMissingOrb, {
      requiredNamesByKind: {
        'magic-item': SOURCE_EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES,
      },
    });
    // The ONLY gap between the source list and a pack holding every emitted item
    // except the Orb is the Orb — exactly one, deterministic, and visible.
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      category: 'missing-coverage',
      kind: 'magic-item',
      name: 'Orb of Dragonkind',
      key: 'coverage:magic-item:orb-of-dragonkind',
    });
  });

  it('the missing-coverage finding is deterministic across runs', () => {
    const packMissingOrb = pack(EMITTED_WITHOUT_ORB.map(magicItem));
    const expectations = {
      requiredNamesByKind: {
        'magic-item': SOURCE_EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES,
      },
    };
    expect(auditSrdCoverage(packMissingOrb, expectations)).toEqual(
      auditSrdCoverage(packMissingOrb, expectations),
    );
  });

  it('is silent once the pack contains the Orb (the post-fix steady state)', () => {
    const withOrb = pack(EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES.map(magicItem));
    const findings = auditSrdCoverage(withOrb, {
      requiredNamesByKind: {
        'magic-item': SOURCE_EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES,
      },
    });
    expect(findings).toEqual([]);
  });

  it('surfaces structure findings and a dropped-Orb gap together via auditSrd', () => {
    const contaminatedBard = record({
      key: 'class:bard',
      name: 'Bard',
      data: {
        hitDie: 8,
        primaryAbilities: ['Charisma'],
        savingThrowProficiencies: ['Dexterity', 'Charisma'],
        armorProficiencies: ['Light armor 1st +2 Spellcasting'],
        weaponProficiencies: ['Simple weapons'],
      },
    });
    const audit = auditSrd(
      pack([contaminatedBard, ...EMITTED_WITHOUT_ORB.map(magicItem)]),
      {
        requiredNamesByKind: {
          'magic-item': SOURCE_EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES,
        },
      },
    );
    expect(srdAuditHasFindings(audit)).toBe(true);
    expect(
      audit.findings.some((f) => f.category === 'class-proficiency-bleed'),
    ).toBe(true);
    expect(
      audit.findings.some(
        (f) =>
          f.category === 'missing-coverage' && f.name === 'Orb of Dragonkind',
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Source-coverage table gaps (eshyra-0m9.23 audit-only -> eshyra-0m9.19 emitted)
// ---------------------------------------------------------------------------

describe('source-coverage table gaps (eshyra-0m9.23, eshyra-0m9.19)', () => {
  function tableKey(name: string): string {
    return `table:${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')}`;
  }

  function tableRecord(name: string): RulesRecord {
    return record({
      kind: 'table',
      key: tableKey(name),
      name,
      data: { columns: ['A', 'B'], rows: [['x', 'y']] },
    });
  }

  it('keeps the source table set a gap-extended superset of the emitted baseline', () => {
    for (const name of EXPECTED_SRD_5_1_TABLE_NAMES) {
      expect(SOURCE_EXPECTED_SRD_5_1_TABLE_NAMES).toContain(name);
    }
    for (const name of SRD_5_1_SOURCE_TABLE_GAPS) {
      expect(SOURCE_EXPECTED_SRD_5_1_TABLE_NAMES).toContain(name);
    }
    // No duplicate slipped in via the overlapping dedupe.
    expect(new Set(SOURCE_EXPECTED_SRD_5_1_TABLE_NAMES).size).toBe(
      SOURCE_EXPECTED_SRD_5_1_TABLE_NAMES.length,
    );
  });

  it('retains the now-emitted money/downtime tables as durable source truth', () => {
    // eshyra-0m9.19 made the importer emit all five former gaps, so each is now
    // in BOTH the emitted baseline and the retained source-gap list (the Orb of
    // Dragonkind lifecycle). The gap entries stay so a regression that drops one
    // is still caught by the SOURCE-keyed audit.
    for (const name of SRD_5_1_SOURCE_TABLE_GAPS) {
      expect(EXPECTED_SRD_5_1_TABLE_NAMES).toContain(name);
    }
  });

  it('reports a regressed source table that dropped out of the pack', () => {
    // A pack holding every emitted table except one former gap (Services) must
    // surface exactly that one as a missing-coverage finding.
    const withoutServices = pack(
      EXPECTED_SRD_5_1_TABLE_NAMES.filter((n) => n !== 'Services').map(
        tableRecord,
      ),
    );
    const findings = auditSrdCoverage(withoutServices, {
      requiredNamesByKind: { table: SOURCE_EXPECTED_SRD_5_1_TABLE_NAMES },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      category: 'missing-coverage',
      kind: 'table',
      name: 'Services',
    });
  });

  it('is silent once the pack contains the full emitted table set (steady state)', () => {
    const full = pack(SOURCE_EXPECTED_SRD_5_1_TABLE_NAMES.map(tableRecord));
    const findings = auditSrdCoverage(full, {
      requiredNamesByKind: { table: SOURCE_EXPECTED_SRD_5_1_TABLE_NAMES },
    });
    expect(findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Combined audit + reporting
// ---------------------------------------------------------------------------

describe('auditSrd and reporting', () => {
  it('combines structure and coverage findings', () => {
    const audit = auditSrd(
      pack([
        record({
          key: 'class:bard',
          name: 'Bard',
          data: {
            hitDie: 8,
            primaryAbilities: ['Charisma'],
            savingThrowProficiencies: ['Dexterity', 'Charisma'],
            armorProficiencies: ['Light armor 1st +2 Spellcasting'],
            weaponProficiencies: ['Simple weapons'],
          },
        }),
      ]),
      { requiredNamesByKind: { 'magic-item': ['Orb of Dragonkind'] } },
    );
    expect(srdAuditHasFindings(audit)).toBe(true);
    const categories = new Set(audit.findings.map((f) => f.category));
    expect(categories.has('class-proficiency-bleed')).toBe(true);
    expect(categories.has('missing-coverage')).toBe(true);
  });

  it('reports no findings for a clean pack', () => {
    const audit = auditSrd(
      pack([
        record({
          key: 'class:fighter',
          name: 'Fighter',
          data: {
            hitDie: 10,
            primaryAbilities: ['Strength'],
            savingThrowProficiencies: ['Strength', 'Constitution'],
            armorProficiencies: ['All armor', 'shields'],
            weaponProficiencies: ['Simple weapons', 'martial weapons'],
          },
        }),
      ]),
    );
    expect(srdAuditHasFindings(audit)).toBe(false);
    expect(formatSrdAuditReport(audit)).toContain('(no findings)');
  });

  it('renders a stable human-readable report grouped by category', () => {
    const audit = auditSrd(
      pack([
        record({
          kind: 'feature',
          key: 'feature:cleric:spellcasting',
          name: 'Spellcasting',
          data: {
            source: 'class:cleric',
            level: 1,
            description: 'Cast cleric spells. Saving Throws: Wisdom, Charisma',
          },
        }),
      ]),
    );
    const text = formatSrdAuditReport(audit);
    expect(text).toContain(
      'SRD structure/coverage audit for pack: rules:dnd5e-srd-5.1',
    );
    expect(text).toContain('feature-setup-label-bleed: 1');
    expect(text).toContain('feature:cleric:spellcasting');
  });
});
