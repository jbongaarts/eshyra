/**
 * Source-derived SPELLCASTING/PACT MAGIC SECTION PARITY GATE for the D&D 5e
 * SRD 5.1 importer (eshyra-o9bd.19.2.2.4).
 *
 * Two independent invariants, checked apart from `parseFeatures.ts`:
 *
 * (a) Every class-grantor "Spellcasting"/"Pact Magic" feature heading printed
 *     in the source has an emitted `feature:<class>:<name>` record whose
 *     `data.sections[].name` list matches the printed subheadings under it
 *     EXACTLY — same names, same order, nothing missing or extra. The
 *     denominator is read straight from the extracted pages by font-height
 *     tier (a class chapter heading h≈25.9, the Spellcasting/Pact Magic
 *     feature heading h≈13.9, its own printed subheadings h≈12.0), the same
 *     shape `parseFeatures.ts` uses but computed independently here so a
 *     parser regression cannot silently agree with itself.
 *
 * (b) Every emitted `feature` record whose `data.source` is `class:*` is
 *     referenced by a `featureGrant` or `featureImprovement` in that class's
 *     `data.progression` — the class-table membership denominator
 *     `parseFeatures.ts` design decision D1 relies on. A class-grantor
 *     feature record with no class-table anchor is exactly the failure mode
 *     that produced the retired `feature:{cleric,druid,sorcerer,wizard}:
 *     cantrips` / `feature:wizard:spellbook` parser-artifact records; this
 *     half of the gate keeps that class of bug from recurring even if a
 *     future change reaches it by a different path than D1's.
 */
import type { RulesRecord } from '../../../src/rules/types.js';
import type { PageText } from './types.js';

export class SpellcastingSectionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpellcastingSectionsError';
  }
}

// Height bands (PDF user-space points), independently measured against the
// real SRD_CC_v5.1.pdf extraction (eshyra-o9bd.19.2.2.4 design notes): a
// class chapter heading renders at h≈25.9, a class feature heading —
// including "Spellcasting" and "Pact Magic" — at h≈13.9, and a printed
// subheading inside that feature's body ("Cantrips", "Spellcasting
// Ability", …) at h≈12.0, with ordinary body prose at h≈9.8. These mirror,
// but do not import, the tier constants `parseSubclasses.ts` uses
// (CLASS_CHAPTER_MIN_H / FEATURE_LEAF_MIN_H / the D2 subheading predicate),
// so this gate stays a check ON the parser rather than a restatement OF it.
const CLASS_CHAPTER_MIN_H = 20;
const FEATURE_HEADING_MIN_H = 13.5;
// Upper bound for the "Spellcasting"/"Pact Magic" FEATURE heading itself —
// real class feature headings render at h≈13.9, well below any chapter
// (h≈25.9) or section (h≈18) tier. Without this cap, the core rules
// "Spellcasting" CHAPTER title (a different heading entirely, printed well
// after the Classes chapter) would also match the bare height-floor check
// and get wrongly attributed to whichever class chapter precedes it in
// reading order.
const FEATURE_HEADING_MAX_H = 15;
const SUBHEADING_MIN_H = 11.5;

const SPELLCASTING_HEADING_NAMES: ReadonlySet<string> = new Set([
  'Spellcasting',
  'Pact Magic',
]);

interface FlatLine {
  readonly page: number;
  readonly text: string;
  readonly height: number | undefined;
}

function flatten(pages: readonly PageText[]): readonly FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    for (let i = 0; i < page.lines.length; i++) {
      out.push({
        page: page.pageNumber,
        text: page.lines[i].trim(),
        height: page.lineHeights?.[i],
      });
    }
  }
  return out;
}

function featureSections(record: RulesRecord): readonly string[] {
  const data = record.data as { sections?: unknown };
  if (!Array.isArray(data.sections)) return [];
  return data.sections
    .map((section) =>
      typeof section === 'object' && section !== null
        ? (section as { name?: unknown }).name
        : undefined,
    )
    .filter((name): name is string => typeof name === 'string');
}

