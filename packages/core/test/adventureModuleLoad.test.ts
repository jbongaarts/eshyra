import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ADVENTURE_MODULE_FILE,
  type AdventureModule,
  AdventureModuleError,
  getBundledDnd5eSrdPack,
  loadAdventureModuleFromDir,
  type PackLicense,
  parseAdventureModule,
  type ResolvedRulesStack,
  type RulesPack,
  type RulesRecord,
  resolveRulesStack,
  validateAdventureModuleReferences,
} from '../src/internal.js';

const DND5E_SRD_RULES_PACK = getBundledDnd5eSrdPack();

const moduleLicense: PackLicense = {
  licenseClass: 'original',
  licenseName: 'Creative Commons Attribution 4.0 International',
  attributionText: 'Test adventure, original work for Eshyra, CC-BY-4.0.',
  requiresAttribution: true,
  commercialUseAllowed: true,
  hostedUseAllowed: true,
  redistributionAllowed: true,
  publicSharingAllowed: true,
  derivativeAllowed: true,
  containsUserSuppliedText: false,
  containsTrademarkedSettingMaterial: false,
  sourceMaterialDescription: 'Wholly original test fixture.',
  provenancePolicy: 'Authored in-repo for tests.',
  outputRestrictions: 'None beyond CC-BY-4.0 attribution.',
};

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Reuse the SRD pack's license/provenance metadata so the fixture records stay
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

const BASE_PACK_ID = 'rules:test-base';
const ADDON_PACK_ID = 'rules:test-addon';

/**
 * A tiny base rules pack holding exactly the records the fixture references,
 * optionally with an add-on pack so add-on-requirement checks can be exercised.
 */
function makeRulesStack(withAddon = false): ResolvedRulesStack {
  const base: RulesPack = {
    meta: {
      ...DND5E_SRD_RULES_PACK.meta,
      packId: BASE_PACK_ID,
      title: 'Test Base Pack',
      role: 'base',
      systemId: 'dnd5e-srd',
      version: '1.0.0',
    },
    records: [
      rec('creature', 'goblin', 'Goblin'),
      rec('stat-block', 'giant-rat', 'Giant Rat'),
      rec('magic-item', 'amulet-of-health', 'Amulet of Health'),
      rec('table', 'dungeon-ambience', 'Dungeon Ambience'),
    ],
  };
  if (!withAddon) {
    return resolveRulesStack({ base });
  }
  const addon: RulesPack = {
    meta: {
      ...DND5E_SRD_RULES_PACK.meta,
      packId: ADDON_PACK_ID,
      title: 'Test Add-on Pack',
      role: 'addon',
      systemId: 'dnd5e-srd-addon',
      version: '1.0.0',
      compatibleBaseSystems: [{ systemId: 'dnd5e-srd', versions: ['1.0.0'] }],
    },
    records: [rec('creature', 'kobold', 'Kobold')],
  };
  return resolveRulesStack({ base, addons: [addon] });
}

