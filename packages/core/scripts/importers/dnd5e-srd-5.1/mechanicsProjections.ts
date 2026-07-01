import type {
  ActionExtraction,
  FeatExtraction,
  HazardExtraction,
  SpellExtraction,
} from './types.js';

type Mechanics = Record<string, unknown>;

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

const CONDITION_NAMES = [
  'blinded',
  'charmed',
  'deafened',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
] as const;

/**
 * What a sentence says about a condition mention, not just that it was
 * mentioned. Raw condition-name matches conflate "this effect applies the
 * condition" with advantage clauses, immunity clauses, targeting exclusions,
 * and incidental prose (eshyra-qqyj) — unsafe for deterministic game-state
 * logic. Only `applies`/`removes` are state mutations; every other relation
 * is a non-authoritative mention a consumer must not act on without the
 * source text.
 */
type ConditionRelation =
  | 'applies'
  | 'removes'
  | 'immune'
  | 'advantage'
  | 'disadvantage'
  | 'exclusion'
  | 'mention';

// Checked in this order per sentence; the first matching relation wins. Order
// matters: e.g. an advantage-against-conditions list ("...or knocked
// unconscious") must be classified `advantage`, not `applies`, even though it
// also matches an applies-shaped phrase ("knocked unconscious").
const RELATION_PATTERNS: readonly {
  readonly relation: ConditionRelation;
  readonly test: (sentence: string, condition: string) => boolean;
}[] = [
  {
    relation: 'removes',
    test: (s, c) =>
      new RegExp(`\\bno longer\\s+(?:being\\s+)?${c}\\b`, 'i').test(s) ||
      new RegExp(`\\bceases?\\s+to\\s+be\\s+${c}\\b`, 'i').test(s) ||
      new RegExp(`\\b${c}\\s+condition\\s+(?:also\\s+)?ends\\b`, 'i').test(s) ||
      new RegExp(`\\bremoves?\\s+the\\s+${c}\\b`, 'i').test(s),
  },
  {
    relation: 'immune',
    // Broad like `advantage` below: SRD immunity clauses are often a list
    // ("immunity to being charmed and frightened"), so the condition can sit
    // several words after "immune"/"immunity", not immediately after it.
    test: (s, c) =>
      new RegExp(`\\bimmun(?:e|ity)\\b[^.]*\\b${c}\\b`, 'i').test(s) ||
      new RegExp(`\\bunaffected\\s+by\\b[^.]*\\b${c}\\b`, 'i').test(s),
  },
  {
    relation: 'advantage',
    test: (s, c) => new RegExp(`\\badvantage\\b[^.]*\\b${c}\\b`, 'i').test(s),
  },
  {
    relation: 'disadvantage',
    test: (s, c) =>
      new RegExp(`\\bdisadvantage\\b[^.]*\\b${c}\\b`, 'i').test(s),
  },
  {
    relation: 'exclusion',
    test: (s, c) =>
      new RegExp(`\\bignoring\\s+(?:\\w+\\s+){0,2}${c}\\b`, 'i').test(s) ||
      new RegExp(
        `\\bif\\s+(?:\\w+\\s+){0,3}(?:are|is)\\s+(?:already\\s+)?${c}\\b`,
        'i',
      ).test(s) ||
      new RegExp(`\\balready\\s+${c}\\b`, 'i').test(s),
  },
  {
    relation: 'applies',
    test: (s, c) =>
      new RegExp(`\\bbecomes?\\s+${c}\\b`, 'i').test(s) ||
      new RegExp(`\\bfalls?\\s+${c}\\b`, 'i').test(s) ||
      new RegExp(`\\bbe\\s+${c}\\b`, 'i').test(s) ||
      new RegExp(`\\b(?:is|are)\\s+${c}\\b`, 'i').test(s) ||
      new RegExp(`\\bknocked\\s+${c}\\b`, 'i').test(s),
  },
];

// A condition can be mentioned in more than one sentence with different
// relations (sleep's "ignoring unconscious creatures" exclusion clause vs.
// its "falls unconscious" effect clause). When that happens, the state
// mutation the source text actually performs is what matters most to a
// deterministic consumer, so `applies`/`removes` outrank the merely
// descriptive relations — independent of RELATION_PATTERNS' per-sentence
// match order, which is tuned to avoid false positives within one sentence.
const AGGREGATION_PRIORITY: readonly ConditionRelation[] = [
  'applies',
  'removes',
  'immune',
  'advantage',
  'disadvantage',
  'exclusion',
  'mention',
];

function splitSentences(text: string): readonly string[] {
  return text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.length > 0);
}

function classifyConditionRelation(
  sentences: readonly string[],
  condition: string,
): ConditionRelation {
  const found = new Set<ConditionRelation>();
  for (const sentence of sentences) {
    if (!new RegExp(`\\b${condition}\\b`, 'i').test(sentence)) continue;
    const match = RELATION_PATTERNS.find(({ test }) =>
      test(sentence, condition),
    );
    found.add(match?.relation ?? 'mention');
  }
  for (const relation of AGGREGATION_PRIORITY) {
    if (found.has(relation)) return relation;
  }
  return 'mention';
}

function parseConditions(text: string): readonly Mechanics[] {
  const sentences = splitSentences(text);
  const out: Mechanics[] = [];
  for (const condition of CONDITION_NAMES) {
    if (new RegExp(`\\b${condition}\\b`, 'i').test(text)) {
      out.push({
        condition,
        relation: classifyConditionRelation(sentences, condition),
      });
    }
  }
  return out;
}

function parseAttack(text: string): Mechanics | undefined {
  const match =
    /\b(Melee|Ranged|Melee or Ranged) (Weapon|Spell) Attack:\s*([+-]\d+) to hit,\s*(.*?target.*?)\.\s*Hit:\s*([^.]*)\./i.exec(
      text,
    );
  if (match === null) return undefined;
  const reach = /\breach\s+(\d+)\s*ft\./i.exec(match[4]);
  const range = /\brange\s+(\d+)\/(\d+)\s*ft\./i.exec(match[4]);
  const target = /\b((?:one|two|three|\d+)[^.]*?targets?|one creature)\b/i.exec(
    match[4],
  );
  return compact({
    attackType: `${match[1].toLowerCase().replaceAll(' ', '-')}-${match[2].toLowerCase()}`,
    attackBonus: Number(match[3]),
    reachFeet: reach === null ? undefined : Number(reach[1]),
    rangeFeet:
      range === null
        ? undefined
        : { normal: Number(range[1]), long: Number(range[2]) },
    target: target?.[1].toLowerCase(),
    hitDamage: parseDamage(match[5]),
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
    concentration: /^Concentration,/i.test(spell.duration),
    spellAttack: /\b(?:ranged|melee) spell attack\b/i.test(text),
    saves: save === undefined ? undefined : [save],
    damage,
    weaponDamageModifiers,
    conditions,
    scaling,
  });
}

export function deriveActionMechanics(action: ActionExtraction): Mechanics {
  const attack = parseAttack(action.description);
  const save = parseSave(action.description);
  const damage = parseDamage(action.description);
  return compact({
    attacks: attack === undefined ? undefined : [attack],
    saves: save === undefined ? undefined : [save],
    damage,
    conditions: parseConditions(action.description),
  });
}

export function deriveCreatureEntryMechanics(
  name: string,
  text: string,
): Mechanics {
  const attack = parseAttack(text);
  const save = parseSave(text);
  return compact({
    attacks: attack === undefined ? undefined : [attack],
    recharge: parseRecharge(name),
    saves: save === undefined ? undefined : [save],
    damage: parseDamage(text),
    conditions: parseConditions(text),
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
