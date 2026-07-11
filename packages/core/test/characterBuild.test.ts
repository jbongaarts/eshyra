import { describe, expect, it } from 'vitest';
import {
  assertSupportedCharacterBuild,
  MULTICLASS_UNSUPPORTED,
  UnsupportedCharacterBuildError,
} from '../src/internal.js';

const FIGHTER = { key: 'class:fighter', name: 'Fighter' } as const;

function sheet(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    level: 1,
    class: FIGHTER,
    ...overrides,
  };
}

function expectUnsupported(value: unknown): UnsupportedCharacterBuildError {
  let thrown: unknown;
  try {
    assertSupportedCharacterBuild(value, { operation: 'test operation' });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(UnsupportedCharacterBuildError);
  return thrown as UnsupportedCharacterBuildError;
}

describe('single-class character-build boundary', () => {
  it('accepts a canonical single-class sheet, including a subclass of that class', () => {
    expect(() =>
      assertSupportedCharacterBuild(sheet(), { operation: 'test operation' }),
    ).not.toThrow();
    expect(() =>
      assertSupportedCharacterBuild(
        sheet({ subclass: { key: 'subclass:champion', name: 'Champion' } }),
        { operation: 'test operation' },
      ),
    ).not.toThrow();
  });

  it('rejects a subclass whose resolved parent class differs from the base class', () => {
    expectUnsupported(
      sheet({ subclass: { key: 'subclass:life-domain', name: 'Life Domain' } }),
    );
  });

  it.each([
    ['multiple base classes', { classes: [FIGHTER, { key: 'class:wizard' }] }],
    ['per-class levels', { classLevels: { 'class:fighter': 1 } }],
    ['additional-class level', { additionalClassLevel: 1 }],
    ['advancement target', { targetClass: 'Wizard' }],
    ['alternate class-level transport', { classLevel: 1 }],
    ['snake-case multiclass transport', { class_levels: { fighter: 1 } }],
  ])('rejects %s', (_label, transport) => {
    expectUnsupported(sheet(transport));
  });

  it.each([
    0, -1, 1.5,
  ])('rejects a non-positive or non-integer level (%s)', (level) => {
    expectUnsupported(sheet({ level }));
  });

  it('rejects total/sole-class level claims that disagree with schema-v1 level', () => {
    expectUnsupported(sheet({ totalLevel: 2 }));
    expectUnsupported(sheet({ soleClassLevel: 2 }));
  });

  it('preserves the stable typed error contract and permits unrelated metadata', () => {
    expect(() =>
      assertSupportedCharacterBuild(
        sheet({ futureMetadata: { note: 'not a character-build field' } }),
        { operation: 'test operation' },
      ),
    ).not.toThrow();

    const error = expectUnsupported(sheet({ classes: [] }));
    expect(error.code).toBe(MULTICLASS_UNSUPPORTED);
    expect(error.operation).toBe('test operation');
    expect(error.message).toBe(
      'test operation was refused: Eshyra currently supports one class only.',
    );
  });
});
