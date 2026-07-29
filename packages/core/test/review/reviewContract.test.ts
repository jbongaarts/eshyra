import { describe, expect, it } from 'vitest';
import {
  ContractError,
  extractContractBlocks,
  hashNormalizedContract,
  isPlaceholderValue,
  normalizeContractBlock,
  parseReviewContract,
  renderNormalizedContract,
  requiredSections,
} from '../../scripts/review/contract.js';
import { canonicalJson } from '../../scripts/review/hashing.js';
import { buildContract } from './support/reviewFakes.js';

function parse(text: string, beadId = 'eshyra-test.1') {
  return parseReviewContract({
    beadId,
    sources: [{ label: 'description', text }],
  });
}

function problems(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof ContractError) {
      return error.problems.map((problem) => problem.code);
    }
    throw error;
  }
  throw new Error('Expected a ContractError but none was thrown.');
}

describe('contract extraction', () => {
  it('extracts a valid common contract for every profile', () => {
    for (const profile of [
      'standard',
      'semantic-system',
      'rules-clause-complete',
    ] as const) {
      const parsed = parse(buildContract({ profile }));
      expect(parsed.declaredProfile).toBe(profile);
      expect(parsed.owningBead).toBe('eshyra-test.1');
      expect(parsed.contractHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('rejects a bead with no contract', () => {
    expect(problems(() => parse('Just a description, no contract.'))).toEqual([
      'CONTRACT_MISSING',
    ]);
  });

  it('rejects duplicate normative contracts', () => {
    const twice = `${buildContract({ profile: 'standard' })}\n\n${buildContract({ profile: 'standard' })}`;
    expect(problems(() => parse(twice))).toEqual(['CONTRACT_DUPLICATE']);
  });

  it('rejects duplicates split across bead fields', () => {
    const codes = problems(() =>
      parseReviewContract({
        beadId: 'eshyra-test.1',
        sources: [
          {
            label: 'description',
            text: buildContract({ profile: 'standard' }),
          },
          {
            label: 'acceptance',
            text: buildContract({ profile: 'standard' }),
          },
        ],
      }),
    );
    expect(codes).toEqual(['CONTRACT_DUPLICATE']);
  });

  it('ignores a contract heading inside a fenced code block', () => {
    const doc = [
      'Prose that shows the template:',
      '',
      '```markdown',
      '## REVIEW CONTRACT',
      'Protocol: eshyra-review-v2',
      '```',
      '',
      buildContract({ profile: 'standard' }),
    ].join('\n');
    expect(extractContractBlocks(doc)).toHaveLength(1);
    expect(parse(doc).declaredProfile).toBe('standard');
  });

  it('stops the block at the next level-2 heading', () => {
    const doc = `${buildContract({ profile: 'standard' })}\n\n## Notes\n\n### Review classification\n- Declared profile: rules-clause-complete`;
    const parsed = parse(doc);
    expect(parsed.declaredProfile).toBe('standard');
  });
});

describe('required sections per profile', () => {
  it('is cumulative in strictness order', () => {
    const standard = requiredSections('standard').map((s) => s.title);
    const semantic = requiredSections('semantic-system').map((s) => s.title);
    const rules = requiredSections('rules-clause-complete').map((s) => s.title);
    expect(semantic).toEqual(expect.arrayContaining(standard));
    expect(rules).toEqual(expect.arrayContaining(semantic));
    expect(rules).toContain('Source or authoritative obligations');
    expect(standard).not.toContain('Semantic-system contract');
  });

  it('rejects a missing required section', () => {
    const codes = problems(() =>
      parse(
        buildContract({
          profile: 'standard',
          omitSections: ['Authority and inputs'],
        }),
      ),
    );
    expect(codes).toContain('SECTION_MISSING');
  });

  it('rejects a semantic-system contract missing its extra section', () => {
    const codes = problems(() =>
      parse(
        buildContract({
          profile: 'semantic-system',
          omitSections: ['Semantic-system contract'],
        }),
      ),
    );
    expect(codes).toContain('SECTION_MISSING');
  });

  it('rejects a rules-clause contract missing a rules section', () => {
    const codes = problems(() =>
      parse(
        buildContract({
          profile: 'rules-clause-complete',
          omitSections: ['Capability boundary'],
        }),
      ),
    );
    expect(codes).toContain('SECTION_MISSING');
  });

  it('rejects profile sections stricter than the declared profile', () => {
    const codes = problems(() =>
      parse(
        buildContract({
          profile: 'standard',
          extraSections: [
            '### Semantic-system contract',
            '- Trust boundaries: something.',
            '- Stable identities and revisions: something.',
            '- State transitions and lifecycle: something.',
            '- Stale-state detection: something.',
            '- Migration and backward compatibility: something.',
            '- Adversarial scenarios: something.',
          ].join('\n'),
        }),
      ),
    );
    expect(codes).toContain('PROFILE_SECTION_INCONSISTENT');
  });
});

describe('placeholder detection', () => {
  it('treats assertion-free values as placeholders', () => {
    for (const value of ['', 'TBD', 'todo', '???', '...', '  -  ', 'pending']) {
      expect(isPlaceholderValue(value)).toBe(true);
    }
  });

  it('does not treat "none" or "n/a" as placeholders', () => {
    // These are real answers to questions like "approved residuals". Rejecting
    // them would push authors toward mechanically filled free text.
    for (const value of ['none', 'None.', 'n/a', 'not applicable']) {
      expect(isPlaceholderValue(value)).toBe(false);
    }
  });

  it('rejects a placeholder-only required field', () => {
    const codes = problems(() =>
      parse(
        buildContract({
          profile: 'standard',
          placeholderField: 'Intended outcome',
        }),
      ),
    );
    expect(codes).toContain('FIELD_PLACEHOLDER');
  });
});

describe('classification fields', () => {
  it('rejects an invalid declared profile', () => {
    const text = buildContract({ profile: 'standard' }).replace(
      '- Declared profile: standard',
      '- Declared profile: extremely-careful',
    );
    expect(problems(() => parse(text))).toContain('DECLARED_PROFILE_INVALID');
  });

  it('rejects contradictory authorization on a mandatory profile', () => {
    const codes = problems(() =>
      parse(buildContract({ profile: 'semantic-system', authorization: 'no' })),
    );
    expect(codes).toContain('AUTHORIZATION_CONTRADICTORY');
  });

  it('rejects an unparseable authorization flag', () => {
    const codes = problems(() =>
      parse(buildContract({ profile: 'standard', authorization: 'maybe' })),
    );
    expect(codes).toContain('AUTHORIZATION_FLAG_INVALID');
  });

  it('rejects an owning-bead mismatch', () => {
    const codes = problems(() =>
      parse(buildContract({ profile: 'standard', beadId: 'eshyra-other' })),
    );
    expect(codes).toContain('OWNING_BEAD_MISMATCH');
  });

  it('rejects an unknown protocol rather than skipping it', () => {
    const codes = problems(() =>
      parse(
        buildContract({ profile: 'standard', protocol: 'eshyra-review-v9' }),
      ),
    );
    expect(codes).toContain('PROTOCOL_MISMATCH');
  });

  it('reads change characteristics as a list', () => {
    const parsed = parse(
      buildContract({
        profile: 'standard',
        characteristics: 'persisted-state-change; migration-required',
      }),
    );
    expect(parsed.declaredCharacteristics).toEqual([
      'persisted-state-change',
      'migration-required',
    ]);
  });
});

describe('deterministic normalization and hashing', () => {
  const base = buildContract({ profile: 'semantic-system' });

  it('is stable across formatting-only rewrites', () => {
    const reformatted = base
      // hard-wrap a long value across three lines
      .replace(
        '- Intended outcome: Make the widget resolve deterministically.',
        '- Intended outcome: Make the widget\n  resolve\n  deterministically.',
      )
      // change list markers and heading spacing
      .replace(/^- /gm, '*   ')
      .replace(/^### /gm, '###   ')
      // add blank lines and trailing whitespace
      .replace(/\n\n/g, '\n\n\n')
      .replace(/$/gm, '   ');

    expect(hashNormalizedContract(normalizeContractBlock(reformatted))).toBe(
      hashNormalizedContract(normalizeContractBlock(base)),
    );
  });

  it('is stable across CRLF line endings', () => {
    expect(
      hashNormalizedContract(
        normalizeContractBlock(base.replace(/\n/g, '\r\n')),
      ),
    ).toBe(hashNormalizedContract(normalizeContractBlock(base)));
  });

  it('changes when semantic content changes', () => {
    const edited = base.replace(
      'Make the widget resolve deterministically.',
      'Make the widget resolve heuristically.',
    );
    expect(hashNormalizedContract(normalizeContractBlock(edited))).not.toBe(
      hashNormalizedContract(normalizeContractBlock(base)),
    );
  });

  it('is insensitive to key casing but sensitive to key text', () => {
    const cased = base.replace('- Intended outcome:', '- INTENDED OUTCOME:');
    expect(hashNormalizedContract(normalizeContractBlock(cased))).toBe(
      hashNormalizedContract(normalizeContractBlock(base)),
    );
    const renamed = base.replace('- Intended outcome:', '- Intended outcomes:');
    expect(hashNormalizedContract(normalizeContractBlock(renamed))).not.toBe(
      hashNormalizedContract(normalizeContractBlock(base)),
    );
  });

  it('folds nested bullets into items, preserving order', () => {
    const withItems = normalizeContractBlock(
      [
        '## REVIEW CONTRACT',
        'Protocol: eshyra-review-v2',
        '### Review classification',
        '- Change characteristics:',
        '  - persisted-state-change',
        '  - migration-required',
      ].join('\n'),
    );
    const field = withItems.sections[0].fields[0];
    expect(field.items).toEqual([
      'persisted-state-change',
      'migration-required',
    ]);
    const reordered = normalizeContractBlock(
      [
        '## REVIEW CONTRACT',
        'Protocol: eshyra-review-v2',
        '### Review classification',
        '- Change characteristics:',
        '  - migration-required',
        '  - persisted-state-change',
      ].join('\n'),
    );
    expect(hashNormalizedContract(reordered)).not.toBe(
      hashNormalizedContract(withItems),
    );
  });

  it('round-trips through the rendered form without moving the hash', () => {
    const normalized = normalizeContractBlock(base);
    const rendered = renderNormalizedContract(normalized);
    expect(hashNormalizedContract(normalizeContractBlock(rendered))).toBe(
      hashNormalizedContract(normalized),
    );
  });
});

describe('RFC 8785 canonicalization', () => {
  it('is insensitive to JSON property insertion order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('sorts by UTF-16 code unit, not locale', () => {
    expect(canonicalJson({ Z: 1, a: 2 })).toBe('{"Z":1,"a":2}');
  });

  it('refuses non-finite numbers rather than coercing them', () => {
    expect(() =>
      canonicalJson({ n: Number.POSITIVE_INFINITY as unknown as number }),
    ).toThrow(/non-finite/);
  });
});
