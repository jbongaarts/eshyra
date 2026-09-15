import { CONDITION_RELATION_VALUES } from './conditionRelations.js';
import { walkFieldPointers } from './fieldProvenance.js';
import { normalizeRulesRecordName } from './stack.js';
import {
  RULES_RECORD_KINDS,
  RulesPackError,
  type RulesRecord,
  type RulesRecordKind,
} from './types.js';

/**
 * Pack-owned relationship declarations. This replaces the consumer-side
 * field allowlist: a field name alone cannot say whether a value is a link.
 * There is intentionally no default disposition; an unmatched lookup makes
 * no claim, while a declared `not-a-reference` is an explicit, reviewable
 * negative disposition.
 *
 * Declarations resolve per PRODUCING PACK, never for a whole resolved stack:
 * a manifest attests only the semantics its own producer authored, so an
 * add-on, override, or foreign pack that merely reuses a field name a
 * declaration matches is never interpreted under someone else's meaning (see
 * `discovery/types.ts`'s `RecordRelationshipManifestSource`). A resolved
 * record's producer is `RulesStackRecordEntry.pack` — the WINNING entry for
 * an override; `overrideChain` holds the losers and carries no semantics of
 * its own.
 *
 * `resolveRecordRelationships` resolves every DECLARED `reference` occurrence
 * to exactly one typed outcome: `resolved`, `unresolved-target` (a well-formed
 * value naming an absent or ambiguous target), or `indeterminate` (the
 * declared occurrence's own emitted data could not be read at all — see that
 * outcome's doc comment). None of the three is ever a silent empty result:
 * an occurrence this module cannot resolve is retained and typed, never
 * dropped.
 */
export type RelationshipDisposition = 'reference' | 'not-a-reference';
export type RelationshipTargetResolution = 'record-key' | 'record-name';

export interface RecordRelationshipDeclaration {
  readonly kind: RulesRecordKind;
  readonly pointerPrefix: string;
  readonly linkField: string;
  readonly disposition: RelationshipDisposition;
  readonly relation?: string;
  readonly targetResolution?: RelationshipTargetResolution;
  readonly targetKind?: RulesRecordKind;
  /**
   * For `record-name` resolution only: the sibling key, beside the matched
   * leaf, that carries this occurrence's own relation. Declared rather than
   * assumed, because the alternative is re-deriving it from the pointer
   * string (`/condition` -> `/relation`), which is the same undeclared
   * consumer-side coupling this module exists to delete — and it fails
   * SILENTLY, since an unreadable relation is skipped as a data-validity
   * case. Required exactly when `targetResolution` is `record-name`.
   */
  readonly relationField?: string;
  readonly reason: string;
}

export const RECORD_RELATIONSHIP_SCHEMA = 'record-relationships-v1';
export interface RecordRelationshipManifest {
  readonly schema: typeof RECORD_RELATIONSHIP_SCHEMA;
  readonly declarations: readonly RecordRelationshipDeclaration[];
}

export class RecordRelationshipError extends RulesPackError {}

function assertPointer(prefix: string, where: string): void {
  if (
    prefix.length === 0 ||
    !prefix.startsWith('/') ||
    prefix.endsWith('/') ||
    prefix.includes('//')
  )
    throw new RecordRelationshipError(
      `${where}.pointerPrefix ${JSON.stringify(prefix)} is malformed`,
    );
}

