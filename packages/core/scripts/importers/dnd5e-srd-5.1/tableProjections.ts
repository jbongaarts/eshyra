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

function projectionFor(
  table: TableExtraction,
): Record<string, unknown> | undefined {
  switch (table.name) {
    case 'Destroy Undead':
      return projectDestroyUndead(table);
    case 'Beast Shapes':
      return projectBeastShapes(table);
    case 'Draconic Ancestry':
      return table.sourcePage === 5
        ? projectDraconicAncestry(table)
        : undefined;
    default:
      return undefined;
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
