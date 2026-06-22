import type {
  CompatibleBaseSystem,
  RulesPack,
  RulesPackMeta,
  RulesRecord,
  RulesRecordKind,
} from './types.js';
import { RulesPackError } from './types.js';

export interface ResolveRulesStackInput {
  readonly base: RulesPack;
  readonly addons?: readonly RulesPack[];
}

export interface RulesStackRecordSource {
  readonly record: RulesRecord;
  readonly pack: RulesPack;
  readonly license: RulesRecord['license'];
}

export interface RulesStackRecordEntry extends RulesStackRecordSource {
  readonly overrideChain: readonly RulesStackRecordSource[];
}

export interface RulesStackKindIndex {
  readonly byKey: ReadonlyMap<string, RulesStackRecordEntry>;
  /**
   * Normalized name → every record of this kind currently carrying that name.
   * The audited SRD legitimately repeats names within a kind (e.g. the
   * `feature` "Ability Score Improvement" on every class), so a name maps to a
   * list, not a single entry. Key/ref lookup stays canonical via `byKey`; name
   * lookup is only unambiguous when exactly one entry shares the name (ADR
   * 0013).
   */
  readonly byName: ReadonlyMap<string, readonly RulesStackRecordEntry[]>;
}

export interface ResolvedRulesStack {
  readonly base: RulesPack;
  readonly addons: readonly RulesPack[];
  readonly packs: readonly RulesPack[];
  readonly recordsByKey: ReadonlyMap<string, RulesStackRecordEntry>;
  readonly recordsByKind: ReadonlyMap<RulesRecordKind, RulesStackKindIndex>;
}

export function resolveRulesStack(
  input: ResolveRulesStackInput,
): ResolvedRulesStack {
  assertBasePack(input.base);
  assertUniquePackIds([input.base, ...(input.addons ?? [])]);

  const addons = orderAddons(input.addons ?? []);
  for (const addon of addons) {
    assertAddonPack(addon);
    assertCompatibleWithBase(addon, input.base.meta);
  }
  assertDependencies(addons);

  const packs = [input.base, ...addons];
  const recordsByKey = new Map<string, RulesStackRecordEntry>();
  const recordsByKind = new Map<RulesRecordKind, RulesStackKindIndexBuilder>();

  for (const pack of packs) {
    for (const record of pack.records) {
      const existing = recordsByKey.get(record.key);
      const entry = mergeRecord(pack, record, existing);
      if (existing !== undefined) {
        removeFromKindIndex(recordsByKind, existing);
      }
      recordsByKey.set(record.key, entry);
      addToKindIndex(kindIndexFor(recordsByKind, record.kind), record, entry);
    }
  }

  return {
    base: input.base,
    addons,
    packs,
    recordsByKey,
    recordsByKind: freezeKindIndexes(recordsByKind),
  };
}

function assertBasePack(pack: RulesPack): void {
  if (pack.meta.role !== 'base') {
    throw new RulesPackError(
      `rules stack base pack must have role base: ${pack.meta.packId}`,
    );
  }
}

function assertUniquePackIds(packs: readonly RulesPack[]): void {
  const seen = new Set<string>();

  for (const pack of packs) {
    const packId = pack.meta.packId;
    if (seen.has(packId)) {
      throw new RulesPackError(`duplicate rules pack id in stack: ${packId}`);
    }
    seen.add(packId);
  }
}

function assertAddonPack(pack: RulesPack): void {
  if (pack.meta.role !== 'addon') {
    throw new RulesPackError(
      `rules stack add-on pack must have role addon: ${pack.meta.packId}`,
    );
  }
}

function orderAddons(addons: readonly RulesPack[]): readonly RulesPack[] {
  return addons
    .map((pack, index) => ({ pack, index }))
    .sort((a, b) => {
      const orderDelta = addonOrder(a.pack) - addonOrder(b.pack);
      return orderDelta === 0 ? a.index - b.index : orderDelta;
    })
    .map((item) => item.pack);
}

