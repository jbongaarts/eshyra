import { describe, expect, it } from 'vitest';
import { createDefaultToolRegistry } from '../../src/index.js';
import type { RulesRecordKind } from '../../src/internal.js';
import {
  extractDiscoverySignals,
  getBundledDnd5eSrdPack,
  projectDiscoveryTrace,
  RULES_LOOKUP_AMBIGUOUS_CANDIDATE_CAP,
  RULES_RECORD_KINDS,
  renderContextPacketMessage,
  resolveRulesStack,
  runDiscoveryStages,
} from '../../src/internal.js';
import { freshDbWithSession } from '../support/db.js';

/**
 * Name-mention discovery boundary (eshyra-o9bd.19.2.4.3, Sol S1/S3):
 * - S1: a key indexed under several names keeps ONE canonical identity (one
 *   signal, so route count and retention ranking are unchanged) but every
 *   independently meaningful matched-name reason, each with its own sibling
 *   set, survives into signal, candidate, packet and durable projection.
 * - S3: input and index names are compared under one punctuation folding.
 * Expected values are derived here from the index, not from the extractor.
 */
const stack = resolveRulesStack({ base: getBundledDnd5eSrdPack() });

type Entry = { record: { key: string } };
type ByName = ReadonlyMap<string, readonly Entry[]>;

/**
 * Independent folding (a tokenizer, not the production replace chain): drop
 * apostrophes, keep runs of letters/digits optionally joined by single inner
 * hyphens, and treat everything else as a boundary.
 */
