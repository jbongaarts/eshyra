// Structural + intra-module referential validator for an untrusted
// {@link AdventureModule}. Mirrors the hand-written, path-addressed style of
// `world/validate.ts` (the established in-repo idiom: a self-contained
// per-subsystem validator with a subsystem-specific error class).
//
// Scope (eshyra-eh54.2): validate shape and references *within* the module —
// scenes pointing at real locations/objectives/etc., unique colon-free ids,
// and well-formed license/provenance/rules-requirement metadata. Cross-pack
// references (creature/item/table `rulesRef`s and setting-compatibility ids)
// are validated only as non-empty strings here; resolving them against the
// rules pack and setting content is the loader's job (eshyra-eh54.3).

import type { RecordProvenance } from '../rules/types.js';
import type { ModuleRulesRequirements, PackLicense } from '../world/types.js';
import type {
  AdventureClock,
  AdventureEncounter,
  AdventureEndingState,
  AdventureHook,
  AdventureLocation,
  AdventureMilestone,
  AdventureModule,
  AdventureNpc,
  AdventureObjective,
  AdventureRandomTableRef,
  AdventureScene,
  AdventureSecret,
  AdventureTreasure,
  LevelRange,
  PartySizeRange,
  SettingCompatibilityRef,
} from './types.js';

export class AdventureModuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdventureModuleError';
  }
}

type Obj = Record<string, unknown>;

function obj(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AdventureModuleError(`${path} must be an object`);
  }
  return value as Obj;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AdventureModuleError(`${path} must be a non-empty string`);
  }
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new AdventureModuleError(`${path} must be a boolean`);
  }
  return value;
}

function int(value: unknown, path: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new AdventureModuleError(`${path} must be an integer >= ${min}`);
  }
  return value;
}

function arr(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new AdventureModuleError(`${path} must be an array`);
  }
  return value;
}

function strArray(value: unknown, path: string): string[] {
  return arr(value, path).map((item, i) => str(item, `${path}[${i}]`));
}

function oneOf<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  const s = str(value, path);
  if (!(allowed as readonly string[]).includes(s)) {
    throw new AdventureModuleError(
      `${path} must be one of: ${allowed.join(', ')}`,
    );
  }
  return s as T;
}

function range(value: unknown, path: string): LevelRange | PartySizeRange {
  const o = obj(value, path);
  const min = int(o.min, `${path}.min`, 1);
  const max = int(o.max, `${path}.max`, 1);
  if (max < min) {
    throw new AdventureModuleError(`${path}.max must be >= ${path}.min`);
  }
  return { min, max };
}

function provenance(value: unknown): RecordProvenance {
  const o = obj(value, 'provenance');
  return {
    sourceRef: str(o.sourceRef, 'provenance.sourceRef'),
    ...(o.locator === undefined
      ? {}
      : { locator: str(o.locator, 'provenance.locator') }),
    ...(o.note === undefined ? {} : { note: str(o.note, 'provenance.note') }),
  };
}

function license(value: unknown): PackLicense {
  const o = obj(value, 'license');
  return {
    licenseClass: oneOf(o.licenseClass, 'license.licenseClass', [
      'open',
      'public-domain',
      'original',
      'publisher-licensed',
      'user-private',
    ]),
    licenseName: str(o.licenseName, 'license.licenseName'),
    attributionText: str(o.attributionText, 'license.attributionText'),
    requiresAttribution: bool(
      o.requiresAttribution,
      'license.requiresAttribution',
    ),
    commercialUseAllowed: bool(
      o.commercialUseAllowed,
      'license.commercialUseAllowed',
    ),
    hostedUseAllowed: bool(o.hostedUseAllowed, 'license.hostedUseAllowed'),
    redistributionAllowed: bool(
      o.redistributionAllowed,
      'license.redistributionAllowed',
    ),
    publicSharingAllowed: bool(
      o.publicSharingAllowed,
      'license.publicSharingAllowed',
    ),
    derivativeAllowed: bool(o.derivativeAllowed, 'license.derivativeAllowed'),
    containsUserSuppliedText: bool(
      o.containsUserSuppliedText,
      'license.containsUserSuppliedText',
    ),
    containsTrademarkedSettingMaterial: bool(
      o.containsTrademarkedSettingMaterial,
      'license.containsTrademarkedSettingMaterial',
    ),
    sourceMaterialDescription: str(
      o.sourceMaterialDescription,
      'license.sourceMaterialDescription',
    ),
    provenancePolicy: str(o.provenancePolicy, 'license.provenancePolicy'),
    outputRestrictions: str(o.outputRestrictions, 'license.outputRestrictions'),
  };
}

