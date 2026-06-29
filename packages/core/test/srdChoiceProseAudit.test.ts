/**
 * Tests for the unstructured choice-bearing prose coverage gate
 * (`src/rules/srdChoiceProseAudit.ts`, eshyra-ngcj.1).
 *
 * Two layers:
 *  1. Fixture tests — the gate FIRES on a record whose prose announces a build
 *     choice with no structured option catalog, and is SILENT once the catalog
 *     is structured (a `choices[].from` array or non-empty `options[]`),
 *     allowlisted, or the prose is a slot-recovery / non-build choice.
 *  2. Real-pack baseline tests — run over the committed bundled pack. Every
 *     known 2026-06-29 miss MUST be detected; the total finding count is pinned
 *     with a "flip DOWN as eshyra-ngcj.2 / .2.3 / .5 structure the catalogs"
 *     note so the modeling beads update this test as their done-marker.
 */

import { describe, expect, it } from 'vitest';
import {
  auditSrdChoiceProse,
  CHOICE_PROSE_ALLOWLIST,
  formatSrdChoiceProseReport,
  getBundledDnd5eSrdPack,
  type RulesPack,
  type RulesPackLicense,
  type RulesRecord,
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
};

function record(overrides: Partial<RulesRecord>): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'feature',
    key: 'feature:test:example',
    name: 'Example Feature',
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

// ---------------------------------------------------------------------------
// Fixture tests — gate correctness
// ---------------------------------------------------------------------------

