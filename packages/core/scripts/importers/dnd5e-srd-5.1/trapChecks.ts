/**
 * Printed trap ability checks and dispel-magic DCs (eshyra-o9bd.19.4.4.1,
 * opus:F-23). `deriveHazardMechanics` projects saves, damage, and conditions
 * only, so every printed non-save DC in a trap (detect, disarm, escape, pry,
 * slow, dispel) was silently dropped. This module projects each such sentence
 * as exactly one `mechanics.checks` / `mechanics.dispels` entry, values taken
 * verbatim from the sentence. It is projection only: resolving a detection or
 * disarm attempt stays DM-adjudicated.
 *
 * Fail closed: a DC-bearing sentence that is not a saving throw and matches
 * none of the printed shapes throws, so a new sibling cannot silently vanish.
 */
import type { SpellGrantResolver } from './mechanicsProjections.js';

type Obj = Record<string, unknown>;

const ABILITY =
  '(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)';
const SRD_SKILLS: ReadonlySet<string> = new Set([
  'acrobatics',
  'animal-handling',
  'arcana',
  'athletics',
  'deception',
  'history',
  'insight',
  'intimidation',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'performance',
  'persuasion',
  'religion',
  'sleight-of-hand',
  'stealth',
  'survival',
]);

// Shape 1/2: "DC N Ability [(Skill)] check [using thieves' tools]".
const ABILITY_CHECK = new RegExp(
  `\\bDC (\\d+) ${ABILITY}(?: \\(([A-Za-z ]+)\\))? check\\b( using thieves[’']? tools\\b)?`,
);
// Shape 3: no ability printed.
const SPOT_DC_LEAD = /^The DC to spot [^.]*? is (\d+)\.$/;
const SPOT_DC_TRAIL = /^The DC is (\d+) to spot [^.]*\.$/;
// Shape 4.
const DISPEL = /\bdispel magic \(DC (\d+)\)/;

/** Split prose into sentences; the SRD trap prose has no abbreviations. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** A printed DC that is not part of a saving throw. */
function isNonSaveDcSentence(sentence: string): boolean {
  return /\bDC\b/.test(sentence) && !/\bsaving throws?\b/i.test(sentence);
}

export interface TrapChecksProjection {
  readonly checks: Obj[];
  readonly dispels: Obj[];
}

/**
 * Project the non-save DC sentences of `text` in printed order. `where` names
 * the record for fail-closed diagnostics; `resolveSpell` resolves the printed
 * dispel spell name against the emitted spells and is required when a dispel
 * DC is printed.
 */
export function deriveTrapChecks(
  text: string,
  where: string,
  resolveSpell: SpellGrantResolver | undefined,
): TrapChecksProjection {
  const checks: Obj[] = [];
  const dispels: Obj[] = [];
  for (const sentence of splitSentences(text)) {
    if (!isNonSaveDcSentence(sentence)) continue;
    const dispel = DISPEL.exec(sentence);
    if (dispel !== null) {
      const spell = resolveSpell?.('dispel magic');
      if (spell === undefined) {
        throw new Error(
          `${where}: dispel magic does not resolve against the emitted spells`,
        );
      }
      dispels.push({ spell, dc: Number(dispel[1]), text: sentence });
      continue;
    }
    const check = ABILITY_CHECK.exec(sentence);
    if (check !== null) {
      const entry: Obj = {
        dc: Number(check[1]),
        ability: check[2].toLowerCase(),
      };
      if (check[3] !== undefined) {
        const skill = check[3].toLowerCase().replaceAll(' ', '-');
        if (!SRD_SKILLS.has(skill)) {
          throw new Error(
            `${where}: printed skill ${JSON.stringify(check[3])} is not an SRD skill`,
          );
        }
        entry.skill = skill;
      }
      if (check[4] !== undefined) entry.tool = 'thieves-tools';
      entry.text = sentence;
      checks.push(entry);
      continue;
    }
    const spot = SPOT_DC_LEAD.exec(sentence) ?? SPOT_DC_TRAIL.exec(sentence);
    if (spot !== null) {
      checks.push({ dc: Number(spot[1]), text: sentence });
      continue;
    }
    throw new Error(
      `${where}: DC sentence matches no known trap check shape: ${JSON.stringify(sentence)}`,
    );
  }
  return { checks, dispels };
}

const SPHERE_KEY = 'hazard:sphere-of-annihilation';
const VERSION_MARKER = 'Some versions of the trap include';
const QUALIFIER_RE = /^A successful DC \d+ [A-Za-z]+ \([A-Za-z ]+\) check /;
const IDENTICAL_RE = /^It is otherwise identical to a normal ([a-z ]+)\.$/;
const LIKE_SPELL_RE =
  /^This effect is otherwise like the ([a-z]+) aspect of the ([a-z/ ]+) spell\.$/;

export interface SphereProjection {
  /** Description before the optional-version span: record-level projection text. */
  readonly recordText: string;
  readonly identicalToRef: string;
  readonly identicalToText: string;
  readonly version: Obj;
}

/**
 * The Sphere of Annihilation trap prints (a) a check that reveals a real
 * sphere which is "otherwise identical" to the magic item and (b) an optional
 * enchantment "like" a spell, with its own dispel DC. Both are kept as typed
 * references plus verbatim text, never a copy of the item or spell projection.
 * Returns undefined for any other record; throws if the sphere's printed
 * structure changes.
 */
export function deriveSphereProjection(
  key: string,
  description: string,
  resolveSpell: SpellGrantResolver | undefined,
  itemKeyFor: (name: string) => string,
): SphereProjection | undefined {
  if (key !== SPHERE_KEY) return undefined;
  const at = description.indexOf(VERSION_MARKER);
  if (at < 0 || description.indexOf(VERSION_MARKER, at + 1) !== -1) {
    throw new Error(`${key}: "${VERSION_MARKER}" must appear exactly once`);
  }
  const recordText = description.slice(0, at).trim();
  const versionText = description.slice(at).trim();
  const sentences = splitSentences(recordText);
  const identicalAt = sentences.findIndex((s) => IDENTICAL_RE.test(s));
  const qualifier = sentences[identicalAt - 1];
  if (
    identicalAt < 1 ||
    qualifier === undefined ||
    !QUALIFIER_RE.test(qualifier)
  ) {
    throw new Error(
      `${key}: expected a check sentence before "otherwise identical"`,
    );
  }
  const identical = sentences[identicalAt];
  const itemName = IDENTICAL_RE.exec(identical)?.[1] as string;
  const versionSentences = splitSentences(versionText);
  if (versionSentences.length !== 3) {
    throw new Error(`${key}: expected three version sentences`);
  }
  const like = LIKE_SPELL_RE.exec(versionSentences[1]);
  const likeSpell = like === null ? undefined : resolveSpell?.(like[2]);
  if (like === null || likeSpell === undefined) {
    throw new Error(`${key}: version spell comparison does not resolve`);
  }
  const { dispels } = deriveTrapChecks(versionText, key, resolveSpell);
  if (dispels.length !== 1) {
    throw new Error(`${key}: expected exactly one version dispel`);
  }
  return {
    recordText,
    identicalToRef: itemKeyFor(itemName),
    identicalToText: `${qualifier} ${identical}`,
    version: {
      text: versionText,
      likeSpellRef: likeSpell,
      likeSpellAspect: like[1],
      mechanics: { dispels },
    },
  };
}
