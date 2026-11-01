/**
 * The committed-pack artifacts `verify:dnd5e-srd-pack` compares against the
 * importer's regenerated output. The verifier and the audit bundle's G-repro
 * gate both read this list, so the gate's denominator cannot drift from what
 * the verifier actually compares.
 */

/** Compared via `diffPacks` over the loaded committed and regenerated packs. */
export const VERIFIED_PACK_RECORDS_ARTIFACT = 'records.json';

/** Byte-compared sibling artifacts (exact-match contract, exit 1 on drift). */
export const VERIFIED_PACK_SIBLING_ARTIFACTS: readonly string[] = [
  'source-inventory.json',
  'source-coverage.json',
  'source-region-ledger.json',
  'field-provenance.json',
  'record-relationships.json',
];

export const VERIFIED_PACK_ARTIFACTS: readonly string[] = [
  VERIFIED_PACK_RECORDS_ARTIFACT,
  ...VERIFIED_PACK_SIBLING_ARTIFACTS,
];
