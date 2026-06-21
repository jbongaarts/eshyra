import { describe, expect, it } from 'vitest';
import {
  type AdventureModule,
  AdventureModuleError,
  type PackLicense,
  validateAdventureModule,
} from '../src/internal.js';

const license: PackLicense = {
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

/**
 * A small but fully cross-referenced valid module: scenes point at locations /
 * npcs / objectives / encounters / secrets, a hook names an NPC and a location,
 * a clock pressures an objective, a milestone groups objectives, and a secret
 * is revealable at a location and a scene. Used as the happy-path fixture and
 * as the base for broken-reference mutations.
 */
function makeValidModule(): AdventureModule {
  return {
    id: 'test-delve',
    title: 'A Small Test Delve',
    summary: 'A tiny scenario used to exercise the adventure module schema.',
    intendedLevels: { min: 1, max: 3 },
    intendedPartySize: { min: 1, max: 4 },
    rulesRequirements: { baseSystemId: 'dnd5e-srd' },
    settingCompatibility: [
      {
        settingPackId: 'eshyra:emberfall',
        anchorLocationId: 'emberfall-square',
      },
    ],
    startingSituation:
      'A wanderer arrives as strange lights flicker in the cellar.',
    startingSceneId: 'scene-arrival',
    hooks: [
      {
        id: 'hook-rumor',
        title: 'A worried innkeeper',
        text: 'The innkeeper begs the party to investigate the cellar.',
        originNpcId: 'npc-innkeeper',
        originLocationId: 'loc-inn',
      },
    ],
    locations: [
      {
        id: 'loc-inn',
        name: 'The Quiet Tankard',
        summary: 'A village inn.',
        description: 'A low-beamed common room smelling of woodsmoke.',
        exits: [{ direction: 'down', toLocationId: 'loc-cellar' }],
        tags: ['safe', 'social'],
      },
      {
        id: 'loc-cellar',
        name: 'The Flickering Cellar',
        summary: 'A cellar with an unnatural glow.',
        description: 'Stone steps descend into a cold, faintly lit cellar.',
        exits: [
          { direction: 'up', toLocationId: 'loc-inn', requirement: 'none' },
        ],
        tags: ['dungeon'],
      },
    ],
    scenes: [
      {
        id: 'scene-arrival',
        title: 'Arrival',
        summary: 'The party meets the innkeeper.',
        kind: 'social',
        locationIds: ['loc-inn'],
        npcIds: ['npc-innkeeper'],
        objectiveIds: ['obj-investigate'],
        encounterIds: [],
        secretIds: [],
      },
      {
        id: 'scene-cellar',
        title: 'Into the Cellar',
        summary: 'The party descends and faces what lurks below.',
        kind: 'combat',
        locationIds: ['loc-cellar'],
        npcIds: [],
        objectiveIds: ['obj-investigate', 'obj-recover'],
        encounterIds: ['enc-rats'],
        secretIds: ['secret-shrine'],
      },
    ],
    npcs: [
      {
        id: 'npc-innkeeper',
        name: 'Bera',
        role: 'quest-giver',
        disposition: 'anxious',
        summary: 'The inn’s owner.',
        secret: 'Bera sealed the cellar herself years ago.',
        locationId: 'loc-inn',
      },
    ],
    encounters: [
      {
        id: 'enc-rats',
        name: 'Glowing Rats',
        description: 'Vermin warped by the cellar’s light.',
        creatures: [
          { rulesRef: 'creature:giant-rat', count: 3, role: 'minion' },
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
    secrets: [
      {
        id: 'secret-shrine',
        title: 'The Sealed Shrine',
        dmText: 'A shrine lies behind the cellar’s false wall.',
        revealableLocationIds: ['loc-cellar'],
        revealableSceneIds: ['scene-cellar'],
      },
    ],
    objectives: [
      {
        id: 'obj-investigate',
        title: 'Investigate the cellar',
        description: 'Find the source of the lights.',
        optional: false,
        successCondition:
          'The party reaches the cellar and identifies the cause.',
        relatedSceneIds: ['scene-arrival', 'scene-cellar'],
        relatedLocationIds: ['loc-cellar'],
      },
      {
        id: 'obj-recover',
        title: 'Recover the amulet',
        description: 'Claim the amulet before it corrupts further.',
        optional: true,
        successCondition: 'The amulet is claimed.',
        failureCondition: 'The amulet is destroyed.',
        relatedSceneIds: ['scene-cellar'],
        relatedLocationIds: ['loc-cellar'],
      },
    ],
    clocksOrThreats: [
      {
        id: 'clock-corruption',
        name: 'Spreading Corruption',
        description: 'The light’s influence grows.',
        segments: 4,
        advanceWhen: 'The party rests or delays in the cellar.',
        resultWhenFilled: 'The shrine awakens and the rats become aberrant.',
        linkedObjectiveId: 'obj-recover',
      },
    ],
    randomTables: [
      {
        id: 'rt-cellar-noises',
        title: 'Cellar Noises',
        rulesRef: 'table:dungeon-ambience',
      },
    ],
    milestones: [
      {
        id: 'ms-cleared',
        title: 'Cellar Cleared',
        description: 'The immediate threat is dealt with.',
        objectiveIds: ['obj-investigate'],
      },
    ],
    endingStates: [
      {
        id: 'end-sealed',
        title: 'Sealed Again',
        summary: 'The party reseals the shrine.',
        kind: 'success',
        condition: 'The shrine is sealed and the amulet secured.',
      },
      {
        id: 'end-loosed',
        title: 'Loosed',
        summary: 'The shrine’s power escapes into the village.',
        kind: 'failure',
        condition: 'The corruption clock fills before the shrine is sealed.',
      },
    ],
    provenance: { sourceRef: 'test-fixture', note: 'In-repo schema test.' },
    license,
  };
}

/** Deep clone so a broken-reference mutation cannot leak between tests. */
function clone(): AdventureModule {
  return structuredClone(makeValidModule());
}

describe('validateAdventureModule', () => {
  it('accepts a small valid module and returns a typed record', () => {
    const module = validateAdventureModule(makeValidModule());
    expect(module.id).toBe('test-delve');
    expect(module.scenes).toHaveLength(2);
    expect(module.objectives).toHaveLength(2);
    expect(module.startingSceneId).toBe('scene-arrival');
  });

  it('accepts a module with optional fields omitted', () => {
    const base = clone() as unknown as { npcs: Record<string, unknown>[] };
    // treasure-coins already has no rulesRef/locationId; rebuild the npc
    // without its optional locationId to exercise the omitted-optional path.
    base.npcs[0] = {
      id: 'npc-innkeeper',
      name: 'Bera',
      role: 'quest-giver',
      disposition: 'anxious',
      summary: 'The inn’s owner.',
      secret: 'Bera sealed the cellar herself years ago.',
    };
    expect(() => validateAdventureModule(base)).not.toThrow();
  });

  it('drops campaign-progress fields not in the schema (authored source only)', () => {
    const base = clone() as unknown as Record<string, unknown>;
    // Simulate a malformed source that tries to smuggle progress in.
    (base.secrets as Array<Record<string, unknown>>)[0].revealed = true;
    (base.objectives as Array<Record<string, unknown>>)[0].completed = true;
    const module = validateAdventureModule(base);
    expect(
      (module.secrets[0] as Record<string, unknown>).revealed,
    ).toBeUndefined();
    expect(
      (module.objectives[0] as Record<string, unknown>).completed,
    ).toBeUndefined();
  });

  it('rejects a non-object', () => {
    expect(() => validateAdventureModule(null)).toThrow(AdventureModuleError);
    expect(() => validateAdventureModule('nope')).toThrow(/must be an object/);
  });

  it('rejects an inverted intendedLevels range', () => {
    const base = clone();
    base.intendedLevels = { min: 5, max: 2 };
    expect(() => validateAdventureModule(base)).toThrow(/intendedLevels.max/);
  });

  it('rejects an unknown license class', () => {
    const base = clone() as unknown as { license: { licenseClass: string } };
    base.license.licenseClass = 'fair-use';
    expect(() => validateAdventureModule(base)).toThrow(/licenseClass/);
  });

  it('rejects an unknown scene kind', () => {
    const base = clone() as unknown as { scenes: { kind: string }[] };
    base.scenes[0].kind = 'puzzle';
    expect(() => validateAdventureModule(base)).toThrow(/scenes\[0\].kind/);
  });

  it('rejects duplicate ids within a kind', () => {
    const base = clone();
    base.locations[1] = { ...base.locations[1], id: 'loc-inn' };
    expect(() => validateAdventureModule(base)).toThrow(/duplicate id/);
  });

  it('rejects an id containing a colon', () => {
    const base = clone();
    base.locations[0] = { ...base.locations[0], id: 'loc:inn' };
    expect(() => validateAdventureModule(base)).toThrow(/must not contain/);
  });

  it('rejects a startingSceneId that does not resolve', () => {
    const base = clone();
    base.startingSceneId = 'scene-missing';
    expect(() => validateAdventureModule(base)).toThrow(/startingSceneId/);
  });

  it('rejects a location exit to an unknown location', () => {
    const base = clone();
    base.locations[0].exits[0] = {
      ...base.locations[0].exits[0],
      toLocationId: 'loc-nowhere',
    };
    expect(() => validateAdventureModule(base)).toThrow(/unknown location/);
  });

  it('rejects a scene objective reference to an unknown objective', () => {
    const base = clone();
    base.scenes[0].objectiveIds = ['obj-ghost'];
    expect(() => validateAdventureModule(base)).toThrow(
      /scenes\[scene-arrival\].objectiveIds references unknown objective/,
    );
  });

  it('rejects a scene npc reference to an unknown npc', () => {
    const base = clone();
    base.scenes[0].npcIds = ['npc-ghost'];
    expect(() => validateAdventureModule(base)).toThrow(/unknown npc/);
  });

  it('rejects a hook origin npc that does not resolve', () => {
    const base = clone();
    base.hooks[0].originNpcId = 'npc-ghost';
    expect(() => validateAdventureModule(base)).toThrow(
      /hooks\[hook-rumor\].originNpcId references unknown npc/,
    );
  });

  it('rejects a secret revealable scene that does not resolve', () => {
    const base = clone();
    base.secrets[0].revealableSceneIds = ['scene-ghost'];
    expect(() => validateAdventureModule(base)).toThrow(/unknown scene/);
  });

  it('rejects a clock linked to an unknown objective', () => {
    const base = clone();
    base.clocksOrThreats[0].linkedObjectiveId = 'obj-ghost';
    expect(() => validateAdventureModule(base)).toThrow(
      /clocksOrThreats\[clock-corruption\].linkedObjectiveId references unknown objective/,
    );
  });

  it('rejects a milestone referencing an unknown objective', () => {
    const base = clone();
    base.milestones[0].objectiveIds = ['obj-ghost'];
    expect(() => validateAdventureModule(base)).toThrow(
      /milestones\[ms-cleared\].objectiveIds references unknown objective/,
    );
  });

  it('rejects an encounter creature missing a rulesRef', () => {
    const base = clone() as unknown as {
      encounters: { creatures: Record<string, unknown>[] }[];
    };
    // Rebuild the creature slot without rulesRef.
    base.encounters[0].creatures[0] = { count: 3, role: 'minion' };
    expect(() => validateAdventureModule(base)).toThrow(/rulesRef/);
  });
});
