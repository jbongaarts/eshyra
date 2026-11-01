import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildGate,
  type CapabilityLike,
  gateCapabilities,
  gateFindingEvidence,
  gateRegistry,
  gateReplay,
  overallGateResult,
  parseVitestListFiles,
  resolveCitation,
} from '../scripts/create-dnd5e-srd-audit-bundle/candidateGates.js';

const ctx = (existing: string[], membership: string[] | null = existing) => ({
  exists: (p: string) => existing.includes(p),
  trackedFiles: existing,
  membership: membership === null ? null : new Set(membership),
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
  it('fails on a missing path (unresolved citation, never dropped)', () => {
    const g = gateFindingEvidence({
      rows: [
        { canonicalId: 'a', statusReasoning: 'packages/core/test/z.test.ts' },
      ],
      ctx: ctx(FILES),
    });
    expect(g.result).toBe('fail');
    expect(g.denominator.count).toBe(1);
  });
  it('fails on a test file absent from the resolved membership', () => {
    const g = gateFindingEvidence({
      rows: [
        { canonicalId: 'a', statusReasoning: 'packages/core/test/a.test.ts' },
      ],
      ctx: ctx(FILES, ['packages/core/src/a.ts']),
    });
    expect(g.result).toBe('fail');
  });
  it('is failed-to-run when membership is unavailable', () => {
    const rows = [
      { canonicalId: 'a', statusReasoning: 'packages/core/test/a.test.ts' },
    ];
    expect(gateFindingEvidence({ rows, ctx: ctx(FILES, null) }).result).toBe(
      'failed-to-run',
    );
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

describe('citation resolution (forms a-e)', () => {
  const PACK = 'packages/core/data/rules-packs/rules__dnd5e-srd-5.1';
  const tracked = [
    'packages/core/test/root.test.ts',
    'packages/core/test/discovery/nested.test.ts',
    'packages/core/test/base.test.ts',
    'packages/core/test/dup.test.ts',
    'packages/cli/test/dup.test.ts',
    `${PACK}/records.json`,
    `${PACK}/manifest.json`,
    'other/records.json',
    'other/manifest.json',
  ];
  const cases: Array<[string, string, string, string]> = [
    [
      '(a) root-anchored',
      'packages/core/test/root.test.ts',
      'x',
      'packages/core/test/root.test.ts',
    ],
    [
      '(b) test/ shorthand',
      'test/base.test.ts',
      'x',
      'packages/core/test/base.test.ts',
    ],
    [
      '(c) nested shorthand',
      'discovery/nested.test.ts',
      'x',
      'packages/core/test/discovery/nested.test.ts',
    ],
    ['(c) basename', 'base.test.ts', 'x', 'packages/core/test/base.test.ts'],
    ['(d) pack artifact basename', 'records.json', 'x', `${PACK}/records.json`],
    [
      '(d) manifest with pack context',
      'manifest.json',
      'the pack manifest',
      `${PACK}/manifest.json`,
    ],
  ];
  for (const [name, token, reasoning, path] of cases) {
    it(`resolves ${name} and fails when the target is untracked`, () => {
      expect(resolveCitation(token, tracked, reasoning)).toEqual({
        token,
        status: 'resolved',
        path,
      });
      const without = tracked.filter((f) => f !== path);
      expect(resolveCitation(token, without, reasoning).status).not.toBe(
        'resolved',
      );
      const g = gateFindingEvidence({
        rows: [{ canonicalId: 'a', statusReasoning: `see ${token}.` }].map(
          (r) => ({ ...r, statusReasoning: `${reasoning} ${token}.` }),
        ),
        ctx: ctx(without),
      });
      expect(g.result).toBe('fail');
    });
  }
  it('(e) fails ambiguous and unresolved basenames and bare manifest.json', () => {
    expect(resolveCitation('dup.test.ts', tracked, 'x').status).toBe(
      'ambiguous',
    );
    expect(resolveCitation('nope.test.ts', tracked, 'x').status).toBe(
      'unresolved',
    );
    expect(resolveCitation('manifest.json', tracked, 'x').status).toBe(
      'ambiguous',
    );
  });
  it('gate fails on an ambiguous citation rather than dropping it', () => {
    const g = gateFindingEvidence({
      rows: [{ canonicalId: 'a', statusReasoning: 'dup.test.ts' }],
      ctx: ctx(tracked),
    });
    expect(g.result).toBe('fail');
    expect(g.details.join('\n')).toContain('ambiguous');
  });
});

describe('resolved vitest membership', () => {
  it('parses vitest list output into repo-relative paths', () => {
    const out = JSON.stringify([
      { file: '/repo/packages/core/test/a.test.ts' },
    ]);
    expect([...(parseVitestListFiles(out, '/repo') ?? [])]).toEqual([
      'packages/core/test/a.test.ts',
    ]);
  });
  it('returns null for empty or unparsable output', () => {
    expect(parseVitestListFiles('[]', '/repo')).toBeNull();
    expect(parseVitestListFiles('not json', '/repo')).toBeNull();
    expect(parseVitestListFiles('{"a":1}', '/repo')).toBeNull();
  });
  it('capabilities and replay fail when evidence is absent from membership, failed-to-run when unavailable', () => {
    const narrowed = ctx(FILES, ['packages/core/src/a.ts']);
    const seeded = cap({ operation: 'seeded roll' });
    expect(
      gateCapabilities({ inventory: [cap()], contracts: [], ctx: narrowed })
        .result,
    ).toBe('fail');
    expect(gateReplay({ inventory: [seeded], ctx: narrowed }).result).toBe(
      'fail',
    );
    const none = ctx(FILES, null);
    expect(
      gateCapabilities({ inventory: [cap()], contracts: [], ctx: none }).result,
    ).toBe('failed-to-run');
    expect(gateReplay({ inventory: [seeded], ctx: none }).result).toBe(
      'failed-to-run',
    );
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
