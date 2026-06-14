import { classifyTier, isTableCell } from './sourceInventory.js';
import type { PageText, RuleExtraction } from './types.js';

const TEMPLATE_HEADING = 'Half-Dragon Template';
const TEMPLATE_KEY = 'half-dragon-template';
const TABLE_REFS = [
  'table:half-dragon-damage-resistance',
  'table:half-dragon-breath-weapon',
] as const;

interface FlatLine {
  readonly page: number;
  readonly text: string;
  readonly height: number | undefined;
}

function flatten(pages: readonly PageText[]): FlatLine[] {
  return pages.flatMap((page) =>
    page.lines.map((text, lineIndex) => ({
      page: page.pageNumber,
      text: text.trim(),
      height: page.lineHeights?.[lineIndex],
    })),
  );
}

function joinProse(lines: readonly string[]): string {
  let out = '';
  for (const line of lines) {
    if (out.endsWith('-') && /^[a-z]/.test(line)) {
      out += line;
    } else {
      out += `${out.length === 0 ? '' : ' '}${line}`;
    }
  }
  return out;
}

/**
 * Parse the bounded p320-321 Half-Dragon Template subsection.
 *
 * Table-cell lines are omitted from the prose record and emitted separately by
 * parseDocumentTables. The first following leaf-or-higher heading ends the
 * region, which is Half-Red Dragon Veteran in the reviewed SRD extraction.
 */
export function parseHalfDragonTemplate(
  pages: readonly PageText[],
): RuleExtraction | undefined {
  const lines = flatten(pages);
  const start = lines.findIndex(
    (line) =>
      line.text === TEMPLATE_HEADING &&
      classifyTier(line.height) === 'subsection',
  );
  if (start < 0) return undefined;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const tier = classifyTier(lines[i].height);
    if (
      tier === 'chapter' ||
      tier === 'section' ||
      tier === 'subsection' ||
      tier === 'leaf'
    ) {
      end = i;
      break;
    }
  }

  const prose = lines
    .slice(start + 1, end)
    .filter((line) => line.text.length > 0 && !isTableCell(line.height))
    .map((line) => line.text);

  return {
    name: TEMPLATE_HEADING,
    keySlug: TEMPLATE_KEY,
    text: joinProse(prose),
    sourcePage: lines[start].page,
    tableRefs: TABLE_REFS,
  };
}
