/** eshyra-olv1: recast_bonded_summon accepts Pact of the Chain's special
 * familiar forms only for a character caster whose sheet records the pick. */
import { describe, expect, it } from 'vitest';
import type { CharacterSheet, ToolContext } from '../src/internal.js';
import {
  createDefaultToolRegistry,
  createSeededRng,
  createSqliteCharacterSheetStore,
} from '../src/internal.js';
import { lookupCampaignRecord } from '../src/state/campaignRecordLookup.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const AT = '2026-05-20T10:00:00.000Z';

function sheetWith(
  featureChoices: CharacterSheet['featureChoices'],
): CharacterSheet {
  return {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    rulesPackId: 'rules:dnd5e-srd-5.1',
    recipeId: 'dnd5e-srd-character',
    creationMode: 'test',
    level: 3,
    identity: { name: 'Caster' },
    class: { key: 'class:warlock', name: 'Warlock' },
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores: {},
    proficiencyBonus: 2,
    maxHitPoints: 20,
    savingThrows: {},
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: [],
    spells: [],
    ...(featureChoices ? { featureChoices } : {}),
    metadata: { createdAt: AT },
  } as unknown as CharacterSheet;
}

const pick = (optionId: string): CharacterSheet['featureChoices'] => [
  {
    featureRef: 'feature:warlock:pact-boon',
    choiceId: 'pact-boon',
    optionIds: [optionId],
    level: 3,
  },
];

function bondedFamiliar(featureChoices: CharacterSheet['featureChoices']) {
  const db = freshDbWithSession();
  db.prepare(
    `INSERT INTO character(id, name, class_name, level, hp_current, hp_max, ability_scores_json, role, provenance, session_id, updated_at)
     VALUES ('pc-9', 'Caster', 'Warlock', 3, 20, 20, ?, 'pc', 'test', ?, ?)`,
  ).run(
    JSON.stringify({
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    }),
    DEFAULT_TEST_SESSION_ID,
    AT,
  );
  createSqliteCharacterSheetStore(db).save('pc-9', sheetWith(featureChoices));
  const registry = createDefaultToolRegistry();
  const ctx: ToolContext = {
    db,
    rng: createSeededRng(5),
    campaignId: DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: DEFAULT_TEST_SESSION_ID,
    turnId: 'olv1',
    at: AT,
  };
  const call = (name: string, args: unknown) =>
    registry.invoke(name, args, ctx);
  const must = (name: string, args: unknown) => {
    const r = call(name, args);
    if (!r.ok) throw new Error(`${name} failed: ${r.message}`);
    return r;
  };
  must('start_encounter', {
    combatInstanceId: 'c',
    actors: [
      {
        actorId: 'fam',
        rulesRef: 'creature:bat',
        hpMax: 1,
        hpCurrent: 1,
        side: 'ally',
      },
    ],
  });
  must('start_effect', {
    effectId: 'fam-fx',
    kind: 'summoning',
    displayName: 'familiar',
    source: {
      kind: 'spell',
      ref: 'spell:find-familiar',
      actor: { kind: 'character', ref: 'pc-9' },
    },
    duration: { kind: 'until-removed' },
    actors: [{ combatantId: 'c-fam', campaignActorId: 'fam' }],
  });
  must('close_combat_instance', { status: 'completed' });
  return (form: string) =>
    call('recast_bonded_summon', {
      effectId: 'fam-fx',
      spellRef: 'spell:find-familiar',
      form,
    });
}

describe('Pact of the Chain familiar forms', () => {
  it('the pack carries the four curated Find Familiar forms on the option', () => {
    const choices = lookupCampaignRecord(
      freshDbWithSession(),
      'feature',
      'feature:warlock:pact-boon',
      undefined,
    )?.data as { choices?: { options?: { id: string }[] }[] } | undefined;
    const occurrence = {
      option: choices?.choices?.[0]?.options?.find(
        (o) => o.id === 'pact-boon:pact-of-the-chain',
      ),
    };
    expect(
      (occurrence?.option as { summonFormExtensions?: unknown } | undefined)
        ?.summonFormExtensions,
    ).toEqual([
      {
        spell: 'spell:find-familiar',
        forms: ['imp', 'pseudodragon', 'quasit', 'sprite'].map((name) => ({
          name,
          creatureRef: `creature:${name}`,
        })),
      },
    ]);
  });

  it('lets a chain warlock reform the familiar into an imp', () => {
    const recast = bondedFamiliar(pick('pact-boon:pact-of-the-chain'));
    const r = recast('creature:imp');
    expect(r.ok).toBe(true);
    expect(r.ok && r.data).toMatchObject({ rulesRef: 'creature:imp' });
  });

  it.each([
    ['a caster with no pact pick', undefined],
    ['a Pact of the Tome warlock', pick('pact-boon:pact-of-the-tome')],
  ])('refuses imp for %s and lists the normal forms', (_label, choices) => {
    const r = bondedFamiliar(choices)('creature:imp');
    expect(r.ok).toBe(false);
    const msg = JSON.stringify(r);
    expect(msg).toMatch(/not one of the forms/);
    expect(msg).toMatch(/creature:owl/);
    expect(msg).not.toMatch(/creature:quasit/);
  });
});