function featureSource(record: RulesRecord): string | null {
  const source = (record.data as { source?: unknown } | null)?.source;
  return typeof source === 'string' ? source : null;
}

export interface SpellcastingSectionResult {
  readonly className: string;
  readonly featureHeading: string;
  readonly page: number;
  readonly sourceSectionNames: readonly string[];
  readonly emittedFeatureKey: string | null;
  readonly emittedSectionNames: readonly string[];
  readonly missing: readonly string[];
  readonly extra: readonly string[];
  readonly reordered: boolean;
}

export interface SpellcastingSectionsAudit {
  readonly perClass: readonly SpellcastingSectionResult[];
  /** A Spellcasting/Pact Magic heading found at the feature tier with no
   * preceding class-chapter heading to attribute it to. */
  readonly unattributed: readonly {
    readonly page: number;
    readonly text: string;
  }[];
  /** `feature:` records whose `data.source` is `class:*` but that no
   * `featureGrant`/`featureImprovement` in that class's progression names —
   * part (b) of the gate. */
  readonly unanchoredClassFeatures: readonly string[];
}

/** Compute both halves of the gate over the FINAL emitted records. */
export function auditSpellcastingSections(
  records: readonly RulesRecord[],
  pages: readonly PageText[],
): SpellcastingSectionsAudit {
  const flat = flatten(pages);
  const classRecords = records.filter((record) => record.kind === 'class');
  const classNameSet = new Set(classRecords.map((record) => record.name));

  // Class chapter anchors, in reading order.
  const chapterAnchors: Array<{
    readonly index: number;
    readonly className: string;
  }> = [];
  for (let i = 0; i < flat.length; i++) {
    const { text, height } = flat[i];
    if (
      height !== undefined &&
      height >= CLASS_CHAPTER_MIN_H &&
      classNameSet.has(text)
    ) {
      chapterAnchors.push({ index: i, className: text });
    }
  }

  function classNameAt(index: number): string | null {
    let name: string | null = null;
    for (const anchor of chapterAnchors) {
      if (anchor.index > index) break;
      name = anchor.className;
    }
    return name;
  }

  const perClass: SpellcastingSectionResult[] = [];
  const unattributed: Array<{ readonly page: number; readonly text: string }> =
    [];

  for (let i = 0; i < flat.length; i++) {
    const { text, height, page } = flat[i];
    if (
      height === undefined ||
      height < FEATURE_HEADING_MIN_H ||
      height >= FEATURE_HEADING_MAX_H
    ) {
      continue;
    }
    if (!SPELLCASTING_HEADING_NAMES.has(text)) continue;

    const className = classNameAt(i);
    if (className === null) {
      unattributed.push({ page, text });
      continue;
    }

    // Collect the subheading-tier lines until the next line at or above the
    // feature tier — the next class feature or the next class's chapter
    // heading, either of which ends this feature's printed body.
    const sourceSectionNames: string[] = [];
    for (let j = i + 1; j < flat.length; j++) {
      const line = flat[j];
      if (line.height !== undefined && line.height >= FEATURE_HEADING_MIN_H) {
        break;
      }
      if (line.height !== undefined && line.height >= SUBHEADING_MIN_H) {
        sourceSectionNames.push(line.text);
      }
    }

    const classRecord =
      classRecords.find((record) => record.name === className) ?? null;
    const emitted =
      classRecord === null
        ? undefined
        : records.find(
            (record) =>
              record.kind === 'feature' &&
              record.name === text &&
              featureSource(record) === classRecord.key,
          );
    const emittedSectionNames =
      emitted === undefined ? [] : featureSections(emitted);
    const missing = sourceSectionNames.filter(
      (name) => !emittedSectionNames.includes(name),
    );
    const extra = emittedSectionNames.filter(
      (name) => !sourceSectionNames.includes(name),
    );
    const reordered =
      missing.length === 0 &&
      extra.length === 0 &&
      sourceSectionNames.join('\u0001') !== emittedSectionNames.join('\u0001');

    perClass.push({
      className,
      featureHeading: text,
      page,
      sourceSectionNames,
      emittedFeatureKey: emitted?.key ?? null,
      emittedSectionNames,
      missing,
      extra,
      reordered,
    });
  }

  // Part (b): every class-sourced feature record must be named by a
  // featureGrant or featureImprovement in ITS OWN class's progression — a
  // reference from another class's table does not anchor it.
  const referencedByClass = new Map<string, Set<string>>();
  for (const cls of classRecords) {
    const referenced = new Set<string>();
    referencedByClass.set(cls.key, referenced);
    const progression = (cls.data as { progression?: unknown } | null)
      ?.progression;
    if (!Array.isArray(progression)) continue;
    for (const row of progression) {
      const advancement = (row as { advancement?: unknown }).advancement;
      if (!Array.isArray(advancement)) continue;
      for (const entry of advancement) {
        const e = entry as {
          kind?: unknown;
          ref?: unknown;
          targetRefs?: unknown;
        };
        if (e.kind === 'featureGrant' && typeof e.ref === 'string') {
          referenced.add(e.ref);
        }
        if (e.kind === 'featureImprovement' && Array.isArray(e.targetRefs)) {
          for (const ref of e.targetRefs) {
            if (typeof ref === 'string') referenced.add(ref);
          }
        }
      }
    }
  }
  const unanchoredClassFeatures = records
    .filter((record) => {
      if (record.kind !== 'feature') return false;
      const source = featureSource(record);
      if (source?.startsWith('class:') !== true) return false;
      return referencedByClass.get(source)?.has(record.key) !== true;
    })
    .map((record) => record.key)
    .sort();

  return { perClass, unattributed, unanchoredClassFeatures };
}

