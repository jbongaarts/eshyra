// Standing proficiency grants from class/subclass features and chosen options
// (eshyra-olc5.7.2). The pack types them (`mechanics.effects[kind=proficiency]`
// `savingThrows` / `skills` / `armor`, eshyra-olc5.7.1); this module applies
// them to the durable sheet and keeps a provenance ledger
// (`CharacterSheet.proficiencyGrants`) of ONLY what each source newly added, so
// a replaceable option (Eldritch Invocation) can later be removed exactly and a
// proficiency held from any other source is never touched.
//
// Pure over the sheet: no I/O. Ancestry trait grants are NOT read here
// (srdAncestrySkills.ts applies those at creation).

import { ABILITY_SCORE_NAMES } from './abilities.js';
import type { AbilityScoreName } from './creation.js';
import type { CharacterSheet } from './finalizeCharacter.js';
import { characterExpertise } from './levelUpExpertise.js';
import {
  PROFICIENCY_ARMOR_VOCABULARY,
  type ProficiencyGrant,
  parseProficiencyGrants,
  type RulesPackCharacterResolver,
} from './rulesPackResolver.js';
import { SRD_5_1_SKILLS } from './srdCreationChoices.js';

export type { ProficiencyGrant } from './rulesPackResolver.js';

/** Provenance of proficiencies one source newly added to the sheet. */
export interface CharacterProficiencyGrant {
  /** Feature key (`feature:rogue:slippery-mind`) or option id. */
  readonly sourceRef: string;
  readonly savingThrows?: readonly AbilityScoreName[];
  readonly skills?: readonly string[];
  readonly armor?: readonly string[];
}

export interface ProficiencyGrantSource {
  readonly sourceRef: string;
  readonly grant: ProficiencyGrant;
}

/** Raised when a grant cannot be applied or removed without losing state. */
export class ProficiencyGrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProficiencyGrantError';
  }
}

const norm = (value: string): string => value.toLowerCase();

type ProficiencyState = Pick<
  CharacterSheet,
  | 'abilityScores'
  | 'proficiencyBonus'
  | 'savingThrows'
  | 'skillProficiencies'
  | 'armorProficiencies'
  | 'proficiencyGrants'
  | 'featureChoices'
>;

function entryOf(
  sourceRef: string,
  added: ProficiencyGrant,
): CharacterProficiencyGrant {
  return {
    sourceRef,
    ...(added.savingThrows !== undefined && added.savingThrows.length > 0
      ? { savingThrows: added.savingThrows }
      : {}),
    ...(added.skills !== undefined && added.skills.length > 0
      ? { skills: added.skills }
      : {}),
    ...(added.armor !== undefined && added.armor.length > 0
      ? { armor: added.armor }
      : {}),
  };
}

/**
 * What each source would NEWLY add against `sheet`, in order. Items already
 * held (from any source, including an earlier source in this list) are not
 * added. Sources already in the ledger are skipped.
 */
export function grantsForSources(
  sheet: ProficiencyState,
  sources: readonly ProficiencyGrantSource[],
): readonly CharacterProficiencyGrant[] {
  const saves = new Set<string>(
    ABILITY_SCORE_NAMES.filter((name) => sheet.savingThrows[name].proficient),
  );
  const skills = new Set(sheet.skillProficiencies.map(norm));
  const armor = new Set(sheet.armorProficiencies.map(norm));
  const done = new Set((sheet.proficiencyGrants ?? []).map((e) => e.sourceRef));
  const out: CharacterProficiencyGrant[] = [];
  for (const { sourceRef, grant } of sources) {
    if (done.has(sourceRef)) continue;
    done.add(sourceRef);
    const addSaves = (grant.savingThrows ?? []).filter((a) => !saves.has(a));
    const addSkills = (grant.skills ?? []).filter((s) => !skills.has(norm(s)));
    const addArmor = (grant.armor ?? []).filter((a) => !armor.has(norm(a)));
    for (const a of addSaves) saves.add(a);
    for (const s of addSkills) skills.add(norm(s));
    for (const a of addArmor) armor.add(norm(a));
    out.push(
      entryOf(sourceRef, {
        savingThrows: addSaves,
        skills: addSkills,
        armor: addArmor,
      }),
    );
  }
  return out;
}

