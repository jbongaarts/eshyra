/**
 * Loader for generated rules-pack artifacts stored on disk.
 *
 * ## Generated data layout
 *
 * Generated (and seed) rules-pack artifacts live under:
 *
 *   packages/core/data/rules-packs/<packId-safe>/
 *     manifest.json   — RulesPackMeta (minus `order` / `dependsOn`; those are
 *                       runtime-only and are not persisted to disk)
 *     records.json    — RulesRecord[]  (one flat array; importers may generate
 *                       this in any order; the loader sorts by `key` before
 *                       returning so output is always deterministic)
 *     field-provenance.json — OPTIONAL (eshyra-o9bd.19.1.3.1). A
 *                       `FieldProvenanceManifest` (see `fieldProvenance.ts`)
 *                       classifying which JSON-pointer subtrees of each
 *                       record kind's `data` are literal source prose,
 *                       deterministically source-derived, or compiler
 *                       projection. Not every pack ships one — only the D&D
 *                       5e SRD importer emits it today — so it is loaded by
 *                       the separate `loadFieldProvenanceManifest` below,
 *                       never by `loadRulesPackFromDirectory`: `RulesPack`
 *                       itself gains no new required field, so every
 *                       existing pack constructor (hand-built test packs,
 *                       the Pathfinder remaster stub, addon packs) keeps
 *                       working unchanged.
 *     record-relationships.json — OPTIONAL. Pack-owned declarations of
 *                       traversable relationships and explicit negative
 *                       dispositions, loaded separately by
 *                       `loadRecordRelationshipManifest`.
 *
 * `<packId-safe>` is the pack identifier with every `:` replaced by `__`
 * (double underscore) so the directory name is valid on all platforms
 * (Windows NTFS forbids `:` in file/directory names).  For example, the pack
 * `rules:dnd5e-srd-5.1` lives in `rules__dnd5e-srd-5.1/`.  The canonical
 * `packId` is stored inside `manifest.json`, not derived from the directory.
 * Pack IDs must not contain path separators.
 *
 * Both files are required.  `validateRulesPack` runs over the merged object so
 * all existing invariants (source xor identity, per-record provenance match,
 * per-kind shape checks) are enforced on every load.
 *
 * Release archives include this package's `data/` directory alongside `dist/`
 * so bundled seed packs are pre-populated for the CLI. The package manifest
 * also keeps `data/` in `files` for private/internal package artifacts.
 *
 * ## Loader guarantee
 *
 * Given identical files on disk, `loadRulesPackFromDirectory` always returns a
 * value that is deeply equal (same `packId`, same records in the same order,
 * same field values).  Stability is achieved by:
 *   1. Sorting records by `key` (lexicographic, UTF-16 code unit order) after
 *      parsing, before returning.
 *   2. `JSON.parse` preserves object-property insertion order in the supported
 *      Node 24 runtime, so per-field order within a record is stable across
 *      runs.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildFieldProvenanceManifest,
  FIELD_PROVENANCE_CLASSES,
  FIELD_PROVENANCE_SCHEMA,
  type FieldProvenanceDeclaration,
  type FieldProvenanceManifest,
} from './fieldProvenance.js';
import {
  buildRecordRelationshipManifest,
  RECORD_RELATIONSHIP_SCHEMA,
  type RecordRelationshipDeclaration,
  type RecordRelationshipManifest,
} from './recordRelationships.js';
import type { RulesPack, RulesRecordKind } from './types.js';
import { RULES_RECORD_KINDS, RulesPackError } from './types.js';
import { validateRulesPack } from './validate.js';

/** File names inside a generated pack directory. */
export const PACK_MANIFEST_FILE = 'manifest.json';
export const PACK_RECORDS_FILE = 'records.json';
/** See the `field-provenance.json` note in the module doc comment above. */
export const PACK_FIELD_PROVENANCE_FILE = 'field-provenance.json';
export const PACK_RECORD_RELATIONSHIPS_FILE = 'record-relationships.json';

/**
 * Load a generated rules pack from `dir`.
 *
 * `dir` must contain `manifest.json` (pack metadata) and `records.json`
 * (array of records).  Both files are parsed and merged, then passed through
 * `validateRulesPack`, which enforces all pack-level and record-level
 * invariants.  Records are sorted by `key` for deterministic output.
 *
 * Throws `RulesPackError` if either file is missing, unparseable, or fails
 * validation.
 */
