import type { TableExtraction } from './types.js';

function expectString(
  value: unknown,
  tableName: string,
  rowIndex: number,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `${tableName} row ${rowIndex + 1} must contain non-empty string cells for semantic projection.`,
    );
  }
  return value;
}

function expectNumberCell(
  value: unknown,
  tableName: string,
  rowIndex: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `${tableName} row ${rowIndex + 1} must contain a numeric cell for semantic projection.`,
    );
  }
  return value;
}

function challengeRatingValue(value: string): number {
  const match = /^(\d+)(?:\/(\d+))?/.exec(value);
  if (match === null) {
    throw new Error(`Cannot parse challenge rating from "${value}".`);
  }
  const numerator = Number(match[1]);
  const denominator = match[2] === undefined ? 1 : Number(match[2]);
  return numerator / denominator;
}

function levelNumber(value: string): number {
  const match = /^(\d{1,2})(?:st|nd|rd|th)$/.exec(value);
  if (match === null) {
    throw new Error(`Cannot parse level from "${value}".`);
  }
  return Number(match[1]);
}

function breathWeaponShape(value: string): 'line' | 'cone' {
  if (/\bline\b/.test(value)) return 'line';
  if (/\bcone\b/.test(value)) return 'cone';
  throw new Error(`Cannot parse breath weapon shape from "${value}".`);
}

function breathWeaponSaveAbility(value: string): string {
  const match = /\((Dex|Con)\. save\)/.exec(value);
  if (match === null) {
    throw new Error(`Cannot parse breath weapon save ability from "${value}".`);
  }
  return match[1] === 'Dex' ? 'dexterity' : 'constitution';
}

// SRD 5.1 p. 62 standard exchange rates expressed as copper pieces. All bundled
// price tables normalize to this basis so a purchase transaction never has to
// re-parse coin glyphs.
const COIN_IN_COPPER: Record<string, number> = {
  cp: 1,
  sp: 10,
  ep: 50,
  gp: 100,
  pp: 1000,
};

function parseCoinToCopper(value: string): number {
  const match = /^(\d[\d,]*)\s+(cp|sp|ep|gp|pp)$/.exec(value);
  if (match === null) {
    throw new Error(`Cannot parse coin value from "${value}".`);
  }
  const amount = Number(match[1].replace(/,/g, ''));
  return amount * COIN_IN_COPPER[match[2]];
}

function splitSpellList(value: string): string[] {
  return value.split(',').map((spell) => spell.trim());
}

function projectDestroyUndead(table: TableExtraction): Record<string, unknown> {
  return {
    kind: 'destroyUndeadThresholds',
    rows: table.rows.map((row, rowIndex) => {
      const clericLevel = expectString(row[0], table.name, rowIndex);
      const maxChallengeRating = expectString(row[1], table.name, rowIndex);
      return {
        clericLevel: levelNumber(clericLevel),
        maxChallengeRating,
        maxChallengeRatingValue: challengeRatingValue(maxChallengeRating),
      };
    }),
  };
}

function projectBeastShapes(table: TableExtraction): Record<string, unknown> {
  return {
    kind: 'beastShapeOptions',
    rows: table.rows.map((row, rowIndex) => {
      const druidLevel = expectString(row[0], table.name, rowIndex);
      const maxChallengeRating = expectString(row[1], table.name, rowIndex);
      const limitations = expectString(row[2], table.name, rowIndex);
      return {
        druidLevel: levelNumber(druidLevel),
        maxChallengeRating,
        maxChallengeRatingValue: challengeRatingValue(maxChallengeRating),
        limitations,
        example: expectString(row[3], table.name, rowIndex),
      };
    }),
  };
}

function projectDraconicAncestry(
  table: TableExtraction,
): Record<string, unknown> {
  return {
    kind: 'draconicAncestryOptions',
    rows: table.rows.map((row, rowIndex) => {
      const breathWeapon = expectString(row[2], table.name, rowIndex);
      return {
        dragon: expectString(row[0], table.name, rowIndex),
        damageType: expectString(row[1], table.name, rowIndex).toLowerCase(),
        breathWeapon,
        breathWeaponShape: breathWeaponShape(breathWeapon),
        breathWeaponSaveAbility: breathWeaponSaveAbility(breathWeapon),
      };
    }),
  };
}

