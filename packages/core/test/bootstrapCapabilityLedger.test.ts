import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  evaluateReadinessArtifact,
  evaluateRowEvidence,
  loadBootstrapCapabilityLedger,
  NON_PACK_DISCOVERY_PRIMITIVES,
  resolveEvidence,
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
  it('loads all primitive rows with executable, source-specific evidence', () => {
    const ledger = loadBootstrapCapabilityLedger();
    const records = loadPackRecords();
    expect(ledger.status).toBe('NON-AUTHORITATIVE');
    expect(ledger.authoritativeLedger).toBe('eshyra-o9bd.19.5.12');
    expect(new Set(ledger.rows.map((row) => row.primitive)).size).toBe(
      ledger.rows.length,
    );
    expect(ledger.rows.every((row) => row.evidence.length > 0)).toBe(true);
    expect(
      ledger.rows.every((row) =>
        row.evidence.some((evidence) => evidence.kind === 'code'),
      ),
    ).toBe(true);

    for (let family = 1; family <= 10; family += 1) {
      expect(
        ledger.rows.filter((row) => row.capabilityId === `engine:F${family}`)
          .length,
      ).toBeGreaterThan(1);
    }

    for (const row of ledger.rows) {
      const resolutions = evaluateRowEvidence(row, records);
      expect(
        resolutions.every(
          (result) =>
            result.status === 'satisfied' || result.status === 'skipped',
        ),
      ).toBe(true);
      for (const result of resolutions) {
        if (result.evidence.kind === 'readiness-artifact') {
          if (result.evidence.expected === 'non-empty')
            expect(result.matches?.length).toBeGreaterThan(0);
          else expect(result.matches).toHaveLength(0);
        }
        if (result.evidence.kind === 'known-missing-source-clause') {
          expect(result.scannedRecords).toBe(records.length);
          expect(result.scannedClauses).toBeGreaterThan(0);
        }
      }
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

  it('matches exact structured hook identity, never a near-match', () => {
    const ledger = loadBootstrapCapabilityLedger();
    const evidence = ledger.rows[0].evidence.find(
      (item) => item.kind === 'readiness-artifact',
    );
    if (evidence?.kind !== 'readiness-artifact')
      throw new Error('fixture needs readiness evidence');
    const clause = {
      clauseId: 'fixture/clause',
      engineHooks: [
        {
          engine: evidence.hookSelector.engine,
          hook: `${evidence.hookSelector.name}x`,
        },
        {
          engine: evidence.hookSelector.engine,
          hook: `x${evidence.hookSelector.name}`,
        },
        {
          engine: evidence.hookSelector.engine,
          hook: `prefix ${evidence.hookSelector.name} suffix`,
        },
        { engine: 'F2', hook: evidence.hookSelector.name },
      ],
    };
    const record = {
      key: 'fixture:near-match',
      source: 'fixture source',
      provenance: { locator: 'fixture locator' },
      data: { executionReadiness: { clauses: [clause] } },
    };
    const absent = evaluateReadinessArtifact(
      { ...evidence, expected: 'absent-from-pack' },
      [record],
    );
    expect(absent).toHaveLength(0);
    expect(() => evaluateReadinessArtifact(evidence, [record])).toThrow(
      /non-empty/,
    );
    expect(
      evaluateReadinessArtifact({ ...evidence, expected: 'non-empty' }, [
        {
          ...record,
          data: {
            executionReadiness: {
              clauses: [
                {
                  ...clause,
                  engineHooks: [
                    {
                      engine: evidence.hookSelector.engine,
                      hook: evidence.hookSelector.name,
                    },
                  ],
                },
              ],
            },
          },
        },
      ]),
    ).toHaveLength(1);
  });

  it('proves a known source clause is absent instead of treating an empty query as proof', () => {
    const ledger = loadBootstrapCapabilityLedger();
    const row = ledger.rows.find(
      (item) => item.primitive === NON_PACK_DISCOVERY_PRIMITIVES[0],
    );
    if (!row) throw new Error('fixture needs legendary-action row');
    const evidence = row.evidence.find(
      (item) => item.kind === 'known-missing-source-clause',
    );
    if (evidence?.kind !== 'known-missing-source-clause')
      throw new Error('fixture needs missing-source evidence');
    const result = resolveEvidence(evidence, loadPackRecords());
    expect(result.status).toBe('satisfied');
    expect(result.scannedClauses).toBeGreaterThan(0);
    expect(() =>
      resolveEvidence(evidence, [
        {
          data: {
            executionReadiness: { clauses: [{ marker: evidence.locator }] },
          },
        },
      ]),
    ).toThrow(/unexpectedly present/);
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

  it('rejects unknown, mismatched, duplicate, and missing query bindings', () => {
    const ledger = loadBootstrapCapabilityLedger();
    expect(() =>
      validateBootstrapCapabilityLedger(
        {
          ...ledger,
          rows: ledger.rows.map((row, index) =>
            index === 0
              ? {
                  ...row,
                  evidence: row.evidence.map((item) =>
                    item.kind === 'readiness-artifact'
                      ? { ...item, queryId: 'bootstrap:unknown' }
                      : item,
                  ),
                }
              : row,
          ),
        },
        { checkBeads: false },
      ),
    ).toThrow(/queryId/);
    expect(() =>
      validateBootstrapCapabilityLedger(
        {
          ...ledger,
          rows: ledger.rows.map((row, index) =>
            index === 0
              ? {
                  ...row,
                  evidence: row.evidence.map((item) =>
                    item.kind === 'readiness-artifact'
                      ? { ...item, engine: 'engine:F2' }
                      : item,
                  ),
                }
              : row,
          ),
        },
        { checkBeads: false },
      ),
    ).toThrow(/mismatched|targets/);
    expect(() =>
      validateBootstrapCapabilityLedger(
        {
          ...ledger,
          rows: ledger.rows.map((row, index) =>
            index === 0
              ? {
                  ...row,
                  evidence: row.evidence.filter(
                    (item) => item.kind !== 'readiness-artifact',
                  ),
                  discoveredBy: row.discoveredBy.filter(
                    (source) => source !== 'readiness-artifacts',
                  ),
                }
              : row,
          ),
        },
        { checkBeads: false },
      ),
    ).toThrow(/non-pack|readiness|source-span/);
  });

  it('rejects the old overloaded pack evidence and copied counts', () => {
    const ledger = loadBootstrapCapabilityLedger();
    expect(() =>
      validateBootstrapCapabilityLedger(
        {
          ...ledger,
          rows: ledger.rows.map((row, index) =>
            index === 0 ? { ...row, packEvidence: {} } : row,
          ),
        },
        { checkBeads: false },
      ),
    ).toThrow(/count|evidence|packEvidence/);
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
});
