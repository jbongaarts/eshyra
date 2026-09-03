// F5 usage/recharge counters (eshyra-2n1t.7). Evidence for the
// ENGINE_PROCEDURE_COVERAGE rows: limited-usage (X/Day, Recharge X-Y,
// recharge-after-rest, per-day innate spells) and the live
// expenditure/recharge clause of charges (declared item economies).

import { describe, expect, it } from 'vitest';
import type { AdventureModule } from '../src/internal.js';
import {
  assembleContext,
  beginTurn,
  createInitialItemState,
  createSeededRng,
  ensureCharacterRow,
  getActiveCharacterId,
  getBundledDnd5eSrdPack,
  giveItem,
  readSpentUsageCounters,
  renderContextMessage,
  resetUsage,
  restoreUsage,
  spendUsage,
  startAdventureRun,
  startEncounter,
  transferItem,
  UsageCounterError,
  updateCombatant,
  writeItemState,
} from '../src/internal.js';
import { makeTestAdventureModule } from './support/adventureModuleFixture.js';
import {
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const NOW = '2026-07-10T10:00:00.000Z';
const CAMPAIGN = DEFAULT_TEST_CAMPAIGN_ID;
const CTX = {
  provenance: 'test:usage-counters',
  sessionId: DEFAULT_TEST_SESSION_ID,
  at: NOW,
};

const DRAGON = 'ci-enc-lair-1-adult-red-dragon-1';
const GIANT = 'ci-enc-lair-1-cloud-giant-2';
const BOAR = 'ci-enc-lair-1-boar-3';

function lairModule(): AdventureModule {
  const module = makeTestAdventureModule();
  return {
    ...module,
    encounters: [
      {
        id: 'enc-lair',
        name: 'The Lair',
        description: 'A dragon, a giant, and a boar walk into a lair.',
        creatures: [
          { rulesRef: 'creature:adult-red-dragon', count: 1, role: 'boss' },
          { rulesRef: 'creature:cloud-giant', count: 1, role: 'lieutenant' },
          { rulesRef: 'creature:boar', count: 1, role: 'pet' },
        ],
        locationId: 'loc-cellar',
        reward: 'A hoard.',
      },
    ],
    scenes: module.scenes.map((scene) =>
      scene.id === 'scene-cellar'
        ? { ...scene, encounterIds: ['enc-lair'] }
        : scene,
    ),
  };
}

function setup() {
  const db = freshDbWithSession();
  const module = lairModule();
  startAdventureRun(db, {
    campaignId: CAMPAIGN,
    runId: 'run-lair',
    moduleId: module.id,
    provenance: 'test',
    sessionId: DEFAULT_TEST_SESSION_ID,
    updatedAt: NOW,
  });
  startEncounter(db, {
    campaignId: CAMPAIGN,
    encounterId: 'enc-lair',
    resolveAdventureModule: (moduleId) =>
      moduleId === module.id ? module : undefined,
    ...CTX,
  });
  const pcId = getActiveCharacterId(db);
  return { db, module, pcId };
}

const combatant = (ref: string) => ({ kind: 'combatant' as const, ref });
const PC = { kind: 'character' as const };

describe('spendUsage — record-derived combatant economies', () => {
  it('fails closed promptly for an adversarial unclosed ability name', () => {
    const { db } = setup();
    const ability = '('.repeat(200_000);
    const started = Date.now();
    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: combatant(DRAGON),
        ability,
        ...CTX,
      }),
    ).toThrow(UsageCounterError);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('derives an X/Day trait economy and refuses the overspend with a dawn hint', () => {
    const { db } = setup();

    for (let i = 1; i <= 3; i++) {
      const result = spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: combatant(DRAGON),
        ability: 'Legendary Resistance',
        ...CTX,
      });
      expect(result.counter.usesUsed).toBe(i);
      expect(result.counter.usesMax).toBe(3);
      expect(result.counter.resetKind).toBe('dawn');
      expect(result.counter.source).toBe('record');
    }

    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: combatant(DRAGON),
        ability: 'Legendary Resistance',
        ...CTX,
      }),
    ).toThrow(/no uses of 'Legendary Resistance \(3\/Day\)' left.*dawn/s);
  });

  it('derives a Recharge X-Y action economy from the record', () => {
    const { db } = setup();

    const result = spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: combatant(DRAGON),
      ability: 'Fire Breath',
      ...CTX,
    });
    expect(result.counter.usesMax).toBe(1);
    expect(result.counter.usesRemaining).toBe(0);
    expect(result.counter.resetKind).toBe('recharge_roll');
    expect(result.counter.rechargeMinimum).toBe(5);
    expect(result.depletedHint).toMatch(/roll.*d6.*restore_usage/i);

    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: combatant(DRAGON),
        ability: 'Fire Breath (Recharge 5-6)',
        ...CTX,
      }),
    ).toThrow(UsageCounterError);
  });

  it('derives a recharge-after-rest trait economy', () => {
    const { db } = setup();

    const result = spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: combatant(BOAR),
      ability: 'Relentless',
      ...CTX,
    });
    expect(result.counter.usesMax).toBe(1);
    expect(result.counter.resetKind).toBe('short_or_long_rest');
  });

  it('derives per-day innate spell economies (per-spell counters)', () => {
    const { db } = setup();

    const first = spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: combatant(GIANT),
      ability: 'misty step',
      ...CTX,
    });
    expect(first.counter.counterKey).toBe('innate:spell:misty-step');
    expect(first.counter.usesMax).toBe(3);
    expect(first.counter.resetKind).toBe('dawn');

    const daily = spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: combatant(GIANT),
      ability: 'control weather',
      ...CTX,
    });
    expect(daily.counter.usesMax).toBe(1);
    expect(daily.counter.usesRemaining).toBe(0);
  });

  it('refuses counters for at-will innate spells and unlimited entries', () => {
    const { db } = setup();

    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: combatant(GIANT),
        ability: 'detect magic',
        ...CTX,
      }),
    ).toThrow(/at will/);

    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: combatant(DRAGON),
        ability: 'Bite',
        ...CTX,
      }),
    ).toThrow(/no usage limit/);
  });

  it('redirects a legendary option to the turn budget', () => {
    const { db } = setup();

    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: combatant(DRAGON),
        ability: 'Wing Attack',
        ...CTX,
      }),
    ).toThrow(/legendary action.*spend_turn_resource/s);
  });

  it('rejects any declared economy for a combatant (record-owned, fail closed)', () => {
    const { db } = setup();

    // Even where the record has the ability...
    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: combatant(DRAGON),
        ability: 'Fire Breath',
        declared: { maxUses: 5, reset: 'dawn' },
        ...CTX,
      }),
    ).toThrow(/derive from its rules record/);

    // ...and where it does not: a typo cannot mint an invented economy.
    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: combatant(DRAGON),
        ability: 'Fire Breth',
        declared: { maxUses: 5, reset: 'dawn' },
        ...CTX,
      }),
    ).toThrow(/derive from its rules record/);
  });

  it('fails closed on an ability the record does not match', () => {
    const { db } = setup();

    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: combatant(DRAGON),
        ability: 'Fire Breth',
        ...CTX,
      }),
    ).toThrow(
      /matches no trait, action, reaction, or innate spell.*lookup_rules/s,
    );
  });

  it('refuses spends by a dead combatant', () => {
    const { db } = setup();
    updateCombatant(db, {
      campaignId: CAMPAIGN,
      combatantId: BOAR,
      status: 'dead',
      ...CTX,
    });

    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: combatant(BOAR),
        ability: 'Relentless',
        ...CTX,
      }),
    ).toThrow(/dead/);
  });
});

