/**
 * Unit tests for `excludeActionOwnedRuleDuplicates` (eshyra-t8gw.1): the
 * "Actions in Combat" `rule:*`/`action:*` duplicate-resolution helper used by
 * the D&D 5e SRD 5.1 importer's `runImporter`.
 */

import { describe, expect, it } from 'vitest';
import {
  ActionRuleDivergenceError,
  excludeActionOwnedRuleDuplicates,
} from '../../../scripts/importers/dnd5e-srd-5.1/actionOwnedRuleDedup.js';
import { STANDARD_ACTION_NAMES } from '../../../scripts/importers/dnd5e-srd-5.1/parseActions.js';
import type {
  ActionExtraction,
  RuleExtraction,
} from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function rule(name: string, text: string, sourcePage = 93): RuleExtraction {
  return { name, text, sourcePage };
}

function action(
  name: string,
  description: string,
  sourcePage = 93,
): ActionExtraction {
  return { name, description, sourcePage };
}

describe('excludeActionOwnedRuleDuplicates', () => {
  it('drops a rule whose name and text exactly match an action, keeps unrelated rules', () => {
    const rules = [
      rule('Dash', 'When you take the Dash action, you gain extra movement.'),
      rule('Cover', 'Walls, trees, and other obstacles can provide cover.'),
    ];
    const actions = [
      action('Dash', 'When you take the Dash action, you gain extra movement.'),
    ];

    const result = excludeActionOwnedRuleDuplicates(rules, actions);

    expect(result.map((r) => r.name)).toEqual(['Cover']);
  });

  it('is a no-op when no rule name matches any action name', () => {
    const rules = [
      rule('Cover', 'Walls, trees, and other obstacles can provide cover.'),
      rule('Speed', 'Every creature has a speed.'),
    ];
    const actions = [action('Dash', 'extra movement')];

    const result = excludeActionOwnedRuleDuplicates(rules, actions);

    expect(result).toEqual(rules);
  });

  it('derives the excluded set from the emitted actions, not a hand list of names', () => {
    // Every STANDARD_ACTION_NAMES entry excludes its same-named, same-text
    // rule duplicate -- generalized over parseActions' own action list rather
    // than a name literal in this test.
    const rules = STANDARD_ACTION_NAMES.map((name) =>
      rule(name, `${name} body text.`),
    );
    const actions = STANDARD_ACTION_NAMES.map((name) =>
      action(name, `${name} body text.`),
    );

    const result = excludeActionOwnedRuleDuplicates(rules, actions);

    expect(result).toEqual([]);
  });

  it('fails closed when a same-named rule diverges from the action description', () => {
    const rules = [
      rule(
        'Ready',
        'First, you decide what perceivable circumstance will trigger your reaction.',
      ),
    ];
    const actions = [
      action('Ready', 'A DIFFERENT description than the rule text above.'),
    ];

    expect(() => excludeActionOwnedRuleDuplicates(rules, actions)).toThrow(
      ActionRuleDivergenceError,
    );
    expect(() => excludeActionOwnedRuleDuplicates(rules, actions)).toThrow(
      /rule "Ready" duplicates the "Actions in Combat" heading/,
    );
  });

  it('preserves order and passes through rules unaffected by the filter', () => {
    const rules = [
      rule('Alpha', 'alpha text'),
      rule('Dash', 'dash text'),
      rule('Zeta', 'zeta text'),
    ];
    const actions = [action('Dash', 'dash text')];

    const result = excludeActionOwnedRuleDuplicates(rules, actions);

    expect(result.map((r) => r.name)).toEqual(['Alpha', 'Zeta']);
  });
});
