import { describe, expect, it } from 'vitest';
import {
  materializeS1RulesAmbiguities,
  materializeS1SummoningEffect,
  S1_SUMMONING_SPELL_KEYS,
  type S1SummoningSpellKey,
} from '../scripts/importers/dnd5e-srd-5.1/s1SummoningSpecs.js';
import { validateRecordKindSchema } from '../src/rules/kindSchemas.js';
import type { RulesRecord } from '../src/rules/types.js';

/**
 * Negative payload-contract tests for the structured mechanics effect kinds
 * (eshyra-o9bd.18.7.5 review): a recognized `kind` string with a malformed
 * payload must FAIL pack validation, not slide through on the kind
 * whitelist alone.
 */

function featureWithEffect(
  effect: Record<string, unknown>,
  concentration = false,
  ambiguities?: readonly unknown[],
): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'feature',
    key: 'feature:test:effect',
    name: 'Effect Test',
    data: {
      source: 'class:test',
      level: 1,
      description: 'Test feature.',
      mechanics: {
        effects: [effect],
        ...(ambiguities === undefined ? {} : { ambiguities }),
        ...(concentration
          ? {
              duration: {
                kind: 'timed',
                amount: 1,
                unit: 'hour',
                upTo: true,
                concentration: true,
              },
            }
          : {}),
      },
    },
  } as RulesRecord;
}

const validate = (
  effect: Record<string, unknown>,
  concentration = false,
): void => {
  const serialized = JSON.stringify(effect);
  const ambiguities = serialized.includes(
    'ambiguity:create-undead-ghast-wight-composition',
  )
    ? materializeS1RulesAmbiguities('spell:create-undead')
    : serialized.includes(
          'ambiguity:find-familiar-permanent-dismissal-after-zero-hp',
        )
      ? materializeS1RulesAmbiguities('spell:find-familiar')
      : undefined;
  validateRecordKindSchema(
    featureWithEffect(effect, concentration, ambiguities),
    'records[0]',
  );
};

const validateWithAmbiguities = (
  effect: Record<string, unknown>,
  ambiguities: readonly unknown[],
): void =>
  validateRecordKindSchema(
    featureWithEffect(effect, false, ambiguities),
    'records[0]',
  );

function setAt(
  root: Record<string, unknown>,
  path: readonly (string | number)[],
  value: unknown,
): void {
  let cursor: unknown = root;
  for (const segment of path.slice(0, -1)) {
    if (typeof cursor !== 'object' || cursor === null) {
      throw new Error(`Invalid mutation path: ${path.join('.')}`);
    }
    cursor = (cursor as Record<PropertyKey, unknown>)[segment];
  }
  if (typeof cursor !== 'object' || cursor === null) {
    throw new Error(`Invalid mutation path: ${path.join('.')}`);
  }
  (cursor as Record<PropertyKey, unknown>)[path.at(-1) as string | number] =
    value;
}

