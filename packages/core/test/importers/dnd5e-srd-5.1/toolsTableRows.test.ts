/**
 * Unit evidence for the source-derived Tools table row parity gate
 * (eshyra-o9bd.19.2.2.2). The corpus-wide proof is the importer run itself:
 * `runImporter` calls `assertToolsTableRowParity` over the full SRD
 * extraction, and CI's srd-importer-reproducibility job runs
 * `verify:dnd5e-srd-pack` whenever importer or pack files change.
 */
import { describe, expect, it } from 'vitest';
import {
  assertToolsTableRowParity,
  auditToolsTableRows,
  ToolsTableRowParityError,
} from '../../../scripts/importers/dnd5e-srd-5.1/toolsTableRows.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import type { RulesRecord } from '../../../src/rules/types.js';

function tool(
  name: string,
  cells: { cost?: string; weight?: string } = {},
): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'equipment',
    key: `equipment:${name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
    name,
    data: { category: 'tool', ...cells },
  } as unknown as RulesRecord;
}

const SOURCE: PageText[] = [
  {
    pageNumber: 70,
    lines: [
      'Tools',
      'Item Cost Weight',
      'Artisan’s tools',
      'Smith’s tools 20 gp 8 lb.',
      'Gaming set',
      'Dice set 1 sp —',
      'Vehicles (land or water) * *',
      '* See the “Mounts and Vehicles” section.',
      'Artisan’s Tools. These special tools include the',
    ],
  },
];

const EMITTED: RulesRecord[] = [
  tool('Smith’s tools', { cost: '20 gp', weight: '8 lb.' }),
  tool('Dice set', { cost: '1 sp' }),
  tool('Vehicles (land or water)'),
];

describe('Tools table row parity gate', () => {
  it('reads printed rows from the source, skipping only reviewed group headers', () => {
    const audit = auditToolsTableRows(EMITTED, SOURCE);
    expect(audit.sourceRows).toEqual([
      { name: 'Smith’s tools', cost: '20 gp', weight: '8 lb.' },
      { name: 'Dice set', cost: '1 sp' },
      { name: 'Vehicles (land or water)' },
    ]);
    expect(() =>
      assertToolsTableRowParity(EMITTED, SOURCE, { requireComplete: true }),
    ).not.toThrow();
  });

  it('fails when a printed row has no emitted counterpart (the terminator-only Vehicles row)', () => {
    expect(() =>
      assertToolsTableRowParity(EMITTED.slice(0, 2), SOURCE, {
        requireComplete: true,
      }),
    ).toThrow(/printed row not emitted: Vehicles \(land or water\)/);
  });

  it('fails on a substituted row even when the tool count is unchanged', () => {
    const substituted = [
      EMITTED[0],
      tool('Dice', { cost: '1 sp' }),
      EMITTED[2],
    ];
    expect(() =>
      assertToolsTableRowParity(substituted, SOURCE, { requireComplete: true }),
    ).toThrow(
      /printed row not emitted: Dice set[\s\S]*tool record not printed/,
    );
  });

  it('fails on a duplicated or cell-drifted row', () => {
    expect(() =>
      assertToolsTableRowParity([...EMITTED, EMITTED[0]], SOURCE, {
        requireComplete: true,
      }),
    ).toThrow(/duplicated row: emitted Smith’s tools/);
    expect(() =>
      assertToolsTableRowParity(
        [
          EMITTED[0],
          EMITTED[1],
          tool('Vehicles (land or water)', { cost: '*' }),
        ],
        SOURCE,
        { requireComplete: true },
      ),
    ).toThrow(/Vehicles \(land or water\): source cost\/weight \(none\)/);
  });

  it('reports a table line it cannot classify instead of guessing', () => {
    const lines = [...SOURCE[0].lines];
    lines.splice(4, 0, 'Musical instruments');
    expect(() =>
      assertToolsTableRowParity(EMITTED, [{ pageNumber: 70, lines }], {
        requireComplete: true,
      }),
    ).toThrow(/unclassified table line: Musical instruments/);
  });

  it('requires the table only on the complete import', () => {
    const noTable: PageText[] = [{ pageNumber: 1, lines: ['Armor'] }];
    expect(() =>
      assertToolsTableRowParity([], noTable, { requireComplete: false }),
    ).not.toThrow();
    expect(() =>
      assertToolsTableRowParity([], noTable, { requireComplete: true }),
    ).toThrow(ToolsTableRowParityError);
  });
});
