// eshyra-o9bd.16.8.1 (audit L3-F1): "no hook declared" is not evidence that
// an engine owner executes a passive magic-item effect. A hook-free `effects`
// clause is green only when its kind is in the reviewed runtime-consumer
// registry. These tests pin the classifier rule generally, the two printed
// trigger shapes that exposed it, and a positive control.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRD_5_1_LICENSE } from '../../../scripts/importers/dnd5e-srd-5.1/emit.js';
import {
  type ItemClauseExpectation,
  MAGIC_ITEM_PASSIVE_EFFECT_RUNTIME_CONSUMERS,
  validateMagicItemClausesAndClassify,
} from '../../../scripts/importers/dnd5e-srd-5.1/magicItemCompiler.js';
import type { RulesRecord } from '../../../src/rules/types.js';

function itemRecord(data: Record<string, unknown>): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'magic-item',
    key: 'magic-item:test-item',
    name: 'Test Item',
    data,
    source: 'SRD 5.1 p. 1',
    license: SRD_5_1_LICENSE,
    provenance: { sourceRef: 'test', locator: 'p. 1' },
  };
}

const effectClause = (effectId: string): ItemClauseExpectation => ({
  id: `test-item/${effectId}`,
  tag: 'M2',
  representation: { block: 'effects', effectId },
});

describe('hook-free passive effect readiness (L3-F1)', () => {
  const record = itemRecord({
    mechanics: {
      effects: [
        { id: 'regen', kind: 'regeneration', hitDice: '1d6' },
        { id: 'speed', kind: 'speedSet', mode: 'fly', value: 60 },
      ],
    },
  });
  const classify = (
    consumers?: ReadonlyMap<string, string>,
  ): Map<string, string> =>
    new Map(
      validateMagicItemClausesAndClassify({
        records: [record],
        clausesByItemKey: new Map([
          [record.key, [effectClause('regen'), effectClause('speed')]],
        ]),
        ...(consumers === undefined
          ? {}
          : { passiveEffectConsumers: consumers }),
      }).map((entry) => [entry.clauseId ?? '', entry.readiness]),
    );

  it('never marks a hook-free effect green unless its kind has a reviewed consumer', () => {
    expect(classify()).toEqual(
      new Map([
        ['test-item/regen', 'engine-pending'],
        ['test-item/speed', 'engine-pending'],
      ]),
    );
    // The shipped registry is empty: no derived-stat code reads worn items.
    expect(MAGIC_ITEM_PASSIVE_EFFECT_RUNTIME_CONSUMERS.size).toBe(0);
  });

  it('names the missing owner on the pending clause (declared, missing, family agree)', () => {
    const [entry] = validateMagicItemClausesAndClassify({
      records: [record],
      clausesByItemKey: new Map([[record.key, [effectClause('regen')]]]),
    });
    expect(entry?.engineHooks).toEqual([
      {
        engine: 'F6',
        hook: 'passive item effect runtime consumer: regeneration',
      },
    ]);
    expect(entry?.missingHooks).toEqual(entry?.engineHooks);
    expect(entry?.missingEngines).toEqual(['F6']);
  });

  it('positive control: a kind with a registered consumer stays green; others do not', () => {
    expect(classify(new Map([['speedSet', 'test consumer']]))).toEqual(
      new Map([
        ['test-item/regen', 'engine-pending'],
        ['test-item/speed', 'green'],
      ]),
    );
  });

  it('does not turn non-effect structural clauses red', () => {
    const structural = itemRecord({
      attunement: 'required',
    });
    const readiness = validateMagicItemClausesAndClassify({
      records: [structural],
      clausesByItemKey: new Map([
        [
          structural.key,
          [
            {
              id: 'test-item/field',
              tag: 'DB',
              representation: { block: 'structuredField', field: 'attunement' },
            } as unknown as ItemClauseExpectation,
          ],
        ],
      ]),
    });
    for (const entry of readiness)
      expect(entry.readiness).not.toBe('engine-pending');
  });
});

describe('shipped pack: no hook-free passive effect is green', () => {
  const records = JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        'packages/core/data/rules-packs/rules__dnd5e-srd-5.1/records.json',
      ),
      'utf8',
    ),
  ) as { records: RulesRecord[] } | RulesRecord[];
  const items = (Array.isArray(records) ? records : records.records).filter(
    (r) => r.kind === 'magic-item',
  );
  type Clause = {
    clauseId: string;
    readiness: string;
    engineHooks?: unknown[];
    missingHooks?: unknown[];
    representation: { block: string };
  };
  const descriptionOf = (item: RulesRecord | undefined): string =>
    String((item?.data as { description?: string } | undefined)?.description);
  const clausesOf = (key: string): Clause[] => {
    const data = items.find((r) => r.key === key)?.data as
      | { executionReadiness?: { clauses: Clause[] } }
      | undefined;
    return data?.executionReadiness?.clauses ?? [];
  };

  it('every green effects clause declares an engine hook (registry is empty)', () => {
    let green = 0;
    for (const item of items) {
      const { clauses } = (
        item.data as { executionReadiness: { clauses: Clause[] } }
      ).executionReadiness;
      for (const clause of clauses) {
        if (clause.representation?.block !== 'effects') continue;
        if (clause.readiness === 'green') {
          green += 1;
          expect(clause.engineHooks?.length, clause.clauseId).toBeGreaterThan(
            0,
          );
        }
      }
    }
    expect(green).toBe(2);
  });

  it('Ring of Regeneration (SRD p.237): the printed clock heal is engine-pending', () => {
    const item = items.find((r) => r.key === 'magic-item:ring-of-regeneration');
    expect(descriptionOf(item)).toContain(
      'you regain 1d6 hit points every 10 minutes',
    );
    expect(item?.source).toContain('237');
    const clause = clausesOf('magic-item:ring-of-regeneration').find(
      (c) =>
        c.clauseId ===
        'magic-item:ring-of-regeneration/m2-ring-of-regeneration-regeneration',
    );
    expect(clause?.readiness).toBe('engine-pending');
    expect(clause?.missingHooks).toEqual([
      {
        engine: 'F6',
        hook: 'passive item effect runtime consumer: regeneration',
      },
    ]);
  });

  it('Periapt of Wound Closure (SRD p.232): stabilize and healingMultiplier are engine-pending', () => {
    const item = items.find(
      (r) => r.key === 'magic-item:periapt-of-wound-closure',
    );
    expect(descriptionOf(item)).toContain(
      'you stabilize whenever you are dying at the start of your turn',
    );
    expect(item?.source).toContain('232');
    const byId = new Map(
      clausesOf('magic-item:periapt-of-wound-closure').map((c) => [
        c.clauseId,
        c,
      ]),
    );
    for (const id of ['stabilize', 'healing-multiplier']) {
      const clause = byId.get(
        `magic-item:periapt-of-wound-closure/m2-periapt-of-wound-closure-${id}`,
      );
      expect(clause?.readiness, id).toBe('engine-pending');
    }
  });

  it('positive control: hooked effect clauses keep their landed-hook classification', () => {
    const gem = clausesOf('magic-item:elemental-gem').find(
      (c) =>
        c.clauseId === 'magic-item:elemental-gem/m1-effect-summon-elemental',
    );
    expect(gem?.readiness).toBe('green');
  });
});
