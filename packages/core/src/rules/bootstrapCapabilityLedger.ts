import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BOOTSTRAP_LEDGER_STATUS = 'NON-AUTHORITATIVE' as const;
export const BOOTSTRAP_LEDGER_PATH = fileURLToPath(
  new URL(
    '../../../../docs/audits/dnd5e-srd-5.1-final/bootstrap-capability-ledger.json',
    import.meta.url,
  ),
);

export type OwnershipStatus = 'owned' | 'proposed-new-bead' | 'disputed';

export interface BootstrapCapabilityRow {
  readonly capabilityId: string;
  readonly primitive: string;
  readonly requirement: string;
  readonly discoveredBy: readonly string[];
  readonly packEvidence: string;
  readonly codeEvidence: string;
  readonly owningBead: string;
  readonly ownershipStatus: OwnershipStatus;
  readonly proposedTitle?: string;
  readonly proposedParent?: string;
  readonly notes: string;
}

export interface BootstrapCapabilityLedger {
  readonly status: typeof BOOTSTRAP_LEDGER_STATUS;
  readonly authoritativeLedger: string;
  readonly snapshotCommit: string;
  readonly sources: readonly string[];
  readonly rows: readonly BootstrapCapabilityRow[];
}

const ENGINE_CAPABILITY_ID = /^engine:F(?:[1-9]|10)$/;
const BEAD_ID = /^eshyra-[a-z0-9]+(?:\.[a-z0-9]+)*$/;
const SOURCE_NAMES = new Set([
  'readiness-artifacts',
  'current-code',
  'current-beads',
  'audit-2026-07-24',
  'missing-source-clause',
]);
const beadExistence = new Map<string, boolean>();

function fail(message: string): never {
  throw new Error(`invalid bootstrap capability ledger: ${message}`);
}

function requiredString(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '')
    fail(`${field} must be a non-empty string`);
}

function requiredStringArray(
  value: unknown,
  field: string,
): asserts value is readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string')
  ) {
    fail(`${field} must be a non-empty string array`);
  }
}

function validateRow(value: unknown, index: number): BootstrapCapabilityRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`rows[${index}] must be an object`);
  }
  const row = value as Record<string, unknown>;
  for (const field of [
    'capabilityId',
    'primitive',
    'requirement',
    'packEvidence',
    'codeEvidence',
    'owningBead',
    'ownershipStatus',
    'notes',
  ])
    requiredString(row[field], `rows[${index}].${field}`);
  requiredStringArray(row.discoveredBy, `rows[${index}].discoveredBy`);
  if (!ENGINE_CAPABILITY_ID.test(row.capabilityId as string)) {
    fail(`rows[${index}].capabilityId must use engine:F1..engine:F10`);
  }
  if (row.primitive === row.capabilityId) {
    fail(`rows[${index}].primitive must identify a specific primitive`);
  }
  if (
    !(row.discoveredBy as readonly string[]).every((source) =>
      SOURCE_NAMES.has(source),
    )
  ) {
    fail(`rows[${index}].discoveredBy contains an unknown source`);
  }
  if (!BEAD_ID.test(row.owningBead as string)) {
    fail(`rows[${index}].owningBead is not a bead ID`);
  }
  if (
    !['owned', 'proposed-new-bead', 'disputed'].includes(
      row.ownershipStatus as string,
    )
  ) {
    fail(`rows[${index}].ownershipStatus is invalid`);
  }
  for (const key of ['count', 'counts', 'recordCount', 'clauseCount']) {
    if (key in row)
      fail(`rows[${index}] stores ${key}; use a query in packEvidence`);
  }
  if (
    row.ownershipStatus === 'proposed-new-bead' &&
    (typeof row.proposedTitle !== 'string' ||
      row.proposedTitle.trim() === '' ||
      typeof row.proposedParent !== 'string' ||
      !BEAD_ID.test(row.proposedParent) ||
      !/proposed title|parent/i.test(row.notes as string))
  ) {
    fail(`rows[${index}] proposed ownership must name its title and parent`);
  }
  return row as unknown as BootstrapCapabilityRow;
}

export function validateBootstrapCapabilityLedger(
  value: unknown,
  options: { readonly checkBeads?: boolean } = {},
): BootstrapCapabilityLedger {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail('root must be an object');
  const root = value as Record<string, unknown>;
  if (root.status !== BOOTSTRAP_LEDGER_STATUS)
    fail('status must be NON-AUTHORITATIVE');
  requiredString(root.authoritativeLedger, 'authoritativeLedger');
  requiredString(root.snapshotCommit, 'snapshotCommit');
  requiredStringArray(root.sources, 'sources');
  if (!(root.sources as readonly string[]).every((source) => source.length > 0))
    fail('sources must not be blank');
  if (!Array.isArray(root.rows) || root.rows.length === 0)
    fail('rows must be a non-empty array');
  const rows = root.rows.map(validateRow);
  const familyRows = new Map<string, number>();
  for (const row of rows) {
    familyRows.set(
      row.capabilityId,
      (familyRows.get(row.capabilityId) ?? 0) + 1,
    );
  }
  for (let family = 1; family <= 10; family += 1) {
    const capabilityId = `engine:F${family}`;
    if (!familyRows.has(capabilityId)) fail(`missing ${capabilityId}`);
    if ((familyRows.get(capabilityId) ?? 0) < 2) {
      fail(`${capabilityId} needs multiple primitive rows`);
    }
  }
  if (
    rows.filter((row) => !row.discoveredBy.includes('readiness-artifacts'))
      .length < 3
  ) {
    fail('fewer than three non-pack-only discovery rows');
  }
  const ownershipStatuses = new Set(rows.map((row) => row.ownershipStatus));
  if (
    !ownershipStatuses.has('owned') ||
    !ownershipStatuses.has('proposed-new-bead')
  ) {
    fail('ownershipStatus must vary between owned and proposed-new-bead');
  }
  if (options.checkBeads !== false && commandExists('bd')) {
    const beadIds = [
      ...new Set(
        rows
          .filter((row) => row.ownershipStatus === 'owned')
          .map((row) => row.owningBead),
      ),
    ].filter((beadId) => beadExistence.get(beadId) !== true);
    if (beadIds.length > 0) {
      try {
        execFileSync('bd', ['show', ...beadIds], { stdio: 'ignore' });
        for (const beadId of beadIds) beadExistence.set(beadId, true);
      } catch {
        for (const beadId of beadIds) {
          if (beadExistence.get(beadId) === false)
            fail(`owning bead does not exist: ${beadId}`);
          try {
            execFileSync('bd', ['show', beadId], { stdio: 'ignore' });
            beadExistence.set(beadId, true);
          } catch {
            beadExistence.set(beadId, false);
            fail(`owning bead does not exist: ${beadId}`);
          }
        }
      }
    }
  }
  return { ...root, rows } as unknown as BootstrapCapabilityLedger;
}

function commandExists(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function loadBootstrapCapabilityLedger(
  path = BOOTSTRAP_LEDGER_PATH,
): BootstrapCapabilityLedger {
  if (!existsSync(path)) fail(`ledger file not found: ${path}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    fail(`ledger JSON cannot be parsed: ${(cause as Error).message}`);
  }
  return validateBootstrapCapabilityLedger(parsed);
}
