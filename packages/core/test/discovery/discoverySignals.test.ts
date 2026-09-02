import { describe, expect, it } from 'vitest';
import {
  extractDiscoverySignals,
  getBundledDnd5eSrdPack,
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

  it('does not choose among ambiguous indexed names', () => {
    const trace = extractDiscoverySignals(
      {
        playerInput: 'ability score improvement',
        stateFields: { actor: 'pc-1' },
      },
      stack,
    );
    expect(trace.ambiguousNames.length).toBeGreaterThan(0);
    expect(
      trace.outputsProduced.some((signal) =>
        signal.proposes.includes('ability-score-improvement'),
      ),
    ).toBe(false);
  });
});
