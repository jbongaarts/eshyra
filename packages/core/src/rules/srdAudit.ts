/**
 * Structure-aware, SRD-specific audit checks for generated D&D 5e SRD rules
 * packs.
 *
 * The generic `auditPack` in `audit.ts` is deliberately system-agnostic: it
 * catches empty/blank fields, all-uppercase names, and partially-populated
 * optional fields. Those heuristics are necessary but not sufficient. The
 * 2026-06-07 manual SRD audit (eshyra-0m9.24) found a class of parser failures
 * that pass both `validateRulesPack` and `auditPack` because the records are
 * structurally well-formed — the *content* is contaminated by adjacent source
 * material:
 *
 *   - Class proficiency arrays carrying whole class-progression table rows and
 *     feature prose instead of clean proficiency tokens.
 *   - Feature bodies carrying the class header's "Armor:/Weapons:/Tools:/
 *     Saving Throws:/Skills:" proficiency setup block.
 *   - Subclass/feature descriptions that swallow the headings and bodies of the
 *     adjacent features that should be their own records.
 *   - Ancestry traits whose names are line-wrap fragments of the Languages line
 *     (e.g. "Common and Draconic", "Ancestry table") or whose bodies are
 *     truncated mid-phrase or carry a bled-in table.
 *
 * The checks here are SRD-shaped heuristics that turn those failure modes into
 * actionable findings. They are review prompts, not validation errors: a finding
 * names the offending record, field, and the substring that tripped the check so
 * a reviewer (or the importer fix beads eshyra-0m9.12..16) can act on it.
 *
 * Coverage (`auditSrdCoverage`) is the second half: a structurally clean pack
 * can still be *missing* records the source contains (the manual audit found the
 * Orb of Dragonkind magic item absent, plus unrepresented sections/tables).
 * Coverage takes an explicit expectations object so the caller supplies the
 * authoritative name/key sets; this module stays free of giant literal lists.
 *
 * Everything is pure and deterministic: findings are sorted so reports are
 * diffable across runs. SRD-specific knowledge lives here, never in `audit.ts`.
 */

import {
  classifyConditionRelation,
  splitConditionSentences,
} from './conditionRelations.js';
import type { RulesPack, RulesRecord } from './types.js';

// ---------------------------------------------------------------------------
// Finding model
// ---------------------------------------------------------------------------

export type SrdAuditCategory =
  | 'class-proficiency-bleed'
  | 'feature-setup-label-bleed'
  | 'swallowed-feature-heading'
  | 'ancestry-bogus-trait'
  | 'ancestry-unlinked-table'
  | 'spell-table-link'
  | 'table-owner-link'
  | 'table-reachability'
  | 'reference-integrity'
  | 'creature-stat-block-prose-bleed'
  | 'spell-concentration-flag'
  | 'creature-cr-xp'
  | 'condition-relation-safety'
  | 'missing-coverage';

export interface SrdAuditFinding {
  readonly category: SrdAuditCategory;
  /** Owning record key, or a synthetic `coverage:<kind>:<slug>` for coverage gaps. */
  readonly key: string;
  readonly kind: string;
  readonly name: string;
  /** Actionable description naming the field and offending substring. */
  readonly detail: string;
}

export interface SrdStructureAudit {
  readonly packId: string;
  readonly findings: readonly SrdAuditFinding[];
}

/**
 * Authoritative expectations for `auditSrdCoverage`. The caller supplies the
 * name/key sets (today: the importer's `EXPECTED_SRD_5_1_*` constants). Names
 * are matched case-insensitively within a kind; keys are matched exactly.
 */
export interface SrdCoverageExpectations {
  /** kind -> record names that MUST be present in that kind. */
  readonly requiredNamesByKind?: Readonly<Record<string, readonly string[]>>;
  /** record keys that MUST be present regardless of kind. */
  readonly requiredKeys?: readonly string[];
}

/**
 * Reviewed ownership map for tables embedded in SRD spell descriptions
 * (eshyra-o4j7). Shared with importer enrichment so audit and generation cannot
 * drift on the expected spell/table relationship.
 */
export const SRD_5_1_SPELL_TABLE_OWNERS: Readonly<Record<string, string>> =
  Object.freeze({
    'table:animated-object-statistics': 'spell:animate-objects',
    'table:confusion-behavior': 'spell:confusion',
    'table:creation-material-duration': 'spell:creation',
    'table:precipitation': 'spell:control-weather',
    'table:reincarnate-race': 'spell:reincarnate',
    'table:scrying-save-modifiers': 'spell:scrying',
    'table:teleport-familiarity': 'spell:teleport',
    'table:temperature': 'spell:control-weather',
    'table:wind': 'spell:control-weather',
  });

