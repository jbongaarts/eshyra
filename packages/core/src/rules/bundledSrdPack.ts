/**
 * Runtime loader for the bundled D&D 5e SRD 5.1 rules pack (ADR 0013).
 *
 * Gameplay resolves rules against the importer-generated SRD pack shipped under
 * `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/` — the audited, durable
 * rules product (1811 records: creatures, spells, classes, equipment,
 * magic-items, conditions, features, tables, …), NOT the retired three-record
 * in-code placeholder that predated the importer.
 *
 * The pack is loaded once and cached. The 1811-record parse cost is paid lazily
 * on first lookup, not at module load, so editions that never play (or never
 * look up a rule) do not pay it.
 *
 * The data directory lives two levels above this module in both the TypeScript
 * source tree (`src/rules/` → `data/`) and the compiled output (`dist/rules/` →
 * `data/`), so the relative URL resolves correctly under vitest and from the
 * published package alike. `data/` is listed in `packages/core/package.json`
 * `files`, so it ships in every edition.
 */

import { fileURLToPath } from 'node:url';
import type { FieldProvenanceManifest } from './fieldProvenance.js';
import {
  loadFieldProvenanceManifest,
  loadRecordRelationshipManifest,
  loadRulesPackFromDirectory,
} from './packLoader.js';
import type { RecordRelationshipManifest } from './recordRelationships.js';
import type { RulesPack } from './types.js';

/** Canonical pack id for the runtime D&D 5e SRD 5.1 rules pack (ADR 0013). */
export const DND5E_SRD_PACK_ID = 'rules:dnd5e-srd-5.1';

/** Rules-system id shared by the SRD pack and its campaign bindings. */
export const DND5E_SRD_SYSTEM_ID = 'dnd5e-srd';

/** Source version of the bundled SRD pack. */
export const DND5E_SRD_VERSION = '5.1';

/**
 * Retired pre-v1 placeholder pack id. The old in-code `DND5E_SRD_RULES_PACK`
 * shipped under this id; per ADR 0013 it is retired with no compatibility
 * shims, aliases, or migrations. A pre-adoption campaign DB whose binding still
 * names this id fails resolution with a clear, actionable error.
 */
export const RETIRED_DND5E_SRD_PLACEHOLDER_PACK_ID = 'rules:dnd5e-srd';

const PACK_DIR = fileURLToPath(
  new URL('../../data/rules-packs/rules__dnd5e-srd-5.1/', import.meta.url),
);

let cachedPack: RulesPack | undefined;
let cachedFieldProvenanceManifest: FieldProvenanceManifest | undefined;
let cachedRecordRelationshipManifest: RecordRelationshipManifest | undefined;

/**
 * Load the bundled, importer-generated D&D 5e SRD 5.1 rules pack from the
 * packaged data directory. Loaded once and cached (lazily on first use).
 *
 * Throws `RulesPackError` if the bundled pack is missing or fails validation —
 * that is a packaging defect, not a recoverable runtime condition.
 */
/**
 * Recursively freeze every object and array reachable from `value`.
 *
 * `Object.freeze` is shallow, so freezing only the pack would leave
 * `records[i].data.description` writable — which is the whole point here, not
 * a detail. Cycles cannot occur in a pack parsed from JSON, but the `seen`
 * guard costs nothing and keeps this total if a caller ever hands in
 * something else.
 */
function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>))
    deepFreeze(child, seen);
  return Object.freeze(value);
}

export function getBundledDnd5eSrdPack(): RulesPack {
  // DEEP-frozen at load, because object identity is used downstream as a
  // PROOF that a record came out of this artifact
  // (`bundledDnd5eSrdFieldProvenanceSource`, W10). An identity proof over a
  // mutable object is only as good as the object's stability: the pack is a
  // process-wide cached singleton, so without this a single
  // `pack.records[i].data.description = …` anywhere in the process would
  // leave `spell:fireball`'s description positively attested as verbatim SRD
  // source prose while holding a value the importer never emitted.
  //
  // Freezing makes the two agree by construction — the content the identity
  // attests can no longer drift — rather than by anyone remembering not to
  // write to it. It is also the narrowest repair available: no new artifact,
  // no hash, no re-derivation, and no weakening back toward metadata
  // comparison.
  cachedPack ??= deepFreeze(loadRulesPackFromDirectory(PACK_DIR));
  return cachedPack;
}

/**
 * Load the bundled SRD pack's field-provenance manifest
 * (`eshyra-o9bd.19.1.3.1`) from the SAME packaged data directory, cached the
 * same way as the pack itself.
 *
 * `field-provenance.json` classifies every leaf pointer this pack's records
 * emit as literal `source-prose`, deterministically `source-derived`, or
 * interpretive `compiler-projection` (`fieldProvenance.ts`).
 *
 * It attests THIS ARTIFACT'S values and nothing else. An earlier revision of
 * this comment claimed the classification applied to every record of a kind
 * reached through an SRD-compatible stack, base pack and add-ons alike,
 * because it is declared per `RulesRecordKind`; that was the laundering W10's
 * third re-review rejected, and it is no longer the mechanism. Who this
 * manifest may speak for is decided by
 * `bundledDnd5eSrdFieldProvenanceSource` (`discovery/harness.ts`), which
 * answers only for the pack object returned by `getBundledDnd5eSrdPack`
 * above. An add-on, a custom resolver result, or a foreign-system pack gets
 * no classification from this manifest, however compatible its metadata.
 *
 * Discovery's packet builder (`discovery/packet.ts`) is the first consumer:
 * the classification is the fact that stops a parser product
 * (`armorClass.value`) from being rendered to the DM as verbatim source
 * authority.
 */
export function getBundledDnd5eSrdFieldProvenanceManifest(): FieldProvenanceManifest {
  // Deep-frozen for the same reason the pack is: this object IS the
  // attestation. A mutable manifest would let a single
  // `declarations[i].class = 'source-prose'` silently reclassify every record
  // of a kind as verbatim source authority, which is the same drift the
  // frozen pack closes, approached from the other side of the proof.
  cachedFieldProvenanceManifest ??= deepFreeze(
    loadFieldProvenanceManifest(PACK_DIR),
  );
  return cachedFieldProvenanceManifest;
}

/** Load the bundled pack's optional, pack-owned relationship declarations. */
export function getBundledDnd5eSrdRecordRelationshipManifest():
  | RecordRelationshipManifest
  | undefined {
  cachedRecordRelationshipManifest ??= deepFreeze(
    loadRecordRelationshipManifest(PACK_DIR),
  );
  return cachedRecordRelationshipManifest;
}
