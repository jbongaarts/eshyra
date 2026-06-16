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
      [
        'Made from supple and thin materials, light armor favors agile adventurers.',
        9.84,
      ],
      ['If you wear light armor, you add your Dexterity modifier.', 9.84],
      ['Padded. Padded armor consists of quilted layers.', 9.84],
      ['Medium Armor', 13.92],
      ['Medium armor offers more protection than light armor.', 9.84],
      ['You add your Dexterity modifier, to a maximum of +2.', 9.84],
      ['Hide. This crude armor consists of thick furs.', 9.84],
      ['Heavy Armor', 13.92],
      ['Heavy armor doesn’t let you add your Dexterity modifier.', 9.84],
      ['Ring Mail. This armor is leather armor with heavy rings.', 9.84],
      ['Adventuring Gear', 18],
      [
        'This section describes items that have special rules or require further explanation. Acid. As an action, you can splash it.',
        9.84,
      ],
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
    expect(byKey.get('light-armor')?.text).toContain(
      'you add your Dexterity modifier',
    );
    expect(byKey.get('light-armor')?.text).not.toContain('Padded.');
    expect(byKey.get('medium-armor')?.text).toContain('maximum of +2');
    expect(byKey.get('heavy-armor-category')?.text).toContain(
      'doesn’t let you add your Dexterity modifier',
    );
    expect(byKey.get('adventuring-gear')?.text).toBe(
      'This section describes items that have special rules or require further explanation.',
    );
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
