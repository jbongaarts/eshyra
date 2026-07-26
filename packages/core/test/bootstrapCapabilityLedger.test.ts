import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_PRIMITIVE_ROSTER,
  CANONICAL_SEMANTIC_FACETS,
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
            result.status === 'satisfied' ||
            result.status === 'evidence-underived' ||
            result.status === 'skipped',
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
    const underived = ledger.rows.flatMap((row) =>
      evaluateRowEvidence(row, records).filter(
        (result) => result.status === 'evidence-underived',
      ),
    );
    expect(underived).toHaveLength(5);
    expect(
      underived.every(
        (result) => result.evidence.kind === 'known-missing-source-clause',
      ),
    ).toBe(true);
  }, 30_000);

  it('pins the canonical semantic-facet vocabulary used by source obligations', () => {
    expect(CANONICAL_SEMANTIC_FACETS).toEqual([
      'save',
      'save-with-damage',
      'save-without-damage',
      'save-with-alternate-outcomes',
      'attack',
      'attack-with-one-damage-mode',
      'attack-with-conditional-alternatives',
      'check',
      'branch',
      'action-economy',
      'resource-use',
      'resource-with-reset',
      'resource-without-reset',
      'duration',
      'duration-with-concentration',
      'duration-without-concentration',
      'effect',
      'effect-with-lifecycle',
      'effect-without-lifecycle',
      'geometry',
      'choice',
      'variant',
      'entity-lifecycle',
      'ledger',
      'model-adjudication',
      'recurrence',
      'immunity-window',
      'repeat-check',
      'termination',
    ]);
  });

  it('keeps source obligations and evidence identities in separate namespaces', () => {
    const ledger = loadBootstrapCapabilityLedger();
    const allEvidence = ledger.rows.flatMap((row) => row.evidence);
    expect(
      allEvidence.every((item) => item.evidenceId.startsWith('ev:::')),
    ).toBe(true);
    const sourceObligations = allEvidence.filter(
      (item) => item.kind === 'known-missing-source-clause',
    );
    expect(sourceObligations).toHaveLength(12);
    expect(
      sourceObligations.every((item) => item.obligationId.startsWith('obl:::')),
    ).toBe(true);
    expect(allEvidence.every((item) => !('obligationKind' in item))).toBe(true);
    for (const primitive of [
      'spellbook-copy-cost-and-asset-ledger',
      'short-rest-hit-dice-recovery',
      'derived-attack-ac-and-proficiency-modifiers',
      'canonical-currency-mutation',
      'downtime-study-expense-and-training-ledger',
    ]) {
      expect(
        ledger.rows
          .find((row) => row.primitive === primitive)
          ?.evidence.some((item) => item.kind === 'audit-finding'),
      ).toBe(false);
    }
  });

  it('pins the exact seven primitive non-pack discovery set', () => {
    const ledger = loadBootstrapCapabilityLedger();
    const nonPackRows = ledger.rows.filter(
      (row) => !row.discoveredBy.includes('readiness-artifacts'),
    );
    expect(nonPackRows.map((row) => row.primitive)).toEqual(
      NON_PACK_DISCOVERY_PRIMITIVES,
    );
  });

  it('enforces the canonical primitive roster in both directions', () => {
    const ledger = loadBootstrapCapabilityLedger();
    expect(ledger.rows.map((row) => [row.capabilityId, row.primitive])).toEqual(
      CANONICAL_PRIMITIVE_ROSTER,
    );
    expect(() =>
      validateBootstrapCapabilityLedger(
        { ...ledger, rows: ledger.rows.slice(1) },
        { checkBeads: false },
      ),
    ).toThrow(/roster/);
    expect(() =>
      validateBootstrapCapabilityLedger(
        {
          ...ledger,
          rows: ledger.rows.map((row, index) =>
            index === 0 ? { ...row, primitive: 'unexpected-primitive' } : row,
          ),
        },
        { checkBeads: false },
      ),
    ).toThrow(/roster|queryId/);
  });

  it('requires audit relevance to quote the canonical subject and remain row-specific', () => {
    const ledger = loadBootstrapCapabilityLedger();
    const firstAudit = ledger.rows[0].evidence.find(
      (item) => item.kind === 'audit-finding',
    );
    if (firstAudit?.kind !== 'audit-finding')
      throw new Error('fixture needs audit evidence');
    expect(() =>
      validateBootstrapCapabilityLedger(
        {
          ...ledger,
          rows: ledger.rows.map((row, index) =>
            index === 1
              ? {
                  ...row,
                  evidence: row.evidence.map((item) =>
                    item.kind === 'audit-finding'
                      ? { ...item, relevance: firstAudit.relevance }
                      : item,
                  ),
                }
              : row,
          ),
        },
        { checkBeads: false },
      ),
    ).toThrow(/subject|relevance/);
    expect(() =>
      validateBootstrapCapabilityLedger(
        {
          ...ledger,
          rows: ledger.rows.map((row, index) =>
            index === 0
              ? {
                  ...row,
                  evidence: row.evidence.map((item) =>
                    item.kind === 'audit-finding'
                      ? {
                          ...item,
                          relevance: `The accepted finding subject 'condition/action/feat structural gaps' is relevant because this row inventories the ${row.primitive} execution boundary exposed by that finding.`,
                        }
                      : item,
                  ),
                }
              : row,
          ),
        },
        { checkBeads: false },
      ),
    ).toThrow(/mechanically derived/);
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
    const anchor = loadPackRecords().find(
      (record) =>
        typeof record === 'object' &&
        record !== null &&
        (record as { key?: unknown }).key === evidence.sourceRecordKey,
    );
    if (!anchor) throw new Error('fixture needs source anchor');
    const record = anchor as Record<string, unknown>;
    const data = (record.data ?? {}) as Record<string, unknown>;
    const underived = resolveEvidence(evidence, [
      {
        ...record,
        data: {
          ...data,
          executionReadiness: {
            clauses: [
              {
                clauseId: 'fixture/projected-clause',
                representation: {
                  semantic: evidence.projectionTerms[0],
                },
                engineHooks: [],
              },
            ],
          },
        },
      },
    ]);
    expect(underived.status).toBe('evidence-underived');
    expect(underived.projectionMatches).toHaveLength(1);
    expect(() =>
      resolveEvidence(
        { ...evidence, sourcePath: 'data.not-a-source-path' },
        loadPackRecords(),
      ),
    ).toThrow(/source material/);
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
    const rowWithQuery = ledger.rows.find((row) =>
      row.evidence.some((item) => item.kind === 'readiness-artifact'),
    );
    if (!rowWithQuery) throw new Error('fixture needs readiness row');
    const readiness = rowWithQuery.evidence.find(
      (item) => item.kind === 'readiness-artifact',
    );
    if (readiness?.kind !== 'readiness-artifact')
      throw new Error('fixture needs readiness evidence');
    expect(() =>
      validateBootstrapCapabilityLedger(
        {
          ...ledger,
          rows: ledger.rows.map((row) =>
            row === rowWithQuery
              ? {
                  ...row,
                  evidence: [
                    ...row.evidence,
                    {
                      ...readiness,
                      evidenceId: 'ev:::SRD5.1:::duplicate:::readiness-hook',
                    },
                  ],
                }
              : row,
          ),
        },
        { checkBeads: false },
      ),
    ).toThrow(/repeats queryId/);

    const rowWithProjection = ledger.rows.find((row) =>
      row.evidence.some((item) => item.kind === 'known-missing-source-clause'),
    );
    if (!rowWithProjection) throw new Error('fixture needs projection row');
    const projection = rowWithProjection.evidence.find(
      (item) => item.kind === 'known-missing-source-clause',
    );
    if (projection?.kind !== 'known-missing-source-clause')
      throw new Error('fixture needs projection evidence');
    expect(() =>
      validateBootstrapCapabilityLedger(
        {
          ...ledger,
          rows: ledger.rows.map((row) =>
            row === rowWithProjection
              ? {
                  ...row,
                  evidence: [
                    ...row.evidence,
                    {
                      ...projection,
                      evidenceId: 'ev:::duplicate:::projection:::2',
                      obligationId: projection.obligationId.replace(
                        ':::action-economy',
                        ':::branch',
                      ),
                    },
                  ],
                }
              : row,
          ),
        },
        { checkBeads: false },
      ),
    ).toThrow(/repeats queryId/);
  });

  it('binds each owned row owner to resolving bead evidence', () => {
    const ledger = loadBootstrapCapabilityLedger();
    expect(() =>
      validateBootstrapCapabilityLedger(
        {
          ...ledger,
          rows: ledger.rows.map((row, index) =>
            index === 0
              ? {
                  ...row,
                  owningBead: 'eshyra-o9bd.19.5.3',
                }
              : row,
          ),
        },
        { checkBeads: false },
      ),
    ).toThrow(/bound to bead evidence/);
  });

  it('rejects empty obligation identity segments', () => {
    const ledger = loadBootstrapCapabilityLedger();
    expect(() =>
      validateBootstrapCapabilityLedger(
        {
          ...ledger,
          rows: ledger.rows.map((row, index) =>
            index === 0
              ? {
                  ...row,
                  evidence: row.evidence.map((item, itemIndex) =>
                    itemIndex === 0
                      ? {
                          ...item,
                          evidenceId: 'ev:::SRD5.1::::::readiness-hook',
                        }
                      : item,
                  ),
                }
              : row,
          ),
        },
        { checkBeads: false },
      ),
    ).toThrow(/evidenceId|namespace|four non-empty segments|malformed/);
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
