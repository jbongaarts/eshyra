import { describe, expect, it } from 'vitest';
import type { PacketCandidate, RulesRecord } from '../../src/internal.js';
import {
  buildContextPacket,
  bundledDnd5eSrdFieldProvenanceSource,
  getBundledDnd5eSrdPack,
  measureDiscovery,
  projectDiscoveryTrace,
  resolveRulesStack,
  retainCandidates,
  runDiscoveryStages,
} from '../../src/internal.js';
import { freshDbWithSession } from '../support/db.js';

/**
 * PR #543 re-review round 5, finding 2: partitioning a record body into its
 * declared provenance classes may not MANUFACTURE a value.
 *
 * The previous revision held array positions by pushing a literal `null` into
 * every index that belonged to another class. `null` is a legal
 * `FieldProvenanceLeaf` and a legal rules value, so that padding was
 * indistinguishable from a record that really carries `null` there — in the
 * rendered leaf lines, in the durable evidence, and in M9, which matched an
 * `expectedValue: null` fact against it.
 *
 * These cases attack the REPRESENTATION: what a bucket may contain, and what
 * absence looks like. They use the real pack's own mixed-class arrays and its
 * six real `null` leaves rather than synthetic shapes, so nothing here passes
 * because a fixture was drawn to fit.
 */

/** A record body's leaves, addressed by the JSON pointer that reaches them. */
function leavesOf(value: unknown, path: string, out: Map<string, unknown>) {
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value))
      leavesOf(child, `${path}/${key}`, out);
    return;
  }
  out.set(path, value);
}

function valueAt(root: unknown, pointer: string): unknown {
  return pointer
    .split('/')
    .slice(1)
    .reduce<unknown>(
      (value, key) =>
        value !== null && typeof value === 'object'
          ? (value as Record<string, unknown>)[key]
          : undefined,
      root,
    );
}

function candidatesFor(keys: readonly string[]): {
  candidates: readonly PacketCandidate[];
  records: ReadonlyMap<string, RulesRecord>;
} {
  const stack = resolveRulesStack({ base: getBundledDnd5eSrdPack() });
  const entries = keys.map((key) => {
    const entry = stack.recordsByKey.get(key);
    if (entry === undefined) throw new Error(`missing record ${key}`);
    return entry;
  });
  const trace = buildContextPacket(
    retainCandidates(
      entries.map((entry) => ({
        candidateKey: entry.record.key,
        targetKind: 'rules-record' as const,
        entry,
        routes: [
          {
            routeClass: 'explicit-name-or-alias' as const,
            trigger: 'test',
            evidence: {},
            signalId: 'signal-0',
          },
        ],
        traversals: [],
        campaignRules: [],
        campaignRulings: [],
      })),
    ),
    [],
    50_000_000,
    bundledDnd5eSrdFieldProvenanceSource(),
  );
  return {
    candidates: trace.packet.candidates,
    records: new Map(entries.map((entry) => [entry.record.key, entry.record])),
  };
}

const BUCKETS = [
  'sourceProse',
  'sourceDerived',
  'projection',
  'unattested',
] as const;

