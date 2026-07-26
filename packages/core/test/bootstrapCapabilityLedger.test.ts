import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  evaluatePackEvidence,
  loadBootstrapCapabilityLedger,
  NON_PACK_DISCOVERY_PRIMITIVES,
  validateBootstrapCapabilityLedger,
} from '../src/rules/bootstrapCapabilityLedger.js';

const PACK_PATH = fileURLToPath(
  new URL(
    '../data/rules-packs/rules__dnd5e-srd-5.1/records.json',
    import.meta.url,
  ),
);

function loadPackRecords(): readonly unknown[] {
  return JSON.parse(readFileSync(PACK_PATH, 'utf8')) as readonly unknown[];
}

describe('bootstrap capability ledger', () => {
  it('loads the non-authoritative ledger with executable primitive queries', () => {
    const ledger = loadBootstrapCapabilityLedger();
    const records = loadPackRecords();
    expect(ledger.status).toBe('NON-AUTHORITATIVE');
    expect(ledger.authoritativeLedger).toBe('eshyra-o9bd.19.5.12');
    for (let family = 1; family <= 10; family += 1) {
      expect(
        ledger.rows.filter((row) => row.capabilityId === `engine:F${family}`)
          .length,
      ).toBeGreaterThan(1);
    }
    expect(new Set(ledger.rows.map((row) => row.primitive)).size).toBe(
      ledger.rows.length,
    );
    expect(ledger.rows.every((row) => row.primitive !== row.capabilityId)).toBe(
      true,
    );
    expect(
      new Set(ledger.rows.map((row) => row.packEvidence.queryId)).size,
    ).toBe(ledger.rows.length);

    for (const row of ledger.rows) {
      const matches = evaluatePackEvidence(row.packEvidence, records);
      expect(
        matches.every(
          (match) =>
            match.recordKey.length > 0 &&
            match.clauseId.length > 0 &&
            match.path.startsWith('data.executionReadiness.clauses[') &&
            match.sourceSpan.length > 0,
        ),
      ).toBe(true);
    }
  }, 30_000);

  it('pins the exact seven primitive non-pack discovery set', () => {
    const ledger = loadBootstrapCapabilityLedger();
    const nonPackRows = ledger.rows.filter(
      (row) => !row.discoveredBy.includes('readiness-artifacts'),
    );
    expect(nonPackRows.map((row) => row.primitive)).toEqual(
      NON_PACK_DISCOVERY_PRIMITIVES,
    );
  });

  it('represents a proposed row without inventing an owner', () => {
    const ledger = loadBootstrapCapabilityLedger();
    const proposedRows = ledger.rows.map((row, index) =>
      index === 0
        ? {
            ...row,
            owningBead: null,
            ownershipStatus: 'proposed-new-bead' as const,
            proposedTitle: 'Proposed condition owner',
            proposedParent: 'eshyra-olc5',
            notes: `${row.notes} Proposed title and parent are recorded here.`,
          }
        : row,
    );
    const validated = validateBootstrapCapabilityLedger(
      { ...ledger, rows: proposedRows },
      { checkBeads: false },
    );
    expect(validated.rows[0].owningBead).toBeNull();
    expect(validated.rows[0].ownershipStatus).toBe('proposed-new-bead');
  });

  it('rejects a query that targets a different capability family', () => {
    const ledger = loadBootstrapCapabilityLedger();
    const rows = ledger.rows.map((row, index) =>
      index === 0
        ? {
            ...row,
            packEvidence: { ...row.packEvidence, engine: 'engine:F2' },
          }
        : row,
    );
    expect(() =>
      validateBootstrapCapabilityLedger(
        { ...ledger, rows },
        { checkBeads: false },
      ),
    ).toThrow(/targets|family/);
  });

  it('rejects a row that names the engine epic as its owner', () => {
    const ledger = loadBootstrapCapabilityLedger();
    const rows = ledger.rows.map((row, index) =>
      index === 0 ? { ...row, owningBead: 'eshyra-olc5' } : row,
    );
    expect(() =>
      validateBootstrapCapabilityLedger(
        { ...ledger, rows },
        { checkBeads: false },
      ),
    ).toThrow(/engine epic/);
  });

  it('rejects a bare family ID independently of stored-count validation', () => {
    const ledger = loadBootstrapCapabilityLedger();
    const rows = ledger.rows.map((row, index) =>
      index === 0 ? { ...row, capabilityId: 'F1' } : row,
    );
    expect(() =>
      validateBootstrapCapabilityLedger(
        { ...ledger, rows },
        { checkBeads: false },
      ),
    ).toThrow(/capabilityId/);
  });

  it('rejects top-level and nested stored-count fields independently', () => {
    const ledger = loadBootstrapCapabilityLedger();
    expect(() =>
      validateBootstrapCapabilityLedger(
        { ...ledger, total: 31 },
        { checkBeads: false },
      ),
    ).toThrow(/total/);
    expect(() =>
      validateBootstrapCapabilityLedger(
        { ...ledger, metadata: { storedCount: 31 } },
        { checkBeads: false },
      ),
    ).toThrow(/storedCount/);
  });

  it('rejects duplicate primitive identities through the exported validator', () => {
    const ledger = loadBootstrapCapabilityLedger();
    const rows = ledger.rows.map((row, index) =>
      index === 1 ? { ...row, primitive: ledger.rows[0].primitive } : row,
    );
    expect(() =>
      validateBootstrapCapabilityLedger(
        { ...ledger, rows },
        { checkBeads: false },
      ),
    ).toThrow(/duplicate primitive/);
  });
});
