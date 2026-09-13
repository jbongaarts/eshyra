/**
 * Structural (semantic) equality and canonical keying for discovery
 * measurements and stage bookkeeping.
 *
 * These exist because JavaScript object INSERTION ORDER must never decide
 * whether two pieces of evidence agree. `JSON.stringify(a) === JSON.stringify(b)`
 * compares encodings, not values: `{a: 1, b: 2}` and `{b: 2, a: 1}` are the
 * same fact and serialize to different text. An earlier repair corrected M12's
 * argument comparison this way but left the general helper behind, so M4
 * (relationship traversal) and M9 (`typedPath` expected value) still measured
 * semantic agreement by encoding (PR #543 re-review finding 2). One definition
 * lives here so a third consumer cannot reintroduce a competing one.
 *
 * The two functions answer different questions and are not interchangeable:
 * {@link deepEqual} compares a PAIR of values; {@link canonicalKey} produces a
 * stable string for keying a `Set` or `Map`, where pairwise comparison would
 * turn an O(n) membership test into an O(n²) scan.
 *
 * NOT every `JSON.stringify` in discovery is this defect. Serializing a fixed
 * tuple of primitives the caller itself authored in a fixed order (route
 * identity, stage accounting keys) has no key-order freedom to get wrong, and
 * a byte-identity check that deliberately means "are these the same bytes"
 * (the add-on override discriminator in `blockerRepairs.ts`) is not a semantic
 * comparison at all. Those are left alone on purpose.
 */

/**
 * Deep structural equality.
 *
 * - Objects: key-order-independent — same key set, each value deep-equal.
 * - Arrays: order- AND length-significant. An array is a sequence, not a set,
 *   so `[1, 2]` and `[2, 1]` disagree, as do arrays of different length.
 * - Primitives: exact, via `Object.is`, which keeps `null` and `undefined`
 *   distinct (asserting a field is explicitly `null` is a different claim than
 *   being silent about it) and treats `NaN` as equal to itself unlike `===`.
 *
 * Exact at every level once a value is being compared — never a subset match.
 * A caller that wants a subset rule applies it at its own top level and does
 * not get one for free inside nested objects.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (
    typeof a !== 'object' ||
    a === null ||
    typeof b !== 'object' ||
    b === null
  )
    return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  return aKeys.every(
    (key) =>
      Object.hasOwn(bRecord, key) && deepEqual(aRecord[key], bRecord[key]),
  );
}

/**
 * A stable string for `Set`/`Map` keying that agrees with {@link deepEqual}:
 * object keys are emitted in sorted order at every depth, so two values that
 * are deep-equal produce the same key regardless of how they were built.
 *
 * Array order is preserved, matching `deepEqual`'s treatment of arrays as
 * sequences.
 */
export function canonicalKey(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalKey(item)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalKey(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/**
 * Deep structural equality ACROSS the record/partition container boundary: an
 * array and an index map carrying the same index→value mapping are equal,
 * everything else is compared exactly as {@link deepEqual} compares it.
 *
 * A classified partition represents what was an array in the record as an
 * INDEX MAP — an object keyed by the indices that contributed to that class —
 * because a JSON array cannot express a hole and any filler value is itself a
 * legal rules value (`discovery/packet.ts`, PR #543 re-review round 5, finding
 * 2). M9's `typedPath` facts are stated in the RECORD's shape (the fixture
 * corpus validates every `expectedValue` against the record itself), so the
 * two sides of that one comparison are the same fact written in two container
 * forms, and the comparison normalizes both rather than reporting a false
 * disagreement about representation.
 *
 * Index IDENTITY is still what is compared, so this is not a loosening: an
 * index map missing index 1 does not equal a 3-element array, and an element
 * belonging to another provenance class is absent rather than `null` — which
 * is exactly what lets an `expectedValue: null` fact mean a real `null` in the
 * record and nothing else.
 *
 * Deliberately NOT used by M4 or M12: a traversal record and a tool-argument
 * value are not partitions of anything, and there an array must stay distinct
 * from an object.
 */
export function partitionEqual(a: unknown, b: unknown): boolean {
  return deepEqual(indexMapped(a), indexMapped(b));
}

/** An array as the index map a partition would carry for it, recursively;
 * every other value unchanged. */
function indexMapped(value: unknown): unknown {
  if (Array.isArray(value))
    return Object.fromEntries(
      value.map((item, index) => [String(index), indexMapped(item)]),
    );
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).map((key) => [key, indexMapped(record[key])]),
    );
  }
  return value;
}
