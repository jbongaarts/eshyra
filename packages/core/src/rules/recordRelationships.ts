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
    if (declaration?.disposition !== 'reference' || typeof value !== 'string')
      return;
    let relation = declaration.relation as string;
    if (declaration.targetResolution === 'record-name') {
      // The sibling the DECLARATION names, not a pointer-string rewrite.
      const entry = valueAtActualPointer(
        record.data,
        `${actualPointer.slice(0, actualPointer.lastIndexOf('/'))}/${declaration.relationField as string}`,
      );
      if (
        typeof entry !== 'string' ||
        !CONDITION_RELATION_VALUES.includes(entry as never)
      )
        return;
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