function rulesRequirements(value: unknown): ModuleRulesRequirements {
  const o = obj(value, 'rulesRequirements');
  const baseVersions =
    o.baseVersions === undefined
      ? undefined
      : strArray(o.baseVersions, 'rulesRequirements.baseVersions');
  const requiredAddonPackIds =
    o.requiredAddonPackIds === undefined
      ? undefined
      : strArray(
          o.requiredAddonPackIds,
          'rulesRequirements.requiredAddonPackIds',
        );
  const optionalAddonPackIds =
    o.optionalAddonPackIds === undefined
      ? undefined
      : strArray(
          o.optionalAddonPackIds,
          'rulesRequirements.optionalAddonPackIds',
        );
  return {
    baseSystemId: str(o.baseSystemId, 'rulesRequirements.baseSystemId'),
    ...(baseVersions === undefined ? {} : { baseVersions }),
    ...(requiredAddonPackIds === undefined ? {} : { requiredAddonPackIds }),
    ...(optionalAddonPackIds === undefined ? {} : { optionalAddonPackIds }),
  };
}

function settingCompatibility(
  value: unknown,
  i: number,
): SettingCompatibilityRef {
  const o = obj(value, `settingCompatibility[${i}]`);
  return {
    settingPackId: str(
      o.settingPackId,
      `settingCompatibility[${i}].settingPackId`,
    ),
    ...(o.anchorLocationId === undefined
      ? {}
      : {
          anchorLocationId: str(
            o.anchorLocationId,
            `settingCompatibility[${i}].anchorLocationId`,
          ),
        }),
  };
}

function hook(value: unknown, i: number): AdventureHook {
  const o = obj(value, `hooks[${i}]`);
  return {
    id: str(o.id, `hooks[${i}].id`),
    title: str(o.title, `hooks[${i}].title`),
    text: str(o.text, `hooks[${i}].text`),
    ...(o.originNpcId === undefined
      ? {}
      : { originNpcId: str(o.originNpcId, `hooks[${i}].originNpcId`) }),
    ...(o.originLocationId === undefined
      ? {}
      : {
          originLocationId: str(
            o.originLocationId,
            `hooks[${i}].originLocationId`,
          ),
        }),
  };
}

function location(value: unknown, i: number): AdventureLocation {
  const o = obj(value, `locations[${i}]`);
  return {
    id: str(o.id, `locations[${i}].id`),
    name: str(o.name, `locations[${i}].name`),
    summary: str(o.summary, `locations[${i}].summary`),
    description: str(o.description, `locations[${i}].description`),
    exits: arr(o.exits, `locations[${i}].exits`).map((e, j) => {
      const eo = obj(e, `locations[${i}].exits[${j}]`);
      return {
        direction: str(eo.direction, `locations[${i}].exits[${j}].direction`),
        toLocationId: str(
          eo.toLocationId,
          `locations[${i}].exits[${j}].toLocationId`,
        ),
        ...(eo.requirement === undefined
          ? {}
          : {
              requirement: str(
                eo.requirement,
                `locations[${i}].exits[${j}].requirement`,
              ),
            }),
      };
    }),
    tags: strArray(o.tags, `locations[${i}].tags`),
  };
}

function scene(value: unknown, i: number): AdventureScene {
  const o = obj(value, `scenes[${i}]`);
  return {
    id: str(o.id, `scenes[${i}].id`),
    title: str(o.title, `scenes[${i}].title`),
    summary: str(o.summary, `scenes[${i}].summary`),
    kind: oneOf(o.kind, `scenes[${i}].kind`, [
      'social',
      'exploration',
      'combat',
      'transition',
      'mixed',
    ]),
    locationIds: strArray(o.locationIds, `scenes[${i}].locationIds`),
    npcIds: strArray(o.npcIds, `scenes[${i}].npcIds`),
    objectiveIds: strArray(o.objectiveIds, `scenes[${i}].objectiveIds`),
    encounterIds: strArray(o.encounterIds, `scenes[${i}].encounterIds`),
    secretIds: strArray(o.secretIds, `scenes[${i}].secretIds`),
  };
}

function npc(value: unknown, i: number): AdventureNpc {
  const o = obj(value, `npcs[${i}]`);
  return {
    id: str(o.id, `npcs[${i}].id`),
    name: str(o.name, `npcs[${i}].name`),
    role: str(o.role, `npcs[${i}].role`),
    disposition: str(o.disposition, `npcs[${i}].disposition`),
    summary: str(o.summary, `npcs[${i}].summary`),
    secret: str(o.secret, `npcs[${i}].secret`),
    ...(o.locationId === undefined
      ? {}
      : { locationId: str(o.locationId, `npcs[${i}].locationId`) }),
  };
}

