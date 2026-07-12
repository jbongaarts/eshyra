import { describe, expect, it } from 'vitest';
import {
  initSchema,
  LiveStateSchemaError,
  MutateStateError,
  mutateState,
  openDatabase,
  validateAbilityScoresJson,
  validateConditionsJson,
  validateInventoryPropertiesJson,
} from '../src/internal.js';

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const VALID_SCORES = {
  strength: 10,
  dexterity: 14,
  constitution: 12,
  intelligence: 8,
  wisdom: 13,
  charisma: 15,
};

// ---------------------------------------------------------------------------
// validateAbilityScoresJson
// ---------------------------------------------------------------------------

describe('validateAbilityScoresJson', () => {
  it('accepts a canonical object with all six keys in range', () => {
    const result = validateAbilityScoresJson(VALID_SCORES, 'test');
    expect(result).toEqual(VALID_SCORES);
  });

  it('accepts boundary values 1 and 30', () => {
    const scores = { ...VALID_SCORES, strength: 1, charisma: 30 };
    expect(() => validateAbilityScoresJson(scores, 'test')).not.toThrow();
  });

  it('rejects a non-object root (string)', () => {
    expect(() => validateAbilityScoresJson('10', 'test')).toThrow(
      LiveStateSchemaError,
    );
  });

  it('rejects an array root', () => {
    expect(() => validateAbilityScoresJson([1, 2, 3, 4, 5, 6], 'test')).toThrow(
      LiveStateSchemaError,
    );
  });

  it('rejects null', () => {
    expect(() => validateAbilityScoresJson(null, 'test')).toThrow(
      LiveStateSchemaError,
    );
  });

  it('rejects a missing required key (drop wisdom)', () => {
    const { wisdom: _w, ...noWisdom } = VALID_SCORES;
    expect(() => validateAbilityScoresJson(noWisdom, 'test')).toThrow(
      LiveStateSchemaError,
    );
    expect(() => validateAbilityScoresJson(noWisdom, 'test')).toThrow(
      "missing required key 'wisdom'",
    );
  });

  it('rejects an extra unknown key', () => {
    const extra = { ...VALID_SCORES, luck: 12 };
    expect(() => validateAbilityScoresJson(extra, 'test')).toThrow(
      LiveStateSchemaError,
    );
    expect(() => validateAbilityScoresJson(extra, 'test')).toThrow(
      "unknown key 'luck'",
    );
  });

  it('rejects a non-integer value (string "10")', () => {
    const bad = { ...VALID_SCORES, strength: '10' };
    expect(() => validateAbilityScoresJson(bad, 'test')).toThrow(
      LiveStateSchemaError,
    );
  });

  it('rejects NaN', () => {
    const bad = { ...VALID_SCORES, strength: Number.NaN };
    expect(() => validateAbilityScoresJson(bad, 'test')).toThrow(
      LiveStateSchemaError,
    );
  });

  it('rejects Infinity', () => {
    const bad = { ...VALID_SCORES, strength: Number.POSITIVE_INFINITY };
    expect(() => validateAbilityScoresJson(bad, 'test')).toThrow(
      LiveStateSchemaError,
    );
  });

  it('rejects a value below 1 (0)', () => {
    const bad = { ...VALID_SCORES, strength: 0 };
    expect(() => validateAbilityScoresJson(bad, 'test')).toThrow(
      LiveStateSchemaError,
    );
    expect(() => validateAbilityScoresJson(bad, 'test')).toThrow(
      'between 1 and 30',
    );
  });

  it('rejects a value above 30 (31)', () => {
    const bad = { ...VALID_SCORES, strength: 31 };
    expect(() => validateAbilityScoresJson(bad, 'test')).toThrow(
      LiveStateSchemaError,
    );
    expect(() => validateAbilityScoresJson(bad, 'test')).toThrow(
      'between 1 and 30',
    );
  });

  it('rejects a class instance root (e.g. Date)', () => {
    expect(() => validateAbilityScoresJson(new Date(), 'test')).toThrow(
      LiveStateSchemaError,
    );
    expect(() => validateAbilityScoresJson(new Date(), 'test')).toThrow(
      'must be a plain JSON object',
    );
  });
});

// ---------------------------------------------------------------------------
// validateConditionsJson
// ---------------------------------------------------------------------------

