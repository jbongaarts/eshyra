// F5 usage/recharge counters (eshyra-2n1t.7). Evidence for the
// ENGINE_PROCEDURE_COVERAGE rows: limited-usage (X/Day, Recharge X-Y,
// recharge-after-rest, per-day innate spells) and the live
// expenditure/recharge clause of charges (declared item economies).

import { describe, expect, it } from 'vitest';
import type { AdventureModule } from '../src/internal.js';
import {
  assembleContext,
  getActiveCharacterId,
  giveItem,
  readSpentUsageCounters,
  renderContextMessage,
  resetUsage,
  restoreUsage,
  spendUsage,
  startAdventureRun,
  startEncounter,
  UsageCounterError,
  updateCombatant,
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

  it('rejects a declared economy where the record owns one', () => {
    const { db } = setup();

    expect(() =>
      spendUsage(db, {
        campaignId: CAMPAIGN,
        owner: combatant(DRAGON),
        ability: 'Fire Breath',
        declared: { maxUses: 5, reset: 'dawn' },
        ...CTX,
      }),
    ).toThrow(/owned by its rules record/);
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
    expect(dawn.needsRolledRestore.map((c) => c.counterKey)).toEqual([
      'item:wand-1',
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
  it('recharges only when the natural roll meets the record threshold', () => {
    const { db } = setup();
    spendUsage(db, {
      campaignId: CAMPAIGN,
      owner: combatant(DRAGON),
      ability: 'Fire Breath',
      ...CTX,
    });

    const miss = restoreUsage(db, {
      campaignId: CAMPAIGN,
      owner: combatant(DRAGON),
      ability: 'Fire Breath',
      roll: 4,
      ...CTX,
    });
    expect(miss.recharged).toBe(false);
    expect(miss.rechargeThreshold).toBe('5-6 on d6');
    expect(miss.counter.usesRemaining).toBe(0);

    const hit = restoreUsage(db, {
      campaignId: CAMPAIGN,
      owner: combatant(DRAGON),
      ability: 'Fire Breath',
      roll: 5,
      ...CTX,
    });
    expect(hit.recharged).toBe(true);
    expect(hit.counter.usesRemaining).toBe(1);
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
