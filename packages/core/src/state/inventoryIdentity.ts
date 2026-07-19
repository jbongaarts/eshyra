import type { Db } from '../persistence/db.js';

/** Storage bounds for the exact identity carried by inventory tools. */
export const INVENTORY_ID_MAX_BYTES = 256;
export const INVENTORY_NAME_MAX_BYTES = 256;

/** The maximum serialized nearby-item page/context payload. */
export const NEARBY_INVENTORY_MAX_BYTES = 4096;

const encoder = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export class InventoryIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryIdentityError';
  }
}

export function validateInventoryIdentity(
  id: string,
  name: string,
  label = 'inventory',
): void {
  const idBytes = utf8ByteLength(id);
  if (idBytes > INVENTORY_ID_MAX_BYTES) {
    throw new InventoryIdentityError(
      `${label} id exceeds ${INVENTORY_ID_MAX_BYTES} UTF-8 bytes (got ${idBytes}); choose a shorter exact id`,
    );
  }
  const nameBytes = utf8ByteLength(name);
  if (nameBytes > INVENTORY_NAME_MAX_BYTES) {
    throw new InventoryIdentityError(
      `${label} name exceeds ${INVENTORY_NAME_MAX_BYTES} UTF-8 bytes (got ${nameBytes}); choose a shorter name`,
    );
  }
}

export interface InventoryIdentityRepairRow {
  inventory_id: string;
  id_bytes: number;
  name_bytes: number;
  reason: string;
}

/** Return migration-recorded legacy evidence; callers must not silently repair it. */
export function listInventoryIdentityRepairs(
  db: Db,
): InventoryIdentityRepairRow[] {
  return db
    .prepare(
      `SELECT inventory_id, id_bytes, name_bytes, reason
       FROM inventory_identity_repair ORDER BY inventory_id`,
    )
    .all() as InventoryIdentityRepairRow[];
}

export function assertNoInventoryIdentityRepairs(db: Db): void {
  const repair = listInventoryIdentityRepairs(db)[0];
  if (repair !== undefined) {
    throw new InventoryIdentityError(
      `inventory identity repair required for '${repair.inventory_id}' (id ${repair.id_bytes} bytes, name ${repair.name_bytes} bytes): preserve the exact id and repair the stored identity before continuing`,
    );
  }
}

export function fitsNearbyInventoryBudget(
  current: readonly unknown[],
  candidate: unknown,
): boolean {
  return (
    utf8ByteLength(JSON.stringify([...current, candidate])) <=
    NEARBY_INVENTORY_MAX_BYTES
  );
}
