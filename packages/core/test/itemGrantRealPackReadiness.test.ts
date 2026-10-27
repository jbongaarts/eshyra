/** eshyra-c58j: a grant-bearing item operation that is READY on the UNMODIFIED
 * bundled pack claims that the runtime owns its creature-grant lifecycle. Such
 * a claim must be backed by real-pack conformance with NO readiness waiver
 * (use_item, then the start_effect bind, identity and printed ending). This
 * gate fails the moment a grant operation becomes ready without being listed
 * here with that conformance.
 *
 * Horn of Valhalla blow-horn (eshyra-olc5.14): its berserker count is rolled
 * per use by the engine and enforced by the binder; the use -> roll -> bind
 * contract is driven on the unmodified pack in itemGrantRolledCount.test.ts.
 * Ring of Djinni Summoning summon-djinni (its printed death consequence is
 * applied by no runtime) stays engine-pending. The elemental vessels' count is
 * certified (typed 1) but their operations stay not-ready on the c1-uses F5
 * per-period reset (eshyra-7gkh). */
import { describe, expect, it } from 'vitest';
import {
  deriveItemOperationReadinessInput,
  getBundledDnd5eSrdPack,
  magicItemVariantDefinitions,
} from '../src/internal.js';
import { assertMagicItemOperationReady } from '../src/state/itemExecutionReadiness.js';

const pack = getBundledDnd5eSrdPack();
type Obj = Record<string, unknown>;

/** Operations of grant-bearing items that pass the readiness preflight on the
 * unmodified pack, enumerated from the pack (not hard-coded). */
function readyGrantOperations(): string[] {
  const ready: string[] = [];
  for (const record of pack.records) {
    if (record.kind !== 'magic-item') continue;
    const mechanics = (record.data as Obj).mechanics as Obj | undefined;
    if (mechanics?.entityGrant === undefined) continue;
    const ids = new Set<string>(['activate', 'deactivate']);
    for (const operation of (mechanics.operations ?? []) as Obj[])
      ids.add(String(operation.id));
    const variants = magicItemVariantDefinitions(record);
    const variantIds: (string | undefined)[] =
      variants.length === 0 ? [undefined] : variants.map(({ id }) => id);
    for (const variantId of variantIds)
      for (const operationId of ids) {
        try {
          assertMagicItemOperationReady(
            record,
            variantId,
            deriveItemOperationReadinessInput(record, variantId, operationId),
          );
          ready.push(`${record.key}|${operationId}`);
        } catch {
          // not ready
        }
      }
  }
  return [...new Set(ready)].sort();
}

/** Grant operations with real-pack, no-waiver conformance coverage. */
const CONFORMANCE_BACKED: readonly string[] = [
  // itemGrantRolledCount.test.ts (no readiness waiver)
  'magic-item:horn-of-valhalla|blow-horn',
];

describe('eshyra-c58j real-pack readiness gate for creature-grant operations', () => {
  it('no grant-bearing operation is ready without unwaived conformance coverage', () => {
    expect(readyGrantOperations()).toEqual([...CONFORMANCE_BACKED].sort());
  });
});
