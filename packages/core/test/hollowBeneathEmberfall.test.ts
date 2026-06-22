import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  adventureModuleDirName,
  getBundledDnd5eSrdPack,
  loadAdventureModuleFromDir,
  lookupRulesRecord,
  type ResolvedRulesStack,
  type RulesRecordKind,
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

// Resolve the module's rulesRefs against the REAL bundled, importer-generated
// SRD 5.1 stack (ADR 0013), not a hand-built fixture. A module `rulesRef` IS the
// canonical record key (`<kind>:<key>`, e.g. `creature:goblin`), so this proves
// the encounter/treasure refs mechanically resolve against the shipped, audited
// pack — the gap eshyra-8bit closed.
function makeSrdStack(): ResolvedRulesStack {
  return resolveRulesStack({ base: getBundledDnd5eSrdPack() });
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

  it('references rules-pack content by rulesRef and resolves against the real SRD stack', () => {
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

    // The cross-pack references resolve against the REAL bundled SRD stack —
    // every encounter creature and rules-referencing treasure item. This is the
    // mechanical resolution eshyra-8bit reconciled: a rulesRef is the canonical
    // kind-prefixed record key, so it must resolve whole against the shipped pack
    // (it did not before, because the validator re-split it into a bare key).
    const stack = makeSrdStack();
    expect(() =>
      validateAdventureModuleReferences(module, { rules: stack }),
    ).not.toThrow();

    // And concretely: each authored rulesRef looks up its real record by the
    // whole `<kind>:<key>` string.
    for (const e of module.encounters) {
      for (const c of e.creatures) {
        const [kind] = c.rulesRef.split(':');
        const result = lookupRulesRecord(stack, {
          kind: kind as RulesRecordKind,
          ref: c.rulesRef,
        });
        expect(result.ok).toBe(true);
      }
    }
    const goblin = lookupRulesRecord(stack, {
      kind: 'creature',
      ref: 'creature:goblin',
    });
    expect(goblin.ok).toBe(true);
    const potion = lookupRulesRecord(stack, {
      kind: 'magic-item',
      ref: 'magic-item:potion-of-healing',
    });
    expect(potion.ok).toBe(true);
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