describe('spendUsage — declared economies (characters and items)', () => {
  it('requires a declared economy on the first character-ability spend, then stores it durably', () => {
    const { db } = setup();

    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: PC,
        ability: 'Second Wind',
        ...CTX,
      }),
    ).toThrow(/no recorded usage economy.*lookup_rules/s);

    const first = spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: PC,
      ability: 'Second Wind',
      declared: { maxUses: 1, reset: 'short_or_long_rest' },
      ...CTX,
    });
    expect(first.counter.source).toBe('declared');
    expect(first.counter.usesRemaining).toBe(0);

    // Re-declaration is refused; the recorded economy is authoritative.
    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: PC,
        ability: 'Second Wind',
        declared: { maxUses: 3, reset: 'dawn' },
        ...CTX,
      }),
    ).toThrow(/already has a recorded economy/);
  });

  it('validates declared economies', () => {
    const { db } = setup();
    const spend = (declared: Record<string, unknown>) => () =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: PC,
        ability: 'Channel Divinity',
        declared: declared as never,
        ...CTX,
      });

    expect(spend({ maxUses: 0, reset: 'dawn' })).toThrow(/positive integer/);
    expect(spend({ maxUses: 1, reset: 'recharge_roll' })).toThrow(
      /rechargeMinimum 2-6/,
    );
    expect(
      spend({ maxUses: 1, reset: 'short_rest', rechargeFormula: '1d6' }),
    ).toThrow(/dawn economy/);
  });

  it('tracks item charges with a partial dawn recharge formula', () => {
    const { db, pcId } = setup();
    giveItem(
      db,
      { id: 'wand-1', name: 'Wand of Fireballs' },
      { characterId: pcId, ...CTX },
    );

    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: PC,
        itemId: 'wand-1',
        uses: 2,
        ...CTX,
      }),
    ).toThrow(/no recorded charge economy/);

    const spent = spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: PC,
      itemId: 'wand-1',
      uses: 2,
      declared: { maxUses: 7, reset: 'dawn', rechargeFormula: '1d6+1' },
      ...CTX,
    });
    expect(spent.counter.displayName).toBe('Wand of Fireballs charges');
    expect(spent.counter.usesUsed).toBe(2);

    // Overspending the remaining charges is refused.
    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: PC,
        itemId: 'wand-1',
        uses: 6,
        ...CTX,
      }),
    ).toThrow(/only 5 use\(s\)/);

    // Dawn does not zero a formula counter: it reports it for a rolled
    // restore instead.
    const dawn = resetUsage(db, {
      campaignId: CAMPAIGN,
      event: 'dawn',
      ...CTX,
    });
    expect(dawn.reset).toHaveLength(0);
    expect(dawn.needsRolledRestore.map((c) => c.owner)).toEqual([
      { kind: 'item', ref: 'wand-1' },
    ]);

    const restored = restoreUsage(db, {
      campaignId: CAMPAIGN,
      owner: PC,
      itemId: 'wand-1',
      amount: 5,
      ...CTX,
    });
    expect(restored.counter.usesUsed).toBe(0);
  });

  it('rejects every generic counter mutation for canonical pack-bound items', () => {
    const { db, pcId } = setup();
    giveItem(
      db,
      { id: 'legacy-wand', name: 'Legacy wand' },
      { characterId: pcId, ...CTX },
    );
    spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: PC,
      itemId: 'legacy-wand',
      uses: 2,
      declared: { maxUses: 7, reset: 'dawn' },
      ...CTX,
    });
    db.prepare(
      "UPDATE inventory SET pack_ref='magic-item:potion-of-healing' WHERE id='legacy-wand'",
    ).run();

    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: PC,
        itemId: 'legacy-wand',
        ...CTX,
      }),
    ).toThrow(/canonical pack item.*use_item.*legacy\/ad-hoc/s);
    expect(() =>
      restoreUsage(db, {
        campaignId: CAMPAIGN,
        owner: PC,
        itemId: 'legacy-wand',
        amount: 1,
        ...CTX,
      }),
    ).toThrow(/canonical pack item.*use_item.*legacy\/ad-hoc/s);
    expect(() =>
      resetUsage(db, {
        campaignId: CAMPAIGN,
        event: 'dawn',
        ...CTX,
      }),
    ).toThrow(/canonical pack item.*use_item.*legacy\/ad-hoc/s);
    expect(
      db
        .prepare(
          `SELECT uses_used FROM entity_usage_counter
           WHERE owner_kind='item' AND owner_ref='legacy-wand'`,
        )
        .get(),
    ).toEqual({ uses_used: 2 });
  });

  it('cannot create a second counter economy beside canonical item_state', () => {
    const { db, pcId } = setup();
    const record = getBundledDnd5eSrdPack().records.find(
      ({ key }) => key === 'magic-item:necklace-of-fireballs',
    );
    if (record === undefined) throw new Error('missing necklace fixture');
    const granted = giveItem(
      db,
      {
        id: 'ignored-for-stateful',
        name: record.name,
        packRef: record.key,
        stateful: true,
      },
      { characterId: pcId, ...CTX },
    );
    writeItemState(
      db,
      granted.id,
      createInitialItemState(record.key, record, {
        rng: createSeededRng(42),
      }),
      CTX,
    );
    const before = db
      .prepare('SELECT state_json FROM item_state WHERE inventory_id=?')
      .get(granted.id);

    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: PC,
        itemId: granted.id,
        declared: { maxUses: 99, reset: 'dawn' },
        ...CTX,
      }),
    ).toThrow(/canonical pack item.*use_item/s);
    expect(
      db
        .prepare('SELECT state_json FROM item_state WHERE inventory_id=?')
        .get(granted.id),
    ).toEqual(before);
    expect(
      db
        .prepare(
          "SELECT 1 FROM entity_usage_counter WHERE owner_kind='item' AND owner_ref=?",
        )
        .get(granted.id),
    ).toBeUndefined();
  });

  it('keeps charge state with the item when it changes hands', () => {
    const { db, pcId } = setup();
    ensureCharacterRow(db, 'pc-2', CTX.provenance, CTX.sessionId, CTX.at);
    giveItem(
      db,
      { id: 'wand-1', name: 'Wand of Fireballs' },
      { characterId: pcId, ...CTX },
    );
    spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: PC,
      itemId: 'wand-1',
      uses: 2,
      declared: { maxUses: 7, reset: 'dawn', rechargeFormula: '1d6+1' },
      ...CTX,
    });

    // The wand changes hands: its counter (2/7 spent) follows the item.
    transferItem(
      db,
      {
        campaignId: CAMPAIGN,
        itemId: 'wand-1',
        toCharacterRef: 'pc-2',
        attunement: 'require-unattuned',
      },
      { characterId: pcId, ...CTX },
    );

    // The new holder cannot re-declare a fresh economy...
    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: { kind: 'character', ref: 'pc-2' },
        itemId: 'wand-1',
        declared: { maxUses: 7, reset: 'dawn' },
        ...CTX,
      }),
    ).toThrow(/already has a recorded charge economy/);

    // ...their spends continue the item's existing counter...
    const spent = spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: { kind: 'character', ref: 'pc-2' },
      itemId: 'wand-1',
      ...CTX,
    });
    expect(spent.counter.usesUsed).toBe(3);
    expect(spent.counter.owner).toEqual({ kind: 'item', ref: 'wand-1' });

    // ...and the former holder no longer reaches it at all.
    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: PC,
        itemId: 'wand-1',
        ...CTX,
      }),
    ).toThrow(/holds no inventory item/);
  });

  it('refuses item charges against a combatant owner and items the character does not hold', () => {
    const { db } = setup();

    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: combatant(DRAGON),
        itemId: 'wand-1',
        ...CTX,
      }),
    ).toThrow(/character holding the item/);

    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: PC,
        itemId: 'nonexistent',
        declared: { maxUses: 1, reset: 'dawn' },
        ...CTX,
      }),
    ).toThrow(/holds no inventory item/);
  });
});

