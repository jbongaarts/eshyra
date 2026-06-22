import type { Db } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import type { ModuleRulesRequirements } from '../world/types.js';
import {
  DND5E_SRD_PACK_ID,
  DND5E_SRD_SYSTEM_ID,
  DND5E_SRD_VERSION,
} from './bundledSrdPack.js';

export interface CampaignRulesBindingPackRef {
  readonly systemId: string;
  readonly packId: string;
  readonly version: string;
}

export interface CampaignRulesBinding {
  readonly base: CampaignRulesBindingPackRef;
  readonly addons: readonly CampaignRulesBindingPackRef[];
  readonly resolvedAt: string;
}

const DEFAULT_RESOLVED_AT = '1970-01-01T00:00:00.000Z';

export const DEFAULT_DND5E_SRD_BINDING: CampaignRulesBinding = {
  base: {
    systemId: DND5E_SRD_SYSTEM_ID,
    packId: DND5E_SRD_PACK_ID,
    version: DND5E_SRD_VERSION,
  },
  addons: [],
  resolvedAt: DEFAULT_RESOLVED_AT,
};

const addonsColumn = jsonColumn<CampaignRulesBindingPackRef[]>(
  'campaign_rules_binding.addons_json',
);

interface CampaignRulesBindingRow {
  readonly base_system_id: string;
  readonly base_pack_id: string;
  readonly base_version: string;
  readonly addons_json: string;
  readonly resolved_at: string;
}

export function writeCampaignRulesBinding(
  db: Db,
  binding: CampaignRulesBinding,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO campaign_rules_binding(
       id, base_system_id, base_pack_id, base_version, addons_json, resolved_at
     ) VALUES (1, ?, ?, ?, ?, ?)`,
  ).run(
    binding.base.systemId,
    binding.base.packId,
    binding.base.version,
    addonsColumn.encode([...binding.addons]),
    binding.resolvedAt,
  );
}

/**
 * Check that a campaign rules binding satisfies the module's declared
 * `rulesRequirements`. Returns a human-readable reason on mismatch, or
 * `undefined` when the binding is compatible. The caller wraps the failure
 * into a domain-appropriate error (e.g. `CampaignError`).
 */
export function checkBindingAgainstModuleRequirements(
  binding: CampaignRulesBinding,
  requirements: ModuleRulesRequirements,
): string | undefined {
  if (binding.base.systemId !== requirements.baseSystemId) {
    return `module requires base rules system '${requirements.baseSystemId}', binding provides '${binding.base.systemId}'`;
  }
  if (
    requirements.baseVersions !== undefined &&
    requirements.baseVersions.length > 0 &&
    !requirements.baseVersions.includes(binding.base.version)
  ) {
    return `module requires base version in [${requirements.baseVersions.join(', ')}], binding provides '${binding.base.version}'`;
  }
  const addonIds = new Set(binding.addons.map((addon) => addon.packId));
  for (const requiredId of requirements.requiredAddonPackIds ?? []) {
    if (!addonIds.has(requiredId)) {
      return `module requires add-on pack '${requiredId}', which is not in the campaign binding`;
    }
  }
  return undefined;
}

export function readCampaignRulesBinding(
  db: Db,
): CampaignRulesBinding | undefined {
  const row = db
    .prepare(
      `SELECT base_system_id, base_pack_id, base_version, addons_json, resolved_at
       FROM campaign_rules_binding WHERE id = 1`,
    )
    .get() as CampaignRulesBindingRow | undefined;
  if (row === undefined) {
    return undefined;
  }
  return {
    base: {
      systemId: row.base_system_id,
      packId: row.base_pack_id,
      version: row.base_version,
    },
    addons: addonsColumn.decode(row.addons_json),
    resolvedAt: row.resolved_at,
  };
}
