import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DND5E_FIELD_PROVENANCE_DECLARATIONS,
  deriveEmbeddedTableSpliceDeclarations,
} from '../../../scripts/importers/dnd5e-srd-5.1/fieldProvenanceDeclarations.js';
import {
  proseHasInternalSplice,
  stripEmbeddedTableProseReporting,
} from '../../../scripts/importers/dnd5e-srd-5.1/stripEmbeddedTableProse.js';
import type { TableExtraction } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import {
  buildContextPacket,
  bundledDnd5eSrdFieldProvenanceSource,
  classifyFieldPointer,
  getBundledDnd5eSrdFieldProvenanceManifest,
  getBundledDnd5eSrdPack,
  renderContextPacketMessage,
  runDiscoveryStages,
} from '../../../src/internal.js';
import type { RulesRecord } from '../../../src/rules/types.js';
import { DIAGNOSTIC_FIXTURES } from '../../diagnostics/index.js';
import { installJhptCampaignRules } from '../../discovery/support/jhptCampaignRules.js';
import {
  installScenarioBinding,
  moduleForFixture,
  scenarioForFixture,
} from '../../discovery/support/scenario.js';
import { freshDbWithSession } from '../../support/db.js';

/**
 * eshyra-o9bd.16.7.5 (Sol review S1/S2 of PR #701).
 */

const records = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
    ),
    'utf8',
  ),
) as RulesRecord[];
const byKey = (key: string): RulesRecord => {
  const found = records.find((record) => record.key === key);
  if (found === undefined) throw new Error(`${key} missing`);
  return found;
};

describe('S1: copied option citations are field-local', () => {
  const optionSources = (key: string): Record<string, string> => {
    const choices = (
      byKey(key).data as {
        choices: { options: { id: string; source: string }[] }[];
      }
    ).choices;
    return Object.fromEntries(
      choices[0].options.map((o: { id: string; source: string }) => [
        o.id,
        o.source,
      ]),
    );
  };

  it('Dragon Ancestor: Black is printed on p. 44, the other nine rows on p. 45', () => {
    const sources = optionSources('feature:draconic-bloodline:dragon-ancestor');
    expect(sources['dragon-ancestor:black']).toBe('SRD 5.1 p. 44');
    const rest = Object.entries(sources).filter(
      ([id]) => id !== 'dragon-ancestor:black',
    );
    expect(rest).toHaveLength(9);
    for (const [id, source] of rest) expect(source, id).toBe('SRD 5.1 p. 45');
  });

  it('every copied table option cites pages inside its table span', () => {
    const table = byKey('table:draconic-bloodline-draconic-ancestry');
    expect(table.provenance.locator).toBe('pp. 44, 45');
    for (const source of Object.values(
      optionSources('feature:draconic-bloodline:dragon-ancestor'),
    )) {
      expect(['SRD 5.1 p. 44', 'SRD 5.1 p. 45']).toContain(source);
    }
  });

  it('control: Circle Spells options stay p. 22', () => {
    for (const source of Object.values(
      optionSources('feature:circle-of-the-land:circle-spells'),
    )) {
      expect(source).toBe('SRD 5.1 p. 22');
    }
  });
});