describe('a provenance partition never invents a leaf', () => {
  /**
   * The real mixed-class array the review's state space names: `ioun-stone`
   * has fourteen `Variant:` sidebars, and exactly one of them — "Awareness",
   * index 2 — carries no `mechanics`. Its `text` is `source-prose` and its
   * siblings' `mechanics` are `compiler-projection`, so the projection
   * partition of `/data/variants` genuinely has a hole at index 2.
   */
  it('carries a mixed-class array as an index map, with the absent class simply absent', () => {
    const { candidates, records } = candidatesFor(['magic-item:ioun-stone']);
    const candidate = candidates[0];
    const record = records.get('magic-item:ioun-stone');
    if (record === undefined) throw new Error('missing ioun-stone');
    const variants = (record.data as { variants: readonly unknown[] }).variants;
    expect(variants.length).toBe(14);
    expect((variants[2] as Record<string, unknown>).mechanics).toBeUndefined();

    const prose = valueAt(candidate.sourceProse, '/data/variants');
    const projection = valueAt(candidate.projection, '/data/variants');
    // Index identity, by key. Every variant contributes prose; all but the
    // one without `mechanics` contribute projection.
    expect(Object.keys(prose as object)).toEqual(
      Array.from({ length: 14 }, (_, index) => String(index)),
    );
    expect(Object.keys(projection as object)).toEqual(
      Array.from({ length: 14 }, (_, index) => String(index)).filter(
        (key) => key !== '2',
      ),
    );
    // The absent class is ABSENT — not `null`, which the previous revision
    // put here and which a reader could not tell from a real `null`.
    expect(Object.hasOwn(projection as object, '2')).toBe(false);
    expect(valueAt(candidate.projection, '/data/variants/2')).toBeUndefined();

    // Re-indexing did not happen: variant 3 is still at index 3 on both
    // sides, addressed by the same pointer as in the record.
    expect(valueAt(candidate.sourceProse, '/data/variants/3/name')).toBe(
      (variants[3] as { name: string }).name,
    );
    const variant3 = new Map<string, unknown>();
    leavesOf((variants[3] as { mechanics: unknown }).mechanics, '', variant3);
    expect(variant3.size).toBeGreaterThan(0);
    for (const [pointer, value] of variant3)
      expect(
        valueAt(candidate.projection, `/data/variants/3/mechanics${pointer}`),
      ).toEqual(value);
  });

  /**
   * The general claim, over the whole bundled corpus rather than the one
   * record above: every leaf in every bucket is a leaf the record really
   * carries, at the same pointer, with the same value.
   */
  it('classifies all 1812 bundled records without inventing or losing a leaf', () => {
    const pack = getBundledDnd5eSrdPack();
    const stack = resolveRulesStack({ base: pack });
    const entries = [...stack.recordsByKey.values()];
    let bucketLeaves = 0;
    let invented = 0;
    let lost = 0;
    let doubleClassified = 0;
    let partialArrays = 0;
    let paddingTheOldRuleWouldHaveMade = 0;

    for (let start = 0; start < entries.length; start += 100) {
      const batch = entries.slice(start, start + 100);
      const trace = buildContextPacket(
        retainCandidates(
          batch.map((entry) => ({
            candidateKey: entry.record.key,
            targetKind: 'rules-record' as const,
            entry,
            routes: [
              {
                routeClass: 'explicit-name-or-alias' as const,
                trigger: 'test',
                evidence: {},
                signalId: 'signal-0',
              },
            ],
            traversals: [],
            campaignRules: [],
            campaignRulings: [],
          })),
        ),
        [],
        500_000_000,
        bundledDnd5eSrdFieldProvenanceSource(),
      );
      for (const candidate of trace.packet.candidates) {
        const record = batch.find(
          (entry) => entry.record.key === candidate.identity.key,
        )?.record;
        const recordLeaves = new Map<string, unknown>();
        leavesOf({ data: record?.data }, '', recordLeaves);
        const placed = new Map<string, number>();
        for (const bucket of BUCKETS) {
          const bucketLeafMap = new Map<string, unknown>();
          leavesOf(candidate[bucket], '', bucketLeafMap);
          bucketLeaves += bucketLeafMap.size;
          for (const [pointer, value] of bucketLeafMap) {
            if (
              !recordLeaves.has(pointer) ||
              !Object.is(recordLeaves.get(pointer), value)
            )
              invented += 1;
            placed.set(pointer, (placed.get(pointer) ?? 0) + 1);
          }
          // How much padding the replaced rule would have produced here: one
          // manufactured `null` per index of a record array that did not
          // contribute to this class.
          const countPadding = (value: unknown, pointer: string): void => {
            if (value === null || typeof value !== 'object') return;
            const source = valueAt({ data: record?.data }, pointer);
            if (Array.isArray(source)) {
              const contributed = Object.keys(value).length;
              if (contributed < source.length) {
                partialArrays += 1;
                paddingTheOldRuleWouldHaveMade += source.length - contributed;
              }
            }
            for (const [key, child] of Object.entries(value))
              countPadding(child, `${pointer}/${key}`);
          };
          countPadding(candidate[bucket], '');
        }
        // The other direction: every leaf the record carries reached exactly
        // one bucket. Inventing nothing would be cheap if the partition were
        // allowed to drop material instead, which is the quieter failure the
        // unattested bucket exists to prevent.
        for (const pointer of recordLeaves.keys()) {
          const times = placed.get(pointer) ?? 0;
          if (times === 0) lost += 1;
          if (times > 1) doubleClassified += 1;
        }
      }
    }

    expect(entries.length).toBe(1812);
    expect(bucketLeaves).toBeGreaterThan(60_000);
    expect(invented).toBe(0);
    expect(lost).toBe(0);
    expect(doubleClassified).toBe(0);
    // Non-vacuous: the corpus really does contain partially classified
    // arrays, so the repaired rule is being exercised rather than trivially
    // satisfied by a corpus in which every array is single-class.
    expect(partialArrays).toBeGreaterThan(0);
    expect(paddingTheOldRuleWouldHaveMade).toBeGreaterThan(0);
  });

  /**
   * A leaf the record really carries as `null` stays `null`, in its own
   * class, and is reachable at its own pointer. The bundled pack contains
   * exactly six; `cube-of-force`'s unresolved ambiguity is one of them, and
   * is a probe candidate, so it also round-trips through the durable
   * evidence path in the intervention suite.
   */
  it('keeps a genuine record null, distinguishable from class absence', () => {
    const { candidates, records } = candidatesFor([
      'magic-item:cube-of-force',
      'magic-item:ioun-stone',
    ]);
    const cube = candidates.find(
      (item) => item.identity.key === 'magic-item:cube-of-force',
    );
    const pointer = '/data/mechanics/ambiguities/0/canonicalResolution';
    // It really is `null` in the record...
    expect(
      valueAt({ data: records.get('magic-item:cube-of-force')?.data }, pointer),
    ).toBeNull();
    // ...and it is `null` in the class that claims it, not missing.
    expect(valueAt(cube?.projection, pointer)).toBeNull();
    const projectionLeaves = new Map<string, unknown>();
    leavesOf(cube?.projection, '', projectionLeaves);
    expect(projectionLeaves.get(pointer)).toBeNull();

    // Class absence, by contrast, resolves to `undefined` — the two are no
    // longer the same value.
    const ioun = candidates.find(
      (item) => item.identity.key === 'magic-item:ioun-stone',
    );
    expect(valueAt(ioun?.projection, '/data/variants/2')).toBeUndefined();
  });

  /**
   * The measurement consequence, through the real M9 rather than by
   * inspecting a bucket: a fixture fact asserting `null` at a path matches a
   * real `null` and CANNOT be satisfied by a position that belongs to another
   * provenance class.
   */
  it('does not let M9 match an expectedValue of null against class absence', () => {
    const db = freshDbWithSession();
    try {
      const trace = runDiscoveryStages({
        db,
        scenario: {
          playerInput: 'the cube of force and the ioun stone',
          stateFields: {
            heldItem: 'magic-item:cube-of-force',
            otherItem: 'magic-item:ioun-stone',
          },
        },
      });
      const projected = projectDiscoveryTrace(trace);
      const real = {
        targetRef: 'magic-item:cube-of-force',
        typedPath: '/data/mechanics/ambiguities/0/canonicalResolution',
        expectedValue: null,
      };
      const absent = {
        targetRef: 'magic-item:ioun-stone',
        typedPath: '/data/variants/2/mechanics',
        expectedValue: null,
      };
      const measured = measureDiscovery(projected, {
        mustIncludeTargetRefs: [
          'magic-item:cube-of-force',
          'magic-item:ioun-stone',
        ],
        requiredFacts: [real, absent],
      });
      expect(measured.m9.measured).toBe(2);
      // Both candidates reached the packet, so neither fact can be "missing"
      // for the uninteresting reason.
      expect(measured.m1['magic-item:cube-of-force']).toBe(true);
      expect(measured.m1['magic-item:ioun-stone']).toBe(true);
      // The real null is found; the class-absent position is not.
      expect(measured.m9.missing).toEqual([absent]);
    } finally {
      db.close();
    }
  });

  /**
   * The durable boundary: the partition is JSON, and survives serialization
   * with its index identity and its absences intact. (The full SQLite path is
   * exercised for all thirteen probe executions in `packetIntervention.test.ts`,
   * where P10's M9 fact asserts an ARRAY expectation — `/data/components`
   * equals `['V','S','M']` — against a re-read partition.)
   */
  it('round-trips through JSON with index identity and absence preserved', () => {
    const { candidates } = candidatesFor(['magic-item:ioun-stone']);
    const candidate = candidates[0];
    const restored = JSON.parse(JSON.stringify(candidate)) as PacketCandidate;
    expect(restored).toEqual(candidate);
    const projection = valueAt(restored.projection, '/data/variants');
    expect(Object.hasOwn(projection as object, '2')).toBe(false);
    expect(Object.keys(projection as object)).toContain('3');
    const encoded = JSON.stringify(restored.projection);
    // The shape a JSON array cannot express is the reason for the index map:
    // no `null` was serialized to hold index 2.
    expect(encoded).not.toContain('null,');
  });
});
