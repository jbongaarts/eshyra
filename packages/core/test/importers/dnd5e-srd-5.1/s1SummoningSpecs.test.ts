import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  materializeS1RulesAmbiguities,
  materializeS1SummoningEffect,
  projectS1SummoningEffects,
  projectS1SummoningMechanics,
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

  it('emits the two stable, source-bound ambiguities without a canonical winner', () => {
    expect(materializeS1RulesAmbiguities('spell:create-undead')).toEqual([
      {
        id: 'ambiguity:create-undead-ghast-wight-composition',
        question:
          'When a higher-level Create Undead casting permits N ghasts or wights, may the N creatures be a mixture of ghasts and wights, or must the selected group be homogeneous?',
        affects: [
          'effects[summoning].scaling[slot-option-menu].options[slot=8].choices[ghast-or-wight].composition',
          'effects[summoning].scaling[slot-option-menu].options[slot=9].choices[ghast-or-wight].composition',
        ],
        interpretations: [
          {
            id: 'homogeneous-alternative',
            summary:
              'Choose ghasts or wights for the group; every creature in that group has the chosen stat block.',
          },
          {
            id: 'mixed-within-total',
            summary:
              'Choose any mixture of ghasts and wights up to the shared creature limit.',
          },
        ],
        canonicalResolution: null,
        runtimeDisposition: {
          status: 'engine-pending',
          owner: 'campaign-ruling',
        },
        source: [
          {
            locator: 'p. 132, higher-slot exclusive maximum menus',
            clauseId: 'scaling',
          },
        ],
      },
    ]);
    expect(materializeS1RulesAmbiguities('spell:find-familiar')).toEqual([
      {
        id: 'ambiguity:find-familiar-permanent-dismissal-after-zero-hp',
        question:
          'Can permanent dismissal terminate an active familiar relationship while the familiar is physically absent after reaching 0 hit points?',
        affects: [
          'effects[summoning].transitions[permanent-dismissal-from-zero-hp-absence].availability',
        ],
        interpretations: [
          {
            id: 'presence-required',
            summary:
              'Permanent dismissal is available only while the familiar is present or temporarily dismissed in its pocket dimension.',
          },
          {
            id: 'active-link-sufficient',
            summary:
              'An active familiar relationship is sufficient for permanent dismissal even while the familiar is absent after reaching 0 hit points.',
          },
        ],
        canonicalResolution: null,
        runtimeDisposition: {
          status: 'engine-pending',
          owner: 'campaign-ruling',
        },
        source: [
          {
            locator: 'p. 143, zero-hit-point absence and recast return',
            clauseId: 'zero',
          },
          {
            locator:
              'p. 143, pocket dismissal, recall, and permanent dismissal',
            clauseId: 'dismissal',
          },
        ],
      },
    ]);
    expect(
      projectS1SummoningMechanics(extractedSpell('spell:animate-dead'))
        .ambiguities,
    ).toBeUndefined();
  });

  it('gates only the unresolved composition and dismissal-availability paths', () => {
    const createUndead = materializeS1SummoningEffect(
      'spell:create-undead',
    ) as {
      scaling: Array<{
        options: Array<{
          slotLevel: number;
          choices: unknown[];
        }>;
      }>;
    };
    expect(
      createUndead.scaling[0].options.find(({ slotLevel }) => slotLevel === 8)
        ?.choices,
    ).toEqual([
      {
        creatureRefs: ['creature:ghoul'],
        cardinality: { mode: 'maximum', count: 5 },
      },
      {
        creatureRefs: ['creature:ghast', 'creature:wight'],
        cardinality: { mode: 'maximum', count: 2 },
        composition: {
          kind: 'source-ambiguity',
          ambiguityId: 'ambiguity:create-undead-ghast-wight-composition',
        },
      },
    ]);

    const findFamiliar = materializeS1SummoningEffect(
      'spell:find-familiar',
    ) as { transitions: Array<Record<string, unknown>> };
    expect(
      findFamiliar.transitions.filter(
        ({ trigger }) => trigger === 'action-permanent-dismissal',
      ),
    ).toEqual([
      {
        id: 'permanent-dismissal-from-present-or-pocket',
        trigger: 'action-permanent-dismissal',
        when: {
          presence: ['present', 'pocket-dimension'],
          link: 'active',
        },
        changes: [
          { axis: 'presence', to: 'absent' },
          { axis: 'link', to: 'none' },
        ],
      },
      {
        id: 'permanent-dismissal-from-zero-hp-absence',
        trigger: 'action-permanent-dismissal',
        when: { presence: 'absent', link: 'active' },
        changes: [
          { axis: 'presence', to: 'absent' },
          { axis: 'link', to: 'none' },
        ],
        availability: {
          kind: 'source-ambiguity',
          ambiguityId:
            'ambiguity:find-familiar-permanent-dismissal-after-zero-hp',
        },
      },
    ]);
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
