import type {
  AdventureModule,
  AdventureRun,
  AdventureRunProgress,
  PackLicense,
} from '../../src/internal.js';

export const TEST_MODULE_LICENSE: PackLicense = {
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
 * A small but fully cross-referenced adventure module: a two-scene cellar delve
 * with an inn and a cellar, one NPC, one encounter, one secret, two objectives
 * (one optional), and a clock. Shared by the slice-builder tests and the context
 * assembler integration test.
 */
export function makeTestAdventureModule(): AdventureModule {
  return {
    id: 'test-delve',
    title: 'A Small Test Delve',
    summary: 'A tiny scenario used to exercise the adventure context slice.',
    intendedLevels: { min: 1, max: 3 },
    intendedPartySize: { min: 1, max: 4 },
    rulesRequirements: { baseSystemId: 'dnd5e-srd' },
    settingCompatibility: [],
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
        summary: "The inn's owner.",
        secret: 'Bera sealed the cellar herself years ago.',
        locationId: 'loc-inn',
      },
    ],
    encounters: [
      {
        id: 'enc-rats',
        name: 'Glowing Rats',
        description: "Vermin warped by the cellar's light.",
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
    ],
    secrets: [
      {
        id: 'secret-shrine',
        title: 'The Sealed Shrine',
        dmText: "A shrine lies behind the cellar's false wall.",
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
        description: "The light's influence grows.",
        segments: 4,
        advanceWhen: 'The party rests or delays in the cellar.',
        resultWhenFilled: 'The shrine awakens and the rats become aberrant.',
        linkedObjectiveId: 'obj-recover',
      },
    ],
    randomTables: [],
    milestones: [],
    endingStates: [
      {
        id: 'end-sealed',
        title: 'Sealed Again',
        summary: 'The party reseals the shrine.',
        kind: 'success',
        condition: 'The shrine is sealed and the amulet secured.',
      },
    ],
    provenance: { sourceRef: 'test-fixture', note: 'In-repo schema test.' },
    license: TEST_MODULE_LICENSE,
  };
}

export const EMPTY_TEST_PROGRESS: AdventureRunProgress = {
  visitedLocations: [],
  completedOrBypassedScenes: [],
  revealedSecrets: [],
  completedObjectives: [],
  failedObjectives: [],
  encounterOutcomes: [],
  claimedTreasure: [],
  activeClocks: [],
  deviations: [],
};

/** An in-memory adventure run bound to {@link makeTestAdventureModule}. */
export function makeTestAdventureRun(
  progress: Partial<AdventureRunProgress> = {},
): AdventureRun {
  return {
    campaignId: 'camp-1',
    runId: 'run-1',
    moduleId: 'test-delve',
    status: 'active',
    startedAtSessionId: 'sess-1',
    completedAtSessionId: undefined,
    progress: { ...EMPTY_TEST_PROGRESS, ...progress },
    notes: '',
  };
}
