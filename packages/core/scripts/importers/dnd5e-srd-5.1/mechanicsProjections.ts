import { deriveConditionMechanics } from '../../../src/rules/conditionRelations.js';
import { camelCase } from './classProgression.js';
import {
  parseCreatureSpellcasting,
  type SpellRefResolver,
} from './creatureSpellcasting.js';
import type {
  ActionExtraction,
  FeatExtraction,
  HazardExtraction,
  SpellExtraction,
} from './types.js';

type Mechanics = Record<string, unknown>;
type ActionMechanicsProjection = {
  readonly actionEconomy: {
    readonly cost: 'action';
  };
  readonly effects: readonly Mechanics[];
};

/**
 * Resolves a free-text spell name fragment captured from feature prose to a
 * stable `spell:<slug>` ref, or `undefined` when the fragment is not a known
 * SRD spell. The importer builds this from the emitted spell records so the
 * `spellGrants` projection can fail closed: a captured fragment becomes a
 * structured grant only when it resolves to a real spell. Garbage regex
 * residue (e.g. "two cantrips of your choice from the bard") resolves to
 * `undefined` and is omitted rather than emitted as authoritative data
 * (eshyra-vk23.1).
 */
export type SpellGrantResolver = (candidate: string) => string | undefined;

const ABILITIES = [
  'Strength',
  'Dexterity',
  'Constitution',
  'Intelligence',
  'Wisdom',
  'Charisma',
] as const;

/**
 * The 13 canonical SRD 5.1 damage types (PH ch. 9 "Damage Types"). `mechanics.
 * damage[].type` must be one of these — `parseDamage`'s "<dice> <word>
 * damage" pattern otherwise happily captures non-damage adjectives too, e.g.
 * Enlarge/Reduce's "1d4 extra damage" / "1d4 less damage" weapon-size flavor
 * text (eshyra-erf5.4), which are not dealt damage at all.
 */
const SRD_5_1_DAMAGE_TYPES: ReadonlySet<string> = new Set([
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
]);

function compact<T extends Record<string, unknown>>(obj: T): T {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (
      value === undefined ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0)
    ) {
      delete obj[key];
    }
  }
  return obj;
}

function parseDamage(text: string): readonly Mechanics[] {
  const out: Mechanics[] = [];
  const damageRe =
    /(?:(\d+)\s*\()?(\d+d\d+(?:\s*[+-]\s*\d+)?)\)?\s+([a-z]+)\s+damage/gi;
  for (const match of text.matchAll(damageRe)) {
    const type = match[3].toLowerCase();
    if (!SRD_5_1_DAMAGE_TYPES.has(type)) continue;
    out.push(
      compact({
        average: match[1] === undefined ? undefined : Number(match[1]),
        dice: match[2].replace(/\s+/g, ' '),
        type,
      }),
    );
  }
  return out;
}

/**
 * A weapon-damage-die MODIFIER, not dealt damage itself — e.g. Enlarge's
 * "attacks with them deal 1d4 extra damage" / Reduce's "deal 1d4 less damage"
 * (eshyra-erf5.4). Distinct from `mechanics.damage`, which is always damage a
 * creature/effect directly deals.
 */
const WEAPON_DAMAGE_DELTA_RE =
  /\battacks with (?:it|them) deal (\d+d\d+(?:\s*[+-]\s*\d+)?) (extra|less) damage/gi;

function parseWeaponDamageModifiers(text: string): readonly Mechanics[] {
  const out: Mechanics[] = [];
  for (const match of text.matchAll(WEAPON_DAMAGE_DELTA_RE)) {
    out.push({
      dice: match[1].replace(/\s+/g, ' '),
      operation: match[2].toLowerCase() === 'extra' ? 'increase' : 'decrease',
    });
  }
  return out;
}

function parseSave(text: string): Mechanics | undefined {
  const ability = ABILITIES.find((candidate) =>
    new RegExp(`\\b${candidate}\\s+saving throw\\b`, 'i').test(text),
  );
  const dc = /\bDC\s+(\d+)\s+([A-Z][a-z]+)\s+saving throw\b/.exec(text);
  if (ability === undefined && dc === null) return undefined;
  return compact({
    ability: ability?.toLowerCase(),
    dc: dc === null ? undefined : Number(dc[1]),
  });
}

/**
 * Condition-relation classification lives in the shared
 * `src/rules/conditionRelations.ts` module so the importer projection, the
 * `kindSchemas` relation enum, and the `condition-relation-safety` audit gate
 * in `srdAudit.ts` share one implementation and cannot drift
 * (eshyra-qqyj, eshyra-o9bd.18.3). See that module for the closed relation
 * vocabulary and its contract for deterministic consumers.
 */
function parseConditions(text: string): readonly Mechanics[] {
  return deriveConditionMechanics(text).map((entry) => ({ ...entry }));
}

const STANDARD_ACTION_MECHANICS: ReadonlyMap<
  string,
  ActionMechanicsProjection
> = new Map([
  [
    'attack',
    {
      actionEconomy: { cost: 'action' },
      effects: [
        {
          kind: 'makeAttack',
          count: 1,
          attackKinds: ['melee', 'ranged'],
          ruleRef: 'rule:making-an-attack',
          extraAttacksFromFeatures: true,
        },
      ],
    },
  ],
  [
    'cast a spell',
    {
      actionEconomy: { cost: 'action' },
      effects: [
        {
          kind: 'castSpell',
          castingTime: '1 action',
          ruleRef: 'rule:casting-a-spell',
          note: 'Only spells with a casting time of 1 action use this action in combat.',
        },
      ],
    },
  ],
  [
    'dash',
    {
      actionEconomy: { cost: 'action' },
      effects: [
        {
          kind: 'extraMovement',
          amount: 'speed-after-modifiers',
          duration: 'current-turn',
        },
      ],
    },
  ],
  [
    'disengage',
    {
      actionEconomy: { cost: 'action' },
      effects: [
        {
          kind: 'preventOpportunityAttacks',
          scope: 'your-movement',
          duration: 'rest-of-turn',
          ruleRef: 'rule:opportunity-attacks',
        },
      ],
    },
  ],
  [
    'dodge',
    {
      actionEconomy: { cost: 'action' },
      effects: [
        {
          kind: 'attackRollModifier',
          subject: 'against-actor',
          mode: 'disadvantage',
          condition: 'you-can-see-the-attacker',
          duration: 'until-start-of-your-next-turn',
        },
        {
          kind: 'savingThrowModifier',
          subject: 'actor',
          mode: 'advantage',
          roll: 'saving-throw',
          abilities: ['dexterity'],
          duration: 'until-start-of-your-next-turn',
        },
        {
          kind: 'benefitEndsWhen',
          conditions: ['you-are-incapacitated', 'your-speed-is-0'],
        },
      ],
    },
  ],
  [
    'help',
    {
      actionEconomy: { cost: 'action' },
      effects: [
        {
          kind: 'abilityCheckModifier',
          subject: 'helped-creature',
          mode: 'advantage',
          timing: 'next-ability-check-before-start-of-your-next-turn',
          constraint: 'check-must-perform-the-task-you-helped-with',
        },
        {
          kind: 'attackRollModifier',
          subject: 'helped-friendly-creature',
          mode: 'advantage',
          timing: 'before-your-next-turn',
          targetConstraint: 'target-creature-within-5-feet-of-you',
        },
      ],
    },
  ],
  [
    'hide',
    {
      actionEconomy: { cost: 'action' },
      effects: [
        {
          kind: 'makeAbilityCheck',
          ability: 'dexterity',
          skill: 'stealth',
          purpose: 'hide',
          ruleRef: 'rule:hiding',
        },
        {
          kind: 'gainRuleBenefitsOnSuccess',
          ruleRef: 'rule:unseen-attackers-and-targets',
        },
      ],
    },
  ],
  [
    'ready',
    {
      actionEconomy: { cost: 'action' },
      effects: [
        {
          kind: 'readyAction',
          trigger: 'perceivable-circumstance',
          responseOptions: ['action', 'move-up-to-speed'],
          releaseCost: 'reaction',
          timing: 'after-trigger-finishes-before-start-of-your-next-turn',
          mayIgnoreTrigger: true,
          ruleRef: 'rule:ready',
        },
        {
          kind: 'readySpell',
          spellCastingTime: '1 action',
          heldByConcentration: true,
          releaseCost: 'reaction',
          failure: 'spell-dissipates-if-concentration-breaks',
          ruleRef: 'rule:concentration',
        },
      ],
    },
  ],
  [
    'search',
    {
      actionEconomy: { cost: 'action' },
      effects: [
        {
          kind: 'makeAbilityCheck',
          abilityOptions: ['wisdom', 'intelligence'],
          skillOptions: ['perception', 'investigation'],
          purpose: 'find-something',
          chosenBy: 'gm',
          ruleRef: 'rule:ability-checks',
        },
      ],
    },
  ],
  [
    'use an object',
    {
      actionEconomy: { cost: 'action' },
      effects: [
        {
          kind: 'objectInteraction',
          useWhen: 'object-requires-your-action',
          alsoUseWhen: 'interact-with-more-than-one-object-on-your-turn',
          ordinaryInteractionRuleRef: 'rule:interacting-with-objects',
        },
      ],
    },
  ],
]);

