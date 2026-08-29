/**
 * Starting wealth is NOT an SRD 5.1 rule.
 *
 * This file previously asserted a full twelve-class table of formulas and
 * multipliers against the bundled SRD pack. Those values were compiler-authored
 * PHB content that the importer emitted under an SRD source line and the
 * CC-BY-4.0 SRD attribution block (ADR 0020 blocker B4, eshyra-o9bd.19.2.1.1).
 * They are gone from the pack and must not be reintroduced here — a test copy
 * of the table is still an unlicensed copy of the table.
 *
 * What remains under test: the bundled SRD stack reports the mode unavailable
 * with a truthful reason, and a separately licensed supplement re-enables it —
 * proving the mechanism was disabled by data, not deleted.
 */

import { describe, expect, it } from 'vitest';
import {
  createSeededRng,
  getBundledDnd5eCharacterResolver,
  resolveStartingWealth,
  rollStartingWealth,
  STARTING_WEALTH_UNAVAILABLE_MESSAGE,
  StartingWealthUnavailableError,
  validateStartingWealthResult,
} from '../src/internal.js';
import { getSyntheticStartingWealthResolver } from './support/startingWealthSupplement.js';

describe('starting wealth — unavailable under the bundled SRD pack', () => {
  const srd = getBundledDnd5eCharacterResolver();

  it('reports the mode unavailable rather than malformed', () => {
    expect(srd.startingWealthAvailable()).toBe(false);
    const result = srd.resolveStartingWealth('class:fighter');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // `malformed` would assert a record is present but broken. The record is
      // intentionally absent, so that claim would itself be false.
      expect(result.code).toBe('not_found');
      expect(result.message).toBe(STARTING_WEALTH_UNAVAILABLE_MESSAGE);
    }
  });

  it('throws a distinguishable unavailable error, not a generic failure', () => {
    expect(() => resolveStartingWealth('class:fighter', srd)).toThrow(
      StartingWealthUnavailableError,
    );
    expect(() => resolveStartingWealth('class:fighter', srd)).toThrow(
      STARTING_WEALTH_UNAVAILABLE_MESSAGE,
    );
  });

  it('reports unavailability for every bundled class, not just one', () => {
    for (const cls of srd.listClasses()) {
      const result = srd.resolveStartingWealth(cls.key);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toBe(STARTING_WEALTH_UNAVAILABLE_MESSAGE);
      }
    }
  });
});

describe('starting wealth — enabled by a licensed supplement', () => {
  const supplemented = getSyntheticStartingWealthResolver();

  it('becomes available when an add-on pack provides the table', () => {
    expect(supplemented.startingWealthAvailable()).toBe(true);
    const result = supplemented.resolveStartingWealth('class:fighter');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.classKey).toBe('class:fighter');
      expect(result.record.sourceRef).toBe('table:starting-wealth-by-class');
    }
  });

  it('rolls deterministically from the supplement values', () => {
    const resolved = resolveStartingWealth('class:fighter', supplemented);
    const left = rollStartingWealth(
      'class:fighter',
      createSeededRng(7),
      supplemented,
    );
    const right = rollStartingWealth(
      'class:fighter',
      createSeededRng(7),
      supplemented,
    );
    expect(left).toEqual(right);
    expect(left.totalGp).toBe(left.roll.total * resolved.multiplierGp);
  });

  it('supports a row with no multiplier', () => {
    const resolved = resolveStartingWealth('class:monk', supplemented);
    expect(resolved.multiplierGp).toBe(1);
  });

  it('rejects forged or inconsistent evidence', () => {
    const result = rollStartingWealth(
      'class:wizard',
      createSeededRng(2),
      supplemented,
    );
    expect(() =>
      validateStartingWealthResult(
        { ...result, totalGp: result.totalGp + 1 },
        supplemented,
      ),
    ).toThrow(/inconsistent/);
  });

  it('still reports an unknown class as unknown, not as unavailable', () => {
    const result = supplemented.resolveStartingWealth('class:nonexistent');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('not_found');
      expect(result.message).toContain('unknown class');
    }
  });
});