// Non-spell table ownership (eshyra-o9bd.8). Each entry links a `table` record
// to the single record whose entry the table belongs to, so an option/variant
// table is reachable from its owner via `owner.data.tableRefs`. Reviewed map,
// grown one slice per child bead:
//   - eshyra-o9bd.8.1: magic-item variant/effect tables and the clean 1:1
//     `rule:*` economy/reference tables (this map).
//   - eshyra-o9bd.8.2/.8.3 extend it (rule/background/subclass owners) and add
//     the standalone-allowlist completeness gate.
// A table appears at most once; one owner may own several tables (Cube of Force,
// Bag of Tricks). The `table-owner-link` audit enforces the relationship.
export const SRD_5_1_TABLE_OWNERS: Readonly<Record<string, string>> =
  Object.freeze({
    // Magic-item variant / effect tables.
    'table:apparatus-of-the-crab-levers': 'magic-item:apparatus-of-the-crab',
    'table:armor-of-resistance': 'magic-item:armor-of-resistance',
    'table:bag-of-beans': 'magic-item:bag-of-beans',
    'table:belt-of-giant-strength': 'magic-item:belt-of-giant-strength',
    'table:candle-of-invocation': 'magic-item:candle-of-invocation',
    'table:carpet-of-flying': 'magic-item:carpet-of-flying',
    'table:cube-of-force-charges-lost': 'magic-item:cube-of-force',
    'table:cube-of-force-faces': 'magic-item:cube-of-force',
    'table:deck-of-illusions': 'magic-item:deck-of-illusions',
    'table:deck-of-many-things': 'magic-item:deck-of-many-things',
    'table:dragon-scale-mail': 'magic-item:dragon-scale-mail',
    'table:efreeti-bottle': 'magic-item:efreeti-bottle',
    'table:elemental-gem': 'magic-item:elemental-gem',
    'table:feather-token': 'magic-item:feather-token',
    'table:gray-bag-of-tricks': 'magic-item:bag-of-tricks',
    'table:rust-bag-of-tricks': 'magic-item:bag-of-tricks',
    'table:tan-bag-of-tricks': 'magic-item:bag-of-tricks',
    'table:horn-of-valhalla': 'magic-item:horn-of-valhalla',
    'table:iron-flask': 'magic-item:iron-flask',
    'table:manual-of-golems': 'magic-item:manual-of-golems',
    'table:necklace-of-prayer-beads': 'magic-item:necklace-of-prayer-beads',
    'table:potion-of-giant-strength': 'magic-item:potion-of-giant-strength',
    'table:potion-of-resistance': 'magic-item:potion-of-resistance',
    'table:potions-of-healing': 'magic-item:potion-of-healing',
    'table:ring-of-resistance': 'magic-item:ring-of-resistance',
    'table:ring-of-shooting-stars': 'magic-item:ring-of-shooting-stars',
    'table:robe-of-useful-items': 'magic-item:robe-of-useful-items',
    'table:spell-scroll': 'magic-item:spell-scroll',
    'table:sphere-of-annihilation': 'magic-item:sphere-of-annihilation',
    'table:staff-of-power': 'magic-item:staff-of-power',
    'table:staff-of-the-magi': 'magic-item:staff-of-the-magi',
    'table:wand-of-wonder': 'magic-item:wand-of-wonder',
    // Clean 1:1 economy / reference rule owners.
    'table:ability-scores-and-modifiers': 'rule:ability-scores-and-modifiers',
    'table:food-drink-and-lodging': 'rule:food-drink-and-lodging',
    'table:lifestyle-expenses': 'rule:lifestyle-expenses',
    'table:services': 'rule:services',
    'table:trade-goods': 'rule:trade-goods',
    // eshyra-o9bd.8.2 — rule / background / feature owners resolved by SRD page
    // + prose. Multiclassing (p. 56-58): the prerequisites/proficiencies rules
    // name their table verbatim ("as shown in the Multiclassing … table").
    'table:multiclassing-prerequisites': 'rule:prerequisites',
    'table:multiclassing-proficiencies': 'rule:proficiencies',
    'table:multiclass-spellcaster-spell-slots-per-spell-level':
      'rule:spellcasting',
    // Character Advancement (p. 56) is named verbatim by the Experience Points
    // rule ("as shown in the Character Advancement table"); that rule owns it.
    'table:character-advancement': 'rule:experience-points',
    // Creating Spell Slots (p. 43) is the Sorcerer Font of Magic conversion
    // table.
    'table:creating-spell-slots': 'feature:sorcerer:font-of-magic',
    // Objects (p. 203): both object tables belong to the Objects rule.
    'table:object-armor-class': 'rule:objects',
    'table:object-hit-points': 'rule:objects',
    // Madness (p. 201-202): the Madness Effects rule introduces all three.
    'table:short-term-madness': 'rule:madness-effects',
    'table:long-term-madness': 'rule:madness-effects',
    'table:indefinite-madness': 'rule:madness-effects',
    // Sentient magic items (p. 251-252): each "roll on the following table"
    // rule owns its table.
    'table:sentient-magic-item-alignment':
      'rule:creating-sentient-magic-items-alignment',
    'table:sentient-magic-item-senses':
      'rule:creating-sentient-magic-items-senses',
    'table:sentient-magic-item-communication': 'rule:communication',
    'table:sentient-magic-item-special-purpose': 'rule:special-purpose',
    // Acolyte suggested-characteristics roll tables (p. 61) belong to the
    // Acolyte background.
    'table:acolyte-bonds': 'background:acolyte',
    'table:acolyte-flaws': 'background:acolyte',
    'table:acolyte-ideals': 'background:acolyte',
    'table:acolyte-personality-traits': 'background:acolyte',
    // Sorcerer Draconic Bloodline dragon-type table (p. 44) belongs to the
    // Dragon Ancestor feature that selects from it.
    'table:draconic-bloodline-draconic-ancestry':
      'feature:draconic-bloodline:dragon-ancestor',
    // eshyra-o9bd.8.3 — remaining section-owned reference tables, each resolved
    // by SRD page + prose to the single rule whose section prints it.
    'table:celtic-deities': 'rule:the-celtic-pantheon', // p. 360
    'table:egyptian-deities': 'rule:the-egyptian-pantheon', // p. 360
    'table:greek-deities': 'rule:the-greek-pantheon', // p. 360
    'table:norse-deities': 'rule:the-norse-pantheon', // p. 360
    'table:standard-languages': 'rule:languages', // p. 59 Languages section
    'table:exotic-languages': 'rule:languages', // p. 59 Languages section
    'table:standard-exchange-rates': 'rule:coinage', // p. 62
    'table:donning-and-doffing-armor': 'rule:getting-into-and-out-of-armor', // p. 64
    'table:difficulty-classes': 'rule:ability-checks', // p. 77 Typical DCs
    'table:travel-pace': 'rule:speed', // p. 84, names "the Travel Pace table"
    'table:damage-severity-by-level': 'rule:trap-effects', // p. 196
    'table:trap-save-dcs-and-attack-bonuses': 'rule:trap-effects', // p. 196
    'table:hit-dice-by-size': 'rule:hit-points', // p. 255, names "Hit Dice by Size"
    'table:size-categories': 'rule:size', // p. 254, names "the Size Categories table"
    'table:experience-points-by-challenge-rating':
      'rule:challenge-experience-points', // p. 258
  });