function parseAttack(text: string): Mechanics | undefined {
  // The middle segment names the target as "one target", "one creature", or
  // "one Medium or smaller creature" — the bare word "target" is not
  // guaranteed (Bat's Bite, Lamia's Intoxicating Touch use "one creature";
  // eshyra-o9bd.18.7.3).
  const match =
    /\b(Melee|Ranged|Melee or Ranged) (Weapon|Spell) Attack:\s*([+-]\d+) to hit,\s*(.*?(?:targets?|creatures?).*?)\.\s*Hit:\s*([^.]*)\./i.exec(
      text,
    );
  if (match === null) return undefined;
  const reach = /\breach\s+(\d+)\s*ft\./i.exec(match[4]);
  const range = /\brange\s+(\d+)\/(\d+)\s*ft\./i.exec(match[4]);
  const target =
    /\b((?:one|two|three|\d+)[^.]*?(?:targets?|creatures?))\b/i.exec(match[4]);
  // Flat hit damage without a dice expression ("Hit: 1 piercing damage.").
  const diceDamage = parseDamage(match[5]);
  const flat =
    diceDamage.length === 0 ? /^\s*(\d+) ([a-z]+) damage/.exec(match[5]) : null;
  const flatDamage =
    flat !== null && SRD_5_1_DAMAGE_TYPES.has(flat[2])
      ? [{ amount: Number(flat[1]), type: flat[2] }]
      : [];
  return compact({
    attackType: `${match[1].toLowerCase().replaceAll(' ', '-')}-${match[2].toLowerCase()}`,
    attackBonus: Number(match[3]),
    reachFeet: reach === null ? undefined : Number(reach[1]),
    rangeFeet:
      range === null
        ? undefined
        : { normal: Number(range[1]), long: Number(range[2]) },
    target: target?.[1].toLowerCase(),
    hitDamage: diceDamage.length > 0 ? diceDamage : flatDamage,
  });
}

function parseRecharge(name: string): Mechanics | undefined {
  // The SRD prints recharge ranges with an en dash ("Recharge 5–6"), not an
  // ASCII hyphen; match both plus em dash so PDF-extracted text round-trips.
  const match = /\bRecharge\s+(\d)(?:[-–—](\d))?\b/i.exec(name);
  if (match === null) return undefined;
  return compact({
    roll: 'd6',
    minimum: Number(match[1]),
    maximum: match[2] === undefined ? Number(match[1]) : Number(match[2]),
  });
}

// ---------------------------------------------------------------------------
// Spell effect projections (eshyra-o9bd.18.7.4). Anchored grammars over the
// SRD's closed phrasings; unmatched prose contributes nothing (fail-closed).
// ---------------------------------------------------------------------------

/** Structured duration from the closed SRD duration vocabulary. */
function parseSpellDuration(duration: string): Mechanics | undefined {
  const trimmed = duration.trim().replace(/\.$/, '');
  if (/^Instantaneous$/i.test(trimmed)) return { kind: 'instantaneous' };
  if (/^Special$/i.test(trimmed)) return { kind: 'special' };
  const dispelled = /^Until dispelled( or triggered)?$/i.exec(trimmed);
  if (dispelled !== null) {
    return compact({
      kind: 'until-dispelled',
      orTriggered: dispelled[1] === undefined ? undefined : true,
    });
  }
  const timed =
    /^(Concentration,? )?[Uu]p to (\d+|one) (round|minute|hour|day)s?$/.exec(
      trimmed,
    ) ?? /^()(\d+) (round|minute|hour|day)s?$/.exec(trimmed);
  if (timed !== null) {
    return compact({
      kind: 'timed',
      amount: timed[2] === 'one' ? 1 : Number(timed[2]),
      unit: timed[3],
      upTo: /up to/i.test(trimmed) ? true : undefined,
      concentration: timed[1] ? true : undefined,
    });
  }
  return undefined;
}

/** Structured area from the Range parenthetical ("Self (15-foot cone)"). */
function parseSpellArea(range: string): Mechanics | undefined {
  const match =
    /^Self \((\d+)-(foot|mile)(?:-radius)?\s?(cone|line|cube|sphere|hemisphere|radius)?\)$/.exec(
      range.trim(),
    );
  if (match === null) return undefined;
  return compact({
    shape: match[3] ?? 'radius',
    size: Number(match[1]),
    unit: match[2],
    origin: 'self',
  });
}

/**
 * Advantage/disadvantage verbs and the subject vocabulary. The subject is
 * resolved as the NEAREST candidate before the verb within the sentence — a
 * lazy any-gap match would bind "If you … are fighting it, it has advantage"
 * to `you` instead of `it` (Dominate Monster) — so the modifier is never
 * emitted with the wrong holder.
 */
const SPELL_MODIFIER_VERB_RE =
  /\b(?:ha(?:s|ve)|gains?) (advantage|disadvantage)(?: on ([^.;]+))?/gi;

const SPELL_MODIFIER_SUBJECT_RE =
  /\b(you|the target|the creature|each target|any creature|it)\b(?![^.;]*\b(?:you|the target|the creature|each target|any creature|it)\b)/i;

const SPELL_MODIFIER_SUBJECTS: ReadonlyMap<string, string> = new Map([
  ['you', 'caster'],
  ['the target', 'target'],
  ['the creature', 'target'],
  ['it', 'target'],
  ['each target', 'target'],
  ['any creature', 'other-creatures'],
]);

