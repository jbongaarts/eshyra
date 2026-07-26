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

  it('keeps ownership varied and records proposed bead data', () => {
    const ledger = loadBootstrapCapabilityLedger();
    expect(new Set(ledger.rows.map((row) => row.ownershipStatus))).toEqual(
      new Set(['owned', 'proposed-new-bead']),
    );
    for (const row of ledger.rows.filter(
      (candidate) => candidate.ownershipStatus === 'proposed-new-bead',
    )) {
      expect(row.proposedTitle).toMatch(/.+/);
      expect(row.proposedParent).toBe('eshyra-olc5');
    }
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