describe('choice-bearing prose gate (fixtures)', () => {
  it('fires on an enumerated "one of the following" menu with no catalog', () => {
    const feature = record({
      key: 'feature:warlock:pact-boon',
      name: 'Pact Boon',
      data: {
        description:
          'You gain one of the following features of your choice. Pact of the Chain ... Pact of the Blade ... Pact of the Tome ...',
      },
    });
    const findings = auditSrdChoiceProse(pack([feature]));
    expect(findings).toHaveLength(1);
    expect(findings[0].key).toBe('feature:warlock:pact-boon');
    expect(findings[0].matchedPhrases).toContain('one of the following');
    expect(findings[0].source).toBe('Example SRD p. 1');
    expect(findings[0].snippet.length).toBeGreaterThan(0);
    expect(findings[0].expectedModeling).toContain('option catalog');
  });

  it('is silent once the choice carries a discrete `from` array catalog', () => {
    const feature = record({
      key: 'feature:warlock:pact-boon',
      name: 'Pact Boon',
      data: {
        description: 'You gain one of the following features of your choice.',
        choices: [
          {
            id: 'pact-boon',
            category: 'other',
            prompt: 'Choose a Pact Boon.',
            level: 3,
            choose: 1,
            from: [
              'feature:warlock:pact-of-the-chain',
              'feature:warlock:pact-of-the-blade',
              'feature:warlock:pact-of-the-tome',
            ],
          },
        ],
      },
    });
    expect(auditSrdChoiceProse(pack([feature]))).toHaveLength(0);
  });

  it('is silent once the choice carries a non-empty `options[]` catalog', () => {
    const feature = record({
      key: 'feature:sorcerer:metamagic',
      name: 'Metamagic',
      data: {
        description:
          'You gain two of the following Metamagic options of your choice.',
        choices: [
          {
            id: 'metamagic',
            category: 'metamagic',
            prompt: 'Choose 2 Metamagic options.',
            level: 3,
            choose: 2,
            options: [{ key: 'metamagic:quickened-spell' }],
          },
        ],
      },
    });
    expect(auditSrdChoiceProse(pack([feature]))).toHaveLength(0);
  });

  it('treats a bare prose `from` STRING as still unstructured (fires)', () => {
    const feature = record({
      key: 'feature:fighter:fighting-style',
      name: 'Fighting Style',
      data: {
        description: 'Choose one of the following options.',
        choices: [
          {
            id: 'fighting-style',
            category: 'fightingStyle',
            prompt: 'Choose a Fighting Style option.',
            level: 1,
            choose: 1,
            from: 'a Fighting Style option from this feature',
          },
        ],
      },
    });
    expect(auditSrdChoiceProse(pack([feature]))).toHaveLength(1);
  });

  it('does not fire on slot-recovery prose ("choose expended spell slots")', () => {
    const feature = record({
      key: 'feature:wizard:arcane-recovery',
      name: 'Arcane Recovery',
      data: {
        description:
          'Once per day when you finish a short rest, you can choose expended spell slots to recover.',
      },
    });
    expect(auditSrdChoiceProse(pack([feature]))).toHaveLength(0);
  });

  it('fires on a spell-selection build choice ("choose two spells")', () => {
    const feature = record({
      key: 'feature:bard:magical-secrets',
      name: 'Magical Secrets',
      data: {
        description: 'Choose two spells from any class, including this one.',
      },
    });
    const findings = auditSrdChoiceProse(pack([feature]));
    expect(findings).toHaveLength(1);
    expect(findings[0].expectedModeling).toContain('spell choice');
  });

  it('honors the allowlist', () => {
    const allowKey = [...CHOICE_PROSE_ALLOWLIST.keys()][0];
    const feature = record({
      key: allowKey,
      name: 'Allowlisted',
      data: {
        description: 'choose a number of them equal to 1 + the spell’s level',
      },
    });
    expect(auditSrdChoiceProse(pack([feature]))).toHaveLength(0);
  });

  it('does not scan kinds outside the choice-bearing set', () => {
    const spell = record({
      kind: 'spell',
      key: 'spell:fireball',
      name: 'Fireball',
      data: {
        description: 'Choose one of the following targets of your choice.',
      },
    });
    expect(auditSrdChoiceProse(pack([spell]))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Real-pack baseline
// ---------------------------------------------------------------------------

// The known unstructured option cases from the 2026-06-29 audit (epic
// eshyra-ngcj). Every one MUST be detected by the gate.
const KNOWN_MISSES: readonly string[] = [
  'feature:warlock:pact-boon',
  'feature:warlock:eldritch-invocations',
  'feature:sorcerer:metamagic',
  'feature:fighter:fighting-style',
  'feature:hunter:hunters-prey',
  'feature:hunter:defensive-tactics',
  'feature:hunter:multiattack',
  'feature:hunter:superior-hunters-defense',
  'feature:bard:magical-secrets',
  'feature:wizard:spell-mastery',
  'feature:wizard:signature-spells',
];

describe('choice-bearing prose gate (committed pack baseline)', () => {
  const pack = getBundledDnd5eSrdPack();
  const findings = auditSrdChoiceProse(pack);
  const keys = new Set(findings.map((f) => f.key));

  it('detects every known 2026-06-29 unstructured option case', () => {
    for (const key of KNOWN_MISSES) {
      expect(keys.has(key), `expected a finding for ${key}`).toBe(true);
    }
  });

  it('does not flag slot-recovery / per-cast spell choices', () => {
    // Arcane/Natural Recovery select expended slots (excluded by regex); Sculpt
    // Spells is a per-cast targeting formula (allowlisted).
    expect(keys.has('feature:wizard:arcane-recovery')).toBe(false);
    expect(keys.has('feature:circle-of-the-land:natural-recovery')).toBe(false);
    expect(keys.has('feature:school-of-evocation:sculpt-spells')).toBe(false);
  });

  it('every finding is actionable (source, phrase, snippet, expected area)', () => {
    for (const f of findings) {
      expect(f.source.length).toBeGreaterThan(0);
      expect(f.matchedPhrases.length).toBeGreaterThan(0);
      expect(f.snippet.length).toBeGreaterThan(0);
      expect(f.expectedModeling.length).toBeGreaterThan(0);
    }
  });

  it('findings are sorted by key', () => {
    const sorted = [...findings].map((f) => f.key).sort();
    expect(findings.map((f) => f.key)).toEqual(sorted);
  });

  // PIN: flips DOWN as the modeling beads structure each catalog/filter —
  // eshyra-ngcj.2 (option catalogs), eshyra-ngcj.2.3 (spell choices), and
  // eshyra-ngcj.5 (ancestry/background, e.g. Rock Gnome's Tinker menu). When a
  // bead lands and this number drops, update it here.
  it('total finding count matches the pinned 2026-06-29 baseline', () => {
    expect(findings.length).toBe(27);
  });

  it('formats a human-readable punch-list report', () => {
    const report = formatSrdChoiceProseReport(pack.meta.packId, findings);
    expect(report).toContain('SRD choice-bearing prose coverage gate');
    expect(report).toContain('feature:warlock:pact-boon');
  });
});