export function buildRecordRelationshipManifest(
  declarations: readonly RecordRelationshipDeclaration[],
): RecordRelationshipManifest {
  const seen = new Set<string>();
  declarations.forEach((decl, i) => {
    const where = `declarations[${i}]`;
    if (!RULES_RECORD_KINDS.includes(decl.kind))
      throw new RecordRelationshipError(
        `${where}.kind ${JSON.stringify(decl.kind)} is not a known RulesRecordKind`,
      );
    if (
      decl.disposition !== 'reference' &&
      decl.disposition !== 'not-a-reference'
    )
      throw new RecordRelationshipError(`${where}.disposition is invalid`);
    if (
      decl.targetResolution !== undefined &&
      decl.targetResolution !== 'record-key' &&
      decl.targetResolution !== 'record-name'
    )
      throw new RecordRelationshipError(`${where}.targetResolution is invalid`);
    assertPointer(decl.pointerPrefix, where);
    if (decl.reason.trim() === '')
      throw new RecordRelationshipError(`${where}.reason must not be empty`);
    if (decl.linkField.trim() === '')
      throw new RecordRelationshipError(`${where}.linkField must not be empty`);
    if (
      decl.disposition === 'not-a-reference' &&
      (decl.relation !== undefined ||
        decl.targetResolution !== undefined ||
        decl.targetKind !== undefined ||
        decl.relationField !== undefined)
    )
      throw new RecordRelationshipError(
        `${where}: not-a-reference cannot carry relationship fields`,
      );
    if (
      decl.disposition === 'reference' &&
      (decl.relation === undefined ||
        decl.relation.trim() === '' ||
        decl.targetResolution === undefined)
    )
      throw new RecordRelationshipError(
        `${where}: reference requires relation and targetResolution`,
      );
    if (
      decl.targetResolution === 'record-name' &&
      decl.targetKind === undefined
    )
      throw new RecordRelationshipError(
        `${where}: record-name requires targetKind`,
      );
    // `targetKind` is used at resolution time as `as RulesRecordKind`
    // (`resolveRecordRelationships`'s `record-name` branch) to index into
    // `RelationshipIndex.recordsByKind`, a `Map` keyed by the real
    // `RulesRecordKind` union. An unvalidated `targetKind` is not a type
    // error there — a `Map.get` on an unknown key just returns `undefined`,
    // which is EXACTLY the shape of a legitimate "no record with this name"
    // miss. So a typo'd `targetKind` would not fail the build; it would
    // silently masquerade as every occurrence's target being absent, forever.
    // Validating it here, alongside `kind`, is what makes that impossible.
    if (
      decl.targetKind !== undefined &&
      !RULES_RECORD_KINDS.includes(decl.targetKind)
    )
      throw new RecordRelationshipError(
        `${where}.targetKind ${JSON.stringify(decl.targetKind)} is not a known RulesRecordKind`,
      );
    if (
      decl.targetResolution === 'record-name' &&
      (decl.relationField === undefined ||
        decl.relationField.trim() === '' ||
        decl.relationField.includes('/'))
    )
      throw new RecordRelationshipError(
        `${where}: record-name requires a non-empty relationField naming a ` +
          'single sibling key',
      );
    if (
      decl.targetResolution === 'record-key' &&
      decl.relationField !== undefined
    )
      throw new RecordRelationshipError(
        `${where}: record-key cannot carry relationField`,
      );
    if (decl.targetResolution === 'record-key' && decl.targetKind !== undefined)
      throw new RecordRelationshipError(
        `${where}: record-key cannot carry targetKind`,
      );
    const identity = `${decl.kind}${decl.pointerPrefix}`;
    if (seen.has(identity))
      throw new RecordRelationshipError(
        `${where}: duplicate declaration for (${decl.kind}, ${decl.pointerPrefix})`,
      );
    seen.add(identity);
  });
  return { schema: RECORD_RELATIONSHIP_SCHEMA, declarations };
}

export function relationshipDeclarationForPointer(
  manifest: RecordRelationshipManifest,
  kind: RulesRecordKind,
  pointer: string,
): RecordRelationshipDeclaration | undefined {
  let best: RecordRelationshipDeclaration | undefined;
  let bestSegments = -1;
  for (const declaration of manifest.declarations) {
    if (declaration.kind !== kind) continue;
    if (
      pointer !== declaration.pointerPrefix &&
      !pointer.startsWith(`${declaration.pointerPrefix}/`)
    )
      continue;
    const segments = declaration.pointerPrefix.split('/').length;
    if (segments > bestSegments) {
      best = declaration;
      bestSegments = segments;
    }
  }
  return best;
}

export type RelationshipResolution =
  | {
      readonly outcome: 'resolved';
      readonly sourceRecordKey: string;
      readonly pointer: string;
      readonly relation: string;
      readonly targetRecordKey: string;
      readonly declaration: RecordRelationshipDeclaration;
    }
  | {
      readonly outcome: 'unresolved-target';
      readonly sourceRecordKey: string;
      readonly pointer: string;
      readonly relation: string;
      readonly rawValue: string;
      readonly reason:
        | 'no-record-with-key'
        | 'no-record-with-name'
        | 'ambiguous-name';
      readonly declaration: RecordRelationshipDeclaration;
    }
  | {
      /**
       * A declared `reference` occurrence whose own emitted DATA is malformed
       * — not a claim about the target. This replaces two silent `return`s
       * that used to make the occurrence vanish from the result entirely: a
       * non-string value at the declared pointer, and — for `record-name`
       * resolution — a relation sibling that is missing, not a string, or not
       * a recognized `CONDITION_RELATION_VALUES` member. Every one of those
       * was previously indistinguishable from "this pointer was never
       * declared", which is the exact fail-open this module exists to close
       * (see the module doc comment). `indeterminate` says the declaration
       * fired and the DATA, not the manifest, is what could not be read.
       */
      readonly outcome: 'indeterminate';
      readonly sourceRecordKey: string;
      readonly pointer: string;
      readonly reason:
        | 'value-not-a-string'
        | 'relation-sibling-missing'
        | 'relation-sibling-not-a-string'
        | 'relation-not-recognized';
      /** The offending raw value, when one exists to show — absent for
       * `relation-sibling-missing`, where there is no value to name. */
      readonly rawValue?: unknown;
      readonly declaration: RecordRelationshipDeclaration;
    };

