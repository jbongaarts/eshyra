/**
 * Tests for the SRD class spell-list parity audit (eshyra-erf5.2).
 */

import { describe, expect, it } from 'vitest';
import type { SpellClassLevelEntry } from '../../../scripts/importers/dnd5e-srd-5.1/parseSpells.js';
import {
  assertSpellListParity,
  auditSpellListParity,
  SpellListParityError,
} from '../../../scripts/importers/dnd5e-srd-5.1/spellListParityAudit.js';
import type { RulesRecord } from '../../../src/rules/types.js';

const LICENSE = {
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
} as const;

function spell(
  name: string,
  level: number,
  classes: readonly string[],
): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'spell',
    key: `spell:${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    data: { level, classes },
    source: 'fixture',
    license: LICENSE,
    provenance: { sourceRef: 'https://example.test', locator: 'p. 1' },
  };
}

function entry(
  spellName: string,
  casterClass: SpellClassLevelEntry['casterClass'],
  level: number,
): SpellClassLevelEntry {
  return {
    spellName,
    casterClass,
    level,
    sourcePage: 1,
    sourceLineIndex: 0,
    groupSourcePage: 1,
    groupSourceLineIndex: 0,
    classSourcePage: 1,
    classSourceLineIndex: 0,
  };
}

describe('auditSpellListParity', () => {
  it('is clean when source entries and spell records agree', () => {
    const findings = auditSpellListParity(
      [entry('Fireball', 'Sorcerer', 3), entry('Fireball', 'Wizard', 3)],
      [spell('Fireball', 3, ['Sorcerer', 'Wizard'])],
    );
    expect(findings).toEqual([]);
  });

  it('flags a class the source lists but the record is missing', () => {
    const findings = auditSpellListParity(
      [entry('Fireball', 'Sorcerer', 3), entry('Fireball', 'Wizard', 3)],
      [spell('Fireball', 3, ['Sorcerer'])],
    );
    expect(findings).toEqual([
      {
        kind: 'missing',
        casterClass: 'Wizard',
        spellName: 'Fireball',
        detail: 'spell:fireball.data.classes is [Sorcerer], missing Wizard',
      },
    ]);
  });

  it('flags a class the record claims but the source never lists', () => {
    const findings = auditSpellListParity(
      [entry('Fireball', 'Sorcerer', 3)],
      [spell('Fireball', 3, ['Sorcerer', 'Wizard'])],
    );
    expect(findings).toEqual([
      {
        kind: 'extra',
        casterClass: 'Wizard',
        spellName: 'Fireball',
        detail:
          'spell:fireball.data.classes includes Wizard, but the source spell-list pages never list it there',
      },
    ]);
  });

  it('flags a spell level that disagrees with the source spell-list grouping', () => {
    const findings = auditSpellListParity(
      [entry('Fireball', 'Wizard', 3)],
      [spell('Fireball', 4, ['Wizard'])],
    );
    expect(findings).toEqual([
      {
        kind: 'wrong-level',
        casterClass: 'Wizard',
        spellName: 'Fireball',
        detail:
          'source spell-list page groups it under level 3 for Wizard, but spell:fireball.data.level is 4',
      },
    ]);
  });

  it('flags a source spell-list name with no matching spell record', () => {
    const findings = auditSpellListParity(
      [entry('Nonexistent Spell', 'Wizard', 1)],
      [],
    );
    expect(findings).toEqual([
      {
        kind: 'unresolved-source-name',
        casterClass: 'Wizard',
        spellName: 'Nonexistent Spell',
        detail:
          'no spell record matches the source spell-list name "Nonexistent Spell"',
      },
    ]);
  });

  it('matches names case- and quote-insensitively', () => {
    const findings = auditSpellListParity(
      [entry('sleight of hand', 'Bard', 0)],
      [spell('Sleight of Hand', 0, ['Bard'])],
    );
    expect(findings).toEqual([]);
  });

  it('sorts findings by kind, class, then spell name for diffable output', () => {
    const findings = auditSpellListParity(
      [entry('Zap', 'Wizard', 1), entry('Aid', 'Bard', 1)],
      [spell('Zap', 1, []), spell('Aid', 1, [])],
    );
    expect(
      findings.map((f) => `${f.kind}:${f.casterClass}:${f.spellName}`),
    ).toEqual(['missing:Bard:Aid', 'missing:Wizard:Zap']);
  });
});

describe('assertSpellListParity', () => {
  it('does not throw when there are no findings', () => {
    expect(() => assertSpellListParity([])).not.toThrow();
  });

  it('throws SpellListParityError naming every finding', () => {
    const findings = auditSpellListParity(
      [entry('Fireball', 'Sorcerer', 3), entry('Fireball', 'Wizard', 3)],
      [spell('Fireball', 3, ['Sorcerer'])],
    );
    expect(() => assertSpellListParity(findings)).toThrow(SpellListParityError);
    try {
      assertSpellListParity(findings);
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('1 mismatch');
      expect(message).toContain('Fireball');
      expect(message).toContain('Wizard');
    }
  });
});