const fold = (text: string): string =>
  (
    text
      .toLowerCase()
      .replace(/[’']/gu, '')
      .match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? []
  ).join(' ');

/** name -> keys over all kinds, and key -> names (same-kind index). */
function indexes(source: typeof stack = stack) {
  const keysByName = new Map<string, Set<string>>();
  const namesByKey = new Map<string, Set<string>>();
  for (const kind of RULES_RECORD_KINDS) {
    const byName = source.recordsByKind.get(kind)?.byName as ByName | undefined;
    for (const [name, entries] of byName ?? []) {
      for (const { record } of entries) {
        keysByName.set(
          name,
          (keysByName.get(name) ?? new Set()).add(record.key),
        );
        namesByKey.set(
          record.key,
          (namesByKey.get(record.key) ?? new Set()).add(name),
        );
      }
    }
  }
  return { keysByName, namesByKey };
}

function reversedStack(): typeof stack {
  const recordsByKind = new Map<RulesRecordKind, never>();
  for (const [kind, index] of stack.recordsByKind)
    recordsByKind.set(kind, {
      ...index,
      byName: new Map([...index.byName].reverse()),
    } as never);
  return { ...stack, recordsByKind } as typeof stack;
}

function reasonsOf(evidence: Record<string, unknown>) {
  const list = (evidence.matchedNames ?? [evidence]) as {
    matchedName: string;
    ambiguousWith?: string[];
  }[];
  return list.map((reason) => ({
    name: reason.matchedName,
    siblings: [...(reason.ambiguousWith ?? [])].sort(),
  }));
}

describe('name-mention reasons survive per key', () => {
  const { keysByName, namesByKey } = indexes();
  const multiNamed = [...namesByKey]
    .filter(([, names]) => names.size > 1)
    .sort(([a], [b]) => (a < b ? -1 : 1));

  it('has real overlapping indexed names to exercise', () => {
    expect(multiNamed.map(([key]) => key)).toContain(
      'feature:wizard:spellcasting',
    );
  });

  for (const [label, source] of [
    ['index order', stack],
    ['reversed index order', reversedStack()],
  ] as const) {
    it(`emits every matched name with its own siblings, one signal per key (${label})`, () => {
      for (const [key, names] of multiNamed) {
        const playerInput = `I mention ${[...names].join(' and ')}`;
        const trace = extractDiscoverySignals(
          { playerInput, stateFields: {} },
          source,
        );
        const mentions = trace.outputsProduced.filter(
          (signal) => signal.kind === 'name-mention' && signal.proposes === key,
        );
        expect(mentions).toHaveLength(1);
        const reasons = reasonsOf(mentions[0]?.evidence ?? {});
        const folded = fold(playerInput);
        const expected = [...names]
          .filter((name) => ` ${folded} `.includes(` ${fold(name)} `))
          .sort()
          .map((name) => ({
            name,
            siblings: [...(keysByName.get(name) ?? [])]
              .filter((other) => other !== key)
              .sort(),
          }));
        expect([...reasons].sort((a, b) => (a.name < b.name ? -1 : 1))).toEqual(
          expected,
        );
      }
    });
  }

  it('carries spellbook + cantrips reasons into candidates, packet text and durable projection', () => {
    const db = freshDbWithSession();
    try {
      const trace = runDiscoveryStages({
        db,
        stack,
        scenario: {
          playerInput: 'I know spellbook and cantrips',
          stateFields: {},
        },
      });
      const key = 'feature:wizard:spellcasting';
      const candidate = trace.candidates.outputsProduced.find(
        (item) => item.candidateKey === key,
      );
      expect(candidate?.routes).toHaveLength(1);
      expect(
        reasonsOf(candidate?.routes[0]?.evidence ?? {}).map(
          (reason) => reason.name,
        ),
      ).toEqual(expect.arrayContaining(['spellbook', 'cantrips']));
      const spellbook = reasonsOf(candidate?.routes[0]?.evidence ?? {}).find(
        (reason) => reason.name === 'spellbook',
      );
      expect(spellbook?.siblings).toContain('equipment:spellbook');
      const packetCandidate = trace.packet.packet.candidates.find(
        (item) => item.identity.key === key,
      );
      expect(packetCandidate).toBeDefined();
      expect(
        reasonsOf(packetCandidate?.routes[0]?.evidence ?? {}).map(
          (reason) => reason.name,
        ),
      ).toEqual(expect.arrayContaining(['spellbook', 'cantrips']));
      const rendered = JSON.stringify(renderContextPacketMessage(trace));
      expect(rendered).toContain('equipment:spellbook');
      expect(JSON.stringify(projectDiscoveryTrace(trace))).toContain(
        '"matchedNames"',
      );
    } finally {
      db.close();
    }
  });
});

describe('name-mention punctuation folding', () => {
  const { keysByName } = indexes();
  const cases = [
    { input: 'I use Land’s Stride', expected: "land's stride" },
    { input: "I use Land's Stride", expected: "land's stride" },
    { input: 'I use Lands Stride', expected: "land's stride" },
    {
      input: 'We buy Food, Drink, and Lodging',
      expected: 'food, drink, and lodging',
    },
    {
      input: 'We buy food drink and lodging',
      expected: 'food, drink, and lodging',
    },
  ];
  for (const { input, expected } of cases)
    it(`finds every indexed key of "${expected}" for "${input}"`, () => {
      const keys = [...(keysByName.get(expected) ?? [])].sort();
      expect(keys.length).toBeGreaterThan(0);
      const db = freshDbWithSession();
      try {
        const trace = runDiscoveryStages({
          db,
          stack,
          scenario: { playerInput: input, stateFields: {} },
        });
        const signalled = trace.signals.outputsProduced
          .filter((signal) => signal.kind === 'name-mention')
          .map((signal) => signal.proposes);
        const retained = trace.packet.packet.candidates.map(
          (item) => item.identity.key,
        );
        for (const key of keys) {
          expect(signalled).toContain(key);
          expect(trace.candidates.produced).toContain(key);
          expect(retained).toContain(key);
        }
      } finally {
        db.close();
      }
    });

  // Indexed names written with each punctuation form a player might put beside
  // them still surface every key indexed under that exact name. One form per
  // folding path (colon/terminal punctuation, brackets, quotes, dashes, stray
  // hyphen). Population: every ambiguous name and every name that itself
  // contains punctuation, plus a deterministic stride through the rest (cost
  // grows with forms x population x index size, so the population is bounded).
  // Names are batched per input; the assertion is per name, so batching cannot
  // mask a miss.
  const forms: readonly ((name: string) => string)[] = [
    (n) => `${n}: what does it do?`,
    (n) => `(${n}).`,
    (n) => `“${n}”`,
    (n) => `${n} — then`,
    (n) => `${n}-`,
  ];
  it('surfaces indexed names next to every punctuation form', () => {
    const all = [...keysByName.keys()].filter((name) => fold(name) !== '');
    const names = all.filter(
      (name, index) =>
        (keysByName.get(name)?.size ?? 0) > 1 ||
        /[^\p{L}\p{N} ]/u.test(name) ||
        index % 25 === 0,
    );
    expect(names.length).toBeGreaterThan(100);
    const missed: string[] = [];
    forms.forEach((form, formIndex) => {
      for (let i = 0; i < names.length; i += 60) {
        const batch = names.slice(i, i + 60);
        const trace = extractDiscoverySignals(
          { playerInput: batch.map(form).join(' x '), stateFields: {} },
          stack,
        );
        const signalled = new Set(
          trace.outputsProduced
            .filter((signal) => signal.kind === 'name-mention')
            .map((signal) => signal.proposes),
        );
        for (const name of batch)
          for (const key of keysByName.get(name) ?? [])
            if (!signalled.has(key)) missed.push(`${formIndex}:${name}:${key}`);
      }
    });
    expect(missed).toEqual([]);
  });

  it('keeps a possessive in the input reaching the unpossessed indexed name', () => {
    const trace = extractDiscoverySignals(
      { playerInput: "the wizard's hide", stateFields: {} },
      stack,
    );
    const names = trace.outputsProduced.map((signal) =>
      String(signal.evidence.matchedName),
    );
    expect(names).toContain('hide');
  });
});

describe('lookup_rules ambiguous output contract', () => {
  const cases: { kind: RulesRecordKind; name: string }[] = [
    { kind: 'rule', name: 'Darkvision' },
    { kind: 'feature', name: 'Spellcasting' },
    { kind: 'feature', name: 'Ability Score Improvement' },
  ];
  for (const { kind, name } of cases)
    it(`qualifies every shown ${kind} candidate for ${name}`, () => {
      const db = freshDbWithSession();
      try {
        const result = createDefaultToolRegistry().invoke(
          'lookup_rules',
          { kind, name, systemId: 'dnd5e-srd' },
          {
            db,
            rng: () => 0.5,
            campaignId: 'campaign-1',
            sessionId: 'session-1',
            turnId: 'turn-1',
            at: '2026-05-20T10:00:00.000Z',
          } as never,
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        const data = result.data as {
          candidateKeys: string[];
          candidates: {
            key: string;
            kind: string;
            name: string;
            source: string;
            locator?: string;
          }[];
        };
        expect(data.candidateKeys.length).toBeGreaterThan(1);
        expect(data.candidateKeys.length).toBeLessThanOrEqual(
          RULES_LOOKUP_AMBIGUOUS_CANDIDATE_CAP,
        );
        expect(data.candidates.map((card) => card.key)).toEqual(
          data.candidateKeys,
        );
        const records = getBundledDnd5eSrdPack().records;
        for (const card of data.candidates) {
          const record = records.find((item) => item.key === card.key);
          expect(card).toMatchObject({
            kind: record?.kind,
            name: record?.name,
            source: record?.source,
            locator: record?.provenance.locator,
          });
        }
      } finally {
        db.close();
      }
    });
});
