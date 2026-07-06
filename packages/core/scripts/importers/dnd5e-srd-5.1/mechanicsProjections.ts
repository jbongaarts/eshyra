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
    /\b(?:returns? to life|is restored to life) with (all its hit points|\d+ hit points?)\b/.exec(
      text,
    );
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
    /\bsheds (bright|dim) light in a (\d+)-\s?foot(?:-radius)? (?:radius|sphere)(?: and dim light for an additional (\d+) feet)?/.exec(
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
  // Metadata-only re-audit grammars (eshyra-o9bd.18.7.9): deterministic
  // semantics that previously hid inside accepted metadata-only spells. Each
  // is one anchored pattern for one reviewed SRD phrasing.
  const jumpMultiplier = /\bjump distance is (doubled|tripled)\b/.exec(text);
  if (jumpMultiplier !== null) {
    effects.push({
      kind: 'jumpDistanceMultiplier',
      multiplier: jumpMultiplier[1] === 'doubled' ? 2 : 3,
    });
  }
  if (
    /\bYou touch a living creature that has 0 hit points\. The creature becomes stable\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'stabilize',
      target: 'living-creature-at-0-hit-points',
    });
  }
  if (
    /\bas a bonus action on each of your turns until the spell ends, you can take the Dash action\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'bonusAction',
      options: ['dash'],
      frequency: 'each-turn',
    });
  }
  const moveLights =
    /\bAs a bonus action on your turn, you can move the lights? up to (\d+) feet to a new spot within range\b/.exec(
      text,
    );
  if (moveLights !== null) {
    effects.push({
      kind: 'bonusAction',
      options: [`move-lights-up-to-${moveLights[1]}-feet`],
    });
  }
  if (
    /\bA flame, equivalent in brightness to a torch, springs forth from an object\b/.test(
      text,
    )
  ) {
    effects.push({ kind: 'light', equivalentTo: 'torch' });
  }
  const daylightSphere =
    /\bA (\d+)-\s?foot-radius sphere of light spreads out from a point\b[\s\S]*?\bThe sphere is bright light and sheds dim light for an additional (\d+) feet\b/.exec(
      text,
    );
  if (daylightSphere !== null) {
    effects.push({
      kind: 'light',
      level: 'bright',
      radiusFeet: Number(daylightSphere[1]),
      dimAdditionalFeet: Number(daylightSphere[2]),
    });
  }
  const magicalDarkness =
    /\bMagical darkness spreads from a point you choose within range to fill a (\d+)-\s?foot-radius sphere\b/.exec(
      text,
    );
  if (magicalDarkness !== null) {
    effects.push(
      compact({
        kind: 'obscurement',
        level: 'heavily',
        source: 'magical-darkness',
        radiusFeet: Number(magicalDarkness[1]),
        blocksDarkvision:
          /\bA creature with darkvision can['’]t see through this darkness\b/.test(
            text,
          )
            ? true
            : undefined,
      }),
    );
  }
  const spellTeleport =
    /\byou teleport up to (\d+) feet to an unoccupied space (?:that )?you can see\b/.exec(
      text,
    );
  if (spellTeleport !== null) {
    effects.push({ kind: 'teleport', distanceFeet: Number(spellTeleport[1]) });
  }
  if (
    /\bAny creature that enters the portal instantly appears within \d+ feet of the destination circle\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'teleport',
      destination: 'linked-permanent-teleportation-circle',
    });
  }
  if (
    /\binstantly teleport to a previously designated sanctuary\b/.test(text)
  ) {
    effects.push({ kind: 'teleport', destination: 'designated-sanctuary' });
  }
  const plantTransport =
    /\bany creature can step into the target plant and exit from the destination plant by using (\d+) feet of movement\b/.exec(
      text,
    );
  if (plantTransport !== null) {
    effects.push({
      kind: 'teleport',
      via: 'plants',
      destination: 'linked-plant',
      movementCostFeet: Number(plantTransport[1]),
    });
  }
  const treeStride =
    /\bability to enter a tree and move from inside it to inside another tree of the same kind within (\d+) feet\b/.exec(
      text,
    );
  if (treeStride !== null) {
    effects.push(
      compact({
        kind: 'teleport',
        via: 'trees',
        distanceFeet: Number(treeStride[1]),
        movementCostFeet: /\bYou must use (\d+) feet of movement to enter a tree\b/.exec(
          text,
        )
          ? Number(
              /\bYou must use (\d+) feet of movement to enter a tree\b/.exec(
                text,
              )?.[1],
            )
          : undefined,
      }),
    );
  }
  const blink =
    /\bOn a roll of (\d+) or higher, you vanish from your current plane of existence and appear in the Ethereal Plane\b/.exec(
      text,
    );
  if (blink !== null) {
    const returnRange =
      /\byou return to an unoccupied space of your choice that you can see within (\d+) feet\b/.exec(
        text,
      );
    effects.push(
      compact({
        kind: 'planeShift',
        planes: ['material', 'ethereal'],
        roll: 'd20',
        threshold: Number(blink[1]),
        trigger: 'end-of-each-of-your-turns',
        returnRangeFeet:
          returnRange === null ? undefined : Number(returnRange[1]),
      }),
    );
  }
  if (
    /\bYou step into the border regions of the Ethereal Plane\b/.test(text)
  ) {
    effects.push({ kind: 'planeShift', planes: ['material', 'ethereal'] });
  }
  const understand =
    /\byou understand the literal meaning of any spoken language that you hear\b/.test(
      text,
    ) ||
    /\bability to understand any spoken language it hears\b/.test(text);
  if (understand) {
    effects.push(
      compact({
        kind: 'understandLanguages',
        spoken: true,
        written:
          /\bYou also understand any written language that you see\b/.test(
            text,
          )
            ? true
            : undefined,
        speechUnderstood:
          /\bany creature that knows at least one language and can hear the target understands what it says\b/.test(
            text,
          )
            ? true
            : undefined,
      }),
    );
  }
  const truesight =
    /\bhas truesight, notices secret doors hidden by magic, and can see into the Ethereal Plane, all out to a range of (\d+) feet\b/.exec(
      text,
    );
  if (truesight !== null) {
    effects.push({
      kind: 'sense',
      sense: 'truesight',
      rangeFeet: Number(truesight[1]),
    });
  }
  const detectTypes =
    /\byou know if there is an aberration, celestial, elemental, fey, fiend, or undead within (\d+) feet of you\b/.exec(
      text,
    );
  if (detectTypes !== null) {
    effects.push({
      kind: 'sense',
      sense: 'detect-creature-types',
      detects:
        'aberrations, celestials, elementals, fey, fiends, undead, and consecrated or desecrated places and objects',
      rangeFeet: Number(detectTypes[1]),
    });
  }
  const senseMagicSpell =
    /\byou sense the presence of magic within (\d+) feet of you\b/.exec(text);
  if (senseMagicSpell !== null) {
    effects.push({
      kind: 'sense',
      sense: 'detect-magic',
      rangeFeet: Number(senseMagicSpell[1]),
    });
  }
  const detectPoison =
    /\byou can sense the presence and location of poisons, poisonous creatures, and diseases within (\d+) feet of you\b/.exec(
      text,
    );
  if (detectPoison !== null) {
    effects.push({
      kind: 'sense',
      sense: 'detect-poison-and-disease',
      rangeFeet: Number(detectPoison[1]),
    });
  }
  if (
    /\bYou sense the presence of any trap within range that is within line of sight\b/.test(
      text,
    )
  ) {
    effects.push({ kind: 'sense', sense: 'detect-traps' });
  }
  const locateNature =
    /\byou learn the direction and distance to the closest creature or plant of that kind within (\d+) miles\b/.exec(
      text,
    );
  if (locateNature !== null) {
    effects.push({
      kind: 'sense',
      sense: 'locate-named-beast-or-plant',
      rangeMiles: Number(locateNature[1]),
    });
  }
  const locateThing =
    /\bYou sense the direction to the (creature|object)['’]s location, as long as that (?:creature|object) is within ([\d,]+) feet of you\b/.exec(
      text,
    );
  if (locateThing !== null) {
    effects.push({
      kind: 'sense',
      sense: `locate-${locateThing[1]}`,
      rangeFeet: Number(locateThing[2].replaceAll(',', '')),
    });
  }
  if (
    /\byou know how far it is and in what direction it lies\b/.test(text)
  ) {
    effects.push({
      kind: 'sense',
      sense: 'direction-and-distance-to-destination',
    });
  }
  if (/\b(?:ability to|You can) breathe underwater\b/.test(text)) {
    // Water Breathing: "Affected creatures also retain their normal mode of
    // respiration."; Alter Self's Aquatic Adaptation likewise adds water.
    effects.push({ kind: 'breathes', environments: ['air', 'water'] });
  }
  if (
    /\bgains? a swimming speed equal to (?:your|its) walking speed\b/.test(
      text,
    )
  ) {
    effects.push({ kind: 'speedSet', mode: 'swim', value: 'walking-speed' });
  }
  const naturalWeapons =
    /\bYour unarmed strikes deal (\d+d\d+) bludgeoning, piercing, or slashing damage\b[\s\S]*?\+(\d+) bonus to the attack and damage rolls you make using it\b/.exec(
      text,
    );
  if (naturalWeapons !== null) {
    effects.push({
      kind: 'naturalWeaponDamage',
      dice: naturalWeapons[1],
      typeChoice: ['bludgeoning', 'piercing', 'slashing'],
      attackAndDamageBonus: Number(naturalWeapons[2]),
      magical: true,
      proficient: true,
    });
  }
  if (
    /\bability to move across any liquid surface[—-]such as water, acid, mud, snow, quicksand, or lava[—-]as if it were harmless solid ground\b/.test(
      text,
    )
  ) {
    const surfacing =
      /\bcarries the target to the surface of the liquid at a rate of (\d+) feet per round\b/.exec(
        text,
      );
    effects.push(
      compact({
        kind: 'walkOnLiquids',
        surfacingFeetPerRound:
          surfacing === null ? undefined : Number(surfacing[1]),
      }),
    );
  }
  if (
    /\bability to move up, down, and across vertical surfaces and upside down along ceilings, while leaving its hands free\b/.test(
      text,
    )
  ) {
    effects.push({ kind: 'climbAnywhere' });
  }
  if (
    /\bgains a climbing speed equal to its walking speed\b/.test(text)
  ) {
    effects.push({ kind: 'speedSet', mode: 'climb', value: 'walking-speed' });
  }
  const featherFall =
    /\bfalling creature['’]s rate of descent slows to (\d+) feet per round\b/.exec(
      text,
    );
  if (featherFall !== null) {
    effects.push(
      compact({
        kind: 'slowFall',
        descentFeetPerRound: Number(featherFall[1]),
        noFallingDamageOnLanding:
          /\bit takes no falling damage and can land on its feet\b/.test(text)
            ? true
            : undefined,
      }),
    );
  }
  const dcIncrease =
    /\bthe DC to break it or pick any locks on it increases by (\d+)\b/.exec(
      text,
    );
  if (dcIncrease !== null) {
    effects.push({
      kind: 'dcIncrease',
      amount: Number(dcIncrease[1]),
      appliesTo: 'break-or-pick-locks',
    });
  }
  if (/\bbecomes unlocked, unstuck, or unbarred\b/.test(text)) {
    const audible = /\baudible from as far away as (\d+) feet\b/.exec(text);
    const suppress =
      /\bthat spell is suppressed for (\d+) minutes\b/.exec(text);
    effects.push(
      compact({
        kind: 'unlock',
        audibleRangeFeet: audible === null ? undefined : Number(audible[1]),
        suppressesArcaneLockMinutes:
          suppress === null ? undefined : Number(suppress[1]),
      }),
    );
  }
  const glibness =
    /\bwhen you make a Charisma check, you can replace the number you roll with a (\d+)\b/.exec(
      text,
    );
  if (glibness !== null) {
    effects.push({
      kind: 'rollFloor',
      treatAs: Number(glibness[1]),
      scope: 'charisma-checks',
    });
  }
  if (
    /\bmagic that would determine if you are telling the truth indicates that you are being truthful\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'immunity',
      to: 'magical lie detection (always indicates truthful)',
    });
  }
  if (
    /\bThe first time the target would drop to 0 hit points as a result of taking damage, the target instead drops to 1 hit point\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'triggeredEffect',
      trigger:
        'the first time the target would drop to 0 hit points as a result of taking damage',
      result: 'the target drops to 1 hit point instead and the spell ends',
    });
  }
  if (
    /\bsubjected to an effect that would kill it instantaneously without dealing damage, that effect is instead negated\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'triggeredEffect',
      trigger:
        'the target is subjected to an effect that would kill it instantaneously without dealing damage',
      result: 'that effect is negated and the spell ends',
    });
  }
  if (
    /\bthe target is protected from decay and can['’]t become undead\b/.test(
      text,
    )
  ) {
    effects.push({ kind: 'immunity', to: 'decay and becoming undead' });
  }
  if (
    /\bAt your touch, all curses affecting one creature or object end\b/.test(
      text,
    )
  ) {
    effects.push({ kind: 'endsCurses' });
  }
  if (
    /\bcan['’]t be targeted by any divination magic or perceived through magical scrying sensors\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'immunity',
      to: 'divination magic targeting and magical scrying sensors',
    });
  }
  const globe =
    /\bAny spell of (\d+)(?:st|nd|rd|th) level or lower cast from outside the barrier can['’]t affect creatures or objects within it\b/.exec(
      text,
    );
  if (globe !== null) {
    effects.push({
      kind: 'immunity',
      to: `spells of ${globe[1]}th level or lower cast from outside the barrier`,
    });
  }
  if (
    /\bhedging out creatures other than undead and constructs\b/.test(text) &&
    /\bThe barrier prevents an affected creature from passing or reaching through\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'movementRestriction',
      restriction: 'cannot-pass-or-reach-through-barrier',
      subject: 'creatures-other-than-undead-and-constructs',
    });
  }
  if (
    /\bcreatures can['’]t teleport into the area or use portals\b/.test(text)
  ) {
    effects.push({
      kind: 'movementRestriction',
      restriction: 'no-teleportation-or-planar-travel-into-area',
      subject: 'all-creatures',
    });
  }
  const wardDamage =
    /\bthe creature takes (\d+d\d+) (radiant or necrotic|[a-z]+) damage \(your choice when you cast this spell\)/.exec(
      text,
    );
  if (wardDamage !== null) {
    effects.push({
      kind: 'recurringDamage',
      dice: wardDamage[1],
      typeChoice: wardDamage[2].split(/\s+or\s+/),
      trigger:
        'a chosen creature type enters the area for the first time on a turn or starts its turn there',
    });
  }
  const resistChoice =
    /\bresistance to one damage type of your choice: ([a-z]+(?:, [a-z]+)*, or [a-z]+)\b/.exec(
      text,
    );
  if (resistChoice !== null) {
    effects.push({
      kind: 'damageResistance',
      chooseOne: resistChoice[1]
        .split(/,\s*(?:or\s+)?/)
        .map((type) => type.trim())
        .filter((type) => SRD_5_1_DAMAGE_TYPES.has(type)),
    });
  }
  if (
    /\bresistance to nonmagical bludgeoning, piercing, and slashing damage\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'damageResistance',
      types: ['bludgeoning', 'piercing', 'slashing'],
      nonmagicalOnly: true,
    });
  }
  const shillelagh =
    /\byou can use your spellcasting ability instead of Strength for the attack and damage rolls of melee attacks using that weapon, and the weapon['’]s damage die becomes a (d\d+)\b/.exec(
      text,
    );
  if (shillelagh !== null) {
    effects.push({
      kind: 'abilitySubstitution',
      use: 'spellcasting-ability',
      insteadOf: 'strength',
      for: ['attack-rolls', 'damage-rolls'],
      appliesTo: 'melee attacks using that weapon',
    });
    effects.push({
      kind: 'damageDieReplacement',
      die: shillelagh[1],
      appliesTo: 'that weapon',
    });
    if (/\bThe weapon also becomes magical\b/.test(text)) {
      effects.push({ kind: 'weaponAttacksMagical', scope: 'weapon-attacks' });
    }
  }
  const mirrorImages =
    /\bThree illusory duplicates of yourself appear in your space\b[\s\S]*?\bIf you have three duplicates, you must roll a (\d+) or higher[\s\S]*?\bWith two duplicates, you must roll an? (\d+) or higher\. With one duplicate, you must roll an? (\d+) or higher\b/.exec(
      text,
    );
  if (mirrorImages !== null) {
    effects.push(
      compact({
        kind: 'mirrorImages',
        images: 3,
        redirectThresholds: [
          { duplicates: 3, minimumRoll: Number(mirrorImages[1]) },
          { duplicates: 2, minimumRoll: Number(mirrorImages[2]) },
          { duplicates: 1, minimumRoll: Number(mirrorImages[3]) },
        ],
        duplicateAcFormula:
          /\bA duplicate['’]s AC equals (\d+) \+ your Dexterity modifier\b/.test(
            text,
          )
            ? '10 + your Dexterity modifier'
            : undefined,
      }),
    );
  }
  const maze =
    /\bYou banish a creature that you can see within range into a labyrinthine demiplane\b[\s\S]*?\bit makes a DC (\d+) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) check\. If it succeeds, it escapes\b/.exec(
      text,
    );
  if (maze !== null) {
    effects.push({
      kind: 'banishment',
      destination: 'labyrinthine-demiplane',
      escapeDc: Number(maze[1]),
      escapeAbility: maze[2].toLowerCase(),
      escapeCost: 'action',
    });
  }
  const timeStop =
    /\byou take (\d+d\d+(?:\s*\+\s*\d+)?) turns in a row\b/.exec(text);
  if (timeStop !== null) {
    effects.push({
      kind: 'extraTurns',
      turnsDice: timeStop[1].replace(/\s+/g, ' '),
    });
  }
  const overgrowth =
    /\bmust spend (\d+) feet of movement for every 1 foot it moves\b/.exec(
      text,
    );
  if (overgrowth !== null) {
    effects.push({
      kind: 'movementCostMultiplier',
      feetPerFoot: Number(overgrowth[1]),
    });
  }
  // The standard illusion adjudication clause is deterministic: an
  // Intelligence (Investigation) check against the caster's spell save DC.
  if (
    /\bIntelligence \(Investigation\) check against your spell save DC\b/.test(
      text,
    )
  ) {
    effects.push(
      compact({
        kind: 'illusionDiscernment',
        ability: 'intelligence',
        skill: 'investigation',
        dc: 'spell-save-dc',
        cost: /\buses? its action to (?:examine|inspect)\b/.test(text)
          ? 'action'
          : undefined,
      }),
    );
  }
  const cloneRevival =
    /\bif the original creature dies, its soul transfers to the clone, provided that the soul is free and willing to return\b/.exec(
      text,
    );
  if (cloneRevival !== null) {
    effects.push({ kind: 'revive', via: 'clone-body' });
  }
  if (
    /\bthe spell forms a new adult body for it and then calls the soul to enter that body\b/.test(
      text,
    )
  ) {
    effects.push({ kind: 'revive', via: 'new-body' });
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
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
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
    // Either/or routines (Medusa) are preserved as option sets; the Hydra's
    // per-head count and the Violet Fungus's dice count are formulas.
    const eitherOr =
      /\bmakes either (one|two|three|four|five|six) melee attacks\b[^.]*?\bor (one|two|three|four|five|six) ranged attacks\b/.exec(
        text,
      );
    const perHead = /\bmakes as many (\w+) attacks as it has heads\b/.exec(
      text,
    );
    const diceCount = /\bmakes (\d+d\d+) [A-Za-z ]+ attacks\b/.exec(text);
    const count =
      /\bmakes (one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b[^.]*?\battacks?\b/.exec(
        text,
      );
    if (eitherOr !== null) {
      effects.push({
        kind: 'multiattack',
        options: [
          {
            attacks: NUMBER_WORDS.get(eitherOr[1].toLowerCase()) ?? 0,
            attackType: 'melee',
          },
          {
            attacks: NUMBER_WORDS.get(eitherOr[2].toLowerCase()) ?? 0,
            attackType: 'ranged',
          },
        ],
      });
    } else if (perHead !== null) {
      effects.push({
        kind: 'multiattack',
        attacksFormula: 'one-per-head',
        attackName: perHead[1],
      });
    } else if (diceCount !== null) {
      effects.push({ kind: 'multiattack', attacksDice: diceCount[1] });
    } else if (count !== null) {
      // A printed routine breakdown ("seven attacks: six with its
      // longswords and one with its tail") is part of the deterministic
      // contract and rides the total.
      const breakdown = [
        ...text.matchAll(
          /\b(one|two|three|four|five|six|seven|eight|nine|ten) with its ([\w ]+?)(?=,| and\b|\.|$)/g,
        ),
      ].map((part) => ({
        attacks: NUMBER_WORDS.get(part[1].toLowerCase()) ?? 0,
        attack: part[2].trim(),
      }));
      const attacks =
        NUMBER_WORDS.get(count[1].toLowerCase()) ?? Number(count[1]);
      // Emit the routine only when the parsed parts account for the whole
      // total; a partial capture (Behir's "one to constrict") would
      // misrepresent the routine as complete.
      const routineComplete =
        breakdown.length > 0 &&
        breakdown.reduce((sum, part) => sum + part.attacks, 0) === attacks;
      effects.push(
        compact({
          kind: 'multiattack',
          attacks,
          routine: routineComplete ? breakdown : undefined,
        }),
      );
    }
  }
  // Deterministic action economy and attack references
  // (eshyra-o9bd.18.7.9): bonus-action option sets, attack-or-ability
  // selections, legendary movement, and extra reactions.
  const bonusActionTake =
    /\bcan (?:take the (.+?) action as a bonus action|use a bonus action to take the (.+?) action)\b/.exec(
      text,
    );
  if (bonusActionTake !== null) {
    effects.push({
      kind: 'bonusAction',
      options: (bonusActionTake[1] ?? bonusActionTake[2])
        .split(/,\s*(?:or\s+)?|\s+or\s+/)
        .map((option) => option.trim().toLowerCase().replaceAll(' ', '-'))
        .filter((option) => option.length > 0),
    });
  }
  if (
    /\bAs a bonus action, the [\w'\u2019 ]+ can move up to its speed toward a hostile creature that it can see\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'bonusAction',
      options: ['move-up-to-speed-toward-hostile-creature'],
    });
  }
  const attackOrUse =
    /\bmakes one ([a-z ]+?) attack or (?:uses its ([A-Za-z' ]+?)|([a-z ]+?) attack)\.?$/.exec(
      text,
    );
  if (attackOrUse !== null) {
    effects.push(
      compact({
        kind: 'makeAttack',
        options: [
          attackOrUse[1].trim(),
          (attackOrUse[2] ?? attackOrUse[3])?.trim(),
        ].filter((option): option is string => option !== undefined),
      }),
    );
  }
  const attackWith = /\bmakes one attack with its ([a-z ]+?)(?: or uses its ([A-Za-z' ]+?))?\.?$/.exec(
    text,
  );
  if (attackWith !== null) {
    effects.push(
      compact({
        kind: 'makeAttack',
        attack: attackWith[1].trim(),
        orUses: attackWith[2]?.trim(),
      }),
    );
  }
  if (/^The [\w'\u2019 ]+ makes one unarmed strike\.$/.test(text)) {
    effects.push({ kind: 'makeAttack', attack: 'unarmed strike' });
  }
  if (/^The [\w'\u2019 ]+ casts a cantrip\.$/.test(text)) {
    effects.push({ kind: 'castSpell', spellLevel: 'cantrip' });
  }
  const moveUpTo = /^The [\w'\u2019 ]+ moves up to (half its speed|its speed)(?: without provoking opportunity attacks)?\.?$/.exec(
    text,
  );
  if (moveUpTo !== null) {
    effects.push(
      compact({
        kind: 'moveUpTo',
        amount: moveUpTo[1] === 'half its speed' ? 'half-speed' : 'speed',
        withoutOpportunityAttacks: /without provoking opportunity attacks/.test(
          text,
        )
          ? true
          : undefined,
      }),
    );
  }
  if (/\bcan take one reaction on every turn in a combat\b/.test(text)) {
    effects.push({ kind: 'extraReactions', perTurn: 1 });
  }
  if (
    /\bFor each head the [\w'\u2019 ]+ has beyond one, it gets an extra reaction that can be used only for opportunity attacks\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'extraReactions',
      formula: 'one-per-head-beyond-one',
      restrictedTo: 'opportunity-attacks',
    });
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
  // Movement traits (eshyra-o9bd.18.7.9).
  if (
    /\bcan climb difficult surfaces, including upside down on ceilings, without needing to make an ability check\b/.test(
      text,
    )
  ) {
    effects.push({ kind: 'climbWithoutCheck' });
  }
  if (/\bignores movement restrictions caused by webbing\b/.test(text)) {
    effects.push({ kind: 'ignoreMovementRestriction', source: 'webbing' });
  }
  if (
    /\bcan move across and climb icy surfaces without needing to make an ability check\b/.test(
      text,
    )
  ) {
    effects.push({ kind: 'climbWithoutCheck', surfaces: 'icy' });
  }
  if (
    // The SRD prints Ice Walk's clause with a typo ("extra moment"); both
    // spellings are matched so the difficult-terrain rule is preserved.
    /\bdifficult terrain composed of ice or snow doesn['\u2019]t cost it extra mo(?:ve)?ment\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'ignoreDifficultTerrain',
      terrain: ['ice', 'snow'],
    });
  }
  if (
    /\bdoesn['\u2019]t provoke opportunity attacks when it flies out of an enemy['\u2019]s reach\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'preventOpportunityAttacks',
      scope: 'flying-out-of-reach',
    });
  }
  const narrowSpace =
    /\bcan move through a space as narrow as (\d+) inch(?:es)? wide without squeezing\b/.exec(
      text,
    );
  if (narrowSpace !== null) {
    effects.push({
      kind: 'moveThroughNarrowSpaces',
      widthInches: Number(narrowSpace[1]),
    });
  }
  if (
    /\bcan burrow through nonmagical, unworked earth and stone\b/.test(text)
  ) {
    effects.push({ kind: 'earthGlide' });
  }
  const tunneler =
    /\bcan burrow through solid rock at half its burrow speed and leaves a (\d+)-foot-diameter tunnel\b/.exec(
      text,
    );
  if (tunneler !== null) {
    effects.push({
      kind: 'tunneler',
      tunnelDiameterFeet: Number(tunneler[1]),
    });
  }
  const runningLeap =
    /\bWith a (\d+)-foot running start, the [\w'\u2019 ]+ can long jump up to (\d+) feet\b/.exec(
      text,
    );
  if (runningLeap !== null) {
    effects.push({
      kind: 'jumpDistance',
      longJumpFeet: Number(runningLeap[2]),
      runningStartFeet: Number(runningLeap[1]),
    });
  }
  const creatureTeleport =
    /\bmagically teleports?, along with any equipment it is wearing or carrying, up to (\d+) feet to an unoccupied space it can see\b/.exec(
      text,
    );
  if (creatureTeleport !== null) {
    effects.push({ kind: 'teleport', distanceFeet: Number(creatureTeleport[1]) });
  }
  const treeStride =
    /\bcan use (\d+) feet of her movement to step magically into one living tree within her reach and emerge from a second living tree within (\d+) feet of the first\b/.exec(
      text,
    );
  if (treeStride !== null) {
    effects.push({
      kind: 'teleport',
      via: 'living-trees',
      distanceFeet: Number(treeStride[2]),
      movementCostFeet: Number(treeStride[1]),
    });
  }
  if (
    /\benters? the Ethereal Plane from the Material Plane, or vice versa\b/i.test(
      text,
    ) ||
    /\bshift from the Material Plane to the Ethereal Plane, or vice versa\b/i.test(
      text,
    )
  ) {
    effects.push({
      kind: 'planeShift',
      planes: ['material', 'ethereal'],
    });
  }
  // Light and senses (eshyra-o9bd.18.7.9). Raw extraction text can carry a
  // hyphen-space cluster ("10- foot") that output normalization later joins,
  // so the radius patterns tolerate it; "for/in an additional" both occur.
  const entryLight =
    /\bsheds bright light in a (\d+)-\s?foot radius and dim light (?:for|in) an additional (\d+) feet\b/.exec(
      text,
    );
  if (entryLight !== null) {
    effects.push(
      compact({
        kind: 'light',
        level: 'bright',
        radiusFeet: Number(entryLight[1]),
        dimAdditionalFeet: Number(entryLight[2]),
        // Ignited Illumination: the light exists only while ablaze.
        condition: /\bWhile ablaze\b/.test(text) ? 'while-ablaze' : undefined,
      }),
    );
  }
  // Ignited Illumination's ignite/extinguish toggle is a bonus action.
  if (
    /\bAs a bonus action, the [\w'’ ]+ can set itself ablaze or extinguish its flames\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'bonusAction',
      options: ['set-ablaze', 'extinguish-flames'],
    });
  }
  const variableLight =
    /\bsheds bright light in a (\d+)-\s?to (\d+)-\s?foot radius and dim light for an additional number of feet equal to the chosen radius\b/.exec(
      text,
    );
  if (variableLight !== null) {
    effects.push({
      kind: 'light',
      level: 'bright',
      radiusFeetMinimum: Number(variableLight[1]),
      radiusFeetMaximum: Number(variableLight[2]),
      dimAdditionalFeetEqualsRadius: true,
      variable: true,
    });
  }
  // Variable Illumination's radius change is a bonus action.
  if (/\bcan alter the radius as a bonus action\b/.test(text)) {
    effects.push({ kind: 'bonusAction', options: ['alter-light-radius'] });
  }
  if (
    /\bMagical darkness doesn['\u2019]t impede the [\w'\u2019 ]+ darkvision\b/.test(
      text,
    )
  ) {
    effects.push({ kind: 'seeInMagicalDarkness' });
  }
  const etherealSight =
    /\bcan see (\d+) feet into the Ethereal Plane\b/.exec(text);
  if (etherealSight !== null) {
    effects.push({
      kind: 'sense',
      sense: 'ethereal-sight',
      rangeFeet: Number(etherealSight[1]),
    });
  }
  const senseMagic = /\bsenses magic within (\d+) feet of it at will\b/.exec(
    text,
  );
  if (senseMagic !== null) {
    effects.push({
      kind: 'sense',
      sense: 'detect-magic',
      rangeFeet: Number(senseMagic[1]),
    });
  }
  const scentPinpoint =
    /\bcan pinpoint, by scent, the location of ([a-z, ]+?(?:, such as [a-z, ]+)?) within (\d+) feet\b/.exec(
      text,
    );
  if (scentPinpoint !== null) {
    effects.push({
      kind: 'sense',
      sense: 'scent-pinpoint',
      detects: scentPinpoint[1].trim(),
      rangeFeet: Number(scentPinpoint[2]),
    });
  }
  if (
    /\bWhile in contact with a web, the [\w'\u2019 ]+ knows the exact location of any other creature in contact with the same web\b/.test(
      text,
    )
  ) {
    effects.push({ kind: 'sense', sense: 'web-sense' });
  }
  if (/^The [\w'\u2019 ]+ knows if it hears a lie\.$/.test(text)) {
    effects.push({ kind: 'sense', sense: 'detect-lies' });
  }
  // Damage and defense traits (eshyra-o9bd.18.7.9).
  if (
    /\bA melee weapon deals one extra die of its damage when the [\w'\u2019 ]+ hits with it\b/.test(
      text,
    )
  ) {
    effects.push({ kind: 'extraWeaponDamageDie', extraDice: 1 });
  }
  if (
    /\btakes only half the damage dealt to it \(rounded down\), and (?:that|the) creature takes the other half\b/.test(
      text,
    )
  ) {
    effects.push({ kind: 'damageTransfer', portion: 'half' });
  }
  // Shield guardian Bound: ranged half-damage transfer from the amulet's
  // wearer, plus always-known amulet direction/distance.
  const boundTransfer =
    /\bIf the [\w'’ ]+ is within (\d+) feet of the amulet['’]s wearer, half of any damage the wearer takes \(rounded up\) is transferred to the [\w'’ ]+\b/.exec(
      text,
    );
  if (boundTransfer !== null) {
    effects.push({
      kind: 'damageTransfer',
      portion: 'half',
      from: 'amulet-wearer',
      rangeFeet: Number(boundTransfer[1]),
    });
  }
  if (/\bknows the distance and direction to the amulet\b/.test(text)) {
    effects.push({ kind: 'sense', sense: 'bound-amulet-location' });
  }
  const runningWater =
    /\btakes (\d+) ([a-z]+) damage (?:when|if) it ends its turn in running water\b/.exec(
      text,
    );
  if (runningWater !== null && SRD_5_1_DAMAGE_TYPES.has(runningWater[2])) {
    effects.push({
      kind: 'recurringDamage',
      amount: Number(runningWater[1]),
      type: runningWater[2],
      trigger: 'ends-turn-in-running-water',
    });
  }
  const waterSusceptibility =
    /\bFor every (\d+) feet the [\w'\u2019 ]+ moves in water, or for every gallon of water splashed on it, it takes (\d+) ([a-z]+) damage\b/.exec(
      text,
    );
  if (
    waterSusceptibility !== null &&
    SRD_5_1_DAMAGE_TYPES.has(waterSusceptibility[3])
  ) {
    effects.push({
      kind: 'recurringDamage',
      amount: Number(waterSusceptibility[2]),
      type: waterSusceptibility[3],
      trigger: `every ${waterSusceptibility[1]} feet moved in water or gallon of water splashed on it`,
    });
  }
  const corrosion =
    /\bthe weapon takes a permanent and cumulative [\u2212\u2013-](\d+) penalty to damage rolls\. If its penalty drops to [\u2212\u2013-](\d+), the weapon is destroyed\b/.exec(
      text,
    );
  if (corrosion !== null) {
    effects.push(
      compact({
        kind: 'weaponCorrosion',
        penaltyPerHit: -Number(corrosion[1]),
        destroyedAtPenalty: -Number(corrosion[2]),
        // "Nonmagical ammunition made of metal that hits … is destroyed
        // after dealing damage." rides the same corrosion trait.
        ammunitionDestroyedOnHit:
          /\bammunition made of metal that hits the [\w'’ ]+ is destroyed after dealing damage\b/.test(
            text,
          )
            ? true
            : undefined,
      }),
    );
  }
  const reflect =
    /\broll a d6\. On a 1 to (\d+), the [\w'\u2019 ]+ is unaffected\. On a (\d+), the [\w'\u2019 ]+ is unaffected,? and the effect is reflected\b/.exec(
      text,
    );
  if (reflect !== null) {
    effects.push({
      kind: 'spellReflection',
      roll: 'd6',
      unaffectedOnMaximum: Number(reflect[1]),
      reflectedOn: Number(reflect[2]),
    });
  }
  const rejuvenationHours =
    /\bgains a new body in (\d+) hours if its heart is intact\b/.exec(text);
  if (rejuvenationHours !== null) {
    effects.push({
      kind: 'rejuvenation',
      afterHours: Number(rejuvenationHours[1]),
      condition: 'heart-intact',
    });
  }
  const rejuvenationDice =
    /\bcomes back to life with all its hit points in (\d+d\d+) days\b/.exec(
      text,
    );
  if (rejuvenationDice !== null) {
    effects.push({
      kind: 'rejuvenation',
      afterDaysDice: rejuvenationDice[1],
    });
  }
  if (
    /\bcan grant resistance to fire damage to anyone riding it\b/.test(text)
  ) {
    effects.push({
      kind: 'damageResistance',
      types: ['fire'],
      target: 'rider',
    });
  }
  if (
    /\bThe swarm can occupy another creature['\u2019]s space and vice versa\b/.test(
      text,
    )
  ) {
    effects.push(
      compact({
        kind: 'swarm',
        canOccupyOtherCreaturesSpace: true,
        cannotRegainHitPoints:
          /\bcan['\u2019]t regain hit points or gain temporary hit points\b/.test(
            text,
          )
            ? true
            : undefined,
      }),
    );
  }
  const appendage =
    /\bEach (\w+) can be attacked \(AC (\d+); (\d+) hit points?; immunity to ([a-z, ]+? damage)\)/.exec(
      text,
    );
  if (appendage !== null) {
    // Roper tendrils: the maximum count, the action-cost break check, and
    // the next-turn regrowth are all deterministic clauses of the trait.
    const appendageCount =
      /\bcan have up to (one|two|three|four|five|six|seven|eight|nine|ten) (\w+?)s? at a time\b/.exec(
        text,
      );
    const breakCheck =
      /\bcan also be broken if a creature takes an action and succeeds on a DC (\d+) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) check against it\b/.exec(
        text,
      );
    effects.push(
      compact({
        kind: 'attackableAppendage',
        appendage: appendage[1],
        ac: Number(appendage[2]),
        hitPoints: Number(appendage[3]),
        immunities: appendage[4],
        maximumCount:
          appendageCount === null
            ? undefined
            : NUMBER_WORDS.get(appendageCount[1].toLowerCase()),
        breakDc: breakCheck === null ? undefined : Number(breakCheck[1]),
        breakAbility:
          breakCheck === null ? undefined : breakCheck[2].toLowerCase(),
        regrowsNextTurn:
          /\bcan extrude a replacement \w+ on its next turn\b/.test(text)
            ? true
            : undefined,
      }),
    );
  }
  const spotDc =
    /\btakes a successful DC (\d+) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) \(([A-Za-z ]+)\) check to spot\b/.exec(
      text,
    );
  if (spotDc !== null) {
    effects.push({
      kind: 'hiddenFromView',
      spotDc: Number(spotDc[1]),
      ability: spotDc[2].toLowerCase(),
      skill: spotDc[3].toLowerCase().replaceAll(' ', '-'),
    });
  }
  // Transparent's second deterministic clause: entering the unseen cube's
  // space grants it surprise.
  if (
    /\bA creature that tries to enter the [\w'’ ]+ space while unaware of the [\w'’ ]+ is surprised by the [\w'’ ]+\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'triggeredEffect',
      trigger: 'a creature enters its space while unaware of it',
      result: 'that creature is surprised',
    });
  }
  // Illusory Appearance: bonus-action dismissal plus an action-cost
  // inspection check with a fixed discern DC.
  const illusionDiscern =
    /\bmust take an action to visually inspect the illusion and succeed on a DC (\d+) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) \(([A-Za-z ]+)\) check to discern\b/.exec(
      text,
    );
  if (illusionDiscern !== null) {
    effects.push(
      compact({
        kind: 'illusoryDisguise',
        discernDc: Number(illusionDiscern[1]),
        ability: illusionDiscern[2].toLowerCase(),
        skill: illusionDiscern[3].toLowerCase().replaceAll(' ', '-'),
        inspectionCost: 'action',
        endCost:
          /\b(?:illusion|effect) ends if the [\w'’ ]+ takes a bonus action to end it\b/.test(
            text,
          )
            ? 'bonus-action'
            : undefined,
      }),
    );
  }
  const mimicry =
    /\bcan tell they are imitations with a successful DC (\d+) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) \(([A-Za-z ]+)\) check\b/.exec(
      text,
    );
  if (mimicry !== null) {
    effects.push({
      kind: 'mimicry',
      discernDc: Number(mimicry[1]),
      ability: mimicry[2].toLowerCase(),
      skill: mimicry[3].toLowerCase().replaceAll(' ', '-'),
    });
  }
  if (
    /\bhas twenty-four tail spikes\. Used spikes regrow when the [\w'\u2019 ]+ finishes a long rest\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'limitedAmmunition',
      count: 24,
      replenish: 'long-rest',
    });
  }
  const carrySize =
    /\bis considered to be a (Large|Huge|Gargantuan) animal for the purpose of determining its carrying capacity\b/.exec(
      text,
    );
  if (carrySize !== null) {
    effects.push({
      kind: 'carryingCapacitySize',
      size: carrySize[1].toLowerCase(),
    });
  }
  const spellStoring =
    /\bcause the [\w'\u2019 ]+ to store one spell of (\d+)(?:st|nd|rd|th) level or lower\b/.exec(
      text,
    );
  if (spellStoring !== null) {
    effects.push(
      compact({
        kind: 'spellStoring',
        maximumSpellLevel: Number(spellStoring[1]),
        // "When the spell is cast or a new spell is stored, any previously
        // stored spell is lost." — a single stored spell at a time.
        capacity: /\bany previously stored spell is lost\b/.test(text)
          ? 1
          : undefined,
      }),
    );
  }
  const mindImmunity =
    /\bis immune to (scrying and to any effect that would sense its emotions[^.]*|any effect that would sense its emotions or read its thoughts[^.]*)\./.exec(
      text,
    );
  if (mindImmunity !== null) {
    effects.push({
      kind: 'immunity',
      to: mindImmunity[1].trim(),
    });
  }
  // Inscrutable's second deterministic clause: Insight checks against the
  // sphinx's intentions or sincerity have disadvantage.
  const insightDisadvantage =
    /\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) \(([A-Za-z ]+)\) checks made to ascertain the [\w'’ ]+ intentions or sincerity have disadvantage\b/.exec(
      text,
    );
  if (insightDisadvantage !== null) {
    effects.push({
      kind: 'abilityCheckModifier',
      mode: 'disadvantage',
      ability: insightDisadvantage[1].toLowerCase(),
      skill: insightDisadvantage[2].toLowerCase().replaceAll(' ', '-'),
      subject: 'checks-against-it',
      condition: 'made to ascertain its intentions or sincerity',
    });
  }
  // Air Form / Water Form: the elemental can end its move inside a hostile
  // creature's space.
  if (
    /\bcan enter a hostile creature['’]s space and stop there\b/.test(text)
  ) {
    effects.push({ kind: 'enterHostileSpace' });
  }
  // Read Thoughts: a ranged surface-thought sense plus concentration-gated
  // social-check advantage against the read target.
  const readThoughts =
    /\bmagically reads the surface thoughts of one creature within (\d+) feet of it\b/.exec(
      text,
    );
  if (readThoughts !== null) {
    effects.push({
      kind: 'sense',
      sense: 'read-surface-thoughts',
      rangeFeet: Number(readThoughts[1]),
    });
    const socialAdvantage =
      /\bhas advantage on Wisdom \(Insight\) and Charisma \(([A-Za-z, ]+?)(?:, and ([A-Za-z]+))?\) checks against the target\b/.exec(
        text,
      );
    if (socialAdvantage !== null) {
      const charismaSkills = [
        ...socialAdvantage[1].split(/,\s*/),
        ...(socialAdvantage[2] === undefined ? [] : [socialAdvantage[2]]),
      ]
        .map((skill) => skill.trim().toLowerCase())
        .filter((skill) => skill.length > 0);
      effects.push({
        kind: 'abilityCheckModifier',
        mode: 'advantage',
        ability: 'wisdom',
        skill: 'insight',
        condition: 'while reading the target’s mind',
      });
      for (const skill of charismaSkills) {
        effects.push({
          kind: 'abilityCheckModifier',
          mode: 'advantage',
          ability: 'charisma',
          skill,
          condition: 'while reading the target’s mind',
        });
      }
    }
  }
  // Solar Flying Sword: the hovering weapon's command economy is fixed —
  // a bonus action to fly up to 50 feet and attack or return.
  const hoveringWeapon =
    /\breleases its (\w+) to hover magically in an unoccupied space within (\d+) feet of it\b[\s\S]*?\bcan mentally command it as a bonus action to fly up to (\d+) feet and either make one attack against a target or return to the [\w'’ ]+ hands\b/.exec(
      text,
    );
  if (hoveringWeapon !== null) {
    effects.push({
      kind: 'hoveringWeapon',
      weapon: hoveringWeapon[1],
      releaseRangeFeet: Number(hoveringWeapon[2]),
      commandCost: 'bonus-action',
      commandFlyFeet: Number(hoveringWeapon[3]),
      commandOptions: ['make-one-attack', 'return-to-hand'],
    });
  }
  // Vampire Forbiddance: a deterministic movement prohibition.
  if (
    /\bcan['’]t enter a residence without an invitation from one of the occupants\b/.test(
      text,
    )
  ) {
    effects.push({
      kind: 'movementRestriction',
      restriction: 'cannot-enter-residence-without-invitation',
    });
  }
  // Will-o'-wisp Ephemeral: a deterministic equipment prohibition.
  if (/\bcan['’]t wear or carry anything\b/.test(text)) {
    effects.push({ kind: 'cannotWearOrCarry' });
  }
  // Wraith Create Specter: typed summon with range, target constraints, and
  // the control cap.
  const createSpecter =
    /\btargets a humanoid within (\d+) feet of it that has been dead for no longer than (\d+) minutes? and died violently\b[\s\S]*?\brises as a (\w+)\b/.exec(
      text,
    );
  if (createSpecter !== null) {
    const controlCap =
      /\bcan have no more than (one|two|three|four|five|six|seven|eight|nine|ten) \w+s? under its control at one time\b/.exec(
        text,
      );
    effects.push(
      compact({
        kind: 'summonCreature',
        creature: createSpecter[3],
        rangeFeet: Number(createSpecter[1]),
        target: `humanoid dead no longer than ${createSpecter[2]} minute${createSpecter[2] === '1' ? '' : 's'} that died violently`,
        maximumControlled:
          controlCap === null
            ? undefined
            : NUMBER_WORDS.get(controlCap[1].toLowerCase()),
      }),
    );
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
