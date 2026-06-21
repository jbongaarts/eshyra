import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  adventureModuleDirName,
  DND5E_SRD_RULES_PACK,
  loadAdventureModuleFromDir,
  type ResolvedRulesStack,
  type RulesPack,
  type RulesRecord,
  resolveRulesStack,
  validateAdventureModuleReferences,
} from '../src/internal.js';

const MODULE_ID = 'eshyra:hollow-beneath-emberfall';
const HERE = dirname(fileURLToPath(import.meta.url));
// Derive the directory from the module id via the SAME path-safe convention the
// CLI/audit resolver uses, rather than hardcoding it — so the canonical fixture
// folder is guaranteed to be the one a run's moduleId will resolve to.
const MODULE_DIR = join(
  HERE,
  '..',
  'data',
  'adventure-modules',
  adventureModuleDirName(MODULE_ID),
);

// Reuse the SRD pack's license/provenance so the tiny fixture stack stays
// terse; only the (kind, key) addressing matters for reference resolution.
const sampleLicense = DND5E_SRD_RULES_PACK.records[0].license;
const sampleProvenance = DND5E_SRD_RULES_PACK.records[0].provenance;

function rec(
  kind: RulesRecord['kind'],
  key: string,
  name: string,
): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind,
    key,
    name,
    data: {},
    source: 'test fixture',
    license: sampleLicense,
    provenance: sampleProvenance,
  };
}

/** A tiny base rules pack holding exactly the records the module references. */
function makeRulesStack(): ResolvedRulesStack {
  const base: RulesPack = {
    meta: {
      ...DND5E_SRD_RULES_PACK.meta,
      packId: 'rules:test-base',
      title: 'Test Base Pack',
      role: 'base',
      systemId: 'dnd5e-srd',
      version: '1.0.0',
    },
    records: [
      rec('creature', 'goblin', 'Goblin'),
      rec('magic-item', 'potion-of-healing', 'Potion of Healing'),
    ],
  };
  return resolveRulesStack({ base });
}

describe('The Hollow Beneath Emberfall starter module', () => {
  it('installs under the path-safe directory derived from its module id', () => {
    // The namespaced id maps to a single path-safe segment (no ':'), and that is
    // exactly the folder the fixture ships in.
    expect(adventureModuleDirName(MODULE_ID)).toBe(
      'eshyra_hollow-beneath-emberfall',
    );
    const module = loadAdventureModuleFromDir(MODULE_DIR);
    expect(module.id).toBe(MODULE_ID);
  });

  it('loads and validates through the module loader', () => {
    const module = loadAdventureModuleFromDir(MODULE_DIR);

    expect(module.id).toBe(MODULE_ID);
    expect(module.title).toBe('The Hollow Beneath Emberfall');
    expect(module.rulesRequirements.baseSystemId).toBe('dnd5e-srd');
    // The authored set the acceptance calls for is present.
    expect(module.hooks.length).toBeGreaterThan(0);
    expect(module.locations.length).toBe(4);
    expect(module.scenes.length).toBe(4);
    expect(module.npcs.length).toBe(2);
    expect(module.objectives.length).toBe(3);
    expect(module.secrets.length).toBe(3);
    expect(module.encounters.length).toBe(3);
    expect(module.treasure.length).toBe(2);
    expect(module.endingStates.length).toBe(3);
    // Reviewer note: these top-level/required fields are explicit, not inferred.
    expect(module.startingSituation.length).toBeGreaterThan(0);
    expect(Array.isArray(module.randomTables)).toBe(true);
    expect(module.milestones.length).toBe(1);
    expect(module.provenance.sourceRef).toBe(
      'first-party:hollow-beneath-emberfall',
    );
    expect(module.license.licenseClass).toBe('original');
  });

  it('seats every authored beat in the keyed locations (no dangling refs)', () => {
    const module = loadAdventureModuleFromDir(MODULE_DIR);
    // loadAdventureModuleFromDir already enforces intra-module referential
    // integrity; assert the entry scene and a couple of cross-links explicitly.
    expect(module.startingSceneId).toBe('scene-arrival');
    const sceneIds = new Set(module.scenes.map((s) => s.id));
    expect(sceneIds.has(module.startingSceneId)).toBe(true);

    const locationIds = new Set(module.locations.map((l) => l.id));
    for (const loc of module.locations) {
      for (const exit of loc.exits) {
        expect(locationIds.has(exit.toLocationId)).toBe(true);
      }
    }
  });

  it('references rules-pack content by rulesRef and resolves against a rules stack', () => {
    const module = loadAdventureModuleFromDir(MODULE_DIR);

    // Encounters reference creatures by provider-neutral rulesRef, not copied
    // stat blocks.
    const refs = module.encounters.flatMap((e) =>
      e.creatures.map((c) => c.rulesRef),
    );
    expect(refs).toContain('creature:goblin');
    const treasureRefs = module.treasure
      .map((t) => t.rulesRef)
      .filter((r): r is string => r !== undefined);
    expect(treasureRefs).toContain('magic-item:potion-of-healing');

    // The cross-pack references resolve against a rules stack that supplies
    // exactly those records.
    expect(() =>
      validateAdventureModuleReferences(module, { rules: makeRulesStack() }),
    ).not.toThrow();
  });

  it('stays separate from the Emberfall setting (depends on it by reference only)', () => {
    const module = loadAdventureModuleFromDir(MODULE_DIR);
    // It declares compatibility with the Emberfall setting pack and anchors
    // there, but authors only scenario-scoped locations of its own.
    expect(module.settingCompatibility).toEqual([
      {
        settingPackId: 'eshyra:emberfall',
        anchorLocationId: 'emberfall-square',
      },
    ]);
    // The setting anchor id is NOT one of the module's own keyed locations.
    const moduleLocationIds = new Set(module.locations.map((l) => l.id));
    expect(moduleLocationIds.has('emberfall-square')).toBe(false);
    expect(moduleLocationIds.has('loc-emberfall-square')).toBe(true);
  });
});
