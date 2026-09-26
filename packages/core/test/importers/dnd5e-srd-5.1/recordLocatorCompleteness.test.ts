/**
 * Tests for the record/field locator completeness gate (eshyra-o9bd.19.2.2.3).
 */

import { describe, expect, it } from 'vitest';
import {
  assertRecordLocatorCompleteness,
  RecordLocatorCompletenessError,
} from '../../../scripts/importers/dnd5e-srd-5.1/recordLocatorCompleteness.js';
import type {
  SourceRegionLedger,
  SourceRegionLedgerEntry,
} from '../../../scripts/importers/dnd5e-srd-5.1/sourceRegionLedger.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import type {
  RecordProvenance,
  RulesRecord,
} from '../../../src/rules/types.js';

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

function record(
  key: string,
  kind: RulesRecord['kind'],
  data: unknown,
  provenance: RecordProvenance,
  options: { readonly source?: string; readonly name?: string } = {},
): RulesRecord {
  const locator = provenance.locator;
  return {
    systemId: 'dnd5e-srd',
    kind,
    key,
    name: options.name ?? key,
    data,
    source:
      options.source ??
      (locator === undefined ? 'fixture' : `SRD 5.1 ${locator}`),
    license: LICENSE,
    provenance,
  };
}

function page(pageNumber: number, lines: readonly string[]): PageText {
  return { pageNumber, lines };
}

interface LedgerEntryFixture {
  readonly classification: SourceRegionLedgerEntry['classification'];
  readonly targetKey?: string;
  readonly pageStart: number;
  readonly pageEnd: number;
  readonly contentMatch?: boolean;
  readonly lineStart?: number;
  readonly lineEnd?: number;
  readonly structuredFieldEvidence?: SourceRegionLedgerEntry['structuredFieldEvidence'];
}

function ledger(entries: readonly LedgerEntryFixture[]): SourceRegionLedger {
  return {
    summary: {
      entries: entries.length,
      proseRegions: entries.length,
      pureStructure: 0,
      record: entries.length,
      childOf: 0,
      structuredField: 0,
      intentionallyIgnored: {},
      pureDocumentStructure: 0,
      unrepresented: 0,
      broadStructuralIgnores: 0,
      ownedEmission: {
        contained: entries.length,
        sentencesContained: 0,
        structuredEquivalent: 0,
        unemitted: 0,
      },
      unaccountedPages: [],
    },
    entries: entries.map((e, i) => ({
      id: `fixture-${i}`,
      pageStart: e.pageStart,
      pageEnd: e.pageEnd,
      lineStart: e.lineStart ?? 0,
      lineEnd: e.lineEnd ?? 0,
      headingPath: [],
      sourceContext: null,
      regionType: 'record-body',
      firstPhrase: 'fixture',
      lastPhrase: 'fixture',
      normalizedCharCount: 10,
      classification: e.classification,
      ...(e.targetKey === undefined ? {} : { targetKey: e.targetKey }),
      ...(e.contentMatch === undefined ? {} : { contentMatch: e.contentMatch }),
      ...(e.structuredFieldEvidence === undefined
        ? {}
        : { structuredFieldEvidence: e.structuredFieldEvidence }),
    })),
  };
}

