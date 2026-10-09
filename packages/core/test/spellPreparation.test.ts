// Long-rest spell preparation (eshyra-odpc) against the real bundled SRD pack.

import { describe, expect, it } from 'vitest';
import type { CharacterSheet } from '../src/internal.js';
import {
  advanceWorldTime,
  completeLongRest,
  completeShortRest,
  createDefaultToolRegistry,
  createSeededRng,
  createSqliteCharacterSheetStore,
  getBundledDnd5eCharacterResolver,
  prepareSpellsAfterLongRest,
  startEncounter,
} from '../src/internal.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const AT = '2026-07-14T00:00:00.000Z';
const CTX = {
  campaignId: DEFAULT_TEST_CAMPAIGN_ID,
  provenance: 'test:prep',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: AT,
};
const LONG = {
  durationMinutes: 480,
  sleepMinutes: 360,
  lightActivityMinutes: 0,
  strenuousInterruptionMinutes: 0,
  foodAndDrink: false,
};
const ABILITIES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;
const resolver = getBundledDnd5eCharacterResolver();

function sheetOf(o: {
  classKey: string;
  className: string;
  level: number;
  subclass?: { key: string; name: string };
  modifiers?: Partial<Record<(typeof ABILITIES)[number], number>>;
  spellcasting?: CharacterSheet['spellcasting'];
  featureChoices?: CharacterSheet['featureChoices'];
}): CharacterSheet {
  const abilityScores = {} as CharacterSheet['abilityScores'];
  const savingThrows = {} as CharacterSheet['savingThrows'];
  for (const name of ABILITIES) {
    const modifier = o.modifiers?.[name] ?? 0;
    abilityScores[name] = { base: 10, final: 10 + modifier * 2, modifier };
    savingThrows[name] = { modifier: 0, proficient: false };
  }
  return {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    rulesPackId: 'rules:dnd5e-srd-5.1',
    recipeId: 'dnd5e-srd-character',
    creationMode: 'test',
    level: o.level,
    identity: { name: 'Test Hero' },
    class: { key: o.classKey, name: o.className },
    ...(o.subclass ? { subclass: o.subclass } : {}),
    ancestry: { key: 'ancestry:human', name: 'Human' },
    abilityScores,
    proficiencyBonus: 2,
    maxHitPoints: 30,
    savingThrows,
    skillProficiencies: [],
    toolProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    equipment: [],
    languages: [],
    spells: [],
    ...(o.spellcasting ? { spellcasting: o.spellcasting } : {}),
    ...(o.featureChoices ? { featureChoices: o.featureChoices } : {}),
    metadata: { createdAt: AT },
  } as CharacterSheet;
}

/** DB with `pc-1` holding `sheet`, who has just finished long rest `rest-1`. */
function rested(sheet: CharacterSheet, kind: 'long' | 'short' = 'long') {
  const db = freshDbWithSession();
  db.prepare(
    `INSERT INTO character(id, name, class_name, level, hp_current, hp_max, ability_scores_json, role, provenance, session_id, updated_at)
     VALUES ('pc-2', 'Other', 'Fighter', 1, 10, 30, ?, 'pc', ?, ?, ?)`,
  ).run(JSON.stringify(sheet.abilityScores), CTX.provenance, CTX.sessionId, AT);
  createSqliteCharacterSheetStore(db).save('pc-1', sheet);
  db.prepare(
    'UPDATE character SET level = ?, hp_current = 10, hp_max = 30 WHERE id = ?',
  ).run(sheet.level, 'pc-1');
  createSqliteCharacterSheetStore(db).save('pc-2', sheet);
  db.prepare('UPDATE character SET level = ? WHERE id = ?').run(
    sheet.level,
    'pc-2',
  );
  if (kind === 'long') {
    completeLongRest(db, {
      ...CTX,
      restId: 'rest-1',
      participants: ['pc-1'],
      qualification: LONG,
    });
  } else {
    completeShortRest(db, {
      ...CTX,
      restId: 'rest-1',
      participants: ['pc-1'],
      qualification: { durationMinutes: 60, strenuousActivity: false },
    });
  }
  return db;
}

function prepare(
  db: ReturnType<typeof freshDbWithSession>,
  spellRefs: readonly string[],
  extra: { characterId?: string; restId?: string } = {},
) {
  return prepareSpellsAfterLongRest(db, {
    campaignId: CTX.campaignId,
    characterId: extra.characterId ?? 'pc-1',
    restId: extra.restId ?? 'rest-1',
    spellRefs,
  });
}