describe('S2: internal table splices are reported and declared source-derived', () => {
  const table = (span: string, owner: string): TableExtraction =>
    ({
      name: 't',
      columns: [],
      rows: [],
      sourcePage: 1,
      ownerRecordKey: owner,
      proseSourceText: span,
    }) as unknown as TableExtraction;
  const rec = (key: string, description: string): RulesRecord =>
    ({
      systemId: 'x',
      kind: 'feature',
      key,
      name: key,
      data: { description },
      source: 's',
      provenance: {},
    }) as unknown as RulesRecord;

  it('reports a span with source text on both sides, not a trailing removal', () => {
    const span = 'Die Result Effect 1 Fire 2 Ice';
    const { records: out, splices } = stripEmbeddedTableProseReporting({
      records: [
        rec('feature:a', `Before the table. ${span} After the table.`),
        rec('feature:b', `Only a prefix. ${span}`),
      ],
      tables: [table(span, 'feature:a'), table(span, 'feature:b')],
    });
    expect(splices).toEqual([
      { recordKey: 'feature:a', kind: 'feature', pointer: '/description' },
    ]);
    expect((out[1].data as { description: string }).description).toBe(
      'Only a prefix.',
    );
    expect(proseHasInternalSplice('One. TABLE', ['TABLE'])).toBe(false);
    expect(proseHasInternalSplice('One. TABLE Two.', ['TABLE'])).toBe(true);
  });

  it('derives record-scoped source-derived declarations from the reports only', () => {
    const declarations = deriveEmbeddedTableSpliceDeclarations([
      { kind: 'feature', pointer: '/description', recordKey: 'feature:a' },
    ]);
    expect(declarations).toMatchObject([
      {
        kind: 'feature',
        pointerPrefix: '/description',
        class: 'source-derived',
        recordKeys: ['feature:a'],
      },
    ]);
    expect(deriveEmbeddedTableSpliceDeclarations([])).toEqual([]);
    expect(DND5E_FIELD_PROVENANCE_DECLARATIONS.length).toBeGreaterThan(0);
  });

  it('the committed manifest classifies both witnesses source-derived and a tail-trimmed control as source-prose', () => {
    const manifest = getBundledDnd5eSrdFieldProvenanceManifest();
    if (manifest === undefined) throw new Error('no bundled manifest');
    for (const key of [
      'feature:draconic-bloodline:dragon-ancestor',
      'feature:sorcerer:font-of-magic',
    ]) {
      expect(
        classifyFieldPointer(manifest, 'feature', key, '/description'),
        key,
      ).toBe('source-derived');
    }
    // Control: a feature description with no embedded-table removal.
    expect(
      classifyFieldPointer(
        manifest,
        'feature',
        'feature:sorcerer:sorcerous-origin',
        '/description',
      ),
    ).toBe('source-prose');
  });

  it('a real context packet renders neither witness under the verbatim heading', () => {
    const fixture = DIAGNOSTIC_FIXTURES.find((f) => f.probeId === 'P3');
    if (fixture === undefined) throw new Error('P3 missing');
    const execution = fixture.executions[0];
    const db = freshDbWithSession();
    try {
      const resolver = installScenarioBinding(fixture, db);
      const rules = installJhptCampaignRules(db, fixture, execution, resolver);
      const trace = runDiscoveryStages({
        db,
        scenario: scenarioForFixture(
          fixture,
          execution,
          moduleForFixture(fixture),
        ),
        campaignRuleSeam: rules.seam,
        campaignPosition: rules.campaignPosition,
        ...(resolver === undefined ? {} : { rulesPackResolver: resolver }),
      });
      const base = trace.retention.outputsProduced[0];
      const bundled = getBundledDnd5eSrdPack();
      for (const key of [
        'feature:draconic-bloodline:dragon-ancestor',
        'feature:sorcerer:font-of-magic',
      ]) {
        const record = bundled.records.find((r) => r.key === key);
        if (record === undefined) throw new Error(key);
        const candidate = {
          ...base,
          candidateKey: key,
          entry: { ...base.entry, record, pack: bundled },
        };
        const packet = buildContextPacket(
          { ...trace.retention, outputsProduced: [candidate] },
          [],
          512_000,
          bundledDnd5eSrdFieldProvenanceSource(),
        );
        const text = renderContextPacketMessage({
          retention: { overflow: trace.retention.overflow },
          packet: {
            packet: packet.packet,
            byteOverflow: packet.byteOverflow,
            dropped: packet.dropped,
          },
        }).text;
        const start = text.indexOf(`## Candidate ${key}\n`);
        expect(start, key).toBeGreaterThanOrEqual(0);
        const span = text.slice(start);
        const verbatim = span.split('### Source-derived facts')[0];
        expect(verbatim, key).not.toContain('/data/description:');
        expect(span, key).toContain('/data/description:');
      }
    } finally {
      db.close();
    }
  });
});
