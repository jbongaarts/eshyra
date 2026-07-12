/**
 * Tests for ancestry & background character-creation choices (eshyra-ngcj.5):
 * the prose-bound ancestry/background build choices are now typed and
 * deterministically resolvable on the committed pack.
 */

import { describe, expect, it } from 'vitest';
import {
  getBundledDnd5eCharacterResolver,
  getBundledDnd5eSrdPack,
  type RulesRecord,
} from '../src/internal.js';

const pack = getBundledDnd5eSrdPack();
const byKey = new Map(pack.records.map((r) => [r.key, r] as const));
const keysByKind = new Map<string, Set<string>>();
for (const r of pack.records) {
  const bucket = keysByKind.get(r.kind) ?? new Set<string>();
  bucket.add(r.key);
  keysByKind.set(r.kind, bucket);
}

interface Choice {
  readonly id: string;
  readonly category: string;
  readonly choose: number;
  readonly from?: readonly string[];
  readonly tableRef?: string;
  readonly roll?: string;
}
function choicesOf(key: string): readonly Choice[] {
  const record = byKey.get(key) as RulesRecord | undefined;
  return ((record?.data as { choices?: Choice[] }).choices ?? []) as Choice[];
}

describe('ancestry creation choices', () => {
  it('resolves Dragonborn draconic ancestry to the draconic-ancestry table', () => {
    const choice = choicesOf('ancestry:dragonborn').find(
      (c) => c.category === 'draconicAncestry',
    );
    expect(choice?.choose).toBe(1);
    expect(choice?.tableRef).toBe('table:draconic-ancestry');
    expect(keysByKind.get('table')?.has('table:draconic-ancestry')).toBe(true);
  });

  it('resolves the Dwarf / Hill Dwarf artisan-tool choice to 3 options', () => {
    for (const key of ['ancestry:dwarf', 'ancestry:hill-dwarf']) {
      const tool = choicesOf(key).find((c) => c.category === 'tool');
      expect(tool?.choose, key).toBe(1);
      expect(tool?.from, key).toEqual([
        'Smith’s tools',
        'Brewer’s supplies',
        'Mason’s tools',
      ]);
    }
  });

  it('resolves Half-Elf Skill Versatility to two of the 18 skills', () => {
    const skill = choicesOf('ancestry:half-elf').find(
      (c) => c.category === 'skill',
    );
    expect(skill?.choose).toBe(2);
    expect(skill?.from).toHaveLength(18);
    expect(skill?.from).toContain('Stealth');
  });

  it('resolves the High Elf cantrip choice to the wizard cantrip spell records', () => {
    const cantrip = choicesOf('ancestry:high-elf').find(
      (c) => c.category === 'cantrip',
    );
    expect(cantrip?.choose).toBe(1);
    expect(cantrip?.from?.length).toBeGreaterThan(0);
    for (const ref of cantrip?.from ?? []) {
      expect(keysByKind.get('spell')?.has(ref), ref).toBe(true);
    }
    expect(cantrip?.from).toContain('spell:fire-bolt');
  });

  it('resolves the High Elf extra-language choice', () => {
    const language = choicesOf('ancestry:high-elf').find(
      (c) => c.category === 'language',
    );
    expect(language?.choose).toBe(1);
  });

  it('does not duplicate ability-score / base-language choices into choices[]', () => {
    // Half-Elf ASI choice stays in abilityScoreIncreases; its choices[] is only
    // the skill choice.
    const categories = choicesOf('ancestry:half-elf').map((c) => c.category);
    expect(categories).toEqual(['skill']);
  });
});

describe('background creation choices', () => {
  const acolyte = byKey.get('background:acolyte') as RulesRecord;
  const data = acolyte.data as {
    choices?: Choice[];
    equipmentGrants?: {
      quantity: number;
      name: string;
      ref?: string;
      select?: string;
      detail?: string;
    }[];
  };

  it('models personality/ideal/bond/flaw as rollable table choices', () => {
    const byCategory = new Map(
      (data.choices ?? []).map((c) => [c.category, c] as const),
    );
    expect(byCategory.get('personalityTrait')?.roll).toBe('1d8');
    expect(byCategory.get('personalityTrait')?.tableRef).toBe(
      'table:acolyte-personality-traits',
    );
    for (const cat of ['ideal', 'bond', 'flaw']) {
      expect(byCategory.get(cat)?.roll, cat).toBe('1d6');
      const ref = byCategory.get(cat)?.tableRef ?? '';
      expect(keysByKind.get('table')?.has(ref), ref).toBe(true);
    }
  });

  it('models the holy symbol as a holy-symbol selectable grant (not a bare name)', () => {
    const holy = (data.equipmentGrants ?? []).find(
      (g) => g.name === 'holy symbol',
    ) as { select?: string; ref?: string } | undefined;
    expect(holy?.select).toBe('holy-symbol');
    expect(holy?.ref).toBeUndefined();
  });

  it('models the equipment grant with explicit quantities and resolvable refs', () => {
    const grants = data.equipmentGrants ?? [];
    expect(grants.length).toBeGreaterThan(0);
    const incense = grants.find((g) => g.name === 'stick of incense');
    expect(incense?.quantity).toBe(5);
    const clothes = grants.find((g) => g.ref !== undefined);
    expect(clothes).toBeDefined();
    for (const grant of grants) {
      expect(grant.quantity).toBeGreaterThanOrEqual(1);
      if (grant.ref !== undefined) {
        expect(keysByKind.get('equipment')?.has(grant.ref), grant.ref).toBe(
          true,
        );
      }
    }
  });

  it('keeps the verbatim equipment prose for auditability', () => {
    expect((acolyte.data as { equipment?: string }).equipment).toContain(
      'holy symbol',
    );
  });
});

describe('pack-derived tool proficiency domain', () => {
  it('contains structured tools and audited categories without generic gaming set', () => {
    const domain = getBundledDnd5eCharacterResolver().listToolProficiencies();
    const normalized = new Set(
      domain.map((value) =>
        value
          .toLowerCase()
          .replace(/[’']/g, '')
          .replace(/[^a-z0-9]+/g, ' ')
          .trim(),
      ),
    );
    expect(normalized.has('gaming set')).toBe(false);
    for (const value of [
      'Dice set',
      'Dragonchess set',
      'Playing card set',
      'Three-Dragon Ante set',
      'Vehicles (land)',
      'Vehicles (water)',
    ])
      expect(domain).toContain(value);
    for (const record of pack.records) {
      const data = record.data as { category?: unknown };
      if (record.kind === 'equipment' && data.category === 'tool') {
        expect(
          normalized.has(
            record.name
              .toLowerCase()
              .replace(/[’']/g, '')
              .replace(/[^a-z0-9]+/g, ' ')
              .trim(),
          ),
        ).toBe(true);
      }
    }
  });
});
