import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EQUIPMENT_MECHANICS_SPECS } from './importers/dnd5e-srd-5.1/equipmentMechanics.js';
import { EQUIPMENT_MECHANICS_REVIEW } from './importers/dnd5e-srd-5.1/equipmentMechanicsReview.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const RECORDS = resolve(
  ROOT,
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
);
const JSON_OUT = resolve(
  ROOT,
  'docs/audits/dnd5e-srd-5.1-final/o9bd-18-7-6-equipment-mechanics-inventory.json',
);
const MD_OUT = resolve(
  ROOT,
  'docs/audits/dnd5e-srd-5.1-final/o9bd-18-7-6-equipment-mechanics-inventory.md',
);

interface RecordRow {
  readonly kind: string;
  readonly key: string;
  readonly name: string;
  readonly source: string;
  readonly data: Record<string, unknown>;
}
const records = JSON.parse(readFileSync(RECORDS, 'utf8')) as RecordRow[];
const equipment = records.filter((record) => record.kind === 'equipment');
if (equipment.length !== 218)
  throw new Error(
    `equipment membership drift: expected 218, got ${equipment.length}`,
  );
const specs = new Map(
  EQUIPMENT_MECHANICS_SPECS.map((spec) => [spec.recordKey, spec]),
);
for (const key of specs.keys())
  if (!equipment.some((record) => record.key === key))
    throw new Error(`reviewed equipment record disappeared: ${key}`);
const actualKeys = new Set(equipment.map((record) => record.key));
for (const key of EQUIPMENT_MECHANICS_REVIEW.keys())
  if (!actualKeys.has(key))
    throw new Error(`reviewed equipment record disappeared: ${key}`);
for (const key of actualKeys)
  if (!EQUIPMENT_MECHANICS_REVIEW.has(key))
    throw new Error(`equipment record lacks reviewed disposition: ${key}`);
for (const key of specs.keys())
  if (
    EQUIPMENT_MECHANICS_REVIEW.get(key)?.disposition !==
    'requires projection in this bead'
  )
    throw new Error(
      `${key}: curated spec has no matching reviewed disposition`,
    );
const rows = equipment.map((record) => {
  const spec = specs.get(record.key);
  const review = EQUIPMENT_MECHANICS_REVIEW.get(record.key);
  if (review === undefined)
    throw new Error(`${record.key}: unreviewed equipment`);
  const hasDescription = typeof record.data.description === 'string';
  const tableDerivedFacts = Object.fromEntries(
    Object.entries(record.data).filter(([key]) => key !== 'description'),
  );
  return {
    recordKey: record.key,
    name: record.name,
    category: record.data.category,
    grouping: {
      equipmentGroup: record.data.equipmentGroup ?? null,
      weaponCategory: record.data.weaponCategory ?? null,
      weaponRange: record.data.weaponRange ?? null,
    },
    source: record.source,
    tableDerivedFacts,
    sourceDescriptionClauses: hasDescription ? [record.data.description] : [],
    mechanicallySignificantClauseIds:
      spec?.clauses.map((clause) => clause.id) ?? [],
    currentTypedRepresentation: Object.keys(tableDerivedFacts),
    requiredDeterministicRepresentation:
      review.requiredDeterministicRepresentation,
    disposition: review.disposition,
    rationale: review.rationale,
    engineToolOwners:
      spec === undefined
        ? review.owners
        : [
            ...new Set([
              ...review.owners,
              ...spec.clauses.map((clause) => clause.owner),
            ]),
          ],
    sourceBindings:
      spec === undefined
        ? []
        : [
            ...spec.clauses.map((clause) => ({
              clauseId: clause.id,
              phrase: clause.sourcePhrase,
              pages: spec.pages,
            })),
            ...(spec.consumptionSourcePhrase === undefined
              ? []
              : [
                  {
                    clauseId: 'consumption',
                    phrase: spec.consumptionSourcePhrase,
                    pages: spec.pages,
                  },
                ]),
            ...(spec.modelAdjudicatedQualifiers ?? []).map((phrase) => ({
              clauseId: 'model-qualifier',
              phrase,
              pages: spec.pages,
            })),
          ],
  };
});
const dispositionCounts = Object.fromEntries(
  [...new Set(rows.map((row) => row.disposition))]
    .sort()
    .map((disposition) => [
      disposition,
      rows.filter((row) => row.disposition === disposition).length,
    ]),
);
const artifact = {
  bead: 'eshyra-o9bd.18.7.6',
  generatedBy: 'packages/core/scripts/inventory-equipment-mechanics.ts',
  recordCount: rows.length,
  recordsWithDescriptions: rows.filter(
    (row) => row.sourceDescriptionClauses.length > 0,
  ).length,
  mechanicallyActiveRecords: rows.filter(
    (row) => row.disposition !== 'not mechanical',
  ).length,
  curatedProjectionRecords: specs.size,
  clauseCount: EQUIPMENT_MECHANICS_SPECS.reduce(
    (sum, spec) => sum + spec.clauses.length,
    0,
  ),
  dispositionCounts,
  records: rows,
};
const json = `${JSON.stringify(artifact, null, 2)}\n`;
const md = [
  '# SRD equipment mechanics inventory',
  '',
  `Generated by \`${artifact.generatedBy}\`. Do not hand-edit.`,
  '',
  `Records: **${artifact.recordCount}**; descriptions: **${artifact.recordsWithDescriptions}**; mechanically active: **${artifact.mechanicallyActiveRecords}**; curated projections: **${artifact.curatedProjectionRecords}**; clauses: **${artifact.clauseCount}**.`,
  '',
  '| record | category | source | disposition | clauses |',
  '| --- | --- | --- | --- | --- |',
  ...rows.map(
    (row) =>
      `| \`${row.recordKey}\` | ${row.category} | ${row.source} | ${row.disposition} | ${row.mechanicallySignificantClauseIds.join(', ') || '—'} |`,
  ),
  '',
].join('\n');
if (process.argv.includes('--check')) {
  if (
    JSON.stringify(JSON.parse(readFileSync(JSON_OUT, 'utf8'))) !==
      JSON.stringify(artifact) ||
    readFileSync(MD_OUT, 'utf8') !== md
  )
    throw new Error(
      'committed equipment mechanics inventory is stale; regenerate it',
    );
} else {
  writeFileSync(JSON_OUT, json);
  writeFileSync(MD_OUT, md);
}