function encounter(value: unknown, i: number): AdventureEncounter {
  const o = obj(value, `encounters[${i}]`);
  return {
    id: str(o.id, `encounters[${i}].id`),
    name: str(o.name, `encounters[${i}].name`),
    description: str(o.description, `encounters[${i}].description`),
    creatures: arr(o.creatures, `encounters[${i}].creatures`).map((c, j) => {
      const co = obj(c, `encounters[${i}].creatures[${j}]`);
      return {
        rulesRef: str(co.rulesRef, `encounters[${i}].creatures[${j}].rulesRef`),
        count: int(co.count, `encounters[${i}].creatures[${j}].count`, 1),
        role: str(co.role, `encounters[${i}].creatures[${j}].role`),
      };
    }),
    reward: str(o.reward, `encounters[${i}].reward`),
    ...(o.locationId === undefined
      ? {}
      : { locationId: str(o.locationId, `encounters[${i}].locationId`) }),
  };
}

function treasure(value: unknown, i: number): AdventureTreasure {
  const o = obj(value, `treasure[${i}]`);
  return {
    id: str(o.id, `treasure[${i}].id`),
    name: str(o.name, `treasure[${i}].name`),
    description: str(o.description, `treasure[${i}].description`),
    ...(o.rulesRef === undefined
      ? {}
      : { rulesRef: str(o.rulesRef, `treasure[${i}].rulesRef`) }),
    ...(o.locationId === undefined
      ? {}
      : { locationId: str(o.locationId, `treasure[${i}].locationId`) }),
  };
}

function secret(value: unknown, i: number): AdventureSecret {
  const o = obj(value, `secrets[${i}]`);
  return {
    id: str(o.id, `secrets[${i}].id`),
    title: str(o.title, `secrets[${i}].title`),
    dmText: str(o.dmText, `secrets[${i}].dmText`),
    revealableLocationIds: strArray(
      o.revealableLocationIds,
      `secrets[${i}].revealableLocationIds`,
    ),
    revealableSceneIds: strArray(
      o.revealableSceneIds,
      `secrets[${i}].revealableSceneIds`,
    ),
  };
}

function objective(value: unknown, i: number): AdventureObjective {
  const o = obj(value, `objectives[${i}]`);
  return {
    id: str(o.id, `objectives[${i}].id`),
    title: str(o.title, `objectives[${i}].title`),
    description: str(o.description, `objectives[${i}].description`),
    optional: bool(o.optional, `objectives[${i}].optional`),
    successCondition: str(
      o.successCondition,
      `objectives[${i}].successCondition`,
    ),
    ...(o.failureCondition === undefined
      ? {}
      : {
          failureCondition: str(
            o.failureCondition,
            `objectives[${i}].failureCondition`,
          ),
        }),
    relatedSceneIds: strArray(
      o.relatedSceneIds,
      `objectives[${i}].relatedSceneIds`,
    ),
    relatedLocationIds: strArray(
      o.relatedLocationIds,
      `objectives[${i}].relatedLocationIds`,
    ),
  };
}

function clock(value: unknown, i: number): AdventureClock {
  const o = obj(value, `clocksOrThreats[${i}]`);
  return {
    id: str(o.id, `clocksOrThreats[${i}].id`),
    name: str(o.name, `clocksOrThreats[${i}].name`),
    description: str(o.description, `clocksOrThreats[${i}].description`),
    segments: int(o.segments, `clocksOrThreats[${i}].segments`, 1),
    advanceWhen: str(o.advanceWhen, `clocksOrThreats[${i}].advanceWhen`),
    resultWhenFilled: str(
      o.resultWhenFilled,
      `clocksOrThreats[${i}].resultWhenFilled`,
    ),
    ...(o.linkedObjectiveId === undefined
      ? {}
      : {
          linkedObjectiveId: str(
            o.linkedObjectiveId,
            `clocksOrThreats[${i}].linkedObjectiveId`,
          ),
        }),
  };
}

function randomTable(value: unknown, i: number): AdventureRandomTableRef {
  const o = obj(value, `randomTables[${i}]`);
  return {
    id: str(o.id, `randomTables[${i}].id`),
    title: str(o.title, `randomTables[${i}].title`),
    rulesRef: str(o.rulesRef, `randomTables[${i}].rulesRef`),
  };
}

