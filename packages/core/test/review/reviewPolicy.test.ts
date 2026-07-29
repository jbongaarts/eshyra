import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classifyChange,
  type LoadedPolicy,
  loadMinimumProfilePolicy,
  matchesGlob,
  PolicyError,
  parseMinimumProfilePolicy,
} from '../../scripts/review/policy.js';
import {
  isAtLeast,
  POLICY_PATH,
  profileRank,
  REVIEW_PROFILES,
  strictestProfile,
} from '../../scripts/review/profiles.js';

const repoRoot = process.cwd();
const policy: LoadedPolicy = loadMinimumProfilePolicy(repoRoot);

function classify(
  declared: Parameters<typeof classifyChange>[1]['declaredProfile'],
  changedPaths: string[],
  characteristics: string[] = [],
) {
  return classifyChange(policy, {
    declaredProfile: declared,
    changedPaths,
    characteristics,
  });
}

describe('profile ordering', () => {
  it('is total and strictly increasing', () => {
    expect(REVIEW_PROFILES).toEqual([
      'standard',
      'semantic-system',
      'rules-clause-complete',
    ]);
    expect(profileRank('standard')).toBeLessThan(
      profileRank('semantic-system'),
    );
    expect(profileRank('semantic-system')).toBeLessThan(
      profileRank('rules-clause-complete'),
    );
  });

  it('strictestProfile picks the stricter side either way round', () => {
    expect(strictestProfile('standard', 'semantic-system')).toBe(
      'semantic-system',
    );
    expect(strictestProfile('semantic-system', 'standard')).toBe(
      'semantic-system',
    );
    expect(isAtLeast('rules-clause-complete', 'semantic-system')).toBe(true);
    expect(isAtLeast('standard', 'semantic-system')).toBe(false);
  });
});

describe('glob matching', () => {
  it('matches directory trees with a trailing **', () => {
    expect(
      matchesGlob(
        'packages/core/scripts/importers/**',
        'packages/core/scripts/importers/dnd5e-srd-5.1/cli.ts',
      ),
    ).toBe(true);
    expect(
      matchesGlob(
        'packages/core/scripts/importers/**',
        'packages/core/scripts/review/cli.ts',
      ),
    ).toBe(false);
  });

  it('matches within a single segment with *', () => {
    expect(
      matchesGlob(
        'packages/core/src/character/srd*.ts',
        'packages/core/src/character/srdLanguages.ts',
      ),
    ).toBe(true);
    expect(
      matchesGlob(
        'packages/core/src/character/srd*.ts',
        'packages/core/src/character/nested/srdLanguages.ts',
      ),
    ).toBe(false);
  });

  it('matches an interior ** across zero or more segments', () => {
    expect(matchesGlob('a/**/b.ts', 'a/b.ts')).toBe(true);
    expect(matchesGlob('a/**/b.ts', 'a/x/y/b.ts')).toBe(true);
    expect(matchesGlob('a/**/b.ts', 'a/x/y/c.ts')).toBe(false);
  });

  it('matches a leading ** without requiring a leading slash', () => {
    expect(matchesGlob('**/cli.ts', 'cli.ts')).toBe(true);
    expect(matchesGlob('**/cli.ts', 'packages/core/cli.ts')).toBe(true);
  });
});

describe('path-derived escalation against real repository paths', () => {
  it('escalates importer paths to rules-clause-complete', () => {
    const result = classify('standard', [
      'packages/core/scripts/importers/dnd5e-srd-5.1/parseSpells.ts',
    ]);
    expect(result.pathMinimum).toBe('rules-clause-complete');
    expect(result.effectiveProfile).toBe('rules-clause-complete');
    expect(result.underClassified).toBe(true);
  });

  it('escalates generated rules-pack records', () => {
    expect(
      classify('standard', [
        'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records/spell.json',
      ]).pathMinimum,
    ).toBe('rules-clause-complete');
  });

  it('escalates rules schemas and clause representations', () => {
    expect(
      classify('standard', ['packages/core/src/rules/kindSchemas.ts'])
        .pathMinimum,
    ).toBe('rules-clause-complete');
    expect(
      classify('standard', ['packages/core/src/rules/srdAudit.ts']).pathMinimum,
    ).toBe('rules-clause-complete');
  });

  it('escalates persisted state and migrations to semantic-system only', () => {
    const result = classify('standard', [
      'packages/core/src/persistence/checkpoint/store.ts',
      'packages/core/data/migrations/0025_example.sql',
    ]);
    expect(result.pathMinimum).toBe('semantic-system');
    expect(result.effectiveProfile).toBe('semantic-system');
  });

  it('escalates the review-governance system itself to semantic-system', () => {
    expect(
      classify('standard', [
        'packages/core/scripts/review/policy.ts',
        'docs/review/eshyra-development-and-review-protocol.md',
      ]).pathMinimum,
    ).toBe('semantic-system');
  });

  it('leaves unrelated paths at standard', () => {
    const result = classify('standard', [
      'packages/cli/src/index.ts',
      'README.md',
      'site/index.html',
      'docs/install.md',
      'scripts/smoke-cli-install.mjs',
      '.github/workflows/release.yml',
    ]);
    expect(result.pathMinimum).toBe('standard');
    expect(result.effectiveProfile).toBe('standard');
    expect(result.escalations).toHaveLength(0);
    expect(result.underClassified).toBe(false);
  });

  it('takes the strictest matching rule when paths straddle categories', () => {
    const result = classify('standard', [
      'packages/cli/src/index.ts',
      'packages/core/src/persistence/db.ts',
      'packages/core/src/rules/packLoader.ts',
    ]);
    expect(result.pathMinimum).toBe('rules-clause-complete');
  });
});