// eshyra-o9bd.7.1 — price / service / lodging / trade-goods tables.

function projectCoinExchangeRates(
  table: TableExtraction,
): Record<string, unknown> {
  return {
    kind: 'coinExchangeRates',
    rows: table.rows.map((row, rowIndex) => {
      const coinLabel = expectString(row[0], table.name, rowIndex);
      const coinMatch = /\((cp|sp|ep|gp|pp)\)/.exec(coinLabel);
      if (coinMatch === null) {
        throw new Error(`Cannot parse coin code from "${coinLabel}".`);
      }
      const copperCell = expectString(row[1], table.name, rowIndex);
      const valueInCopper = Number(copperCell.replace(/,/g, ''));
      if (!Number.isInteger(valueInCopper)) {
        throw new Error(`Cannot parse copper value from "${copperCell}".`);
      }
      return { coin: coinMatch[1], valueInCopper };
    }),
  };
}

function projectTradeGoods(table: TableExtraction): Record<string, unknown> {
  return {
    kind: 'tradeGoodsPrices',
    rows: table.rows.map((row, rowIndex) => {
      const cost = expectString(row[0], table.name, rowIndex);
      return {
        cost,
        costCopper: parseCoinToCopper(cost),
        goods: expectString(row[1], table.name, rowIndex),
      };
    }),
  };
}

function projectFoodDrinkLodging(
  table: TableExtraction,
): Record<string, unknown> {
  return {
    kind: 'foodDrinkLodgingPrices',
    rows: table.rows.map((row, rowIndex) => {
      const cost = expectString(row[1], table.name, rowIndex);
      return {
        item: expectString(row[0], table.name, rowIndex),
        cost,
        costCopper: parseCoinToCopper(cost),
      };
    }),
  };
}

function projectServices(table: TableExtraction): Record<string, unknown> {
  return {
    kind: 'servicePrices',
    rows: table.rows.map((row, rowIndex) => {
      const pay = expectString(row[1], table.name, rowIndex);
      const match =
        /^(\d[\d,]*)\s+(cp|sp|ep|gp|pp)(?:\s+per\s+(mile|day))?$/.exec(pay);
      if (match === null) {
        throw new Error(`Cannot parse service pay from "${pay}".`);
      }
      const payCopper =
        Number(match[1].replace(/,/g, '')) * COIN_IN_COPPER[match[2]];
      return {
        service: expectString(row[0], table.name, rowIndex),
        pay,
        payCopper,
        payUnit: match[3] === undefined ? 'flat' : `per ${match[3]}`,
      };
    }),
  };
}

function projectLifestyleExpenses(
  table: TableExtraction,
): Record<string, unknown> {
  return {
    kind: 'lifestyleExpenses',
    rows: table.rows.map((row, rowIndex) => {
      const pricePerDay = expectString(row[1], table.name, rowIndex);
      if (pricePerDay === '—') {
        return {
          lifestyle: expectString(row[0], table.name, rowIndex),
          pricePerDay,
          pricePerDayCopper: null,
          isMinimum: false,
        };
      }
      const minimumMatch = /^(.*?)\s+minimum$/.exec(pricePerDay);
      const isMinimum = minimumMatch !== null;
      const coinValue = isMinimum ? minimumMatch[1] : pricePerDay;
      return {
        lifestyle: expectString(row[0], table.name, rowIndex),
        pricePerDay,
        pricePerDayCopper: parseCoinToCopper(coinValue),
        isMinimum,
      };
    }),
  };
}

// eshyra-o9bd.7.2 — selectable language pools.

function projectLanguages(
  table: TableExtraction,
  category: 'standard' | 'exotic',
): Record<string, unknown> {
  return {
    kind: 'languageOptions',
    rows: table.rows.map((row, rowIndex) => {
      const script = expectString(row[2], table.name, rowIndex);
      return {
        language: expectString(row[0], table.name, rowIndex),
        typicalSpeakers: expectString(row[1], table.name, rowIndex),
        script: script === '—' ? null : script,
        category,
      };
    }),
  };
}