function milestone(value: unknown, i: number): AdventureMilestone {
  const o = obj(value, `milestones[${i}]`);
  return {
    id: str(o.id, `milestones[${i}].id`),
    title: str(o.title, `milestones[${i}].title`),
    description: str(o.description, `milestones[${i}].description`),
    objectiveIds: strArray(o.objectiveIds, `milestones[${i}].objectiveIds`),
  };
}

function endingState(value: unknown, i: number): AdventureEndingState {
  const o = obj(value, `endingStates[${i}]`);
  return {
    id: str(o.id, `endingStates[${i}].id`),
    title: str(o.title, `endingStates[${i}].title`),
    summary: str(o.summary, `endingStates[${i}].summary`),
    kind: oneOf(o.kind, `endingStates[${i}].kind`, [
      'success',
      'failure',
      'partial',
      'neutral',
    ]),
    condition: str(o.condition, `endingStates[${i}].condition`),
  };
}

function assertUniqueIds(items: readonly { id: string }[], path: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new AdventureModuleError(`${path} has duplicate id: ${item.id}`);
    }
    seen.add(item.id);
  }
}

/**
 * Adventure-module child ids may be used to key campaign-owned progress
 * overlays (eshyra-eh54.4) the same way world ids key `world:<type>:<id>:…`
 * overlay keys, so reject `:` to keep those keys unambiguous.
 */
function assertColonFreeIds(
  items: readonly { id: string }[],
  path: string,
): void {
  for (const item of items) {
    if (item.id.includes(':')) {
      throw new AdventureModuleError(
        `${path} id must not contain ':': '${item.id}'`,
      );
    }
  }
}

function assertRef(
  ids: ReadonlySet<string>,
  ref: string,
  where: string,
  kind: string,
): void {
  if (!ids.has(ref)) {
    throw new AdventureModuleError(
      `${where} references unknown ${kind} '${ref}'`,
    );
  }
}

/**
 * Structurally validate an untrusted value as an {@link AdventureModule}.
 * Throws {@link AdventureModuleError} on the first problem; on success returns a
 * typed module. Enforces intra-module referential integrity: child ids are
 * unique and colon-free within a kind (the root module id is a pack identity
 * and may be namespaced with ':'), `startingSceneId` resolves, location exits
 * resolve, and every intra-module reference (scene → location/npc/objective/
 * encounter/secret, hook → npc/location, objective/clock/milestone links,
 * secret reveal sites, optional location ids) resolves to a real record.
 *
 * Cross-pack references (creature/item/table `rulesRef`s, setting-compatibility
 * ids) are checked only for shape here; resolving them is the loader's job
 * (eshyra-eh54.3). This validator does not read or require any campaign state.
 */
