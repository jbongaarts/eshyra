import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type DiagnosticFixture,
  type DiagnosticTarget,
  validateDiagnosticCorpus,
} from './fixtureContract.js';
import { HELD_OUT_FIXTURES } from './held-out/index.js';
import { HELD_OUT_MANIFEST } from './held-out/manifest.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataRoot = join(here, '..', '..', 'data');
const PACK = join(dataRoot, 'rules-packs', 'rules__dnd5e-srd-5.1');

interface PackRecord {
  readonly key: string;
  readonly data: unknown;
  readonly provenance: { readonly locator: string };
}

const records = JSON.parse(
  readFileSync(join(PACK, 'records.json'), 'utf8'),
) as PackRecord[];
const byKey = new Map(records.map((record) => [record.key, record]));

function resolvePointer(root: unknown, pointer: string): unknown {
  let current = root;
  for (const raw of pointer.split('/').slice(1)) {
    const part = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function loadModule(moduleId: string): Record<string, unknown> {
  const dir = readdirSync(join(dataRoot, 'adventure-modules')).find((name) => {
    const file = join(
      dataRoot,
      'adventure-modules',
      name,
      'adventure-module.json',
    );
    try {
      return JSON.parse(readFileSync(file, 'utf8')).id === moduleId;
    } catch {
      return false;
    }
  });
  if (dir === undefined) throw new Error(`no adventure module ${moduleId}`);
  return JSON.parse(
    readFileSync(
      join(dataRoot, 'adventure-modules', dir, 'adventure-module.json'),
      'utf8',
    ),
  );
}

function allTargets(fixture: DiagnosticFixture): DiagnosticTarget[] {
  return [
    ...fixture.mustIncludeTargets,
    ...fixture.mayIncludeTargets,
    ...fixture.mustNotIncludeTargets,
  ];
}

describe('held-out diagnostic fixtures (eshyra-o9bd.19.15.1)', () => {
  it('conform to the fixture contract, one per probe class', () => {
    const validated = validateDiagnosticCorpus(HELD_OUT_FIXTURES);
    expect(validated.map((fixture) => fixture.probeId).sort()).toEqual(
      Array.from({ length: 12 }, (_, index) => `P${index + 1}`).sort(),
    );
  });

  it('are recorded in the manifest as authored, held out and never run', () => {
    expect(HELD_OUT_MANIFEST.map((entry) => entry.probeId)).toEqual(
      HELD_OUT_FIXTURES.map((fixture) => fixture.probeId),
    );
    for (const entry of HELD_OUT_MANIFEST) {
      expect(entry.authoredAtCommit).toMatch(/^[0-9a-f]{40}$/);
      expect(Number.isNaN(Date.parse(entry.authoredAt))).toBe(false);
      expect(entry.runAgainstPipelineAtAuthoring).toBe(false);
      expect(entry.status).toBe('held-out');
      const fixture = HELD_OUT_FIXTURES.find(
        (f) => f.probeId === entry.probeId,
      );
      expect(fixture?.verifiedAtCommit).toBe(entry.authoredAtCommit);
    }
  });

  it('never import the discovery pipeline', () => {
    const heldOutDir = join(here, 'held-out');
    for (const name of readdirSync(heldOutDir)) {
      const text = readFileSync(join(heldOutDir, name), 'utf8');
      expect(text, name).not.toMatch(/from\s+['"][^'"]*discovery[^'"]*['"]/);
    }
  });

  for (const fixture of HELD_OUT_FIXTURES) {
    describe(`${fixture.probeId} ${fixture.title}`, () => {
      it('references only pack records and module entities that exist', () => {
        for (const target of allTargets(fixture)) {
          if (target.targetKind === 'absent-rules-record') {
            expect(byKey.has(target.recordKey), target.recordKey).toBe(false);
          } else if (target.targetKind === 'rules-record') {
            const record = byKey.get(target.recordKey);
            expect(record, target.recordKey).toBeDefined();
            expect(record?.provenance.locator, target.recordKey).toBe(
              target.locator,
            );
            if (target.selector?.kind === 'json-pointer')
              expect(
                resolvePointer(record, target.selector.pointer),
                `${target.recordKey} ${target.selector.pointer}`,
              ).toBeDefined();
            if (target.selector?.kind === 'ambiguity-id')
              expect(
                JSON.stringify(record?.data),
                target.selector.id,
              ).toContain(target.selector.id);
            if (target.selector?.kind === 'stable-id')
              expect(
                JSON.stringify(record?.data),
                target.selector.id,
              ).toContain(`"id":"${target.selector.id}"`);
          } else {
            const mod = loadModule(target.moduleId) as Record<string, unknown>;
            const list = (
              target.entityKind === 'encounter' ? mod.encounters : mod.locations
            ) as { id: string }[];
            expect(
              list.some((item) => item.id === target.entityId),
              `${target.moduleId} ${target.entityId}`,
            ).toBe(true);
          }
        }
      });

      it('has retained facts that are present in the pack as stated', () => {
        if (!Array.isArray(fixture.requiredRetainedFacts)) return;
        for (const fact of fixture.requiredRetainedFacts) {
          const record = byKey.get(fact.targetRef ?? '');
          expect(record, fact.statement).toBeDefined();
          if (fact.exactSubstring !== undefined)
            expect(JSON.stringify(record), fact.statement).toContain(
              JSON.stringify(fact.exactSubstring).slice(1, -1),
            );
          if (fact.typedPath !== undefined) {
            const value = resolvePointer(record, fact.typedPath);
            expect(value, fact.statement).toBeDefined();
            if ('expectedValue' in fact)
              expect(value, fact.statement).toEqual(fact.expectedValue);
          }
        }
      });

      it('has relationship expectations whose records and link fields exist', () => {
        if (!Array.isArray(fixture.requiredRelationshipExpansion)) return;
        for (const relation of fixture.requiredRelationshipExpansion) {
          expect(byKey.has(relation.targetRecordKey), relation.statement).toBe(
            true,
          );
          if (relation.sourceRecordKey.includes('#')) {
            const [moduleId, entity] = relation.sourceRecordKey.split('#');
            const entityId = entity?.split(':')[1];
            const mod = loadModule(moduleId ?? '');
            const encounters = mod.encounters as {
              id: string;
              creatures: { rulesRef: string }[];
            }[];
            const found = encounters.find((e) => e.id === entityId);
            expect(found, relation.statement).toBeDefined();
            expect(
              found?.creatures.some(
                (creature) => creature.rulesRef === relation.targetRecordKey,
              ),
              relation.statement,
            ).toBe(true);
          } else {
            expect(
              byKey.has(relation.sourceRecordKey),
              relation.statement,
            ).toBe(true);
          }
        }
      });
    });
  }
});