/**
 * Fail closed when a class Spellcasting/Pact Magic feature's emitted
 * `data.sections` disagrees with what the source prints, or when any
 * class-sourced feature record has no class-table anchor. `requireComplete`
 * is set only for the real import, where all 8 SRD 5.1 caster classes must be
 * found and every heading must be attributable to a class; reduced fixture
 * PDFs check only what they contain.
 */
export function assertSpellcastingSections(
  records: readonly RulesRecord[],
  pages: readonly PageText[],
  options: { readonly requireComplete: boolean },
): void {
  const audit = auditSpellcastingSections(records, pages);
  const problems: string[] = [];

  for (const result of audit.perClass) {
    if (result.emittedFeatureKey === null) {
      problems.push(
        `${result.className} "${result.featureHeading}" (p${result.page}): no emitted feature record found for source class:${result.className}`,
      );
      continue;
    }
    for (const name of result.missing) {
      problems.push(
        `${result.emittedFeatureKey}: printed subsection "${name}" is missing from data.sections`,
      );
    }
    for (const name of result.extra) {
      problems.push(
        `${result.emittedFeatureKey}: data.sections has "${name}", which ${result.className} does not print under ${result.featureHeading}`,
      );
    }
    if (result.reordered) {
      problems.push(
        `${result.emittedFeatureKey}: data.sections order [${result.emittedSectionNames.join(', ')}] does not match the printed order [${result.sourceSectionNames.join(', ')}]`,
      );
    }
  }

  problems.push(
    ...audit.unanchoredClassFeatures.map(
      (key) =>
        `${key}: class-sourced feature is not referenced by any featureGrant/featureImprovement in its class's data.progression`,
    ),
  );

  if (options.requireComplete) {
    if (audit.perClass.length < 8) {
      problems.push(
        `expected all 8 SRD 5.1 caster classes' Spellcasting/Pact Magic feature to be found in source, found ${audit.perClass.length}`,
      );
    }
    problems.push(
      ...audit.unattributed.map(
        (item) =>
          `p${item.page}: "${item.text}" heading at the feature tier has no preceding class-chapter heading to attribute it to`,
      ),
    );
  }

  if (problems.length > 0) {
    throw new SpellcastingSectionsError(
      `Spellcasting/Pact Magic section parity gate failed (eshyra-o9bd.19.2.2.4):\n  ${problems.join('\n  ')}`,
    );
  }
}