function stored(db: ReturnType<typeof freshDbWithSession>) {
  return createSqliteCharacterSheetStore(db).load('pc-1') as CharacterSheet;
}

/** The first `n` pack spells of `level` on `className`'s list (stable order). */
function spellsOf(className: string, level: number, n: number): string[] {
  return resolver
    .listSpells()
    .filter((s) => s.level === level && s.classes.includes(className))
    .slice(0, n)
    .map((s) => s.key);
}

const cleric = (extra: Partial<Parameters<typeof sheetOf>[0]> = {}) =>
  sheetOf({
    classKey: 'class:cleric',
    className: 'Cleric',
    level: 5,
    modifiers: { wisdom: 3 },
    spellcasting: { cantrips: [] },
    ...extra,
  });

describe('long-rest spell preparation', () => {
  it('cleric: WIS mod + level limit, persists prepared + union, replaces on repeat', () => {
    const db = rested(cleric());
    const l1 = spellsOf('Cleric', 1, 9);
    expect(() => prepare(db, l1)).toThrow(/between 1 and 8/);
    expect(stored(db).spellcasting?.prepared).toBeUndefined();
    const result = prepare(db, l1.slice(0, 8));
    expect(result.limit).toBe(8);
    expect(stored(db).spellcasting?.prepared).toEqual(l1.slice(0, 8));
    expect([...stored(db).spells].sort()).toEqual([...l1.slice(0, 8)].sort());
    const second = prepare(db, [l1[8] as string]);
    expect(second.previouslyPrepared).toEqual(l1.slice(0, 8));
    expect(stored(db).spells).toEqual([l1[8]]);
  });

  it('cleric: rejects unknown, duplicate, out-of-set (too-high level, wrong class, cantrip) without writing', () => {
    const db = rested(cleric());
    const l1 = spellsOf('Cleric', 1, 2);
    const l4 = spellsOf('Cleric', 4, 1);
    const l3 = spellsOf('Cleric', 3, 1);
    const wizardOnly = resolver
      .listSpells()
      .find((s) => s.level === 1 && !s.classes.includes('Cleric'));
    const cantrip = spellsOf('Cleric', 0, 1);
    expect(() => prepare(db, ['spell:no-such-spell'])).toThrow(/not a spell/);
    expect(() => prepare(db, [l1[0] as string, l1[0] as string])).toThrow(
      /more than once/,
    );
    expect(() => prepare(db, l4)).toThrow(/cannot be prepared/);
    expect(() => prepare(db, [wizardOnly?.key as string])).toThrow(
      /cannot be prepared/,
    );
    expect(() => prepare(db, cantrip)).toThrow(/cannot be prepared/);
    expect(() => prepare(db, [])).toThrow(/between 1 and/);
    expect(stored(db).spellcasting?.prepared).toBeUndefined();
    expect(prepare(db, [...l1, ...l3]).prepared).toHaveLength(3);
  });

  it('cleric: Life Domain spells are always prepared, uncounted, and not selectable', () => {
    const db = rested(
      cleric({
        subclass: { key: 'subclass:life-domain', name: 'Life Domain' },
      }),
    );
    const l1 = spellsOf('Cleric', 1, 9).filter(
      (k) => k !== 'spell:bless' && k !== 'spell:cure-wounds',
    );
    const result = prepare(db, l1.slice(0, 8));
    expect(result.limit).toBe(8);
    expect(result.alwaysPrepared).toEqual(
      expect.arrayContaining([
        'spell:bless',
        'spell:cure-wounds',
        'spell:lesser-restoration',
        'spell:spiritual-weapon',
        'spell:beacon-of-hope',
        'spell:revivify',
      ]),
    );
    expect(result.alwaysPrepared).toHaveLength(6);
    expect(stored(db).spellcasting?.alwaysPrepared).toEqual(
      result.alwaysPrepared,
    );
    expect(stored(db).spells).toEqual(
      expect.arrayContaining(['spell:bless', 'spell:revivify']),
    );
    expect(() => prepare(db, ['spell:bless'])).toThrow(/always prepared/);
  });

  it('gate: refuses short rest, non-participant, unknown rest, and a closed window', () => {
    const shortDb = rested(cleric(), 'short');
    expect(() => prepare(shortDb, ['spell:bless'])).toThrow(/long rest/);

    const db = rested(cleric());
    expect(() => prepare(db, ['spell:bless'], { characterId: 'pc-2' })).toThrow(
      /long rest/,
    );
    expect(() => prepare(db, ['spell:bless'], { restId: 'nope' })).toThrow(
      /long rest/,
    );
    prepare(db, ['spell:bless']);
    advanceWorldTime(db, { ...CTX, minutes: 1, rng: createSeededRng(1) });
    expect(() => prepare(db, ['spell:cure-wounds'])).toThrow(/window closed/);
    expect(stored(db).spellcasting?.prepared).toEqual(['spell:bless']);
  });

  it('gate: refuses once combat starts, even though the clock has not advanced', () => {
    const db = rested(cleric());
    const [a, b] = spellsOf('Cleric', 1, 2) as [string, string];
    prepare(db, [a]);
    startEncounter(db, {
      campaignId: CTX.campaignId,
      combatInstanceId: 'combat-after-rest',
      provenance: CTX.provenance,
      sessionId: CTX.sessionId,
      at: AT,
    });
    expect(() => prepare(db, [b])).toThrow(/during combat/);
    expect(stored(db).spellcasting?.prepared).toEqual([a]);
  });

  it('wizard: only spellbook spells; legacy flat list is classified as spellbook', () => {
    const l1 = spellsOf('Wizard', 1, 4);
    const db = rested(
      sheetOf({
        classKey: 'class:wizard',
        className: 'Wizard',
        level: 3,
        modifiers: { intelligence: 2 },
        spellcasting: { cantrips: [], spellbook: l1.slice(0, 3) },
      }),
    );
    expect(() => prepare(db, [l1[3] as string])).toThrow(/spellbook/);
    expect(prepare(db, l1.slice(0, 3)).limit).toBe(5);
    expect(stored(db).spellcasting?.spellbook).toEqual(l1.slice(0, 3));
    expect(() => prepare(db, spellsOf('Wizard', 1, 6))).toThrow();

    const legacy = rested({
      ...sheetOf({
        classKey: 'class:wizard',
        className: 'Wizard',
        level: 1,
        modifiers: { intelligence: 1 },
      }),
      spells: l1.slice(0, 2),
    });
    expect(prepare(legacy, [l1[0] as string]).prepared).toEqual([l1[0]]);
    expect(stored(legacy).spellcasting?.spellbook).toEqual(l1.slice(0, 2));
  });

  it('paladin: CHA mod + half level (minimum 1); nothing to prepare before slots', () => {
    const l1 = spellsOf('Paladin', 1, 4);
    const db = rested(
      sheetOf({
        classKey: 'class:paladin',
        className: 'Paladin',
        level: 5,
        modifiers: { charisma: 1 },
        spellcasting: { cantrips: [] },
      }),
    );
    expect(prepare(db, l1.slice(0, 3)).limit).toBe(3);
    expect(() => prepare(db, l1)).toThrow(/between 1 and 3/);

    const low = rested(
      sheetOf({
        classKey: 'class:paladin',
        className: 'Paladin',
        level: 2,
        modifiers: { charisma: -2 },
        spellcasting: { cantrips: [] },
      }),
    );
    expect(prepare(low, [l1[0] as string]).limit).toBe(1);

    const one = rested(
      sheetOf({
        classKey: 'class:paladin',
        className: 'Paladin',
        level: 1,
        spellcasting: { cantrips: [] },
      }),
    );
    expect(() => prepare(one, [l1[0] as string])).toThrow(
      /no spells available/,
    );
  });

  it('paladin oath: Oath of Devotion spells by paladin level', () => {
    const db = rested(
      sheetOf({
        classKey: 'class:paladin',
        className: 'Paladin',
        level: 5,
        subclass: {
          key: 'subclass:oath-of-devotion',
          name: 'Oath of Devotion',
        },
        modifiers: { charisma: 2 },
        spellcasting: { cantrips: [] },
      }),
    );
    const result = prepare(db, ['spell:heroism']);
    expect(result.alwaysPrepared.sort()).toEqual(
      [
        'spell:protection-from-evil-and-good',
        'spell:sanctuary',
        'spell:lesser-restoration',
        'spell:zone-of-truth',
      ].sort(),
    );
  });

  it('druid: Circle of the Land uses the recorded land only; no pick is explicit', () => {
    const druid = (featureChoices?: CharacterSheet['featureChoices']) =>
      sheetOf({
        classKey: 'class:druid',
        className: 'Druid',
        level: 5,
        subclass: {
          key: 'subclass:circle-of-the-land',
          name: 'Circle of the Land',
        },
        modifiers: { wisdom: 2 },
        spellcasting: { cantrips: [] },
        featureChoices,
      });
    const withPick = rested(
      druid([
        {
          featureRef: 'feature:circle-of-the-land:circle-spells',
          choiceId: 'land',
          optionIds: ['land:desert'],
          level: 3,
        },
      ]),
    );
    const picked = prepare(withPick, ['spell:entangle']);
    expect(picked.alwaysPrepared.sort()).toEqual(
      [
        'spell:blur',
        'spell:silence',
        'spell:create-food-and-water',
        'spell:protection-from-energy',
      ].sort(),
    );
    expect(picked.alwaysPreparedUnresolved).toBeUndefined();

    const noPick = rested(druid());
    const none = prepare(noPick, ['spell:entangle']);
    expect(none.alwaysPrepared).toEqual([]);
    expect(none.alwaysPreparedUnresolved).toMatch(/terrain pick/);
    expect(stored(noPick).spellcasting?.prepared).toEqual(['spell:entangle']);
  });

  it('refuses known casters and non-casters', () => {
    const sorcerer = rested(
      sheetOf({
        classKey: 'class:sorcerer',
        className: 'Sorcerer',
        level: 3,
        spellcasting: { cantrips: [], known: [] },
      }),
    );
    expect(() => prepare(sorcerer, ['spell:shield'])).toThrow(
      /does not prepare spells/,
    );
    const fighter = rested(
      sheetOf({ classKey: 'class:fighter', className: 'Fighter', level: 3 }),
    );
    expect(() => prepare(fighter, ['spell:shield'])).toThrow(
      /does not prepare spells/,
    );
  });

  it('prepare_spells tool validates args and runs the operation', () => {
    const db = rested(cleric());
    const registry = createDefaultToolRegistry();
    const ctx = {
      db,
      rng: createSeededRng(1),
      turnId: 'turn-prep',
      actingCharacterId: 'pc-1',
      ...CTX,
    };
    const bad = registry.invoke('prepare_spells', { restId: 'rest-1' }, ctx);
    expect(bad.ok).toBe(false);
    const refused = registry.invoke(
      'prepare_spells',
      { restId: 'rest-1', spells: ['spell:no-such-spell'] },
      ctx,
    );
    expect(refused).toMatchObject({ ok: false, code: 'preparation_error' });
    const good = registry.invoke(
      'prepare_spells',
      { restId: 'rest-1', spells: ['Bless', 'spell:cure-wounds'] },
      ctx,
    );
    expect(good.ok).toBe(true);
    expect(stored(db).spellcasting?.prepared).toEqual([
      'spell:bless',
      'spell:cure-wounds',
    ]);
  });

  it('prepare_spells resolves the character target by name through the shared resolver', () => {
    const db = rested(cleric());
    db.prepare("UPDATE character SET name = 'Darvin' WHERE id = 'pc-1'").run();
    const ctx = {
      db,
      rng: createSeededRng(1),
      turnId: 'turn-prep-name',
      actingCharacterId: 'pc-2',
      ...CTX,
    };
    const registry = createDefaultToolRegistry();
    const byName = registry.invoke(
      'prepare_spells',
      { restId: 'rest-1', spells: ['Bless'], character: 'Darvin' },
      ctx,
    );
    expect(byName.ok).toBe(true);
    expect(stored(db).spellcasting?.prepared).toEqual(['spell:bless']);
    expect(
      registry.invoke(
        'prepare_spells',
        { restId: 'rest-1', spells: ['Bless'], character: 'Nobody' },
        ctx,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_target' });
  });

  it('level-up spell placement keeps alwaysPrepared', async () => {
    const { applySpellPlacements } = await import(
      '../src/character/levelUpSpells.js'
    );
    expect(
      applySpellPlacements(
        { cantrips: [], prepared: [], alwaysPrepared: ['spell:bless'] },
        [],
      ).alwaysPrepared,
    ).toEqual(['spell:bless']);
  });
});