export interface RelationshipIndex {
  readonly recordsByKey: ReadonlyMap<string, { readonly record: RulesRecord }>;
  readonly recordsByKind: ReadonlyMap<
    RulesRecordKind,
    {
      readonly byName: ReadonlyMap<
        string,
        readonly { readonly record: RulesRecord }[]
      >;
    }
  >;
}

function valueAtActualPointer(data: unknown, pointer: string): unknown {
  let current = data;
  for (const segment of pointer.split('/').slice(1)) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function resolveRecordRelationships(
  manifest: RecordRelationshipManifest,
  record: RulesRecord,
  index: RelationshipIndex,
): readonly RelationshipResolution[] {
  const resolutions: RelationshipResolution[] = [];
  walkFieldPointers(record.data, (pointer, value, actualPointer) => {
    const declaration = relationshipDeclarationForPointer(
      manifest,
      record.kind,
      pointer,
    );
    if (declaration?.disposition !== 'reference') return;
    // A DECLARED reference whose emitted value is not a string used to
    // return here silently — the occurrence vanished from the result exactly
    // as if nothing had been declared for this pointer at all. That is the
    // fail-open this module exists to close (see the module doc comment and
    // the `indeterminate` outcome's doc comment): every declared occurrence
    // now yields a typed outcome, positive, negative, or indeterminate, never
    // nothing.
    if (typeof value !== 'string') {
      resolutions.push({
        outcome: 'indeterminate',
        sourceRecordKey: record.key,
        pointer,
        reason: 'value-not-a-string',
        rawValue: value,
        declaration,
      });
      return;
    }
    let relation = declaration.relation as string;
    if (declaration.targetResolution === 'record-name') {
      // The sibling the DECLARATION names, not a pointer-string rewrite.
      const entry = valueAtActualPointer(
        record.data,
        `${actualPointer.slice(0, actualPointer.lastIndexOf('/'))}/${declaration.relationField as string}`,
      );
      if (entry === undefined) {
        resolutions.push({
          outcome: 'indeterminate',
          sourceRecordKey: record.key,
          pointer,
          reason: 'relation-sibling-missing',
          declaration,
        });
        return;
      }
      if (typeof entry !== 'string') {
        resolutions.push({
          outcome: 'indeterminate',
          sourceRecordKey: record.key,
          pointer,
          reason: 'relation-sibling-not-a-string',
          rawValue: entry,
          declaration,
        });
        return;
      }
      if (!CONDITION_RELATION_VALUES.includes(entry as never)) {
        resolutions.push({
          outcome: 'indeterminate',
          sourceRecordKey: record.key,
          pointer,
          reason: 'relation-not-recognized',
          rawValue: entry,
          declaration,
        });
        return;
      }
      relation = entry;
    }
    if (declaration.targetResolution === 'record-key') {
      const target = index.recordsByKey.get(value);
      resolutions.push(
        target === undefined
          ? {
              outcome: 'unresolved-target',
              sourceRecordKey: record.key,
              pointer,
              relation,
              rawValue: value,
              reason: 'no-record-with-key',
              declaration,
            }
          : {
              outcome: 'resolved',
              sourceRecordKey: record.key,
              pointer,
              relation,
              targetRecordKey: target.record.key,
              declaration,
            },
      );
      return;
    }
    const matches =
      index.recordsByKind
        .get(declaration.targetKind as RulesRecordKind)
        ?.byName.get(normalizeRulesRecordName(value)) ?? [];
    resolutions.push(
      matches.length === 1
        ? {
            outcome: 'resolved',
            sourceRecordKey: record.key,
            pointer,
            relation,
            targetRecordKey: matches[0].record.key,
            declaration,
          }
        : {
            outcome: 'unresolved-target',
            sourceRecordKey: record.key,
            pointer,
            relation,
            rawValue: value,
            reason:
              matches.length === 0 ? 'no-record-with-name' : 'ambiguous-name',
            declaration,
          },
    );
  });
  return resolutions;
}

export function assertRecordRelationshipDeclarationsAreLive(
  records: readonly RulesRecord[],
  manifest: RecordRelationshipManifest,
): void {
  const live = new Set<string>();
  for (const record of records)
    walkFieldPointers(record.data, (pointer) => {
      const declaration = relationshipDeclarationForPointer(
        manifest,
        record.kind,
        pointer,
      );
      if (declaration)
        live.add(`${declaration.kind}${declaration.pointerPrefix}`);
    });
  const dead = manifest.declarations.filter(
    (decl) => !live.has(`${decl.kind}${decl.pointerPrefix}`),
  );
  if (dead.length > 0)
    throw new RecordRelationshipError(
      `record relationship declaration(s) never match an emitted leaf: ${dead.map((d) => `(${d.kind}, ${d.pointerPrefix})`).join(', ')}`,
    );
}

/**
 * The bounded pointer SHAPES `discovery/expansion.ts`'s deleted `directLinks`
 * consumer allowlist used to hardcode as traversable, independent of
 * `RulesRecordKind` — `/source` was traversed identically whether the record
 * was a `feature` or an `ancestry`, which is exactly the confusion this
 * manifest was built to end (see the module doc comment). Fixed, and
 * deliberately NOT derived from any `RecordRelationshipManifest` under test:
 * the whole point of {@link assertRecordRelationshipDeclarationsCoverBoundedShapes}
 * is to catch a manifest that silently stopped declaring one of these for a
 * kind that now emits it, which a contract read back out of that same
 * manifest could never detect.
 *
 * Bounded on purpose. This is a claim about these seven historical shapes
 * only, never about `RulesRecord.data` as a whole — ADR 0020 forbids that
 * corpus-wide coverage claim.
 */
export const LEGACY_RELATIONSHIP_BEARING_POINTER_SHAPES: readonly string[] = [
  '/source',
  '/parentClass',
  '/progressionTableRef',
  '/tableRefs/*',
  '/spellTableRefs/*',
  '/statBlockRefs/*',
  '/mechanics/conditions/*/condition',
];

/**
 * The coverage gate's OTHER direction.
 * {@link assertRecordRelationshipDeclarationsAreLive} catches a declaration
 * that matches nothing emitted; this catches the reverse — an EMITTED leaf,
 * at one of the bounded {@link LEGACY_RELATIONSHIP_BEARING_POINTER_SHAPES},
 * for a `(kind, pointer)` pair the manifest never declares.
 *
 * Without this direction, a future importer change emitting one of these
 * shapes under a kind nobody declared would pass every existing check — no
 * declaration goes dead, because none was ever added for that kind — and
 * `resolveRecordRelationships` would classify the new occurrence as nothing:
 * not `reference`, not `not-a-reference`, just absent from every declaration
 * lookup. That is the identical fail-open this manifest exists to replace,
 * reopened at a boundary the first direction cannot see. A silent default
 * here (treating an undeclared bounded shape as `not-a-reference`, say) would
 * recreate it under a different name, so this throws instead.
 *
 * Deliberately narrow: this asserts coverage of the seven shapes above only.
 * It is not, and must never become, a coverage claim over `RulesRecord.data`
 * as a whole (ADR 0020 rejects that global negative).
 */
export function assertRecordRelationshipDeclarationsCoverBoundedShapes(
  records: readonly RulesRecord[],
  manifest: RecordRelationshipManifest,
): void {
  const undeclared = new Set<string>();
  for (const record of records)
    walkFieldPointers(record.data, (pointer) => {
      if (!LEGACY_RELATIONSHIP_BEARING_POINTER_SHAPES.includes(pointer)) return;
      if (
        relationshipDeclarationForPointer(manifest, record.kind, pointer) ===
        undefined
      )
        undeclared.add(`${record.kind}${pointer}`);
    });
  if (undeclared.size > 0)
    throw new RecordRelationshipError(
      'record relationship declaration(s) missing for bounded legacy ' +
        `pointer shape(s): ${[...undeclared].sort().join(', ')}`,
    );
}
