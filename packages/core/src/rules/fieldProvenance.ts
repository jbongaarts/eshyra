import {
  RULES_RECORD_KINDS,
  RulesPackError,
  type RulesRecord,
  type RulesRecordKind,
} from './types.js';

/**
 * Field-level provenance classification (eshyra-o9bd.19.1.3.1).
 *
 * The pack previously carried NO fact distinguishing literal source prose
 * from a parser's structured extraction from compiler-authored interpretive
 * material. Two consumer-side heuristics tried to reconstruct that fact from
 * the shape of `RulesRecord.data` alone (primitive JS type; declared
 * projection container) and both failed on real records — a JS `string` can
 * be a literal quote (`armorClass.sourceText`) OR a parsed token
 * (`armorClass.source`), and a value living inside a typed projection
 * container is not always interpretive (a table's raw `rows` are literal
 * cells, not a projection). The importer already knows which of its own
 * emitted values came from which stage; this module lets it SAY so as a pack
 * artifact, instead of leaving a consumer to guess from shape.
 *
 * ## The three classes
 *
 * - `source-prose` — literal text reproduced from the source. The only class
 *   a consumer may present as verbatim source authority.
 * - `source-derived` — deterministically parsed or computed from pinned
 *   source text. Truthful and attributable, but NOT verbatim (an armor
 *   class's numeric `value`, a creature's `hitPoints.formula`, a printed
 *   Speed line's `walk` entry).
 * - `compiler-projection` — interpretive or curated typed material authored
 *   by the compiler's curation stage (`mechanics`, `upcast`,
 *   `executionReadiness`, a table's `projection`, an item's `useProfile`). A
 *   literal-looking audit string embedded INSIDE one of these subtrees (e.g.
 *   `upcast.sourceCorrection.extractedSourcePhrase`) stays
 *   `compiler-projection`: it is lineage evidence attached to a compiler
 *   artifact, not a standalone quotable field, and splitting it out per-leaf
 *   would reintroduce the shape-based heuristics this module replaces.
 *
 * ## Declared per (kind, pointer prefix), not per record
 *
 * A record's `data` value is walked to every leaf (`string | number |
 * boolean | null`); each leaf gets a normalized JSON-pointer-shaped path
 * from `data`'s root, with every array index collapsed to the literal
 * segment `*` (so `actions[3].mechanics.damage[0].dice` and
 * `actions[7].mechanics.damage[2].dice` are the SAME declaration target:
 * `/actions/*\/mechanics/damage/*\/dice`). A `(kind, pointerPrefix)`
 * declaration classifies every pointer equal to, or nested under,
 * `pointerPrefix` for that record kind — so ONE declaration
 * (`creature`, `/traits/*\/mechanics`) covers the entire compiler-projection
 * subtree under every creature's every trait, without a separate entry per
 * leaf field name inside it. When two declared prefixes both match a
 * pointer, the DEEPER (more specific) one wins, which is what lets
 * `(creature, /armorClass)` classify the whole structured statline
 * `source-derived` while `(creature, /armorClass/sourceText)` overrides just
 * the one verbatim-quote leaf to `source-prose`.
 *
 * `records.json` is 7+ MB; this classification is identical across every
 * record of a kind, so it is emitted ONCE as its own small pack artifact
 * (`field-provenance.json`, see `packLoader.ts`) rather than duplicated
 * per record.
 *
 * ## The fail-closed gate
 *
 * `assertFieldProvenanceCoverage` is the deliverable, not the declaration
 * table: it walks every emitted record's real `data` and THROWS the moment a
 * leaf's pointer matches no declaration for that record's kind. Nothing in
 * `classifyFieldPointer` falls back to a default class when no declaration
 * matches — an unmatched lookup returns `undefined`, on purpose. A default
 * would recreate exactly the defect this bead exists to close: defaulting to
 * `source-prose` would let a future parsed/derived field masquerade as
 * verbatim source authority again (the original armor-class defect);
 * defaulting to `compiler-projection` would silently demote real prose a
 * parser starts emitting under a new field name. Every emitted field must be
 * classified by an explicit, reviewed decision, or the importer's build
 * fails — see `assertFieldProvenanceCoverage`.
 */
export type FieldProvenanceClass =
  | 'source-prose'
  | 'source-derived'
  | 'compiler-projection';

export const FIELD_PROVENANCE_CLASSES: readonly FieldProvenanceClass[] = [
  'source-prose',
  'source-derived',
  'compiler-projection',
];

