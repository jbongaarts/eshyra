import { describe, expect, it } from 'vitest';
import {
  getBundledDnd5eSrdPack,
  resolveRulesStack,
} from '../../src/internal.js';

// fable:F8 rule-key-duplication: many `rule` records share a display name
// (skills, speed, hit points, ...) because the SRD repeats a heading in
// different chapters. Distinct keys are distinct passages, not duplicates; a
// true duplicate would be two records carrying the same (or wholly contained)
// body text. Same-name distinct passages must stay separate identities and
// are surfaced together by discovery, never aliased (D3 sense pairs included).
describe('rule record duplication hygiene', () => {
  const stack = resolveRulesStack({ base: getBundledDnd5eSrdPack() });
  const rules = [...(stack.recordsByKind.get('rule')?.byName.values() ?? [])]
    .flat()
    .map((entry) => entry.record as { key: string; data: { text?: unknown } });
  // Compare the printed body text only: serializing the whole data object
  // would wrap each body in delimiters, so containment could never match.
  const text = (record: { data: { text?: unknown } }): string =>
    String(record.data.text ?? '')
      .toLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();

  it('has no two rule records with identical or wholly contained body text', () => {
    const seen = new Set<string>();
    const unique = rules.filter((r) => !seen.has(r.key) && seen.add(r.key));
    expect(unique.length).toBeGreaterThan(300);
    const duplicates: string[] = [];
    for (let i = 0; i < unique.length; i++)
      for (let j = i + 1; j < unique.length; j++) {
        const a = text(unique[i]);
        const b = text(unique[j]);
        if (a.length > 60 && b.length > 60 && (a.includes(b) || b.includes(a)))
          duplicates.push(`${unique[i].key} ~ ${unique[j].key}`);
      }
    expect(duplicates).toEqual([]);
  });

  it('keeps parallel sense definitions as distinct records', () => {
    const keys = new Set(rules.map((r) => r.key));
    for (const key of [
      'rule:darkvision',
      'rule:senses-darkvision',
      'rule:blindsight',
      'rule:senses-blindsight',
    ])
      expect(keys.has(key)).toBe(true);
  });
});
