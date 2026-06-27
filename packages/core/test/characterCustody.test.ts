import { beforeEach, describe, expect, it } from 'vitest';
import { ABILITY_SCORE_NAMES } from '../src/character/abilities.js';
import type { AbilityScoreName } from '../src/character/creation.js';
import type {
  CharacterSheet,
  FinalizedAbilityScore,
} from '../src/character/finalizeCharacter.js';
import {
  acquireCustodyOnResume,
  CharacterCustodyError,
  type CharacterRegistryStore,
  checkoutCharacterIntoCampaign,
  createCharacterRegistryStore,
  createSqliteCharacterSheetStore,
  type Db,
  DND5E_SRD_PACK_ID,
  DND5E_SRD_SYSTEM_ID,
  ensureCharacterRegistrySchema,
  forkCharacterTimeline,
  initSchema,
  openDatabase,
  registerNewCharacter,
  releaseCharacterFromCampaign,
  syncBackCharacterFromCampaign,
} from '../src/internal.js';

function makeSheet(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const abilityScores = {} as Record<AbilityScoreName, FinalizedAbilityScore>;
  const savingThrows = {} as CharacterSheet['savingThrows'];
  for (const name of ABILITY_SCORE_NAMES) {
    abilityScores[name] = { base: 12, final: 12, modifier: 1 };
    savingThrows[name] = { modifier: 1, proficient: false };
  }
  return {
    schemaVersion: 1,
    system: DND5E_SRD_SYSTEM_ID,
    rulesPackId: DND5E_SRD_PACK_ID,
    recipeId: 'dnd5e-srd:concept-first',
    creationMode: 'concept-first',
    level: 1,
    identity: { name: 'Mira' },
    class: { key: 'class:fighter', name: 'Fighter' },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores,
    proficiencyBonus: 2,
    maxHitPoints: 12,
    savingThrows,
    skillProficiencies: ['Athletics'],
    toolProficiencies: [],
    armorProficiencies: ['light'],
    weaponProficiencies: ['simple'],
    equipment: ['chain mail'],
    languages: ['Common'],
    spells: [],
    metadata: { createdAt: '2026-06-27T00:00:00.000Z' },
    ...overrides,
  };
}

/** A fresh registry database with a deterministic clock. */
function freshRegistry(clock: () => string = () => 'now'): {
  db: Db;
  registry: CharacterRegistryStore;
} {
  const db = openDatabase(':memory:');
  ensureCharacterRegistrySchema(db);
  return { db, registry: createCharacterRegistryStore(db, clock) };
}

/** A fresh campaign database. */
function freshCampaign(): Db {
  const db = openDatabase(':memory:');
  initSchema(db);
  return db;
}

describe('registerNewCharacter', () => {
  it('seeds revision 1 as the registry head', () => {
    const { registry } = freshRegistry();
    const revision = registerNewCharacter(registry, {
      globalCharacterId: 'mira',
      sheet: makeSheet(),
    });
    expect(revision.revision).toBe(1);
    expect(revision.source).toBe('register');
    expect(registry.headRevision('mira')).toBe(1);
    expect(registry.listRevisions('mira').map((r) => r.revision)).toEqual([1]);
    expect(registry.load('mira')?.identity.name).toBe('Mira');
  });
});

