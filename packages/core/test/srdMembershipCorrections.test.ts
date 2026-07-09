import { describe, expect, it } from 'vitest';
import { getBundledDnd5eSrdPack } from '../src/rules/bundledSrdPack.js';

/**
 * Committed-pack assertions for the eshyra-o9bd.18.7.9 membership
 * corrections: deterministic creature entries and spells that PRs #396/#397
 * accepted as prose/metadata-only now carry typed mechanics. These pin the
 * exact structures of representative and high-risk corrections so a grammar
 * regression cannot silently drop them back into the accepted buckets.
 */

type Entry = {
  name: string;
  text: string;
  mechanics?: { effects?: unknown[] };
};

function creatureEntry(key: string, section: string, name: string): Entry {
  const record = getBundledDnd5eSrdPack().records.find(
    (candidate) => candidate.key === key,
  );
  expect(record, `${key} must exist`).toBeDefined();
  const data = record?.data as Record<string, unknown>;
  const entries =
    section === 'legendaryActions'
      ? ((data.legendaryActions as Record<string, unknown>).entries as Entry[])
      : (data[section] as Entry[]);
  const entry = entries.find((candidate) => candidate.name === name);
  expect(entry, `${key}#${section}:${name} must exist`).toBeDefined();
  return entry as Entry;
}

function spellEffects(key: string): unknown[] {
  const record = getBundledDnd5eSrdPack().records.find(
    (candidate) => candidate.key === key,
  );
  expect(record, `${key} must exist`).toBeDefined();
  const mechanics = (record?.data as Record<string, unknown>).mechanics as {
    effects?: unknown[];
  };
  expect(mechanics.effects, `${key} must carry typed effects`).toBeDefined();
  return mechanics.effects as unknown[];
}

