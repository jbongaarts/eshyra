/** Test scaffolding for olc5.12.3: when a test exercises start_effect's grant
 * validation (identity, concentration, duration, cleanup) and is not about the
 * spend that pays for the bind, it grants the bind credit use_item would have
 * issued. The dedicated credit contract lives in itemGrantBindCredit.test.ts,
 * which drives the real spending operations instead. */
import { effectiveMagicItemMechanics } from '../../src/internal.js';
import type { Db } from '../../src/persistence/db.js';
import type { CampaignRulesPackResolver } from '../../src/state/campaignRecordLookup.js';
import { lookupStrictCampaignRecord } from '../../src/state/campaignRecordLookup.js';
import {
  issueItemGrantBindCredit,
  oldestOpenItemGrantBindCredit,
} from '../../src/state/itemGrantBinding.js';
import { grantCooldownAnchoredTo } from '../../src/state/itemState.js';

export function ensureTestBindCredit(
  db: Db,
  campaignId: string,
  resolveRulesPack: CampaignRulesPackResolver | undefined,
  source: { ref?: unknown; grantRef?: unknown; itemInstanceId?: unknown },
): void {
  if (
    typeof source.ref !== 'string' ||
    typeof source.grantRef !== 'string' ||
    typeof source.itemInstanceId !== 'string'
  )
    return;
  const row = db
    .prepare('SELECT pack_ref, variant_id FROM inventory WHERE id = ?')
    .get(source.itemInstanceId) as
    | { pack_ref: string | null; variant_id: string | null }
    | undefined;
  if (row === undefined || row.pack_ref !== source.ref) return;
  const hit = lookupStrictCampaignRecord(
    db,
    'magic-item',
    source.ref,
    resolveRulesPack,
  );
  if (hit === undefined) return;
  let mechanics: Record<string, unknown> | undefined;
  try {
    mechanics = effectiveMagicItemMechanics(
      hit.record,
      row.variant_id ?? undefined,
    ) as Record<string, unknown> | undefined;
  } catch {
    return; // an instance with no admissible variant is refused by the bind itself
  }
  const grants = (mechanics?.entityGrant as { grants?: unknown[] } | undefined)
    ?.grants;
  const grant = grants?.find(
    (g) => (g as { id?: unknown }).id === source.grantRef,
  ) as Record<string, unknown> | undefined;
  if (
    grant === undefined ||
    typeof grant.cooldownEconomy !== 'string' ||
    grantCooldownAnchoredTo(mechanics, grant)
  )
    return;
  const scope = {
    campaignId,
    itemInstanceId: source.itemInstanceId,
    packRef: source.ref,
    variantId: row.variant_id ?? undefined,
    economyId: grant.cooldownEconomy,
  };
  // A grant whose creature is chosen by an engine roll (`creatureRoll`) can
  // only be paid by the credit of a real use_item (its roll cannot be
  // scaffolded); itemGrantBagOfTricks.test.ts drives that on the real pack.
  if (typeof grant.creatureRoll === 'string') return;
  if (oldestOpenItemGrantBindCredit(db, scope) !== undefined) return;
  issueItemGrantBindCredit(db, {
    ...scope,
    operationId: 'test-scaffold',
    issuedAt: '2026-10-17T10:00:00.000Z',
    issuedElapsedMinutes: 0,
    provenance: 'test:bind-credit-scaffold',
    sessionId: 'test-session',
  });
}