// eshyra-o9bd.7.3 — subclass / patron expanded spell grants. The source level
// column header varies by class (Cleric/Druid/Paladin/Spell Level); the
// projection normalizes it to a numeric `level` plus a parsed spell-name list.

function projectSubclassSpells(
  table: TableExtraction,
): Record<string, unknown> {
  return {
    kind: 'subclassSpellGrants',
    rows: table.rows.map((row, rowIndex) => ({
      level: levelNumber(expectString(row[0], table.name, rowIndex)),
      spells: splitSpellList(expectString(row[1], table.name, rowIndex)),
    })),
  };
}

// eshyra-o9bd.7.4 — object damage-adjudication metadata.

function projectObjectArmorClass(
  table: TableExtraction,
): Record<string, unknown> {
  return {
    kind: 'objectArmorClass',
    rows: table.rows.map((row, rowIndex) => {
      const substance = expectString(row[0], table.name, rowIndex);
      return {
        substance,
        materials: substance.split(',').map((material) => material.trim()),
        armorClass: expectNumberCell(row[1], table.name, rowIndex),
      };
    }),
  };
}

function parseHitPointCell(
  value: string,
  tableName: string,
): { average: number; dice: string } {
  const match = /^(\d+)\s+\((\d+d\d+)\)$/.exec(value);
  if (match === null) {
    throw new Error(`Cannot parse ${tableName} hit points from "${value}".`);
  }
  return { average: Number(match[1]), dice: match[2] };
}

function projectObjectHitPoints(
  table: TableExtraction,
): Record<string, unknown> {
  return {
    kind: 'objectHitPoints',
    rows: table.rows.map((row, rowIndex) => {
      const size = expectString(row[0], table.name, rowIndex);
      const categoryMatch = /^(\w+)/.exec(size);
      if (categoryMatch === null) {
        throw new Error(`Cannot parse size category from "${size}".`);
      }
      return {
        size,
        sizeCategory: categoryMatch[1],
        fragile: parseHitPointCell(
          expectString(row[1], table.name, rowIndex),
          table.name,
        ),
        resilient: parseHitPointCell(
          expectString(row[2], table.name, rowIndex),
          table.name,
        ),
      };
    }),
  };
}

function projectionFor(
  table: TableExtraction,
): Record<string, unknown> | undefined {
  switch (table.name) {
    case 'Destroy Undead':
      return projectDestroyUndead(table);
    case 'Beast Shapes':
      return projectBeastShapes(table);
    case 'Draconic Ancestry':
      // The Sorcerer Draconic Bloodline table shares this caption on p. 44 but
      // lacks breath-weapon columns; only the p. 5 Dragonborn table projects.
      return table.sourcePage === 5
        ? projectDraconicAncestry(table)
        : undefined;
    case 'Standard Exchange Rates':
      return projectCoinExchangeRates(table);
    case 'Trade Goods':
      return projectTradeGoods(table);
    case 'Food, Drink, and Lodging':
      return projectFoodDrinkLodging(table);
    case 'Services':
      return projectServices(table);
    case 'Lifestyle Expenses':
      return projectLifestyleExpenses(table);
    case 'Standard Languages':
      return projectLanguages(table, 'standard');
    case 'Exotic Languages':
      return projectLanguages(table, 'exotic');
    case 'Life Domain Spells':
    case 'Oath of Devotion Spells':
    case 'Fiend Expanded Spells':
      return projectSubclassSpells(table);
    case 'Object Armor Class':
      return projectObjectArmorClass(table);
    case 'Object Hit Points':
      return projectObjectHitPoints(table);
    default:
      // The seven Circle of the Land terrain tables share one row shape.
      return table.name.startsWith('Circle of the Land')
        ? projectSubclassSpells(table)
        : undefined;
  }
}

export function addSemanticTableProjections(
  tables: readonly TableExtraction[],
): TableExtraction[] {
  return tables.map((table) => {
    const projection = projectionFor(table);
    return projection === undefined ? table : { ...table, projection };
  });
}