describe('character custody lifecycle', () => {
  let registry: CharacterRegistryStore;
  let campaign: Db;

  beforeEach(() => {
    registry = freshRegistry().registry;
    campaign = freshCampaign();
  });

  it('checks out a registered character with custody + source-revision stamp', () => {
    registerNewCharacter(registry, {
      globalCharacterId: 'mira',
      sheet: makeSheet(),
    });

    const result = checkoutCharacterIntoCampaign(registry, campaign, {
      globalCharacterId: 'mira',
      campaignId: 'camp-a',
      characterId: 'pc-1',
      sessionId: 'session-1',
      at: '2026-06-27T12:00:00.000Z',
    });
    expect(result.attach.ok).toBe(true);
    expect(result.revision).toBe(1);

    // Custody (the cross-DB lock) is recorded against the campaign.
    expect(registry.custody('mira')).toEqual({
      globalCharacterId: 'mira',
      campaignId: 'camp-a',
      characterId: 'pc-1',
      revision: 1,
      attachedAt: '2026-06-27T12:00:00.000Z',
    });

    // The campaign sheet is stamped with the checked-out revision + provenance.
    const sheet = createSqliteCharacterSheetStore(campaign).load('pc-1');
    expect(sheet?.metadata.globalCharacterId).toBe('mira');
    expect(sheet?.metadata.sourceRevision).toBe(1);
  });

  it('runs checkout -> play -> sync-back -> re-checkout, advancing the timeline', () => {
    registerNewCharacter(registry, {
      globalCharacterId: 'mira',
      sheet: makeSheet({ level: 1 }),
    });

    // Checkout into campaign A.
    checkoutCharacterIntoCampaign(registry, campaign, {
      globalCharacterId: 'mira',
      campaignId: 'camp-a',
      characterId: 'pc-1',
      sessionId: 'session-1',
      at: 'a1',
    });

    // Play: the campaign sheet is the authority during play; level up to 2.
    const campaignSheets = createSqliteCharacterSheetStore(campaign);
    const played = campaignSheets.load('pc-1') as CharacterSheet;
    campaignSheets.save('pc-1', { ...played, level: 2 });

    // Exit campaign A: release commits a new registry revision + drops custody.
    const released = releaseCharacterFromCampaign(registry, campaign, {
      campaignId: 'camp-a',
      characterId: 'pc-1',
    });
    expect(released).toEqual({
      globalCharacterId: 'mira',
      revision: 2,
      committed: true,
    });
    expect(registry.custody('mira')).toBeUndefined();
    expect(registry.headRevision('mira')).toBe(2);
    expect(registry.load('mira')?.level).toBe(2);
    expect(registry.listRevisions('mira').map((r) => r.source)).toEqual([
      'register',
      'sync-back',
    ]);

    // Re-checkout (into a different campaign now that it is idle) gets the
    // advanced level-2 head.
    const campaignB = freshCampaign();
    const recheckout = checkoutCharacterIntoCampaign(registry, campaignB, {
      globalCharacterId: 'mira',
      campaignId: 'camp-b',
      characterId: 'pc-1',
      sessionId: 'session-2',
      at: 'b1',
    });
    expect(recheckout.revision).toBe(2);
    expect(createSqliteCharacterSheetStore(campaignB).load('pc-1')?.level).toBe(
      2,
    );
  });

  it('does not append a revision when the campaign sheet is unchanged', () => {
    registerNewCharacter(registry, {
      globalCharacterId: 'mira',
      sheet: makeSheet(),
    });
    checkoutCharacterIntoCampaign(registry, campaign, {
      globalCharacterId: 'mira',
      campaignId: 'camp-a',
      characterId: 'pc-1',
      sessionId: 'session-1',
      at: 'a1',
    });

    const result = syncBackCharacterFromCampaign(registry, campaign, {
      campaignId: 'camp-a',
      characterId: 'pc-1',
    });
    expect(result).toEqual({
      globalCharacterId: 'mira',
      revision: 1,
      committed: false,
    });
    expect(registry.headRevision('mira')).toBe(1);
  });

  it('prevents a silent double-attach to a second active campaign', () => {
    registerNewCharacter(registry, {
      globalCharacterId: 'mira',
      sheet: makeSheet(),
    });
    checkoutCharacterIntoCampaign(registry, campaign, {
      globalCharacterId: 'mira',
      campaignId: 'camp-a',
      characterId: 'pc-1',
      sessionId: 'session-1',
      at: 'a1',
    });

    const campaignB = freshCampaign();
    expect(() =>
      checkoutCharacterIntoCampaign(registry, campaignB, {
        globalCharacterId: 'mira',
        campaignId: 'camp-b',
        characterId: 'pc-1',
        sessionId: 'session-2',
        at: 'b1',
      }),
    ).toThrow(CharacterCustodyError);
    // Nothing was attached into campaign B.
    expect(
      createSqliteCharacterSheetStore(campaignB).load('pc-1'),
    ).toBeUndefined();
    // Custody still belongs to campaign A.
    expect(registry.custody('mira')?.campaignId).toBe('camp-a');
  });

  it('allows idempotent re-checkout into the same campaign (resume)', () => {
    registerNewCharacter(registry, {
      globalCharacterId: 'mira',
      sheet: makeSheet(),
    });
    checkoutCharacterIntoCampaign(registry, campaign, {
      globalCharacterId: 'mira',
      campaignId: 'camp-a',
      characterId: 'pc-1',
      sessionId: 'session-1',
      at: 'a1',
    });
    expect(() =>
      checkoutCharacterIntoCampaign(registry, campaign, {
        globalCharacterId: 'mira',
        campaignId: 'camp-a',
        characterId: 'pc-1',
        sessionId: 'session-2',
        at: 'a2',
      }),
    ).not.toThrow();
    expect(registry.custody('mira')?.attachedAt).toBe('a2');
  });

  it('lazily seeds a revision for a legacy save()-only character on checkout', () => {
    // A 14.2-era character written through the low-level head writer has a head
    // sheet but no revision timeline yet.
    registry.save('legacy', makeSheet({ identity: { name: 'Legacy' } }));
    expect(registry.headRevision('legacy')).toBeUndefined();

    const result = checkoutCharacterIntoCampaign(registry, campaign, {
      globalCharacterId: 'legacy',
      campaignId: 'camp-a',
      characterId: 'pc-1',
      sessionId: 'session-1',
      at: 'a1',
    });
    expect(result.revision).toBe(1);
    expect(registry.listRevisions('legacy').map((r) => r.source)).toEqual([
      'register',
    ]);
  });

  it('throws when checking out an unregistered character', () => {
    expect(() =>
      checkoutCharacterIntoCampaign(registry, campaign, {
        globalCharacterId: 'ghost',
        campaignId: 'camp-a',
        sessionId: 'session-1',
        at: 'a1',
      }),
    ).toThrow(CharacterCustodyError);
  });

  it('sync-back is a no-op for a character not linked to the registry', () => {
    // A campaign sheet with no globalCharacterId (created directly in-campaign).
    createSqliteCharacterSheetStore(campaign).save('pc-1', makeSheet());
    expect(
      syncBackCharacterFromCampaign(registry, campaign, {
        campaignId: 'camp-a',
        characterId: 'pc-1',
      }),
    ).toBeUndefined();
  });

  it('rejects re-checkout into the same campaign under a different party slot', () => {
    // /addpc allocates the next pc-<n>; importing the same registry character a
    // second time must not create a duplicate playable copy of one identity.
    registerNewCharacter(registry, {
      globalCharacterId: 'mira',
      sheet: makeSheet(),
    });
    checkoutCharacterIntoCampaign(registry, campaign, {
      globalCharacterId: 'mira',
      campaignId: 'camp-a',
      characterId: 'pc-1',
      sessionId: 'session-1',
      at: 'a1',
    });
    expect(() =>
      checkoutCharacterIntoCampaign(registry, campaign, {
        globalCharacterId: 'mira',
        campaignId: 'camp-a',
        characterId: 'pc-2',
        sessionId: 'session-1',
        at: 'a2',
      }),
    ).toThrow(CharacterCustodyError);
    expect(registry.custody('mira')?.characterId).toBe('pc-1');
    expect(
      createSqliteCharacterSheetStore(campaign).load('pc-2'),
    ).toBeUndefined();
  });

  it('a stale campaign cannot clear or sync over a holder that took the character', () => {
    // A checks mira out, then releases on /quit (custody idle).
    registerNewCharacter(registry, {
      globalCharacterId: 'mira',
      sheet: makeSheet({ level: 1 }),
    });
    checkoutCharacterIntoCampaign(registry, campaign, {
      globalCharacterId: 'mira',
      campaignId: 'camp-a',
      characterId: 'pc-1',
      sessionId: 'session-1',
      at: 'a1',
    });
    releaseCharacterFromCampaign(registry, campaign, {
      campaignId: 'camp-a',
      characterId: 'pc-1',
    });

    // B now checks mira out and holds custody.
    const campaignB = freshCampaign();
    checkoutCharacterIntoCampaign(registry, campaignB, {
      globalCharacterId: 'mira',
      campaignId: 'camp-b',
      characterId: 'pc-1',
      sessionId: 'session-2',
      at: 'b1',
    });
    const headBefore = registry.headRevision('mira');

    // A's stale campaign DB still has the mira sheet. A /quit there must NOT
    // clear B's lock or append a stale (reverting) revision.
    const released = releaseCharacterFromCampaign(registry, campaign, {
      campaignId: 'camp-a',
      characterId: 'pc-1',
    });
    expect(released).toBeUndefined();
    expect(registry.custody('mira')?.campaignId).toBe('camp-b');
    expect(registry.headRevision('mira')).toBe(headBefore);
  });
});