export function loadRulesPackFromDirectory(dir: string): RulesPack {
  const manifestPath = join(dir, PACK_MANIFEST_FILE);
  const recordsPath = join(dir, PACK_RECORDS_FILE);

  let manifestJson: string;
  try {
    manifestJson = readFileSync(manifestPath, 'utf8');
  } catch (cause) {
    throw new RulesPackError(
      `rules pack manifest not found at ${manifestPath}: ${(cause as Error).message}`,
    );
  }

  let recordsJson: string;
  try {
    recordsJson = readFileSync(recordsPath, 'utf8');
  } catch (cause) {
    throw new RulesPackError(
      `rules pack records not found at ${recordsPath}: ${(cause as Error).message}`,
    );
  }

  let meta: unknown;
  try {
    meta = JSON.parse(manifestJson);
  } catch (cause) {
    throw new RulesPackError(
      `rules pack manifest at ${manifestPath} is not valid JSON: ${(cause as Error).message}`,
    );
  }

  let rawRecords: unknown;
  try {
    rawRecords = JSON.parse(recordsJson);
  } catch (cause) {
    throw new RulesPackError(
      `rules pack records at ${recordsPath} are not valid JSON: ${(cause as Error).message}`,
    );
  }

  // Sort records by key for deterministic output before validation so that
  // error messages from validateRulesPack reference indices in the final
  // (sorted) order.
  if (Array.isArray(rawRecords)) {
    rawRecords = [...rawRecords].sort((a, b) => {
      const ka =
        typeof a === 'object' && a !== null
          ? (a as Record<string, unknown>).key
          : undefined;
      const kb =
        typeof b === 'object' && b !== null
          ? (b as Record<string, unknown>).key
          : undefined;
      if (typeof ka === 'string' && typeof kb === 'string') {
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      }
      return 0;
    });
  }

  return validateRulesPack({ meta, records: rawRecords });
}

function parseFieldProvenanceDeclaration(
  value: unknown,
  path: string,
): FieldProvenanceDeclaration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesPackError(`${path} must be an object`);
  }
  const o = value as Record<string, unknown>;
  const kind = o.kind;
  if (
    typeof kind !== 'string' ||
    !RULES_RECORD_KINDS.includes(kind as RulesRecordKind)
  ) {
    throw new RulesPackError(`${path}.kind must be a known RulesRecordKind`);
  }
  const pointerPrefix = o.pointerPrefix;
  if (typeof pointerPrefix !== 'string' || pointerPrefix.length === 0) {
    throw new RulesPackError(
      `${path}.pointerPrefix must be a non-empty string`,
    );
  }
  const cls = o.class;
  if (
    typeof cls !== 'string' ||
    !(FIELD_PROVENANCE_CLASSES as readonly string[]).includes(cls)
  ) {
    throw new RulesPackError(
      `${path}.class must be one of ${FIELD_PROVENANCE_CLASSES.join(', ')}`,
    );
  }
  const reason = o.reason;
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new RulesPackError(`${path}.reason must be a non-empty string`);
  }
  return {
    kind: kind as RulesRecordKind,
    pointerPrefix,
    class: cls as FieldProvenanceDeclaration['class'],
    reason,
  };
}

/**
 * Load `field-provenance.json` from `dir`, when the pack ships one (see the
 * module doc comment). Throws `RulesPackError` if the file is missing,
 * unparseable, or fails shape/duplicate validation
 * (`buildFieldProvenanceManifest`, which also enforces the "no blanket
 * declaration" rule described on `FieldProvenanceDeclaration.pointerPrefix`).
 *
 * Callers that want to know whether a pack ships this artifact at all
 * (rather than treating its absence as an error) should check for the file
 * themselves before calling; this loader always requires it to be present at
 * `dir` once called, mirroring `loadRulesPackFromDirectory`'s treatment of
 * `manifest.json` / `records.json`.
 */
