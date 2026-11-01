import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildGate,
  type CapabilityLike,
  extractCitedPaths,
  gateCapabilities,
  gateFindingEvidence,
  gateRegistry,
  gateReplay,
  overallGateResult,
  parseVitestIncludePatterns,
} from '../scripts/create-dnd5e-srd-audit-bundle/candidateGates.js';

const INCLUDE = ['packages/**/test/**/*.test.ts'];
const ctx = (existing: string[]) => ({
  exists: (p: string) => existing.includes(p),
  includePatterns: INCLUDE,
});
const cap = (over: Partial<CapabilityLike> = {}): CapabilityLike => ({
  revision: 'x-v1',
  operation: 'does a thing',
  requiredInputs: [],
  exclusions: [],
  residualDmInterpretation: [],
  runtimeOwner: ['packages/core/src/a.ts'],
  evidence: ['packages/core/test/a.test.ts'],
  ...over,
});
const FILES = ['packages/core/src/a.ts', 'packages/core/test/a.test.ts'];

describe('candidate gate model', () => {
  const base = {
    id: 'G',
    observes: 'o',
    doesNotObserve: [],
    failures: [],
  };
  it('treats a zero denominator as failed-to-run, never pass', () => {
    const g = buildGate({
      ...base,
      denominator: { description: 'd', count: 0 },
    });
    expect(g.result).toBe('failed-to-run');
  });
  it('passes only with a non-empty denominator and no failures', () => {
    expect(
      buildGate({ ...base, denominator: { description: 'd', count: 2 } })
        .result,
    ).toBe('pass');
    expect(
      buildGate({
        ...base,
        failures: ['x'],
        denominator: { description: 'd', count: 2 },
      }).result,
    ).toBe('fail');
  });
  it('fails overall if any gate is not pass, or there are no gates', () => {
    const pass = buildGate({
      ...base,
      denominator: { description: 'd', count: 1 },
    });
    const ftr = buildGate({
      ...base,
      denominator: { description: 'd', count: 0 },
    });
    expect(overallGateResult([pass])).toBe('pass');
    expect(overallGateResult([pass, ftr])).toBe('fail');
    expect(overallGateResult([])).toBe('fail');
  });
});

describe('G-registry', () => {
  const registry = JSON.parse(
    readFileSync(
      new URL(
        '../../../docs/audits/dnd5e-srd-5.1-final/finding-registry.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { rows: Array<Record<string, unknown>> };
  it('passes on the committed registry', () => {
    const g = gateRegistry({ registry });
    expect(g.result).toBe('pass');
    expect(g.denominator.count).toBe(registry.rows.length);
  });
  it('fails on an unreasoned non-accepted row', () => {
    const rows = registry.rows.map((r) => ({ ...r }));
    const i = rows.findIndex((r) => r.status !== 'accepted');
    rows[i] = Object.fromEntries(
      Object.entries(rows[i] ?? {}).filter(([k]) => k !== 'statusReasoning'),
    );
    expect(gateRegistry({ registry: { ...registry, rows } }).result).toBe(
      'fail',
    );
  });
  it('fails on a malformed row', () => {
    const rows = registry.rows.map((r) => ({ ...r }));
    (rows[0] as Record<string, unknown>).status = 'bogus';
    expect(gateRegistry({ registry: { ...registry, rows } }).result).toBe(
      'fail',
    );
  });
});

describe('G-finding-evidence', () => {
  it('extracts root-anchored paths and trims punctuation', () => {
    expect(
      extractCitedPaths(
        'see packages/core/test/a.test.ts. and test/b.test.ts, docs/x.md',
      ),
    ).toEqual([
      'packages/core/test/a.test.ts',
      'packages/core/test/b.test.ts',
      'docs/x.md',
    ]);
  });
  it('passes when paths exist and lists unpointed rows without failing', () => {
    const g = gateFindingEvidence({
      rows: [
        { canonicalId: 'a', statusReasoning: 'packages/core/test/a.test.ts' },
        { canonicalId: 'b', statusReasoning: 'no path' },
      ],
      ctx: ctx(FILES),
    });
    expect(g.result).toBe('pass');
    expect(g.details.join('\n')).toContain('b: no committed evidence pointer');
  });
  it('fails on a missing path', () => {
    const g = gateFindingEvidence({
      rows: [
        { canonicalId: 'a', statusReasoning: 'packages/core/test/z.test.ts' },
      ],
      ctx: ctx(FILES),
    });
    expect(g.result).toBe('fail');
  });
  it('fails on a test file outside the include globs', () => {
    const g = gateFindingEvidence({
      rows: [{ canonicalId: 'a', statusReasoning: 'scripts/t.test.ts' }],
      ctx: ctx(['scripts/t.test.ts']),
    });
    expect(g.result).toBe('fail');
  });
  it('is failed-to-run when nothing is cited', () => {
    expect(
      gateFindingEvidence({
        rows: [{ canonicalId: 'a', statusReasoning: 'prose' }],
        ctx: ctx(FILES),
      }).result,
    ).toBe('failed-to-run');
  });
});

describe('G-capabilities', () => {
  it('passes with existing owner and evidence', () => {
    expect(
      gateCapabilities({ inventory: [cap()], contracts: [], ctx: ctx(FILES) })
        .result,
    ).toBe('pass');
  });
  it('fails on a missing owner or evidence path', () => {
    expect(
      gateCapabilities({
        inventory: [cap({ runtimeOwner: ['packages/core/src/gone.ts'] })],
        contracts: [],
        ctx: ctx(FILES),
      }).result,
    ).toBe('fail');
    expect(
      gateCapabilities({
        inventory: [],
        contracts: [cap({ evidence: ['packages/core/test/gone.test.ts'] })],
        ctx: ctx(FILES),
      }).result,
    ).toBe('fail');
  });
});

describe('G-replay', () => {
  it('is failed-to-run with no seeded entries', () => {
    expect(gateReplay({ inventory: [cap()], ctx: ctx(FILES) }).result).toBe(
      'failed-to-run',
    );
  });
  it('passes for a seeded entry with a test and fails without one', () => {
    const seeded = cap({ operation: 'Roll using seeded dice' });
    expect(gateReplay({ inventory: [seeded], ctx: ctx(FILES) }).result).toBe(
      'pass',
    );
    expect(
      gateReplay({
        inventory: [{ ...seeded, evidence: [] }],
        ctx: ctx(FILES),
      }).result,
    ).toBe('fail');
  });
});

describe('vitest include parsing', () => {
  it('reads the repo vitest.config.ts include globs', () => {
    const text = readFileSync(
      new URL('../../../vitest.config.ts', import.meta.url),
      'utf8',
    );
    expect(parseVitestIncludePatterns(text).length).toBeGreaterThan(0);
  });
});
