import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildInventoryArtifact,
  type InventoryRow,
  renderInventoryJson,
  renderInventoryMarkdown,
} from '../scripts/inventory-semi-structured-boundary.js';

const INVENTORY_DIR = join(process.cwd(), 'docs/inventories');
const committedJson = readFileSync(
  join(INVENTORY_DIR, 'o9bd-18-8-8-semi-structured-boundary.json'),
  'utf8',
);
const committedMarkdown = readFileSync(
  join(INVENTORY_DIR, 'o9bd-18-8-8-semi-structured-boundary.md'),
  'utf8',
);

function row(
  artifact: ReturnType<typeof buildInventoryArtifact>,
  fieldPath: string,
  recordKind: string,
  system = 'dnd5e-srd',
): InventoryRow {
  const found = artifact.rows.find(
    (candidate) =>
      candidate.system === system &&
      candidate.fieldPath === fieldPath &&
      candidate.recordKinds.includes(recordKind),
  );
  if (found === undefined) {
    throw new Error(
      `missing inventory row ${system}/${recordKind}/${fieldPath}`,
    );
  }
  return found;
}

describe('semi-structured boundary inventory', () => {
  it('recomputes both committed artifacts through the exported generator', () => {
    const artifact = buildInventoryArtifact();
    expect(committedJson).toBe(renderInventoryJson(artifact));
    expect(committedMarkdown).toBe(renderInventoryMarkdown(artifact));
    expect(artifact.recordCounts).toEqual({
      dnd5eSrd: 1813,
      pathfinderFixture: 7,
    });
  });

  it('classifies identity, provenance, prose, and real local references semantically', () => {
    const artifact = buildInventoryArtifact();
    expect(row(artifact, 'record.key', 'spell')).toMatchObject({
      disposition: 'complete',
      typedSchemaOrConsumer: expect.stringContaining(
        'RulesStackKindIndex.byKey',
      ),
      owner: expect.stringContaining('rules lookup'),
    });
    expect(row(artifact, 'record.kind', 'spell')).toMatchObject({
      disposition: 'complete',
      typedSchemaOrConsumer: expect.stringContaining('RulesRecordKind'),
    });
    expect(row(artifact, 'record.provenance.sourceRef', 'spell')).toMatchObject(
      {
        disposition: 'complete',
        typedSchemaOrConsumer: expect.stringContaining(
          'RecordProvenance.sourceRef',
        ),
        owner: expect.stringContaining('assertProvenanceMatchesPackSource'),
      },
    );
    expect(row(artifact, 'data.choices[].id', 'ancestry')).toMatchObject({
      disposition: 'complete',
      owner: expect.stringContaining('srdCreationChoices'),
    });
    expect(row(artifact, 'data.text', 'rule')).toMatchObject({
      disposition: 'model-adjudicated',
      valueClass: 'compound mechanical text',
    });
    expect(row(artifact, 'data.actions[].text', 'creature')).toMatchObject({
      disposition: 'model-adjudicated',
    });
    expect(
      row(artifact, 'data.abilityScoreIncreases[].choice.from[]', 'ancestry'),
    ).toMatchObject({
      disposition: 'complete',
      deterministicConsumers: expect.stringContaining('srdCreationChoices'),
    });
    for (const [fieldPath, kind] of [
      ['data.primaryAbilities[]', 'class'],
      ['data.skillChoices[].from[]', 'class'],
      ['data.spellPreparation.kind', 'class'],
      ['data.spellPreparation.preparationFormula.ability', 'class'],
      ['data.languages[].fixed[]', 'ancestry'],
      ['data.languages[].from[]', 'background'],
    ] as const) {
      expect(
        row(artifact, fieldPath, kind),
        `${kind}/${fieldPath}`,
      ).toMatchObject({
        disposition: 'complete',
        owner: expect.stringContaining('rulesPackResolver'),
      });
    }
    expect(
      row(artifact, 'data.progression[].advancement[].ref', 'class'),
    ).toMatchObject({
      disposition: 'complete',
      deterministicConsumers: expect.stringContaining('parseClassProgression'),
    });
    expect(row(artifact, 'data.contents[].ref', 'equipment')).toMatchObject({
      disposition: 'complete',
      typedSchemaOrConsumer: expect.stringContaining(
        'EquipmentPackContents.ref',
      ),
    });
  });

  it('preserves the exact unsupported residual set and structural invariants', () => {
    const artifact = buildInventoryArtifact();
    const unsupported = artifact.rows
      .filter((candidate) => candidate.disposition === 'unsupported')
      .map(
        (candidate) =>
          `${candidate.recordKinds.join(',')}.${candidate.fieldPath}`,
      )
      .sort();
    expect(unsupported).toEqual([
      'creature.data.savingThrows',
      'creature.data.senses',
      'creature.data.skills',
      'equipment.data.properties[]',
      'magic-item.data.attunementRequirement',
      'stat-block.data.senses',
    ]);
    for (const candidate of artifact.rows) {
      if (candidate.disposition === 'complete') {
        expect(
          candidate.typedSchemaOrConsumer,
          candidate.fieldPath,
        ).toBeTruthy();
        expect(candidate.owner, candidate.fieldPath).toBeTruthy();
      }
      if (candidate.disposition === 'typed-core-with-prose-qualifier') {
        expect(
          candidate.typedSchemaOrConsumer,
          candidate.fieldPath,
        ).toBeTruthy();
        expect(candidate.currentAuditReadiness, candidate.fieldPath).toMatch(
          /qualifier|prose|retained/i,
        );
        expect(
          candidate.retainedProseBoundary,
          candidate.fieldPath,
        ).toBeTruthy();
        expect(candidate.owner, candidate.fieldPath).toBeTruthy();
      }
      if (candidate.disposition === 'unsupported') {
        expect(candidate.owner, candidate.fieldPath).toBeTruthy();
        expect(candidate.futureWork, candidate.fieldPath).toBe(true);
      }
      if (candidate.disposition === 'not-mechanical') {
        expect(
          candidate.deterministicConsumers,
          candidate.fieldPath,
        ).not.toMatch(/mechanic|execution|lookupRulesRecord/i);
      }
      if (candidate.disposition === 'model-adjudicated') {
        expect(
          candidate.deterministicConsumers,
          candidate.fieldPath,
        ).not.toMatch(/deterministic execution/i);
      }
      expect(candidate.typedSchemaOrConsumer ?? '').not.toMatch(
        /raw|parsed|tokens|Record<string, unknown>/i,
      );
      expect(candidate.fieldPath).not.toMatch(/raw|parsed|tokens/i);
    }
  });
});
