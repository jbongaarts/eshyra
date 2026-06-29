/**
 * Runtime accessor for typed equipment-pack contents (eshyra-ngcj.4).
 *
 * The importer authors each SRD 5.1 equipment pack's contents onto the pack
 * `equipment` record's `data.contents` (see the importer's
 * `equipmentPackContents.ts`). This module is the runtime-facing contract:
 * inventory tooling that holds a granted pack ref (e.g. `equipment:explorers-pack`
 * from a class starting-equipment grant) reads the pack record and expands it
 * into deterministic line items via `readEquipmentPackContents`.
 */

/** One typed line item inside an equipment pack. */
export interface EquipmentPackContent {
  /** Explicit count (a bundle record like `equipment:rope-hempen-50-feet` is 1). */
  readonly quantity: number;
  /** Human-readable item name, as the SRD lists it. */
  readonly name: string;
  /** Equipment record key when the item has its own record; absent otherwise. */
  readonly ref?: string;
  /** Qualifier the ref does not capture (length, "strapped to the side", …). */
  readonly detail?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Read the typed contents off a pack equipment record's `data`, or `undefined`
 * for a non-pack item / a record carrying no `contents`. Defensive: skips
 * malformed entries rather than throwing (the pack is schema-validated on load).
 */
export function readEquipmentPackContents(
  data: unknown,
): readonly EquipmentPackContent[] | undefined {
  if (!isRecord(data) || !Array.isArray(data.contents)) return undefined;
  const out: EquipmentPackContent[] = [];
  for (const entry of data.contents) {
    if (
      !isRecord(entry) ||
      typeof entry.name !== 'string' ||
      typeof entry.quantity !== 'number'
    ) {
      continue;
    }
    out.push({
      quantity: entry.quantity,
      name: entry.name,
      ...(typeof entry.ref === 'string' ? { ref: entry.ref } : {}),
      ...(typeof entry.detail === 'string' ? { detail: entry.detail } : {}),
    });
  }
  return out;
}
