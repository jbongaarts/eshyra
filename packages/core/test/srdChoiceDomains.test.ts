/**
 * Tests for deterministic SRD language/tool choice domains (eshyra-8r8f).
 *
 * Several open-ended SRD choices ("one extra language of your choice",
 * "three musical instruments of your choice") were structured enough
 * (`choose: N`) but had no enumerable `from` domain, so deterministic
 * character creation had nothing to prompt from besides re-parsing prose.
 * These tests verify the catalogs (`SRD_5_1_STANDARD_LANGUAGES`,
 * `SRD_5_1_ARTISAN_TOOLS`, `SRD_5_1_MUSICAL_INSTRUMENTS`) and that the named
 * audit examples — Half-Elf/Human/Acolyte languages, High Elf's extra
 * language, Bard's musical instruments, Monk's artisan-tools-or-instrument —
 * reference them in the committed pack.
 */

import { describe, expect, it } from 'vitest';
import {
  getBundledDnd5eSrdPack,
  SRD_5_1_ARTISAN_TOOLS,
  SRD_5_1_MUSICAL_INSTRUMENTS,
  SRD_5_1_STANDARD_LANGUAGES,
} from '../src/internal.js';

function recordData(key: string): Record<string, unknown> {
  const record = getBundledDnd5eSrdPack().records.find((r) => r.key === key);
  if (record === undefined) throw new Error(`fixture gap: ${key} not found`);
  return record.data as Record<string, unknown>;
}

describe('SRD choice domain catalogs', () => {
  it('SRD_5_1_STANDARD_LANGUAGES has the 8 Standard Languages table entries', () => {
    expect(SRD_5_1_STANDARD_LANGUAGES).toEqual([
      'Common',
      'Dwarvish',
      'Elvish',
      'Giant',
      'Gnomish',
      'Goblin',
      'Halfling',
      'Orc',
    ]);
  });

  it('SRD_5_1_ARTISAN_TOOLS has the 17 Artisan’s Tools table entries', () => {
    expect(SRD_5_1_ARTISAN_TOOLS).toHaveLength(17);
    expect(SRD_5_1_ARTISAN_TOOLS).toContain('Smith’s tools');
    expect(SRD_5_1_ARTISAN_TOOLS).toContain('Weaver’s tools');
  });

  it('SRD_5_1_MUSICAL_INSTRUMENTS has the 10 Musical Instrument table entries', () => {
    expect(SRD_5_1_MUSICAL_INSTRUMENTS).toEqual([
      'Bagpipes',
      'Drum',
      'Dulcimer',
      'Flute',
      'Horn',
      'Lute',
      'Lyre',
      'Pan flute',
      'Shawm',
      'Viol',
    ]);
  });
});

describe('committed SRD pack: language choice domains (eshyra-8r8f)', () => {
  it('Half-Elf: choose 1 extra language from the Standard Languages catalog', () => {
    const languages = recordData('ancestry:half-elf').languages as {
      choose?: number;
      from?: readonly string[];
    }[];
    expect(languages[0].choose).toBe(1);
    expect(languages[0].from).toEqual(SRD_5_1_STANDARD_LANGUAGES);
  });

  it('Human: choose 1 extra language from the Standard Languages catalog', () => {
    const languages = recordData('ancestry:human').languages as {
      choose?: number;
      from?: readonly string[];
    }[];
    expect(languages[0].choose).toBe(1);
    expect(languages[0].from).toEqual(SRD_5_1_STANDARD_LANGUAGES);
  });

  it('High Elf: extra-language creation choice draws from the Standard Languages catalog', () => {
    const choices = recordData('ancestry:high-elf').choices as {
      id: string;
      category: string;
      choose: number;
      from?: readonly string[];
    }[];
    const extraLanguage = choices.find((c) => c.id === 'extra-language');
    expect(extraLanguage?.category).toBe('language');
    expect(extraLanguage?.choose).toBe(1);
    expect(extraLanguage?.from).toEqual(SRD_5_1_STANDARD_LANGUAGES);
  });

  it('Acolyte: choose 2 languages from the Standard Languages catalog', () => {
    const languages = recordData('background:acolyte').languages as {
      choose?: number;
      from?: readonly string[];
    }[];
    expect(languages[0].choose).toBe(2);
    expect(languages[0].from).toEqual(SRD_5_1_STANDARD_LANGUAGES);
  });
});

describe('committed SRD pack: tool/instrument choice domains (eshyra-8r8f)', () => {
  it('Bard: choose 3 musical instruments from the Musical Instrument catalog', () => {
    const choices = recordData('class:bard').toolProficiencyChoices as {
      choose?: number;
      from?: readonly string[];
    }[];
    expect(choices[0].choose).toBe(3);
    expect(choices[0].from).toEqual(SRD_5_1_MUSICAL_INSTRUMENTS);
  });

  it('Monk: choose 1 artisan’s tool or musical instrument from the combined catalog', () => {
    const choices = recordData('class:monk').toolProficiencyChoices as {
      choose?: number;
      from?: readonly string[];
    }[];
    expect(choices[0].choose).toBe(1);
    expect(choices[0].from).toEqual([
      ...SRD_5_1_ARTISAN_TOOLS,
      ...SRD_5_1_MUSICAL_INSTRUMENTS,
    ]);
  });
});