describe('assertRecordLocatorCompleteness', () => {
  describe('(a) record locator: ledger page coverage', () => {
    it('passes when every record:/child-of: ledger page is cited by the record locator', () => {
      const records = [
        record(
          'rule:example',
          'rule',
          { text: 'fixture' },
          {
            sourceRef: 'https://example.test',
            locator: 'pp. 10, 11',
          },
        ),
      ];
      expect(() =>
        assertRecordLocatorCompleteness(
          records,
          ledger([
            {
              classification: 'record:rule:example',
              targetKey: 'rule:example',
              pageStart: 10,
              pageEnd: 10,
            },
            {
              classification: 'child-of:rule:example',
              targetKey: 'rule:example',
              pageStart: 11,
              pageEnd: 11,
            },
          ]),
          [],
          { requireComplete: true },
        ),
      ).not.toThrow();
    });

    it('throws naming the record key and the uncovered page', () => {
      const records = [
        record(
          'rule:example',
          'rule',
          { text: 'fixture' },
          {
            sourceRef: 'https://example.test',
            locator: 'p. 10',
          },
        ),
      ];
      let thrown: unknown;
      try {
        assertRecordLocatorCompleteness(
          records,
          ledger([
            {
              classification: 'record:rule:example',
              targetKey: 'rule:example',
              pageStart: 10,
              pageEnd: 10,
            },
            {
              classification: 'record:rule:example',
              targetKey: 'rule:example',
              pageStart: 11,
              pageEnd: 11,
            },
          ]),
          [],
          { requireComplete: true },
        );
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(RecordLocatorCompletenessError);
      expect((thrown as Error).message).toContain('rule:example');
      expect((thrown as Error).message).toContain('page 11');
    });

    it('throws for an uncovered page even when the ledger entry carries contentMatch: true', () => {
      // The gate's denominator is the ledger REGARDLESS of contentMatch — a
      // page a contentMatch entry claims for a record must already be
      // covered some other way, or this is exactly the silent-drop defect
      // class the gate exists to catch (eshyra-o9bd.19.2.2.3.1 F1's motivating
      // bug: a genuine continuation mis-flagged contentMatch and silently
      // excluded from the locator).
      const records = [
        record(
          'rule:example',
          'rule',
          { text: 'fixture' },
          {
            sourceRef: 'https://example.test',
            locator: 'p. 10',
          },
        ),
      ];
      expect(() =>
        assertRecordLocatorCompleteness(
          records,
          ledger([
            {
              classification: 'record:rule:example',
              targetKey: 'rule:example',
              pageStart: 11,
              pageEnd: 11,
              contentMatch: true,
            },
          ]),
          [],
          { requireComplete: true },
        ),
      ).toThrow(RecordLocatorCompletenessError);
    });

    it('reports every violation, not just the first', () => {
      const records = [
        record(
          'rule:a',
          'rule',
          { text: 'fixture' },
          {
            sourceRef: 'https://example.test',
            locator: 'p. 1',
          },
        ),
        record(
          'rule:b',
          'rule',
          { text: 'fixture' },
          {
            sourceRef: 'https://example.test',
            locator: 'p. 5',
          },
        ),
      ];
      let thrown: unknown;
      try {
        assertRecordLocatorCompleteness(
          records,
          ledger([
            {
              classification: 'record:rule:a',
              targetKey: 'rule:a',
              pageStart: 2,
              pageEnd: 2,
            },
            {
              classification: 'record:rule:b',
              targetKey: 'rule:b',
              pageStart: 6,
              pageEnd: 6,
            },
          ]),
          [],
          { requireComplete: true },
        );
      } catch (error) {
        thrown = error;
      }
      const message = (thrown as Error).message;
      expect(message).toContain('rule:a');
      expect(message).toContain('page 2');
      expect(message).toContain('rule:b');
      expect(message).toContain('page 6');
    });
  });

  describe('(b) spell.data.classes field locator vs. ledger structured-field evidence', () => {
    const evidence = (spellKeys: readonly string[]) => ({
      sourceClass: 'Wizard',
      spellLevel: 3,
      memberCount: spellKeys.length,
      spellKeys,
    });

    it("passes when fieldLocators['/classes'] pages exactly match the ledger evidence", () => {
      const records = [
        record(
          'spell:fireball',
          'spell',
          { classes: ['Sorcerer', 'Wizard'] },
          {
            sourceRef: 'https://example.test',
            locator: 'p. 110',
            fieldLocators: { '/classes': 'pp. 110, 112' },
          },
          { name: 'Fireball' },
        ),
      ];
      expect(() =>
        assertRecordLocatorCompleteness(
          records,
          ledger([
            {
              classification: 'structured-field:spell.data.classes',
              pageStart: 110,
              pageEnd: 110,
              structuredFieldEvidence: evidence(['spell:fireball']),
            },
            {
              classification: 'structured-field:spell.data.classes',
              pageStart: 112,
              pageEnd: 112,
              structuredFieldEvidence: evidence(['spell:fireball']),
            },
          ]),
          [page(110, ['Fireball']), page(112, ['Fireball'])],
          { requireComplete: true },
        ),
      ).not.toThrow();
    });

    it("throws when fieldLocators['/classes'] cites an EXTRA page beyond the ledger evidence", () => {
      const records = [
        record(
          'spell:fireball',
          'spell',
          { classes: ['Wizard'] },
          {
            sourceRef: 'https://example.test',
            locator: 'p. 110',
            fieldLocators: { '/classes': 'pp. 110, 112' },
          },
          { name: 'Fireball' },
        ),
      ];
      expect(() =>
        assertRecordLocatorCompleteness(
          records,
          ledger([
            {
              classification: 'structured-field:spell.data.classes',
              pageStart: 110,
              pageEnd: 110,
              structuredFieldEvidence: evidence(['spell:fireball']),
            },
          ]),
          [page(110, ['Fireball']), page(112, ['Fireball'])],
          { requireComplete: true },
        ),
      ).toThrow(/fieldLocators\['\/classes'\]/);
    });

    it("throws when fieldLocators['/classes'] is MISSING a page the ledger evidence names", () => {
      const records = [
        record(
          'spell:fireball',
          'spell',
          { classes: ['Wizard'] },
          {
            sourceRef: 'https://example.test',
            locator: 'p. 110',
            fieldLocators: { '/classes': 'p. 110' },
          },
          { name: 'Fireball' },
        ),
      ];
      expect(() =>
        assertRecordLocatorCompleteness(
          records,
          ledger([
            {
              classification: 'structured-field:spell.data.classes',
              pageStart: 110,
              pageEnd: 110,
              structuredFieldEvidence: evidence(['spell:fireball']),
            },
            {
              classification: 'structured-field:spell.data.classes',
              pageStart: 112,
              pageEnd: 112,
              structuredFieldEvidence: evidence(['spell:fireball']),
            },
          ]),
          [page(110, ['Fireball']), page(112, ['Fireball'])],
          { requireComplete: true },
        ),
      ).toThrow(/fieldLocators\['\/classes'\]/);
    });

    it("throws when data.classes is non-empty but fieldLocators['/classes'] is absent", () => {
      const records = [
        record(
          'spell:fireball',
          'spell',
          { classes: ['Wizard'] },
          { sourceRef: 'https://example.test', locator: 'p. 110' },
        ),
      ];
      expect(() =>
        assertRecordLocatorCompleteness(
          records,
          ledger([
            {
              classification: 'structured-field:spell.data.classes',
              pageStart: 110,
              pageEnd: 110,
              structuredFieldEvidence: evidence(['spell:fireball']),
            },
          ]),
          [page(110, ['Fireball']), page(112, ['Fireball'])],
          { requireComplete: true },
        ),
      ).toThrow(/is required when data\.classes is non-empty/);
    });

    it("throws when data.classes is empty but fieldLocators['/classes'] is present", () => {
      const records = [
        record(
          'spell:unlisted',
          'spell',
          { classes: [] },
          {
            sourceRef: 'https://example.test',
            locator: 'p. 200',
            fieldLocators: { '/classes': 'p. 110' },
          },
          { name: 'Fireball' },
        ),
      ];
      expect(() =>
        assertRecordLocatorCompleteness(records, ledger([]), [], {
          requireComplete: true,
        }),
      ).toThrow(/must be absent when data\.classes is empty/);
    });

    it('counts only the page whose own list lines print the spell when a group spans a page break (eshyra-o9bd.19.2.2.3)', () => {
      // One (class, level) group split across pp. 110-111: both entries carry
      // the whole group's evidence, but Fireball prints only on p. 110.
      const split = [
        {
          classification: 'structured-field:spell.data.classes' as const,
          pageStart: 110,
          pageEnd: 110,
          lineStart: 0,
          lineEnd: 1,
          structuredFieldEvidence: evidence(['spell:fireball', 'spell:fly']),
        },
        {
          classification: 'structured-field:spell.data.classes' as const,
          pageStart: 111,
          pageEnd: 111,
          lineStart: 0,
          lineEnd: 0,
          structuredFieldEvidence: evidence(['spell:fireball', 'spell:fly']),
        },
      ];
      const pages = [page(110, ['3rd Level', 'Fireball']), page(111, ['Fly'])];
      const fireball = (classesLocator: string) => [
        record(
          'spell:fireball',
          'spell',
          { classes: ['Wizard'] },
          {
            sourceRef: 'https://example.test',
            locator: 'p. 241',
            fieldLocators: { '/classes': classesLocator },
          },
          { name: 'Fireball' },
        ),
      ];
      expect(() =>
        assertRecordLocatorCompleteness(
          fireball('pp. 110, 111'),
          ledger(split),
          pages,
          { requireComplete: true },
        ),
      ).toThrow(/cites pages \[110, 111\].*are on \[110\]/);
      expect(() =>
        assertRecordLocatorCompleteness(
          fireball('p. 110'),
          ledger(split),
          pages,
          { requireComplete: true },
        ),
      ).not.toThrow();
    });

    it('skips the exact-pages comparison when requireComplete is false', () => {
      const records = [
        record(
          'spell:fireball',
          'spell',
          { classes: ['Wizard'] },
          {
            sourceRef: 'https://example.test',
            locator: 'p. 110',
            fieldLocators: { '/classes': 'p. 7' },
          },
        ),
      ];
      expect(() =>
        assertRecordLocatorCompleteness(records, ledger([]), [], {
          requireComplete: false,
        }),
      ).not.toThrow();
    });
  });

  describe('(c) every other fieldLocators entry: anchor + presence checks', () => {
    it('passes when the field-locator value is found as whole-token text on its cited page', () => {
      const records = [
        record(
          'equipment:chest',
          'equipment',
          { category: 'gear', capacity: '12 cubic feet/300 pounds of gear' },
          {
            sourceRef: 'https://example.test',
            locator: 'p. 69',
            fieldLocators: { '/capacity': 'p. 69' },
          },
        ),
      ];
      expect(() =>
        assertRecordLocatorCompleteness(
          records,
          ledger([]),
          [page(69, ['Chest* 12 cubic feet/300 pounds of gear'])],
          { requireComplete: true },
        ),
      ).not.toThrow();
    });

    it('throws when the field-locator value is absent from its cited page', () => {
      const records = [
        record(
          'equipment:chest',
          'equipment',
          { category: 'gear', capacity: '12 cubic feet/300 pounds of gear' },
          {
            sourceRef: 'https://example.test',
            locator: 'p. 69',
            fieldLocators: { '/capacity': 'p. 69' },
          },
        ),
      ];
      expect(() =>
        assertRecordLocatorCompleteness(
          records,
          ledger([]),
          [page(69, ['This page never prints the capacity text at all.'])],
          { requireComplete: true },
        ),
      ).toThrow(/was not found as whole-token text/);
    });

    it('passes when every string of a string-array field locator is found on the cited page', () => {
      const records = [
        record(
          'class:barbarian',
          'class',
          { primaryAbilities: ['Strength'] },
          {
            sourceRef: 'https://example.test',
            locator: 'p. 8',
            fieldLocators: { '/primaryAbilities': 'p. 56' },
          },
        ),
      ];
      expect(() =>
        assertRecordLocatorCompleteness(
          records,
          ledger([]),
          [page(56, ['Barbarian Strength 13'])],
          { requireComplete: true },
        ),
      ).not.toThrow();
    });

    it("throws presence check: equipment record with data.capacity but no fieldLocators['/capacity']", () => {
      const records = [
        record(
          'equipment:chest',
          'equipment',
          { category: 'gear', capacity: '12 cubic feet/300 pounds of gear' },
          { sourceRef: 'https://example.test', locator: 'p. 69' },
        ),
      ];
      expect(() =>
        assertRecordLocatorCompleteness(records, ledger([]), [], {
          requireComplete: true,
        }),
      ).toThrow(/has data\.capacity but no fieldLocators\['\/capacity'\]/);
    });

    it("throws presence check: class record with non-empty primaryAbilities but no fieldLocators['/primaryAbilities']", () => {
      const records = [
        record(
          'class:barbarian',
          'class',
          { primaryAbilities: ['Strength'] },
          { sourceRef: 'https://example.test', locator: 'p. 8' },
        ),
      ];
      expect(() =>
        assertRecordLocatorCompleteness(records, ledger([]), [], {
          requireComplete: true,
        }),
      ).toThrow(
        /has non-empty data\.primaryAbilities but no fieldLocators\['\/primaryAbilities'\]/,
      );
    });
  });

  describe('(d) record.source matches "SRD 5.1 <provenance.locator>"', () => {
    it('passes when record.source matches the derived label', () => {
      const records = [
        record(
          'rule:example',
          'rule',
          { text: 'fixture' },
          { sourceRef: 'https://example.test', locator: 'p. 10' },
          { source: 'SRD 5.1 p. 10' },
        ),
      ];
      expect(() =>
        assertRecordLocatorCompleteness(records, ledger([]), [], {
          requireComplete: true,
        }),
      ).not.toThrow();
    });

    it('throws when record.source does not match the derived label', () => {
      const records = [
        record(
          'rule:example',
          'rule',
          { text: 'fixture' },
          { sourceRef: 'https://example.test', locator: 'p. 10' },
          { source: 'SRD 5.1 p. 99' },
        ),
      ];
      let thrown: unknown;
      try {
        assertRecordLocatorCompleteness(records, ledger([]), [], {
          requireComplete: true,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(RecordLocatorCompletenessError);
      const message = (thrown as Error).message;
      expect(message).toContain('SRD 5.1 p. 99');
      expect(message).toContain('SRD 5.1 p. 10');
    });
  });

  describe('requireComplete: false (reduced-fixture mode, mirrors requireDeclarationsLive elsewhere)', () => {
    it("does not require presence of fieldLocators['/classes'] or the equipment/class presence checks", () => {
      const records = [
        record(
          'spell:fireball',
          'spell',
          { classes: ['Wizard'] },
          { sourceRef: 'https://example.test', locator: 'p. 110' },
        ),
        record(
          'equipment:chest',
          'equipment',
          { category: 'gear', capacity: '12 cubic feet/300 pounds of gear' },
          { sourceRef: 'https://example.test', locator: 'p. 69' },
        ),
        record(
          'class:barbarian',
          'class',
          { primaryAbilities: ['Strength'] },
          { sourceRef: 'https://example.test', locator: 'p. 8' },
        ),
      ];
      expect(() =>
        assertRecordLocatorCompleteness(records, ledger([]), [], {
          requireComplete: false,
        }),
      ).not.toThrow();
    });

    it("still enforces record locator coverage (a) and an EXISTING field locator's correctness (b), even with requireComplete: false", () => {
      const records = [
        record(
          'rule:example',
          'rule',
          { text: 'fixture' },
          {
            sourceRef: 'https://example.test',
            locator: 'p. 10',
          },
        ),
      ];
      expect(() =>
        assertRecordLocatorCompleteness(
          records,
          ledger([
            {
              classification: 'record:rule:example',
              targetKey: 'rule:example',
              pageStart: 11,
              pageEnd: 11,
            },
          ]),
          [],
          { requireComplete: false },
        ),
      ).toThrow(RecordLocatorCompletenessError);
    });
  });
});
