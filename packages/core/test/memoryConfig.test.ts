import { describe, expect, it } from 'vitest';
import { validateMemoryConfig } from '../src/internal.js';

describe('validateMemoryConfig', () => {
  it('accepts other positive-integer configs', () => {
    const cfg = { arcRolloverThreshold: 1, recapWindowSize: 10 };
    expect(validateMemoryConfig(cfg)).toBe(cfg);
  });

  it('throws when arcRolloverThreshold is zero', () => {
    expect(() =>
      validateMemoryConfig({ arcRolloverThreshold: 0, recapWindowSize: 5 }),
    ).toThrow(/arcRolloverThreshold/);
  });

  it('throws when arcRolloverThreshold is non-integer', () => {
    expect(() =>
      validateMemoryConfig({ arcRolloverThreshold: 2.5, recapWindowSize: 5 }),
    ).toThrow(/arcRolloverThreshold/);
  });

  it('throws when recapWindowSize is zero', () => {
    expect(() =>
      validateMemoryConfig({ arcRolloverThreshold: 5, recapWindowSize: 0 }),
    ).toThrow(/recapWindowSize/);
  });

  it('throws when recapWindowSize is non-integer', () => {
    expect(() =>
      validateMemoryConfig({ arcRolloverThreshold: 5, recapWindowSize: 1.5 }),
    ).toThrow(/recapWindowSize/);
  });
});