/** File format tag for `field-provenance.json`; bump on an incompatible shape change. */
export const FIELD_PROVENANCE_SCHEMA = 'field-provenance-v1';

/**
 * One producer-declared classification for every leaf pointer at, or nested
 * under, `pointerPrefix` within a `kind` record's `data`.
 *
 * `reason` is required and non-empty: a classification table this large is
 * only reviewable if every entry says why it landed where it did (house
 * style — see the `types.ts` / `shadow.ts` doc-comment convention this
 * module follows). It is evidence for a human reviewer, not machine-checked
 * content.
 */
export interface FieldProvenanceDeclaration {
  readonly kind: RulesRecordKind;
  /**
   * A '/'-delimited path from the record's `data` root, e.g. `/armorClass` or
   * `/actions/*\/mechanics`. Every array index in a real pointer collapses to
   * the literal segment `*`. Must start with `/`, must not end with `/`, and
   * — deliberately — may not be the empty string: a blanket "everything
   * under this kind" declaration is exactly the silent default this module's
   * gate exists to forbid, just moved from code into data. Every top-level
   * field name a kind ever emits needs its OWN declaration (or a
   * `compiler-projection` root that already covers the whole subtree, e.g.
   * `mechanics`), so a brand-new top-level field the importer starts
   * emitting has nothing to inherit from and the gate stops the build.
   */
  readonly pointerPrefix: string;
  readonly class: FieldProvenanceClass;
  readonly reason: string;
}

export interface FieldProvenanceManifest {
  readonly schema: typeof FIELD_PROVENANCE_SCHEMA;
  readonly declarations: readonly FieldProvenanceDeclaration[];
}

export class FieldProvenanceError extends RulesPackError {}

function assertWellFormedPointerPrefix(prefix: string, where: string): void {
  if (prefix.length === 0) {
    throw new FieldProvenanceError(
      `${where}: pointerPrefix must not be empty — a blanket declaration ` +
        'defaults an entire kind to one class, which is the silent default ' +
        'this module forbids. Declare each top-level field explicitly.',
    );
  }
  if (!prefix.startsWith('/')) {
    throw new FieldProvenanceError(
      `${where}: pointerPrefix ${JSON.stringify(prefix)} must start with "/"`,
    );
  }
  if (prefix.endsWith('/')) {
    throw new FieldProvenanceError(
      `${where}: pointerPrefix ${JSON.stringify(prefix)} must not end with "/"`,
    );
  }
  if (prefix.includes('//')) {
    throw new FieldProvenanceError(
      `${where}: pointerPrefix ${JSON.stringify(prefix)} must not contain an empty segment`,
    );
  }
}

/**
 * Build (and validate) a manifest from a flat declaration list. Throws on a
 * malformed prefix, an unknown `class`/`kind`, or a duplicate
 * `(kind, pointerPrefix)` pair (which would make matching ambiguous and is
 * always an authoring mistake — the two declarations should be merged).
 */
export function buildFieldProvenanceManifest(
  declarations: readonly FieldProvenanceDeclaration[],
): FieldProvenanceManifest {
  const seen = new Set<string>();
  declarations.forEach((decl, i) => {
    const where = `declarations[${i}]`;
    if (!RULES_RECORD_KINDS.includes(decl.kind)) {
      throw new FieldProvenanceError(
        `${where}.kind ${JSON.stringify(decl.kind)} is not a known RulesRecordKind`,
      );
    }
    assertWellFormedPointerPrefix(decl.pointerPrefix, where);
    if (!FIELD_PROVENANCE_CLASSES.includes(decl.class)) {
      throw new FieldProvenanceError(
        `${where}.class ${JSON.stringify(decl.class)} must be one of ${FIELD_PROVENANCE_CLASSES.join(', ')}`,
      );
    }
    if (decl.reason.trim().length === 0) {
      throw new FieldProvenanceError(`${where}.reason must not be empty`);
    }
    const identity = `${decl.kind}${decl.pointerPrefix}`;
    if (seen.has(identity)) {
      throw new FieldProvenanceError(
        `${where}: duplicate declaration for (${decl.kind}, ${decl.pointerPrefix})`,
      );
    }
    seen.add(identity);
  });
  return { schema: FIELD_PROVENANCE_SCHEMA, declarations };
}

