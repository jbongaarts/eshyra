/**
 * Tests for multi-page provenance enrichment (eshyra-lpk9).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  enrichProvenanceFromRegionLedger,
  pageSpansByRecordKey,
} from '../../../scripts/importers/dnd5e-srd-5.1/enrichProvenance.js';
import type { SourceRegionLedger } from '../../../scripts/importers/dnd5e-srd-5.1/sourceRegionLedger.js';
import { getBundledDnd5eSrdPack } from '../../../src/internal.js';
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

function record(key: string, locator: string | undefined): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'rule',
    key,
    name: key,
    data: { text: 'fixture' },
    source: 'fixture',
    license: LICENSE,
    provenance: {
      sourceRef: 'https://example.test',
      ...(locator === undefined ? {} : { locator }),
    },
  };
}

function ledger(
  entries: ReadonlyArray<{
    readonly targetKey?: string;
    readonly pageStart: number;
    readonly pageEnd: number;
    readonly contentMatch?: boolean;
  }>,
): SourceRegionLedger {
  return {
    summary: {
      entries: entries.length,
      proseRegions: entries.length,
      pureStructure: 0,
      record: entries.length,
      childOf: 0,
      intentionallyIgnored: {},
      pureDocumentStructure: 0,
      unrepresented: 0,
      broadStructuralIgnores: 0,
    },
    entries: entries.map((e, i) => ({
      id: `fixture-${i}`,
      pageStart: e.pageStart,
      pageEnd: e.pageEnd,
      lineStart: 0,
      lineEnd: 0,
      headingPath: [],
      sourceContext: null,
      regionType: 'record-body',
      firstPhrase: 'fixture',
      lastPhrase: 'fixture',
      normalizedCharCount: 10,
      classification:
        e.targetKey === undefined
          ? 'unrepresented'
          : (`record:${e.targetKey}` as const),
      ...(e.targetKey === undefined ? {} : { targetKey: e.targetKey }),
      ...(e.contentMatch === undefined ? {} : { contentMatch: e.contentMatch }),
    })),
  };
}

describe('pageSpansByRecordKey', () => {
  it('unions contiguous page ranges per target key', () => {
    const spans = pageSpansByRecordKey(
      ledger([
        { targetKey: 'rule:example', pageStart: 93, pageEnd: 93 },
        { targetKey: 'rule:example', pageStart: 94, pageEnd: 94 },
      ]),
    );
    expect(spans.get('rule:example')).toEqual([93, 94]);
  });

  it('excludes content-match entries from the page span', () => {
    const spans = pageSpansByRecordKey(
      ledger([
        { targetKey: 'table:example', pageStart: 22, pageEnd: 22 },
        {
          targetKey: 'table:example',
          pageStart: 109,
          pageEnd: 109,
          contentMatch: true,
        },
      ]),
    );
    expect(spans.get('table:example')).toEqual([22]);
  });

  it('ignores entries with no targetKey', () => {
    const spans = pageSpansByRecordKey(ledger([{ pageStart: 1, pageEnd: 1 }]));
    expect(spans.size).toBe(0);
  });
});

describe('enrichProvenanceFromRegionLedger', () => {
  it('extends a single-page locator to a multi-page list from adjacent ledger evidence', () => {
    const [enriched] = enrichProvenanceFromRegionLedger(
      [record('action:ready', 'p. 93')],
      ledger([{ targetKey: 'action:ready', pageStart: 93, pageEnd: 94 }]),
    );
    expect(enriched.provenance.locator).toBe('pp. 93, 94');
  });

  it('leaves a single-page record alone when the ledger has no evidence for it', () => {
    const [enriched] = enrichProvenanceFromRegionLedger(
      [record('rule:solo', 'p. 10')],
      ledger([{ targetKey: 'rule:other', pageStart: 20, pageEnd: 21 }]),
    );
    expect(enriched.provenance.locator).toBe('p. 10');
  });

  it('does not touch an already-multi-page locator', () => {
    const [enriched] = enrichProvenanceFromRegionLedger(
      [record('equipment:acid-vial', 'pp. 66, 69')],
      ledger([
        { targetKey: 'equipment:acid-vial', pageStart: 90, pageEnd: 90 },
      ]),
    );
    expect(enriched.provenance.locator).toBe('pp. 66, 69');
  });

  it('drops a ledger page far from the record start (bare heading-name collision), not just far-away content matches', () => {
    // Mirrors rule:class-features: the "Class Features" heading auto-matches
    // one shared record from 13 different class chapters, only one of which
    // (its own starting page) is genuinely that record's content.
    const [enriched] = enrichProvenanceFromRegionLedger(
      [record('rule:class-features', 'p. 57')],
      ledger([
        { targetKey: 'rule:class-features', pageStart: 8, pageEnd: 8 },
        { targetKey: 'rule:class-features', pageStart: 57, pageEnd: 57 },
      ]),
    );
    expect(enriched.provenance.locator).toBe('p. 57');
  });

  it('keeps a nearby page within the continuation gap', () => {
    const [enriched] = enrichProvenanceFromRegionLedger(
      [record('rule:example', 'p. 10')],
      ledger([{ targetKey: 'rule:example', pageStart: 12, pageEnd: 12 }]),
    );
    expect(enriched.provenance.locator).toBe('pp. 10, 12');
  });

  it('is a no-op for a record whose locator is undefined', () => {
    const [enriched] = enrichProvenanceFromRegionLedger(
      [record('rule:no-locator', undefined)],
      ledger([{ targetKey: 'rule:no-locator', pageStart: 1, pageEnd: 2 }]),
    );
    expect(enriched.provenance.locator).toBeUndefined();
  });
});

describe('committed SRD 5.1 pack — provenance matches the committed region ledger', () => {
  const pack = getBundledDnd5eSrdPack();
  const regionLedger = JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/source-region-ledger.json',
      ),
      'utf8',
    ),
  ) as SourceRegionLedger;

  it('leaves no single-page-locator record with unapplied nearby ledger evidence', () => {
    // Regression guard (eshyra-lpk9): if the pack is regenerated by hand or
    // the enrichment step is skipped, a record with real nearby ledger
    // evidence would be left at its narrower single-page locator. Re-running
    // the real enrichment function against every currently single-page
    // record must be a no-op.
    const singlePage = pack.records.filter((r) =>
      /^p\. \d+$/.test(r.provenance.locator ?? ''),
    );
    const reenriched = enrichProvenanceFromRegionLedger(
      singlePage,
      regionLedger,
    );
    const stillApplicable = reenriched.filter(
      (r, i) => r.provenance.locator !== singlePage[i]?.provenance.locator,
    );
    expect(stillApplicable.map((r) => r.key)).toEqual([]);
  });

  it('pins the eshyra-lpk9 bead examples to their corrected multi-page locators', () => {
    const byKey = new Map(pack.records.map((r) => [r.key, r] as const));
    expect(byKey.get('action:ready')?.provenance.locator).toBe('pp. 93, 94');
    expect(byKey.get('background:acolyte')?.provenance.locator).toBe(
      'pp. 60, 61',
    );
    expect(byKey.get('condition:paralyzed')?.provenance.locator).toBe(
      'pp. 358, 359',
    );
    expect(byKey.get('creature:adult-brass-dragon')?.provenance.locator).toBe(
      'pp. 291, 292',
    );
    expect(byKey.get('rule:wizard-your-spellbook')?.provenance.locator).toBe(
      'pp. 54, 55',
    );
  });

  it('never emits a page span wider than the continuation gap for any record', () => {
    // Guards against a repeat of the rule:class-features bare-heading-name
    // collision producing a many-page span from unrelated chapters.
    for (const record of pack.records) {
      const locator = record.provenance.locator;
      if (locator === undefined || !locator.startsWith('pp. ')) continue;
      const pages = locator
        .slice('pp. '.length)
        .split(', ')
        .map((p) => Number(p));
      const span = Math.max(...pages) - Math.min(...pages);
      expect(span, record.key).toBeLessThanOrEqual(4);
    }
  });
});
