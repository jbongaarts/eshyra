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
    out.push(
      compact({
        average: match[1] === undefined ? undefined : Number(match[1]),
        dice: match[2].replace(/\s+/g, ' '),
        type: match[3].toLowerCase(),
      }),
    );
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

function parseConditions(text: string): readonly Mechanics[] {
  const out: Mechanics[] = [];
  for (const condition of [
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
  ]) {
    if (new RegExp(`\\b${condition}\\b`, 'i').test(text)) {
      out.push({ condition });
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