/**
 * Find the most specific declaration covering `pointer` for `kind`, or
 * `undefined` when none does. "Most specific" is the declaration with the
 * most '/'-delimited segments in `pointerPrefix`; a pointer matches a
 * declaration when the pointer IS the prefix, or the pointer continues past
 * the prefix at a `/` boundary (so `/armorClass` matches `/armorClass` and
 * `/armorClass/value` but not `/armorClassCondition`).
 *
 * Returns `undefined` on no match — deliberately. Callers that need a class
 * (the fail-closed gate) must treat `undefined` as a coverage failure, never
 * substitute a default; see the module doc comment.
 */
export function classifyFieldPointer(
  manifest: FieldProvenanceManifest,
  kind: RulesRecordKind,
  pointer: string,
): FieldProvenanceClass | undefined {
  let best: FieldProvenanceDeclaration | undefined;
  let bestSegments = -1;
  for (const decl of manifest.declarations) {
    if (decl.kind !== kind) continue;
    const prefix = decl.pointerPrefix;
    if (pointer !== prefix && !pointer.startsWith(`${prefix}/`)) continue;
    const segments = prefix.split('/').length;
    if (segments > bestSegments) {
      bestSegments = segments;
      best = decl;
    }
  }
  return best?.class;
}

/** A JSON leaf value: everything a `RulesRecord.data` walk can classify. */
export type FieldProvenanceLeaf = string | number | boolean | null;

function isLeafValue(value: unknown): value is FieldProvenanceLeaf {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/**
 * Walk every leaf value reachable from `data`, calling `visit` with its
 * normalized pointer (array indices collapsed to `*`) and the leaf value
 * itself. Containers (objects, arrays) are traversed but never visited in
 * their own right — only their leaves carry a provenance class, matching
 * how the DECIDED representation talks about "values", not "containers".
 * An empty array/object contributes no leaf and needs no declaration.
 */
export function walkFieldPointers(
  data: unknown,
  visit: (pointer: string, value: FieldProvenanceLeaf) => void,
  pointer = '',
): void {
  if (Array.isArray(data)) {
    for (const item of data) walkFieldPointers(item, visit, `${pointer}/*`);
    return;
  }
  if (data !== null && typeof data === 'object') {
    for (const [key, value] of Object.entries(
      data as Record<string, unknown>,
    )) {
      if (value === undefined) continue;
      walkFieldPointers(value, visit, `${pointer}/${key}`);
    }
    return;
  }
  if (pointer === '' || !isLeafValue(data)) return;
  visit(pointer, data);
}

/** Per-(kind, class) leaf counts, for the required "counts per class per kind" report (E2). */
export type FieldProvenanceCoverageSummary = ReadonlyMap<
  RulesRecordKind,
  Readonly<Record<FieldProvenanceClass, number>>
>;

function emptyClassCounts(): Record<FieldProvenanceClass, number> {
  return { 'source-prose': 0, 'source-derived': 0, 'compiler-projection': 0 };
}

/**
 * The fail-closed gate (eshyra-o9bd.19.1.3.1's deliverable). Walks every
 * emitted record's real `data` and throws the moment a leaf's pointer
 * resolves to no declared class for that record's kind — naming the record
 * and the exact pointer so the failure is actionable, not just "something is
 * uncovered". Call this over the FINAL emitted record set, before writing
 * output, so a future field that the importer starts emitting without an
 * accompanying declaration stops the build instead of shipping silently
 * unclassified.
 */
export function assertFieldProvenanceCoverage(
  records: readonly RulesRecord[],
  manifest: FieldProvenanceManifest,
): FieldProvenanceCoverageSummary {
  const summary = new Map<
    RulesRecordKind,
    Record<FieldProvenanceClass, number>
  >();
  const uncovered: string[] = [];
  for (const record of records) {
    walkFieldPointers(record.data, (pointer) => {
      const cls = classifyFieldPointer(manifest, record.kind, pointer);
      if (cls === undefined) {
        uncovered.push(`${record.kind}:${record.key}${pointer}`);
        return;
      }
      const counts = summary.get(record.kind) ?? emptyClassCounts();
      counts[cls] += 1;
      summary.set(record.kind, counts);
    });
  }
  if (uncovered.length > 0) {
    const shown = uncovered.slice(0, 25);
    const more =
      uncovered.length > shown.length
        ? `\n...and ${uncovered.length - shown.length} more`
        : '';
    throw new FieldProvenanceError(
      `field provenance is undeclared for ${uncovered.length} emitted value(s). ` +
        'An unclassified field is a build failure, never a default class ' +
        '(see fieldProvenance.ts). Add a (kind, pointerPrefix) declaration ' +
        `covering each of:\n${shown.join('\n')}${more}`,
    );
  }
  return summary;
}