// Tables that are deliberately ownerless: cross-cutting reference tables
// consulted directly from multiple rules rather than belonging to one entry, so
// the `table-reachability` completeness gate (eshyra-o9bd.8.3) does not require
// an owner link. Keep this list minimal and justified.
export const SRD_5_1_STANDALONE_TABLES: ReadonlySet<string> = new Set([
  // CR -> proficiency bonus monster-statistics reference (p. 256). Consulted by
  // both rule:monsters-saving-throws and rule:monsters-skills; no single owner.
  'table:proficiency-bonus-by-challenge-rating',
]);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function dataObject(record: RulesRecord): Record<string, unknown> | null {
  const data = record.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  return data as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function snippet(text: string, max = 80): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max)}…`;
}

function sortFindings(
  findings: readonly SrdAuditFinding[],
): readonly SrdAuditFinding[] {
  return [...findings].sort((a, b) => {
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    if (a.key !== b.key) return a.key < b.key ? -1 : 1;
    return a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Class proficiency table-row / prose bleed
// ---------------------------------------------------------------------------

const PROFICIENCY_FIELDS = [
  'armorProficiencies',
  'weaponProficiencies',
  'savingThrowProficiencies',
  'toolProficiencies',
  'skillProficiencies',
  'primaryAbilities',
] as const;

// A clean proficiency token is a short noun phrase ("Light armor", "Simple
// weapons", "Strength"). The signals below mark a token that has absorbed a
// class progression table row or feature prose.
const LEVEL_ORDINAL = /\b\d{1,2}(?:st|nd|rd|th)\b/;
const PROFICIENCY_BONUS_CELL = /(?:^|\s)\+\d\b/;
const PROGRESSION_TABLE_HEADER =
  /\b(?:Proficiency Bonus|Features Known|Cantrips Known|Spells Known|Spell Slots|Sorcery Points|Ki Points|Rage Damage|Sneak Attack|Martial Arts|Invocations Known|Bonus Features)\b/i;
const PROFICIENCY_TOKEN_MAX_LEN = 40;

function proficiencyBleedReasons(token: string): string[] {
  const reasons: string[] = [];
  if (LEVEL_ORDINAL.test(token)) {
    reasons.push('contains a class-table level ordinal (e.g. "1st", "2nd")');
  }
  if (PROFICIENCY_BONUS_CELL.test(token)) {
    reasons.push('contains a proficiency-bonus table cell (e.g. "+2")');
  }
  if (PROGRESSION_TABLE_HEADER.test(token)) {
    reasons.push('contains a class-progression table header');
  }
  if (token.length > PROFICIENCY_TOKEN_MAX_LEN) {
    reasons.push(
      `is ${token.length} chars long (a clean proficiency token is short)`,
    );
  }
  return reasons;
}

function checkClassProficiencyBleed(record: RulesRecord): SrdAuditFinding[] {
  if (record.kind !== 'class') return [];
  const data = dataObject(record);
  if (data === null) return [];
  const findings: SrdAuditFinding[] = [];
  for (const field of PROFICIENCY_FIELDS) {
    const value = data[field];
    if (!Array.isArray(value)) continue;
    value.forEach((entry, index) => {
      const token = asString(entry);
      if (token === null) return;
      const reasons = proficiencyBleedReasons(token);
      if (reasons.length === 0) return;
      findings.push({
        category: 'class-proficiency-bleed',
        key: record.key,
        kind: record.kind,
        name: record.name,
        detail: `data.${field}[${index}] ${reasons.join('; ')}: "${snippet(token)}"`,
      });
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Class setup labels inside feature bodies
// ---------------------------------------------------------------------------

// The class header's proficiency setup block uses these "Label:" prefixes.
// None of them belong in a feature body; their presence means the header bled
// into the feature record. "Saving Throws:", "Skills:", and "Tools:" are
// effectively never legitimate feature prose, so a single occurrence is enough.
const SETUP_LABEL = /\b(Armor|Weapons|Tools|Saving Throws|Skills):/g;

function checkFeatureSetupLabelBleed(record: RulesRecord): SrdAuditFinding[] {
  if (record.kind !== 'feature') return [];
  const data = dataObject(record);
  if (data === null) return [];
  const description = asString(data.description);
  if (description === null) return [];
  const labels = new Set<string>();
  for (const match of description.matchAll(SETUP_LABEL)) {
    labels.add(match[1]);
  }
  if (labels.size === 0) return [];
  return [
    {
      category: 'feature-setup-label-bleed',
      key: record.key,
      kind: record.kind,
      name: record.name,
      detail: `data.description carries class setup label(s) ${[...labels]
        .sort()
        .map((l) => `"${l}:"`)
        .join(', ')} — the class header bled into this feature`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Swallowed adjacent feature headings
// ---------------------------------------------------------------------------

// A feature grant lead-in phrase. The parser uses these to locate where one
// feature ends and the next begins, so several of them inside a single record's
// description means adjacent features were swallowed.
const GRANT_LEAD_IN =
  /(?:Beginning at|Starting at|Beginning when you|When you reach\s+\d{1,2}(?:st|nd|rd|th)\s+level|At\s+\d{1,2}(?:st|nd|rd|th)\s+level)/g;

// A Title-Case heading (1-5 words) immediately followed by a grant lead-in:
// "Remarkable Athlete Starting at 7th level", "Survivor At 18th level". The
// capture is the swallowed feature's heading.
//
// The negative lookbehind excludes the spellcasting sub-heading "Spells Known
// of Nth Level and Higher", whose body opens "At 1st level, you know …". There
// the capture would be the lone Title-Case word "Higher" (preceded by the
// lowercase "and"), and the following "At 1st level" is the sub-section's body,
// not a swallowed feature grant — a false positive (eshyra-tzl).
const HEADING_GRANT_PAIR =
  /(?<!Level and )([A-Z][\w'’]+(?:\s+[A-Z][\w'’]+){0,4})\s+(?:Beginning at|Starting at|Beginning when you|When you reach\s+\d{1,2}(?:st|nd|rd|th)\s+level|At\s+\d{1,2}(?:st|nd|rd|th)\s+level)/g;

function swallowedHeadings(description: string): string[] {
  const headings: string[] = [];
  for (const match of description.matchAll(HEADING_GRANT_PAIR)) {
    headings.push(match[1].trim());
  }
  return headings;
}

const ALLOWED_SPELLCASTING_SUBSECTION_HEADINGS: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map([
  ['feature:cleric:spellcasting', new Set(['Cantrips'])],
  ['feature:druid:spellcasting', new Set(['Cantrips'])],
  ['feature:sorcerer:spellcasting', new Set(['Cantrips'])],
  ['feature:wizard:spellcasting', new Set(['Cantrips', 'Spellbook'])],
]);

function allowedSwallowedHeading(recordKey: string, heading: string): boolean {
  return (
    ALLOWED_SPELLCASTING_SUBSECTION_HEADINGS.get(recordKey)?.has(heading) ===
    true
  );
}

function countLeadIns(description: string): number {
  return [...description.matchAll(GRANT_LEAD_IN)].length;
}

function checkSwallowedFeatures(record: RulesRecord): SrdAuditFinding[] {
  if (record.kind !== 'feature' && record.kind !== 'subclass') return [];
  const data = dataObject(record);
  if (data === null) return [];
  const description = asString(data.description);
  if (description === null) return [];

  const headings = swallowedHeadings(description).filter(
    (heading) => !allowedSwallowedHeading(record.key, heading),
  );
  const leadIns = countLeadIns(description);

  // A subclass blurb should describe the archetype and grant nothing inline, so
  // any heading-grant pair (or two bare lead-ins) means features were swallowed.
  // A standalone feature naturally contains at most its own single lead-in, so
  // a Title-Case-heading-plus-lead-in pair is the swallow signal there too.
  const triggered =
    headings.length > 0 || (record.kind === 'subclass' && leadIns >= 2);
  if (!triggered) return [];

  const headingNote =
    headings.length > 0
      ? `swallowed feature heading(s): ${headings.map((h) => `"${h}"`).join(', ')}`
      : `${leadIns} feature grant lead-ins in one description`;
  return [
    {
      category: 'swallowed-feature-heading',
      key: record.key,
      kind: record.kind,
      name: record.name,
      detail: `data.description appears to absorb adjacent features — ${headingNote}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Ancestry bogus / wrapped traits
// ---------------------------------------------------------------------------

interface AncestryTrait {
  readonly name: string;
  readonly text: string;
  readonly tableRefs: readonly string[];
}