describe('restoreUsage — recharge rolls', () => {
  function spendFireBreath(db: ReturnType<typeof setup>['db']) {
    spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: combatant(DRAGON),
      ability: 'Fire Breath',
      ...CTX,
    });
  }
  const rollRecharge = (db: ReturnType<typeof setup>['db'], roll: number) =>
    restoreUsage(db, {
      campaignId: CAMPAIGN,
      owner: combatant(DRAGON),
      ability: 'Fire Breath',
      roll,
      ...CTX,
    });

  it('judges the roll against the record threshold, once at the start of each own turn', () => {
    const { db } = setup();
    spendFireBreath(db);

    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: combatant(DRAGON),
      ...CTX,
    });
    const miss = rollRecharge(db, 4);
    expect(miss.recharged).toBe(false);
    expect(miss.rechargeThreshold).toBe('5-6 on d6');
    expect(miss.counter.usesRemaining).toBe(0);

    // A miss consumes the turn's single attempt: no reroll this turn.
    expect(() => rollRecharge(db, 5)).toThrow(/already been rolled this turn/);

    // The next own turn opens a new attempt window.
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: combatant(GIANT),
      ...CTX,
    });
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: combatant(DRAGON),
      round: 2,
      ...CTX,
    });
    const hit = rollRecharge(db, 5);
    expect(hit.recharged).toBe(true);
    expect(hit.counter.usesRemaining).toBe(1);
  });

  it('refuses use-then-recharge inside the same turn: the roll precedes use', () => {
    const { db } = setup();
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: combatant(DRAGON),
      ...CTX,
    });
    spendFireBreath(db);

    // Adversarial sequence: begin_turn -> spend -> roll -> spend would
    // otherwise allow two breaths in one turn. The spend stamped this
    // window, so the roll is refused even though it is the first attempt.
    expect(() => rollRecharge(db, 5)).toThrow(
      /used during this turn.*START of the turn/s,
    );

    // The start of the next own turn rolls normally.
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: combatant(GIANT),
      ...CTX,
    });
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: combatant(DRAGON),
      round: 2,
      ...CTX,
    });
    expect(rollRecharge(db, 5).recharged).toBe(true);
  });

  it('refuses a recharge roll off-turn or before any turn is open', () => {
    const { db } = setup();
    spendFireBreath(db);

    // Combat is active but no structured turn has been opened, and later
    // it is someone else's turn: both are off-turn attempts.
    expect(() => rollRecharge(db, 6)).toThrow(/it is not .*turn/);
    beginTurn(db, {
      campaignId: CAMPAIGN,
      participant: combatant(GIANT),
      ...CTX,
    });
    expect(() => rollRecharge(db, 6)).toThrow(/it is not .*turn/);
  });

  it('refuses a recharge roll outside structured combat (a rest restores it)', () => {
    const db = freshDbWithSession();
    spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: PC,
      ability: 'Breath of the North Wind',
      declared: { maxUses: 1, reset: 'recharge_roll', rechargeMinimum: 5 },
      ...CTX,
    });

    expect(() =>
      restoreUsage(db, {
        campaignId: CAMPAIGN,
        owner: PC,
        ability: 'Breath of the North Wind',
        roll: 6,
        ...CTX,
      }),
    ).toThrow(/own turn in structured combat.*recharges on a rest/s);
  });

  it('rejects a roll against a non-recharge counter, out-of-range rolls, and roll+amount together', () => {
    const { db } = setup();
    spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: combatant(DRAGON),
      ability: 'Legendary Resistance',
      ...CTX,
    });
    spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: combatant(DRAGON),
      ability: 'Fire Breath',
      ...CTX,
    });

    expect(() =>
      restoreUsage(db, {
        campaignId: CAMPAIGN,
        owner: combatant(DRAGON),
        ability: 'Legendary Resistance',
        roll: 6,
        ...CTX,
      }),
    ).toThrow(/not a recharge-roll ability/);
    expect(() =>
      restoreUsage(db, {
        campaignId: CAMPAIGN,
        owner: combatant(DRAGON),
        ability: 'Fire Breath',
        roll: 7,
        ...CTX,
      }),
    ).toThrow(/natural d6 result/);
    expect(() =>
      restoreUsage(db, {
        campaignId: CAMPAIGN,
        owner: combatant(DRAGON),
        ability: 'Fire Breath',
        roll: 5,
        amount: 1,
        ...CTX,
      }),
    ).toThrow(/exactly one of roll/);
  });

  it('names the recorded counters when the reference matches none', () => {
    const { db } = setup();
    spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: combatant(DRAGON),
      ability: 'Fire Breath',
      ...CTX,
    });

    expect(() =>
      restoreUsage(db, {
        campaignId: CAMPAIGN,
        owner: combatant(DRAGON),
        ability: 'Ice Breath',
        amount: 1,
        ...CTX,
      }),
    ).toThrow(/no usage counter matches 'Ice Breath'.*Fire Breath/s);
  });
});

