import { describe, expect, it } from 'vitest';
import {
  loadBootstrapCapabilityLedger,
  validateBootstrapCapabilityLedger,
} from '../src/rules/bootstrapCapabilityLedger.js';

describe('bootstrap capability ledger', () => {
  it('loads the non-authoritative ledger at primitive granularity', () => {
    const ledger = loadBootstrapCapabilityLedger();
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
      ledger.rows.every(
        (row) =>
          row.packEvidence.includes('record.key') &&
          row.packEvidence.includes('data.executionReadiness'),
      ),
    ).toBe(true);
  }, 30_000);

  it('proves several primitives were discovered without pack readiness', () => {
    const ledger = loadBootstrapCapabilityLedger();
    const nonPackRows = ledger.rows.filter(
      (row) => !row.discoveredBy.includes('readiness-artifacts'),
    );
    expect(nonPackRows.length).toBeGreaterThan(2);
    expect(nonPackRows.some((row) => row.primitive.includes('legendary'))).toBe(
      true,
    );
    expect(
      nonPackRows.some((row) => row.primitive.includes('point-origin')),
    ).toBe(true);
  });

  it('gives every row a specific owner and records proposed bead data', () => {
    const ledger = loadBootstrapCapabilityLedger();

    // Ownership by a family epic is correct before decomposition runs -- the
    // implementation children deliberately do not exist yet. What is never
    // acceptable is falling back to the engine epic root, which means no family
    // owns the primitive at all. Four cross-family primitives sat there until
    // their beads were created from this ledger.
    for (const row of ledger.rows) {
      expect(row.owningBead).toMatch(/^eshyra-[a-z0-9]+(?:\.[0-9]+)+$/);
      expect(row.owningBead).not.toBe('eshyra-olc5');
    }

    // A row may still be proposed-new-bead when a later pass discovers an
    // unowned primitive; when it is, it must carry enough to create the bead.
    for (const row of ledger.rows.filter(
      (candidate) => candidate.ownershipStatus === 'proposed-new-bead',
    )) {
      expect(row.proposedTitle).toMatch(/.+/);
      expect(row.proposedParent).toBe('eshyra-olc5');
    }
  });

  it('rejects a row that names the engine epic as its owner', () => {
    const ledger = loadBootstrapCapabilityLedger();
    // Mutate one row of the otherwise-valid ledger: a single-row ledger would
    // trip the per-family coverage checks long before ownership is examined.
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

  it('rejects bare family IDs and hand-copied count fields', () => {
    const ledger = loadBootstrapCapabilityLedger();
    const row = { ...ledger.rows[0], capabilityId: 'F1', count: 1 };
    expect(() =>
      validateBootstrapCapabilityLedger(
        { ...ledger, rows: [row] },
        { checkBeads: false },
      ),
    ).toThrow(/engine:F1|count/);
  });
});
