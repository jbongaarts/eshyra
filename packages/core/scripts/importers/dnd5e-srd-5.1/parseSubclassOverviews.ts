/**
 * Subclass-category overview parser for the D&D 5e SRD 5.1 importer
 * (eshyra-g9im / eshyra-i2v4).
 *
 * Each base class introduces its subclasses under a plural category heading —
 * Martial Archetypes (p25), Monastic Traditions (p28), Sacred Oaths (p32),
 * Ranger Archetypes (p37), Roguish Archetypes (p40), Sorcerous Origins (p44),
 * Otherworldly Patrons (p50), Arcane Traditions (p54). The SRD prints each as an
 * h≈18 subsection heading followed by a short overview paragraph (e.g. "Different
 * fighters choose different approaches to perfecting their fighting prowess…")
 * and then the individual subclass entries at h≈13.9 ("Champion", "Draconic
 * Bloodline", …).
 *
 * The subclass entries and their features are emitted as `subclass` / `feature`
 * records, but the category overview prose itself was ignored as
 * `document-structure` source coverage. This parser captures each category's
 * overview prose as a source-bounded `rule` record named after the category
 * heading, so the heading resolves to `record:rule:<slug>` (auto-matched by
 * name) instead of `ignored:document-structure`, without absorbing the first
 * subclass entry that follows.
 *
 * Targeted by an explicit title allowlist (these eight plural headings are the
 * only subclass-category sections in SRD 5.1) so no other h≈18 class-chapter
 * heading — a base-class title, a class feature — is captured. The overview body
 * runs from the category heading to the next heading-tier line of any depth.
 */

import { reflowProse } from './parseSectionIntro.js';
import type { PageText, RuleExtraction } from './types.js';

/** The eight SRD 5.1 subclass-category headings, by exact source text. */
export const SUBCLASS_CATEGORY_TITLES: readonly string[] = [
  'Martial Archetypes',
  'Monastic Traditions',
  'Sacred Oaths',
  'Ranger Archetypes',
  'Roguish Archetypes',
  'Sorcerous Origins',
  'Otherworldly Patrons',
  'Arcane Traditions',
];

const TITLE_SET = new Set(SUBCLASS_CATEGORY_TITLES);

/**
 * Category headings render at the subsection tier (h≈18); the subclass entries
 * that bound the overview body render at the sub-subsection tier (h≈13.9). The
 * thresholds sit in the gaps below each so a category heading is recognized and
 * the body ends at the first following heading of any tier.
 */
const CATEGORY_MIN_HEIGHT = 16;
const HEADING_MIN_HEIGHT = 13;

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface FlatLine {
  readonly line: string;
  readonly page: number;
  readonly height: number | undefined;
}

function flatten(pages: readonly PageText[]): FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    for (let i = 0; i < page.lines.length; i++) {
      out.push({
        line: page.lines[i],
        page: page.pageNumber,
        height: page.lineHeights?.[i],
      });
    }
  }
  return out;
}

export function parseSubclassOverviews(
  pages: readonly PageText[],
): RuleExtraction[] {
  const flat = flatten(pages);
  const out: RuleExtraction[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < flat.length; i++) {
    const { line, height, page } = flat[i];
    if (height === undefined || height < CATEGORY_MIN_HEIGHT) continue;
    const title = line.trim();
    if (!TITLE_SET.has(title) || seen.has(title)) continue;
    seen.add(title);
    const body: string[] = [];
    for (let j = i + 1; j < flat.length; j++) {
      const next = flat[j];
      if (next.height !== undefined && next.height >= HEADING_MIN_HEIGHT) break;
      body.push(next.line);
    }
    const text = reflowProse(body);
    out.push({
      name: title,
      keySlug: slug(title),
      text: text.length > 0 ? text : title,
      sourcePage: page,
    });
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