function parseSpellEffects(text: string): readonly Mechanics[] {
  const effects: Mechanics[] = [];
  // Healing: dice ("regains a number of hit points equal to 1d8 + your
  // spellcasting ability modifier"), dice-with-average, or flat ("regains
  // 70 hit points").
  const diceHeal =
    /\bregains? (?:a number of )?hit points equal to (\d+d\d+(?:\s*\+\s*\d+)?)( \+ your spellcasting ability modifier)?/.exec(
      text,
    );
  if (diceHeal !== null) {
    effects.push(
      compact({
        kind: 'healing',
        dice: diceHeal[1].replace(/\s+/g, ' '),
        addSpellcastingAbilityModifier:
          diceHeal[2] === undefined ? undefined : true,
      }),
    );
  } else {
    const directDice = /\bregains? (\d+d\d+(?:\s*\+\s*\d+)?) hit points\b/.exec(
      text,
    );
    const flatHeal = /\b(?:regains?|restores?) (\d+) hit points?\b/.exec(text);
    if (directDice !== null) {
      effects.push({
        kind: 'healing',
        dice: directDice[1].replace(/\s+/g, ' '),
      });
    } else if (flatHeal !== null) {
      effects.push({ kind: 'healing', amount: Number(flatHeal[1]) });
    }
  }
  const revive =
    /\breturns? to life with (all its hit points|\d+ hit points?)\b/.exec(text);
  if (revive !== null) {
    effects.push({
      kind: 'revive',
      hitPoints: revive[1].startsWith('all')
        ? 'all'
        : Number(/\d+/.exec(revive[1])?.[0]),
    });
  }
  const extraOnHit =
    /\bdeal an extra (\d+d\d+) damage to (?:the target|it) whenever you hit it with (?:a|an) ([a-z]+) attack\b/.exec(
      text,
    );
  if (extraOnHit !== null) {
    effects.push({
      kind: 'extraDamageOnHit',
      dice: extraOnHit[1],
      attackType: extraOnHit[2],
    });
  }
  const attackDamageBonus =
    /(?<![\w+-])([+-]\d+) bonus to attack rolls and damage rolls\b/.exec(text);
  if (attackDamageBonus !== null) {
    effects.push({
      kind: 'attackAndDamageBonus',
      amount: Number(attackDamageBonus[1]),
    });
  }
  const checkBonus =
    /(?<![\w+-])([+-]\d+) bonus to (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) \(([A-Za-z ]+)\) checks\b/.exec(
      text,
    );
  if (checkBonus !== null) {
    effects.push({
      kind: 'checkBonus',
      amount: Number(checkBonus[1]),
      ability: checkBonus[2].toLowerCase(),
      skill: checkBonus[3].toLowerCase().replaceAll(' ', '-'),
    });
  }
  const deathThreshold = /\bhas (\d+) hit points or fewer, it dies\b/.exec(
    text,
  );
  if (deathThreshold !== null) {
    effects.push({
      kind: 'death',
      hitPointThreshold: Number(deathThreshold[1]),
    });
  }
  const tempHp =
    /\bgains? (\d+d\d+(?:\s*\+\s*\d+)?|\d+) temporary hit points\b/.exec(text);
  if (tempHp !== null) {
    const value = tempHp[1].replace(/\s+/g, ' ');
    effects.push(
      compact({
        kind: 'temporaryHitPoints',
        dice: value.includes('d') ? value : undefined,
        amount: value.includes('d') ? undefined : Number(value),
      }),
    );
  } else if (
    /\bgains? temporary hit points equal to your spellcasting ability modifier\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'temporaryHitPoints',
      amount: 'spellcasting-ability-modifier',
    });
  }
  const maxHp =
    /\bhit point maximum and current hit points increase by (\d+)\b/.exec(text);
  if (maxHp !== null) {
    effects.push({
      kind: 'hitPointMaximumIncrease',
      amount: Number(maxHp[1]),
      alsoCurrentHitPoints: true,
    });
  }
  const light =
    /\bsheds (bright|dim) light in a (\d+)-foot(?:-radius)? (?:radius|sphere)(?: and dim light for an additional (\d+) feet)?/.exec(
      text,
    );
  if (light !== null) {
    effects.push(
      compact({
        kind: 'light',
        level: light[1],
        radiusFeet: Number(light[2]),
        dimAdditionalFeet:
          light[3] === undefined ? undefined : Number(light[3]),
      }),
    );
  }
  const obscured = /\b(heavily|lightly) obscured\b/.exec(text);
  if (obscured !== null) {
    effects.push({ kind: 'obscurement', level: obscured[1] });
  }
  const darkvision =
    /\b(?:has|have|gains?|grants? (?:it|the target)?) ?darkvision out to a range of (\d+) feet\b/.exec(
      text,
    );
  if (darkvision !== null) {
    effects.push({
      kind: 'sense',
      sense: 'darkvision',
      rangeFeet: Number(darkvision[1]),
    });
  }
  if (/\bspeed is doubled\b/.test(text)) {
    effects.push({ kind: 'speedMultiplier', multiplier: 2 });
  }
  if (/\bspeed is halved\b/.test(text)) {
    effects.push({ kind: 'speedMultiplier', multiplier: 0.5 });
  }
  const speedBonus = /\bspeed increases by (\d+) feet\b/.exec(text);
  if (speedBonus !== null) {
    effects.push({ kind: 'speedBonus', amountFeet: Number(speedBonus[1]) });
  }
  // Bless/Bane/Guidance/Resistance-style roll riders.
  const rollDice =
    /\broll a (d\d+) and (add|subtract) the number rolled (?:to|from) (?:the |one )?(attack roll or saving throw|attack rolls?|saving throws?|ability checks?)\b/.exec(
      text,
    );
  if (rollDice !== null) {
    const applies =
      rollDice[3] === 'attack roll or saving throw'
        ? ['attack-rolls', 'saving-throws']
        : [rollDice[3].replace(/s?$/, 's').replaceAll(' ', '-')];
    effects.push({
      kind: rollDice[2] === 'add' ? 'rollBonusDice' : 'rollPenaltyDice',
      dice: rollDice[1],
      applies,
    });
  }
  if (
    /\bmake an ability check using your spellcasting ability\. The DC equals 10 \+ the spell[\u2019']s level\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'makeAbilityCheck',
      ability: 'spellcasting-ability',
      dcFormula: '10 + spell level',
    });
  }
  // Recurring saves, in all four SRD phrasings: "repeat the saving throw at
  // the end of each of its turns", "can make another Wisdom saving throw at
  // the end of each of its turns / its turn", and the inverted "At the end
  // of each of its turns(, and each time it takes damage), the target can
  // make another Wisdom saving throw."
  const repeatSave =
    /\brepeat (?:the|its) saving throw at the end of each of (?:its|their) turns\b/.test(
      text,
    ) ||
    /\bmakes? another (?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw at the end of (?:each of its turns|its turn)\b/.test(
      text,
    ) ||
    /\bAt the end of (?:each of its turns|its turn)(?:, and each time it takes damage)?, (?:it|the target|the creature) can make another (?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw\b/.test(
      text,
    );
  if (repeatSave) {
    effects.push(
      compact({
        kind: 'repeatSave',
        timing: 'end-of-each-of-its-turns',
        alsoWhenTakingDamage: /, and each time it takes damage,/.test(text)
          ? true
          : undefined,
        endsOnSuccess:
          /On a success, the spell ends|ending the effect on itself on a success|On a successful save, the (?:spell|effect) ends/.test(
            text,
          )
            ? true
            : undefined,
      }),
    );
  }
  const push = /\bpushed (?:up to )?(\d+) feet (away from|toward)\b/.exec(text);
  if (push !== null) {
    effects.push({
      kind: 'forcedMovement',
      distanceFeet: Number(push[1]),
      direction: push[2] === 'away from' ? 'away' : 'toward',
    });
  }
  // No \b before the sign: "+" is a non-word char, so a word boundary never
  // fires between the preceding space and the "+" (Shield's "a +5 bonus").
  const acBonus = /(?<![\w+-])([+-]\d+) bonus to AC\b/.exec(text);
  if (acBonus !== null) {
    effects.push({ kind: 'acBonus', amount: Number(acBonus[1]) });
  }
  const acFormula = /\bbase AC becomes (\d+) \+ its Dexterity modifier\b/.exec(
    text,
  );
  if (acFormula !== null) {
    // Same payload contract as the feature-side acFormula (abilities is
    // always a list): one effect kind, one shape.
    effects.push({
      kind: 'acFormula',
      base: Number(acFormula[1]),
      abilities: ['dexterity'],
    });
  }
  const acMinimum = /\bAC can[\u2019']t be less than (\d+)\b/.exec(text);
  if (acMinimum !== null) {
    effects.push({ kind: 'acMinimum', value: Number(acMinimum[1]) });
  }
  const resistance =
    /\b(?:you have|has|gains?|grants? it) resistance to ([a-z]+(?:(?:,| and|, and) [a-z]+)*) damage\b/.exec(
      text,
    );
  if (resistance !== null) {
    const types = resistance[1]
      .split(/,\s*(?:and\s+)?|\s+and\s+/)
      .map((type) => type.trim())
      .filter((type) => SRD_5_1_DAMAGE_TYPES.has(type));
    if (types.length > 0) {
      effects.push({ kind: 'damageResistance', types });
    }
  }
  // Advantage/disadvantage with an explicit subject, sentence by sentence.
  for (const sentence of text.split(/(?<=\.)\s+/)) {
    const trimmedSentence = sentence.trim();
    const attackersForm =
      /\battack rolls against (?:the target|it|you) have (advantage|disadvantage)\b/i.exec(
        trimmedSentence,
      );
    if (attackersForm !== null) {
      effects.push({
        kind: 'rollModifier',
        subject: 'attackers-against-target',
        mode: attackersForm[1].toLowerCase(),
        scope: 'attack-rolls',
      });
      continue;
    }
    SPELL_MODIFIER_VERB_RE.lastIndex = 0;
    for (const verb of trimmedSentence.matchAll(SPELL_MODIFIER_VERB_RE)) {
      const prefix = trimmedSentence.slice(0, verb.index);
      const nearest = SPELL_MODIFIER_SUBJECT_RE.exec(prefix);
      if (nearest === null) continue;
      const subject = SPELL_MODIFIER_SUBJECTS.get(nearest[1].toLowerCase());
      if (subject === undefined) continue;
      effects.push(
        compact({
          kind: 'rollModifier',
          subject,
          mode: verb[1].toLowerCase(),
          scope: verb[2] ? verb[2].trim().replace(/[,.]$/, '') : 'attack-rolls',
        }),
      );
    }
  }
  return effects;
}

/**
 * Structured upcast scaling (eshyra-o9bd.18.7.4). The verbatim At Higher
 * Levels text always rides along as `sourceText`; the typed fields are added
 * only when the closed SRD phrasings match.
 */
function parseSpellScaling(
  higherLevels: string | undefined,
  description: string,
): Mechanics | undefined {
  const out: Mechanics = {};
  if (higherLevels !== undefined) {
    out.sourceText = higherLevels;
    const perSlot =
      /using a spell slot of (\d+)(?:st|nd|rd|th) level or higher, the (damage|healing)(?: of [^.]*?)? increases by (\d+d\d+|\d+) for each slot level above (\d+)/i.exec(
        higherLevels,
      );
    if (perSlot !== null) {
      out.perSlot = compact({
        stat: perSlot[2].toLowerCase(),
        increase: perSlot[3],
        baseSlotLevel: Number(perSlot[4]),
      });
    }
    const extraTargets =
      /you can target one additional (?:creature|humanoid|willing creature|object) for each slot level above (\d+)/i.exec(
        higherLevels,
      );
    if (extraTargets !== null) {
      out.perSlot = compact({
        ...(out.perSlot as Record<string, unknown> | undefined),
        additionalTargets: 1,
        baseSlotLevel: Number(extraTargets[1]),
      });
    }
  }
  // Cantrip damage tiers ("increases by 1d8 when you reach 5th level (2d8),
  // 11th level (3d8), and 17th level (4d8)").
  const cantrip =
    /increases by (\d+d\d+) when you reach 5th level \((\d+d\d+)\), 11th level \((\d+d\d+)\), and 17th level \((\d+d\d+)\)/.exec(
      description,
    );
  if (cantrip !== null) {
    out.cantripDamageByLevel = {
      '5': cantrip[2],
      '11': cantrip[3],
      '17': cantrip[4],
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function deriveSpellMechanics(spell: SpellExtraction): Mechanics {
  const text = `${spell.description} ${spell.higherLevels ?? ''}`;
  const damage = parseDamage(text);
  const weaponDamageModifiers = parseWeaponDamageModifiers(text);
  const save = parseSave(text);
  if (
    save !== undefined &&
    /\bhalf as much damage on a successful (?:save|saving throw|one)\b/.test(
      text,
    )
  ) {
    save.damageOnSuccess = 'half';
  }
  const conditions = parseConditions(text);
  const effects = parseSpellEffects(spell.description);
  // "takes force damage equal to 1d8 + your spellcasting ability modifier"
  // (Spiritual Weapon) — a dealt-damage form parseDamage's "<dice> <type>
  // damage" shape cannot see.
  const equalTo =
    /\btakes ([a-z]+) damage equal to (\d+d\d+)( \+ your spellcasting ability modifier)?/.exec(
      text,
    );
  const equalToDamage =
    equalTo !== null && SRD_5_1_DAMAGE_TYPES.has(equalTo[1])
      ? [
          compact({
            dice: equalTo[2],
            type: equalTo[1],
            addSpellcastingAbilityModifier:
              equalTo[3] === undefined ? undefined : true,
          }),
        ]
      : [];
  return compact({
    // The comma is optional: SRD 5.1 p. 173 prints Protection from Evil and
    // Good's duration as "Concentration up to 10 minutes" (a source typo for
    // the usual "Concentration, up to ..." form).
    concentration: /^Concentration,? up to\b/i.test(spell.duration),
    spellAttack: /\b(?:ranged|melee) spell attack\b/i.test(text),
    duration: parseSpellDuration(spell.duration),
    area: parseSpellArea(spell.range),
    saves: save === undefined ? undefined : [save],
    damage: damage.length > 0 ? damage : equalToDamage,
    weaponDamageModifiers,
    conditions,
    effects: effects.length > 0 ? [...effects] : undefined,
    scaling: parseSpellScaling(spell.higherLevels, spell.description),
  });
}

export function deriveActionMechanics(action: ActionExtraction): Mechanics {
  const standardAction = STANDARD_ACTION_MECHANICS.get(
    action.name.toLowerCase(),
  );
  const attack = parseAttack(action.description);
  const save = parseSave(action.description);
  const damage = parseDamage(action.description);
  return compact({
    ...standardAction,
    attacks: attack === undefined ? undefined : [attack],
    saves: save === undefined ? undefined : [save],
    damage,
    conditions: parseConditions(action.description),
  });
}

// ---------------------------------------------------------------------------
// Creature entry (trait/action/reaction/legendary-action) projections
// (eshyra-o9bd.18.7.3). Every parser below is anchored to one reviewed SRD
// grammar and fails closed: text outside the grammar simply contributes no
// effect, leaving the verbatim prose authoritative.
// ---------------------------------------------------------------------------

const NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
]);

/**
 * Use-economy qualifiers the SRD prints in the entry NAME parenthetical:
 * "(3/Day)", "(Recharges after a Short or Long Rest)", "(Costs 2 Actions)".
 * The dice form ("Recharge 5-6") stays in the sibling `recharge` field.
 */
function parseUsage(name: string): Mechanics | undefined {
  const perDay = /\((\d+)\/Day(?: each)?\)/i.exec(name);
  const rest = /\(Recharges after a (Short or Long|Long|Short) Rest\)/i.exec(
    name,
  );
  const cost = /\(Costs (\d+) Actions\)/i.exec(name);
  if (perDay === null && rest === null && cost === null) return undefined;
  return compact({
    perDay: perDay === null ? undefined : Number(perDay[1]),
    rechargeAfterRest:
      rest === null
        ? undefined
        : rest[1].toLowerCase().replaceAll(' ', '-').concat('-rest'),
    legendaryActionCost: cost === null ? undefined : Number(cost[1]),
  });
}

/** Split into sentences (period-space boundaries; abbreviation-free SRD prose). */
function sentences(text: string): readonly string[] {
  return text
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Advantage/disadvantage grammars: attack rolls, ability/skill checks, and
 * saving throws. Scanned sentence-by-sentence so a leading "While in
 * sunlight," style qualifier attaches as `condition` to every modifier the
 * sentence grants. Saving-throw clauses of the pure "against being
 * <condition>" form are skipped — the condition-relation classifier already
 * models those as `grantsAdvantage` relations (eshyra-o9bd.18.3).
 */
function parseModifierEffects(text: string): readonly Mechanics[] {
  const out: Mechanics[] = [];
  for (const sentence of sentences(text)) {
    const conditionMatch = /^(While [^,]+|When [^,]+),\s/.exec(sentence);
    const condition = conditionMatch?.[1];
    for (const match of sentence.matchAll(
      /\b(?:ha(?:s|ve)|gives you|you gain) (advantage|disadvantage) on ([^.;]+)/gi,
    )) {
      const mode = match[1].toLowerCase();
      // A coordinated ", but …" continuation is a SEPARATE effect (Reckless
      // Attack's attackers-against-you clause) and must not ride the first
      // modifier's constraint.
      const scopeText = match[2].split(/,\s*but\s+/)[0];
      for (const clause of scopeText.split(/,? as well as (?:on )?/i)) {
        const skillCheck =
          /^(?:an? )?(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+\(([A-Za-z ]+)\) checks?(?: (?:and saving throws )?)?(?:that rely on ([a-z, ]+?(?: (?:and|or) [a-z]+)?))?(?:[ .]|$| if )/.exec(
            clause.trim(),
          );
        // Bare-ability checks, optionally paired with same-ability saves
        // ("advantage on Strength checks and Strength saving throws" — Rage).
        const bareCheck =
          /^(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) checks(?: and (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throws)?\.?$/.exec(
            clause.trim(),
          );
        if (skillCheck === null && bareCheck !== null) {
          out.push(
            compact({
              kind: 'abilityCheckModifier',
              mode,
              ability: bareCheck[1].toLowerCase(),
              condition,
            }),
          );
          if (bareCheck[2] !== undefined) {
            out.push(
              compact({
                kind: 'savingThrowModifier',
                mode,
                abilities: [bareCheck[2].toLowerCase()],
                condition,
              }),
            );
          }
          continue;
        }
        if (skillCheck !== null) {
          out.push(
            compact({
              kind: 'abilityCheckModifier',
              mode,
              ability: skillCheck[1].toLowerCase(),
              skill: skillCheck[2].toLowerCase().replaceAll(' ', '-'),
              reliesOn:
                skillCheck[3] === undefined
                  ? undefined
                  : skillCheck[3]
                      .split(/,\s*|\s+(?:and|or)\s+/)
                      .map((sense) => sense.trim())
                      .filter((sense) => sense.length > 0),
              condition,
            }),
          );
          continue;
        }
        const attackRoll =
          /^(?:an )?(melee |ranged )?(?:weapon |spell )?attack rolls?\b\s*([^.;]*)/.exec(
            clause.trim(),
          );
        if (attackRoll !== null) {
          const qualifier = attackRoll[2].trim().replace(/[,.]$/, '');
          out.push(
            compact({
              kind: 'attackRollModifier',
              mode,
              attackType: attackRoll[1]?.trim(),
              condition,
              constraint: qualifier.length > 0 ? qualifier : undefined,
            }),
          );
          continue;
        }
        const savingThrow =
          /^(?:all )?(?:((?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)(?:, (?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma))*(?:,? and (?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma))?) )?saving throws( and (?:all )?ability checks)?(?: against (.+?))?\.?$/.exec(
            clause.trim(),
          );
        if (savingThrow !== null) {
          // Keep only the first coordinate clause ("being charmed, and magic
          // can't put the elf to sleep" → "being charmed") so unrelated
          // sentence continuations never ride the scope field.
          const abilities = savingThrow[1]
            ?.split(/,\s*(?:and\s+)?|\s+and\s+/)
            .map((ability) => ability.trim().toLowerCase())
            .filter((ability) => ability.length > 0);
          const against = savingThrow[3]
            ?.split(/,\s*(?:and|but)\s+/)[0]
            .trim()
            .replace(/[,.]$/, '');
          // Pure condition clauses ("against being charmed") are owned by
          // the condition-relation projection; skip to avoid double-counting.
          if (against !== undefined && /^being [a-z]+$/.test(against)) {
            continue;
          }
          out.push(
            compact({
              kind: 'savingThrowModifier',
              mode,
              abilities,
              against,
              condition,
            }),
          );
          // "… saving throws and all ability checks" (Lamia's Intoxicating
          // Touch) grants the check-side modifier in the same clause.
          if (savingThrow[2] !== undefined) {
            out.push(
              compact({
                kind: 'abilityCheckModifier',
                mode,
                scope: 'all',
                condition,
              }),
            );
          }
        }
      }
    }
  }
  return out;
}

/**
 * Non-modifier trait/action effect grammars. Each is a single anchored
 * pattern for one reviewed SRD phrasing.
 */
function parseCreatureEntryEffects(name: string, text: string): Mechanics[] {
  const effects: Mechanics[] = [...parseModifierEffects(text)];
  if (/\bfails a saving throw, it can choose to succeed instead\b/.test(text)) {
    effects.push({ kind: 'legendaryResistance' });
  }
  const regen =
    /\bregains (\d+) hit points at the start of (?:its|the .+?) turn\b( if [^.]+)?/.exec(
      text,
    );
  if (regen !== null) {
    // The suppression clause is captured verbatim (the Vampire's "radiant
    // damage or damage from holy water" is not a bare type list); a clean
    // "<type>[ or <type>] damage" form additionally yields the typed list.
    const suppressed =
      /\bIf (?:the [\w’' ]+?|it) takes (.+?), this trait doesn[’']t function\b/.exec(
        text,
      );
    const typeList =
      suppressed === null
        ? null
        : /^([a-z]+(?: or [a-z]+)*) damage$/.exec(suppressed[1]);
    effects.push(
      compact({
        kind: 'regeneration',
        hitPoints: Number(regen[1]),
        timing: 'start-of-turn',
        condition: regen[2]?.trim(),
        suppressedBy: suppressed === null ? undefined : suppressed[1],
        suppressedByDamageTypes:
          typeList === null
            ? undefined
            : typeList[1]
                .split(/\s+or\s+/)
                .map((type) => type.trim())
                .filter((type) => SRD_5_1_DAMAGE_TYPES.has(type)),
      }),
    );
  }
  if (/^Multiattack\b/.test(name)) {
    const count =
      /\bmakes (one|two|three|four|five|six|\d+)\b[^.]*?\battacks?\b/.exec(
        text,
      );
    if (count !== null) {
      effects.push({
        kind: 'multiattack',
        attacks: NUMBER_WORDS.get(count[1].toLowerCase()) ?? Number(count[1]),
      });
    }
  }
  const healing =
    /\bregains (\d+) \((\d+d\d+(?:\s*[+-]\s*\d+)?)\) hit points\b/.exec(text);
  if (healing !== null) {
    effects.push({
      kind: 'healing',
      average: Number(healing[1]),
      dice: healing[2].replace(/\s+/g, ' '),
    });
  }
  const breathes = /\bcan breathe (only )?([a-z]+(?:,? and [a-z]+)?)\b/.exec(
    text,
  );
  if (breathes !== null) {
    const environments = breathes[2]
      .split(/,? and /)
      .map((env) => (env === 'underwater' ? 'water' : env))
      .filter((env) => env === 'air' || env === 'water');
    if (environments.length > 0) {
      effects.push(
        compact({
          kind: 'breathes',
          environments,
          only: breathes[1] === undefined ? undefined : true,
        }),
      );
    }
  }
  const holdBreath = /\bcan hold its breath for (\d+) (minutes?|hours?)\b/.exec(
    text,
  );
  if (holdBreath !== null) {
    effects.push({
      kind: 'holdBreath',
      duration: `${holdBreath[1]} ${holdBreath[2]}`,
    });
  }
  const jump =
    /\blong jump is up to (\d+) feet and (?:its )?high jump is up to (\d+) feet, with or without a running start\b/.exec(
      text,
    );
  if (jump !== null) {
    effects.push({
      kind: 'jumpDistance',
      longJumpFeet: Number(jump[1]),
      highJumpFeet: Number(jump[2]),
      runningStartRequired: false,
    });
  }
  const check =
    /\bmakes an? (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) \(([A-Za-z ]+)\) check\b/.exec(
      text,
    );
  if (check !== null) {
    effects.push({
      kind: 'makeAbilityCheck',
      ability: check[1].toLowerCase(),
      skill: check[2].toLowerCase().replaceAll(' ', '-'),
    });
  }
  const parry =
    /\badds (\d+) to its AC against one melee attack that would hit it\b/.exec(
      text,
    );
  if (parry !== null) {
    effects.push({
      kind: 'acBonus',
      amount: Number(parry[1]),
      scope: 'one-melee-attack-that-would-hit',
    });
  }
  if (/\b(?:Its|The [\w' ]+?['’]s) weapon attacks are magical\b/.test(text)) {
    effects.push({ kind: 'weaponAttacksMagical' });
  }
  if (
    /\bis immune to any spell or effect that would alter its form\b/.test(text)
  ) {
    effects.push({
      kind: 'immunity',
      to: 'form-altering-spells-and-effects',
    });
  }
  if (/\bis immune to (?:features|effects) that turn undead\b/.test(text)) {
    effects.push({ kind: 'immunity', to: 'turn-undead' });
  }
  if (/\bdeals double damage to objects and structures\b/.test(text)) {
    effects.push({
      kind: 'damageMultiplier',
      multiplier: 2,
      against: 'objects-and-structures',
    });
  }
  // Legendary-action references to a named attack ("The dragon makes a tail
  // attack.", "The aboleth makes one tail attack.").
  const namedAttack =
    /^The [\w' ]+ makes (?:one|a|an) ((?:[a-z]+ ){0,2}?)attack\.$/.exec(text);
  if (namedAttack !== null && namedAttack[1].trim().length > 0) {
    const attackName = namedAttack[1].trim();
    if (attackName !== 'melee' && attackName !== 'ranged') {
      effects.push({ kind: 'makeAttack', attack: attackName });
    }
  }
  // Triggered marker: the entry activates on a stated trigger rather than by
  // spending an action. Captures the trigger clause verbatim. Suppressed for
  // Legendary Resistance, whose trigger is already the typed effect itself.
  const trigger = effects.some(
    (effect) => effect.kind === 'legendaryResistance',
  )
    ? null
    : /^(When(?:ever)?|If|The first time|At the start of|At the end of|Immediately after) ([^,]+),/.exec(
        text,
      );
  if (trigger !== null) {
    effects.push({
      kind: 'triggeredEffect',
      trigger: `${trigger[1]} ${trigger[2]}`,
    });
  }
  return effects;
}

export function deriveCreatureEntryMechanics(
  name: string,
  text: string,
  resolveSpellRef?: SpellRefResolver,
): Mechanics {
  const attack = parseAttack(text);
  const save = parseSave(text);
  const effects = parseCreatureEntryEffects(name, text);
  return compact({
    attacks: attack === undefined ? undefined : [attack],
    recharge: parseRecharge(name),
    usage: parseUsage(name),
    saves: save === undefined ? undefined : [save],
    damage: parseDamage(text),
    conditions: parseConditions(text),
    effects: effects.length > 0 ? effects : undefined,
    spellcasting: parseCreatureSpellcasting(name, text, resolveSpellRef),
  });
}

/**
 * Project structured spell grants from feature prose. Fail-closed: the loose
 * "you learn/can cast/know the X spell" capture is only kept when `resolve`
 * maps the captured fragment to a real `spell:<slug>` ref. Without a resolver
 * (focused fixtures, non-spell-bearing records) no grants are emitted, so a
 * mechanics-looking field never carries unvalidated natural-language residue
 * (eshyra-vk23.1).
 */
function deriveSpellGrants(
  text: string,
  resolve: SpellGrantResolver | undefined,
): readonly Mechanics[] | undefined {
  if (resolve === undefined) return undefined;
  const grants: Mechanics[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(
    /\byou (?:learn|can cast|know) (?:the )?([a-z][a-z' -]+?) spell\b/gi,
  )) {
    const ref = resolve(match[1]);
    if (ref !== undefined && !seen.has(ref)) {
      seen.add(ref);
      grants.push({ spell: ref });
    }
  }
  return grants.length > 0 ? grants : undefined;
}

/**
 * Feature/trait runtime-effect grammars (eshyra-o9bd.18.7.5). Anchored to the
 * SRD's class-feature and racial-trait phrasings; shared modifier scanning
 * comes from `parseModifierEffects`. Replaces the earlier keyword-presence
 * markers (bare `advantage`/`resistance`/`proficiency`), which fired on any
 * mention and carried no semantics.
 */
function parseFeatureEffects(text: string): readonly Mechanics[] {
  const effects: Mechanics[] = [...parseModifierEffects(text)];
  const acFormula =
    /\b(?:AC|Armor Class) equals (\d+) \+ your (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier(?: \+ your (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier)?(?: \+ your shield['\u2019]s AC bonus)?/i.exec(
      text,
    );
  if (acFormula !== null) {
    effects.push(
      compact({
        kind: 'acFormula',
        base: Number(acFormula[1]),
        abilities: [
          acFormula[2].toLowerCase(),
          ...(acFormula[3] === undefined ? [] : [acFormula[3].toLowerCase()]),
        ],
        // Shield eligibility is stated either inside the formula ("+ your
        // shield's AC bonus") or as its own sentence (Barbarian Unarmored
        // Defense: "You can use a shield and still gain this benefit.").
        allowsShield:
          /\+ your shield['\u2019]s AC bonus/i.test(text) ||
          /\bYou can use a shield and still gain this benefit\b/i.test(text)
            ? true
            : undefined,
      }),
    );
  }
  const extraAttack = /\battack (twice|three times|four times)\b/i.exec(text);
  if (extraAttack !== null) {
    const attacks =
      extraAttack[1] === 'twice' ? 2 : extraAttack[1] === 'three times' ? 3 : 4;
    // The Fighter's tiers: "The number of attacks increases to three when
    // you reach 11th level in this class and to four when you reach 20th
    // level in this class." Every printed tier is preserved.
    const increases = [
      ...text.matchAll(
        /\bto (two|three|four) when you reach (\d+)(?:st|nd|rd|th) level\b/gi,
      ),
    ].map((tier) => ({
      level: Number(tier[2]),
      attacks: NUMBER_WORDS.get(tier[1].toLowerCase()) ?? 0,
    }));
    effects.push(
      compact({
        kind: 'extraAttack',
        attacks,
        increases: increases.length > 0 ? increases : undefined,
      }),
    );
  }
  const critical =
    /\bcritical hit on a roll of (\d+)(?:[-\u2013]20| or 20)\b/i.exec(text);
  if (critical !== null) {
    effects.push({ kind: 'criticalRange', minimumRoll: Number(critical[1]) });
  }
  if (
    /\binstead take no damage if you succeed on the saving throw, and only half damage if you fail\b/i.test(
      text,
    )
  ) {
    effects.push({ kind: 'evasion' });
  }
  const resistance =
    /\b(?:you (?:have|gain)|gains?) resistance (?:to|against) ([a-z]+(?:(?:,| and|, and) [a-z]+)*) damage\b/i.exec(
      text,
    );
  if (resistance !== null) {
    const types = resistance[1]
      .toLowerCase()
      .split(/,\s*(?:and\s+)?|\s+and\s+/)
      .map((type) => type.trim())
      .filter((type) => SRD_5_1_DAMAGE_TYPES.has(type));
    if (types.length > 0) {
      effects.push({ kind: 'damageResistance', types });
    }
  }
  if (
    /\bresistance to the damage type associated with your draconic ancestry\b/i.test(
      text,
    )
  ) {
    effects.push({ kind: 'damageResistance', typeFrom: 'draconic-ancestry' });
  }
  // Conditional double-proficiency clauses (Stonecunning, the Rock Gnome's
  // Artificer's Lore): "Whenever you make an Intelligence (History) check
  // related to …, you are considered proficient in the History skill and
  // add double your proficiency bonus …". The executable rule is projected
  // structurally — a scoped proficiency grant plus a scoped expertise —
  // never embedded inside a free-text grant string.
  const conditionalExpertise =
    /\bWhenever you make an? (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) \(([A-Za-z ]+)\) check (.*?), you (?:are considered proficient in ([^.]*?) and )?(?:can )?add (?:double|twice) your proficiency bonus\b/.exec(
      text,
    );
  if (conditionalExpertise !== null) {
    if (conditionalExpertise[4] !== undefined) {
      effects.push({
        kind: 'proficiency',
        grant: conditionalExpertise[4].trim(),
        condition: conditionalExpertise[3].trim(),
      });
    }
    effects.push({
      kind: 'expertise',
      ability: conditionalExpertise[1].toLowerCase(),
      skill: conditionalExpertise[2].toLowerCase().replaceAll(' ', '-'),
      condition: conditionalExpertise[3].trim(),
    });
  }
  // Typed proficiency grants ("You have proficiency with the battleaxe, …",
  // "You gain proficiency in the Intimidation skill"). The grant clause is
  // kept verbatim — item/skill vocabularies live in the equipment/skill
  // records. The considered-proficient form is owned by the conditional
  // double-proficiency grammar above.
  const proficiency =
    conditionalExpertise === null
      ? /\b[Yy]ou (?:have|gain) proficiency (with|in) ([^.]+)\.|\b[Yy]ou are considered proficient in ([^.]+)\./.exec(
          text,
        )
      : /\b[Yy]ou (?:have|gain) proficiency (with|in) ([^.]+)\./.exec(text);
  if (proficiency !== null) {
    effects.push({
      kind: 'proficiency',
      grant: (proficiency[2] ?? proficiency[3]).trim(),
    });
  }
  if (/\bresistance to all damage\b/.test(text)) {
    effects.push({ kind: 'damageResistance', types: 'all' });
  }
  const immunity = /\b(?:you are|makes you) immune to ([a-z ]+?)[.,]/.exec(
    text,
  );
  if (immunity !== null) {
    effects.push({ kind: 'immunity', to: immunity[1].trim() });
  }
  const darkvision =
    /\b(?:you (?:have|can see in)|gains?) (?:superior )?darkvision[^.]*?(\d+) feet\b/i.exec(
      text,
    );
  if (darkvision !== null) {
    effects.push({
      kind: 'sense',
      sense: 'darkvision',
      rangeFeet: Number(darkvision[1]),
    });
  }
  const speedBonus = /\bspeed increases by (\d+) feet( while [^.]+)?/i.exec(
    text,
  );
  if (speedBonus !== null) {
    effects.push(
      compact({
        kind: 'speedBonus',
        amountFeet: Number(speedBonus[1]),
        condition: speedBonus[2]?.trim(),
      }),
    );
  }
  if (
    /\bproficiency bonus is doubled\b/i.test(text) ||
    (conditionalExpertise === null &&
      /\badd (?:twice|double) your proficiency bonus\b/i.test(text))
  ) {
    effects.push({ kind: 'expertise' });
  }
  const dcFormula =
    /\bDC (?:for this saving throw )?(?:equals|is) (\d+) \+ your (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier( \+ your proficiency bonus)?/i.exec(
      text,
    );
  if (dcFormula !== null) {
    effects.push(
      compact({
        kind: 'saveDcFormula',
        base: Number(dcFormula[1]),
        ability: dcFormula[2].toLowerCase(),
        addProficiencyBonus: dcFormula[3] === undefined ? undefined : true,
      }),
    );
  }
  const extraDamage =
    /\b(?:deals?|takes) an extra (\d+d\d+) (?:([a-z]+) )?damage\b/i.exec(text);
  if (
    extraDamage !== null &&
    (extraDamage[2] === undefined || SRD_5_1_DAMAGE_TYPES.has(extraDamage[2]))
  ) {
    effects.push(
      compact({
        kind: 'extraDamage',
        dice: extraDamage[1],
        type: extraDamage[2],
      }),
    );
  }
  const damageBonus = /(?<![\w+-])([+-]\d+) bonus to the damage roll\b/.exec(
    text,
  );
  if (damageBonus !== null) {
    effects.push({ kind: 'damageBonus', amount: Number(damageBonus[1]) });
  }
  const attackersAgainst =
    /\battack rolls against you have (advantage|disadvantage)\b/i.exec(text);
  if (attackersAgainst !== null) {
    effects.push({
      kind: 'attackRollModifier',
      subject: 'attackers-against-you',
      mode: attackersAgainst[1].toLowerCase(),
    });
  }
  const brutal =
    /\broll (one|two|three) additional weapon damage (?:die|dice) when determining the extra damage for a critical hit\b/i.exec(
      text,
    );
  if (brutal !== null) {
    // "This increases to two additional dice at 13th level and three
    // additional dice at 17th level." — the level progression is part of
    // the deterministic contract, not flavor.
    const increases = [
      ...text.matchAll(
        /\b(one|two|three|four) additional dice at (\d+)(?:st|nd|rd|th) level\b/gi,
      ),
    ].map((tier) => ({
      level: Number(tier[2]),
      additionalDice: NUMBER_WORDS.get(tier[1].toLowerCase()) ?? 0,
    }));
    effects.push(
      compact({
        kind: 'brutalCritical',
        additionalDice: brutal[1] === 'one' ? 1 : brutal[1] === 'two' ? 2 : 3,
        increases: increases.length > 0 ? increases : undefined,
      }),
    );
  }
  const asiIncrease =
    /\bYour (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) and (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) scores increase by (\d+)\. Your maximum for those scores is now (\d+)\b/.exec(
      text,
    );
  if (asiIncrease !== null) {
    effects.push({
      kind: 'abilityScoreIncrease',
      abilities: [asiIncrease[1].toLowerCase(), asiIncrease[2].toLowerCase()],
      amount: Number(asiIncrease[3]),
      newMaximum: Number(asiIncrease[4]),
    });
  }
  const halfProficiency =
    /\badd half your proficiency bonus(?:, rounded (up|down),| \(round (up|down)\))? to any ([^.]*?) checks? you make that doesn['\u2019]t already (?:include|use) your proficiency bonus\b/i.exec(
      text,
    );
  if (halfProficiency !== null) {
    effects.push(
      compact({
        kind: 'halfProficiencyToChecks',
        round: halfProficiency[1] ?? halfProficiency[2],
        scope: halfProficiency[3].trim().toLowerCase(),
      }),
    );
  }
  const magicalStrikes =
    /\b(unarmed strikes|weapon attacks) count as magical for the purpose of overcoming resistance\b/i.exec(
      text,
    );
  if (magicalStrikes !== null) {
    effects.push({
      kind: 'weaponAttacksMagical',
      scope: magicalStrikes[1].toLowerCase().replaceAll(' ', '-'),
    });
  }
  const damageReduction =
    /\b(?:reduce the damage|the damage (?:you take )?(?:from the attack )?is reduced) by (\d+d\d+) \+ your (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier \+ your ([a-z]+) level\b/i.exec(
      text,
    );
  if (damageReduction !== null) {
    effects.push({
      kind: 'damageReduction',
      dice: damageReduction[1],
      addAbilityModifier: damageReduction[2].toLowerCase(),
      addClassLevel: damageReduction[3].toLowerCase(),
    });
  }
  const formulaHeal =
    /\bregain hit points equal to (\d+) \+ your (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier\b/i.exec(
      text,
    );
  if (formulaHeal !== null) {
    effects.push({
      kind: 'healing',
      amount: Number(formulaHeal[1]),
      addAbilityModifier: formulaHeal[2].toLowerCase(),
    });
  }
  const poolHeal =
    /\brestore a number of hit points equal to (five|ten) times your ([a-z]+) level\b/i.exec(
      text,
    );
  if (poolHeal !== null) {
    effects.push({
      kind: 'healing',
      amountFormula: `${poolHeal[1] === 'five' ? 5 : 10} × ${poolHeal[2].toLowerCase()}-level`,
    });
  }
  if (/\bcan['\u2019]t be aged magically\b/i.test(text)) {
    effects.push({ kind: 'stopsAging' });
  }
  if (/\b(?:gain|grants you) proficiency in all saving throws\b/i.test(text)) {
    effects.push({ kind: 'proficiency', scope: 'all-saving-throws' });
  }
  const rollFloor = /\btreat a d20 roll of (\d+) or lower as an? (\d+)\b/i.exec(
    text,
  );
  if (rollFloor !== null) {
    effects.push({
      kind: 'rollFloor',
      rollOf: Number(rollFloor[1]),
      treatAs: Number(rollFloor[2]),
    });
  }
  // Deterministic action economy (eshyra-o9bd.18.7.5 re-review): bonus
  // actions with fixed option sets, reaction attacks, and turn structure.
  const cunningAction =
    /\bYou can take a bonus action on each of your turns in combat\. This action can be used only to take the (.+?) action\./.exec(
      text,
    );
  if (cunningAction !== null) {
    effects.push({
      kind: 'bonusAction',
      options: cunningAction[1]
        .split(/,\s*(?:or\s+)?|\s+or\s+/)
        .map((option) => option.trim().toLowerCase().replaceAll(' ', '-'))
        .filter((option) => option.length > 0),
      frequency: 'each-turn',
    });
  }
  const hideBonus = /\byou can use the (\w+) action as a bonus action\b/i.exec(
    text,
  );
  if (hideBonus !== null) {
    effects.push({
      kind: 'bonusAction',
      options: [hideBonus[1].toLowerCase()],
    });
  }
  if (
    /\byou can make a single melee weapon attack as a bonus action on each of your turns\b/i.test(
      text,
    )
  ) {
    effects.push({
      kind: 'bonusAction',
      options: ['melee-weapon-attack'],
      frequency: 'each-turn',
    });
  }
  // Martial Arts' benefits share one applicability constraint — "while you
  // are unarmed or wielding only monk weapons and you aren't wearing armor
  // or wielding a shield" — that governs every bulleted benefit, so it rides
  // each projected effect rather than being dropped (eshyra-o9bd.18.7.5
  // re-review).
  const sharedEligibility =
    /\bgain the following benefits while you are unarmed or wielding only monk weapons and you aren['’]t wearing armor or wielding a shield\b/i.test(
      text,
    )
      ? {
          wielding: 'unarmed-or-monk-weapons-only',
          armor: false,
          shield: false,
        }
      : undefined;
  if (/\byou can make one unarmed strike as a bonus action\b/i.test(text)) {
    effects.push(
      compact({
        kind: 'bonusAction',
        options: ['unarmed-strike'],
        // The bonus-action strike is gated on having used the Attack action
        // with an unarmed strike or monk weapon this turn.
        prerequisite:
          /\bWhen you use the Attack action with an unarmed strike or a monk weapon on your turn\b/i.test(
            text,
          )
            ? 'attack-action-with-unarmed-strike-or-monk-weapon'
            : undefined,
        eligibility: sharedEligibility,
      }),
    );
  }
  const cunningVia =
    /\byou can use the bonus action granted by your Cunning Action to (.+?)\./.exec(
      text,
    );
  if (cunningVia !== null) {
    effects.push({
      kind: 'bonusAction',
      options: cunningVia[1]
        .split(/,\s*(?:or\s+)?|\s+or\s+(?=use|take|make)/)
        .map((option) => option.trim())
        .filter((option) => option.length > 0),
      via: 'cunning-action',
    });
  }
  const reactionAttack =
    /\bwhen you take damage from a creature that is within (\d+) feet of you, you can use your reaction to make a melee weapon attack against that creature\b/i.exec(
      text,
    );
  if (reactionAttack !== null) {
    effects.push({
      kind: 'reaction',
      action: 'melee-weapon-attack',
      trigger: `take damage from a creature within ${reactionAttack[1]} feet of you`,
    });
  }
  const abilitySub =
    /\bYou can use (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) instead of (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) for the attack and damage rolls of ([^.•]+)/.exec(
      text,
    );
  if (abilitySub !== null) {
    effects.push(
      compact({
        kind: 'abilitySubstitution',
        use: abilitySub[1].toLowerCase(),
        insteadOf: abilitySub[2].toLowerCase(),
        for: ['attack-rolls', 'damage-rolls'],
        appliesTo: abilitySub[3].trim(),
        eligibility: sharedEligibility,
      }),
    );
  }
  const dieReplacement =
    /\bYou can roll a (d\d+) in place of the normal damage of ([^.•]+)/.exec(
      text,
    );
  if (dieReplacement !== null) {
    // "This die changes as you gain monk levels, as shown in the Martial
    // Arts column of the Monk table." — the die is progression-backed, not
    // fixed. The reference resolves against the class record's structured
    // `progression[].advancement` resourceProgression entries (the single
    // source of progression truth), so every level tier is preserved
    // without duplicating the table here.
    const dieProgression =
      /\bThis die changes as you gain ([a-z]+) levels, as shown in the ([A-Za-z ]+?) column of the [A-Za-z ]+ table\b/.exec(
        text,
      );
    effects.push(
      compact({
        kind: 'damageDieReplacement',
        die: dieReplacement[1],
        appliesTo: dieReplacement[2].trim(),
        progression:
          dieProgression === null
            ? undefined
            : {
                classRef: `class:${dieProgression[1].toLowerCase()}`,
                resource: camelCase(dieProgression[2]),
              },
        eligibility: sharedEligibility,
      }),
    );
  }
  const extraTurn =
    /\bYou can take two turns during the first round of any combat\. You take your first turn at your normal initiative and your second turn at your initiative minus (\d+)\b/.exec(
      text,
    );
  if (extraTurn !== null) {
    effects.push({
      kind: 'extraTurn',
      round: 1,
      secondTurnInitiativeOffset: -Number(extraTurn[1]),
    });
  }
  const resourceRegain =
    /\bwhen you roll (?:for )?initiative and have no (ki points|uses of Bardic Inspiration) (?:remaining|left), you regain (one use|\d+ ki points)\b/i.exec(
      text,
    );
  if (resourceRegain !== null) {
    effects.push({
      kind: 'resourceRegain',
      resource: resourceRegain[1].startsWith('ki')
        ? 'ki-points'
        : 'bardic-inspiration',
      amount:
        resourceRegain[2] === 'one use'
          ? 1
          : Number(/\d+/.exec(resourceRegain[2])?.[0]),
      trigger: 'roll-initiative-with-none-remaining',
    });
  }
  if (
    /\bwhen you would normally roll one or more dice to restore hit points with a spell, you instead use the highest number possible for each die\b/i.test(
      text,
    )
  ) {
    effects.push({ kind: 'maximizeHealingDice', appliesTo: 'spell-healing' });
  }
  if (
    /\bWhen a creature succeeds on a saving throw against your cantrip, the creature takes half the cantrip[\u2019']s damage\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'damageOnSuccessfulSave',
      portion: 'half',
      scope: 'your-cantrips',
    });
  }
  const sculpt =
    /\byou can choose a number of them equal to (\d+) \+ the spell[\u2019']s level\. The chosen creatures automatically succeed on their saving throws against the spell\b/.exec(
      text,
    );
  if (sculpt !== null) {
    effects.push({
      kind: 'autoSucceedSave',
      targets: 'chosen-creatures',
      countFormula: `${sculpt[1]} + spell-level`,
      noDamageInsteadOfHalf:
        /take no damage if they would normally take half damage on a successful save/.test(
          text,
        )
          ? true
          : undefined,
    });
  }
  const checkMinimum =
    /\bif your total for a (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) check is less than your \1 score, you can use that score in place of the total\b/i.exec(
      text,
    );
  if (checkMinimum !== null) {
    effects.push({
      kind: 'checkMinimum',
      ability: checkMinimum[1].toLowerCase(),
      minimum: 'ability-score',
    });
  }
  const slowAging =
    /\bFor every (\d+) years that pass, your body ages only (\d+) years?\b/.exec(
      text,
    );
  if (slowAging !== null) {
    effects.push({
      kind: 'slowAging',
      periodYears: Number(slowAging[1]),
      agesYears: Number(slowAging[2]),
    });
  }
  if (/\bclimbing no longer costs you extra movement\b/i.test(text)) {
    effects.push({ kind: 'climbWithoutExtraMovement' });
  }
  const runningJump =
    /\bwhen you make a running jump, the distance you (?:can )?cover increases by a number of feet equal to your (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier\b/i.exec(
      text,
    );
  if (runningJump !== null) {
    effects.push({
      kind: 'jumpDistanceBonus',
      addAbilityModifier: runningJump[1].toLowerCase(),
      appliesTo: 'running-jump',
    });
  }
  if (/\bgaining a flying speed equal to your current speed\b/i.test(text)) {
    // Dragon Wings (eshyra-o9bd.18.7.5 re-review): the feature also fixes
    // the action-economy costs — a bonus action to create the wings and a
    // bonus action to dismiss them — and forbids manifesting them in armor
    // not made to accommodate them. All three clauses are deterministic and
    // ride the speed effect.
    effects.push(
      compact({
        kind: 'speedSet',
        mode: 'fly',
        value: 'current-speed',
        activation: /\bcreate these wings as a bonus action\b/i.test(text)
          ? { cost: 'bonus-action' }
          : undefined,
        deactivation: /\bdismiss them as a bonus action\b/i.test(text)
          ? { cost: 'bonus-action' }
          : undefined,
        eligibility:
          /\bcan['’]t manifest your wings while wearing armor unless the armor is made to accommodate them\b/i.test(
            text,
          )
            ? { armor: 'accommodating-armor-only' }
            : undefined,
      }),
    );
  }
  const abilityDamageBonus =
    /\badd your (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier to one damage roll\b/i.exec(
      text,
    );
  if (abilityDamageBonus !== null) {
    effects.push({
      kind: 'damageBonus',
      addAbilityModifier: abilityDamageBonus[1].toLowerCase(),
      scope: 'one-damage-roll',
    });
  }
  const checkBonus =
    /(?<![\w+-])([+-]\d+) bonus to (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) \(([A-Za-z ]+)\) checks\b/.exec(
      text,
    );
  if (checkBonus !== null) {
    effects.push({
      kind: 'checkBonus',
      amount: Number(checkBonus[1]),
      ability: checkBonus[2].toLowerCase(),
      skill: checkBonus[3].toLowerCase().replaceAll(' ', '-'),
    });
  }
  const saveBonus =
    /\b(you or a friendly creature within (\d+) feet of you )?must make a saving throw, the creature gains a bonus to (?:the|that) saving throw equal to your (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier(?: \(with a minimum bonus of \+(\d+)\))?/i.exec(
      text,
    ) ??
    /()()\bgains a bonus to (?:the|that) saving throw equal to your (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier(?: \(with a minimum bonus of \+(\d+)\))?/i.exec(
      text,
    );
  if (saveBonus !== null) {
    effects.push(
      compact({
        kind: 'savingThrowBonus',
        addAbilityModifier: saveBonus[3].toLowerCase(),
        minimum: saveBonus[4] === undefined ? undefined : Number(saveBonus[4]),
        subject:
          saveBonus[1] === undefined || saveBonus[1] === ''
            ? undefined
            : 'you-or-friendly-creatures',
        rangeFeet:
          saveBonus[2] === undefined || saveBonus[2] === ''
            ? undefined
            : Number(saveBonus[2]),
      }),
    );
  }
  const smite =
    /\bextra damage is (\d+d\d+) for a 1st-level spell slot, plus (\d+d\d+) for each spell level higher than 1st(?:, to a maximum of (\d+d\d+))?/i.exec(
      text,
    );
  if (smite !== null) {
    const undeadFiend =
      /\bdamage increases by (\d+d\d+) if the target is an undead or a fiend\b/i.exec(
        text,
      );
    effects.push(
      compact({
        kind: 'extraDamage',
        dice: smite[1],
        perSlotLevelIncrease: smite[2],
        maximumDice: smite[3],
        bonusDiceVsUndeadOrFiend: undeadFiend?.[1],
      }),
    );
  }
  const attackOrDamage =
    /\badd your (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier to the attack roll or the damage roll\b/i.exec(
      text,
    );
  if (attackOrDamage !== null) {
    effects.push({
      kind: 'attackOrDamageBonus',
      addAbilityModifier: attackOrDamage[1].toLowerCase(),
    });
  }
  const tempFormula =
    /\bgain temporary hit points equal to your (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier(?: \+ your ([a-z]+) level)?\b/i.exec(
      text,
    );
  if (tempFormula !== null) {
    effects.push(
      compact({
        kind: 'temporaryHitPoints',
        addAbilityModifier: tempFormula[1].toLowerCase(),
        addClassLevel: tempFormula[2]?.toLowerCase(),
      }),
    );
  }
  const spellLevelHeal =
    /\bregains? (?:additional )?hit points equal to (\d+) \+ the spell[\u2019']s level\b/i.exec(
      text,
    );
  if (spellLevelHeal !== null) {
    effects.push({
      kind: 'healing',
      amountFormula: `${spellLevelHeal[1]} + spell-level`,
    });
  }
  const fallReduction =
    /\breduce any falling damage you take by an amount equal to (five|ten) times your ([a-z]+) level\b/i.exec(
      text,
    );
  if (fallReduction !== null) {
    effects.push({
      kind: 'damageReduction',
      scope: 'falling',
      amountFormula: `${fallReduction[1] === 'five' ? 5 : 10} × ${fallReduction[2].toLowerCase()}-level`,
    });
  }
  if (/\bhalve the attack[\u2019']s damage against you\b/i.test(text)) {
    effects.push({
      kind: 'damageReduction',
      multiplier: 0.5,
      scope: 'triggering-attack',
    });
  }
  return effects;
}

export function deriveFeatureMechanics(
  text: string,
  resolveSpellGrant?: SpellGrantResolver,
): Mechanics {
  const lower = text.toLowerCase();
  const uses = /\byou can use this feature (once|twice|three times)\b/i.exec(
    text,
  );
  const usesPerAbility =
    /\ba number of times equal to your (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier\b/i.exec(
      text,
    );
  const effects = [...parseFeatureEffects(text)];
  // A permanent always-on spell effect (Oath of Devotion's Purity of
  // Spirit) resolves fail-closed against the emitted spell set, like
  // spellGrants.
  const permanentSpell =
    /\byou are always under the effects of an? ([a-z' ]+?) spell\b/i.exec(text);
  if (permanentSpell !== null && resolveSpellGrant !== undefined) {
    const ref = resolveSpellGrant(permanentSpell[1]);
    if (ref !== undefined) {
      effects.push({ kind: 'permanentSpellEffect', spell: ref });
    }
  }
  const save = parseSave(text);
  return compact({
    saves: save === undefined ? undefined : [save],
    resources: /\b(short or long rest|long rest|short rest)\b/i.test(text)
      ? [
          compact({
            uses:
              uses === null
                ? usesPerAbility === null
                  ? undefined
                  : `${usesPerAbility[1].toLowerCase()}-modifier`
                : uses[1] === 'once'
                  ? 1
                  : uses[1] === 'twice'
                    ? 2
                    : 3,
            reset: lower.includes('short or long rest')
              ? 'short-or-long-rest'
              : lower.includes('short rest')
                ? 'short-rest'
                : 'long-rest',
          }),
        ]
      : undefined,
    conditions: parseConditions(text),
    effects: effects.length > 0 ? [...effects] : undefined,
    spellGrants: deriveSpellGrants(text, resolveSpellGrant),
  });
}

export function deriveFeatMechanics(
  feat: FeatExtraction,
  resolveSpellGrant?: SpellGrantResolver,
): Mechanics {
  return deriveFeatureMechanics(feat.description, resolveSpellGrant);
}

export function deriveHazardMechanics(hazard: HazardExtraction): Mechanics {
  const save = parseSave(hazard.description);
  return compact({
    saves: save === undefined ? undefined : [save],
    damage: parseDamage(hazard.description),
    conditions: parseConditions(hazard.description),
  });
}
