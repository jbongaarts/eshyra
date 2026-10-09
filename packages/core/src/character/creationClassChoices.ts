/**
 * Level-1 class-feature choices at character creation (eshyra-nnj6.1).
 *
 * The SRD makes a handful of class-feature decisions at level 1 that the
 * guided draft used to skip: a Fighting Style, Favored Enemy, Natural Explorer
 * terrain, Rogue Expertise, and the level-1 subclass (Divine Domain, Sorcerous
 * Origin, Otherworldly Patron) together with any choice that subclass grants at
 * level 1 (Draconic Bloodline's Dragon Ancestor).
 *
 * Membership is derived from the rules pack, not a hand list: every structured
 * choice on a feature the character holds at level 1 (the class's level-1
 * feature refs plus the chosen subclass's level-1 features) that the shared
 * level-up detectors can handle. Validation and the persisted shape come from
 * those same level-up helpers (levelUpFeatureChoices.ts, levelUpExpertise.ts,
 * levelUpSubclass.ts), run as a level 0 -> 1 "level-up" over a view of the
 * draft's proficiencies, so a creation pick and a level-up pick can never
 * disagree. Anything the detectors cannot handle stays an explicit
 * `unstructured` descriptor that blocks finalization with its reason; nothing
 * is silently skipped.
 *
 * Spell and cantrip choices are owned by the existing creation spell flow, and
 * use-time choices (Channel Divinity) are not build decisions, so both are
 * accounted for here rather than reported as gaps.
 *
 * Stored selections are the options' display names (like every other draft
 * choice); they map back to the pack option ids when applied.
 */

import type {
  CharacterFeatureChoice,
  CharacterSheet,
  FinalizedRecordRef,
} from './finalizeCharacter.js';
import {
  choiceInstanceKey,
  type HandledChoiceInstances,
  uncoveredChoiceDescriptors,
} from './levelUpChoiceCoverage.js';
import type {
  LevelUpChoiceSelections,
  LevelUpRequiredChoice,
} from './levelUpEngine.js';
import {
  detectExpertiseDescriptors,
  resolveExpertiseSelection,
} from './levelUpExpertise.js';
import {
  detectFeatureChoiceDescriptors,
  resolveFeatureChoiceSelection,
} from './levelUpFeatureChoices.js';
import {
  resolveSubclassSelection,
  SUBCLASS_FEATURE_SUFFIXES,
  subclassFeatureRefsForLevel,
} from './levelUpSubclass.js';
import type { Level1RequiredChoice } from './requiredChoices.js';
import type {
  ResolvedClassData,
  ResolvedSubclassData,
  RulesPackCharacterResolver,
} from './rulesPackResolver.js';

/** What a satisfied class-feature choice contributes to the finalized sheet. */
export type CreationChoiceApplication =
  | { readonly kind: 'subclass'; readonly subclass: FinalizedRecordRef }
  | {
      readonly kind: 'feature-choice';
      readonly featureChoice: CharacterFeatureChoice;
    };

/** A level-1 class-feature choice plus the draft's answer to it. */
export interface CreationClassChoiceState {
  readonly choice: Level1RequiredChoice;
  readonly selected: readonly string[];
  readonly satisfied: boolean;
  /** Why a non-empty selection is refused (level-up validator wording). */
  readonly refusal?: string;
  /** Present once satisfied: what finalization persists on the sheet. */
  readonly application?: CreationChoiceApplication;
}

export interface CreationClassChoiceInput {
  readonly resolver: RulesPackCharacterResolver;
  readonly classRecord: ResolvedClassData;
  /** The draft's stored selections, keyed by choice id. */
  readonly stored: Readonly<Record<string, readonly string[]>>;
  /** Skill proficiencies held so far (ancestry + background + class picks). */
  readonly skillProficiencies: readonly string[];
  /** Tool proficiencies the character holds so far. */
  readonly toolProficiencies: readonly string[];
}

export const SUBCLASS_CHOICE_ID = 'class.subclass';
const CLASS_FEATURE_ID_PREFIX = 'class.feature.';

/** Ids of every choice this module can produce share this shape. */
export function isCreationClassChoiceId(id: string): boolean {
  return id === SUBCLASS_CHOICE_ID || id.startsWith(CLASS_FEATURE_ID_PREFIX);
}

const suffixOf = (ref: string): string => ref.slice(ref.lastIndexOf(':') + 1);

/** Spell/cantrip choices are collected by the creation spell flow instead. */
const SPELL_FLOW_CATEGORIES: ReadonlySet<string> = new Set([
  'cantrip',
  'spell',
]);