export function validateAdventureModule(value: unknown): AdventureModule {
  const o = obj(value, 'module');
  const module: AdventureModule = {
    id: str(o.id, 'id'),
    title: str(o.title, 'title'),
    summary: str(o.summary, 'summary'),
    intendedLevels: range(o.intendedLevels, 'intendedLevels'),
    intendedPartySize: range(o.intendedPartySize, 'intendedPartySize'),
    rulesRequirements: rulesRequirements(o.rulesRequirements),
    settingCompatibility: arr(
      o.settingCompatibility,
      'settingCompatibility',
    ).map(settingCompatibility),
    startingSituation: str(o.startingSituation, 'startingSituation'),
    startingSceneId: str(o.startingSceneId, 'startingSceneId'),
    hooks: arr(o.hooks, 'hooks').map(hook),
    locations: arr(o.locations, 'locations').map(location),
    scenes: arr(o.scenes, 'scenes').map(scene),
    npcs: arr(o.npcs, 'npcs').map(npc),
    encounters: arr(o.encounters, 'encounters').map(encounter),
    treasure: arr(o.treasure, 'treasure').map(treasure),
    secrets: arr(o.secrets, 'secrets').map(secret),
    objectives: arr(o.objectives, 'objectives').map(objective),
    clocksOrThreats: arr(o.clocksOrThreats, 'clocksOrThreats').map(clock),
    randomTables: arr(o.randomTables, 'randomTables').map(randomTable),
    milestones: arr(o.milestones, 'milestones').map(milestone),
    endingStates: arr(o.endingStates, 'endingStates').map(endingState),
    provenance: provenance(o.provenance),
    license: license(o.license),
  };

  // The root module id is a pack identity and may be namespaced with ':'
  // (e.g. 'eshyra:hollow-beneath-emberfall'), matching the world `ModulePack`
  // `packId` convention. Only the child/structural ids below must stay
  // colon-free, since those may key progress overlays (eshyra-eh54.4).
  const collections: readonly [readonly { id: string }[], string][] = [
    [module.hooks, 'hooks'],
    [module.locations, 'locations'],
    [module.scenes, 'scenes'],
    [module.npcs, 'npcs'],
    [module.encounters, 'encounters'],
    [module.treasure, 'treasure'],
    [module.secrets, 'secrets'],
    [module.objectives, 'objectives'],
    [module.clocksOrThreats, 'clocksOrThreats'],
    [module.randomTables, 'randomTables'],
    [module.milestones, 'milestones'],
    [module.endingStates, 'endingStates'],
  ];
  for (const [items, path] of collections) {
    assertUniqueIds(items, path);
    assertColonFreeIds(items, path);
  }

  const locationIds = new Set(module.locations.map((l) => l.id));
  const sceneIds = new Set(module.scenes.map((s) => s.id));
  const npcIds = new Set(module.npcs.map((n) => n.id));
  const encounterIds = new Set(module.encounters.map((e) => e.id));
  const secretIds = new Set(module.secrets.map((s) => s.id));
  const objectiveIds = new Set(module.objectives.map((ob) => ob.id));

  if (!sceneIds.has(module.startingSceneId)) {
    throw new AdventureModuleError(
      `startingSceneId '${module.startingSceneId}' does not resolve to a scene`,
    );
  }

  for (const l of module.locations) {
    for (const exit of l.exits) {
      assertRef(
        locationIds,
        exit.toLocationId,
        `locations[${l.id}] exit '${exit.direction}'`,
        'location',
      );
    }
  }
  for (const h of module.hooks) {
    if (h.originNpcId !== undefined) {
      assertRef(npcIds, h.originNpcId, `hooks[${h.id}].originNpcId`, 'npc');
    }
    if (h.originLocationId !== undefined) {
      assertRef(
        locationIds,
        h.originLocationId,
        `hooks[${h.id}].originLocationId`,
        'location',
      );
    }
  }
  for (const s of module.scenes) {
    for (const ref of s.locationIds) {
      assertRef(locationIds, ref, `scenes[${s.id}].locationIds`, 'location');
    }
    for (const ref of s.npcIds) {
      assertRef(npcIds, ref, `scenes[${s.id}].npcIds`, 'npc');
    }
    for (const ref of s.objectiveIds) {
      assertRef(objectiveIds, ref, `scenes[${s.id}].objectiveIds`, 'objective');
    }
    for (const ref of s.encounterIds) {
      assertRef(encounterIds, ref, `scenes[${s.id}].encounterIds`, 'encounter');
    }
    for (const ref of s.secretIds) {
      assertRef(secretIds, ref, `scenes[${s.id}].secretIds`, 'secret');
    }
  }
  for (const n of module.npcs) {
    if (n.locationId !== undefined) {
      assertRef(
        locationIds,
        n.locationId,
        `npcs[${n.id}].locationId`,
        'location',
      );
    }
  }
  for (const e of module.encounters) {
    if (e.locationId !== undefined) {
      assertRef(
        locationIds,
        e.locationId,
        `encounters[${e.id}].locationId`,
        'location',
      );
    }
  }
  for (const t of module.treasure) {
    if (t.locationId !== undefined) {
      assertRef(
        locationIds,
        t.locationId,
        `treasure[${t.id}].locationId`,
        'location',
      );
    }
  }
  for (const s of module.secrets) {
    for (const ref of s.revealableLocationIds) {
      assertRef(
        locationIds,
        ref,
        `secrets[${s.id}].revealableLocationIds`,
        'location',
      );
    }
    for (const ref of s.revealableSceneIds) {
      assertRef(sceneIds, ref, `secrets[${s.id}].revealableSceneIds`, 'scene');
    }
  }
  for (const ob of module.objectives) {
    for (const ref of ob.relatedSceneIds) {
      assertRef(sceneIds, ref, `objectives[${ob.id}].relatedSceneIds`, 'scene');
    }
    for (const ref of ob.relatedLocationIds) {
      assertRef(
        locationIds,
        ref,
        `objectives[${ob.id}].relatedLocationIds`,
        'location',
      );
    }
  }
  for (const c of module.clocksOrThreats) {
    if (c.linkedObjectiveId !== undefined) {
      assertRef(
        objectiveIds,
        c.linkedObjectiveId,
        `clocksOrThreats[${c.id}].linkedObjectiveId`,
        'objective',
      );
    }
  }
  for (const m of module.milestones) {
    for (const ref of m.objectiveIds) {
      assertRef(
        objectiveIds,
        ref,
        `milestones[${m.id}].objectiveIds`,
        'objective',
      );
    }
  }

  return module;
}
