import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  projectS1SummoningEffects,
  S1_SUMMONING_SPECS,
  S1_SUMMONING_SPELL_KEYS,
  type S1SummoningSpellKey,
} from '../../../scripts/importers/dnd5e-srd-5.1/s1SummoningSpecs.js';
import type { SpellExtraction } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import type { RulesRecord } from '../../../src/rules/types.js';

const REVIEWED_S1_KEYS = [
  'spell:animate-dead',
  'spell:animate-objects',
  'spell:conjure-animals',
  'spell:conjure-celestial',
  'spell:conjure-elemental',
  'spell:conjure-fey',
  'spell:conjure-minor-elementals',
  'spell:conjure-woodland-beings',
  'spell:create-undead',
  'spell:find-familiar',
  'spell:find-steed',
  'spell:giant-insect',
  'spell:phantom-steed',
  'spell:simulacrum',
] as const satisfies readonly S1SummoningSpellKey[];

const COMMITTED_RECORDS = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
    ),
    'utf8',
  ),
) as RulesRecord[];

function extractedSpell(key: S1SummoningSpellKey): SpellExtraction {
  const record = COMMITTED_RECORDS.find((candidate) => candidate.key === key);
  expect(record, `${key} must exist in the committed pack`).toBeDefined();
  const data = record?.data as Record<string, unknown>;
  return {
    name: record?.name as string,
    level: data.level as number,
    school: data.school as string,
    ritual: data.ritual === true,
    castingTime: data.castingTime as string,
    range: data.range as string,
    components: data.components as readonly string[],
    componentMaterials: data.componentMaterials as string | undefined,
    duration: data.duration as string,
    description: data.description as string,
    higherLevels: data.higherLevels as string | undefined,
    sourcePage: S1_SUMMONING_SPECS[key].sourcePage,
  };
}

function sourceRegex(pattern: RegExp): RegExp {
  return new RegExp(
    pattern.source,
    pattern.flags.includes('i') ? pattern.flags : `${pattern.flags}i`,
  );
}

describe('S1 summoning curated compiler specs', () => {
  it('has exact parity with the independently reviewed 14-key membership', () => {
    expect(S1_SUMMONING_SPELL_KEYS).toEqual(REVIEWED_S1_KEYS);
    expect(Object.keys(S1_SUMMONING_SPECS).sort()).toEqual(
      [...REVIEWED_S1_KEYS].sort(),
    );
  });

  it('projects every reviewed source without a second executable registry', () => {
    for (const key of REVIEWED_S1_KEYS) {
      expect(projectS1SummoningEffects(extractedSpell(key)), key).toHaveLength(
        1,
      );
    }
  });

  it('fails closed when any declared source clause is removed', () => {
    for (const key of REVIEWED_S1_KEYS) {
      const spec = S1_SUMMONING_SPECS[key];
      for (const clause of spec.clauses) {
        let spell = extractedSpell(key);
        const pattern = sourceRegex(clause.pattern);
        if (clause.field === 'duration' && pattern.test(spell.duration)) {
          spell = {
            ...spell,
            duration: spell.duration.replace(
              sourceRegex(clause.pattern),
              '[removed reviewed clause]',
            ),
          };
        } else if (pattern.test(spell.description)) {
          spell = {
            ...spell,
            description: spell.description.replace(
              sourceRegex(clause.pattern),
              '[removed reviewed clause]',
            ),
          };
        } else if (
          spell.higherLevels !== undefined &&
          pattern.test(spell.higherLevels)
        ) {
          spell = {
            ...spell,
            higherLevels: spell.higherLevels.replace(
              sourceRegex(clause.pattern),
              '[removed reviewed clause]',
            ),
          };
        } else {
          throw new Error(
            `${key} clause ${clause.id} did not match its source`,
          );
        }
        expect(
          () => projectS1SummoningEffects(spell),
          `${key}:${clause.id}`,
        ).toThrow(/missing reviewed source clause/);
      }
    }
  });

  it('fails closed when a reviewed spell moves source pages', () => {
    const spell = extractedSpell('spell:find-familiar');
    expect(() =>
      projectS1SummoningEffects({ ...spell, sourcePage: spell.sourcePage + 1 }),
    ).toThrow(/moved from reviewed source page/);
  });
});