function addonOrder(pack: RulesPack): number {
  return pack.meta.order ?? Number.MAX_SAFE_INTEGER;
}

function assertCompatibleWithBase(addon: RulesPack, base: RulesPackMeta): void {
  const compatible = addon.meta.compatibleBaseSystems?.some((candidate) =>
    matchesBase(candidate, base),
  );
  if (!compatible) {
    throw new RulesPackError(
      `add-on ${addon.meta.packId} does not declare a compatible base for ${base.systemId} ${base.version}`,
    );
  }
}

function matchesBase(
  compatibleBase: CompatibleBaseSystem,
  base: RulesPackMeta,
): boolean {
  return (
    compatibleBase.systemId === base.systemId &&
    compatibleBase.versions.includes(base.version)
  );
}

function assertDependencies(addons: readonly RulesPack[]): void {
  const addonIds = new Set(addons.map((addon) => addon.meta.packId));
  const resolved = new Set<string>();

  for (const addon of addons) {
    for (const dependency of addon.meta.dependsOn ?? []) {
      if (!addonIds.has(dependency)) {
        throw new RulesPackError(
          `add-on ${addon.meta.packId} has missing dependency: ${dependency}`,
        );
      }
      if (!resolved.has(dependency)) {
        throw new RulesPackError(
          `add-on ${addon.meta.packId} depends on ${dependency}, which must resolve earlier in the stack`,
        );
      }
    }
    resolved.add(addon.meta.packId);
  }
}

function mergeRecord(
  pack: RulesPack,
  record: RulesRecord,
  existing: RulesStackRecordEntry | undefined,
): RulesStackRecordEntry {
  if (existing === undefined) {
    return {
      record,
      pack,
      license: record.license,
      overrideChain: [],
    };
  }

  if (!namesOverride(record, existing)) {
    throw new RulesPackError(
      `duplicate record key ${record.key} from ${pack.meta.packId} must explicitly override ${existing.pack.meta.packId}`,
    );
  }
  if (record.kind !== existing.record.kind) {
    throw new RulesPackError(
      `override record ${record.key} from ${pack.meta.packId} must preserve record kind ${existing.record.kind}`,
    );
  }
  if (record.systemId !== existing.record.systemId) {
    throw new RulesPackError(
      `override record ${record.key} from ${pack.meta.packId} must preserve system id ${existing.record.systemId}`,
    );
  }

  return {
    record,
    pack,
    license: record.license,
    overrideChain: [
      ...existing.overrideChain,
      {
        record: existing.record,
        pack: existing.pack,
        license: existing.license,
      },
    ],
  };
}

function namesOverride(
  record: RulesRecord,
  existing: RulesStackRecordEntry,
): boolean {
  return (record.overrides ?? []).some((ref) =>
    overrideRefMatches(ref, existing.pack.meta.packId, existing.record.key),
  );
}

function overrideRefMatches(ref: string, packId: string, key: string): boolean {
  return (
    ref === `${packId}/${key}` ||
    ref === `${packId}#${key}` ||
    ref === `${packId}:${key}`
  );
}

interface RulesStackKindIndexBuilder {
  readonly byKey: Map<string, RulesStackRecordEntry>;
  readonly byName: Map<string, RulesStackRecordEntry[]>;
}

function kindIndexFor(
  indexes: Map<RulesRecordKind, RulesStackKindIndexBuilder>,
  kind: RulesRecordKind,
): RulesStackKindIndexBuilder {
  const existing = indexes.get(kind);
  if (existing !== undefined) {
    return existing;
  }

  const created = { byKey: new Map(), byName: new Map() };
  indexes.set(kind, created);
  return created;
}

