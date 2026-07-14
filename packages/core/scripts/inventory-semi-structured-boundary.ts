/**
 * Reproducible inventory for eshyra-o9bd.18.8.8.
 *
 * This reads committed pack/fixture inputs and writes only documentation
 * artifacts. It deliberately does not invoke an importer or mutate pack data.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATHFINDER2E_REMASTER_RULES_PACK } from '../src/rules/pathfinder2eRemaster.js';

type Disposition =
  | 'complete'
  | 'typed-core-with-prose-qualifier'
  | 'model-adjudicated'
  | 'unsupported'
  | 'not-mechanical';

interface Row {
  system: string;
  recordKinds: string[];
  fieldPath: string;
  representativeValues: string[];
  population: number;
  valueClass:
    | 'source prose'
    | 'identifier-like'
    | 'scalar-like'
    | 'compound mechanical text'
    | 'mixed';
  currentSchemaValidation: string;
  deterministicConsumers: string;
  currentAuditReadiness: string;
  disposition: Disposition;
  typedSchemaOrConsumer: string | null;
  owner: string | null;
  futureWork: boolean;
}

interface Seen {
  kinds: Set<string>;
  values: Set<string>;
  population: number;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const dndPath = join(
  root,
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
);
const outputPath = join(
  root,
  'docs/inventories/o9bd-18-8-8-semi-structured-boundary.json',
);
const markdownPath = join(
  root,
  'docs/inventories/o9bd-18-8-8-semi-structured-boundary.md',
);

function recordsFrom(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('records.json must be an array');
  return value as Record<string, unknown>[];
}

function add(
  seen: Map<string, Seen>,
  system: string,
  kind: string,
  path: string,
  value: unknown,
): void {
  if (typeof value === 'string') {
    const current = seen.get(`${system}|${path}`) ?? {
      kinds: new Set<string>(),
      values: new Set<string>(),
      population: 0,
    };
    current.kinds.add(kind);
    current.population += 1;
    if (current.values.size < 5) current.values.add(value);
    seen.set(`${system}|${path}`, current);
    return;
  }
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string')) {
      const current = seen.get(`${system}|${path}[]`) ?? {
        kinds: new Set<string>(),
        values: new Set<string>(),
        population: 0,
      };
      current.kinds.add(kind);
      current.population += 1;
      for (const item of value.slice(0, 5)) {
        if (current.values.size < 5) current.values.add(String(item));
      }
      seen.set(`${system}|${path}[]`, current);
      return;
    }
    for (const item of value) add(seen, system, kind, `${path}[]`, item);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      add(seen, system, kind, path ? `${path}.${key}` : key, child);
    }
  }
}

function classify(
  path: string,
  system: string,
): Omit<
  Row,
  'system' | 'recordKinds' | 'fieldPath' | 'representativeValues' | 'population'
> {
  const unsupportedOwner = /data\.(savingThrows|skills|senses)$/.test(path)
    ? 'eshyra-o9bd.18.7.9.15 (residual creature mechanics)'
    : /data\.properties\[\]$/.test(path)
      ? 'eshyra-o9bd.18.7.6 (equipment semantic payload)'
      : /data\.(charges|activation|attunementRequirement)$/.test(path)
        ? 'eshyra-o9bd.18.7.7.1 / 18.7.7 (magic-item state and activation contracts)'
        : null;
  if (unsupportedOwner) {
    return {
      valueClass: 'compound mechanical text',
      currentSchemaValidation:
        'D&D kind validator checks only the current string/array shape; no complete semantic grammar is declared.',
      deterministicConsumers:
        'future deterministic creature/equipment/magic-item consumers must not parse this ad hoc',
      currentAuditReadiness:
        'source is retained and the gap must remain visible; current readiness does not claim deterministic execution',
      disposition: 'unsupported',
      typedSchemaOrConsumer: null,
      owner: unsupportedOwner,
      futureWork: true,
    };
  }
  const prose =
    /(?:^|\.)(?:text|sourceText|description|detail|note|prompt|componentMaterials|prerequisite|trigger|condition|constraint|target|against|to|from|grant|equipment|suggestedCharacteristics)$/i.test(
      path,
    );
  const ref =
    /(?:Ref|Refs|^data\.key$|\.id$|\.kind$|\.category$|\.type$|\.mode$|\.ability$|\.skill$|\.condition$|\.relation$|\.cost$|\.reset$|\.timing$|\.frequency$|\.actionCost$|\.rarity$|\.damageType$|\.damageDie$|\.weaponRange$|\.armorType$|\.group$)/i.test(
      path,
    );
  const mechanics = path.includes('.mechanics.');
  if (mechanics) {
    return {
      valueClass: prose ? 'compound mechanical text' : 'mixed',
      currentSchemaValidation:
        'D&D kind validator validates the containing mechanics object; field contract is domain-specific.',
      deterministicConsumers:
        'mechanics projections, rules audits, and selected effect/choice resolvers',
      currentAuditReadiness:
        'retained typed projection is audited; unsupported clauses remain visible to readiness/audit layers',
      disposition: 'typed-core-with-prose-qualifier',
      typedSchemaOrConsumer:
        'domain-specific mechanics projection plus retained record/entry text',
      owner:
        'existing importer mechanics-projection and 18.7.9 engine-domain beads',
      futureWork: true,
    };
  }
  if (prose) {
    return {
      valueClass:
        path.includes('trigger') || path.includes('condition')
          ? 'compound mechanical text'
          : 'source prose',
      currentSchemaValidation:
        'containing kind validator requires a string where applicable; no semantic grammar',
      deterministicConsumers: 'none; lookup/display/model context only',
      currentAuditReadiness:
        'source coverage and rule-disposition audits retain the text; not counted as deterministic support',
      disposition:
        path.includes('description') ||
        path.includes('text') ||
        path.includes('sourceText')
          ? 'not-mechanical'
          : 'model-adjudicated',
      typedSchemaOrConsumer: null,
      owner: null,
      futureWork: false,
    };
  }
  if (ref) {
    return {
      valueClass: /ref|id|key/i.test(path) ? 'identifier-like' : 'scalar-like',
      currentSchemaValidation:
        'containing D&D/PF kind validator checks the field shape; reference fields are resolved by lookup where consumed',
      deterministicConsumers: /ref|id|key/i.test(path)
        ? 'rules-pack lookup/resolver when referenced'
        : 'record-specific consumers only where registered',
      currentAuditReadiness:
        'reference parity/readiness checks apply where a ref is declared; otherwise shape-only',
      disposition: /ref|id|key/i.test(path) ? 'complete' : 'model-adjudicated',
      typedSchemaOrConsumer: /ref|id|key/i.test(path)
        ? 'record-reference key / lookupRulesRecord'
        : null,
      owner: /ref|id|key/i.test(path)
        ? 'rules-pack lookup and owning record domain'
        : null,
      futureWork: false,
    };
  }
  return {
    valueClass: system === 'pathfinder2e-remaster' ? 'scalar-like' : 'mixed',
    currentSchemaValidation:
      'containing kind validator checks string/array shape; no universal scalar enum is inferred',
    deterministicConsumers: 'none identified outside the owning record domain',
    currentAuditReadiness:
      'shape/readiness only; string syntax is not treated as deterministic support',
    disposition: 'model-adjudicated',
    typedSchemaOrConsumer: null,
    owner: null,
    futureWork: false,
  };
}

function inventory(
  system: string,
  records: readonly Record<string, unknown>[],
): Row[] {
  const seen = new Map<string, Seen>();
  for (const record of records) {
    const kind = String(record.kind);
    add(seen, system, kind, 'data', record.data);
    for (const [key, value] of Object.entries(record)) {
      if (key !== 'data') add(seen, system, kind, `record.${key}`, value);
    }
  }
  return [...seen.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const [, fieldPath] = key.split('|');
      const base = classify(fieldPath, system);
      return {
        system,
        recordKinds: [...value.kinds].sort(),
        fieldPath,
        representativeValues: [...value.values],
        population: value.population,
        ...base,
      };
    });
}

const dndRecords = recordsFrom(JSON.parse(readFileSync(dndPath, 'utf8')));
const rows = [
  ...inventory('dnd5e-srd', dndRecords),
  ...inventory(
    'pathfinder2e-remaster',
    PATHFINDER2E_REMASTER_RULES_PACK.records as unknown as readonly Record<
      string,
      unknown
    >[],
  ),
];
const artifact = {
  bead: 'eshyra-o9bd.18.8.8',
  generatedBy: relative(root, fileURLToPath(import.meta.url)),
  inputs: [
    relative(root, dndPath),
    'packages/core/src/rules/pathfinder2eRemaster.ts',
  ],
  recordCounts: {
    dnd5eSrd: dndRecords.length,
    pathfinderFixture: PATHFINDER2E_REMASTER_RULES_PACK.records.length,
  },
  rowCount: rows.length,
  dispositionCounts: Object.fromEntries(
    [...new Set(rows.map((row) => row.disposition))]
      .sort()
      .map((disposition) => [
        disposition,
        rows.filter((row) => row.disposition === disposition).length,
      ]),
  ),
  rows,
};

function markdown(): string {
  const lines = [
    '# Semi-structured SRD string inventory',
    '',
    `Generated by \`${artifact.generatedBy}\`; inputs contain ${dndRecords.length} D&D records and ${PATHFINDER2E_REMASTER_RULES_PACK.records.length} representative Pathfinder records. Rows group identical nested field paths across records; population is occurrences for scalar strings and records containing an array of strings.`,
    '',
    `Total grouped paths: **${rows.length}**. Dispositions: ${Object.entries(
      artifact.dispositionCounts,
    )
      .map(([k, v]) => `\`${k}\` ${v}`)
      .join(', ')}.`,
    '',
    'The generated JSON is the machine-readable inventory. This table keeps the same evidence compact enough for review.',
    '',
    '| System | Kinds | Field path | Population | Representative values | Class | Disposition | Consumer / schema | Owner / future |',
    '| --- | --- | --- | ---: | --- | --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    const values = row.representativeValues
      .map((value) => value.replaceAll('|', '\\|').replaceAll('\n', ' '))
      .join('; ');
    lines.push(
      `| ${row.system} | ${row.recordKinds.join(', ')} | \`${row.fieldPath}\` | ${row.population} | ${values} | ${row.valueClass} | \`${row.disposition}\` | ${row.typedSchemaOrConsumer ?? row.currentSchemaValidation} | ${row.owner ?? '—'}${row.futureWork ? ' (future work)' : ''} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

const jsonOutput = `${JSON.stringify(artifact, null, 2)}\n`;
const markdownOutput = markdown();
if (process.argv.includes('--check')) {
  const actualJson = readFileSync(outputPath, 'utf8');
  const actualMarkdown = readFileSync(markdownPath, 'utf8');
  if (actualJson !== jsonOutput || actualMarkdown !== markdownOutput) {
    throw new Error(
      'committed semi-structured inventory is stale; regenerate it',
    );
  }
  console.log(`inventory is current (${rows.length} rows)`);
} else {
  writeFileSync(outputPath, jsonOutput);
  writeFileSync(markdownPath, markdownOutput);
  console.log(
    `wrote ${relative(root, outputPath)} and ${relative(root, markdownPath)} (${rows.length} rows)`,
  );
}
