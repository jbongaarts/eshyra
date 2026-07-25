import { describe, expect, it } from 'vitest';
import {
  loadBootstrapCapabilityLedger,
  validateBootstrapCapabilityLedger,
} from '../src/rules/bootstrapCapabilityLedger.js';

describe('bootstrap capability ledger', () => {
  it('loads the non-authoritative ledger and covers every qualified family', () => {
    const ledger = loadBootstrapCapabilityLedger();
    expect(ledger.status).toBe('NON-AUTHORITATIVE');
    expect(ledger.authoritativeLedger).toBe('eshyra-o9bd.19.5.12');
    expect(new Set(ledger.rows.map((row) => row.capabilityId))).toEqual(
      new Set(Array.from({ length: 10 }, (_, index) => `engine:F${index + 1}`)),
    );
  }, 30_000);

  it('proves a capability was discovered without pack readiness', () => {
    const ledger = loadBootstrapCapabilityLedger();
    const nonPackRow = ledger.rows.find(
      (row) => !row.discoveredBy.includes('readiness-artifacts'),
    );
    expect(nonPackRow?.capabilityId).toBe('engine:F2');
    expect(nonPackRow?.requirement).toMatch(
      /legendary-action allowance|legendary-action budget/i,
    );
  });

  it('rejects bare family IDs and hand-copied count fields', () => {
    const ledger = loadBootstrapCapabilityLedger();
    const row = { ...ledger.rows[0], capabilityId: 'F1', count: 83 };
    expect(() =>
      validateBootstrapCapabilityLedger(
        { ...ledger, rows: [row] },
        { checkBeads: false },
      ),
    ).toThrow(/engine:F1|count/);
  });
});