export function loadFieldProvenanceManifest(
  dir: string,
): FieldProvenanceManifest {
  const path = join(dir, PACK_FIELD_PROVENANCE_FILE);
  let json: string;
  try {
    json = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new RulesPackError(
      `field provenance manifest not found at ${path}: ${(cause as Error).message}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    throw new RulesPackError(
      `field provenance manifest at ${path} is not valid JSON: ${(cause as Error).message}`,
    );
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new RulesPackError(
      `field provenance manifest at ${path} must be an object`,
    );
  }
  const o = raw as Record<string, unknown>;
  if (o.schema !== FIELD_PROVENANCE_SCHEMA) {
    throw new RulesPackError(
      `field provenance manifest at ${path} has schema ${JSON.stringify(o.schema)}, expected ${JSON.stringify(FIELD_PROVENANCE_SCHEMA)}`,
    );
  }
  if (!Array.isArray(o.declarations)) {
    throw new RulesPackError(
      `field provenance manifest at ${path}.declarations must be an array`,
    );
  }
  const declarations = o.declarations.map((item, i) =>
    parseFieldProvenanceDeclaration(item, `${path}.declarations[${i}]`),
  );
  return buildFieldProvenanceManifest(declarations);
}

/**
 * Parse and field-validate one on-disk relationship declaration.
 *
 * Mirrors `parseFieldProvenanceDeclaration` above: every field is checked by
 * TYPE here, not merely cast. A blind `as unknown as RecordRelationshipDeclaration`
 * would let a malformed on-disk file (a `pointerPrefix` that is a number, a
 * `targetKind` that is not a real `RulesRecordKind`, ...) reach
 * `buildRecordRelationshipManifest`'s cross-field checks wearing the TYPE the
 * interface promises but not the shape — which either throws an unrelated
 * native `TypeError` well past the point of a clear diagnostic, or, worse,
 * degrades into a Map lookup miss that reads exactly like a legitimate
 * "no record with this name" result (see `RelationshipResolution`'s
 * `indeterminate` outcome doc comment for the same class of failure one layer
 * up). A malformed on-disk manifest must fail closed HERE, at the loader,
 * before it ever reaches a consumer.
 */
function parseRecordRelationshipDeclaration(
  value: unknown,
  path: string,
): RecordRelationshipDeclaration {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new RulesPackError(`${path} must be an object`);
  const o = value as Record<string, unknown>;
  const kind = o.kind;
  if (
    typeof kind !== 'string' ||
    !RULES_RECORD_KINDS.includes(kind as RulesRecordKind)
  )
    throw new RulesPackError(`${path}.kind must be a known RulesRecordKind`);
  const pointerPrefix = o.pointerPrefix;
  if (typeof pointerPrefix !== 'string' || pointerPrefix.length === 0)
    throw new RulesPackError(
      `${path}.pointerPrefix must be a non-empty string`,
    );
  const linkField = o.linkField;
  if (typeof linkField !== 'string' || linkField.length === 0)
    throw new RulesPackError(`${path}.linkField must be a non-empty string`);
  const disposition = o.disposition;
  if (disposition !== 'reference' && disposition !== 'not-a-reference')
    throw new RulesPackError(
      `${path}.disposition must be 'reference' or 'not-a-reference'`,
    );
  const relation = o.relation;
  if (relation !== undefined && typeof relation !== 'string')
    throw new RulesPackError(`${path}.relation must be a string when present`);
  const targetResolution = o.targetResolution;
  if (
    targetResolution !== undefined &&
    targetResolution !== 'record-key' &&
    targetResolution !== 'record-name'
  )
    throw new RulesPackError(
      `${path}.targetResolution must be 'record-key' or 'record-name' when present`,
    );
  const targetKind = o.targetKind;
  if (
    targetKind !== undefined &&
    (typeof targetKind !== 'string' ||
      !RULES_RECORD_KINDS.includes(targetKind as RulesRecordKind))
  )
    throw new RulesPackError(
      `${path}.targetKind must be a known RulesRecordKind when present`,
    );
  const relationField = o.relationField;
  if (relationField !== undefined && typeof relationField !== 'string')
    throw new RulesPackError(
      `${path}.relationField must be a string when present`,
    );
  const reason = o.reason;
  if (typeof reason !== 'string' || reason.trim().length === 0)
    throw new RulesPackError(`${path}.reason must be a non-empty string`);
  return {
    kind: kind as RulesRecordKind,
    pointerPrefix,
    linkField,
    disposition,
    ...(relation === undefined ? {} : { relation }),
    ...(targetResolution === undefined ? {} : { targetResolution }),
    ...(targetKind === undefined
      ? {}
      : { targetKind: targetKind as RulesRecordKind }),
    ...(relationField === undefined ? {} : { relationField }),
    reason,
  };
}

/**
 * Load the optional pack-owned relationship manifest, when the pack ships
 * one. Throws `RulesPackError` if the file exists but is unparseable, has an
 * unexpected schema, or fails shape/cross-field validation
 * (`parseRecordRelationshipDeclaration` and `buildRecordRelationshipManifest`).
 */
export function loadRecordRelationshipManifest(
  dir: string,
): RecordRelationshipManifest | undefined {
  const path = join(dir, PACK_RECORD_RELATIONSHIPS_FILE);
  if (!existsSync(path)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new RulesPackError(
      `record relationship manifest at ${path} is not valid JSON: ${(cause as Error).message}`,
    );
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new RulesPackError(
      `record relationship manifest at ${path} must be an object`,
    );
  const object = raw as Record<string, unknown>;
  if (object.schema !== RECORD_RELATIONSHIP_SCHEMA)
    throw new RulesPackError(
      `record relationship manifest at ${path} has an unexpected schema`,
    );
  if (!Array.isArray(object.declarations))
    throw new RulesPackError(
      `record relationship manifest at ${path}.declarations must be an array`,
    );
  const declarations = object.declarations.map((item, i) =>
    parseRecordRelationshipDeclaration(item, `${path}.declarations[${i}]`),
  );
  return buildRecordRelationshipManifest(declarations);
}
