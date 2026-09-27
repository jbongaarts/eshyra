/**
 * Action/rule duplicate resolution for the D&D 5e SRD 5.1 importer
 * (eshyra-t8gw.1).
 *
 * SRD 5.1 pp. 93-94 "Actions in Combat" prints ten standard-action headings
 * — Attack, Cast a Spell, Dash, Disengage, Dodge, Help, Hide, Ready, Search,
 * Use an Object — as a subsection of the core-rules chapter. `parseRules`
 * walks every heading in that chapter (real-PDF heading-hierarchy path) or
 * every heading-cased line at a paragraph boundary (fixture legacy-heuristic
 * path), so it also emits a `rule:*` leaf for each of these ten headings —
 * duplicating the SAME printed heading `parseActions` already owns as the
 * canonical `action:*` record with typed `data.mechanics`. One printed
 * heading must not produce two records (eshyra-t8gw); `action:*` is
 * canonical and the `rule:*` copy is dropped.
 *
 * The excluded set is derived from the emitted `actions`, never a
 * hand-authored name list, so it tracks whatever `parseActions` actually
 * emits. A rule is only dropped when its text is BYTE-IDENTICAL to the
 * owning action's description: if a future re-extraction changes one parse
 * but not the other, that is exactly the kind of silent divergence this
 * importer must fail closed on rather than keep dropping a rule whose text
 * no longer matches.
 */

import type { ActionExtraction, RuleExtraction } from './types.js';

export class ActionRuleDivergenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionRuleDivergenceError';
  }
}

/**
 * Filter `rules` (a core-rules-chapter `parseRules` result) down to the
 * records NOT already owned by one of `actions`' canonical `action:*`
 * records. A rule whose name matches an action's name is dropped only when
 * its text is verbatim-identical to that action's description; otherwise the
 * import fails closed naming the offending rule, since a text mismatch means
 * the two independent parses have diverged and dropping the rule would
 * silently discard the divergence instead of surfacing it.
 */
export function excludeActionOwnedRuleDuplicates(
  rules: readonly RuleExtraction[],
  actions: readonly ActionExtraction[],
): RuleExtraction[] {
  const actionsByName = new Map<string, ActionExtraction>(
    actions.map((action) => [action.name, action]),
  );
  return rules.filter((rule) => {
    const action = actionsByName.get(rule.name);
    if (action === undefined) return true;
    if (action.description !== rule.text) {
      throw new ActionRuleDivergenceError(
        `SRD 5.1 import: rule "${rule.name}" duplicates the "Actions in Combat" ` +
          `heading already emitted as the canonical action record, but the rule's ` +
          `text no longer matches the action's description verbatim. Refusing to ` +
          'silently drop the rule:* duplicate (eshyra-t8gw) — the two independent ' +
          'parses have diverged and need review before this heading can resolve to ' +
          'a single record.',
      );
    }
    return false;
  });
}
