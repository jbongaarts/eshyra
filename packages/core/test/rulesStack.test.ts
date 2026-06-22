import { describe, expect, it } from 'vitest';
import type {
  RulesPack,
  RulesPackLicense,
  RulesRecord,
} from '../src/internal.js';
import {
  lookupRulesRecord,
  RulesPackError,
  resolveRulesStack,
} from '../src/internal.js';

function license(overrides: Partial<RulesPackLicense> = {}): RulesPackLicense {
  return {
    licenseClass: 'open',
    licenseName: 'Creative Commons Attribution 4.0 International',
    attributionText: 'Rules text derived from an open SRD fixture.',
    requiresAttribution: true,
    commercialUseAllowed: true,
    hostedUseAllowed: true,
    redistributionAllowed: true,
    publicSharingAllowed: true,
    derivativeAllowed: true,
    containsUserSuppliedText: false,
    containsTrademarkedSettingMaterial: false,
    sourceMaterialDescription: 'Open fantasy rules reference.',
    provenancePolicy: 'Every record includes source and license metadata.',
    outputRestrictions: 'Preserve attribution on redistributed records.',
    ...overrides,
  };
}

function record(
  key: string,
  overrides: Partial<RulesRecord> = {},
): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'creature',
    key,
    name: 'Goblin',
    data: { hitPoints: 7 },
    source: 'Example SRD p. 1',
    license: license(),
    ...overrides,
  };
}

function basePack(
  overrides: Partial<RulesPack['meta']> & {
    records?: readonly RulesRecord[];
  } = {},
): RulesPack {
  const { records, ...metaOverrides } = overrides;
  return {
    meta: {
      packId: 'rules:dnd5e-srd',
      title: 'D&D 5e SRD',
      description: 'Provider-neutral rules fixture.',
      role: 'base',
      systemId: 'dnd5e-srd',
      version: '5.1',
      license: license(),
      ...metaOverrides,
    },
    records: records ?? [record('creature:goblin')],
  };
}

type AddonMetaOverrides = Partial<RulesPack['meta']> & {
  readonly order?: number;
  readonly dependsOn?: readonly string[];
};

function addonPack(
  overrides: AddonMetaOverrides & {
    records?: readonly RulesRecord[];
  } = {},
): RulesPack {
  const { records, ...metaOverrides } = overrides;
  return {
    meta: {
      packId: 'rules:goblin-addons',
      title: 'Goblin Add-ons',
      description: 'Small addon fixture.',
      role: 'addon',
      systemId: 'goblin-addons',
      version: '1.0.0',
      compatibleBaseSystems: [{ systemId: 'dnd5e-srd', versions: ['5.1'] }],
      license: license(),
      ...metaOverrides,
    },
    records: records ?? [
      record('creature:goblin-boss', { name: 'Goblin Boss' }),
    ],
  };
}

function overrideRef(pack: RulesPack, key: string): string {
  return `${pack.meta.packId}/${key}`;
}