function choiceIdFor(descriptorId: string): string {
  return `${CLASS_FEATURE_ID_PREFIX}${descriptorId.replace(/^level\.1\.feature\./, '')}`;
}

/**
 * Every level-1 class-feature choice for `classRecord`, in feature order with
 * the subclass first, each paired with its current selection and verdict.
 */
export function deriveCreationClassChoices(
  input: CreationClassChoiceInput,
): readonly CreationClassChoiceState[] {
  const { resolver, classRecord, stored } = input;
  const classKey = classRecord.key;
  const features = resolver.listFeatures();
  const featureName = (ref: string): string =>
    features.find((feature) => feature.key === ref)?.name ?? ref;
  const row = resolver.resolveClassLevel(classKey, 1);
  const classRefs = row.ok
    ? row.record.featureRefs
    : (classRecord.level1?.featureRefs ?? []);

  const states: CreationClassChoiceState[] = [];
  const handled = new Set<string>();

  // --- Subclass pick ---------------------------------------------------------
  let subclass: ResolvedSubclassData | undefined;
  const subclassRef = classRefs.find((ref) =>
    SUBCLASS_FEATURE_SUFFIXES.has(suffixOf(ref)),
  );
  if (subclassRef !== undefined) {
    for (const choice of features.find((f) => f.key === subclassRef)?.choices ??
      []) {
      if (choice.category === 'subclass') {
        handled.add(choiceInstanceKey(subclassRef, choice.id));
      }
    }
    const available = resolver
      .listSubclasses()
      .filter((candidate) => candidate.parentClass === classKey);
    const selected = stored[SUBCLASS_CHOICE_ID] ?? [];
    const label = `${featureName(subclassRef)}: choose a subclass`;
    if (available.length === 0) {
      states.push(
        unstructured(
          SUBCLASS_CHOICE_ID,
          'subclass',
          label,
          `The pack has no subclass records for ${classRecord.name}, but '${subclassRef}' requires one at level 1.`,
        ),
      );
    } else {
      subclass =
        selected.length === 1
          ? resolveSubclassSelection(selected[0] as string, classKey, resolver)
          : undefined;
      const featureRefs =
        subclass === undefined
          ? []
          : subclassFeatureRefsForLevel(subclass, 1, resolver);
      const choice: Level1RequiredChoice = {
        id: SUBCLASS_CHOICE_ID,
        kind: 'subclass',
        source: 'class',
        status: 'structured',
        label,
        choose: 1,
        from: available.map((candidate) => candidate.name),
      };
      if (selected.length === 0) {
        states.push({ choice, selected, satisfied: false });
      } else if (subclass === undefined) {
        states.push({
          choice,
          selected,
          satisfied: false,
          refusal: `'${selected.join(', ')}' is not a valid ${classRecord.name} subclass`,
        });
      } else if (featureRefs.length === 0) {
        subclass = undefined;
        states.push({
          choice,
          selected,
          satisfied: false,
          refusal:
            'Selected subclass has no structured feature records for level 1; deterministic subclass application is incomplete.',
        });
      } else {
        states.push({
          choice,
          selected,
          satisfied: true,
          application: {
            kind: 'subclass',
            subclass: { key: subclass.key, name: subclass.name },
          },
        });
      }
    }
  }

  // --- Feature choices (shared level-up detectors, level 0 -> 1) -------------
  const targetFeatureRefs = [
    ...new Set([
      ...classRefs,
      ...(subclass === undefined
        ? []
        : subclassFeatureRefsForLevel(subclass, 1, resolver)),
    ]),
  ];
  for (const ref of targetFeatureRefs) {
    for (const choice of features.find((f) => f.key === ref)?.choices ?? []) {
      if (SPELL_FLOW_CATEGORIES.has(choice.category)) {
        handled.add(choiceInstanceKey(ref, choice.id));
      }
    }
  }
  // A view of the in-progress sheet: the level-up helpers read only these.
  const sheetView: Pick<
    CharacterSheet,
    | 'class'
    | 'skillProficiencies'
    | 'toolProficiencies'
    | 'spells'
    | 'featureChoices'
  > = {
    class: { key: classKey, name: classRecord.name },
    skillProficiencies: input.skillProficiencies,
    toolProficiencies: input.toolProficiencies,
    spells: [],
    featureChoices: undefined,
  };
  const sheet = sheetView as CharacterSheet;
  const noSelections: LevelUpChoiceSelections = {};
  const heldFeatureRefs = new Set<string>();
  const expertise = detectExpertiseDescriptors({
    sheet,
    toLevel: 1,
    targetFeatureRefs,
    heldFeatureRefs,
    resolver,
  });
  const listChoices = detectFeatureChoiceDescriptors({
    sheet,
    classKey,
    fromLevel: 0,
    toLevel: 1,
    targetFeatureRefs,
    heldFeatureRefs,
    invocationsKnown: { from: undefined, to: undefined },
    resolver,
    selections: noSelections,
  });
  const descriptors = [...expertise.choices, ...listChoices.choices].sort(
    (a, b) =>
      refOrder(targetFeatureRefs, a.featureRef) -
      refOrder(targetFeatureRefs, b.featureRef),
  );
  for (const set of [
    expertise.handledInstances,
    listChoices.handledInstances,
  ] as readonly HandledChoiceInstances[]) {
    for (const key of set) handled.add(key);
  }

  // Every supported pick, as pack option ids, for cross-descriptor checks.
  const idsFor = (
    descriptor: LevelUpRequiredChoice,
    selected: readonly string[],
  ): readonly string[] => {
    const byName = new Map(
      (descriptor.options ?? []).map((o) => [o.name, o.id] as const),
    );
    const known = new Set(descriptor.from ?? []);
    return selected.map((value) =>
      known.has(value) ? value : (byName.get(value) ?? value),
    );
  };
  const allSelections: Record<string, readonly string[]> = {};
  for (const descriptor of descriptors) {
    if (descriptor.status === 'supported') {
      allSelections[descriptor.id] = idsFor(
        descriptor,
        stored[choiceIdFor(descriptor.id)] ?? [],
      );
    }
  }

  for (const descriptor of descriptors) {
    const id = choiceIdFor(descriptor.id);
    if (descriptor.status !== 'supported') {
      states.push(
        unstructured(
          id,
          descriptor.kind === 'expertise' ? 'expertise' : 'feature_choice',
          descriptor.label,
          descriptor.unsupportedReason ?? descriptor.reason,
        ),
      );
      continue;
    }
    const options = descriptor.options ?? [];
    const choice: Level1RequiredChoice = {
      id,
      kind: descriptor.kind === 'expertise' ? 'expertise' : 'feature_choice',
      source: 'class',
      status: 'structured',
      label: descriptor.label,
      choose: descriptor.choose,
      from: options.map((option) => option.name),
    };
    const selected = stored[id] ?? [];
    if (selected.length === 0) {
      states.push({ choice, selected, satisfied: false });
      continue;
    }
    const optionIds = new Set(options.map((option) => option.id));
    const ids = allSelections[descriptor.id] ?? [];
    const unknown = ids.find((value) => !optionIds.has(value));
    if (unknown !== undefined) {
      states.push({
        choice,
        selected,
        satisfied: false,
        refusal: `'${unknown}' is not a legal option`,
      });
      continue;
    }
    const resolution =
      descriptor.kind === 'expertise'
        ? resolveExpertiseSelection(descriptor, ids, 1)
        : resolveFeatureChoiceSelection(
            descriptor,
            ids,
            sheet,
            1,
            resolver,
            allSelections,
          );
    const fc = resolution.ok ? resolution.applied?.featureChoice : undefined;
    if (!resolution.ok || fc === undefined) {
      states.push({
        choice,
        selected,
        satisfied: false,
        refusal: resolution.ok ? undefined : resolution.reason,
      });
      continue;
    }
    states.push({
      choice,
      selected,
      satisfied: true,
      application: {
        kind: 'feature-choice',
        featureChoice: {
          featureRef: fc.featureRef,
          choiceId: fc.choiceId,
          optionIds: [...fc.optionIds],
          level: fc.level,
        },
      },
    });
  }

  // Coverage invariant: a pack choice on a held level-1 feature that no
  // detector (or the spell flow) accounted for blocks, never vanishes.
  for (const gap of uncoveredChoiceDescriptors({
    toLevel: 1,
    targetFeatureRefs,
    emitted: descriptors,
    handled,
    resolver,
  })) {
    states.push(
      unstructured(
        choiceIdFor(gap.id),
        'feature_choice',
        gap.label,
        gap.unsupportedReason ?? gap.reason,
      ),
    );
  }
  return states;
}

function refOrder(refs: readonly string[], ref: string | undefined): number {
  const index = ref === undefined ? -1 : refs.indexOf(ref);
  return index < 0 ? refs.length : index;
}

function unstructured(
  id: string,
  kind: 'subclass' | 'feature_choice' | 'expertise',
  label: string,
  reason: string,
): CreationClassChoiceState {
  return {
    choice: {
      id,
      kind,
      source: 'class',
      status: 'unstructured',
      label: `${label} (not yet selectable: ${reason})`,
      sourceText: reason,
    },
    selected: [],
    satisfied: false,
  };
}
