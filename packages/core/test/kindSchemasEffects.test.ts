import { describe, expect, it } from 'vitest';
import { validateRecordKindSchema } from '../src/rules/kindSchemas.js';
import type { RulesRecord } from '../src/rules/types.js';

/**
 * Negative payload-contract tests for the structured mechanics effect kinds
 * (eshyra-o9bd.18.7.5 review): a recognized `kind` string with a malformed
 * payload must FAIL pack validation, not slide through on the kind
 * whitelist alone.
 */

function featureWithEffect(effect: Record<string, unknown>): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'feature',
    key: 'feature:test:effect',
    name: 'Effect Test',
    data: {
      source: 'class:test',
      level: 1,
      description: 'Test feature.',
      mechanics: { effects: [effect] },
    },
  } as RulesRecord;
}

const validate = (effect: Record<string, unknown>): void =>
  validateRecordKindSchema(featureWithEffect(effect), 'records[0]');

describe('mechanics effect payload contracts', () => {
  it('accepts the emitted damageReduction shapes', () => {
    expect(() =>
      validate({
        kind: 'damageReduction',
        dice: '1d10',
        addAbilityModifier: 'dexterity',
        addClassLevel: 'monk',
      }),
    ).not.toThrow();
    expect(() =>
      validate({
        kind: 'damageReduction',
        multiplier: 0.5,
        scope: 'triggering-attack',
      }),
    ).not.toThrow();
    expect(() =>
      validate({
        kind: 'damageReduction',
        scope: 'falling',
        amountFormula: '5 × monk-level',
      }),
    ).not.toThrow();
  });

  it('rejects malformed damageReduction payloads', () => {
    expect(() => validate({ kind: 'damageReduction' })).toThrow(
      /must carry dice, multiplier, or amountFormula/,
    );
    expect(() =>
      validate({ kind: 'damageReduction', multiplier: 'half' }),
    ).toThrow(/multiplier must be a finite number/);
    expect(() => validate({ kind: 'damageReduction', multiplier: 2 })).toThrow(
      /multiplier must be a finite number/,
    );
    expect(() =>
      validate({ kind: 'damageReduction', amountFormula: 42 }),
    ).toThrow(/amountFormula/);
    expect(() =>
      validate({
        kind: 'damageReduction',
        dice: '1d10',
        addAbilityModifier: 'luck',
      }),
    ).toThrow(/must be an ability name/);
    expect(() => validate({ kind: 'damageReduction', dice: 'a lot' })).toThrow(
      /dice expression/,
    );
  });

  it('rejects malformed payloads for the other structured kinds', () => {
    expect(() =>
      validate({ kind: 'brutalCritical', additionalDice: 'one' }),
    ).toThrow(/additionalDice/);
    expect(() =>
      validate({
        kind: 'abilityScoreIncrease',
        abilities: ['strength', 'luck'],
        amount: 4,
      }),
    ).toThrow(/ability-name array/);
    expect(() =>
      validate({ kind: 'saveDcFormula', base: 8, ability: 'luck' }),
    ).toThrow(/ability name/);
    expect(() => validate({ kind: 'acFormula', base: 10 })).toThrow(
      /abilities/,
    );
    expect(() => validate({ kind: 'extraAttack', attacks: 1 })).toThrow(
      /attacks/,
    );
    expect(() => validate({ kind: 'bonusAction', options: [] })).toThrow(
      /non-empty string array/,
    );
    expect(() =>
      validate({ kind: 'reaction', action: 'melee-weapon-attack' }),
    ).toThrow(/trigger/);
    expect(() =>
      validate({
        kind: 'resourceRegain',
        resource: 'ki-points',
        amount: 0,
        trigger: 't',
      }),
    ).toThrow(/amount/);
    expect(() =>
      validate({ kind: 'permanentSpellEffect', spell: 'not-a-ref' }),
    ).toThrow(/spell:/);
    expect(() =>
      validate({
        kind: 'abilitySubstitution',
        use: 'dexterity',
        insteadOf: 'vigor',
      }),
    ).toThrow(/ability name/);
    expect(() =>
      validate({ kind: 'weaponAttacksMagical', scope: 'everything' }),
    ).toThrow(/scope/);
  });

  it('validates corrected creature-entry cleanup effect payloads', () => {
    expect(() =>
      validate({
        kind: 'damageTransfer',
        portion: 'half',
        rounding: 'down',
      }),
    ).not.toThrow();
    expect(() =>
      validate({
        kind: 'damageTransfer',
        portion: 'half',
        rounding: 'up',
      }),
    ).not.toThrow();
    expect(() => validate({ kind: 'damageTransfer', portion: 'half' })).toThrow(
      /rounding/,
    );
    expect(() =>
      validate({
        kind: 'swarm',
        canOccupyOtherCreaturesSpace: true,
        cannotRegainHitPoints: true,
        cannotGainTemporaryHitPoints: true,
      }),
    ).not.toThrow();
    expect(() =>
      validate({
        kind: 'tunneler',
        solidRockBurrowSpeedMultiplier: 0.5,
        tunnelDiameterFeet: 10,
      }),
    ).not.toThrow();
    expect(() =>
      validate({
        kind: 'tunneler',
        tunnelDiameterFeet: 10,
      }),
    ).toThrow(/solidRockBurrowSpeedMultiplier/);
  });

  it('accepts every emitted shape of the eshyra-o9bd.18.7.5 re-audit kinds', () => {
    const eligibility = {
      wielding: 'unarmed-or-monk-weapons-only',
      armor: false,
      shield: false,
    };
    const emitted: Record<string, unknown>[] = [
      { kind: 'attackOrDamageBonus', addAbilityModifier: 'wisdom' },
      {
        kind: 'autoSucceedSave',
        targets: 'chosen-creatures',
        countFormula: '1 + spell-level',
        noDamageInsteadOfHalf: true,
      },
      { kind: 'climbWithoutExtraMovement' },
      { kind: 'evasion' },
      { kind: 'damageBonus', amount: 2 },
      {
        kind: 'damageBonus',
        addAbilityModifier: 'charisma',
        scope: 'one-damage-roll',
      },
      {
        kind: 'damageDieReplacement',
        die: 'd4',
        appliesTo: 'your unarmed strike or monk weapon',
        progression: { classRef: 'class:monk', resource: 'martialArts' },
        eligibility,
      },
      {
        kind: 'damageOnSuccessfulSave',
        portion: 'half',
        scope: 'your-cantrips',
      },
      { kind: 'extraTurn', round: 1, secondTurnInitiativeOffset: -10 },
      { kind: 'expertise' },
      {
        kind: 'expertise',
        ability: 'intelligence',
        skill: 'history',
        condition: 'related to the origin of stonework',
      },
      { kind: 'halfProficiencyToChecks', round: 'down', scope: 'ability' },
      {
        kind: 'jumpDistanceBonus',
        addAbilityModifier: 'dexterity',
        appliesTo: 'running-jump',
      },
      { kind: 'maximizeHealingDice', appliesTo: 'spell-healing' },
      { kind: 'slowAging', periodYears: 10, agesYears: 1 },
      { kind: 'speedSet', speed: 0, subject: 'conditioned' },
      {
        kind: 'speedSet',
        mode: 'fly',
        value: 'current-speed',
        activation: { cost: 'bonus-action' },
        deactivation: { cost: 'bonus-action' },
        eligibility: { armor: 'accommodating-armor-only' },
      },
      {
        kind: 'bonusAction',
        options: ['unarmed-strike'],
        prerequisite: 'attack-action-with-unarmed-strike-or-monk-weapon',
        eligibility,
      },
      {
        kind: 'abilitySubstitution',
        use: 'dexterity',
        insteadOf: 'strength',
        for: ['attack-rolls', 'damage-rolls'],
        appliesTo: 'your unarmed strikes and monk weapons',
        eligibility,
      },
    ];
    for (const effect of emitted) {
      expect(() => validate(effect), JSON.stringify(effect)).not.toThrow();
    }
  });

  it('rejects malformed payloads for the eshyra-o9bd.18.7.5 re-audit kinds', () => {
    expect(() =>
      validate({ kind: 'attackOrDamageBonus', addAbilityModifier: 'luck' }),
    ).toThrow(/ability name/);
    expect(() =>
      validate({ kind: 'autoSucceedSave', targets: 'chosen-creatures' }),
    ).toThrow(/countFormula/);
    expect(() =>
      validate({
        kind: 'autoSucceedSave',
        targets: 'chosen-creatures',
        countFormula: '1 + spell-level',
        noDamageInsteadOfHalf: 'yes',
      }),
    ).toThrow(/noDamageInsteadOfHalf/);
    // Marker-only kinds must not carry payload fields at all.
    expect(() =>
      validate({ kind: 'climbWithoutExtraMovement', speed: 30 }),
    ).toThrow(/marker-only/);
    expect(() => validate({ kind: 'evasion', portion: 'half' })).toThrow(
      /marker-only/,
    );
    expect(() => validate({ kind: 'damageBonus' })).toThrow(
      /exactly one of amount or addAbilityModifier/,
    );
    expect(() =>
      validate({
        kind: 'damageBonus',
        amount: 2,
        addAbilityModifier: 'charisma',
      }),
    ).toThrow(/exactly one of amount or addAbilityModifier/);
    expect(() => validate({ kind: 'damageBonus', amount: 2.5 })).toThrow(
      /integer/,
    );
    expect(() => validate({ kind: 'damageDieReplacement', die: 'd4' })).toThrow(
      /appliesTo/,
    );
    expect(() =>
      validate({
        kind: 'damageDieReplacement',
        die: 'four-sided',
        appliesTo: 'unarmed strikes',
      }),
    ).toThrow(/dice expression/);
    expect(() =>
      validate({
        kind: 'damageDieReplacement',
        die: 'd4',
        appliesTo: 'unarmed strikes',
        progression: { classRef: 'monk', resource: 'martialArts' },
      }),
    ).toThrow(/class:/);
    expect(() =>
      validate({
        kind: 'damageDieReplacement',
        die: 'd4',
        appliesTo: 'unarmed strikes',
        eligibility: { armor: 'no-heavy' },
      }),
    ).toThrow(/eligibility\.armor/);
    expect(() =>
      validate({
        kind: 'damageDieReplacement',
        die: 'd4',
        appliesTo: 'unarmed strikes',
        eligibility: { stance: 'defensive' },
      }),
    ).toThrow(/unsupported key/);
    expect(() =>
      validate({
        kind: 'damageOnSuccessfulSave',
        portion: 'quarter',
        scope: 'your-cantrips',
      }),
    ).toThrow(/portion/);
    expect(() =>
      validate({
        kind: 'extraTurn',
        round: 0,
        secondTurnInitiativeOffset: -10,
      }),
    ).toThrow(/round/);
    expect(() =>
      validate({
        kind: 'extraTurn',
        round: 1,
        secondTurnInitiativeOffset: 'minus ten',
      }),
    ).toThrow(/secondTurnInitiativeOffset/);
    expect(() => validate({ kind: 'expertise', ability: 'luck' })).toThrow(
      /ability name/,
    );
    expect(() =>
      validate({
        kind: 'halfProficiencyToChecks',
        round: 'sideways',
        scope: 'ability',
      }),
    ).toThrow(/round/);
    expect(() =>
      validate({ kind: 'halfProficiencyToChecks', round: 'up' }),
    ).toThrow(/scope/);
    expect(() =>
      validate({ kind: 'jumpDistanceBonus', appliesTo: 'running-jump' }),
    ).toThrow(/addAbilityModifier/);
    expect(() => validate({ kind: 'maximizeHealingDice' })).toThrow(
      /appliesTo/,
    );
    expect(() =>
      validate({ kind: 'slowAging', periodYears: 0, agesYears: 1 }),
    ).toThrow(/periodYears/);
    expect(() =>
      validate({ kind: 'speedSet', mode: 'teleport', value: 30 }),
    ).toThrow(/mode/);
    expect(() =>
      validate({ kind: 'speedSet', mode: 'fly', value: 'twice-current' }),
    ).toThrow(/value/);
    expect(() =>
      validate({
        kind: 'speedSet',
        mode: 'fly',
        value: 'current-speed',
        activation: { cost: 'free' },
      }),
    ).toThrow(/cost/);
    expect(() =>
      validate({
        kind: 'bonusAction',
        options: ['unarmed-strike'],
        prerequisite: '',
      }),
    ).toThrow(/prerequisite/);
  });

  it('accepts the emitted shapes of the eshyra-o9bd.18.7.9 corrective kinds', () => {
    const emitted: Record<string, unknown>[] = [
      {
        kind: 'multiattack',
        attacksFormula: 'one-per-head',
        attackName: 'bite',
      },
      { kind: 'multiattack', attacksDice: '1d4' },
      {
        kind: 'multiattack',
        options: [
          { attacks: 3, attackType: 'melee' },
          { attacks: 2, attackType: 'ranged' },
        ],
      },
      {
        kind: 'multiattack',
        attacks: 7,
        routine: [
          { attacks: 6, attack: 'longswords' },
          { attacks: 1, attack: 'tail' },
        ],
      },
      { kind: 'extraReactions', perTurn: 1 },
      {
        kind: 'extraReactions',
        formula: 'one-per-head-beyond-one',
        restrictedTo: 'opportunity-attacks',
      },
      { kind: 'moveUpTo', amount: 'half-speed' },
      { kind: 'moveUpTo', amount: 'speed', withoutOpportunityAttacks: true },
      { kind: 'climbWithoutCheck' },
      { kind: 'climbWithoutCheck', surfaces: 'icy' },
      { kind: 'ignoreDifficultTerrain', terrain: ['ice', 'snow'] },
      { kind: 'ignoreMovementRestriction', source: 'webbing' },
      { kind: 'moveThroughNarrowSpaces', widthInches: 1 },
      { kind: 'earthGlide' },
      { kind: 'enterHostileSpace' },
      {
        kind: 'tunneler',
        solidRockBurrowSpeedMultiplier: 0.5,
        tunnelDiameterFeet: 10,
      },
      { kind: 'teleport', distanceFeet: 120 },
      { kind: 'teleport', destination: 'designated-sanctuary' },
      {
        kind: 'teleport',
        via: 'trees',
        distanceFeet: 500,
        movementCostFeet: 5,
      },
      { kind: 'planeShift', planes: ['material', 'ethereal'] },
      {
        kind: 'planeShift',
        planes: ['material', 'ethereal'],
        roll: 'd20',
        threshold: 11,
        trigger: 'end-of-each-of-your-turns',
        returnRangeFeet: 10,
      },
      { kind: 'seeInMagicalDarkness' },
      { kind: 'sense', sense: 'web-sense' },
      { kind: 'sense', sense: 'locate-named-beast-or-plant', rangeMiles: 5 },
      { kind: 'extraWeaponDamageDie', extraDice: 1 },
      { kind: 'damageTransfer', portion: 'half', rounding: 'down' },
      {
        kind: 'damageTransfer',
        portion: 'half',
        rounding: 'up',
        from: 'amulet-wearer',
        rangeFeet: 60,
      },
      {
        kind: 'recurringDamage',
        amount: 20,
        type: 'acid',
        trigger: 'ends-turn-in-running-water',
      },
      {
        kind: 'recurringDamage',
        dice: '5d10',
        typeChoice: ['radiant', 'necrotic'],
        trigger: 'enters the area',
      },
      {
        kind: 'weaponCorrosion',
        penaltyPerHit: -1,
        destroyedAtPenalty: -5,
        ammunitionDestroyedOnHit: true,
      },
      {
        kind: 'spellReflection',
        roll: 'd6',
        unaffectedOnMaximum: 5,
        reflectedOn: 6,
      },
      { kind: 'rejuvenation', afterHours: 24, condition: 'heart-intact' },
      { kind: 'rejuvenation', afterDaysDice: '1d10' },
      {
        kind: 'swarm',
        canOccupyOtherCreaturesSpace: true,
        cannotRegainHitPoints: true,
        cannotGainTemporaryHitPoints: true,
      },
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
      {
        kind: 'hiddenFromView',
        spotDc: 15,
        ability: 'wisdom',
        skill: 'perception',
      },
      { kind: 'mimicry', discernDc: 10, ability: 'wisdom', skill: 'insight' },
      { kind: 'limitedAmmunition', count: 24, replenish: 'long-rest' },
      { kind: 'carryingCapacitySize', size: 'large' },
      { kind: 'spellStoring', maximumSpellLevel: 4, capacity: 1 },
      {
        kind: 'illusoryDisguise',
        discernDc: 20,
        ability: 'intelligence',
        skill: 'investigation',
        inspectionCost: 'action',
        endCost: 'bonus-action',
      },
      {
        kind: 'hoveringWeapon',
        weapon: 'greatsword',
        releaseRangeFeet: 5,
        commandCost: 'bonus-action',
        commandFlyFeet: 50,
        commandOptions: ['make-one-attack', 'return-to-hand'],
      },
      {
        kind: 'summonCreature',
        creature: 'specter',
        rangeFeet: 10,
        maximumControlled: 7,
      },
      { kind: 'cannotWearOrCarry' },
      {
        kind: 'movementRestriction',
        restriction: 'cannot-enter-residence-without-invitation',
      },
      { kind: 'triggeredEffect', trigger: 'If it dies' },
      {
        kind: 'triggeredEffect',
        trigger: 'a creature enters its space while unaware of it',
        result: 'that creature is surprised',
      },
      { kind: 'jumpDistanceMultiplier', multiplier: 3 },
      { kind: 'stabilize', target: 'living-creature-at-0-hit-points' },
      {
        kind: 'slowFall',
        descentFeetPerRound: 60,
        noFallingDamageOnLanding: true,
      },
      { kind: 'walkOnLiquids', surfacingFeetPerRound: 60 },
      { kind: 'climbAnywhere' },
      { kind: 'understandLanguages', spoken: true, written: true },
      {
        kind: 'unlock',
        audibleRangeFeet: 300,
        suppressesArcaneLockMinutes: 10,
      },
      { kind: 'dcIncrease', amount: 10, appliesTo: 'break-or-pick-locks' },
      { kind: 'endsCurses' },
      { kind: 'extraTurns', turnsDice: '1d4 + 1' },
      {
        kind: 'banishment',
        destination: 'labyrinthine-demiplane',
        escapeDc: 20,
        escapeAbility: 'intelligence',
        escapeCost: 'action',
      },
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
      { kind: 'movementCostMultiplier', feetPerFoot: 4 },
      {
        kind: 'naturalWeaponDamage',
        dice: '1d6',
        typeChoice: ['bludgeoning', 'piercing', 'slashing'],
        attackAndDamageBonus: 1,
        magical: true,
        proficient: true,
      },
      { kind: 'breathes', environments: ['air', 'water'] },
      {
        kind: 'obscurement',
        level: 'heavily',
        source: 'magical-darkness',
        radiusFeet: 15,
        blocksDarkvision: true,
      },
      {
        kind: 'damageResistance',
        chooseOne: ['acid', 'cold', 'fire', 'lightning', 'thunder'],
      },
      {
        kind: 'damageResistance',
        types: ['bludgeoning', 'piercing', 'slashing'],
        nonmagicalOnly: true,
      },
      { kind: 'light', equivalentTo: 'torch' },
      { kind: 'rollFloor', treatAs: 15, scope: 'charisma-checks' },
      {
        kind: 'abilitySubstitution',
        use: 'spellcasting-ability',
        insteadOf: 'strength',
      },
      {
        kind: 'illusionDiscernment',
        ability: 'intelligence',
        skill: 'investigation',
        dc: 'spell-save-dc',
        cost: 'action',
      },
      { kind: 'speedSet', mode: 'swim', value: 'walking-speed' },
      // Explicit trigger/result linkage (eshyra-o9bd.18.7.9 §2): Surprise
      // Attack and Freeze attach their governing trigger directly to the
      // substantive effect instead of a disconnected bare triggeredEffect.
      {
        kind: 'extraDamage',
        dice: '2d6',
        trigger:
          'If the bugbear surprises a creature and hits it with an attack during the first round of combat',
      },
      {
        kind: 'movementRestriction',
        restriction: 'speed-reduced-by-20-feet',
        endsBy: 'end-of-next-turn',
        trigger: 'If the elemental takes cold damage',
      },
    ];
    for (const effect of emitted) {
      expect(() => validate(effect), JSON.stringify(effect)).not.toThrow();
    }
  });

  it('rejects malformed payloads for the eshyra-o9bd.18.7.9 corrective kinds', () => {
    expect(() => validate({ kind: 'multiattack' })).toThrow(
      /exactly one of attacks, options, attacksFormula, or attacksDice/,
    );
    expect(() =>
      validate({ kind: 'multiattack', attacks: 2, attacksDice: '1d4' }),
    ).toThrow(/exactly one/);
    expect(() =>
      validate({ kind: 'multiattack', attacksFormula: 'one-per-tentacle' }),
    ).toThrow(/attacksFormula/);
    expect(() =>
      validate({
        kind: 'multiattack',
        attacks: 7,
        routine: [{ attacks: 6 }],
      }),
    ).toThrow(/routine\[0\]\.attack/);
    expect(() =>
      validate({
        kind: 'multiattack',
        options: [{ attacks: 3, attackType: 'psychic' }],
      }),
    ).toThrow(/attackType/);
    expect(() => validate({ kind: 'extraReactions' })).toThrow(
      /exactly one of perTurn or formula/,
    );
    expect(() =>
      validate({ kind: 'moveUpTo', amount: 'double-speed' }),
    ).toThrow(/amount/);
    expect(() => validate({ kind: 'earthGlide', speed: 30 })).toThrow(
      /marker-only/,
    );
    expect(() => validate({ kind: 'enterHostileSpace', size: 'Tiny' })).toThrow(
      /marker-only/,
    );
    expect(() => validate({ kind: 'teleport' })).toThrow(
      /distanceFeet or destination/,
    );
    expect(() => validate({ kind: 'teleport', distanceFeet: 0 })).toThrow(
      /distanceFeet/,
    );
    expect(() => validate({ kind: 'planeShift', planes: [] })).toThrow(
      /planes/,
    );
    expect(() =>
      validate({
        kind: 'planeShift',
        planes: ['material', 'ethereal'],
        roll: 'twenty-sider',
      }),
    ).toThrow(/roll must be a die/);
    expect(() =>
      validate({ kind: 'recurringDamage', amount: 20, trigger: 't' }),
    ).toThrow(/type or typeChoice/);
    expect(() =>
      validate({
        kind: 'recurringDamage',
        amount: 20,
        dice: '5d10',
        type: 'acid',
        trigger: 't',
      }),
    ).toThrow(/amount or dice/);
    expect(() =>
      validate({
        kind: 'recurringDamage',
        dice: '5d10',
        typeChoice: ['radiant', 'holy'],
        trigger: 't',
      }),
    ).toThrow(/typeChoice/);
    expect(() =>
      validate({
        kind: 'weaponCorrosion',
        penaltyPerHit: 1,
        destroyedAtPenalty: -5,
      }),
    ).toThrow(/negative/);
    expect(() =>
      validate({ kind: 'spellReflection', roll: 'd6', unaffectedOnMaximum: 5 }),
    ).toThrow(/reflectedOn/);
    expect(() => validate({ kind: 'rejuvenation' })).toThrow(
      /afterHours or afterDaysDice/,
    );
    expect(() =>
      validate({ kind: 'swarm', canOccupyOtherCreaturesSpace: false }),
    ).toThrow(/canOccupyOtherCreaturesSpace/);
    expect(() =>
      validate({
        kind: 'attackableAppendage',
        appendage: 'tendril',
        ac: 20,
        hitPoints: 10,
        immunities: 'poison',
        breakAbility: 'grit',
      }),
    ).toThrow(/ability name/);
    expect(() =>
      validate({ kind: 'carryingCapacitySize', size: 'colossal' }),
    ).toThrow(/size/);
    expect(() =>
      validate({ kind: 'spellStoring', maximumSpellLevel: 10 }),
    ).toThrow(/<= 9/);
    expect(() =>
      validate({
        kind: 'illusoryDisguise',
        discernDc: 20,
        ability: 'intelligence',
        skill: 'investigation',
        inspectionCost: 'free',
      }),
    ).toThrow(/inspectionCost/);
    expect(() =>
      validate({
        kind: 'hoveringWeapon',
        weapon: 'greatsword',
        releaseRangeFeet: 5,
        commandCost: 'bonus-action',
        commandFlyFeet: 50,
      }),
    ).toThrow(/commandOptions/);
    expect(() =>
      validate({ kind: 'summonCreature', creature: 'specter' }),
    ).toThrow(/rangeFeet/);
    expect(() => validate({ kind: 'cannotWearOrCarry', weight: 0 })).toThrow(
      /marker-only/,
    );
    expect(() => validate({ kind: 'movementRestriction' })).toThrow(
      /restriction/,
    );
    expect(() => validate({ kind: 'triggeredEffect', result: 'r' })).toThrow(
      /trigger/,
    );
    expect(() =>
      validate({ kind: 'jumpDistanceMultiplier', multiplier: 1 }),
    ).toThrow(/multiplier/);
    expect(() =>
      validate({ kind: 'slowFall', noFallingDamageOnLanding: true }),
    ).toThrow(/descentFeetPerRound/);
    expect(() => validate({ kind: 'climbAnywhere', speed: 30 })).toThrow(
      /marker-only/,
    );
    expect(() =>
      validate({ kind: 'understandLanguages', written: true }),
    ).toThrow(/spoken/);
    expect(() => validate({ kind: 'endsCurses', scope: 'all' })).toThrow(
      /marker-only/,
    );
    expect(() =>
      validate({ kind: 'extraTurns', turnsDice: 'several' }),
    ).toThrow(/dice expression/);
    expect(() =>
      validate({
        kind: 'banishment',
        destination: 'demiplane',
        escapeDc: 20,
        escapeAbility: 'cunning',
        escapeCost: 'action',
      }),
    ).toThrow(/ability name/);
    expect(() =>
      validate({ kind: 'mirrorImages', images: 3, redirectThresholds: [] }),
    ).toThrow(/redirectThresholds/);
    expect(() =>
      validate({ kind: 'movementCostMultiplier', feetPerFoot: 1 }),
    ).toThrow(/feetPerFoot/);
    expect(() =>
      validate({
        kind: 'naturalWeaponDamage',
        dice: '1d6',
        typeChoice: ['sharpness'],
      }),
    ).toThrow(/typeChoice/);
    expect(() =>
      validate({ kind: 'breathes', environments: ['lava'] }),
    ).toThrow(/environments/);
    expect(() => validate({ kind: 'obscurement', level: 'totally' })).toThrow(
      /level/,
    );
    expect(() =>
      validate({
        kind: 'damageResistance',
        types: ['fire'],
        chooseOne: ['cold'],
      }),
    ).toThrow(/exactly one/);
    expect(() =>
      validate({ kind: 'damageResistance', chooseOne: ['warmth'] }),
    ).toThrow(/chooseOne/);
    expect(() => validate({ kind: 'light', equivalentTo: 'bonfire' })).toThrow(
      /equivalentTo/,
    );
    expect(() => validate({ kind: 'rollFloor', scope: 'checks' })).toThrow(
      /treatAs/,
    );
    expect(() =>
      validate({
        kind: 'abilitySubstitution',
        use: 'luck',
        insteadOf: 'strength',
      }),
    ).toThrow(/ability name/);
    expect(() =>
      validate({
        kind: 'illusionDiscernment',
        ability: 'intelligence',
        skill: 'investigation',
        dc: 'fixed-20',
      }),
    ).toThrow(/dc/);
    expect(() => validate({ kind: 'unlock', audibleRangeFeet: 0 })).toThrow(
      /audibleRangeFeet/,
    );
    expect(() => validate({ kind: 'dcIncrease', amount: 10 })).toThrow(
      /appliesTo/,
    );
    expect(() => validate({ kind: 'stabilize', target: '' })).toThrow(/target/);
    expect(() =>
      validate({ kind: 'walkOnLiquids', surfacingFeetPerRound: 0 }),
    ).toThrow(/surfacingFeetPerRound/);
    expect(() =>
      validate({ kind: 'hiddenFromView', spotDc: 15, ability: 'wisdom' }),
    ).toThrow(/skill/);
    expect(() =>
      validate({
        kind: 'mimicry',
        discernDc: 0,
        ability: 'wisdom',
        skill: 'insight',
      }),
    ).toThrow(/discernDc/);
    expect(() => validate({ kind: 'limitedAmmunition', count: 24 })).toThrow(
      /replenish/,
    );
    expect(() =>
      validate({
        kind: 'tunneler',
        solidRockBurrowSpeedMultiplier: 0.5,
        tunnelDiameterFeet: 0,
      }),
    ).toThrow(/tunnelDiameterFeet/);
    expect(() => validate({ kind: 'moveThroughNarrowSpaces' })).toThrow(
      /widthInches/,
    );
    expect(() =>
      validate({ kind: 'ignoreDifficultTerrain', terrain: [] }),
    ).toThrow(/terrain/);
    expect(() => validate({ kind: 'ignoreMovementRestriction' })).toThrow(
      /source/,
    );
    expect(() =>
      validate({ kind: 'extraWeaponDamageDie', extraDice: 0 }),
    ).toThrow(/extraDice/);
    expect(() => validate({ kind: 'damageTransfer', portion: 'all' })).toThrow(
      /portion/,
    );
  });
});
