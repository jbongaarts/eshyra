import { describe, expect, it } from 'vitest';
import {
  extractDiscoverySignals,
  getBundledDnd5eSrdPack,
  resolveDiscoveryCandidates,
  resolveRulesStack,
} from '../../src/internal.js';

describe('offline discovery signals', () => {
  const stack = resolveRulesStack({ base: getBundledDnd5eSrdPack() });

  it('extracts structured state references and situation cues independently', () => {
    const trace = extractDiscoverySignals(
      {
        playerInput: 'I duck behind the wall.',
        stateFields: {
          combat: { geometry: 'low wall between them' },
          selected: 'condition:incapacitated',
        },
      },
      stack,
    );
    expect(trace.outputsProduced.map((signal) => signal.proposes)).toContain(
      'condition:incapacitated',
    );
    expect(trace.outputsProduced).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'situation-cue',
          proposes: 'rule:cover',
        }),
      ]),
    );
    expect(
      trace.outputsProduced.find(
        (signal) => signal.proposes === 'condition:incapacitated',
      )?.evidence,
    ).toEqual(expect.objectContaining({ path: '/selected' }));
  });

  it('records unconsumed state leaves instead of treating an empty result as success', () => {
    const trace = extractDiscoverySignals(
      {
        playerInput: 'nothing relevant',
        stateFields: { opaque: { value: 4 } },
      },
      stack,
    );
    expect(trace.unconsumedStateFields).toEqual(
      expect.arrayContaining([{ path: '/opaque/value', valueShape: 'number' }]),
    );
    expect(trace.failedToRun).toBe(true);
    expect(trace.losses).toHaveLength(0);
  });

  it('surfaces every key of an ambiguous name with the ambiguity as a retrieval reason', () => {
    const trace = extractDiscoverySignals(
      { playerInput: 'ability score improvement', stateFields: {} },
      stack,
    );
    expect(trace.ambiguousNames.length).toBeGreaterThan(0);
    const ambiguous = trace.ambiguousNames.find(
      (observation) => observation.name === 'ability score improvement',
    );
    expect(ambiguous?.keys.length).toBeGreaterThan(1);
    const mentions = trace.outputsProduced.filter(
      (signal) =>
        signal.kind === 'name-mention' &&
        signal.evidence.matchedName === 'ability score improvement',
    );
    expect(mentions.map((signal) => signal.proposes).sort()).toEqual(
      ambiguous?.keys,
    );
    for (const mention of mentions)
      expect(mention.evidence.ambiguousWith).toEqual(
        ambiguous?.keys.filter((key) => key !== mention.proposes),
      );
  });

  it('surfaces both action:hide and equipment:hide for "I hide" with the ambiguity reason', () => {
    const trace = extractDiscoverySignals(
      { playerInput: 'I hide', stateFields: {} },
      stack,
    );
    const mentions = trace.outputsProduced.filter(
      (signal) => signal.kind === 'name-mention',
    );
    expect(mentions.map((signal) => signal.proposes)).toEqual(
      expect.arrayContaining(['action:hide', 'equipment:hide']),
    );
    expect(
      mentions.find((signal) => signal.proposes === 'action:hide')?.evidence,
    ).toEqual(expect.objectContaining({ ambiguousWith: ['equipment:hide'] }));
    const candidates = resolveDiscoveryCandidates(trace, stack, {
      playerInput: 'I hide',
      stateFields: {},
    });
    expect(candidates.produced).toEqual(
      expect.arrayContaining(['action:hide', 'equipment:hide']),
    );
  });

  it('leaves a unique name mention without an ambiguity reason', () => {
    const trace = extractDiscoverySignals(
      { playerInput: 'I am incapacitated', stateFields: {} },
      stack,
    );
    const unique = trace.outputsProduced.find(
      (signal) => signal.proposes === 'condition:incapacitated',
    );
    expect(unique?.kind).toBe('name-mention');
    expect(unique?.evidence).not.toHaveProperty('ambiguousWith');
  });

  it('surfaces both parallel sense definitions for a shared sense name without aliasing them', () => {
    const trace = extractDiscoverySignals(
      { playerInput: 'I have darkvision', stateFields: {} },
      stack,
    );
    const keys = trace.outputsProduced
      .filter((signal) => signal.kind === 'name-mention')
      .map((signal) => signal.proposes);
    expect(keys).toEqual(
      expect.arrayContaining(['rule:darkvision', 'rule:senses-darkvision']),
    );
  });
});
