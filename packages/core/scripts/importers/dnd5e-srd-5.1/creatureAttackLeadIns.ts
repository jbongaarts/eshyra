/**
 * Source-derived creature ATTACK LEAD-IN GATE for the D&D 5e SRD 5.1 importer
 * (eshyra-o9bd.19.2.2.1, registry row wererat-crossbow / opus:F-30).
 *
 * The invariant: every attack lead-in the SRD prints in a creature's stat
 * block ("Melee Weapon Attack:", "Ranged Spell Attack:", …) opens its own
 * narrative entry. The Wererat's "Hand Crossbow (Humanoid or Hybrid Form
 * Only)." lead-in was printed alone on its line and the segmenter merged the
 * whole attack into the Shortsword entry before it.
 *
 * The denominator is taken from the extracted SOURCE, independently of the
 * creature parser: each creature's slice runs from its printed name line
 * (immediately followed by its size/type meta line) to the next creature's
 * name line, and the attack lead-ins printed in that slice are counted. The
 * numerator is the number of emitted entries whose text BEGINS with an attack
 * lead-in. An attack swallowed into any other entry — attack or not — no
 * longer begins an entry, so the counts diverge.
 */
import type { RulesRecord } from '../../../src/rules/types.js';
import type { PageText } from './types.js';

export class CreatureAttackLeadInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreatureAttackLeadInError';
  }
}

// "Melee or Ranged" first so a combined lead-in counts once.
const ATTACK_LEAD_IN =
  /\b(?:Melee or Ranged|Melee|Ranged) (?:Weapon|Spell) Attack:/g;
const ENTRY_OPENS_WITH_ATTACK =
  /^(?:Melee or Ranged|Melee|Ranged) (?:Weapon|Spell) Attack:/;
const META_LINE = /^(?:Tiny|Small|Medium|Large|Huge|Gargantuan)\b/;

interface SourceCountException {
  /** Printed attack lead-ins in the slice that are NOT their own entry. */
  readonly embeddedAttackLeadIns: number;
  readonly page: number;
  readonly reason: string;
}

/**
 * Reviewed, source-cited cases where the SRD itself prints an attack lead-in
 * inside another entry's prose. Keyed by creature record key.
 */
export const CREATURE_ATTACK_LEAD_IN_EXCEPTIONS: ReadonlyMap<
  string,
  SourceCountException
> = new Map([
  [
    'creature:giant-rat',
    {
      embeddedAttackLeadIns: 1,
      page: 378,
      reason:
        'The boxed "Variant: Diseased Giant Rats" sidebar prints its replacement "Bite. Melee Weapon Attack: …" inside the variant prose, emitted verbatim as the variants entry.',
    },
  ],
]);

interface NarrativeEntry {
  readonly text: string;
}

interface CreatureNarrative {
  readonly traits?: readonly NarrativeEntry[];
  readonly actions?: readonly NarrativeEntry[];
  readonly reactions?: readonly NarrativeEntry[];
  readonly variants?: readonly NarrativeEntry[];
  readonly legendaryActions?: { readonly entries?: readonly NarrativeEntry[] };
}

function entriesOf(record: RulesRecord): readonly NarrativeEntry[] {
  const data = record.data as CreatureNarrative;
  return [
    ...(data.traits ?? []),
    ...(data.actions ?? []),
    ...(data.reactions ?? []),
    ...(data.variants ?? []),
    ...(data.legendaryActions?.entries ?? []),
  ];
}

export interface CreatureAttackLeadInMismatch {
  readonly key: string;
  readonly sourceLeadIns: number;
  readonly entryLeadIns: number;
  readonly exceptedLeadIns: number;
}

export interface CreatureAttackLeadInAudit {
  readonly mismatches: readonly CreatureAttackLeadInMismatch[];
  /** Creatures whose printed name + meta line was not found in the source. */
  readonly unanchored: readonly string[];
  /** Exceptions whose creature is present but whose counts no longer need it. */
  readonly staleExceptions: readonly string[];
}