describe('resetUsage — rest and dawn events', () => {
  it('short rest restores recharge and short-rest economies for characters by default', () => {
    const { db } = setup();
    // Character-declared short-rest economy plus combatant recharge spends.
    spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: PC,
      ability: 'Second Wind',
      declared: { maxUses: 1, reset: 'short_or_long_rest' },
      ...CTX,
    });
    spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: combatant(DRAGON),
      ability: 'Fire Breath',
      ...CTX,
    });

    const rest = resetUsage(db, {
      campaignId: CAMPAIGN,
      event: 'short_rest',
      ...CTX,
    });
    // The party rests; the dragon's spent breath is untouched.
    expect(rest.reset.map((c) => c.counterKey)).toEqual([
      'ability:second-wind',
    ]);
    const remaining = readSpentUsageCounters(db, CAMPAIGN);
    expect(remaining.map((c) => c.counterKey)).toEqual(['fire-breath']);
  });

  it('scoping a rest to a combatant restores its recharge and rest economies', () => {
    const { db } = setup();
    spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: combatant(BOAR),
      ability: 'Relentless',
      ...CTX,
    });
    spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: combatant(DRAGON),
      ability: 'Fire Breath',
      ...CTX,
    });

    const rest = resetUsage(db, {
      campaignId: CAMPAIGN,
      event: 'short_rest',
      owner: combatant(BOAR),
      ...CTX,
    });
    expect(rest.reset.map((c) => c.counterKey)).toEqual(['relentless']);
    expect(
      readSpentUsageCounters(db, CAMPAIGN).map((c) => c.counterKey),
    ).toEqual(['fire-breath']);
  });

  it('dawn restores per-day economies for every owner', () => {
    const { db } = setup();
    spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: combatant(DRAGON),
      ability: 'Legendary Resistance',
      ...CTX,
    });
    spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: combatant(GIANT),
      ability: 'misty step',
      ...CTX,
    });
    spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: combatant(DRAGON),
      ability: 'Fire Breath',
      ...CTX,
    });

    const dawn = resetUsage(db, {
      campaignId: CAMPAIGN,
      event: 'dawn',
      ...CTX,
    });
    expect(dawn.reset.map((c) => c.counterKey).sort()).toEqual([
      'innate:spell:misty-step',
      'legendary-resistance',
    ]);
    // Recharge abilities belong to the turn-start roll and rests, not dawn.
    expect(
      readSpentUsageCounters(db, CAMPAIGN).map((c) => c.counterKey),
    ).toEqual(['fire-breath']);
  });
});

describe('context snapshot', () => {
  it('surfaces spent counters to the model', () => {
    const { db } = setup();
    spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: combatant(DRAGON),
      ability: 'Fire Breath',
      ...CTX,
    });

    const rendered = renderContextMessage(
      assembleContext({
        db,
        campaignId: CAMPAIGN,
        campaignPosition: 'test-position',
        sessionId: DEFAULT_TEST_SESSION_ID,
        playerInput: 'What now?',
      }),
    );
    expect(rendered).toContain('Limited-use abilities/charges spent:');
    expect(rendered).toMatch(
      /Adult Red Dragon: Fire Breath.*1\/1 used \(recharge 5-6/,
    );
  });
});
