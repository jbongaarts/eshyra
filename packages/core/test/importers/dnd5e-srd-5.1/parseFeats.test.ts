/**
 * Feat-parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * Feat text excerpts in this file are reproduced from the System Reference
 * Document 5.1 by Wizards of the Coast LLC, available under the Creative
 * Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts are
 * used as parser test input; no modification has been made beyond reformatting
 * to match the importer's extracted-line input shape.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractPdfText } from '../../../scripts/importers/dnd5e-srd-5.1/extract.js';
import { parseFeats } from '../../../scripts/importers/dnd5e-srd-5.1/parseFeats.js';
import {
  SRD_5_1_DEFAULT_SECTION_ANCHORS,
  sliceSection,
} from '../../../scripts/importers/dnd5e-srd-5.1/sections.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

// ---------------------------------------------------------------------------
// SRD 5.1 canonical feat: Grappler (the only feat in SRD 5.1).
// ---------------------------------------------------------------------------

const GRAPPLER_PAGE = page(72, [
  'Grappler',
  'Prerequisite: Strength 13 or higher',
  "You've developed the skills necessary to hold your own in close-quarters",
  'grappling. You gain the following benefits:',
  '• You have advantage on attack rolls against a creature you are grappling.',
  '• You can use your action to try to pin a creature grappled by you. To do',
  '  so, make another grappling check. If you succeed, you and the creature are',
  '  both restrained until the grapple ends.',
]);

describe('parseFeats — Grappler (canonical SRD 5.1 feat)', () => {
  const [grappler] = parseFeats([GRAPPLER_PAGE]);

  it('extracts the feat name', () => {
    expect(grappler.name).toBe('Grappler');
  });

  it('extracts the prerequisite', () => {
    expect(grappler.prerequisites).toBe('Strength 13 or higher');
  });

  it('records the source page', () => {
    expect(grappler.sourcePage).toBe(72);
  });

  it('re-flows wrapped benefit lines into prose', () => {
    expect(grappler.description).toMatch(/close-quarters grappling/);
  });

  it('includes bullet-point benefits in description', () => {
    expect(grappler.description).toMatch(/advantage on attack rolls/);
    expect(grappler.description).toMatch(/pin a creature/);
  });

  it('does not include the Prerequisite line in description', () => {
    expect(grappler.description).not.toMatch(/Prerequisite/);
  });
});

// ---------------------------------------------------------------------------
// Feat without prerequisites.
// ---------------------------------------------------------------------------

const NO_PREREQ_PAGE = page(10, [
  'Alert',
  'Always on the lookout for danger, you gain the following benefits:',
  '• +5 bonus to initiative.',
  "• You can't be surprised while you are conscious.",
]);

describe('parseFeats — feat without prerequisites', () => {
  const [alert] = parseFeats([NO_PREREQ_PAGE]);

  it('extracts the feat name', () => {
    expect(alert.name).toBe('Alert');
  });

  it('leaves prerequisites undefined when absent', () => {
    expect(alert.prerequisites).toBeUndefined();
  });

  it('captures benefit text', () => {
    expect(alert.description).toMatch(/initiative/);
  });

  it('does not include feat name in description', () => {
    expect(alert.description).not.toBe('Alert');
    expect(alert.description).not.toMatch(/^Alert\s/);
  });
});

// ---------------------------------------------------------------------------
// Multiple feats: output must be sorted by name.
// ---------------------------------------------------------------------------

describe('parseFeats — multiple feats, sorted output', () => {
  const multiPage = page(72, [
    'Sharpshooter',
    'You have mastered ranged weapons.',
    '',
    'Alert',
    'Always on the lookout for danger, you gain the following benefits:',
    '• +5 bonus to initiative.',
    '',
    'Grappler',
    'Prerequisite: Strength 13 or higher',
    'You gain the following benefits when grappling.',
  ]);

  const results = parseFeats([multiPage]);

  it('extracts all three feats', () => {
    expect(results).toHaveLength(3);
  });

  it('returns feats sorted by name', () => {
    const names = results.map((f) => f.name);
    expect(names).toEqual([...names].sort());
  });

  it('does not bleed one feat body into another', () => {
    const alert = results.find((f) => f.name === 'Alert');
    const grappler = results.find((f) => f.name === 'Grappler');
    expect(alert?.description).not.toMatch(/grappling/);
    expect(grappler?.description).toMatch(/grappling/);
  });
});

// ---------------------------------------------------------------------------
// Prerequisite variants: "Prerequisites:" (plural).
// ---------------------------------------------------------------------------

describe('parseFeats — "Prerequisites:" plural variant', () => {
  const p = page(5, [
    'War Caster',
    'Prerequisites: The ability to cast at least one spell',
    'You have practiced casting spells in the midst of combat.',
  ]);

  const [warCaster] = parseFeats([p]);

  it('captures the plural prerequisites label', () => {
    expect(warCaster.prerequisites).toBe(
      'The ability to cast at least one spell',
    );
  });

  it('does not include the Prerequisites line in description', () => {
    expect(warCaster.description).not.toMatch(/Prerequisites/);
  });
});

// ---------------------------------------------------------------------------
// Feats spanning multiple pages.
// ---------------------------------------------------------------------------

describe('parseFeats — feats spanning multiple pages', () => {
  it('picks up feats from each page independently', () => {
    const p1 = page(72, [
      'Grappler',
      'Prerequisite: Strength 13 or higher',
      'You gain the following benefits.',
    ]);
    const p2 = page(73, ['Alert', 'Always on the lookout for danger.']);
    const results = parseFeats([p1, p2]);
    expect(results).toHaveLength(2);
    const grappler = results.find((f) => f.name === 'Grappler');
    expect(grappler?.sourcePage).toBe(72);
    const alert = results.find((f) => f.name === 'Alert');
    expect(alert?.sourcePage).toBe(73);
  });
});

// ---------------------------------------------------------------------------
// Empty input: should return an empty array without throwing.
// ---------------------------------------------------------------------------

describe('parseFeats — empty input', () => {
  it('returns an empty array for an empty page list', () => {
    expect(parseFeats([])).toEqual([]);
  });

  it('returns an empty array when no feats are found', () => {
    const p = page(1, ['This is not a feat.', 'Some other text here.']);
    expect(parseFeats([p])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Real SRD 5.1 PDF coverage (loreweaver-0m9.5.21).
//
// The vendored SRD 5.1 Feats section (PDF page 75) has no blank lines: a
// 17-line intro paragraph flows directly into the lone "Grappler" name line.
// A pure blank-line boundary heuristic both promotes the intro's first wrapped
// line as a bogus feat AND never reaches "Grappler". This test pins the parser
// to exactly { Grappler } on the real PDF so that regression can't return.
// ---------------------------------------------------------------------------

describe('parseFeats — real SRD 5.1 PDF coverage (loreweaver-0m9.5.21)', () => {
  const SRD_PDF_PATH = join(
    process.cwd(),
    'packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf',
  );

  it('parses exactly the Grappler feat from the vendored SRD 5.1 PDF', async () => {
    // Narrow extraction to the Feats page (75) plus the following page so the
    // section endHeading anchor is satisfied without paying for a full extract.
    const pdfBytes = readFileSync(SRD_PDF_PATH);
    const pages = await extractPdfText(new Uint8Array(pdfBytes), {
      pageRange: { start: 75, end: 76 },
    });
    const featPages = sliceSection(
      pages,
      SRD_5_1_DEFAULT_SECTION_ANCHORS.feats,
    );
    const feats = parseFeats(featPages);

    expect(feats.map((f) => f.name)).toEqual(['Grappler']);
    const [grappler] = feats;
    expect(grappler.prerequisites).toBe('Strength 13 or higher');
    // The intro prose must not bleed into the feat body, and the soft-hyphen
    // cluster in "close-quarters" must be normalized to a plain ASCII hyphen.
    expect(grappler.description).not.toMatch(/A feat represents/);
    expect(grappler.description).toMatch(/close-quarters grappling/);
  }, 20000);
});