describe('corrected creature accepted-prose entries (eshyra-o9bd.18.7.9)', () => {
  it('Hydra Multiattack is a per-head formula, Medusa an either/or option set, Violet Fungus a dice count', () => {
    expect(
      creatureEntry('creature:hydra', 'actions', 'Multiattack').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'multiattack',
        attacksFormula: 'one-per-head',
        attackName: 'bite',
      },
    ]);
    expect(
      creatureEntry('creature:medusa', 'actions', 'Multiattack').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'multiattack',
        options: [
          { attacks: 3, attackType: 'melee' },
          { attacks: 2, attackType: 'ranged' },
        ],
      },
    ]);
    expect(
      creatureEntry('creature:violet-fungus', 'actions', 'Multiattack')
        .mechanics?.effects,
    ).toEqual([{ kind: 'multiattack', attacksDice: '1d4' }]);
  });

  it('Marilith Multiattack carries the complete routine breakdown', () => {
    expect(
      creatureEntry('creature:marilith', 'actions', 'Multiattack').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'multiattack',
        attacks: 7,
        routine: [
          { attacks: 6, attack: 'longswords' },
          { attacks: 1, attack: 'tail' },
        ],
      },
    ]);
  });

  it('Nimble Escape and Cunning Action are typed bonus-action option sets', () => {
    expect(
      creatureEntry('creature:goblin', 'traits', 'Nimble Escape').mechanics
        ?.effects,
    ).toEqual([{ kind: 'bonusAction', options: ['disengage', 'hide'] }]);
    expect(
      creatureEntry('creature:spy', 'traits', 'Cunning Action').mechanics
        ?.effects,
    ).toEqual([
      { kind: 'bonusAction', options: ['dash', 'disengage', 'hide'] },
    ]);
  });

  it('legendary Attack/Move/Teleport references are typed', () => {
    expect(
      creatureEntry('creature:tarrasque', 'legendaryActions', 'Attack')
        .mechanics?.effects,
    ).toEqual([{ kind: 'makeAttack', options: ['claw', 'tail'] }]);
    expect(
      creatureEntry('creature:tarrasque', 'legendaryActions', 'Move').mechanics
        ?.effects,
    ).toEqual([{ kind: 'moveUpTo', amount: 'half-speed' }]);
    expect(
      creatureEntry('creature:vampire', 'legendaryActions', 'Move').mechanics
        ?.effects,
    ).toEqual([
      { kind: 'moveUpTo', amount: 'speed', withoutOpportunityAttacks: true },
    ]);
    expect(
      creatureEntry('creature:balor', 'actions', 'Teleport').mechanics?.effects,
    ).toEqual([{ kind: 'teleport', distanceFeet: 120 }]);
  });

  it('Ice Walk keeps BOTH the climb rule and the difficult-terrain rule (SRD "extra moment" typo)', () => {
    expect(
      creatureEntry('creature:adult-white-dragon', 'traits', 'Ice Walk')
        .mechanics?.effects,
    ).toEqual([
      { kind: 'climbWithoutCheck', surfaces: 'icy' },
      { kind: 'ignoreDifficultTerrain', terrain: ['ice', 'snow'] },
    ]);
  });

  it('Reflective Carapace, Corrode Metal, and Grasping Tendrils carry complete structures', () => {
    expect(
      creatureEntry('creature:tarrasque', 'traits', 'Reflective Carapace')
        .mechanics?.effects,
    ).toEqual([
      {
        kind: 'spellReflection',
        roll: 'd6',
        unaffectedOnMaximum: 5,
        reflectedOn: 6,
      },
    ]);
    expect(
      creatureEntry('creature:gray-ooze', 'traits', 'Corrode Metal').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'weaponCorrosion',
        penaltyPerHit: -1,
        destroyedAtPenalty: -5,
        ammunitionDestroyedOnHit: true,
      },
    ]);
    expect(
      creatureEntry('creature:roper', 'traits', 'Grasping Tendrils').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'attackableAppendage',
        appendage: 'tendril',
        ac: 20,
        hitPoints: 10,
        immunities: 'poison and psychic damage',
        maximumCount: 6,
        breakDc: 15,
        breakAbility: 'strength',
        regrowsNextTurn: true,
      },
    ]);
  });

  it('movement traits are typed: Spider Climb, Web Walker, Amorphous, Earth Glide, Tunneler, Tree Stride', () => {
    expect(
      creatureEntry('creature:giant-spider', 'traits', 'Spider Climb').mechanics
        ?.effects,
    ).toEqual([{ kind: 'climbWithoutCheck' }]);
    expect(
      creatureEntry('creature:giant-spider', 'traits', 'Web Walker').mechanics
        ?.effects,
    ).toEqual([{ kind: 'ignoreMovementRestriction', source: 'webbing' }]);
    expect(
      creatureEntry('creature:black-pudding', 'traits', 'Amorphous').mechanics
        ?.effects,
    ).toEqual([{ kind: 'moveThroughNarrowSpaces', widthInches: 1 }]);
    expect(
      creatureEntry('creature:earth-elemental', 'traits', 'Earth Glide')
        .mechanics?.effects,
    ).toEqual([{ kind: 'earthGlide' }]);
    expect(
      creatureEntry('creature:purple-worm', 'traits', 'Tunneler').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'tunneler',
        solidRockBurrowSpeedMultiplier: 0.5,
        tunnelDiameterFeet: 10,
      },
    ]);
    expect(
      creatureEntry('creature:dryad', 'traits', 'Tree Stride').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'teleport',
        via: 'living-trees',
        distanceFeet: 60,
        movementCostFeet: 10,
      },
    ]);
    expect(
      creatureEntry('creature:air-elemental', 'traits', 'Air Form').mechanics
        ?.effects,
    ).toEqual([
      { kind: 'moveThroughNarrowSpaces', widthInches: 1 },
      { kind: 'enterHostileSpace' },
    ]);
  });

  it('light and sense traits are typed, including the hyphen-split Illumination texts', () => {
    expect(
      creatureEntry('creature:nightmare', 'traits', 'Illumination').mechanics
        ?.effects,
    ).toEqual([
      { kind: 'light', level: 'bright', radiusFeet: 10, dimAdditionalFeet: 10 },
    ]);
    expect(
      creatureEntry('creature:fire-elemental', 'traits', 'Illumination')
        .mechanics?.effects,
    ).toEqual([
      { kind: 'light', level: 'bright', radiusFeet: 30, dimAdditionalFeet: 30 },
    ]);
    expect(
      creatureEntry('creature:will-o-wisp', 'traits', 'Variable Illumination')
        .mechanics?.effects,
    ).toEqual([
      {
        kind: 'light',
        level: 'bright',
        radiusFeetMinimum: 5,
        radiusFeetMaximum: 20,
        dimAdditionalFeetEqualsRadius: true,
        variable: true,
      },
      { kind: 'bonusAction', options: ['alter-light-radius'] },
    ]);
    expect(
      creatureEntry('creature:imp', 'traits', 'Devil’s Sight').mechanics
        ?.effects,
    ).toEqual([{ kind: 'seeInMagicalDarkness' }]);
    expect(
      creatureEntry('creature:ghost', 'traits', 'Ethereal Sight').mechanics
        ?.effects,
    ).toEqual([{ kind: 'sense', sense: 'ethereal-sight', rangeFeet: 60 }]);
    expect(
      creatureEntry('creature:giant-spider', 'traits', 'Web Sense').mechanics
        ?.effects,
    ).toEqual([{ kind: 'sense', sense: 'web-sense' }]);
  });

  it('deterministic defense traits are typed: Damage Transfer, Bound, Harmed by Running Water, Swarm', () => {
    expect(
      creatureEntry('creature:cloaker', 'traits', 'Damage Transfer').mechanics
        ?.effects,
    ).toEqual([{ kind: 'damageTransfer', portion: 'half', rounding: 'down' }]);
    expect(
      creatureEntry('creature:shield-guardian', 'traits', 'Bound').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'damageTransfer',
        portion: 'half',
        rounding: 'up',
        from: 'amulet-wearer',
        rangeFeet: 60,
      },
      { kind: 'sense', sense: 'bound-amulet-location' },
    ]);
    expect(
      creatureEntry('creature:vampire', 'traits', 'Harmed by Running Water')
        .mechanics?.effects,
    ).toEqual([
      {
        kind: 'recurringDamage',
        amount: 20,
        type: 'acid',
        trigger: 'ends-turn-in-running-water',
      },
    ]);
    expect(
      creatureEntry('creature:swarm-of-rats', 'traits', 'Swarm').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'swarm',
        canOccupyOtherCreaturesSpace: true,
        cannotRegainHitPoints: true,
        cannotGainTemporaryHitPoints: true,
      },
    ]);
  });

  it('re-audited action entries are typed: Read Thoughts, Illusory Appearance, Flying Sword, Create Specter', () => {
    const readThoughts = creatureEntry(
      'creature:doppelganger',
      'actions',
      'Read Thoughts',
    ).mechanics?.effects as Array<Record<string, unknown>>;
    expect(readThoughts[0]).toEqual({
      kind: 'sense',
      sense: 'read-surface-thoughts',
      rangeFeet: 60,
    });
    expect(
      readThoughts.filter((e) => e.kind === 'abilityCheckModifier'),
    ).toHaveLength(4);
    expect(
      creatureEntry('creature:green-hag', 'actions', 'Illusory Appearance')
        .mechanics?.effects,
    ).toEqual([
      {
        kind: 'illusoryDisguise',
        discernDc: 20,
        ability: 'intelligence',
        skill: 'investigation',
        inspectionCost: 'action',
        endCost: 'bonus-action',
      },
    ]);
    expect(
      creatureEntry('creature:solar', 'actions', 'Flying Sword').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'hoveringWeapon',
        weapon: 'greatsword',
        releaseRangeFeet: 5,
        commandCost: 'bonus-action',
        commandFlyFeet: 50,
        commandOptions: ['make-one-attack', 'return-to-hand'],
      },
    ]);
    expect(
      creatureEntry('creature:wraith', 'actions', 'Create Specter').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'summonCreature',
        creature: 'specter',
        rangeFeet: 10,
        target: 'humanoid dead no longer than 1 minute that died violently',
        maximumControlled: 7,
      },
    ]);
  });

  it('remaining deterministic traits: Inscrutable, Transparent, Brute, Mimicry, Rejuvenation, Spell Storing, Forbiddance, Ephemeral', () => {
    const inscrutable = creatureEntry(
      'creature:androsphinx',
      'traits',
      'Inscrutable',
    ).mechanics?.effects as Array<Record<string, unknown>>;
    expect(inscrutable.map((e) => e.kind)).toEqual([
      'immunity',
      'abilityCheckModifier',
    ]);
    const transparent = creatureEntry(
      'creature:gelatinous-cube',
      'traits',
      'Transparent',
    ).mechanics?.effects as Array<Record<string, unknown>>;
    expect(transparent[0]).toEqual({
      kind: 'hiddenFromView',
      spotDc: 15,
      ability: 'wisdom',
      skill: 'perception',
    });
    expect(
      creatureEntry('creature:bugbear', 'traits', 'Brute').mechanics?.effects,
    ).toEqual([{ kind: 'extraWeaponDamageDie', extraDice: 1 }]);
    expect(
      creatureEntry('creature:raven', 'traits', 'Mimicry').mechanics?.effects,
    ).toEqual([
      { kind: 'mimicry', discernDc: 10, ability: 'wisdom', skill: 'insight' },
    ]);
    expect(
      creatureEntry('creature:mummy-lord', 'traits', 'Rejuvenation').mechanics
        ?.effects,
    ).toEqual([
      { kind: 'rejuvenation', afterHours: 24, condition: 'heart-intact' },
    ]);
    expect(
      creatureEntry('creature:shield-guardian', 'traits', 'Spell Storing')
        .mechanics?.effects,
    ).toEqual([{ kind: 'spellStoring', maximumSpellLevel: 4, capacity: 1 }]);
    expect(
      creatureEntry('creature:vampire', 'traits', 'Forbiddance').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'movementRestriction',
        restriction: 'cannot-enter-residence-without-invitation',
      },
    ]);
    expect(
      creatureEntry('creature:will-o-wisp', 'traits', 'Ephemeral').mechanics
        ?.effects,
    ).toEqual([{ kind: 'cannotWearOrCarry' }]);
    expect(
      creatureEntry('creature:hydra', 'traits', 'Reactive Heads').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'extraReactions',
        formula: 'one-per-head-beyond-one',
        restrictedTo: 'opportunity-attacks',
      },
    ]);
    expect(
      creatureEntry('creature:marilith', 'traits', 'Reactive').mechanics
        ?.effects,
    ).toEqual([{ kind: 'extraReactions', perTurn: 1 }]);
    expect(
      creatureEntry('creature:mule', 'traits', 'Beast of Burden').mechanics
        ?.effects,
    ).toEqual([{ kind: 'carryingCapacitySize', size: 'large' }]);
    expect(
      creatureEntry('creature:manticore', 'traits', 'Tail Spike Regrowth')
        .mechanics?.effects,
    ).toEqual([
      { kind: 'limitedAmmunition', count: 24, replenish: 'long-rest' },
    ]);
    expect(
      creatureEntry('creature:purple-worm', 'traits', 'Tunneler').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'tunneler',
        solidRockBurrowSpeedMultiplier: 0.5,
        tunnelDiameterFeet: 10,
      },
    ]);
  });

  it('residual creature-entry reconciliation (eshyra-o9bd.18.7.9 §1.6, trigger/result linkage per §2): Rejuvenation, Surprise Attack, and Freeze reuse existing typed kinds', () => {
    // Each source text opens with "If …,". Surprise Attack and Freeze carry
    // that trigger directly on the substantive typed effect (`extraDamage` /
    // `movementRestriction`) rather than as a separate bare `triggeredEffect`
    // marker, so the conditional relationship is unambiguous instead of
    // depending on array adjacency (eshyra-o9bd.18.7.9 §2). Rejuvenation's
    // "if it dies" / "if it has a phylactery" clauses are already fully
    // captured by the `rejuvenation` effect's own condition/timing fields, so
    // no separate trigger marker is emitted at all — nothing would be added
    // beyond what the kind itself already means.
    expect(
      creatureEntry('creature:guardian-naga', 'traits', 'Rejuvenation')
        .mechanics?.effects,
    ).toEqual([
      {
        kind: 'rejuvenation',
        afterDaysDice: '1d6',
        condition: 'no-wish-spell-cast-to-prevent-it',
      },
    ]);
    expect(
      creatureEntry('creature:spirit-naga', 'traits', 'Rejuvenation').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'rejuvenation',
        afterDaysDice: '1d6',
        condition: 'no-wish-spell-cast-to-prevent-it',
      },
    ]);
    expect(
      creatureEntry('creature:lich', 'traits', 'Rejuvenation').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'rejuvenation',
        afterDaysDice: '1d10',
        condition: 'has-a-phylactery',
      },
    ]);
    expect(
      creatureEntry('creature:bugbear', 'traits', 'Surprise Attack').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'extraDamage',
        dice: '2d6',
        trigger:
          'If the bugbear surprises a creature and hits it with an attack during the first round of combat',
      },
    ]);
    expect(
      creatureEntry('creature:doppelganger', 'traits', 'Surprise Attack')
        .mechanics?.effects,
    ).toEqual([
      {
        kind: 'extraDamage',
        dice: '3d6',
        trigger:
          'If the doppelganger surprises a creature and hits it with an attack during the first round of combat',
      },
    ]);
    expect(
      creatureEntry('creature:water-elemental', 'traits', 'Freeze').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'movementRestriction',
        restriction: 'speed-reduced-by-20-feet',
        endsBy: 'end-of-next-turn',
        trigger: 'If the elemental takes cold damage',
      },
    ]);
  });

  it('C2 False Appearance records carry deterministic indistinguishability mechanics', () => {
    const expected = [
      [
        'creature:animated-armor',
        'False Appearance',
        'motionless',
        'a normal suit of armor',
      ],
      [
        'creature:awakened-shrub',
        'False Appearance',
        'motionless',
        'a normal shrub',
      ],
      [
        'creature:awakened-tree',
        'False Appearance',
        'motionless',
        'a normal tree',
      ],
      [
        'creature:cloaker',
        'False Appearance',
        'motionless without its underside exposed',
        'a dark leather cloak',
      ],
      [
        'creature:darkmantle',
        'False Appearance',
        'motionless',
        'a cave formation such as a stalactite or stalagmite',
      ],
      [
        'creature:flying-sword',
        'False Appearance',
        "motionless and isn't flying",
        'a normal sword',
      ],
      [
        'creature:gargoyle',
        'False Appearance',
        'motionless',
        'an inanimate statue',
      ],
      [
        'creature:gray-ooze',
        'False Appearance',
        'motionless',
        'an oily pool or wet rock',
      ],
      [
        'creature:ice-mephit',
        'False Appearance',
        'motionless',
        'an ordinary shard of ice',
      ],
      [
        'creature:magma-mephit',
        'False Appearance',
        'motionless',
        'an ordinary mound of magma',
      ],
      [
        'creature:mimic',
        'False Appearance (Object Form Only)',
        'in object form and motionless',
        'an ordinary object',
      ],
      [
        'creature:roper',
        'False Appearance',
        'motionless',
        'a normal cave formation, such as a stalagmite',
      ],
      [
        'creature:rug-of-smothering',
        'False Appearance',
        'motionless',
        'a normal rug',
      ],
      [
        'creature:shrieker',
        'False Appearance',
        'motionless',
        'an ordinary fungus',
      ],
      ['creature:treant', 'False Appearance', 'motionless', 'a normal tree'],
      [
        'creature:violet-fungus',
        'False Appearance',
        'motionless',
        'an ordinary fungus',
      ],
    ] as const;

    for (const [key, name, condition, indistinguishableFrom] of expected) {
      expect(creatureEntry(key, 'traits', name).mechanics?.effects).toEqual([
        {
          kind: 'falseAppearance',
          while: condition,
          indistinguishableFrom,
        },
      ]);
    }
  });

  it('C3 telepathy and communication creature entries carry typed boundaries', () => {
    expect(
      creatureEntry('creature:homunculus', 'traits', 'Telepathic Bond')
        .mechanics?.effects,
    ).toEqual([
      {
        kind: 'telepathy',
        samePlaneOnly: true,
        audience: 'master',
      },
      {
        kind: 'senseSharing',
        source: 'homunculus',
        recipient: 'master',
        senses: 'what it senses',
        condition: 'same plane of existence',
      },
    ]);
    expect(
      creatureEntry('creature:otyugh', 'traits', 'Limited Telepathy').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'telepathy',
        rangeFeet: 120,
        requiresLanguage: true,
        oneWay: true,
        content: ['simple-messages', 'images'],
      },
    ]);
    expect(
      creatureEntry('creature:pseudodragon', 'traits', 'Limited Telepathy')
        .mechanics?.effects,
    ).toEqual([
      {
        kind: 'telepathy',
        rangeFeet: 100,
        requiresLanguage: true,
        content: ['simple-ideas', 'emotions', 'images'],
      },
    ]);
    expect(
      creatureEntry('creature:sahuagin', 'traits', 'Shark Telepathy').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'telepathy',
        rangeFeet: 120,
        audience: 'sharks',
        commands: true,
      },
    ]);
    expect(
      creatureEntry('creature:dryad', 'traits', 'Speak with Beasts and Plants')
        .mechanics?.effects,
    ).toEqual([{ kind: 'communication', with: ['beasts', 'plants'] }]);
    expect(
      creatureEntry('creature:aboleth', 'traits', 'Probing Telepathy').mechanics
        ?.effects,
    ).toEqual([
      {
        kind: 'triggeredEffect',
        trigger: 'a creature communicates telepathically with the aboleth',
        result: "the aboleth learns the creature's greatest desires",
        condition: 'aboleth can see the creature',
      },
    ]);
  });

  it('C3 knowledge and wakeful creature entries carry typed state mechanics', () => {
    expect(
      creatureEntry('creature:invisible-stalker', 'traits', 'Faultless Tracker')
        .mechanics?.effects,
    ).toEqual([
      {
        kind: 'locationKnowledge',
        knows: ['direction', 'distance'],
        of: 'designated quarry',
        condition: 'same plane of existence',
      },
      { kind: 'locationKnowledge', knows: ['location'], of: 'summoner' },
    ]);
    expect(
      creatureEntry('creature:minotaur', 'traits', 'Labyrinthine Recall')
        .mechanics?.effects,
    ).toEqual([
      {
        kind: 'pathMemory',
        scope: 'any-previously-traveled-path',
        recall: 'perfect',
      },
    ]);
    expect(
      creatureEntry('creature:hydra', 'traits', 'Wakeful').mechanics?.effects,
    ).toEqual([
      {
        kind: 'sleepException',
        detail: 'While the hydra sleeps, at least one of its heads is awake',
      },
    ]);
    expect(
      creatureEntry('creature:ettin', 'traits', 'Wakeful').mechanics?.effects,
    ).toEqual([
      {
        kind: 'sleepException',
        detail:
          "When one of the ettin's heads is asleep, its other head is awake",
      },
    ]);
  });
});

