/**
 * Condition-relation semantics for `mechanics.conditions` entries in generated
 * rules packs.
 *
 * A `mechanics.conditions` entry records what an effect's source text SAYS
 * about a condition, not just that the condition was mentioned. Raw
 * condition-name matches conflate "this effect applies the condition" with
 * prevention clauses, removal clauses, advantage clauses, immunity clauses,
 * targeting exclusions, and incidental prose (eshyra-qqyj, eshyra-o9bd.18.3) —
 * unsafe for deterministic game-state logic: a tool acting on Branding Smite's
 * "can't become invisible" as "apply Invisible" would do the opposite of the
 * SRD effect.
 *
 * This module is the single shared implementation: the SRD importer's
 * mechanics projection derives relations from it, `kindSchemas` validates
 * against its closed vocabulary, and the `condition-relation-safety` audit
 * gate in `srdAudit.ts` re-derives every emitted relation from the record's
 * own source text so importer output and audit expectations cannot drift
 * (same pattern as `SRD_5_1_TABLE_OWNERS`).
 *
 * ## Relation vocabulary (closed) — contract for deterministic consumers
 *
 * State mutations (a consumer may act on these):
 * - `applies`  — the effect inflicts the condition ("becomes frightened",
 *                "is knocked prone", "must succeed ... or be poisoned").
 * - `removes`  — the effect ends the condition ("is no longer charmed",
 *                "end ... The condition can be blinded, deafened, ...").
 *
 * Non-mutating relations (descriptive; a consumer must NOT apply or remove
 * the condition from these — consult the source text):
 * - `prevents`     — the effect blocks the condition from being applied
 *                    ("can't be charmed, frightened, or possessed by them",
 *                    "can't become invisible until the spell ends").
 * - `suppresses`   — the effect temporarily suppresses an existing condition
 *                    without ending it ("You can suppress any effect causing
 *                    a target to be charmed or frightened").
 * - `immune`       — an immunity/protection statement ("immune to being
 *                    frightened", "unaffected by ...").
 * - `advantage`    — grants advantage on saves/checks against the condition.
 * - `disadvantage` — imposes disadvantage related to the condition.
 * - `exclusion`    — a targeting/benefit exclusion ("ignoring unconscious
 *                    creatures", "if you are incapacitated ... you lose this
 *                    benefit", "already restrained").
 * - `gates`        — the condition is a precondition or targeting gate, not
 *                    an output ("while the vampire is incapacitated in its
 *                    resting place", "a creature that is grappled",
 *                    "creatures that can't be charmed are immune").
 * - `mention`      — any other mention; no structured claim at all.
 *
 * The eshyra-o9bd.18.3 acceptance vocabulary maps onto these names as:
 * inflicts=`applies`, prevents=`prevents`, removes=`removes`,
 * suppresses=`suppresses`, protectsFrom/immunizesAgainst=`immune`,
 * grantsAdvantageAgainst=`advantage`, excludes=`exclusion`, gatesOn=`gates`,
 * mentions=`mention`.
 */

/** Closed relation vocabulary; `kindSchemas` validates against this list. */
export const CONDITION_RELATION_VALUES = [
  'applies',
  'removes',
  'prevents',
  'suppresses',
  'immune',
  'advantage',
  'disadvantage',
  'exclusion',
  'gates',
  'mention',
] as const;

export type ConditionRelation = (typeof CONDITION_RELATION_VALUES)[number];

/**
 * The 14 SRD 5.1 condition names that appear as adjectives in effect prose
 * (Appendix A. Exhaustion never reads as "is exhaustion", but it IS applied
 * by its own phrasing — "suffer(s) one level of exhaustion" (Berserker
 * Frenzy, Sewer Plague, Cackle Fever) — which the applies grammar
 * recognizes; eshyra-o9bd.18.7.5.)
 */