/**
 * Apply `sources` to the sheet. Returns the updated sheet and the ledger
 * entries appended (a source that adds nothing still gets a `{ sourceRef }`
 * entry so reconciliation never re-evaluates it). Idempotent.
 */
export function applyProficiencyGrants<T extends ProficiencyState>(
  sheet: T,
  sources: readonly ProficiencyGrantSource[],
): {
  readonly sheet: T;
  readonly ledgerEntries: readonly CharacterProficiencyGrant[];
} {
  const ledgerEntries = grantsForSources(sheet, sources);
  if (ledgerEntries.length === 0) return { sheet, ledgerEntries };
  const gainedSaves = new Set(
    ledgerEntries.flatMap((e) => e.savingThrows ?? []),
  );
  const savingThrows = { ...sheet.savingThrows };
  for (const ability of gainedSaves) {
    savingThrows[ability] = {
      modifier: sheet.abilityScores[ability].modifier + sheet.proficiencyBonus,
      proficient: true,
    };
  }
  return {
    sheet: {
      ...sheet,
      savingThrows,
      skillProficiencies: [
        ...sheet.skillProficiencies,
        ...ledgerEntries.flatMap((e) => e.skills ?? []),
      ],
      armorProficiencies: [
        ...sheet.armorProficiencies,
        ...ledgerEntries.flatMap((e) => e.armor ?? []),
      ],
      proficiencyGrants: [...(sheet.proficiencyGrants ?? []), ...ledgerEntries],
    },
    ledgerEntries,
  };
}

/**
 * Remove exactly what `sourceRef`'s ledger entry recorded and drop the entry.
 * No entry -> no-op. Refuses (fail closed) when a recorded skill is an
 * Expertise target: Expertise presupposes the proficiency and the engine does
 * not guess how to resolve that.
 */
export function removeOptionGrants<T extends ProficiencyState>(
  sheet: T,
  sourceRef: string,
): {
  readonly sheet: T;
  readonly removed: CharacterProficiencyGrant | undefined;
} {
  const entry = (sheet.proficiencyGrants ?? []).find(
    (e) => e.sourceRef === sourceRef,
  );
  if (entry === undefined) return { sheet, removed: undefined };
  const expertise = new Set(
    [...characterExpertise(sheet as unknown as CharacterSheet)].map((id) =>
      norm(id.replace(/^skill:/, '')),
    ),
  );
  for (const skill of entry.skills ?? []) {
    if (expertise.has(norm(skill))) {
      throw new ProficiencyGrantError(
        `cannot remove '${sourceRef}': it granted proficiency in ${skill}, which has Expertise; Expertise presupposes the proficiency`,
      );
    }
  }
  const savingThrows = { ...sheet.savingThrows };
  for (const ability of entry.savingThrows ?? []) {
    savingThrows[ability] = {
      modifier: sheet.abilityScores[ability].modifier,
      proficient: false,
    };
  }
  const dropSkills = new Set((entry.skills ?? []).map(norm));
  const dropArmor = new Set((entry.armor ?? []).map(norm));
  const remaining = (sheet.proficiencyGrants ?? []).filter(
    (e) => e.sourceRef !== sourceRef,
  );
  const { proficiencyGrants: _old, ...rest } = sheet;
  return {
    sheet: {
      ...rest,
      savingThrows,
      skillProficiencies: sheet.skillProficiencies.filter(
        (s) => !dropSkills.has(norm(s)),
      ),
      armorProficiencies: sheet.armorProficiencies.filter(
        (a) => !dropArmor.has(norm(a)),
      ),
      ...(remaining.length > 0 ? { proficiencyGrants: remaining } : {}),
    } as unknown as T,
    removed: entry,
  };
}

