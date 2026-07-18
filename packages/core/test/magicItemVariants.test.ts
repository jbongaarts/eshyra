import { describe, expect, it } from 'vitest';
import { validateRecordKindSchema } from '../src/rules/kindSchemas.js';
import {
  effectiveMagicItemMechanics,
  mergeMagicItemVariantMechanics,
  resolveMagicItemVariant,
} from '../src/rules/magicItemVariants.js';
import type { RulesRecord } from '../src/rules/types.js';

function record(variants?: readonly Record<string, unknown>[]): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'magic-item',
    key: 'magic-item:test-stone',
    name: 'Test Stone',
    data: {
      itemType: 'wondrous item',
      rarity: 'rare',
      requiresAttunement: true,
      description: 'Test.',
      mechanics: {
        effects: [{ id: 'parent-effect', kind: 'sense', sense: 'parent' }],
        operations: [{ id: 'activate', activation: { cost: 'action' } }],
      },
      ...(variants === undefined ? {} : { variants }),
    },
    source: { title: 'Test', url: 'https://example.com' },
    license: { name: 'CC-BY-4.0', url: 'https://example.com/license' },
    provenance: { sourceId: 'test', locator: 'test' },
  };
}

const AGILITY = {
  id: 'agility',
  name: 'Agility',
  rarity: 'very rare',
  text: 'Dexterity increases.',
  mechanics: {
    effects: [{ id: 'variant-effect', kind: 'sense', sense: 'variant' }],
    operations: [
      { id: 'activate', effects: ['variant-effect'] },
      { id: 'dismiss', activation: { cost: 'bonus-action' } },
    ],
  },
} as const;

describe('canonical magic-item variant identity and effective mechanics', () => {
  it('requires unique canonical variant ids in the persisted record schema', () => {
    const valid = record([AGILITY]);
    expect(() => validateRecordKindSchema(valid, 'record')).not.toThrow();

    const missingId = record([{ ...AGILITY, id: undefined }]);
    expect(() => validateRecordKindSchema(missingId, 'record')).toThrow(
      /variants\[0\]\.id/,
    );

    const noncanonical = record([{ ...AGILITY, id: 'Agility' }]);
    expect(() => validateRecordKindSchema(noncanonical, 'record')).toThrow(
      /canonical slug/,
    );

    const duplicate = record([AGILITY, { ...AGILITY }]);
    expect(() => validateRecordKindSchema(duplicate, 'record')).toThrow(
      /duplicate id/,
    );
  });

  it('requires an exact declared variant id iff variants exist', () => {
    expect(resolveMagicItemVariant(record(), undefined)).toBeUndefined();
    expect(() => resolveMagicItemVariant(record(), 'agility')).toThrow(
      /does not declare variants/,
    );
    expect(() => resolveMagicItemVariant(record([AGILITY]), undefined)).toThrow(
      /requires variantId/,
    );
    expect(() => resolveMagicItemVariant(record([AGILITY]), 'Agility')).toThrow(
      /does not declare variantId/,
    );
    expect(resolveMagicItemVariant(record([AGILITY]), 'agility')?.name).toBe(
      'Agility',
    );
  });

  it('merges compatible operations while retaining parent and child effects', () => {
    expect(effectiveMagicItemMechanics(record([AGILITY]), 'agility')).toEqual({
      effects: [
        { id: 'parent-effect', kind: 'sense', sense: 'parent' },
        { id: 'variant-effect', kind: 'sense', sense: 'variant' },
      ],
      operations: [
        {
          id: 'activate',
          activation: { cost: 'action' },
          effects: ['variant-effect'],
        },
        { id: 'dismiss', activation: { cost: 'bonus-action' } },
      ],
    });
  });

  it('fails closed on singleton, economy, effect, and operation conflicts', () => {
    expect(() =>
      mergeMagicItemVariantMechanics(
        { curse: { note: 'parent' } },
        { curse: { note: 'variant' } },
      ),
    ).toThrow(/singleton block 'curse'/);
    expect(() =>
      mergeMagicItemVariantMechanics(
        { economies: { charges: { kind: 'charges', charges: { max: 3 } } } },
        { economies: { charges: { kind: 'charges', charges: { max: 4 } } } },
      ),
    ).toThrow(/duplicate economy id 'charges'/);
    expect(() =>
      mergeMagicItemVariantMechanics(
        { effects: [{ id: 'same', kind: 'sense' }] },
        { effects: [{ id: 'same', kind: 'speedSet' }] },
      ),
    ).toThrow(/duplicate effect id 'same'/);
    expect(() =>
      mergeMagicItemVariantMechanics(
        { operations: [{ id: 'use', activation: { cost: 'action' } }] },
        {
          operations: [{ id: 'use', activation: { cost: 'bonus-action' } }],
        },
      ),
    ).toThrow(/activation.cost/);
  });
});