describe('corrected metadata-only spells (eshyra-o9bd.18.7.9)', () => {
  it('C3 spells carry communication and telepathy mechanics', () => {
    expect(spellEffects('spell:speak-with-animals')).toEqual([
      { kind: 'communication', with: ['beasts'] },
    ]);
    expect(spellEffects('spell:telepathic-bond')).toEqual([
      {
        kind: 'telepathy',
        maxCreatures: 8,
        willingOnly: true,
        minIntelligence: 3,
        samePlaneOnly: true,
      },
    ]);
  });

  it('S2 stochastic and repeated-casting spells carry typed bookkeeping', () => {
    expect(spellEffects('spell:augury')).toEqual([
      {
        kind: 'percentChance',
        percent: 25,
        per: 'extra-casting-before-long-rest',
        cumulative: true,
        trigger: 'repeat-cast-before-long-rest',
        resetOn: 'long-rest',
        effect: 'random-reading',
        secret: true,
      },
    ]);
    expect(spellEffects('spell:commune')).toEqual([
      { kind: 'questionLimit', maxQuestions: 3 },
      {
        kind: 'percentChance',
        percent: 25,
        per: 'extra-casting-before-long-rest',
        cumulative: true,
        trigger: 'repeat-cast-before-long-rest',
        resetOn: 'long-rest',
        effect: 'no-answer',
        secret: true,
      },
    ]);
    expect(spellEffects('spell:divination')).toEqual([
      {
        kind: 'percentChance',
        percent: 25,
        per: 'extra-casting-before-long-rest',
        cumulative: true,
        trigger: 'repeat-cast-before-long-rest',
        resetOn: 'long-rest',
        effect: 'random-reading',
        secret: true,
      },
    ]);
    expect(spellEffects('spell:secret-chest')).toEqual([
      {
        kind: 'percentChance',
        percent: 5,
        per: 'day',
        cumulative: true,
        trigger: 'after-60-days',
        effect: 'spell-ends',
      },
    ]);
    expect(spellEffects('spell:arcanists-magic-aura')).toEqual([
      {
        kind: 'permanenceAfterRepetition',
        period: 'day',
        count: 30,
        result: 'until-dispelled',
      },
    ]);
  });

  it('S2 provision, utility-object, and environmental spells carry typed limits', () => {
    expect(spellEffects('spell:create-food-and-water')).toEqual([
      {
        kind: 'createsProvisions',
        food: { pounds: 45, spoilsAfterHours: 24 },
        water: { gallons: 30 },
        sustains: { humanoids: 15, steeds: 5, hours: 24 },
      },
    ]);
    expect(spellEffects('spell:create-or-destroy-water')).toEqual([
      {
        kind: 'createsOrDestroysWater',
        gallons: 10,
        areaAlternative: 'rain in a 30-foot cube',
        extinguishesExposedFlames: true,
        destroyAlternative: 'fog in a 30-foot cube',
      },
    ]);
    expect(spellEffects('spell:floating-disk')).toEqual([
      {
        kind: 'conjuredUtilityObject',
        capacityPounds: 500,
        leashFeet: 20,
        endsBeyondFeet: 100,
        restrictions: [
          'immobile while you are within 20 feet',
          'follows to remain within 20 feet',
          'cannot cross an elevation change of 10 feet or more',
        ],
      },
    ]);
    expect(spellEffects('spell:mage-hand')).toEqual([
      {
        kind: 'conjuredUtilityObject',
        capacityPounds: 10,
        endsBeyondFeet: 30,
        moveFeetPerUse: 30,
        restrictions: [
          'requires action to control',
          'cannot attack',
          'cannot activate magic items',
          'cannot carry more than 10 pounds',
        ],
      },
    ]);
    expect(spellEffects('spell:mirage-arcane')).toEqual([
      {
        kind: 'terrainAlteration',
        canCreate: ['difficult-terrain'],
        canRemove: ['difficult-terrain'],
        removedPiecesDisappear: true,
      },
    ]);
    expect(spellEffects('spell:prestidigitation')).toEqual([
      {
        kind: 'concurrentEffectLimit',
        max: 3,
        scope: 'non-instantaneous-effects',
        dismissCost: 'action',
      },
    ]);
    expect(spellEffects('spell:thaumaturgy')).toEqual([
      {
        kind: 'concurrentEffectLimit',
        max: 3,
        scope: 'one-minute-effects',
        dismissCost: 'action',
      },
    ]);
  });

  it('S1 summoning spells carry typed appearance, control, and lifecycle contracts', () => {
    const s1SpellKeys = [
      'spell:animate-dead',
      'spell:animate-objects',
      'spell:conjure-animals',
      'spell:conjure-celestial',
      'spell:conjure-elemental',
      'spell:conjure-fey',
      'spell:conjure-minor-elementals',
      'spell:conjure-woodland-beings',
      'spell:create-undead',
      'spell:find-familiar',
      'spell:find-steed',
      'spell:giant-insect',
      'spell:phantom-steed',
      'spell:simulacrum',
    ];
    for (const key of s1SpellKeys) {
      expect(spellEffects(key)[0]).toEqual(
        expect.objectContaining({ kind: 'summoning' }),
      );
    }
    expect(spellEffects('spell:conjure-animals')[0]).toEqual(
      expect.objectContaining({
        appears: {
          kind: 'option-menu',
          options: [
            { count: 1, maxChallenge: '2' },
            { count: 2, maxChallenge: '1' },
            { count: 4, maxChallenge: '1/2' },
            { count: 8, maxChallenge: '1/4' },
          ],
          higherSlotMultipliers: { 5: 2, 7: 3, 9: 4 },
        },
        creatureType: { treatedAs: ['fey'] },
        control: expect.objectContaining({
          commandEconomy: { cost: 'verbal-no-action' },
          initiative: 'group',
        }),
      }),
    );
    expect(spellEffects('spell:conjure-elemental')[0]).toEqual(
      expect.objectContaining({
        sourceRequirement: {
          shape: 'cube',
          sizeFeet: 10,
          materialOrTerrain: ['air', 'earth', 'fire', 'water'],
        },
        lifecycle: expect.arrayContaining([
          {
            event: 'concentration-broken',
            result: 'uncontrolled-hostile',
            dismissable: false,
            disappearsAfter: { amount: 1, unit: 'hour' },
          },
        ]),
      }),
    );
    expect(spellEffects('spell:animate-dead')[0]).toEqual(
      expect.objectContaining({
        appears: {
          kind: 'corpse-animation',
          sources: [
            { material: 'pile of bones', becomesRef: 'creature:skeleton' },
            { material: 'corpse', becomesRef: 'creature:zombie' },
          ],
          targetEligibility: {
            creatureType: 'humanoid',
            sizes: ['medium', 'small'],
          },
          baseCount: 1,
          distinctSourcePerCreature: true,
          higherSlotScaling: { perSlotAbove: 3, additionalTargets: 2 },
        },
        control: expect.objectContaining({
          commandEconomy: { cost: 'bonus-action', rangeFeet: 60 },
          window: { amount: 24, unit: 'hour' },
          reassert: {
            maxCreatures: 4,
            higherSlotScaling: { perSlotAbove: 3, additionalTargets: 2 },
          },
        }),
      }),
    );
    expect(spellEffects('spell:animate-objects')[0]).toEqual(
      expect.objectContaining({
        appears: {
          kind: 'object-animation',
          maxObjects: 10,
          sizeCosts: { medium: 2, large: 4, huge: 8 },
          statTableRef: 'table:animated-object-statistics',
          targetEligibility: {
            nonmagical: true,
            notWornOrCarried: true,
            maxSize: 'huge',
          },
          higherSlotScaling: { perSlotAbove: 5, additionalTargets: 2 },
        },
        control: expect.objectContaining({
          commandEconomy: { cost: 'bonus-action', rangeFeet: 500 },
        }),
        lifecycle: [
          {
            event: 'spell-ends',
            result: 'animated-object-reverts',
          },
          {
            event: 'zero-hit-points',
            result: 'animated-object-reverts',
            damageCarriesOver: true,
          },
        ],
      }),
    );
    expect(spellEffects('spell:create-undead')[0]).toEqual(
      expect.objectContaining({
        appears: {
          kind: 'corpse-animation',
          sources: [
            { material: 'corpse', becomesRef: 'creature:ghoul', count: 3 },
          ],
          targetEligibility: {
            creatureType: 'humanoid',
            sizes: ['medium', 'small'],
          },
          castingConstraint: 'night-only',
          higherSlotOptions: [
            {
              level: 7,
              options: [
                { material: 'corpse', becomesRef: 'creature:ghoul', count: 4 },
              ],
            },
            {
              level: 8,
              options: [
                { material: 'corpse', becomesRef: 'creature:ghoul', count: 5 },
                { material: 'corpse', becomesRef: 'creature:ghast', count: 2 },
                { material: 'corpse', becomesRef: 'creature:wight', count: 2 },
              ],
            },
            {
              level: 9,
              options: [
                { material: 'corpse', becomesRef: 'creature:ghoul', count: 6 },
                { material: 'corpse', becomesRef: 'creature:ghast', count: 3 },
                { material: 'corpse', becomesRef: 'creature:wight', count: 3 },
                { material: 'corpse', becomesRef: 'creature:mummy', count: 2 },
              ],
            },
          ],
        },
        control: expect.objectContaining({
          reassert: expect.objectContaining({
            maxCreatures: 3,
            higherSlotOptions: [
              {
                level: 7,
                options: [
                  {
                    material: 'corpse',
                    becomesRef: 'creature:ghoul',
                    count: 4,
                  },
                ],
              },
              {
                level: 8,
                options: [
                  {
                    material: 'corpse',
                    becomesRef: 'creature:ghoul',
                    count: 5,
                  },
                  {
                    material: 'corpse',
                    becomesRef: 'creature:ghast',
                    count: 2,
                  },
                  {
                    material: 'corpse',
                    becomesRef: 'creature:wight',
                    count: 2,
                  },
                ],
              },
              {
                level: 9,
                options: [
                  {
                    material: 'corpse',
                    becomesRef: 'creature:ghoul',
                    count: 6,
                  },
                  {
                    material: 'corpse',
                    becomesRef: 'creature:ghast',
                    count: 3,
                  },
                  {
                    material: 'corpse',
                    becomesRef: 'creature:wight',
                    count: 3,
                  },
                  {
                    material: 'corpse',
                    becomesRef: 'creature:mummy',
                    count: 2,
                  },
                ],
              },
            ],
          }),
        }),
      }),
    );
    expect(spellEffects('spell:find-familiar')[0]).toEqual(
      expect.objectContaining({
        // No defaultBehavior: source states no no-command default behavior.
        control: {
          mode: 'independent-obedient',
          initiative: 'own-turn',
          exclusiveInstance: true,
        },
        lifecycle: expect.arrayContaining([
          {
            event: 'recast',
            result: 'existing-familiar-adopts-new-form',
            priorState: 'active',
          },
          { event: 'recast', result: 'familiar-reappears', priorState: 'gone' },
        ]),
        modifications: [{ attribute: 'cannot-attack' }],
        telepathy: { rangeFeet: 100 },
        senseSharing: {
          cost: 'action',
          casterConditionWhileSharing: ['deaf', 'blind'],
        },
        dismissal: {
          cost: 'action',
          temporary: {
            to: 'pocket-dimension',
            recall: { cost: 'action', rangeFeet: 30 },
          },
          permanent: { cost: 'action', result: 'dismissed-forever' },
        },
        spellDelivery: {
          spellRange: 'touch',
          cost: 'reaction',
          familiarWithinFeet: 100,
        },
      }),
    );
    expect(spellEffects('spell:find-steed')[0]).toEqual(
      expect.objectContaining({
        // Source establishes only an exclusive bond, no obedience/initiative/
        // default-behavior rule for the steed itself.
        control: { exclusiveInstance: true },
        lifecycle: expect.arrayContaining([
          { event: 'action-dismissal', result: 'summoned-creature-disappears' },
          { event: 'action-release', result: 'bond-ends-creature-disappears' },
          {
            event: 'recast',
            result: 'same-steed-returns-restored',
            priorState: 'gone',
          },
        ]),
        dismissal: {
          cost: 'action',
          temporary: { to: 'dismissed', recall: { cost: 'recast' } },
          permanent: { cost: 'action', result: 'bond-released' },
        },
      }),
    );
    expect(spellEffects('spell:giant-insect')[0]).toEqual(
      expect.objectContaining({
        appears: expect.objectContaining({ kind: 'target-transformation' }),
        // No defaultBehavior: source states obedience and caster-turn action
        // but no no-command default behavior.
        control: {
          mode: 'obedient',
          commandEconomy: { cost: 'on-your-turn' },
          initiative: 'acts-on-casters-turn',
        },
        lifecycle: [
          { event: 'spell-ends', result: 'transformed-target-reverts' },
          { event: 'zero-hit-points', result: 'transformed-target-reverts' },
        ],
      }),
    );
    // Phantom Steed defines a rideable mount with no control semantics, so it
    // carries no control block at all.
    expect(spellEffects('spell:phantom-steed')[0]).toEqual(
      expect.objectContaining({
        travel: { normalMilesPerHour: 10, fastMilesPerHour: 13 },
      }),
    );
    expect(spellEffects('spell:phantom-steed')[0]).not.toHaveProperty(
      'control',
    );
    expect(spellEffects('spell:simulacrum')[0]).toEqual(
      expect.objectContaining({
        appears: { kind: 'duplicate', of: 'beast-or-humanoid' },
        control: {
          mode: 'obedient',
          defaultBehavior: 'follows-caster-wishes',
          initiative: 'acts-on-casters-turn',
          exclusiveInstance: true,
        },
        lifecycle: [
          { event: 'zero-hit-points', result: 'duplicate-destroyed' },
          {
            event: 'recast',
            result: 'prior-duplicates-instantly-destroyed',
            priorState: 'active',
          },
        ],
        repair: { costGpPerHitPoint: 100 },
      }),
    );
  });

  it('S2 communication, travel, and recast limits carry typed clauses', () => {
    expect(spellEffects('spell:animal-messenger')).toEqual([
      {
        kind: 'messengerTravel',
        ratesMilesPer24h: { flying: 50, other: 25 },
        maxWords: 25,
        lostIfUndelivered: true,
      },
    ]);
    expect(spellEffects('spell:message')).toEqual([
      {
        kind: 'communicationBarriers',
        magicalSilenceBlocks: true,
        noStraightLineRequired: true,
        materials: [
          {
            material: 'stone',
            thickness: { amount: 1, unit: 'foot' },
            threshold: 'blocks-at-or-above',
          },
          {
            material: 'common-metal',
            thickness: { amount: 1, unit: 'inch' },
            threshold: 'blocks-at-or-above',
          },
          { material: 'lead', threshold: 'any-thin-sheet' },
          {
            material: 'wood',
            thickness: { amount: 3, unit: 'foot' },
            threshold: 'blocks-at-or-above',
          },
        ],
      },
    ]);
    expect(spellEffects('spell:speak-with-dead')).toEqual([
      { kind: 'recastLockout', scope: 'per-target', days: 10 },
      { kind: 'questionLimit', maxQuestions: 5 },
      {
        kind: 'corpseEligibility',
        target: 'corpse',
        requiresMouth: true,
        excludesUndead: true,
      },
    ]);
    expect(spellEffects('spell:sending')).toEqual([
      {
        kind: 'percentChance',
        percent: 5,
        per: 'casting',
        trigger: 'crossrealm-recipient',
        effect: 'delivery-failure',
      },
    ]);
  });

  it('S2 control weather carries onset and table-shift procedure mechanics', () => {
    expect(spellEffects('spell:control-weather')).toEqual([
      { kind: 'onsetTime', roll: '1d4', multiplierMinutes: 10 },
      {
        kind: 'stagedTableShift',
        tableRefs: ['table:precipitation', 'table:temperature', 'table:wind'],
        stepsPerChange: 1,
      },
    ]);
  });

  it('Jump and Spare the Dying carry their deterministic semantics', () => {
    expect(spellEffects('spell:jump')).toEqual([
      { kind: 'jumpDistanceMultiplier', multiplier: 3 },
    ]);
    expect(spellEffects('spell:spare-the-dying')).toEqual([
      { kind: 'stabilize', target: 'living-creature-at-0-hit-points' },
    ]);
  });

  it('resistance spells: choose-one and nonmagical-only shapes', () => {
    expect(spellEffects('spell:protection-from-energy')).toEqual([
      {
        kind: 'damageResistance',
        chooseOne: ['acid', 'cold', 'fire', 'lightning', 'thunder'],
      },
    ]);
    expect(spellEffects('spell:stoneskin')).toEqual([
      {
        kind: 'damageResistance',
        types: ['bludgeoning', 'piercing', 'slashing'],
        nonmagicalOnly: true,
      },
    ]);
  });

  it('movement spells: teleports, slow fall, liquid walking, climbing, breathing', () => {
    expect(spellEffects('spell:misty-step')).toEqual([
      { kind: 'teleport', distanceFeet: 30 },
    ]);
    expect(spellEffects('spell:word-of-recall')).toEqual([
      { kind: 'teleport', destination: 'designated-sanctuary' },
    ]);
    expect(spellEffects('spell:tree-stride')).toEqual([
      {
        kind: 'teleport',
        via: 'trees',
        distanceFeet: 500,
        movementCostFeet: 5,
      },
    ]);
    expect(spellEffects('spell:feather-fall')).toEqual([
      {
        kind: 'slowFall',
        descentFeetPerRound: 60,
        noFallingDamageOnLanding: true,
      },
    ]);
    expect(spellEffects('spell:water-walk')).toEqual([
      { kind: 'walkOnLiquids', surfacingFeetPerRound: 60 },
    ]);
    expect(spellEffects('spell:spider-climb')).toEqual([
      { kind: 'climbAnywhere' },
      { kind: 'speedSet', mode: 'climb', value: 'walking-speed' },
    ]);
    expect(spellEffects('spell:water-breathing')).toEqual([
      { kind: 'breathes', environments: ['air', 'water'] },
    ]);
    expect(spellEffects('spell:expeditious-retreat')).toEqual([
      { kind: 'bonusAction', options: ['dash'], frequency: 'each-turn' },
    ]);
  });

  it('sense spells carry ranges: detect magic, locate creature, truesight', () => {
    expect(spellEffects('spell:detect-magic')).toEqual([
      { kind: 'sense', sense: 'detect-magic', rangeFeet: 30 },
    ]);
    expect(spellEffects('spell:locate-creature')).toEqual([
      { kind: 'sense', sense: 'locate-creature', rangeFeet: 1000 },
    ]);
    expect(spellEffects('spell:locate-animals-or-plants')).toEqual([
      { kind: 'sense', sense: 'locate-named-beast-or-plant', rangeMiles: 5 },
    ]);
    expect(spellEffects('spell:true-seeing')).toEqual([
      { kind: 'sense', sense: 'truesight', rangeFeet: 120 },
    ]);
    expect(spellEffects('spell:comprehend-languages')).toEqual([
      { kind: 'understandLanguages', spoken: true, written: true },
    ]);
    expect(spellEffects('spell:tongues')).toEqual([
      { kind: 'understandLanguages', spoken: true, speechUnderstood: true },
    ]);
  });

  it('weapon-modification and numeric spells: Shillelagh, Arcane Lock, Glibness, Mirror Image, Time Stop', () => {
    expect(spellEffects('spell:shillelagh')).toEqual([
      {
        kind: 'abilitySubstitution',
        use: 'spellcasting-ability',
        insteadOf: 'strength',
        for: ['attack-rolls', 'damage-rolls'],
        appliesTo: 'melee attacks using that weapon',
      },
      { kind: 'damageDieReplacement', die: 'd8', appliesTo: 'that weapon' },
      { kind: 'weaponAttacksMagical', scope: 'weapon-attacks' },
    ]);
    expect(spellEffects('spell:arcane-lock')).toEqual([
      { kind: 'dcIncrease', amount: 10, appliesTo: 'break-or-pick-locks' },
    ]);
    expect(spellEffects('spell:glibness')).toEqual([
      { kind: 'rollFloor', treatAs: 15, scope: 'charisma-checks' },
      {
        kind: 'immunity',
        to: 'magical lie detection (always indicates truthful)',
      },
    ]);
    expect(spellEffects('spell:mirror-image')).toEqual([
      {
        kind: 'mirrorImages',
        images: 3,
        redirectThresholds: [
          { duplicates: 3, minimumRoll: 6 },
          { duplicates: 2, minimumRoll: 8 },
          { duplicates: 1, minimumRoll: 11 },
        ],
        duplicateAcFormula: '10 + your Dexterity modifier',
      },
    ]);
    expect(spellEffects('spell:time-stop')).toEqual([
      { kind: 'extraTurns', turnsDice: '1d4 + 1' },
    ]);
    expect(spellEffects('spell:maze')).toEqual([
      {
        kind: 'banishment',
        destination: 'labyrinthine-demiplane',
        escapeDc: 20,
        escapeAbility: 'intelligence',
        escapeCost: 'action',
      },
    ]);
    expect(spellEffects('spell:blink')).toEqual([
      {
        kind: 'planeShift',
        planes: ['material', 'ethereal'],
        roll: 'd20',
        threshold: 11,
        trigger: 'end-of-each-of-your-turns',
        returnRangeFeet: 10,
      },
    ]);
    expect(spellEffects('spell:forbiddance')).toEqual([
      {
        kind: 'movementRestriction',
        restriction: 'no-teleportation-or-planar-travel-into-area',
        subject: 'all-creatures',
      },
      {
        kind: 'recurringDamage',
        dice: '5d10',
        typeChoice: ['radiant', 'necrotic'],
        trigger:
          'a chosen creature type enters the area for the first time on a turn or starts its turn there',
      },
    ]);
  });

  it('condition-relation corrections: Exhaustion is source-correct for hazards and Greater Restoration', () => {
    const pack = getBundledDnd5eSrdPack();
    const conditionsOf = (key: string) =>
      (
        (
          pack.records.find((r) => r.key === key)?.data as Record<
            string,
            unknown
          >
        ).mechanics as Record<string, unknown>
      ).conditions;
    // "The infected creature gains one level of exhaustion" — applies.
    expect(conditionsOf('hazard:cackle-fever')).toEqual([
      { condition: 'exhaustion', relation: 'applies' },
      { condition: 'incapacitated', relation: 'applies' },
    ]);
    expect(conditionsOf('hazard:sewer-plague')).toEqual([
      { condition: 'exhaustion', relation: 'applies' },
    ]);
    // "reduce the target's exhaustion level by one, or end one of the
    // following effects … charmed or petrified" — removes, not mentions.
    expect(conditionsOf('spell:greater-restoration')).toEqual([
      { condition: 'charmed', relation: 'removes' },
      { condition: 'exhaustion', relation: 'removes' },
      { condition: 'petrified', relation: 'removes' },
    ]);
  });
});
