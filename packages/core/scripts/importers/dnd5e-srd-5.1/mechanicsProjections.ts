import { deriveConditionMechanics } from '../../../src/rules/conditionRelations.js';
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

export function deriveSpellMechanics(spell: SpellExtraction): Mechanics {
  const text = `${spell.description} ${spell.higherLevels ?? ''}`;
  const damage = parseDamage(text);
  const weaponDamageModifiers = parseWeaponDamageModifiers(text);
  const save = parseSave(text);
  const conditions = parseConditions(text);
  const scaling = spell.higherLevels?.match(
    /\b(?:damage increases|one more|additional)\b/i,
  )
    ? { sourceText: spell.higherLevels }
    : undefined;
  return compact({
    // The comma is optional: SRD 5.1 p. 173 prints Protection from Evil and
    // Good's duration as "Concentration up to 10 minutes" (a source typo for
    // the usual "Concentration, up to ..." form).
    concentration: /^Concentration,? up to\b/i.test(spell.duration),
    spellAttack: /\b(?:ranged|melee) spell attack\b/i.test(text),
    saves: save === undefined ? undefined : [save],
    damage,
    weaponDamageModifiers,
    conditions,
    scaling,
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
      /\bha(?:s|ve) (advantage|disadvantage) on ([^.;]+)/gi,
    )) {
      const mode = match[1].toLowerCase();
      const scopeText = match[2];
      for (const clause of scopeText.split(/,? as well as (?:on )?/i)) {
        const skillCheck =
          /^(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+\(([A-Za-z ]+)\) checks(?: (?:and saving throws )?)?(?:that rely on ([a-z, ]+?(?: (?:and|or) [a-z]+)?))?(?:[ .]|$)/.exec(
            clause.trim(),
          );
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
          /^(?:an )?(melee |ranged )?attack rolls?\b\s*([^.;]*)/.exec(
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
          /^(?:((?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)(?:, (?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma))*(?:,? and (?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma))?) )?saving throws( and (?:all )?ability checks)?(?: against (.+?))?\.?$/.exec(
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

export function deriveFeatureMechanics(
  text: string,
  resolveSpellGrant?: SpellGrantResolver,
): Mechanics {
  const lower = text.toLowerCase();
  return compact({
    resources: /\b(short or long rest|long rest|short rest)\b/i.test(text)
      ? [
          compact({
            reset: lower.includes('short or long rest')
              ? 'short-or-long-rest'
              : lower.includes('short rest')
                ? 'short-rest'
                : 'long-rest',
          }),
        ]
      : undefined,
    effects: [
      ...(/\battack twice\b/i.test(text)
        ? [{ kind: 'extraAttack', attacks: 2 }]
        : []),
      ...(/\bcritical hit on a roll of 19 or 20\b/i.test(text)
        ? [{ kind: 'criticalRange', minimumRoll: 19 }]
        : []),
      ...(/\badvantage\b/i.test(text) ? [{ kind: 'advantage' }] : []),
      ...(/\bresistance\b/i.test(text) ? [{ kind: 'resistance' }] : []),
      ...(/\bproficiency\b/i.test(text) ? [{ kind: 'proficiency' }] : []),
    ],
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
