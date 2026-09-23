/**
 * Tests for the record source anchor gate (eshyra-o9bd.19.1.3.2).
 *
 * Synthetic `PageText` fixtures only — no PDF extraction. The real-PDF proof
 * is the importer run itself: `runImporter` calls `assertRecordsAnchoredIn
 * Source` over the full generated pack, and CI's srd-importer-
 * reproducibility job runs `verify:dnd5e-srd-pack` whenever importer/pack
 * files change.
 */

import { describe, expect, it } from 'vitest';
import {
  assertRecordsAnchoredInSource,
  citedPages,
  DECLARED_RECORD_SOURCE_ANCHORS,
  normalizeAnchorText,
  RecordSourceAnchorError,
} from '../../../scripts/importers/dnd5e-srd-5.1/recordSourceAnchors.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import type { RulesRecord, RulesRecordKind } from '../../../src/rules/types.js';

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

function makeRecord(options: {
  readonly key: string;
  readonly name: string;
  readonly locator: string | undefined;
  readonly kind?: RulesRecordKind;
}): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: options.kind ?? 'table',
    key: options.key,
    name: options.name,
    data: { fixture: true },
    source: 'fixture',
    license: LICENSE,
    provenance: {
      sourceRef: 'https://example.test',
      ...(options.locator === undefined ? {} : { locator: options.locator }),
    },
  };
}

function makePage(pageNumber: number, lines: readonly string[]): PageText {
  return { pageNumber, lines };
}

describe('citedPages', () => {
  it('parses a single-page locator', () => {
    expect(citedPages('p. 62')).toEqual([62]);
  });

  it('parses a comma-joined page-list locator', () => {
    expect(citedPages('pp. 62, 63, 64')).toEqual([62, 63, 64]);
  });

  it('parses an inclusive page-range locator (hyphen)', () => {
    expect(citedPages('pp. 320-321')).toEqual([320, 321]);
  });

  it('parses an inclusive page-range locator (en dash)', () => {
    expect(citedPages('pp. 320–321')).toEqual([320, 321]);
  });

  it('throws on an unparseable locator', () => {
    expect(() => citedPages('page 62')).toThrow(RecordSourceAnchorError);
  });

  it('throws on a missing locator', () => {
    expect(() => citedPages(undefined)).toThrow(RecordSourceAnchorError);
  });

  it('throws when a range locator end precedes its start', () => {
    expect(() => citedPages('pp. 65-60')).toThrow(RecordSourceAnchorError);
  });
});

describe('normalizeAnchorText', () => {
  it('lower-cases into space-separated alphanumeric tokens', () => {
    expect(normalizeAnchorText('Saddle, Military')).toBe('saddle military');
  });

  it('collapses PDF line-wrap hyphenation', () => {
    expect(normalizeAnchorText('Guid-\nance')).toBe('guidance');
  });

  it('treats curly and straight punctuation equivalently', () => {
    expect(normalizeAnchorText('Dragon’s Breath')).toBe(
      normalizeAnchorText("Dragon's Breath"),
    );
  });
});