function addToKindIndex(
  index: RulesStackKindIndexBuilder,
  record: RulesRecord,
  entry: RulesStackRecordEntry,
): void {
  index.byKey.set(record.key, entry);

  // Duplicate normalized names within a kind are legitimate in the audited SRD
  // (ADR 0013): keep every distinct-key record under the shared name so name
  // lookup can report ambiguity instead of silently picking one. Records are
  // addressed by key first, so a re-add for the same key replaces its slot.
  for (const name of recordLookupNames(record)) {
    const entries = index.byName.get(name);
    if (entries === undefined) {
      index.byName.set(name, [entry]);
      continue;
    }
    const existingIndex = entries.findIndex(
      (candidate) => candidate.record.key === record.key,
    );
    if (existingIndex === -1) {
      entries.push(entry);
    } else {
      entries[existingIndex] = entry;
    }
  }
}

function removeFromKindIndex(
  indexes: ReadonlyMap<RulesRecordKind, RulesStackKindIndexBuilder>,
  entry: RulesStackRecordEntry,
): void {
  const index = indexes.get(entry.record.kind);
  if (index === undefined) {
    return;
  }

  if (index.byKey.get(entry.record.key) === entry) {
    index.byKey.delete(entry.record.key);
  }
  for (const name of recordLookupNames(entry.record)) {
    const entries = index.byName.get(name);
    if (entries === undefined) {
      continue;
    }
    const remaining = entries.filter((candidate) => candidate !== entry);
    if (remaining.length === 0) {
      index.byName.delete(name);
    } else if (remaining.length !== entries.length) {
      index.byName.set(name, remaining);
    }
  }
}

function freezeKindIndexes(
  indexes: ReadonlyMap<RulesRecordKind, RulesStackKindIndexBuilder>,
): ReadonlyMap<RulesRecordKind, RulesStackKindIndex> {
  return new Map(
    [...indexes.entries()].map(([kind, index]) => [
      kind,
      { byKey: index.byKey, byName: index.byName },
    ]),
  );
}

function normalizeName(name: string): string {
  return name
    .trim()
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
}

/**
 * Generated SRD equipment names sometimes carry package quantities while
 * gameplay refers to the item generically (for example "Crossbow bolts (20)").
 * Keep those aliases attached to canonical record keys instead of inventing
 * additional rules records.
 */
const RECORD_NAME_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'equipment:crossbow-bolts-20': [
    'crossbow bolt',
    'crossbow bolts',
    '20 bolts',
  ],
  'equipment:rations-1-day': [
    'ration',
    'rations',
    'day of rations',
    'days of rations',
  ],
  'equipment:leather': ['leather armor'],
};

function recordLookupNames(record: RulesRecord): readonly string[] {
  const names = new Set<string>();
  const add = (name: string): void => {
    const normalized = normalizeName(name);
    names.add(normalized);
    names.add(normalized.replaceAll("'", ''));
  };

  add(record.name);
  const withoutParenthetical = record.name.replace(/\s*\([^)]*\)\s*$/, '');
  add(withoutParenthetical);
  const commaParts = /^([^,]+),\s*(.+)$/.exec(withoutParenthetical);
  if (commaParts !== null) {
    add(`${commaParts[2]} ${commaParts[1]}`);
  }

  if (record.kind === 'equipment') {
    add(pluralizeLastWord(withoutParenthetical));
  }

  for (const alias of RECORD_NAME_ALIASES[record.key] ?? []) {
    add(alias);
  }
  return [...names];
}

function pluralizeLastWord(name: string): string {
  const match = /^(.*?)([A-Za-z]+)$/.exec(name);
  if (match === null) {
    return name;
  }
  const [, prefix = '', word = ''] = match;
  if (/s$/i.test(word)) return name;
  if (/[^aeiou]y$/i.test(word)) return `${prefix}${word.slice(0, -1)}ies`;
  if (/(?:ch|sh|x|z)$/i.test(word)) return `${prefix}${word}es`;
  return `${prefix}${word}s`;
}

export { normalizeName as normalizeRulesRecordName };
