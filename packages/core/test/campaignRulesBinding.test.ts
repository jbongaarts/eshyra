import { describe, expect, it } from 'vitest';
import type { CampaignRulesBinding } from '../src/internal.js';
import {
  CampaignError,
  createCampaign,
  DEFAULT_DND5E_SRD_BINDING,
  DND5E_SRD_PACK_ID,
  DND5E_SRD_SYSTEM_ID,
  DND5E_SRD_VERSION,
  EMBERFALL_HOLLOW,
  getCampaign,
  PATHFINDER2E_REMASTER_RULES_PACK,
  readCampaignRulesBinding,
} from '../src/internal.js';
import { bareDb } from './support/db.js';

describe('campaign rules binding', () => {
  it('persists a default D&D SRD binding when none is supplied', () => {
    const db = bareDb();

    const info = createCampaign(db, {
      campaignId: 'campaign-1',
      pack: EMBERFALL_HOLLOW,
    });

    expect(info.rulesBinding.base.systemId).toBe(DND5E_SRD_SYSTEM_ID);
    expect(info.rulesBinding.base.packId).toBe(DND5E_SRD_PACK_ID);
    expect(info.rulesBinding.base.version).toBe(DND5E_SRD_VERSION);
    expect(info.rulesBinding.addons).toEqual([]);

    const stored = readCampaignRulesBinding(db);
    expect(stored).toBeDefined();
    expect(stored?.base.systemId).toBe(DND5E_SRD_SYSTEM_ID);
    expect(stored?.base.packId).toBe(DND5E_SRD_PACK_ID);
    expect(stored?.resolvedAt.length).toBeGreaterThan(0);

    db.close();
  });

  it('persists a caller-supplied binding with ordered add-ons', () => {
    const db = bareDb();
    const binding: CampaignRulesBinding = {
      base: {
        systemId: DND5E_SRD_SYSTEM_ID,
        packId: DND5E_SRD_PACK_ID,
        version: DND5E_SRD_VERSION,
      },
      addons: [
        {
          systemId: DND5E_SRD_SYSTEM_ID,
          packId: 'rules:dnd5e-bestiary',
          version: '1.0',
        },
        {
          systemId: DND5E_SRD_SYSTEM_ID,
          packId: 'rules:dnd5e-house-rules',
          version: '0.1',
        },
      ],
      resolvedAt: '2026-05-23T11:30:00.000Z',
    };

    const info = createCampaign(db, {
      campaignId: 'dnd-campaign-with-addons',
      pack: EMBERFALL_HOLLOW,
      rulesBinding: binding,
    });

    expect(info.rulesBinding).toEqual(binding);

    const stored = readCampaignRulesBinding(db);
    expect(stored).toEqual(binding);
    expect(stored?.addons.map((addon) => addon.packId)).toEqual([
      'rules:dnd5e-bestiary',
      'rules:dnd5e-house-rules',
    ]);

    db.close();
  });

  it('reads same-version campaigns without a binding row as default D&D SRD', () => {
    const db = bareDb();
    createCampaign(db, { campaignId: 'campaign-1', pack: EMBERFALL_HOLLOW });

    db.prepare('DELETE FROM campaign_rules_binding').run();
    expect(readCampaignRulesBinding(db)).toBeUndefined();

    const info = getCampaign(db);
    expect(info?.rulesBinding).toEqual(DEFAULT_DND5E_SRD_BINDING);

    db.close();
  });

  it('rejects creating a campaign whose binding is incompatible with the module', () => {
    const db = bareDb();
    const pathfinderBinding: CampaignRulesBinding = {
      base: {
        systemId: PATHFINDER2E_REMASTER_RULES_PACK.meta.systemId,
        packId: PATHFINDER2E_REMASTER_RULES_PACK.meta.packId,
        version: PATHFINDER2E_REMASTER_RULES_PACK.meta.version,
      },
      addons: [],
      resolvedAt: '2026-05-23T12:00:00.000Z',
    };

    expect(() =>
      createCampaign(db, {
        campaignId: 'incompat',
        pack: EMBERFALL_HOLLOW,
        rulesBinding: pathfinderBinding,
      }),
    ).toThrow(CampaignError);

    // The module rows must not have been forked.
    const moduleRow = db
      .prepare('SELECT id FROM module_meta WHERE id = 1')
      .get();
    expect(moduleRow).toBeUndefined();
    db.close();
  });
});