describe('assertRecordsAnchoredInSource', () => {
  it('regression: a fabricated table citing a page that never prints it throws, naming the record', () => {
    const records = [
      makeRecord({
        key: 'table:starting-wealth-by-class',
        name: 'Starting Wealth by Class',
        locator: 'p. 38',
      }),
    ];
    const pages = [
      makePage(38, [
        'This page prints unrelated SRD prose that never mentions starting wealth.',
      ]),
    ];
    expect(() =>
      assertRecordsAnchoredInSource(records, pages, {
        requireDeclarationsLive: false,
      }),
    ).toThrow(/table:starting-wealth-by-class/);
  });

  it('passes when the record name is printed verbatim on a cited page', () => {
    const records = [
      makeRecord({
        key: 'table:example',
        name: 'Example Table',
        locator: 'p. 5',
      }),
    ];
    const pages = [makePage(5, ['Example Table', 'Row one', 'Row two'])];
    expect(() =>
      assertRecordsAnchoredInSource(records, pages, {
        requireDeclarationsLive: false,
      }),
    ).not.toThrow();
  });

  it('passes when the record name is split by PDF line-wrap hyphenation', () => {
    const records = [
      makeRecord({ key: 'rule:guidance', name: 'Guidance', locator: 'p. 9' }),
    ];
    const pages = [makePage(9, ['Some Guid-', 'ance section follows.'])];
    expect(() =>
      assertRecordsAnchoredInSource(records, pages, {
        requireDeclarationsLive: false,
      }),
    ).not.toThrow();
  });

  // Matching is whole-token (PR #570 review F1): an anchor printed only as
  // part of a larger word is not printed at all. Covers a suffix ("Rage" in
  // "Average"), a prefix ("Fire" in "Fireball"), and an embedded multi-token
  // anchor whose first and last tokens are word fragments.
  it.each([
    { name: 'Rage', line: 'Average damage is listed first.' },
    { name: 'Fire', line: 'You cast Fireball.' },
    { name: 'Bolt Arrow', line: 'Thunderbolt Arrowhead' },
  ])(
    'throws when "$name" appears only inside larger printed words',
    ({ name, line }) => {
      const records = [
        makeRecord({ key: 'rule:probe', name, locator: 'p. 7' }),
      ];
      expect(() =>
        assertRecordsAnchoredInSource(records, [makePage(7, [line])], {
          requireDeclarationsLive: false,
        }),
      ).toThrow(/rule:probe/);
    },
  );

  it('passes a whole-token match regardless of case, punctuation, and dash variant', () => {
    const records = [
      makeRecord({ key: 'rule:rage', name: 'Rage', locator: 'p. 7' }),
      makeRecord({ key: 'rule:half', name: 'Half-Dragon', locator: 'p. 7' }),
    ];
    const pages = [makePage(7, ['you can enter a rage.', 'The half–dragon'])];
    expect(() =>
      assertRecordsAnchoredInSource(records, pages, {
        requireDeclarationsLive: false,
      }),
    ).not.toThrow();
  });

  it('passes an editorial hyphen that falls at a printed line end', () => {
    const records = [
      makeRecord({ key: 'rule:half', name: 'Half-Dragon', locator: 'p. 7' }),
    ];
    const pages = [makePage(7, ['A Half-', 'Dragon template.'])];
    expect(() =>
      assertRecordsAnchoredInSource(records, pages, {
        requireDeclarationsLive: false,
      }),
    ).not.toThrow();
  });

  it('passes for a compiler-composed name using its declared anchor', () => {
    const declaration = DECLARED_RECORD_SOURCE_ANCHORS.get(
      'table:acolyte-bonds',
    );
    if (declaration === undefined) {
      throw new Error(
        'fixture requires the table:acolyte-bonds declaration to exist',
      );
    }
    const records = [
      makeRecord({
        key: 'table:acolyte-bonds',
        name: 'Acolyte Bonds',
        locator: 'p. 61',
      }),
    ];
    const pages = [makePage(61, [declaration.anchor])];
    expect(() =>
      assertRecordsAnchoredInSource(records, pages, {
        requireDeclarationsLive: false,
      }),
    ).not.toThrow();
  });

  it('throws when a declared anchor is absent from the cited page', () => {
    const records = [
      makeRecord({
        key: 'table:acolyte-bonds',
        name: 'Acolyte Bonds',
        locator: 'p. 61',
      }),
    ];
    const pages = [
      makePage(61, [
        'Neither the record name nor its declared anchor appear here.',
      ]),
    ];
    expect(() =>
      assertRecordsAnchoredInSource(records, pages, {
        requireDeclarationsLive: false,
      }),
    ).toThrow(/table:acolyte-bonds/);
  });

  it('throws when a declaration is redundant because the record name is already found', () => {
    const records = [
      makeRecord({
        key: 'table:acolyte-bonds',
        name: 'Acolyte Bonds',
        locator: 'p. 61',
      }),
    ];
    const pages = [makePage(61, ['Acolyte Bonds', 'd6 Bond', '1 fixture row'])];
    expect(() =>
      assertRecordsAnchoredInSource(records, pages, {
        requireDeclarationsLive: false,
      }),
    ).toThrow(/redundant/);
  });

  it('does not flag stale declarations when requireDeclarationsLive is false', () => {
    expect(() =>
      assertRecordsAnchoredInSource([], [], { requireDeclarationsLive: false }),
    ).not.toThrow();
  });

  it('throws on stale declarations only when requireDeclarationsLive is true', () => {
    expect(() =>
      assertRecordsAnchoredInSource([], [], { requireDeclarationsLive: true }),
    ).toThrow(/stale declaration/);
  });

  it('throws one error listing every failing record, not just the first', () => {
    const records = [
      makeRecord({
        key: 'table:first-bad',
        name: 'First Bad',
        locator: 'p. 1',
      }),
      makeRecord({
        key: 'table:second-bad',
        name: 'Second Bad',
        locator: 'p. 2',
      }),
    ];
    const pages = [makePage(1, ['unrelated']), makePage(2, ['also unrelated'])];
    let thrown: unknown;
    try {
      assertRecordsAnchoredInSource(records, pages, {
        requireDeclarationsLive: false,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RecordSourceAnchorError);
    const message = (thrown as Error).message;
    expect(message).toContain('table:first-bad');
    expect(message).toContain('table:second-bad');
  });
});

describe('DECLARED_RECORD_SOURCE_ANCHORS', () => {
  it('gives every declaration a non-empty reason and a substantive anchor', () => {
    for (const [key, declaration] of DECLARED_RECORD_SOURCE_ANCHORS) {
      expect(declaration.reason.trim().length, key).toBeGreaterThan(0);
      expect(
        normalizeAnchorText(declaration.anchor).length,
        key,
      ).toBeGreaterThanOrEqual(8);
    }
  });
});