/** Count printed attack lead-ins per creature slice and compare to entries. */
export function auditCreatureAttackLeadIns(
  records: readonly RulesRecord[],
  pages: readonly PageText[],
): CreatureAttackLeadInAudit {
  const creatures = records.filter((record) => record.kind === 'creature');
  const byName = new Map(creatures.map((record) => [record.name, record]));
  const lines = pages.flatMap((page) => page.lines.map((line) => line.trim()));

  const anchors: { readonly index: number; readonly key: string }[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const record = byName.get(lines[i]);
    if (record !== undefined && META_LINE.test(lines[i + 1])) {
      anchors.push({ index: i, key: record.key });
    }
  }
  const anchoredKeys = new Set(anchors.map((anchor) => anchor.key));

  const sourceCounts = new Map<string, number>();
  anchors.forEach((anchor, n) => {
    const end = anchors[n + 1]?.index ?? lines.length;
    const text = lines.slice(anchor.index, end).join(' ');
    const count = text.match(ATTACK_LEAD_IN)?.length ?? 0;
    sourceCounts.set(anchor.key, (sourceCounts.get(anchor.key) ?? 0) + count);
  });

  const mismatches: CreatureAttackLeadInMismatch[] = [];
  const staleExceptions: string[] = [];
  for (const record of creatures) {
    const sourceLeadIns = sourceCounts.get(record.key);
    if (sourceLeadIns === undefined) continue;
    const entryLeadIns = entriesOf(record).filter((entry) =>
      ENTRY_OPENS_WITH_ATTACK.test(entry.text),
    ).length;
    const exceptedLeadIns =
      CREATURE_ATTACK_LEAD_IN_EXCEPTIONS.get(record.key)
        ?.embeddedAttackLeadIns ?? 0;
    if (sourceLeadIns !== entryLeadIns + exceptedLeadIns) {
      mismatches.push({
        key: record.key,
        sourceLeadIns,
        entryLeadIns,
        exceptedLeadIns,
      });
    } else if (exceptedLeadIns > 0 && sourceLeadIns === entryLeadIns) {
      staleExceptions.push(record.key);
    }
  }
  for (const key of CREATURE_ATTACK_LEAD_IN_EXCEPTIONS.keys()) {
    if (anchoredKeys.has(key)) continue;
    if (creatures.some((record) => record.key === key)) continue;
    staleExceptions.push(key);
  }

  return {
    mismatches,
    unanchored: creatures
      .filter((record) => !anchoredKeys.has(record.key))
      .map((record) => record.key),
    staleExceptions,
  };
}

/**
 * Fail closed when any creature's emitted attack entries disagree with the
 * attack lead-ins printed in its source slice. `requireComplete` is set only
 * for the real import, where every creature must be anchored and every
 * reviewed exception must still be live; reduced fixture PDFs check only what
 * they contain.
 */
export function assertCreatureAttackLeadInsSegmented(
  records: readonly RulesRecord[],
  pages: readonly PageText[],
  options: { readonly requireComplete: boolean },
): void {
  const audit = auditCreatureAttackLeadIns(records, pages);
  const problems: string[] = audit.mismatches.map(
    (m) =>
      `${m.key}: source prints ${m.sourceLeadIns} attack lead-in(s) but ${m.entryLeadIns} entr${m.entryLeadIns === 1 ? 'y opens' : 'ies open'} with one` +
      (m.exceptedLeadIns > 0 ? ` (+${m.exceptedLeadIns} reviewed)` : ''),
  );
  if (options.requireComplete) {
    problems.push(
      ...audit.unanchored.map(
        (key) => `${key}: printed name + size/type line not found in source`,
      ),
      ...audit.staleExceptions.map(
        (key) => `${key}: reviewed attack lead-in exception is stale`,
      ),
    );
  }
  if (problems.length > 0) {
    throw new CreatureAttackLeadInError(
      `Creature attack lead-in gate failed (eshyra-o9bd.19.2.2.1):\n  ${problems.join('\n  ')}`,
    );
  }
}
