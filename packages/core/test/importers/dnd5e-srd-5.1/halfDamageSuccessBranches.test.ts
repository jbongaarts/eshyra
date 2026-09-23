/**
 * Successful-save half-damage branches, checked against a source-enumerated
 * population (eshyra-o9bd.19.4.3.1; finding-registry rows half-damage-branches
 * and hazard-success-branches; Bag of Beans).
 *
 * The denominator comes from the pinned PDF, not from the pack and not from
 * the importer's success-branch grammar: every sentence mentioning both
 * halving and success must be accounted for in the committed census, which
 * names each sentence's record and container and how the pack represents it.
 * A printed wording the importer fails to recognize therefore stays in the
 * denominator and fails here instead of silently dropping its branch.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  extractPdfText,
  normalizePdfHyphenCluster,
} from '../../../scripts/importers/dnd5e-srd-5.1/extract.js';
import { getBundledDnd5eSrdPack } from '../../../src/internal.js';
import {
  HALF_DAMAGE_SUCCESS_CENSUS,
  type HalfDamageCensusJoin,
} from './halfDamageSuccessCensus.js';

const SOURCE_DIR = join(process.cwd(), 'packages/core/sources/dnd5e-srd-5.1');

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Whitespace-collapsed, hyphen-cluster-normalized source text. */
const clean = (text: string) =>
  normalizePdfHyphenCluster(text).replace(/\s+/g, ' ').trim();
/** Punctuation- and case-insensitive form for containment checks. */
const loose = (text: string) =>
  clean(text)
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[^A-Za-z0-9']+/g, '')
    .toLowerCase();

// The census net: broader than the importer's grammar on purpose.
const HALVES = /\bhal(?:f|ves|ved)\b/i;
const SUCCEEDS = /\bsucce(?:ss|ssful|ssfully|ed|eds)\b/i;

let sourceSentences: readonly { page: number; source: string }[] = [];

beforeAll(async () => {
  const manifest = JSON.parse(
    readFileSync(join(SOURCE_DIR, 'manifest.json'), 'utf8'),
  ) as { artifact: { filename: string; sha256: string } };
  const pdf = readFileSync(join(SOURCE_DIR, manifest.artifact.filename));
  // The census was taken from this exact artifact.
  expect(createHash('sha256').update(pdf).digest('hex')).toBe(
    manifest.artifact.sha256,
  );
  const pages = await extractPdfText(new Uint8Array(pdf));
  sourceSentences = pages.flatMap((page) =>
    clean(page.lines.join(' '))
      .split(/(?<=[.!?])\s+(?=[A-Z“"(])/)
      .filter((sentence) => HALVES.test(sentence) && SUCCEEDS.test(sentence))
      .map((source) => ({ page: page.pageNumber, source })),
  );
});

const pack = getBundledDnd5eSrdPack();
const records = new Map(pack.records.map((record) => [record.key, record]));

function containerAt(recordKey: string, pointer: string): Obj {
  const record = records.get(recordKey);
  if (record === undefined) throw new Error(`no record ${recordKey}`);
  let value: unknown = { data: record.data };
  for (const segment of pointer.split('/').slice(1))
    value = Array.isArray(value)
      ? value[Number(segment)]
      : isObj(value)
        ? value[segment]
        : undefined;
  if (!isObj(value)) throw new Error(`no container ${recordKey}${pointer}`);
  return value;
}

const prose = (container: Obj) =>
  ['text', 'description', 'higherLevels']
    .map((key) => container[key])
    .filter((value): value is string => typeof value === 'string')
    .join(' ');

const savesOf = (container: Obj): readonly Obj[] => {
  const mechanics = container.mechanics;
  return isObj(mechanics) && Array.isArray(mechanics.saves)
    ? (mechanics.saves as Obj[])
    : [];
};

const joins: readonly HalfDamageCensusJoin[] =
  HALF_DAMAGE_SUCCESS_CENSUS.flatMap((entry) => entry.joins);

describe('successful-save half-damage branches over the source census', () => {
  it('accounts for exactly the halving-and-success sentences the pinned PDF prints', () => {
    const key = (item: { page: number; source: string }) =>
      `${item.page}\u0000${item.source}`;
    expect(sourceSentences.map(key).sort()).toEqual(
      HALF_DAMAGE_SUCCESS_CENSUS.map(key).sort(),
    );
  });

  it('joins every census sentence to the record prose that carries it', () => {
    const unjoined: string[] = [];
    for (const entry of HALF_DAMAGE_SUCCESS_CENSUS) {
      if (entry.joins.length === 0) unjoined.push(entry.source);
      for (const item of entry.joins) {
        const container = containerAt(item.recordKey, item.pointer);
        // The anchor is a verbatim tail of the source sentence...
        expect(loose(entry.source)).toContain(loose(item.anchor));
        // ...found in the joined container's own prose.
        if (!loose(prose(container)).includes(loose(item.anchor)))
          unjoined.push(`${item.recordKey}${item.pointer}`);
      }
    }
    expect(unjoined).toEqual([]);
  });

  it('represents every member branch as the census records it', () => {
    const wrong: string[] = [];
    for (const item of joins) {
      const at = `${item.recordKey}${item.pointer}`;
      const container = containerAt(item.recordKey, item.pointer);
      const saves = savesOf(container);
      switch (item.representation) {
        case 'typed-save':
          // Single-save containers only (multi-save entries are a separate
          // finding); the one save carries the source's success branch.
          if (saves.length !== 1 || saves[0].damageOnSuccess !== 'half')
            wrong.push(`${at}: ${JSON.stringify(saves)}`);
          break;
        case 'magic-item-effect': {
          const mechanics = containerAt(item.recordKey, '/data').mechanics;
          const effects =
            isObj(mechanics) && Array.isArray(mechanics.effects)
              ? (mechanics.effects as Obj[])
              : [];
          const effect = effects.find((entry) => entry.id === item.effectId);
          if (effect?.successfulSaveDamage !== 'half')
            wrong.push(
              `${at} ${item.effectId}: ${effect?.successfulSaveDamage}`,
            );
          break;
        }
        case 'untyped':
          // A member with no typed save: nothing can omit the branch. Gaining
          // a typed save moves it to `typed-save` by review, not silently.
          if (saves.length > 0) wrong.push(`${at}: gained a typed save`);
          break;
        case 'not-a-member':
          if (saves.some((save) => save.damageOnSuccess !== undefined))
            wrong.push(`${at}: carries a branch its source does not print`);
          break;
      }
    }
    expect(wrong).toEqual([]);
  });

  it('carries a typed half branch only where a census member prints one', () => {
    const members = new Set(
      joins
        .filter((item) => item.representation === 'typed-save')
        .map((item) => `${item.recordKey}${item.pointer}`),
    );
    const invented: string[] = [];
    const visit = (value: unknown, key: string, pointer: string) => {
      if (Array.isArray(value)) {
        value.forEach((item, i) => {
          visit(item, key, `${pointer}/${i}`);
        });
        return;
      }
      if (!isObj(value)) return;
      if (
        savesOf(value).some((save) => save.damageOnSuccess === 'half') &&
        !members.has(`${key}${pointer}`)
      )
        invented.push(`${key}${pointer}`);
      for (const [child, item] of Object.entries(value))
        if (child !== 'mechanics') visit(item, key, `${pointer}/${child}`);
    };
    for (const record of pack.records) visit(record.data, record.key, '/data');
    expect(invented).toEqual([]);
  });
});