/**
 * Grant sources for a set of held features and chosen options, resolved from
 * the pack: a feature's own typed grant (source ref = feature key) and each
 * chosen option's typed grant (source ref = option id).
 */
export function collectGrantSources(
  resolver: RulesPackCharacterResolver,
  featureRefs: Iterable<string>,
  featureChoices: CharacterSheet['featureChoices'],
): readonly ProficiencyGrantSource[] {
  const features = new Map(resolver.listFeatures().map((f) => [f.key, f]));
  const sources: ProficiencyGrantSource[] = [];
  const seen = new Set<string>();
  const push = (sourceRef: string, grant: ProficiencyGrant | undefined) => {
    if (grant === undefined || seen.has(sourceRef)) return;
    seen.add(sourceRef);
    sources.push({ sourceRef, grant });
  };
  for (const ref of featureRefs) {
    push(ref, features.get(ref)?.proficiencyGrants);
  }
  for (const entry of featureChoices ?? []) {
    const choice = features
      .get(entry.featureRef)
      ?.choices?.find((c) => c.id === entry.choiceId);
    for (const optionId of entry.optionIds) {
      const option = choice?.options?.find((o) => o.id === optionId);
      push(optionId, parseProficiencyGrants(option?.mechanics));
    }
  }
  return sources;
}

/** Feature refs held at creation: class level 1 + the subclass's level-1 features. */
export function levelOneFeatureRefs(
  resolver: RulesPackCharacterResolver,
  classKey: string,
  subclassKey: string | undefined,
): readonly string[] {
  const refs: string[] = [];
  const row = resolver.resolveClassLevel(classKey, 1);
  if (row.ok) refs.push(...row.record.featureRefs);
  if (subclassKey !== undefined) {
    const subclass = resolver
      .listSubclasses()
      .find((s) => s.key === subclassKey);
    if (subclass !== undefined) {
      const owned = new Set(subclass.features);
      for (const f of resolver.listFeatures()) {
        if (f.source === subclass.key && f.level === 1 && owned.has(f.key)) {
          refs.push(f.key);
        }
      }
    }
  }
  return refs;
}

/**
 * Validate the shape of a sheet's optional `proficiencyGrants` ledger (legacy
 * sheets omit it): an array of entries with unique non-empty `sourceRef` and
 * duplicate-free lists inside the closed vocabularies.
 */
export function validateCharacterSheetProficiencyGrants(
  sheet: Pick<CharacterSheet, 'proficiencyGrants'>,
): void {
  const entries: unknown = sheet.proficiencyGrants;
  if (entries === undefined) return;
  if (!Array.isArray(entries)) {
    throw new Error('character sheet proficiencyGrants must be an array');
  }
  const refs = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const where = `character sheet proficiencyGrants[${index}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${where} must be an object`);
    }
    const record = entry as Record<string, unknown>;
    const { sourceRef } = record;
    if (typeof sourceRef !== 'string' || sourceRef.length === 0) {
      throw new Error(`${where}.sourceRef must be a non-empty string`);
    }
    if (refs.has(sourceRef)) {
      throw new Error(`${where}.sourceRef '${sourceRef}' is duplicated`);
    }
    refs.add(sourceRef);
    const vocab: Record<string, readonly string[]> = {
      savingThrows: ABILITY_SCORE_NAMES,
      skills: SRD_5_1_SKILLS,
      armor: PROFICIENCY_ARMOR_VOCABULARY,
    };
    for (const [field, allowed] of Object.entries(vocab)) {
      const value = record[field];
      if (value === undefined) continue;
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        new Set(value).size !== value.length ||
        value.some(
          (item) => typeof item !== 'string' || !allowed.includes(item),
        )
      ) {
        throw new Error(
          `${where}.${field} must be distinct values from the closed vocabulary`,
        );
      }
    }
    for (const key of Object.keys(record)) {
      if (!['sourceRef', 'savingThrows', 'skills', 'armor'].includes(key)) {
        throw new Error(`${where} has unknown field '${key}'`);
      }
    }
  }
}
