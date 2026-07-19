import type { Db } from '../persistence/db.js';

export class InventoryWorldLocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryWorldLocationError';
  }
}

export function isConcreteWorldLocation(
  value: string | null | undefined,
): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Authoritative placement owner for every transition that leaves a surviving
 * unheld physical inventory row. Unknown placement would make the row neither
 * discoverable nor safely claimable/destroyable, so it fails closed.
 */
export function requireCurrentWorldLocation(db: Db): string {
  const clock = db
    .prepare('SELECT current_location_id FROM clock WHERE id=1')
    .get() as { current_location_id: string | null } | undefined;
  if (
    clock === undefined ||
    !isConcreteWorldLocation(clock.current_location_id)
  )
    throw new InventoryWorldLocationError(
      'a concrete current campaign location is required before creating an unheld physical item',
    );
  return clock.current_location_id;
}