describe('validateConditionsJson', () => {
  it('accepts an empty array', () => {
    const result = validateConditionsJson([], 'test');
    expect(result).toEqual([]);
  });

  it('accepts an array of objects with non-empty id', () => {
    const conditions = [{ id: 'poisoned' }, { id: 'blinded' }];
    const result = validateConditionsJson(conditions, 'test');
    expect(result).toEqual(conditions);
  });

  it('accepts entries with extra arbitrary JSON-value fields', () => {
    const conditions = [
      {
        id: 'exhaustion',
        level: 2,
        source: 'wilderness',
        tags: ['fatigue'],
        meta: { applied: true },
      },
    ];
    expect(() => validateConditionsJson(conditions, 'test')).not.toThrow();
  });

  it('rejects a non-array root (object)', () => {
    expect(() => validateConditionsJson({ id: 'poisoned' }, 'test')).toThrow(
      LiveStateSchemaError,
    );
  });

  it('rejects a non-array root (string)', () => {
    expect(() => validateConditionsJson('poisoned', 'test')).toThrow(
      LiveStateSchemaError,
    );
  });

  it('rejects an entry that is a string', () => {
    expect(() => validateConditionsJson(['poisoned'], 'test')).toThrow(
      LiveStateSchemaError,
    );
  });

  it('rejects an entry that is a number', () => {
    expect(() => validateConditionsJson([42], 'test')).toThrow(
      LiveStateSchemaError,
    );
  });

  it('rejects an entry that is null', () => {
    expect(() => validateConditionsJson([null], 'test')).toThrow(
      LiveStateSchemaError,
    );
  });

  it('rejects an entry missing id', () => {
    expect(() =>
      validateConditionsJson([{ severity: 'moderate' }], 'test'),
    ).toThrow(LiveStateSchemaError);
    expect(() =>
      validateConditionsJson([{ severity: 'moderate' }], 'test'),
    ).toThrow('id must be a non-empty string');
  });

  it('rejects an entry with empty-string id', () => {
    expect(() => validateConditionsJson([{ id: '' }], 'test')).toThrow(
      LiveStateSchemaError,
    );
    expect(() => validateConditionsJson([{ id: '' }], 'test')).toThrow(
      'id must be a non-empty string',
    );
  });
});

// ---------------------------------------------------------------------------
// validateInventoryPropertiesJson
// ---------------------------------------------------------------------------

describe('validateInventoryPropertiesJson', () => {
  it('accepts an empty object', () => {
    const result = validateInventoryPropertiesJson({}, 'test');
    expect(result).toEqual({});
  });

  it('accepts nested objects and arrays of plain JSON values', () => {
    const props = {
      damage: '1d6',
      magical: true,
      charges: 3,
      tags: ['silvered', 'holy'],
      enchantments: { name: 'Flaming', level: 1 },
    };
    expect(() => validateInventoryPropertiesJson(props, 'test')).not.toThrow();
  });

  it('accepts null leaf values', () => {
    const props = { owner: null };
    expect(() => validateInventoryPropertiesJson(props, 'test')).not.toThrow();
  });

  it('rejects an array root', () => {
    expect(() => validateInventoryPropertiesJson(['foo'], 'test')).toThrow(
      LiveStateSchemaError,
    );
  });

  it('rejects a null root', () => {
    expect(() => validateInventoryPropertiesJson(null, 'test')).toThrow(
      LiveStateSchemaError,
    );
  });

  it('rejects a string root', () => {
    expect(() => validateInventoryPropertiesJson('enchanted', 'test')).toThrow(
      LiveStateSchemaError,
    );
  });

  it('rejects a nested NaN value', () => {
    const props = { damage: Number.NaN };
    expect(() => validateInventoryPropertiesJson(props, 'test')).toThrow(
      LiveStateSchemaError,
    );
  });

  it('rejects a nested Infinity value', () => {
    const props = { weight: Number.POSITIVE_INFINITY };
    expect(() => validateInventoryPropertiesJson(props, 'test')).toThrow(
      LiveStateSchemaError,
    );
  });

  it('rejects a root Date object', () => {
    expect(() => validateInventoryPropertiesJson(new Date(), 'test')).toThrow(
      LiveStateSchemaError,
    );
    expect(() => validateInventoryPropertiesJson(new Date(), 'test')).toThrow(
      'must be a plain JSON object',
    );
  });

  it('rejects a root class instance', () => {
    class Weapon {
      name = 'sword';
    }
    expect(() => validateInventoryPropertiesJson(new Weapon(), 'test')).toThrow(
      LiveStateSchemaError,
    );
    expect(() => validateInventoryPropertiesJson(new Weapon(), 'test')).toThrow(
      'must be a plain JSON object',
    );
  });
});

// ---------------------------------------------------------------------------
// Integration: mutateState surfaces MutateStateError (not LiveStateSchemaError)
// ---------------------------------------------------------------------------

describe('mutateState shaped-json public error surface', () => {
  it('wraps LiveStateSchemaError as MutateStateError for ability_scores_json', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    // Provide an object missing required keys — the shape validator rejects it.
    const malformedScores = { strength: 10, dexterity: 14 }; // missing 4 keys

    expect(() =>
      mutateState(db, {
        target: 'character',
        field: 'ability_scores_json',
        op: 'set',
        value: malformedScores,
        provenance: 'test:shape-validation',
        sessionId: 'session-1',
        at: '2026-05-26T00:00:00.000Z',
      }),
    ).toThrow(MutateStateError);

    // Must NOT surface the internal LiveStateSchemaError class directly.
    expect(() =>
      mutateState(db, {
        target: 'character',
        field: 'ability_scores_json',
        op: 'set',
        value: malformedScores,
        provenance: 'test:shape-validation',
        sessionId: 'session-1',
        at: '2026-05-26T00:00:00.000Z',
      }),
    ).not.toThrow(LiveStateSchemaError);

    db.close();
  });
});