function readAncestryTraits(record: RulesRecord): AncestryTrait[] {
  const data = dataObject(record);
  if (data === null) return [];
  const traits = data.traits;
  if (!Array.isArray(traits)) return [];
  const out: AncestryTrait[] = [];
  for (const entry of traits) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const obj = entry as Record<string, unknown>;
    const name = asString(obj.name);
    const text = asString(obj.text);
    if (name === null) continue;
    const tableRefs = Array.isArray(obj.tableRefs)
      ? obj.tableRefs.filter((r): r is string => typeof r === 'string')
      : [];
    out.push({ name, text: text ?? '', tableRefs });
  }
  return out;
}

// A lowercase function word inside a trait NAME means the "heading" is really a
// wrapped line fragment ("Common and Draconic", "Ancestry table").
const TRAIT_NAME_FRAGMENT = /\b(?:and|or|the|of|by|with|table)\b/;
const TERMINAL_PUNCTUATION = /[.!?:)”"']$/;
// The breath-weapon / similar tables bleed in as repeated "(... save)" cells.
const TABLE_SAVE_CELL = /\bsave\)/gi;
// A prose reference to a printed option table ("the Draconic Ancestry table").
// A trait that names one must link it via `tableRefs` so the option rows are
// reachable as structured data, not prose only (eshyra-4a7.7).
const TRAIT_TABLE_REFERENCE =
  /\bthe\s+[A-Z][A-Za-z'’/()&-]*(?:\s+[A-Z][A-Za-z'’/()&-]*)*\s+table\b/;

function checkAncestryTraits(record: RulesRecord): SrdAuditFinding[] {
  if (record.kind !== 'ancestry') return [];
  const traits = readAncestryTraits(record);
  const findings: SrdAuditFinding[] = [];
  traits.forEach((trait, index) => {
    const reasons: string[] = [];
    if (TRAIT_NAME_FRAGMENT.test(trait.name)) {
      reasons.push(
        `trait name "${trait.name}" looks like a wrapped line fragment, not a heading`,
      );
    }
    const trimmedText = trait.text.trim();
    if (trimmedText.length > 0 && !TERMINAL_PUNCTUATION.test(trimmedText)) {
      reasons.push(
        `trait body is truncated mid-phrase (ends "…${snippet(trimmedText.slice(-40), 40)}")`,
      );
    }
    if ([...trimmedText.matchAll(TABLE_SAVE_CELL)].length >= 2) {
      reasons.push('trait body has a bled-in table (repeated "save)" cells)');
    }
    if (reasons.length === 0) return;
    findings.push({
      category: 'ancestry-bogus-trait',
      key: record.key,
      kind: record.kind,
      name: record.name,
      detail: `data.traits[${index}] (${trait.name}): ${reasons.join('; ')}`,
    });
  });
  return findings;
}

function checkAncestryUnlinkedTable(record: RulesRecord): SrdAuditFinding[] {
  if (record.kind !== 'ancestry') return [];
  const findings: SrdAuditFinding[] = [];
  readAncestryTraits(record).forEach((trait, index) => {
    if (!TRAIT_TABLE_REFERENCE.test(trait.text)) return;
    if (trait.tableRefs.length > 0) return;
    findings.push({
      category: 'ancestry-unlinked-table',
      key: record.key,
      kind: record.kind,
      name: record.name,
      detail: `data.traits[${index}] (${trait.name}): prose references an option table but the trait has no tableRefs link`,
    });
  });
  return findings;
}

// ---------------------------------------------------------------------------
// Spell-embedded table linkage
// ---------------------------------------------------------------------------

function spellTableRefs(record: RulesRecord): readonly string[] {
  if (record.kind !== 'spell') return [];
  const data = dataObject(record);
  if (data === null || !Array.isArray(data.tableRefs)) return [];
  return data.tableRefs.filter(
    (entry): entry is string => typeof entry === 'string',
  );
}