function makeValidModule(): AdventureModule {
  return {
    id: 'eshyra:test-delve',
    title: 'A Small Test Delve',
    summary: 'A tiny scenario used to exercise loading + reference validation.',
    intendedLevels: { min: 1, max: 3 },
    intendedPartySize: { min: 1, max: 4 },
    rulesRequirements: { baseSystemId: 'dnd5e-srd' },
    settingCompatibility: [
      {
        settingPackId: 'eshyra:emberfall',
        anchorLocationId: 'emberfall-square',
      },
    ],
    startingSituation: 'Strange lights flicker in the cellar.',
    startingSceneId: 'scene-cellar',
    hooks: [],
    locations: [
      {
        id: 'loc-cellar',
        name: 'The Flickering Cellar',
        summary: 'A cellar with an unnatural glow.',
        description: 'Stone steps descend into a cold, faintly lit cellar.',
        exits: [],
        tags: ['dungeon'],
      },
    ],
    scenes: [
      {
        id: 'scene-cellar',
        title: 'Into the Cellar',
        summary: 'The party descends and faces what lurks below.',
        kind: 'combat',
        locationIds: ['loc-cellar'],
        npcIds: [],
        objectiveIds: ['obj-clear'],
        encounterIds: ['enc-rats'],
        secretIds: [],
      },
    ],
    npcs: [],
    encounters: [
      {
        id: 'enc-rats',
        name: 'Glowing Vermin',
        description: 'Creatures warped by the cellar’s light.',
        creatures: [
          { rulesRef: 'creature:goblin', count: 1, role: 'leader' },
          { rulesRef: 'stat-block:giant-rat', count: 3, role: 'minion' },
        ],
        reward: 'A scattering of old coins.',
        locationId: 'loc-cellar',
      },
    ],
    treasure: [
      {
        id: 'treasure-amulet',
        name: 'Tarnished Amulet',
        description: 'A warm amulet humming with faint power.',
        rulesRef: 'magic-item:amulet-of-health',
        locationId: 'loc-cellar',
      },
      {
        id: 'treasure-coins',
        name: 'Old Coins',
        description: 'A handful of pre-war coins.',
      },
    ],
    secrets: [],
    objectives: [
      {
        id: 'obj-clear',
        title: 'Clear the cellar',
        description: 'Deal with the source of the lights.',
        optional: false,
        successCondition: 'The cellar is cleared.',
        relatedSceneIds: ['scene-cellar'],
        relatedLocationIds: ['loc-cellar'],
      },
    ],
    clocksOrThreats: [],
    randomTables: [
      {
        id: 'rt-noises',
        title: 'Cellar Noises',
        rulesRef: 'table:dungeon-ambience',
      },
    ],
    milestones: [],
    endingStates: [
      {
        id: 'end-clear',
        title: 'Cleared',
        summary: 'The cellar is safe again.',
        kind: 'success',
        condition: 'The party clears the cellar.',
      },
    ],
    provenance: { sourceRef: 'test-fixture' },
    license: moduleLicense,
  };
}

function writeModuleDir(module: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'eshyra-adventure-'));
  tmpDirs.push(dir);
  writeFileSync(
    join(dir, ADVENTURE_MODULE_FILE),
    JSON.stringify(module),
    'utf8',
  );
  return dir;
}

describe('adventure module loader', () => {
  it('loads and structurally validates a written module pack', () => {
    const dir = writeModuleDir(makeValidModule());
    const module = loadAdventureModuleFromDir(dir);
    expect(module.id).toBe('eshyra:test-delve');
    expect(module.encounters).toHaveLength(1);
  });

  it('throws AdventureModuleError when the pack file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eshyra-adventure-'));
    tmpDirs.push(dir);
    expect(() => loadAdventureModuleFromDir(dir)).toThrow(AdventureModuleError);
    expect(() => loadAdventureModuleFromDir(dir)).toThrow(/not found/);
  });

  it('rejects unparseable JSON', () => {
    expect(() => parseAdventureModule('{ not json')).toThrow(/not parseable/);
  });

  it('delegates structural validation (rejects a broken intra-module ref)', () => {
    const broken = makeValidModule();
    broken.scenes[0].objectiveIds = ['obj-ghost'];
    expect(() => parseAdventureModule(JSON.stringify(broken))).toThrow(
      /unknown objective/,
    );
  });
});