describe('acquireCustodyOnResume', () => {
  let registry: CharacterRegistryStore;
  let campaign: Db;

  beforeEach(() => {
    registry = freshRegistry().registry;
    campaign = freshCampaign();
  });

  /** Check `globalCharacterId` out into `campaign` as `camp-a`/`pc-1`. */
  function checkoutMira(): void {
    registerNewCharacter(registry, {
      globalCharacterId: 'mira',
      sheet: makeSheet(),
    });
    checkoutCharacterIntoCampaign(registry, campaign, {
      globalCharacterId: 'mira',
      campaignId: 'camp-a',
      characterId: 'pc-1',
      sessionId: 'session-1',
      at: 'a1',
    });
  }

  it('reports already-held for a character custody was just taken of', () => {
    checkoutMira();
    expect(
      acquireCustodyOnResume(registry, campaign, {
        campaignId: 'camp-a',
        characterId: 'pc-1',
        at: 'a2',
      }),
    ).toBe('already-held');
  });

  it('re-acquires an idle lock on resume after a clean release', () => {
    checkoutMira();
    releaseCharacterFromCampaign(registry, campaign, {
      campaignId: 'camp-a',
      characterId: 'pc-1',
    });
    expect(registry.custody('mira')).toBeUndefined();

    expect(
      acquireCustodyOnResume(registry, campaign, {
        campaignId: 'camp-a',
        characterId: 'pc-1',
        at: 'a3',
      }),
    ).toBe('acquired');
    expect(registry.custody('mira')).toMatchObject({
      campaignId: 'camp-a',
      characterId: 'pc-1',
    });
  });

  it('returns not-linked for a directly-created (unlinked) campaign sheet', () => {
    createSqliteCharacterSheetStore(campaign).save('pc-1', makeSheet());
    expect(
      acquireCustodyOnResume(registry, campaign, {
        campaignId: 'camp-a',
        characterId: 'pc-1',
        at: 'a1',
      }),
    ).toBe('not-linked');
  });

  it('fails closed when another campaign holds the character', () => {
    checkoutMira();
    releaseCharacterFromCampaign(registry, campaign, {
      campaignId: 'camp-a',
      characterId: 'pc-1',
    });
    const campaignB = freshCampaign();
    checkoutCharacterIntoCampaign(registry, campaignB, {
      globalCharacterId: 'mira',
      campaignId: 'camp-b',
      characterId: 'pc-1',
      sessionId: 'session-2',
      at: 'b1',
    });

    // Campaign A resuming must refuse rather than steal B's custody.
    expect(() =>
      acquireCustodyOnResume(registry, campaign, {
        campaignId: 'camp-a',
        characterId: 'pc-1',
        at: 'a3',
      }),
    ).toThrow(CharacterCustodyError);
    expect(registry.custody('mira')?.campaignId).toBe('camp-b');
  });

  it('fails closed when the registry head has advanced past this campaign copy', () => {
    checkoutMira();
    releaseCharacterFromCampaign(registry, campaign, {
      campaignId: 'camp-a',
      characterId: 'pc-1',
    });
    // Simulate the character advancing in another campaign: the registry head
    // moves ahead of campaign A's stale sheet.
    registry.appendRevision('mira', makeSheet({ level: 9 }), 'sync-back');

    expect(() =>
      acquireCustodyOnResume(registry, campaign, {
        campaignId: 'camp-a',
        characterId: 'pc-1',
        at: 'a3',
      }),
    ).toThrow(CharacterCustodyError);
    expect(registry.custody('mira')).toBeUndefined();
  });
});