function checkSpellTableLinks(pack: RulesPack): SrdAuditFinding[] {
  const findings: SrdAuditFinding[] = [];
  const recordsByKey = new Map(
    pack.records.map((record) => [record.key, record]),
  );
  const referrers = new Map<string, string[]>();

  for (const record of pack.records) {
    if (record.kind !== 'spell') continue;
    for (const ref of spellTableRefs(record)) {
      const target = recordsByKey.get(ref);
      if (target === undefined || target.kind !== 'table') {
        findings.push({
          category: 'spell-table-link',
          key: record.key,
          kind: record.kind,
          name: record.name,
          detail: `data.tableRefs points to missing table record ${ref}`,
        });
      }
      const owners = referrers.get(ref) ?? [];
      owners.push(record.key);
      referrers.set(ref, owners);
    }
  }

  for (const [tableKey, expectedOwnerKey] of Object.entries(
    SRD_5_1_SPELL_TABLE_OWNERS,
  )) {
    const table = recordsByKey.get(tableKey);
    const owner = recordsByKey.get(expectedOwnerKey);
    // Reduced fixtures and partial packs may omit this entire source region.
    // Once either side is present, enforce the complete reviewed relationship.
    if (table === undefined && owner === undefined) continue;
    if (table === undefined || table.kind !== 'table') {
      findings.push({
        category: 'spell-table-link',
        key: expectedOwnerKey,
        kind: 'spell',
        name: expectedOwnerKey,
        detail: `expected embedded table record ${tableKey} is missing`,
      });
      continue;
    }
    const actualOwners = referrers.get(tableKey) ?? [];
    if (owner === undefined || owner.kind !== 'spell') {
      findings.push({
        category: 'spell-table-link',
        key: expectedOwnerKey,
        kind: 'spell',
        name: expectedOwnerKey,
        detail: `expected owner for ${tableKey} is missing`,
      });
      continue;
    }
    if (actualOwners.length !== 1 || actualOwners[0] !== expectedOwnerKey) {
      findings.push({
        category: 'spell-table-link',
        key: expectedOwnerKey,
        kind: 'spell',
        name: owner.name,
        detail: `${tableKey} must be referenced exactly once by ${expectedOwnerKey}; actual owners: ${actualOwners.join(', ') || 'none'}`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Non-spell owner-table linkage (eshyra-o9bd.8)
// ---------------------------------------------------------------------------

function tableRefsOf(record: RulesRecord): readonly string[] {
  const data = dataObject(record);
  if (data === null || !Array.isArray(data.tableRefs)) return [];
  return data.tableRefs.filter(
    (entry): entry is string => typeof entry === 'string',
  );
}

// Enforce the reviewed SRD_5_1_TABLE_OWNERS map: every owned table is reachable
// from exactly its mapped owner via `owner.data.tableRefs`, and no other record
// claims it. Mirrors `checkSpellTableLinks`; tolerates reduced fixtures that
// omit both sides of a relationship.
function checkTableOwnerLinks(pack: RulesPack): SrdAuditFinding[] {
  const findings: SrdAuditFinding[] = [];
  const recordsByKey = new Map(
    pack.records.map((record) => [record.key, record]),
  );

  // Which records reference each table (across every kind that carries
  // tableRefs), so we can detect a table owned by an unexpected record.
  const referrers = new Map<string, string[]>();
  for (const record of pack.records) {
    for (const ref of tableRefsOf(record)) {
      const owners = referrers.get(ref) ?? [];
      owners.push(record.key);
      referrers.set(ref, owners);
    }
  }

  for (const [tableKey, expectedOwnerKey] of Object.entries(
    SRD_5_1_TABLE_OWNERS,
  )) {
    const table = recordsByKey.get(tableKey);
    const owner = recordsByKey.get(expectedOwnerKey);
    // Reduced fixtures may omit this whole source region; once either side is
    // present, enforce the complete reviewed relationship.
    if (table === undefined && owner === undefined) continue;
    if (table === undefined || table.kind !== 'table') {
      findings.push({
        category: 'table-owner-link',
        key: expectedOwnerKey,
        kind: 'table',
        name: tableKey,
        detail: `expected owned table record ${tableKey} is missing`,
      });
      continue;
    }
    if (owner === undefined) {
      findings.push({
        category: 'table-owner-link',
        key: expectedOwnerKey,
        kind: 'table',
        name: tableKey,
        detail: `expected owner ${expectedOwnerKey} for ${tableKey} is missing`,
      });
      continue;
    }
    const actualOwners = referrers.get(tableKey) ?? [];
    if (actualOwners.length !== 1 || actualOwners[0] !== expectedOwnerKey) {
      findings.push({
        category: 'table-owner-link',
        key: expectedOwnerKey,
        kind: owner.kind,
        name: owner.name,
        detail: `${tableKey} must be referenced exactly once by ${expectedOwnerKey}; actual owners: ${actualOwners.join(', ') || 'none'}`,
      });
    }
  }

  return findings;
}

// Every emitted `table` record must be reachable: referenced by some record's
// link field (`tableRefs` / `spellTableRefs` / `progressionTableRef`, including
// ancestry-trait links) or explicitly allow-listed as a deliberately ownerless
// reference table (`SRD_5_1_STANDALONE_TABLES`). A new orphan table — emitted
// but unreachable and unclassified — is the failure this gate exists to catch
// (eshyra-o9bd.8). The gate only inspects tables actually present, so reduced
// fixtures and partial packs are unaffected; the committed-pack test separately
// asserts every allow-list entry is still an emitted table so it cannot rot.
function checkTableReachability(pack: RulesPack): SrdAuditFinding[] {
  const findings: SrdAuditFinding[] = [];
  const referenced = new Set<string>();
  for (const record of pack.records) {
    const data = dataObject(record);
    if (data === null) continue;
    for (const ref of tableRefsOf(record)) referenced.add(ref);
    if (Array.isArray(data.spellTableRefs)) {
      for (const ref of data.spellTableRefs) {
        if (typeof ref === 'string') referenced.add(ref);
      }
    }
    if (typeof data.progressionTableRef === 'string') {
      referenced.add(data.progressionTableRef);
    }
    // Plural subclass progression-table links (eshyra-o9bd.10). No subclass
    // populates `progressionTableRefs` in the committed pack today, but if a
    // future importer change links a table solely via this field the table must
    // still count as reachable — otherwise this gate would wrongly flag it as an
    // orphan.
    if (Array.isArray(data.progressionTableRefs)) {
      for (const ref of data.progressionTableRefs) {
        if (typeof ref === 'string') referenced.add(ref);
      }
    }
    if (Array.isArray(data.traits)) {
      for (const trait of data.traits) {
        const traitRefs =
          trait !== null &&
          typeof trait === 'object' &&
          Array.isArray((trait as { tableRefs?: unknown }).tableRefs)
            ? (trait as { tableRefs: unknown[] }).tableRefs
            : [];
        for (const ref of traitRefs) {
          if (typeof ref === 'string') referenced.add(ref);
        }
      }
    }
  }

  for (const record of pack.records) {
    if (record.kind !== 'table') continue;
    if (referenced.has(record.key) || SRD_5_1_STANDALONE_TABLES.has(record.key))
      continue;
    findings.push({
      category: 'table-reachability',
      key: record.key,
      kind: 'table',
      name: record.name,
      detail: `table ${record.key} is not reachable from any owner and is not in the deliberately-standalone allow-list`,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Cross-record reference integrity (eshyra-o9bd.10)
// ---------------------------------------------------------------------------

// A record key is `<kind>:<slug>` with a lowercase/dash prefix. This
// distinguishes a genuine cross-record reference from a free-text `source`
// label like "SRD 5.1 p. 5" (uppercase + space, no leading-lowercase colon).
function isRecordKey(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z-]*:/.test(value);
}

// The data fields that hold record-key references, with the record kind(s) the
// target must be. Reachability of the table side is also covered by
// `table-reachability` (orphan tables); this gate checks the OTHER direction —
// every outbound reference resolves to an existing record of the right kind, so
// a dangling or mis-kinded link is caught at its source (eshyra-o9bd.10).
const REFERENCE_FIELDS: ReadonlyArray<{
  readonly field: string;
  readonly array: boolean;
  readonly targets: readonly string[];
}> = [
  { field: 'tableRefs', array: true, targets: ['table'] },
  { field: 'spellTableRefs', array: true, targets: ['table'] },
  { field: 'progressionTableRef', array: false, targets: ['table'] },
  { field: 'progressionTableRefs', array: true, targets: ['table'] },
  { field: 'features', array: true, targets: ['feature'] },
  { field: 'subraces', array: true, targets: ['ancestry'] },
  { field: 'subraceOf', array: false, targets: ['ancestry'] },
  { field: 'parentClass', array: false, targets: ['class'] },
  { field: 'statBlockRefs', array: true, targets: ['stat-block'] },
  // `feature.data.source` is the grantor key (class/subclass); other kinds'
  // `data.source` is either absent or a free-text label, filtered by isRecordKey.
  { field: 'source', array: false, targets: ['class', 'subclass'] },
];

interface OutboundRef {
  readonly ref: string;
  readonly targets: readonly string[];
  readonly field: string;
}

// Collect every outbound record-key reference a record makes, across the flat
// link fields plus the two nested graphs: `choices[].from` subclass options
// (eshyra-o9bd.9) and `progression[].advancement[]` feature grants/improvements
// (eshyra-o9bd.2). Free-text `from` restrictions and prose are skipped via
// isRecordKey.
function outboundReferences(record: RulesRecord): OutboundRef[] {
  const data = dataObject(record);
  if (data === null) return [];
  const refs: OutboundRef[] = [];
  const push = (ref: unknown, targets: readonly string[], field: string) => {
    if (isRecordKey(ref)) refs.push({ ref, targets, field });
  };

  for (const spec of REFERENCE_FIELDS) {
    const value = data[spec.field];
    if (spec.array) {
      if (Array.isArray(value)) {
        for (const entry of value) push(entry, spec.targets, spec.field);
      }
    } else {
      push(value, spec.targets, spec.field);
    }
  }

  if (Array.isArray(data.choices)) {
    data.choices.forEach((choice, choiceIndex) => {
      const c = choice as {
        from?: unknown;
        category?: unknown;
        options?: unknown;
      } | null;
      const inlineOptionIds = new Set<string>();
      if (Array.isArray(c?.options)) {
        for (const option of c.options) {
          const id = (option as { id?: unknown } | null)?.id;
          if (typeof id === 'string') inlineOptionIds.add(id);
        }
      }
      const from = c?.from;
      if (Array.isArray(from)) {
        // A feature's subclass choice lists `subclass:` option keys; an
        // ancestry cantrip choice (eshyra-ngcj.5) lists `spell:` cantrip keys.
        // Other categories (tool/skill) list free-text labels, skipped by
        // isRecordKey.
        const targets = c?.category === 'cantrip' ? ['spell'] : ['subclass'];
        for (const entry of from) {
          if (typeof entry === 'string' && inlineOptionIds.has(entry)) continue;
          push(entry, targets, 'choices[].from');
        }
      }
      // Structured prerequisite clauses on inline options (eshyra-o9bd.18.4):
      // `level.classRef` and `pactBoon.featureRef` are record keys; a
      // `cantrip.ref` is a spell key. A `pactBoon.ref` is an inline option id,
      // not a record key — its resolution (including that `featureRef`'s own
      // choices actually offer it) is the `unresolvable-inline-option-ref`
      // gate in srdPlayabilityAudit.ts. Field labels carry the full JSON path
      // so a dangling nested ref is locatable directly.
      if (!Array.isArray(c?.options)) return;
      c.options.forEach((option, optionIndex) => {
        const prerequisites = (option as { prerequisites?: unknown } | null)
          ?.prerequisites;
        if (!Array.isArray(prerequisites)) return;
        prerequisites.forEach((clauseValue, clauseIndex) => {
          const clause = clauseValue as {
            kind?: unknown;
            classRef?: unknown;
            featureRef?: unknown;
            ref?: unknown;
          } | null;
          const at = `choices[${choiceIndex}].options[${optionIndex}].prerequisites[${clauseIndex}]`;
          if (clause?.kind === 'level') {
            push(clause.classRef, ['class'], `${at}.classRef`);
          } else if (clause?.kind === 'pactBoon') {
            push(clause.featureRef, ['feature'], `${at}.featureRef`);
          } else if (clause?.kind === 'cantrip') {
            push(clause.ref, ['spell'], `${at}.ref`);
          }
        });
      });
    });
  }

  if (Array.isArray(data.progression)) {
    for (const row of data.progression) {
      const advancement = (row as { advancement?: unknown } | null)
        ?.advancement;
      if (!Array.isArray(advancement)) continue;
      for (const entry of advancement) {
        const adv = entry as {
          kind?: unknown;
          ref?: unknown;
          targetRefs?: unknown;
        };
        if (adv.kind === 'featureGrant') {
          push(adv.ref, ['feature'], 'progression.featureGrant.ref');
        } else if (
          adv.kind === 'featureImprovement' &&
          Array.isArray(adv.targetRefs)
        ) {
          for (const target of adv.targetRefs) {
            push(
              target,
              ['feature'],
              'progression.featureImprovement.targetRefs',
            );
          }
        }
      }
    }
  }

  return refs;
}

// Every cross-record reference must resolve to an existing record of the
// expected kind. This is the runtime-relationship reachability graph
// (eshyra-o9bd.10): class -> progression-table/feature refs; subclass ->
// parent class + granted features; feature -> grantor/owned tables/subclass
// choices; spell/rule/background/magic-item -> tables; magic-item -> stat
// blocks; ancestry -> subraces. A dangling ref (target missing) or a
// mis-kinded ref (target exists but is the wrong kind) is a finding.
//
// Reduced-fixture tolerance (mirrors `checkTableOwnerLinks` / `checkSpellTableLinks`):
// a reference is only checked when the pack actually MODELS the target kind —
// i.e. it contains at least one record of an expected target kind. A fixture
// that has a feature stub with `source: 'class:fighter'` but no `class` records
// is not modeling the class relationship, so the link is skipped; the full
// committed pack contains every kind, so every reference is checked there.
function checkReferenceIntegrity(pack: RulesPack): SrdAuditFinding[] {
  const byKey = new Map(pack.records.map((record) => [record.key, record]));
  const presentKinds = new Set<string>(
    pack.records.map((record) => record.kind),
  );
  const findings: SrdAuditFinding[] = [];
  for (const record of pack.records) {
    for (const { ref, targets, field } of outboundReferences(record)) {
      if (!targets.some((kind) => presentKinds.has(kind))) continue;
      const target = byKey.get(ref);
      if (target === undefined) {
        findings.push({
          category: 'reference-integrity',
          key: record.key,
          kind: record.kind,
          name: record.name,
          detail: `${field} references '${ref}', but no record owns that key`,
        });
      } else if (!targets.includes(target.kind)) {
        findings.push({
          category: 'reference-integrity',
          key: record.key,
          kind: record.kind,
          name: record.name,
          detail: `${field} references '${ref}', which is a '${target.kind}' record but must be one of: ${targets.join(', ')}`,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Structure audit entry point
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Creature stat-block prose bleed (eshyra-76b7)
// ---------------------------------------------------------------------------

// Document-structure prose that must never appear in a creature's mechanical
// action / reaction / legendary-action text. These are appendix/section framing
// sentences (the worked case: Appendix MM-A's intro bled into Ogre Zombie's
// Morningstar). They are specific enough that no legitimate attack or trait body
// contains them, so a single match is a real defect.
const STAT_BLOCK_DOCUMENT_PROSE: readonly RegExp[] = [
  /\bappendix contains statistics\b/i,
  /\bstat blocks are organized alphabetically\b/i,
];

// A long shared substring used to detect descriptive flavor that leaked into a
// mechanical entry: if a creature carries both a `description` and an action /
// reaction / legendary-action entry that repeats a long run of that
// description, the stat-block/flavor boundary failed. 30 characters is well
// beyond any incidental overlap of mechanical phrasing.
const FLAVOR_BLEED_MIN_SHARED = 30;

interface NamedTextField {
  readonly field: string;
  readonly text: string;
}

/** Collect the action / reaction / legendary-action text of a creature. */
function statBlockMechanicalTexts(
  data: Record<string, unknown>,
): NamedTextField[] {
  const out: NamedTextField[] = [];
  const pushEntries = (value: unknown, label: string): void => {
    if (!Array.isArray(value)) return;
    value.forEach((entry, index) => {
      if (entry === null || typeof entry !== 'object') return;
      const text = asString((entry as { text?: unknown }).text);
      if (text !== null) out.push({ field: `${label}[${index}]`, text });
    });
  };
  pushEntries(data.actions, 'actions');
  pushEntries(data.reactions, 'reactions');
  const legendary = data.legendaryActions;
  if (legendary !== null && typeof legendary === 'object') {
    const intro = asString(
      (legendary as { description?: unknown }).description,
    );
    if (intro !== null)
      out.push({ field: 'legendaryActions.description', text: intro });
    pushEntries(
      (legendary as { entries?: unknown }).entries,
      'legendaryActions.entries',
    );
  }
  return out;
}

function checkCreatureStatBlockProseBleed(
  record: RulesRecord,
): SrdAuditFinding[] {
  if (record.kind !== 'creature') return [];
  const data = dataObject(record);
  if (data === null) return [];
  const findings: SrdAuditFinding[] = [];
  const mechanical = statBlockMechanicalTexts(data);
  for (const { field, text } of mechanical) {
    for (const marker of STAT_BLOCK_DOCUMENT_PROSE) {
      const match = marker.exec(text);
      if (match !== null) {
        findings.push({
          category: 'creature-stat-block-prose-bleed',
          key: record.key,
          kind: record.kind,
          name: record.name,
          detail: `data.${field} contains document-structure prose, not mechanical text: "${snippet(text)}"`,
        });
        break;
      }
    }
  }
  // Flavor that should live in `data.description` must not also appear in a
  // mechanical entry. Compare against the description's leading sentence so a
  // partial bleed (the start of the flavor paragraph appended to the last
  // action) is still caught.
  const description = asString(data.description);
  if (description !== null) {
    const lead = description.slice(0, 60).trim();
    const probe =
      lead.length >= FLAVOR_BLEED_MIN_SHARED
        ? lead.slice(0, FLAVOR_BLEED_MIN_SHARED)
        : lead;
    if (probe.length >= FLAVOR_BLEED_MIN_SHARED) {
      for (const { field, text } of mechanical) {
        if (text.includes(probe)) {
          findings.push({
            category: 'creature-stat-block-prose-bleed',
            key: record.key,
            kind: record.kind,
            name: record.name,
            detail: `data.${field} repeats data.description flavor prose: "${snippet(probe)}"`,
          });
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Spell concentration flag vs duration semantics
// ---------------------------------------------------------------------------

// SRD 5.1 durations mark concentration with a leading "Concentration, up to
// ...", except Protection from Evil and Good (p. 173), which the source prints
// without the comma. Both forms require concentration, so the derived
// mechanics.concentration flag must agree with the duration text; a mismatch
// in either direction would let a concentration tracker stack spells the SRD
// forbids (or forbid ones it allows).
const CONCENTRATION_DURATION = /^Concentration\b/i;

function checkSpellConcentrationFlag(record: RulesRecord): SrdAuditFinding[] {
  if (record.kind !== 'spell') return [];
  const data = dataObject(record);
  if (data === null) return [];
  const duration = asString(data.duration);
  if (duration === null) return [];
  const mechanics = data.mechanics;
  const flag =
    typeof mechanics === 'object' &&
    mechanics !== null &&
    (mechanics as Record<string, unknown>).concentration === true;
  const expected = CONCENTRATION_DURATION.test(duration);
  if (flag === expected) return [];
  return [
    {
      category: 'spell-concentration-flag',
      key: record.key,
      kind: record.kind,
      name: record.name,
      detail: `data.mechanics.concentration is ${flag} but data.duration "${snippet(duration)}" ${expected ? 'is' : 'is not'} a concentration duration`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Creature CR / XP round-trip (eshyra-o9bd.18.5)
// ---------------------------------------------------------------------------

// The SRD 5.1 "Experience Points by Challenge Rating" table. CR 0 is the one
// underdetermined row: the source prints "0 (0 XP)" for harmless creatures and
// "0 (10 XP)" for ones with attacks, so both values are legal there and the
// per-creature printed value is authoritative.
const SRD_5_1_XP_BY_CR: Readonly<Record<string, number>> = Object.freeze({
  '1/8': 25,
  '1/4': 50,
  '1/2': 100,
  '1': 200,
  '2': 450,
  '3': 700,
  '4': 1100,
  '5': 1800,
  '6': 2300,
  '7': 2900,
  '8': 3900,
  '9': 5000,
  '10': 5900,
  '11': 7200,
  '12': 8400,
  '13': 10000,
  '14': 11500,
  '15': 13000,
  '16': 15000,
  '17': 18000,
  '18': 20000,
  '19': 22000,
  '20': 25000,
  '21': 33000,
  '22': 41000,
  '23': 50000,
  '24': 62000,
  '25': 75000,
  '26': 90000,
  '27': 105000,
  '28': 120000,
  '29': 135000,
  '30': 155000,
});

const CR_0_XP_VALUES: ReadonlySet<number> = new Set([0, 10]);

function checkCreatureCrXp(record: RulesRecord): SrdAuditFinding[] {
  if (record.kind !== 'creature') return [];
  const data = dataObject(record);
  if (data === null) return [];
  const cr = asString(data.challengeRating);
  if (cr === null) return [];
  const finding = (detail: string): SrdAuditFinding => ({
    category: 'creature-cr-xp',
    key: record.key,
    kind: record.kind,
    name: record.name,
    detail,
  });
  const xp = data.experiencePoints;
  if (typeof xp !== 'number') {
    return [
      finding(
        `data.experiencePoints is missing; the SRD prints an XP award for every creature (challengeRating "${cr}")`,
      ),
    ];
  }
  if (cr === '0') {
    return CR_0_XP_VALUES.has(xp)
      ? []
      : [
          finding(
            `data.experiencePoints ${xp} is not a legal CR 0 award (the SRD prints 0 or 10 XP)`,
          ),
        ];
  }
  const expected = SRD_5_1_XP_BY_CR[cr];
  if (expected === undefined) {
    return [finding(`data.challengeRating "${cr}" is not an SRD 5.1 CR`)];
  }
  return xp === expected
    ? []
    : [
        finding(
          `data.experiencePoints ${xp} does not match the SRD XP-by-CR table value ${expected} for CR ${cr}`,
        ),
      ];
}

// ---------------------------------------------------------------------------
// Condition relation safety (eshyra-o9bd.18.3)
// ---------------------------------------------------------------------------

/**
 * Re-derive every `mechanics.conditions[].relation` from the record's own
 * source text via the shared classifier in `conditionRelations.ts` and flag
 * any disagreement. Because the classifier is the single implementation used
 * by the importer projection, this is a drift/hand-edit guard with one
 * safety-critical corollary: prevention, removal, suppression, and
 * immunity-gate phrasings can never survive in the pack as
 * `relation: "applies"` (the class of defect where a deterministic tool would
 * apply the opposite of the SRD effect — e.g. Branding Smite's "can't become
 * invisible" recorded as applying Invisible).
 *
 * The walk pairs each `mechanics` object with the sibling prose it was
 * derived from: `description` (+ `higherLevels` for spells) on the record
 * data, `text` on nested creature trait/action/reaction/legendary entries.
 * A conditions array with no sibling prose is skipped — there is nothing to
 * re-derive against, and no SRD record shape emits one.
 */
function checkConditionRelationSafety(record: RulesRecord): SrdAuditFinding[] {
  const findings: SrdAuditFinding[] = [];
  const data = dataObject(record);
  if (data === null) return findings;

  const checkMechanics = (
    mechanics: Record<string, unknown>,
    text: string,
    path: string,
  ): void => {
    const conditions = mechanics.conditions;
    if (!Array.isArray(conditions)) return;
    const sentences = splitConditionSentences(text);
    for (const entry of conditions) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { condition, relation } = entry as Record<string, unknown>;
      if (typeof condition !== 'string' || typeof relation !== 'string') {
        continue;
      }
      const derived = classifyConditionRelation(sentences, condition);
      if (derived !== relation) {
        findings.push({
          category: 'condition-relation-safety',
          key: record.key,
          kind: record.kind,
          name: record.name,
          detail: `${path}.conditions has ${condition} relation "${relation}" but the source text derives "${derived}"`,
        });
      }
    }
  };

  const visit = (node: unknown, path: string): void => {
    if (typeof node !== 'object' || node === null) return;
    if (Array.isArray(node)) {
      for (const [index, item] of node.entries()) {
        visit(item, `${path}[${index}]`);
      }
      return;
    }
    const obj = node as Record<string, unknown>;
    const prose = [obj.description, obj.text, obj.higherLevels]
      .filter((value): value is string => typeof value === 'string')
      .join(' ');
    const mechanics = obj.mechanics;
    if (
      prose.length > 0 &&
      typeof mechanics === 'object' &&
      mechanics !== null &&
      !Array.isArray(mechanics)
    ) {
      checkMechanics(
        mechanics as Record<string, unknown>,
        prose,
        `${path}.mechanics`,
      );
    }
    for (const [key, value] of Object.entries(obj)) {
      if (key !== 'mechanics') visit(value, `${path}.${key}`);
    }
  };

  visit(data, 'data');
  return findings;
}

/**
 * Run every structure-aware check over a loaded SRD pack. Output is sorted for
 * diffable reports.
 */
export function auditSrdStructure(pack: RulesPack): readonly SrdAuditFinding[] {
  const findings: SrdAuditFinding[] = [];
  for (const record of pack.records) {
    findings.push(...checkClassProficiencyBleed(record));
    findings.push(...checkFeatureSetupLabelBleed(record));
    findings.push(...checkSwallowedFeatures(record));
    findings.push(...checkAncestryTraits(record));
    findings.push(...checkAncestryUnlinkedTable(record));
    findings.push(...checkCreatureStatBlockProseBleed(record));
    findings.push(...checkSpellConcentrationFlag(record));
    findings.push(...checkCreatureCrXp(record));
    findings.push(...checkConditionRelationSafety(record));
  }
  findings.push(...checkSpellTableLinks(pack));
  findings.push(...checkTableOwnerLinks(pack));
  findings.push(...checkTableReachability(pack));
  findings.push(...checkReferenceIntegrity(pack));
  return sortFindings(findings);
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

function slug(value: string): string {
  // The first replace collapses every non-alphanumeric run to a single '-', so
  // at most one leading and one trailing '-' can remain. A non-quantified
  // `^-|-$` strips them in linear time (avoids the polynomial-ReDoS backtracking
  // of `-+$` on long dash runs).
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Report records the source is expected to contain but the pack is missing.
 * Names are matched case-insensitively within their kind; keys are matched
 * exactly. Catches gaps like the missing Orb of Dragonkind magic item and
 * unrepresented rule/table sections.
 */
export function auditSrdCoverage(
  pack: RulesPack,
  expectations: SrdCoverageExpectations,
): readonly SrdAuditFinding[] {
  const findings: SrdAuditFinding[] = [];

  const namesByKind = new Map<string, Set<string>>();
  const keys = new Set<string>();
  for (const record of pack.records) {
    keys.add(record.key);
    const bucket = namesByKind.get(record.kind);
    const lowered = record.name.trim().toLowerCase();
    if (bucket === undefined) {
      namesByKind.set(record.kind, new Set([lowered]));
    } else {
      bucket.add(lowered);
    }
  }

  const requiredNamesByKind = expectations.requiredNamesByKind ?? {};
  for (const kind of Object.keys(requiredNamesByKind).sort()) {
    const present = namesByKind.get(kind) ?? new Set<string>();
    for (const name of requiredNamesByKind[kind]) {
      if (present.has(name.trim().toLowerCase())) continue;
      findings.push({
        category: 'missing-coverage',
        key: `coverage:${kind}:${slug(name)}`,
        kind,
        name,
        detail: `expected ${kind} "${name}" is not present in the pack`,
      });
    }
  }

  for (const key of expectations.requiredKeys ?? []) {
    if (keys.has(key)) continue;
    findings.push({
      category: 'missing-coverage',
      key: `coverage:key:${key}`,
      kind: '(key)',
      name: key,
      detail: `expected record key "${key}" is not present in the pack`,
    });
  }

  return sortFindings(findings);
}

// ---------------------------------------------------------------------------
// Combined audit + reporting
// ---------------------------------------------------------------------------

/**
 * Run structure checks and (when expectations are supplied) coverage checks,
 * returning the combined, sorted findings.
 */
export function auditSrd(
  pack: RulesPack,
  expectations?: SrdCoverageExpectations,
): SrdStructureAudit {
  const structure = auditSrdStructure(pack);
  const coverage =
    expectations === undefined ? [] : auditSrdCoverage(pack, expectations);
  return {
    packId: pack.meta.packId,
    findings: sortFindings([...structure, ...coverage]),
  };
}

/** True when an SRD audit has any finding — use for `--strict` CI gating. */
export function srdAuditHasFindings(audit: SrdStructureAudit): boolean {
  return audit.findings.length > 0;
}

/**
 * Human-readable rendering of an `SrdStructureAudit`. Use
 * `JSON.stringify(audit, null, 2)` for the machine-readable form.
 */
export function formatSrdAuditReport(audit: SrdStructureAudit): string {
  const lines: string[] = [];
  lines.push(`SRD structure/coverage audit for pack: ${audit.packId}`);
  lines.push(`Findings: ${audit.findings.length}`);
  lines.push('');

  const byCategory = new Map<SrdAuditCategory, SrdAuditFinding[]>();
  for (const finding of audit.findings) {
    const bucket = byCategory.get(finding.category);
    if (bucket === undefined) {
      byCategory.set(finding.category, [finding]);
    } else {
      bucket.push(finding);
    }
  }
  if (byCategory.size === 0) {
    lines.push('  (no findings)');
    return `${lines.join('\n')}\n`;
  }
  for (const category of [...byCategory.keys()].sort()) {
    const bucket = byCategory.get(category) ?? [];
    lines.push(`${category}: ${bucket.length}`);
    for (const finding of bucket) {
      lines.push(`  ${finding.key} (${finding.kind}) — ${finding.name}`);
      lines.push(`    - ${finding.detail}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