describe('validateAdventureModuleReferences', () => {
  it('accepts a module whose cross-pack references all resolve', () => {
    const stack = makeRulesStack();
    expect(() =>
      validateAdventureModuleReferences(makeValidModule(), { rules: stack }),
    ).not.toThrow();
  });

  it('rejects an encounter creature ref that does not resolve', () => {
    const stack = makeRulesStack();
    const module = makeValidModule();
    module.encounters[0].creatures[0] = {
      rulesRef: 'creature:ancient-dragon',
      count: 1,
      role: 'leader',
    };
    expect(() =>
      validateAdventureModuleReferences(module, { rules: stack }),
    ).toThrow(/does not resolve to a creature/);
  });

  it('rejects an encounter creature ref naming a non-creature kind', () => {
    const stack = makeRulesStack();
    const module = makeValidModule();
    module.encounters[0].creatures[0] = {
      rulesRef: 'magic-item:amulet-of-health',
      count: 1,
      role: 'leader',
    };
    expect(() =>
      validateAdventureModuleReferences(module, { rules: stack }),
    ).toThrow(/must name one of: creature, stat-block/);
  });

  it('rejects a malformed rules reference', () => {
    const stack = makeRulesStack();
    const module = makeValidModule();
    module.randomTables[0].rulesRef = 'dungeon-ambience';
    expect(() =>
      validateAdventureModuleReferences(module, { rules: stack }),
    ).toThrow(/malformed rules reference/);
  });

  it('rejects an unresolved treasure item ref', () => {
    const stack = makeRulesStack();
    const module = makeValidModule();
    module.treasure[0].rulesRef = 'magic-item:staff-of-power';
    expect(() =>
      validateAdventureModuleReferences(module, { rules: stack }),
    ).toThrow(/treasure\[treasure-amulet\].rulesRef/);
  });

  it('rejects an unresolved random table ref', () => {
    const stack = makeRulesStack();
    const module = makeValidModule();
    module.randomTables[0].rulesRef = 'table:missing';
    expect(() =>
      validateAdventureModuleReferences(module, { rules: stack }),
    ).toThrow(/does not resolve to a table/);
  });

  it('rejects a baseSystemId that does not match the rules stack', () => {
    const stack = makeRulesStack();
    const module = makeValidModule();
    module.rulesRequirements = { baseSystemId: 'pathfinder2e-remaster' };
    expect(() =>
      validateAdventureModuleReferences(module, { rules: stack }),
    ).toThrow(/baseSystemId/);
  });

  it('rejects a baseVersions list that excludes the loaded base version', () => {
    const stack = makeRulesStack();
    const module = makeValidModule();
    module.rulesRequirements = {
      baseSystemId: 'dnd5e-srd',
      baseVersions: ['9.9.9'],
    };
    expect(() =>
      validateAdventureModuleReferences(module, { rules: stack }),
    ).toThrow(/baseVersions does not allow loaded base version '1.0.0'/);
  });

  it('accepts a baseVersions list that includes the loaded base version', () => {
    const stack = makeRulesStack();
    const module = makeValidModule();
    module.rulesRequirements = {
      baseSystemId: 'dnd5e-srd',
      baseVersions: ['1.0.0'],
    };
    expect(() =>
      validateAdventureModuleReferences(module, { rules: stack }),
    ).not.toThrow();
  });

  it('rejects a required add-on pack not present in the rules stack', () => {
    const stack = makeRulesStack();
    const module = makeValidModule();
    module.rulesRequirements = {
      baseSystemId: 'dnd5e-srd',
      requiredAddonPackIds: ['rules:not-loaded'],
    };
    expect(() =>
      validateAdventureModuleReferences(module, { rules: stack }),
    ).toThrow(/requiredAddonPackIds references missing add-on rules pack/);
  });

  it('does not let the base pack id satisfy an add-on requirement', () => {
    const stack = makeRulesStack(true);
    const module = makeValidModule();
    // BASE_PACK_ID is loaded (as the base), but it is not an add-on.
    module.rulesRequirements = {
      baseSystemId: 'dnd5e-srd',
      requiredAddonPackIds: [BASE_PACK_ID],
    };
    expect(() =>
      validateAdventureModuleReferences(module, { rules: stack }),
    ).toThrow(/requiredAddonPackIds references missing add-on rules pack/);
  });

  it('accepts a required add-on pack that is actually loaded as an add-on', () => {
    const stack = makeRulesStack(true);
    const module = makeValidModule();
    module.rulesRequirements = {
      baseSystemId: 'dnd5e-srd',
      requiredAddonPackIds: [ADDON_PACK_ID],
    };
    expect(() =>
      validateAdventureModuleReferences(module, { rules: stack }),
    ).not.toThrow();
  });

  it('rejects an unknown setting pack id when the setting universe is supplied', () => {
    const stack = makeRulesStack();
    expect(() =>
      validateAdventureModuleReferences(makeValidModule(), {
        rules: stack,
        settingPackIds: new Set(['eshyra:other-setting']),
      }),
    ).toThrow(/is not a known setting/);
  });

  it('rejects an anchor location absent from the named setting', () => {
    const stack = makeRulesStack();
    expect(() =>
      validateAdventureModuleReferences(makeValidModule(), {
        rules: stack,
        settingPackIds: new Set(['eshyra:emberfall']),
        settingLocationIds: new Map([
          ['eshyra:emberfall', new Set(['emberfall-gate'])],
        ]),
      }),
    ).toThrow(/anchorLocationId/);
  });

  it('skips setting checks when no setting universe is supplied', () => {
    const stack = makeRulesStack();
    // settingCompatibility references eshyra:emberfall, but with no
    // settingPackIds in context the check is not applicable.
    expect(() =>
      validateAdventureModuleReferences(makeValidModule(), { rules: stack }),
    ).not.toThrow();
  });
});