describe('mechanics effect payload contracts', () => {
  it('accepts the exact C5 splitOnDamage payload', () => {
    expect(() =>
      validate({
        kind: 'splitOnDamage',
        damageTypes: ['lightning', 'slashing'],
        minimumSize: 'medium',
        minimumHitPoints: 10,
        resultingCreatureCount: 2,
        hitPointsFraction: 'half-rounded-down',
        sizeCategoriesDown: 1,
      }),
    ).not.toThrow();
  });

  it.each([
    ['empty damage types', { damageTypes: [] }],
    ['unsupported damage type', { damageTypes: ['radiant-ish'] }],
    ['duplicate damage type', { damageTypes: ['lightning', 'lightning'] }],
    ['absent required field', { minimumHitPoints: undefined }],
    ['invalid minimum size', { minimumSize: 'colossal' }],
    ['invalid minimum hit points', { minimumHitPoints: 1.5 }],
    ['invalid result count', { resultingCreatureCount: 0 }],
    ['unsupported HP fraction', { hitPointsFraction: 'half' }],
    ['invalid size reduction', { sizeCategoriesDown: 0 }],
    ['unexpected extra property', { extra: true }],
  ])('rejects splitOnDamage with %s', (_label, change) => {
    const effect: Record<string, unknown> = {
      kind: 'splitOnDamage',
      damageTypes: ['lightning', 'slashing'],
      minimumSize: 'medium',
      minimumHitPoints: 10,
      resultingCreatureCount: 2,
      hitPointsFraction: 'half-rounded-down',
      sizeCategoriesDown: 1,
    };
    for (const [key, value] of Object.entries(change)) {
      if (value === undefined) delete effect[key];
      else effect[key] = value;
    }
    expect(() => validate(effect)).toThrow();
  });

  it('accepts all curated S1 summoning profiles', () => {
    expect([...S1_SUMMONING_SPELL_KEYS]).toHaveLength(14);
    for (const key of S1_SUMMONING_SPELL_KEYS) {
      expect(
        () =>
          validate(
            materializeS1SummoningEffect(key),
            key === 'spell:conjure-elemental' || key === 'spell:conjure-fey',
          ),
        key,
      ).not.toThrow();
    }
  });

  it('rejects impossible S1 state, creation, control, and protocol combinations', () => {
    const mutate = (
      key: S1SummoningSpellKey,
      change: (effect: Record<string, unknown>) => void,
    ): Record<string, unknown> => {
      const effect = structuredClone(materializeS1SummoningEffect(key));
      change(effect);
      return effect;
    };

    expect(() =>
      validate(
        mutate('spell:conjure-animals', (effect) => {
          setAt(effect, ['unreviewed'], true);
        }),
      ),
    ).toThrow(/unexpected payload key/);

    expect(() =>
      validate(
        mutate('spell:conjure-animals', (effect) => {
          setAt(effect, ['initialState', 'link'], 'active');
        }),
      ),
    ).toThrow(/unexpected payload key "link"/);

    expect(() =>
      validate(
        mutate('spell:find-steed', (effect) => {
          setAt(effect, ['initialState', 'presence'], 'pocket-dimension');
        }),
      ),
    ).toThrow(/unsupported state value pocket-dimension/);

    expect(() =>
      validate(
        mutate('spell:animate-dead', (effect) => {
          setAt(effect, ['transitions', 1, 'when', 'control'], 'uncontrolled');
        }),
      ),
    ).toThrow(/reassert-control requires controlled state before expiry/);

    expect(() =>
      validate(
        mutate('spell:animate-dead', (effect) => {
          setAt(
            effect,
            ['transitions', 1, 'operation', 'deadline'],
            'after-expiry',
          );
        }),
      ),
    ).toThrow(/invalid reassert-control eligibility or deadline/);

    expect(() =>
      validate(
        mutate('spell:conjure-elemental', (effect) => {
          setAt(
            effect,
            ['transitions', 3, 'timer', 'anchor'],
            'transition-trigger',
          );
        }),
      ),
    ).toThrow(/must be anchored to spell-cast/);

    expect(() =>
      validate(
        mutate('spell:conjure-fey', (effect) => {
          setAt(effect, ['transitions', 0, 'exceptCauses'], undefined);
        }),
      ),
    ).toThrow(/must exclude concentration-broken/);

    expect(() =>
      validate(
        mutate('spell:conjure-elemental', (effect) => {
          setAt(effect, ['causePrecedence'], {
            higher: 'spell-ended',
            lower: 'concentration-broken',
          });
        }),
      ),
    ).toThrow(/give concentration-broken precedence/);

    expect(() =>
      validate(
        mutate('spell:giant-insect', (effect) => {
          setAt(
            effect,
            ['creation', 'options', 0, 'cardinality', 'mode'],
            'exact',
          );
        }),
      ),
    ).toThrow(/target alternatives require maximum counts/);

    expect(() =>
      validate(
        mutate('spell:conjure-animals', (effect) => {
          setAt(
            effect,
            ['creation', 'options', 0, 'cardinality', 'mode'],
            'maximum',
          );
        }),
      ),
    ).toThrow(/candidate menus require exact counts/);

    expect(() =>
      validate(
        mutate('spell:conjure-fey', (effect) => {
          setAt(effect, ['typeTreatment', 'whenCandidateType'], 'dragon');
        }),
      ),
    ).toThrow(/must name an eligible candidate type/);

    expect(() =>
      validate(
        mutate('spell:giant-insect', (effect) => {
          setAt(effect, ['control', 'command', 'cost'], 'none');
        }),
      ),
    ).toThrow(/command keys must be exactly/);

    expect(() =>
      validate(
        mutate('spell:simulacrum', (effect) => {
          setAt(effect, ['control', 'command', 'fallback'], {
            when: 'no-new-command',
            behavior: 'defend-self-only',
          });
        }),
      ),
    ).toThrow(/command keys must be exactly/);

    expect(() =>
      validate(
        mutate('spell:find-familiar', (effect) => {
          setAt(effect, ['transitions', 5, 'when', 'link'], 'none');
        }),
      ),
    ).toThrow(/terminated link|active persistent link/);

    expect(() =>
      validate(
        mutate('spell:find-familiar', (effect) => {
          setAt(effect, ['transitions', 2, 'when'], {
            presence: 'pocket-dimension',
            link: 'none',
          });
        }),
      ),
    ).toThrow(/terminated link|unreachable precondition/);

    expect(() =>
      validate(
        mutate('spell:conjure-celestial', (effect) => {
          setAt(effect, ['identity'], {
            kind: 'persistent-linked',
            maximumLinked: 1,
          });
        }),
      ),
    ).toThrow(/must be ordinary/);

    expect(() =>
      validate(
        mutate('spell:animate-objects', (effect) => {
          setAt(
            effect,
            ['statBlockOverlay', 'tableRef'],
            'creature:animated-object',
          );
        }),
      ),
    ).toThrow(/table:\* reference/);

    expect(() =>
      validate(
        mutate('spell:conjure-minor-elementals', (effect) => {
          setAt(effect, ['protocols'], [{ kind: 'telepathy', rangeFeet: 100 }]);
        }),
      ),
    ).toThrow(/is not licensed by profile ordinary-summon/);

    expect(() =>
      validate(
        mutate('spell:phantom-steed', (effect) => {
          setAt(effect, ['transitions', 0, 'when', 'effect'], 'ended');
        }),
      ),
    ).toThrow(/ended state|unreachable precondition/);

    expect(() =>
      validate(
        mutate('spell:simulacrum', (effect) => {
          setAt(effect, ['hooks'], ['F10']);
        }),
      ),
    ).toThrow(/must be exactly \[F3, F9, F10\]/);

    expect(() =>
      validate(
        mutate('spell:conjure-elemental', (effect) => {
          setAt(effect, ['creation', 'sourceEligibility'], undefined);
        }),
        true,
      ),
    ).toThrow(/sourceEligibility is required/);

    expect(() =>
      validate(
        mutate('spell:conjure-fey', (effect) => {
          setAt(effect, ['transitions', 2, 'restrictions'], undefined);
        }),
        true,
      ),
    ).toThrow(/must prohibit caster dismissal/);

    expect(() =>
      validate(
        mutate('spell:find-familiar', (effect) => {
          setAt(effect, ['control', 'command'], { channel: 'mental' });
        }),
      ),
    ).toThrow(/command is not licensed/);

    expect(() =>
      validate(
        mutate('spell:simulacrum', (effect) => {
          setAt(effect, ['statBlockBasis'], undefined);
        }),
      ),
    ).toThrow(/statBlockBasis is required/);

    expect(() =>
      validate(
        mutate('spell:create-undead', (effect) => {
          setAt(effect, ['scaling', 0, 'selection'], 'choose-all');
        }),
      ),
    ).toThrow(/selection must be choose-one/);

    expect(() =>
      validate(
        mutate('spell:find-steed', (effect) => {
          setAt(effect, ['transitions', 3, 'reappearancePlacement'], undefined);
        }),
      ),
    ).toThrow(/must reuse creation-placement/);

    expect(() =>
      validate(
        mutate('spell:phantom-steed', (effect) => {
          setAt(effect, ['modifications'], undefined);
        }),
      ),
    ).toThrow(/modifications kinds must be exactly/);
  });

  it('rejects malformed, resolved, dangling, and semantically detached source ambiguities', () => {
    const createEffect = materializeS1SummoningEffect('spell:create-undead');
    const createAmbiguities = structuredClone(
      materializeS1RulesAmbiguities('spell:create-undead'),
    ) as Record<string, unknown>[];

    const malformed = structuredClone(createAmbiguities);
    malformed[0].preferredInterpretation = 'mixed-within-total';
    expect(() => validateWithAmbiguities(createEffect, malformed)).toThrow(
      /unsupported key "preferredInterpretation"/,
    );

    const resolved = structuredClone(createAmbiguities);
    resolved[0].canonicalResolution = 'homogeneous-alternative';
    expect(() => validateWithAmbiguities(createEffect, resolved)).toThrow(
      /canonicalResolution must be null/,
    );

    const singleInterpretation = structuredClone(createAmbiguities);
    singleInterpretation[0].interpretations = (
      singleInterpretation[0].interpretations as unknown[]
    ).slice(0, 1);
    expect(() =>
      validateWithAmbiguities(createEffect, singleInterpretation),
    ).toThrow(/interpretations must contain at least two entries/);

    const dangling = structuredClone(createEffect);
    setAt(
      dangling,
      ['scaling', 0, 'options', 1, 'choices', 1, 'composition', 'ambiguityId'],
      'ambiguity:unknown',
    );
    expect(() => validateWithAmbiguities(dangling, createAmbiguities)).toThrow(
      /references unknown mechanics ambiguity/,
    );

    expect(() =>
      validateWithAmbiguities({ kind: 'cannotSee' }, createAmbiguities),
    ).toThrow(/without an affected mechanic reference/);

    const unguardedFamiliar = materializeS1SummoningEffect(
      'spell:find-familiar',
    );
    setAt(unguardedFamiliar, ['transitions', 4, 'availability'], undefined);
    expect(() => validate(unguardedFamiliar)).toThrow(
      /zero-HP-absence permanent dismissal must be gated by its source ambiguity/,
    );
  });

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
    expect(() => validate({ kind: 'percentChance', percent: 101 })).toThrow(
      /percent/,
    );
    expect(() =>
      validate({ kind: 'createsProvisions', food: { pounds: 45 } }),
    ).toThrow(/spoilsAfterHours/);
    expect(() => validate({ kind: 'conjuredUtilityObject' })).toThrow(
      /at least one boundary/,
    );
    expect(() =>
      validate({ kind: 'conjuredUtilityObject', restrictions: [] }),
    ).toThrow(/at least one boundary|restrictions/);
    expect(() =>
      validate({
        kind: 'conjuredUtilityObject',
        capacityPounds: 10,
        restrictions: [],
      }),
    ).toThrow(/restrictions/);
    expect(() =>
      validate({
        kind: 'concurrentEffectLimit',
        max: 3,
        dismissCost: 'action',
      }),
    ).toThrow(/scope/);
    expect(() =>
      validate({ kind: 'communicationBarriers', magicalSilenceBlocks: true }),
    ).toThrow(/materials/);
    expect(() =>
      validate({
        kind: 'terrainAlteration',
        canCreate: ['muddy-ground'],
      }),
    ).toThrow(/difficult-terrain/);
    expect(() =>
      validate({
        kind: 'createsOrDestroysWater',
        gallons: 10,
        extinguishesExposedFlames: false,
      }),
    ).toThrow(/must be true/);
    expect(() =>
      validate({
        kind: 'terrainAlteration',
        canCreate: ['difficult-terrain'],
        removedPiecesDisappear: false,
      }),
    ).toThrow(/must be true/);
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
      /unexpected payload key/,
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
    expect(() =>
      validate({
        kind: 'falseAppearance',
        while: 'motionless',
        indistinguishableFrom: '',
      }),
    ).toThrow(/indistinguishableFrom/);
    expect(() =>
      validate({
        kind: 'falseAppearance',
        indistinguishableFrom: 'a normal suit of armor',
      }),
    ).toThrow(/while/);
    expect(() => validate({ kind: 'telepathy' })).toThrow(/telepathy boundary/);
    expect(() => validate({ kind: 'telepathy', rangeFeet: 0 })).toThrow(
      /rangeFeet/,
    );
    expect(() =>
      validate({ kind: 'telepathy', rangeFeet: 100, conveys: 'senses' }),
    ).toThrow(/conveys/);
    expect(() =>
      validate({ kind: 'telepathy', rangeFeet: 100, content: ['thoughts'] }),
    ).toThrow(/content/);
    expect(() => validate({ kind: 'communication', with: [] })).toThrow(/with/);
    expect(() =>
      validate({
        kind: 'senseSharing',
        source: 'homunculus',
        senses: 'what it senses',
      }),
    ).toThrow(/recipient/);
    expect(() =>
      validate({ kind: 'locationKnowledge', knows: ['bearing'], of: 'quarry' }),
    ).toThrow(/knows/);
    expect(() =>
      validate({
        kind: 'pathMemory',
        scope: 'local-maze',
        recall: 'perfect',
      }),
    ).toThrow(/scope/);
    expect(() => validate({ kind: 'sleepException' })).toThrow(/detail/);
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

/**
 * Magic-item M2/M3 passive-modifier vocabulary (eshyra-o9bd.18.7.7.5): new
 * effect kinds plus extensions to existing kinds (abilityScoreIncrease,
 * hitPointMaximumIncrease, regeneration, sense, speedSet, stabilize).
 */
describe('magic-item passive-modifier effect payload contracts', () => {
  it('accepts abilityScoreSet with a fixed value or a table ref, never both', () => {
    expect(() =>
      validate({ kind: 'abilityScoreSet', ability: 'strength', value: 19 }),
    ).not.toThrow();
    expect(() =>
      validate({
        kind: 'abilityScoreSet',
        ability: 'strength',
        tableRef: 'table:belt-of-giant-strength',
      }),
    ).not.toThrow();
  });

  it('rejects malformed abilityScoreSet payloads', () => {
    expect(() =>
      validate({ kind: 'abilityScoreSet', ability: 'strength' }),
    ).toThrow(/exactly one of value or tableRef/);
    expect(() =>
      validate({
        kind: 'abilityScoreSet',
        ability: 'strength',
        value: 19,
        tableRef: 'table:x',
      }),
    ).toThrow(/exactly one of value or tableRef/);
    expect(() =>
      validate({ kind: 'abilityScoreSet', ability: 'luck', value: 19 }),
    ).toThrow(/must be an ability name/);
    expect(() =>
      validate({
        kind: 'abilityScoreSet',
        ability: 'strength',
        tableRef: 'notable:x',
      }),
    ).toThrow(/tableRef must be a 'table:' ref/);
  });

  it('accepts and rejects proficiencyBonusIncrease and healingMultiplier', () => {
    expect(() =>
      validate({ kind: 'proficiencyBonusIncrease', amount: 1 }),
    ).not.toThrow();
    expect(() => validate({ kind: 'proficiencyBonusIncrease' })).toThrow(
      /amount/,
    );
    expect(() =>
      validate({
        kind: 'healingMultiplier',
        multiplier: 2,
        appliesTo: 'hit-dice-spent-to-regain-hit-points',
      }),
    ).not.toThrow();
    expect(() =>
      validate({ kind: 'healingMultiplier', multiplier: 2 }),
    ).toThrow(/appliesTo/);
    expect(() =>
      validate({ kind: 'healingMultiplier', appliesTo: 'x' }),
    ).toThrow(/multiplier must be a finite number/);
  });

  it('accepts hover/sustenance/swimWithoutExtraMovement/leavesNoTracks/climbAnywhere and rejects unexpected payload', () => {
    expect(() => validate({ kind: 'hover' })).not.toThrow();
    expect(() => validate({ kind: 'sustenance' })).not.toThrow();
    expect(() => validate({ kind: 'swimWithoutExtraMovement' })).not.toThrow();
    expect(() =>
      validate({ kind: 'hover', condition: 'requires all four horseshoes' }),
    ).not.toThrow();
    expect(() =>
      validate({
        kind: 'leavesNoTracks',
        condition: 'requires all four horseshoes',
      }),
    ).not.toThrow();
    expect(() =>
      validate({ kind: 'climbAnywhere', condition: 'not on ice or oil' }),
    ).not.toThrow();
    expect(() => validate({ kind: 'sustenance', extra: true })).toThrow(
      /marker-only effect/,
    );
    expect(() => validate({ kind: 'hover', extra: true })).toThrow(
      /unexpected payload key/,
    );
  });

  it('accepts telepathicRelay and temperatureTolerance', () => {
    expect(() =>
      validate({
        kind: 'telepathicRelay',
        requires: 'concentrating on the helm’s detect thoughts',
      }),
    ).not.toThrow();
    expect(() => validate({ kind: 'telepathicRelay' })).not.toThrow();
    expect(() =>
      validate({
        kind: 'temperatureTolerance',
        minimumFahrenheit: -50,
        withHeavyClothesMinimumFahrenheit: -100,
      }),
    ).not.toThrow();
    expect(() => validate({ kind: 'temperatureTolerance' })).toThrow(
      /minimumFahrenheit/,
    );
  });

  it('extends abilityScoreIncrease with alsoIncreasesMaximum, mutually exclusive with newMaximum', () => {
    expect(() =>
      validate({
        kind: 'abilityScoreIncrease',
        abilities: ['constitution'],
        amount: 2,
        alsoIncreasesMaximum: true,
      }),
    ).not.toThrow();
    expect(() =>
      validate({
        kind: 'abilityScoreIncrease',
        abilities: ['constitution'],
        amount: 2,
        newMaximum: 20,
        alsoIncreasesMaximum: true,
      }),
    ).toThrow(/must not carry both newMaximum and alsoIncreasesMaximum/);
    expect(() =>
      validate({
        kind: 'abilityScoreIncrease',
        abilities: ['strength'],
        amount: 4,
        newMaximum: 30,
        condition: 'while attuned to this weapon and holding it',
      }),
    ).not.toThrow();
  });

  it('extends breathes, jumpDistanceMultiplier, and walkOnLiquids with condition (eshyra-o9bd.18.7.7.5 review)', () => {
    expect(() =>
      validate({
        kind: 'breathes',
        environments: ['water'],
        condition: 'while wearing the cloak with its hood up',
      }),
    ).not.toThrow();
    expect(() =>
      validate({
        kind: 'jumpDistanceMultiplier',
        multiplier: 3,
        condition:
          'you can’t jump farther than your remaining movement would allow',
      }),
    ).not.toThrow();
    expect(() =>
      validate({
        kind: 'walkOnLiquids',
        condition: 'leaves no tracks',
      }),
    ).not.toThrow();
  });

  it('extends hitPointMaximumIncrease with perLevel as an alternative to amount', () => {
    expect(() =>
      validate({ kind: 'hitPointMaximumIncrease', perLevel: 1 }),
    ).not.toThrow();
    expect(() =>
      validate({ kind: 'hitPointMaximumIncrease', amount: 5 }),
    ).not.toThrow();
    expect(() => validate({ kind: 'hitPointMaximumIncrease' })).toThrow(
      /exactly one of amount or perLevel/,
    );
    expect(() =>
      validate({
        kind: 'hitPointMaximumIncrease',
        amount: 5,
        perLevel: 1,
      }),
    ).toThrow(/exactly one of amount or perLevel/);
  });

  it('validates the new regeneration payload shape', () => {
    expect(() =>
      validate({
        kind: 'regeneration',
        hitDice: '1d6',
        timing: 'every-10-minutes',
        condition: 'if it has at least 1 hit point',
        limbRegrowthDays: '1d6 + 1',
        limbRegrowthCondition:
          'if you have at least 1 hit point the whole time',
      }),
    ).not.toThrow();
    expect(() =>
      validate({
        kind: 'regeneration',
        hitPoints: 10,
        timing: 'start-of-turn',
      }),
    ).not.toThrow();
    expect(() => validate({ kind: 'regeneration', timing: 'x' })).toThrow(
      /exactly one of hitPoints or hitDice/,
    );
    expect(() =>
      validate({
        kind: 'regeneration',
        hitPoints: 10,
        hitDice: '1d6',
        timing: 'x',
      }),
    ).toThrow(/exactly one of hitPoints or hitDice/);
    expect(() => validate({ kind: 'regeneration', hitPoints: 10 })).toThrow(
      /timing/,
    );
    expect(() =>
      validate({
        kind: 'regeneration',
        hitPoints: 10,
        timing: 'x',
        suppressedByDamageTypes: ['not-a-type'],
      }),
    ).toThrow(
      /suppressedByDamageTypes must be an array of canonical damage types/,
    );
  });

  it('extends sense with durationMinutes and bonusRangeFeetIfAlreadyHasSense', () => {
    expect(() =>
      validate({
        kind: 'sense',
        sense: 'truesight',
        rangeFeet: 120,
        durationMinutes: 10,
      }),
    ).not.toThrow();
    expect(() =>
      validate({
        kind: 'sense',
        sense: 'darkvision',
        rangeFeet: 60,
        bonusRangeFeetIfAlreadyHasSense: 60,
      }),
    ).not.toThrow();
  });

  it('extends speedSet with valueTableRef, floor, and hover', () => {
    expect(() =>
      validate({
        kind: 'speedSet',
        mode: 'fly',
        valueTableRef: 'table:carpet-of-flying',
      }),
    ).not.toThrow();
    expect(() =>
      validate({ kind: 'speedSet', mode: 'walk', value: 30, floor: true }),
    ).not.toThrow();
    expect(() =>
      validate({
        kind: 'speedSet',
        mode: 'fly',
        value: 'walking-speed',
        hover: true,
      }),
    ).not.toThrow();
    expect(() => validate({ kind: 'speedSet', mode: 'fly' })).toThrow(
      /exactly one of value or valueTableRef/,
    );
    expect(() =>
      validate({
        kind: 'speedSet',
        mode: 'fly',
        value: 60,
        valueTableRef: 'table:x',
      }),
    ).toThrow(/exactly one of value or valueTableRef/);
    expect(() =>
      validate({ kind: 'speedSet', mode: 'fly', valueTableRef: 'notable:x' }),
    ).toThrow(/valueTableRef must be a 'table:' ref/);
  });

  it('extends stabilize with trigger', () => {
    expect(() =>
      validate({
        kind: 'stabilize',
        trigger: 'start of your turn while dying',
      }),
    ).not.toThrow();
  });

  it('validates the closed C1 changeShape contract', () => {
    const effect = {
      kind: 'changeShape',
      cost: 'action',
      forms: [
        { kind: 'category', types: ['humanoid', 'beast'], maxChallenge: 'own' },
        {
          kind: 'fixed',
          name: 'raven',
          speedOverrides: { walk: 20, fly: 60 },
        },
      ],
      statistics: {
        model: 'retain-listed',
        retains: ['hit points'],
        replaces: ['AC'],
        gainsMissingCapabilities: true,
      },
      equipment: { disposition: 'absorbed-or-borne' },
      reversion: { on: ['death'] },
      excludedCapabilities: ['class-features'],
      retainedCapabilities: [{ name: 'bite', whenFormHas: { attack: 'bite' } }],
      speedConditions: [
        { mode: 'fly', lostUnlessFormHas: { anatomy: 'wings' } },
      ],
      riders: ['The new form must be familiar.'],
    };
    expect(() => validate(effect)).not.toThrow();
    expect(() => validate({ ...effect, cost: 'bonus-action' })).toThrow(/cost/);
    expect(() => validate({ ...effect, unreviewed: true })).toThrow(
      /unsupported key/,
    );
    expect(() =>
      validate({
        ...effect,
        forms: [{ kind: 'fixed', name: 'rat', speedOverrides: { fly: 0 } }],
      }),
    ).toThrow(/speedOverrides\.fly/);
    expect(() =>
      validate({
        ...effect,
        statistics: { model: 'same-except', replaces: ['AC'] },
      }),
    ).toThrow(/unsupported key/);
    expect(() =>
      validate({
        ...effect,
        equipment: { disposition: 'specific', items: [] },
      }),
    ).toThrow(/items must not be empty/);
    expect(() =>
      validate({
        ...effect,
        riders: ['Can use a bite attack when the form has jaws.'],
      }),
    ).toThrow(/riders/);

    const statlineEffect = {
      ...effect,
      forms: [{ kind: 'statline-variant', variant: 'bear', size: 'large' }],
    };
    expect(() => validate(statlineEffect)).not.toThrow();
    expect(() =>
      validate({
        ...statlineEffect,
        forms: [
          {
            kind: 'statline-variant',
            variant: 'bear',
            statlineRefs: [
              { kind: 'speed-variant', condition: 'in bear form' },
            ],
          },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      validate({
        ...statlineEffect,
        forms: [
          {
            kind: 'statline-variant',
            variant: 'bear',
            size: 'large',
            statlineRefs: [
              { kind: 'speed-variant', condition: 'in bear form' },
            ],
          },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      validate({
        ...statlineEffect,
        forms: [{ kind: 'statline-variant', variant: 'bear' }],
      }),
    ).toThrow(/size or non-empty statlineRefs/);
    expect(() =>
      validate({
        ...statlineEffect,
        forms: [
          { kind: 'statline-variant', variant: 'bear', statlineRefs: [] },
        ],
      }),
    ).toThrow(/non-empty/);
    expect(() =>
      validate({
        ...statlineEffect,
        forms: [
          {
            kind: 'statline-variant',
            variant: 'bear',
            statlineRefs: [{ kind: 'ac-variant', condition: 'x' }],
          },
        ],
      }),
    ).toThrow(/unsupported statline reference kind/);
    expect(() =>
      validate({
        ...statlineEffect,
        forms: [
          {
            kind: 'statline-variant',
            variant: 'bear',
            statlineRefs: [{ kind: 'speed-variant', condition: '' }],
          },
        ],
      }),
    ).toThrow(/condition/);
    expect(() =>
      validate({
        ...statlineEffect,
        forms: [{ kind: 'statline-variant', variant: 'bear', size: 'tiny' }],
      }),
    ).toThrow(/size/);
    expect(() =>
      validate({
        ...statlineEffect,
        forms: [
          {
            kind: 'statline-variant',
            variant: 'bear',
            statlineRefs: [
              { kind: 'speed-variant', condition: 'x' },
              { kind: 'speed-variant', condition: 'x' },
            ],
          },
        ],
      }),
    ).toThrow(/duplicates/);
    expect(() =>
      validate({
        ...effect,
        retainedCapabilities: [
          { name: 'bite', whenFormHas: { anatomy: 'jaws' } },
        ],
      }),
    ).toThrow(/unsupported key|attack/);
  });
});
