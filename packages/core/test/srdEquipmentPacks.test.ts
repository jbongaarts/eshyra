/**
 * Tests for typed equipment-pack contents (eshyra-ngcj.4): every SRD 5.1
 * equipment pack expands into deterministic line items with explicit
 * quantities, and the runtime accessor reads them off the pack record.
 */

import { describe, expect, it } from 'vitest';
import {
  getBundledDnd5eSrdPack,
  type RulesRecord,
  readEquipmentPackContents,
} from '../src/internal.js';

const pack = getBundledDnd5eSrdPack();
const equipment = pack.records.filter((r) => r.kind === 'equipment');
const equipmentKeys = new Set(equipment.map((r) => r.key));

function packRecord(key: string): RulesRecord {
  const record = equipment.find((r) => r.key === key);
  if (record === undefined) throw new Error(`missing pack ${key}`);
  return record;
}

// The class-granted packs the bead requires to expand deterministically.
const REQUIRED_PACKS: readonly string[] = [
  'equipment:explorers-pack',
  'equipment:dungeoneers-pack',
  'equipment:priests-pack',
  'equipment:scholars-pack',
  'equipment:burglars-pack',
  'equipment:diplomats-pack',
  'equipment:entertainers-pack',
];

describe('equipment pack contents', () => {
  it('every category=pack record carries non-empty typed contents', () => {
    const packs = equipment.filter(
      (r) => (r.data as { category?: string }).category === 'pack',
    );
    expect(packs.length).toBeGreaterThanOrEqual(REQUIRED_PACKS.length);
    for (const record of packs) {
      const contents = readEquipmentPackContents(record.data);
      expect(contents?.length, `${record.key} contents`).toBeGreaterThan(0);
    }
  });

  it('expands every required class-granted pack', () => {
    for (const key of REQUIRED_PACKS) {
      const contents = readEquipmentPackContents(packRecord(key).data);
      expect(contents?.length, key).toBeGreaterThan(0);
    }
  });

  it('preserves the verbatim prose description beside the typed contents', () => {
    const record = packRecord('equipment:explorers-pack');
    const description = (record.data as { description?: string }).description;
    expect(description).toContain('Includes a backpack');
  });

  it('every content ref resolves to a real equipment record', () => {
    for (const key of REQUIRED_PACKS) {
      const contents = readEquipmentPackContents(packRecord(key).data) ?? [];
      for (const content of contents) {
        if (content.ref === undefined) continue;
        expect(equipmentKeys.has(content.ref), `${key} -> ${content.ref}`).toBe(
          true,
        );
      }
    }
  });

  it('represents explicit quantities (Explorer’s Pack: 10 torches, 10 rations)', () => {
    const contents =
      readEquipmentPackContents(packRecord('equipment:explorers-pack').data) ??
      [];
    const torch = contents.find((c) => c.ref === 'equipment:torch');
    const rations = contents.find((c) => c.ref === 'equipment:rations-1-day');
    expect(torch?.quantity).toBe(10);
    expect(rations?.quantity).toBe(10);
    for (const content of contents) {
      expect(content.quantity).toBeGreaterThanOrEqual(1);
    }
  });

  it('represents quantity-bearing rope as a 50-foot bundle with a detail', () => {
    const contents =
      readEquipmentPackContents(packRecord('equipment:explorers-pack').data) ??
      [];
    const rope = contents.find(
      (c) => c.ref === 'equipment:rope-hempen-50-feet',
    );
    expect(rope?.quantity).toBe(1);
    expect(rope?.detail).toContain('strapped to the side');
  });

  it('keeps record-less items (alms box, incense) as named, ref-free lines', () => {
    const contents =
      readEquipmentPackContents(packRecord('equipment:priests-pack').data) ??
      [];
    const almsBox = contents.find((c) => c.name === 'alms box');
    const incense = contents.find((c) => c.name === 'block of incense');
    expect(almsBox).toEqual({ quantity: 1, name: 'alms box' });
    expect(incense?.ref).toBeUndefined();
    expect(incense?.quantity).toBe(2);
  });

  it('returns undefined for a non-pack item', () => {
    const greataxe = packRecord('equipment:greataxe');
    expect(readEquipmentPackContents(greataxe.data)).toBeUndefined();
  });
});
