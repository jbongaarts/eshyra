/**
 * Deterministic SRD 5.1 equipment-pack contents (eshyra-ngcj.4).
 *
 * The seven equipment packs carry their contents only in prose
 * (`data.description`), which inventory tooling cannot expand into grants. This
 * module authors each pack's contents as typed line items, source-backed from
 * the SRD's "Includes …" sentence: an explicit `quantity`, the item `name`, an
 * `equipment:<slug>` `ref` when the item has its own equipment record, and an
 * optional `detail` for quantity/qualifier text the ref does not capture (a
 * rope strapped to the side, incense by the block). The verbatim prose stays on
 * `data.description` for auditability; this adds `data.contents` beside it.
 *
 * The map is keyed by the emitted pack record key (`equipment:<slug>`). Item
 * refs are validated against the emitted equipment records by a fail-closed
 * importer guard, so a renamed/missing record refuses the pack.
 */

import type { EquipmentPackContent } from '../../../src/character/srdEquipmentPacks.js';

export type { EquipmentPackContent };

function withRef(
  quantity: number,
  name: string,
  slug: string,
  detail?: string,
): EquipmentPackContent {
  return {
    quantity,
    name,
    ref: `equipment:${slug}`,
    ...(detail !== undefined ? { detail } : {}),
  };
}

function bare(
  quantity: number,
  name: string,
  detail?: string,
): EquipmentPackContent {
  return { quantity, name, ...(detail !== undefined ? { detail } : {}) };
}

const ROPE_DETAIL = 'strapped to the side of the pack';

const EQUIPMENT_PACK_CONTENTS: Readonly<
  Record<string, readonly EquipmentPackContent[]>
> = {
  'equipment:burglars-pack': [
    withRef(1, 'backpack', 'backpack'),
    withRef(1, 'bag of 1,000 ball bearings', 'ball-bearings-bag-of-1-000'),
    bare(1, 'string', '10 feet'),
    withRef(1, 'bell', 'bell'),
    withRef(5, 'candle', 'candle'),
    withRef(1, 'crowbar', 'crowbar'),
    withRef(1, 'hammer', 'hammer'),
    withRef(10, 'piton', 'piton'),
    withRef(1, 'hooded lantern', 'lantern-hooded'),
    withRef(2, 'flask of oil', 'oil-flask'),
    withRef(5, 'days of rations', 'rations-1-day'),
    withRef(1, 'tinderbox', 'tinderbox'),
    withRef(1, 'waterskin', 'waterskin'),
    withRef(1, 'hempen rope (50 feet)', 'rope-hempen-50-feet', ROPE_DETAIL),
  ],
  'equipment:diplomats-pack': [
    withRef(1, 'chest', 'chest'),
    withRef(2, 'case for maps and scrolls', 'case-map-or-scroll'),
    withRef(1, 'set of fine clothes', 'clothes-fine'),
    withRef(1, 'bottle of ink', 'ink-1-ounce-bottle'),
    withRef(1, 'ink pen', 'ink-pen'),
    withRef(1, 'lamp', 'lamp'),
    withRef(2, 'flask of oil', 'oil-flask'),
    withRef(5, 'sheet of paper', 'paper-one-sheet'),
    withRef(1, 'vial of perfume', 'perfume-vial'),
    withRef(1, 'sealing wax', 'sealing-wax'),
    withRef(1, 'soap', 'soap'),
  ],
  'equipment:dungeoneers-pack': [
    withRef(1, 'backpack', 'backpack'),
    withRef(1, 'crowbar', 'crowbar'),
    withRef(1, 'hammer', 'hammer'),
    withRef(10, 'piton', 'piton'),
    withRef(10, 'torch', 'torch'),
    withRef(1, 'tinderbox', 'tinderbox'),
    withRef(10, 'days of rations', 'rations-1-day'),
    withRef(1, 'waterskin', 'waterskin'),
    withRef(1, 'hempen rope (50 feet)', 'rope-hempen-50-feet', ROPE_DETAIL),
  ],
  'equipment:entertainers-pack': [
    withRef(1, 'backpack', 'backpack'),
    withRef(1, 'bedroll', 'bedroll'),
    withRef(2, 'costume', 'clothes-costume'),
    withRef(5, 'candle', 'candle'),
    withRef(5, 'days of rations', 'rations-1-day'),
    withRef(1, 'waterskin', 'waterskin'),
    withRef(1, 'disguise kit', 'disguise-kit'),
  ],
  'equipment:explorers-pack': [
    withRef(1, 'backpack', 'backpack'),
    withRef(1, 'bedroll', 'bedroll'),
    withRef(1, 'mess kit', 'mess-kit'),
    withRef(1, 'tinderbox', 'tinderbox'),
    withRef(10, 'torch', 'torch'),
    withRef(10, 'days of rations', 'rations-1-day'),
    withRef(1, 'waterskin', 'waterskin'),
    withRef(1, 'hempen rope (50 feet)', 'rope-hempen-50-feet', ROPE_DETAIL),
  ],
  'equipment:priests-pack': [
    withRef(1, 'backpack', 'backpack'),
    withRef(1, 'blanket', 'blanket'),
    withRef(10, 'candle', 'candle'),
    withRef(1, 'tinderbox', 'tinderbox'),
    bare(1, 'alms box'),
    bare(2, 'block of incense'),
    bare(1, 'censer'),
    bare(1, 'vestments'),
    withRef(2, 'days of rations', 'rations-1-day'),
    withRef(1, 'waterskin', 'waterskin'),
  ],
  'equipment:scholars-pack': [
    withRef(1, 'backpack', 'backpack'),
    withRef(1, 'book of lore', 'book'),
    withRef(1, 'bottle of ink', 'ink-1-ounce-bottle'),
    withRef(1, 'ink pen', 'ink-pen'),
    withRef(10, 'sheet of parchment', 'parchment-one-sheet'),
    bare(1, 'bag of sand', 'little'),
    bare(1, 'small knife'),
  ],
};

/**
 * The authored typed contents for an equipment pack, looked up by its record
 * key (e.g. `equipment:explorers-pack`), or `undefined` for a non-pack item.
 */
export function getEquipmentPackContents(
  packKey: string,
): readonly EquipmentPackContent[] | undefined {
  const contents = EQUIPMENT_PACK_CONTENTS[packKey];
  return contents === undefined
    ? undefined
    : contents.map((entry) => ({ ...entry }));
}