describe('forkCharacterTimeline', () => {
  let registry: CharacterRegistryStore;

  beforeEach(() => {
    registry = freshRegistry().registry;
  });

  it('branches an alternate timeline into a new id with parent provenance', () => {
    registerNewCharacter(registry, {
      globalCharacterId: 'mira',
      sheet: makeSheet({ level: 1 }),
    });
    registry.appendRevision('mira', makeSheet({ level: 2 }), 'sync-back');

    const fork = forkCharacterTimeline(registry, {
      sourceGlobalCharacterId: 'mira',
      newGlobalCharacterId: 'mira-alt',
    });
    expect(fork.revision.revision).toBe(1);
    expect(fork.revision.source).toBe('fork');
    expect(fork.revision.parent).toEqual({
      globalCharacterId: 'mira',
      revision: 2,
    });
    // The fork carries the source head's sheet but is an independent timeline.
    expect(registry.load('mira-alt')?.level).toBe(2);

    // Continuity is broken: advancing the fork does not touch the source.
    registry.appendRevision('mira-alt', makeSheet({ level: 3 }), 'sync-back');
    expect(registry.headRevision('mira-alt')).toBe(2);
    expect(registry.headRevision('mira')).toBe(2);
    expect(registry.load('mira')?.level).toBe(2);
  });

  it('can fork from an explicit earlier revision', () => {
    registerNewCharacter(registry, {
      globalCharacterId: 'mira',
      sheet: makeSheet({ level: 1 }),
    });
    registry.appendRevision('mira', makeSheet({ level: 5 }), 'sync-back');

    const fork = forkCharacterTimeline(registry, {
      sourceGlobalCharacterId: 'mira',
      newGlobalCharacterId: 'mira-young',
      fromRevision: 1,
    });
    expect(fork.revision.parent?.revision).toBe(1);
    expect(registry.load('mira-young')?.level).toBe(1);
  });

  it('refuses to fork onto an id that already has a timeline', () => {
    registerNewCharacter(registry, {
      globalCharacterId: 'mira',
      sheet: makeSheet(),
    });
    registerNewCharacter(registry, {
      globalCharacterId: 'taken',
      sheet: makeSheet(),
    });
    expect(() =>
      forkCharacterTimeline(registry, {
        sourceGlobalCharacterId: 'mira',
        newGlobalCharacterId: 'taken',
      }),
    ).toThrow(CharacterCustodyError);
  });

  it('throws when the source has no revisions to fork from', () => {
    expect(() =>
      forkCharacterTimeline(registry, {
        sourceGlobalCharacterId: 'ghost',
        newGlobalCharacterId: 'ghost-alt',
      }),
    ).toThrow(CharacterCustodyError);
  });
});