describe('rules stack resolution', () => {
  it('resolves one base pack', () => {
    const base = basePack();
    const stack = resolveRulesStack({ base, addons: [] });

    expect(stack.packs.map((pack) => pack.meta.packId)).toEqual([
      'rules:dnd5e-srd',
    ]);
    expect(stack.recordsByKey.get('creature:goblin')?.record.name).toBe(
      'Goblin',
    );
  });

  it('resolves add-ons in explicit order', () => {
    const first = addonPack({
      packId: 'rules:first-addon',
      records: [record('creature:first', { name: 'First' })],
      order: 20,
    });
    const second = addonPack({
      packId: 'rules:second-addon',
      records: [record('creature:second', { name: 'Second' })],
      order: 10,
    });

    const stack = resolveRulesStack({
      base: basePack(),
      addons: [first, second],
    });

    expect(stack.packs.map((pack) => pack.meta.packId)).toEqual([
      'rules:dnd5e-srd',
      'rules:second-addon',
      'rules:first-addon',
    ]);
  });

  it('rejects an add-on incompatible with the base', () => {
    const addon = addonPack({
      compatibleBaseSystems: [{ systemId: 'pathfinder-2e', versions: ['2.0'] }],
    });

    expect(() =>
      resolveRulesStack({ base: basePack(), addons: [addon] }),
    ).toThrow(RulesPackError);
    expect(() =>
      resolveRulesStack({ base: basePack(), addons: [addon] }),
    ).toThrow(/compatible base/i);
  });

  it('rejects a missing add-on dependency', () => {
    const addon = addonPack({
      packId: 'rules:dependent-addon',
      dependsOn: ['rules:missing-addon'],
    });

    expect(() =>
      resolveRulesStack({ base: basePack(), addons: [addon] }),
    ).toThrow(RulesPackError);
    expect(() =>
      resolveRulesStack({ base: basePack(), addons: [addon] }),
    ).toThrow(/missing dependency/i);
  });

  it('rejects a duplicate record key without an explicit override', () => {
    const addon = addonPack({ records: [record('creature:goblin')] });

    expect(() =>
      resolveRulesStack({ base: basePack(), addons: [addon] }),
    ).toThrow(RulesPackError);
    expect(() =>
      resolveRulesStack({ base: basePack(), addons: [addon] }),
    ).toThrow(/duplicate record key/i);
  });

  it('accepts a duplicate record key with an explicit override', () => {
    const base = basePack();
    const addon = addonPack({
      records: [
        record('creature:goblin', {
          data: { hitPoints: 9 },
          overrides: [overrideRef(base, 'creature:goblin')],
        }),
      ],
    });

    const stack = resolveRulesStack({ base, addons: [addon] });
    const entry = stack.recordsByKey.get('creature:goblin');

    expect(entry?.record.data).toEqual({ hitPoints: 9 });
    expect(entry?.overrideChain.map((item) => item.pack.meta.packId)).toEqual([
      'rules:dnd5e-srd',
    ]);
  });

  it('allows duplicate normalized names within a kind and reports them as ambiguous (ADR 0013)', () => {
    const addon = addonPack({
      records: [
        record('creature:cave-goblin', {
          name: '  goblin  ',
        }),
      ],
    });

    // Resolution must not throw: the audited SRD legitimately repeats names
    // within a kind (e.g. "Ability Score Improvement" on every class).
    const stack = resolveRulesStack({ base: basePack(), addons: [addon] });

    // Key/ref lookup stays canonical and deterministic.
    const byRef = lookupRulesRecord(stack, {
      kind: 'creature',
      ref: 'creature:cave-goblin',
    });
    expect(byRef.ok).toBe(true);
    if (byRef.ok) {
      expect(byRef.record.key).toBe('creature:cave-goblin');
    }

    // Name lookup is ambiguous and lists candidate keys instead of mis-picking.
    const byName = lookupRulesRecord(stack, {
      kind: 'creature',
      name: 'Goblin',
    });
    expect(byName.ok).toBe(false);
    if (!byName.ok) {
      expect(byName.code).toBe('ambiguous');
      if (byName.code === 'ambiguous') {
        expect([...byName.candidateKeys].sort()).toEqual([
          'creature:cave-goblin',
          'creature:goblin',
        ]);
      }
    }
  });

  it('rejects explicit overrides that change record kind', () => {
    const base = basePack();
    const addon = addonPack({
      records: [
        record('creature:goblin', {
          kind: 'spell',
          overrides: [overrideRef(base, 'creature:goblin')],
        }),
      ],
    });

    expect(() => resolveRulesStack({ base, addons: [addon] })).toThrow(
      RulesPackError,
    );
    expect(() => resolveRulesStack({ base, addons: [addon] })).toThrow(
      /preserve record kind/i,
    );
  });

  it('rejects duplicate pack ids before resolving add-on dependencies', () => {
    const addon = addonPack({
      packId: 'rules:dnd5e-srd',
      dependsOn: ['rules:missing-addon'],
    });

    expect(() =>
      resolveRulesStack({ base: basePack(), addons: [addon] }),
    ).toThrow(RulesPackError);
    expect(() =>
      resolveRulesStack({ base: basePack(), addons: [addon] }),
    ).toThrow(/duplicate rules pack id/i);
  });

  it('replaces the normalized name lookup when an override renames a record', () => {
    const base = basePack({
      records: [record('creature:goblin', { name: 'Goblin' })],
    });
    const addon = addonPack({
      records: [
        record('creature:goblin', {
          name: 'Cave Goblin',
          overrides: [overrideRef(base, 'creature:goblin')],
        }),
      ],
    });

    const stack = resolveRulesStack({ base, addons: [addon] });

    expect(
      lookupRulesRecord(stack, { kind: 'creature', name: 'Goblin' }),
    ).toEqual({
      ok: false,
      code: 'not_found',
      message: 'No rules creature found for name Goblin.',
    });
    expect(
      lookupRulesRecord(stack, { kind: 'creature', name: 'cave   goblin' }),
    ).toMatchObject({
      ok: true,
      record: { key: 'creature:goblin', name: 'Cave Goblin' },
    });
  });

  it('looks up records by key with source pack metadata and license', () => {
    const addon = addonPack();
    const stack = resolveRulesStack({ base: basePack(), addons: [addon] });
    const result = lookupRulesRecord(stack, {
      kind: 'creature',
      ref: 'creature:goblin-boss',
    });

    expect(result).toMatchObject({
      ok: true,
      record: { key: 'creature:goblin-boss', name: 'Goblin Boss' },
      pack: { packId: 'rules:goblin-addons' },
      license: {
        licenseName: 'Creative Commons Attribution 4.0 International',
      },
      overrideChain: [],
    });
  });

  it('looks up records by exact normalized name within a kind', () => {
    const stack = resolveRulesStack({
      base: basePack({
        records: [
          record('creature:goblin', { name: 'Goblin' }),
          record('spell:goblin', {
            kind: 'spell',
            key: 'spell:goblin',
            name: 'Goblin',
          }),
        ],
      }),
      addons: [],
    });

    expect(
      lookupRulesRecord(stack, { kind: 'spell', name: '  GOBLIN  ' }),
    ).toMatchObject({
      ok: true,
      record: { key: 'spell:goblin' },
    });
    expect(lookupRulesRecord(stack, { kind: 'creature', name: 'Gob' })).toEqual(
      {
        ok: false,
        code: 'not_found',
        message: 'No rules creature found for name Gob.',
      },
    );
  });
});