export const MECHANICS_CONDITION_NAMES = [
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
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

// "can't" / "cannot" with straight or curly apostrophe.
const CANT = `(?:can(?:['’])?t|cannot)`;

// A comma-separated condition list tail, so list phrasings resolve for every
// listed condition, not just the first: "can't be charmed, frightened, or
// possessed" must classify `frightened` too. Items are single words only, so
// the wildcard cannot swallow an unrelated clause.
const LIST = String.raw`(?:\w+(?:,\s*(?:(?:or|and)\s+)?|\s+(?:or|and)\s+))*`;

/**
 * Negation immediately preceding an applies-shaped phrase ("it isn't knocked
 * unconscious", "doesn't fall prone", "can't become invisible"). Tested
 * against the text BEFORE a candidate applies match; part of the guard that
 * prevention/negation phrasing can never be emitted as `applies`.
 */
const NEGATION_BEFORE_RE = new RegExp(
  String.raw`(?:\b(?:is|are|was|were|does|do|did|has|have|had|would|will|could|should)n(?:['’])?t|\bnot|\bnever|\bnor|\bno longer|\b${CANT}|\bwon(?:['’])?t)\s+(?:\w+\s+)?$`,
  'i',
);

/**
 * Whether `re` matches `sentence` at a position NOT immediately preceded by a
 * negation ("isn't knocked unconscious" is not an application of unconscious).
 */
function matchesWithoutNegation(sentence: string, re: RegExp): boolean {
  for (const match of sentence.matchAll(re)) {
    if (!NEGATION_BEFORE_RE.test(sentence.slice(0, match.index))) return true;
  }
  return false;
}

// Checked in this order per sentence; the first matching relation wins. Order
// matters three ways: an advantage-against-conditions list ("...or knocked
// unconscious") must be `advantage`, not `applies`; a relative-clause immunity
// gate ("creatures that can't be charmed are immune") must be `gates`, not
// `prevents`; and `exclusion` stays ahead of `gates` so the established
// exclusion phrasings keep their classification.
const RELATION_PATTERNS: readonly {
  readonly relation: ConditionRelation;
  readonly test: (sentence: string, condition: string) => boolean;
}[] = [
  {
    relation: 'removes',
    test: (s, c) =>
      new RegExp(`\\bno longer\\s+(?:being\\s+)?${LIST}${c}\\b`, 'i').test(s) ||
      new RegExp(`\\bceases?\\s+to\\s+be\\s+${c}\\b`, 'i').test(s) ||
      new RegExp(`\\b${c}\\s+condition\\s+(?:also\\s+)?ends\\b`, 'i').test(s) ||
      new RegExp(`\\bremoves?\\s+the\\s+${c}\\b`, 'i').test(s) ||
      // Lesser Restoration's removal list: "end either one disease or one
      // condition afflicting it. The condition can be blinded, deafened,
      // paralyzed, or poisoned."
      new RegExp(`\\bcondition\\s+can\\s+be\\s+${LIST}${c}\\b`, 'i').test(s),
  },
  {
    relation: 'suppresses',
    // Calm Emotions: "You can suppress any effect causing a target to be
    // charmed or frightened." Suppression pauses the condition's effect; it
    // neither applies nor ends it.
    test: (s, c) =>
      new RegExp(`\\bsuppress\\w*\\b[^.;]*\\b${c}\\b`, 'i').test(s),
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
      // "knocked"/"fall(s)" may carry the condition inside a benefit-end or
      // revert trigger ("It ends early if you are knocked unconscious" —
      // Rage; "ends early only if you fall unconscious" — Persistent Rage;
      // "You automatically revert if you fall unconscious" — Wild Shape).
      // The benefit/form ends when the condition arrives; the feature does
      // not apply it (eshyra-o9bd.18.7.5).
      new RegExp(
        `\\bif\\s+(?:\\w+\\s+){0,3}(?:(?:are|is)\\s+(?:already\\s+)?(?:knocked\\s+)?|falls?\\s+)${c}\\b`,
        'i',
      ).test(s) ||
      // Benefit-eligibility gate phrased as a can't-be list ("To gain this
      // benefit, you can't be blinded, deafened, or incapacitated" — Danger
      // Sense). The absence of the condition gates the benefit; nothing is
      // prevented (eshyra-o9bd.18.7.5).
      new RegExp(
        `\\bTo gain (?:this|the) benefit[^.]*\\b${CANT}\\s+be\\b[^.]*\\b${c}\\b`,
        'i',
      ).test(s) ||
      new RegExp(`\\balready\\s+${c}\\b`, 'i').test(s),
  },
  {
    relation: 'gates',
    test: (s, c) =>
      // Subordinate-clause precondition: "unless the creature is
      // incapacitated", "while the vampire is incapacitated in its resting
      // place", "until the devil is incapacitated or dies". The wildcard
      // cannot cross a comma, so "If the target is a Large or smaller
      // creature, it is grappled" keeps its `applies` reading.
      new RegExp(
        `\\b(?:if|unless|while|until|once)\\s+[^,;:.]*\\b(?:is|are|was|were|becomes?)\\s+(?:already\\s+)?${c}\\b`,
        'i',
      ).test(s) ||
      // Relative-clause targeting gate: "a creature that is grappled by the
      // vampire, incapacitated, or restrained".
      new RegExp(
        `\\b(?:that|who)\\s+(?:is|are)\\s+(?:already\\s+)?${c}\\b`,
        'i',
      ).test(s) ||
      // Immunity/auto-success gate on the condition: "Creatures that can't be
      // charmed are immune to this spell", "automatically succeeds ... if it
      // can't be charmed". The spell doesn't prevent the condition; it is
      // gated on the target's existing immunity to it.
      new RegExp(
        `\\b(?:that|who|if\\s+\\w+)\\s+${CANT}\\s+be(?:come)?\\s+${LIST}${c}\\b`,
        'i',
      ).test(s),
  },
  {
    relation: 'prevents',
    test: (s, c) =>
      // "The target also can't be charmed, frightened, or possessed by them",
      // "can't become invisible until the spell ends", "The devil can't be
      // frightened while it can see an allied creature".
      new RegExp(
        `\\b${CANT}\\s+(?:be(?:come)?|being)\\s+${LIST}${c}\\b`,
        'i',
      ).test(s) ||
      // Negated causation: "magical effects can't reduce its speed or cause
      // it to be restrained" (Kraken's Freedom of Movement trait).
      new RegExp(
        `\\b(?:${CANT}|neither|nor)\\b[^,;:.]*\\bcause[sd]?\\b[^,;:.]*\\bbe(?:come)?\\s+${LIST}${c}\\b`,
        'i',
      ).test(s),
  },
  {
    relation: 'applies',
    test: (s, c) =>
      matchesWithoutNegation(
        s,
        // "both" may interpose ("you and the creature are both restrained"
        // — the Grappler feat's pin applies restrained on success;
        // eshyra-o9bd.18.7.5).
        new RegExp(
          `\\b(?:becomes?|falls?|be|is|are|knocked|suffers?(?:\\s+\\w+)?\\s+levels?\\s+of)\\s+(?:both\\s+)?${c}\\b`,
          'gi',
        ),
      ),
  },
];

// A condition can be mentioned in more than one sentence with different
// relations (sleep's "ignoring unconscious creatures" exclusion clause vs.
// its "falls unconscious" effect clause; hallow's frightened is removed,
// prevented, AND inflicted by different chosen effects). When that happens,
// the state mutation the source text actually performs is what matters most
// to a deterministic consumer, so `applies`/`removes` outrank the merely
// descriptive relations — independent of RELATION_PATTERNS' per-sentence
// match order, which is tuned to avoid false positives within one sentence.
const AGGREGATION_PRIORITY: readonly ConditionRelation[] = [
  'applies',
  'removes',
  'prevents',
  'suppresses',
  'immune',
  'advantage',
  'disadvantage',
  'exclusion',
  'gates',
  'mention',
];

export function splitConditionSentences(text: string): readonly string[] {
  return text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.length > 0);
}

export function classifyConditionRelation(
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

/**
 * Derive the full `mechanics.conditions` projection for one effect text:
 * one entry per SRD condition name mentioned anywhere in the text, with the
 * aggregated relation.
 */
export function deriveConditionMechanics(
  text: string,
): readonly { condition: string; relation: ConditionRelation }[] {
  const sentences = splitConditionSentences(text);
  const out: { condition: string; relation: ConditionRelation }[] = [];
  for (const condition of MECHANICS_CONDITION_NAMES) {
    if (new RegExp(`\\b${condition}\\b`, 'i').test(text)) {
      out.push({
        condition,
        relation: classifyConditionRelation(sentences, condition),
      });
    }
  }
  return out;
}
