import { parseRules, removeTableCellLines } from './parseRules.js';
import type { PageText, RuleExtraction } from './types.js';

interface FlatLine {
  readonly line: string;
  readonly page: number;
  readonly height?: number;
}

function flatten(pages: readonly PageText[]): FlatLine[] {
  return pages.flatMap((page) =>
    page.lines.map((line, index) => ({
      line: line.trim(),
      page: page.pageNumber,
      height: page.lineHeights?.[index],
    })),
  );
}

function proseRule(
  lines: readonly FlatLine[],
  name: string,
  keySlug: string,
  minHeight = 9.3,
): RuleExtraction | undefined {
  const body = lines
    .filter(
      ({ line, height }) =>
        line.length > 0 && (height === undefined || height >= minHeight),
    )
    .map(({ line }) => line)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const sourcePage = lines.find(({ line }) => line.length > 0)?.page;
  if (body.length === 0 || sourcePage === undefined) return undefined;
  return { name, keySlug, text: body, sourcePage };
}

function between(
  lines: readonly FlatLine[],
  start: RegExp | undefined,
  end: RegExp,
): readonly FlatLine[] {
  const startIndex =
    start === undefined ? 0 : lines.findIndex(({ line }) => start.test(line));
  if (startIndex < 0) return [];
  const bodyStart = start === undefined ? startIndex : startIndex + 1;
  const endOffset = lines
    .slice(bodyStart)
    .findIndex(({ line }) => end.test(line));
  const bodyEnd = endOffset < 0 ? lines.length : bodyStart + endOffset;
  return lines.slice(bodyStart, bodyEnd);
}

function append(
  rules: RuleExtraction[],
  rule: RuleExtraction | undefined,
): void {
  if (rule !== undefined) rules.push(rule);
}

function afterHeading(
  pages: readonly PageText[],
  heading: RegExp,
): readonly PageText[] {
  const out: PageText[] = [];
  let found = false;
  for (const page of pages) {
    if (found) {
      out.push(page);
      continue;
    }
    const index = page.lines.findIndex((line) => heading.test(line.trim()));
    if (index < 0) continue;
    found = true;
    out.push({
      pageNumber: page.pageNumber,
      lines: page.lines.slice(index + 1),
      ...(page.lineHeights === undefined
        ? {}
        : { lineHeights: page.lineHeights.slice(index + 1) }),
    });
  }
  return out;
}

/**
 * Capture Equipment-chapter guidance that is not owned by a table row.
 *
 * Item/tool descriptions are attached separately by `parseEquipment`; these
 * rules stop before those description runs so the prose has one clear owner.
 */
export function parseEquipmentGuidance(
  equipmentPages: readonly PageText[],
  mountsAndVehiclesPages: readonly PageText[],
  tradeGoodsPages: readonly PageText[],
  expensesPages: readonly PageText[],
  reservedKeySlugs: ReadonlySet<string> = new Set(),
): RuleExtraction[] {
  const equipment = flatten(equipmentPages);
  const mounts = flatten(mountsAndVehiclesPages);
  const tradeGoods = flatten(tradeGoodsPages);
  const rules: RuleExtraction[] = [];

  append(
    rules,
    proseRule(
      between(equipment, undefined, /^Standard Exchange Rates$/),
      'Coinage',
      'coinage',
    ),
  );
  append(
    rules,
    proseRule(
      between(equipment, /^Selling Treasure$/, /^Armor$/),
      'Selling Treasure',
      'selling-treasure',
    ),
  );
  append(
    rules,
    proseRule(
      between(equipment, /^Armor$/, /^Light Armor$/),
      'Armor Guidance',
      'armor-guidance',
    ),
  );
  append(
    rules,
    proseRule(
      between(equipment, /^Equipment Packs$/, /^[^()]+ Pack \(/),
      'Equipment Packs',
      'equipment-packs',
      8.5,
    ),
  );

  const toolsStart = equipment.findIndex(
    ({ line, height }) => line === 'Tools' && (height ?? 0) >= 15,
  );
  if (toolsStart >= 0) {
    const toolsEnd = equipment
      .slice(toolsStart + 1)
      .findIndex(({ line }) => line === 'Tools');
    append(
      rules,
      proseRule(
        equipment.slice(
          toolsStart + 1,
          toolsEnd < 0 ? equipment.length : toolsStart + 1 + toolsEnd,
        ),
        'Tools',
        'tools',
      ),
    );
  }

  append(
    rules,
    proseRule(
      between(mounts, undefined, /^Mounts and Other Animals$/),
      'Mounts and Vehicles',
      'mounts-and-vehicles',
    ),
  );
  append(
    rules,
    proseRule(
      between(tradeGoods, undefined, /^Trade Goods$/),
      'Trade Goods',
      'trade-goods',
    ),
  );

  const expenseRules = parseRules(
    removeTableCellLines(afterHeading(expensesPages, /^Expenses$/)),
    new Set([
      ...reservedKeySlugs,
      ...rules
        .map((rule) => rule.keySlug)
        .filter((key): key is string => key !== undefined),
    ]),
    { name: 'Expenses', keySlug: 'expenses' },
  ).filter(
    (rule) =>
      rule.name !== 'Self-Sufficiency' && rule.name !== 'Spellcasting Services',
  );
  rules.push(...expenseRules);

  rules.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rules;
}
