import { describe, expect, it } from 'vitest';
import { parseEquipmentGuidance } from '../../../scripts/importers/dnd5e-srd-5.1/parseEquipmentGuidance.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(
  pageNumber: number,
  rows: readonly (readonly [string, number])[],
): PageText {
  return {
    pageNumber,
    lines: rows.map(([line]) => line),
    lineHeights: rows.map(([, height]) => height),
  };
}

describe('parseEquipmentGuidance', () => {
  const equipment = [
    page(62, [
      ['Common coins come in several different denominations.', 9.84],
      ['Standard Exchange Rates', 12],
      ['Coin CP SP EP GP PP', 8.88],
      ['Selling Treasure', 18],
      ['Undamaged equipment fetch half its cost when sold.', 9.84],
      ['Armor', 18],
      [
        'Armor Proficiency. Only proficient wearers use armor effectively.',
        9.84,
      ],
      ['Armor Class (AC). Armor determines your base Armor Class.', 9.84],
      ['Light Armor', 13.92],
      ['Padded. Padded armor consists of quilted layers.', 9.84],
      ['Equipment Packs', 10.8],
      ['Starting equipment can be purchased as a pack.', 8.88],
      ['Burglar’s Pack (16 gp). Includes a backpack.', 8.88],
      ['Tools', 18],
      ['A tool helps you do something you could not otherwise do.', 9.84],
      ['Proficiency with a tool lets you add your proficiency bonus.', 9.84],
      ['Tools', 12],
      ['Item Cost Weight', 8.88],
    ]),
  ];
  const mounts = [
    page(71, [
      ['A good mount can carry gear.', 9.84],
      ['Barding. Barding is armor designed to protect an animal.', 9.84],
      [
        'Vehicle Proficiency. Add your proficiency bonus to control checks.',
        9.84,
      ],
      ['Mounts and Other Animals', 12],
    ]),
  ];
  const tradeGoods = [
    page(72, [
      ['Most wealth is not in coins.', 9.84],
      ['Trade Goods', 12],
      ['Cost Goods', 8.88],
    ]),
  ];
  const expenses = [
    page(72, [
      ['Trade Goods prose owned by the separate rule.', 9.84],
      ['Expenses', 18],
      ['People require shelter, sustenance, and clothing.', 9.84],
      ['Lifestyle Expenses', 13.92],
      ['Lifestyle expenses cover accommodations and food.', 9.84],
      ['Lifestyle Expenses', 12],
      ['Lifestyle Price/Day', 8.88],
      ['Food, Drink, and Lodging', 13.92],
      ['These prices are included in lifestyle expenses.', 9.84],
      ['Food, Drink, and Lodging', 12],
      ['Item Cost', 8.88],
      ['Services', 13.92],
      ['Adventurers can pay nonplayer characters to assist them.', 9.84],
      ['Services', 12],
      ['Service Pay', 8.88],
      ['Spellcasting Services', 13.92],
      ['No established pay rates exist.', 9.84],
    ]),
  ];

  const rules = parseEquipmentGuidance(equipment, mounts, tradeGoods, expenses);
  const byKey = new Map(rules.map((rule) => [rule.keySlug, rule]));

  it('captures chapter and section guidance without table rows', () => {
    expect(byKey.get('coinage')?.text).toContain('Common coins');
    expect(byKey.get('selling-treasure')?.text).toContain('half its cost');
    expect(byKey.get('armor-guidance')?.text).toContain('Armor Proficiency.');
    expect(byKey.get('armor-guidance')?.text).not.toContain('Padded.');
    expect(byKey.get('equipment-packs')?.text).toContain('Starting equipment');
    expect(byKey.get('tools')?.text).toContain('Proficiency with a tool');
    expect(byKey.get('mounts-and-vehicles')?.text).toContain('Barding.');
    expect(byKey.get('trade-goods')?.text).toContain('Most wealth');
  });

  it('captures expenses prose while leaving existing dedicated rules alone', () => {
    expect(byKey.get('expenses')?.text).toContain('shelter');
    expect(byKey.get('lifestyle-expenses')?.text).toContain('accommodations');
    expect(byKey.get('food-drink-and-lodging')?.text).toContain(
      'lifestyle expenses',
    );
    expect(byKey.get('services')?.text).toContain('nonplayer characters');
    expect(byKey.has('spellcasting-services')).toBe(false);
  });
});