describe('characteristic-derived escalation', () => {
  it('escalates from an ordinary path when a characteristic demands it', () => {
    const result = classify(
      'standard',
      ['packages/core/src/state/rest.ts'],
      ['pack-driven-runtime-semantics'],
    );
    expect(result.pathMinimum).toBe('semantic-system');
    expect(result.characteristicMinimum).toBe('rules-clause-complete');
    expect(result.effectiveProfile).toBe('rules-clause-complete');
  });

  it('escalates a wholly unrelated path', () => {
    const result = classify(
      'standard',
      ['packages/cli/src/index.ts'],
      ['persisted-state-change'],
    );
    expect(result.pathMinimum).toBe('standard');
    expect(result.effectiveProfile).toBe('semantic-system');
  });

  it('can never weaken the path-derived minimum', () => {
    const result = classify(
      'standard',
      ['packages/core/scripts/importers/dnd5e-srd-5.1/cli.ts'],
      ['persisted-state-change'],
    );
    expect(result.characteristicMinimum).toBe('semantic-system');
    expect(result.minimumProfile).toBe('rules-clause-complete');
  });

  it('reports an unrecognized characteristic rather than ignoring it', () => {
    const result = classify(
      'standard',
      ['packages/cli/src/index.ts'],
      ['probably-fine'],
    );
    expect(result.unknownCharacteristics).toEqual(['probably-fine']);
  });

  it('treats "none" as no declared characteristic', () => {
    expect(
      classify('standard', ['packages/cli/src/index.ts'], ['none'])
        .unknownCharacteristics,
    ).toEqual([]);
  });
});

describe('effective profile', () => {
  it('rejects under-classification', () => {
    const result = classify('semantic-system', [
      'packages/core/src/rules/types.ts',
    ]);
    expect(result.effectiveProfile).toBe('rules-clause-complete');
    expect(result.underClassified).toBe(true);
    expect(result.overClassified).toBe(false);
  });

  it('permits voluntary over-classification', () => {
    const result = classify('rules-clause-complete', [
      'packages/cli/src/index.ts',
    ]);
    expect(result.effectiveProfile).toBe('rules-clause-complete');
    expect(result.underClassified).toBe(false);
    expect(result.overClassified).toBe(true);
  });

  it('is neither under nor over when declared equals minimum', () => {
    const result = classify('semantic-system', [
      'packages/core/src/persistence/db.ts',
    ]);
    expect(result.underClassified).toBe(false);
    expect(result.overClassified).toBe(false);
  });
});

describe('policy identity', () => {
  it('hashes the policy deterministically and independently of key order', () => {
    const raw = readFileSync(`${repoRoot}/${POLICY_PATH}`, 'utf8');
    const reparsed = parseMinimumProfilePolicy(raw);
    expect(reparsed.policyHash).toBe(policy.policyHash);

    const reordered = JSON.stringify(
      Object.fromEntries(
        Object.entries(JSON.parse(raw) as Record<string, unknown>).reverse(),
      ),
    );
    expect(parseMinimumProfilePolicy(reordered).policyHash).toBe(
      policy.policyHash,
    );
  });

  it('changes the hash when a rule changes', () => {
    const mutated = JSON.parse(
      readFileSync(`${repoRoot}/${POLICY_PATH}`, 'utf8'),
    ) as { pathRules: { patterns: string[] }[] };
    mutated.pathRules[0].patterns.push('some/new/path/**');
    expect(
      parseMinimumProfilePolicy(JSON.stringify(mutated)).policyHash,
    ).not.toBe(policy.policyHash);
  });

  it('rejects a policy for a different protocol', () => {
    const mutated = JSON.parse(
      readFileSync(`${repoRoot}/${POLICY_PATH}`, 'utf8'),
    ) as Record<string, unknown>;
    mutated.protocol = 'eshyra-review-v1';
    expect(() => parseMinimumProfilePolicy(JSON.stringify(mutated))).toThrow(
      PolicyError,
    );
  });

  it('rejects a policy rule naming an unknown profile', () => {
    const mutated = JSON.parse(
      readFileSync(`${repoRoot}/${POLICY_PATH}`, 'utf8'),
    ) as { pathRules: { profile: string }[] };
    mutated.pathRules[0].profile = 'extremely-careful';
    expect(() => parseMinimumProfilePolicy(JSON.stringify(mutated))).toThrow(
      PolicyError,
    );
  });
});
