/**
 * `eshyra chronicle <list|show|set|archive>` — inspect and curate a registry
 * character's portable chronicle (eshyra-lupf.16.1).
 *
 * The chronicle is character-scoped, portable memory (ADR 0012, the lupf.16
 * epic) keyed by a global character id and stored alongside the cross-campaign
 * registry. These commands let a player review those records and adjust their
 * portability / visibility / archive status before carrying a character into a
 * new campaign. They are deliberately read/curate only: they never assert or
 * mutate any campaign's world canon — they touch the character's own record
 * fields exclusively.
 */

import type {
  CharacterChroniclePortability,
  CharacterChronicleRecord,
  CharacterChronicleStore,
  CharacterChronicleVisibility,
  CharacterRegistryStore,
  UpdateCharacterChronicleRecordInput,
} from '@eshyra/core';
import { openCharacterRegistryStores } from './characterRegistry.js';
import { resolveDataRoot } from './dataRoot.js';

const PORTABILITY_VALUES: readonly CharacterChroniclePortability[] = [
  'portable',
  'campaign-local',
  'archived',
];

const VISIBILITY_VALUES: readonly CharacterChronicleVisibility[] = [
  'player-visible',
  'dm-only',
  'private',
];

const USAGE = [
  'Usage:',
  '  eshyra chronicle list <character-id>',
  '  eshyra chronicle show <character-id> <record-id>',
  '  eshyra chronicle set <character-id> <record-id>' +
    ' [--portability <portable|campaign-local|archived>]' +
    ' [--visibility <player-visible|dm-only|private>]',
  '  eshyra chronicle archive <character-id> <record-id>',
].join('\n');

/** Collaborators for the chronicle command, injectable for tests. */
export interface ChronicleDeps {
  readonly chronicle: CharacterChronicleStore;
  readonly registry: CharacterRegistryStore;
  readonly log: (message: string) => void;
  readonly now: () => string;
}

/**
 * Run `eshyra chronicle ...` against injected stores. Returns a process exit
 * code (0 on success, 1 on any usage or lookup error). All output goes through
 * `deps.log` so tests can assert on it.
 */
export function runChronicleCommand(
  argv: readonly string[],
  deps: ChronicleDeps,
): number {
  const action = argv[0];
  switch (action) {
    case 'list':
      return runList(argv.slice(1), deps);
    case 'show':
      return runShow(argv.slice(1), deps);
    case 'set':
      return runSet(argv.slice(1), deps);
    case 'archive':
      return runArchive(argv.slice(1), deps);
    default:
      deps.log(
        action === undefined
          ? USAGE
          : `Unknown chronicle command: ${action}\n${USAGE}`,
      );
      return 1;
  }
}

function runList(argv: readonly string[], deps: ChronicleDeps): number {
  const characterId = argv[0];
  if (characterId === undefined || argv.length > 1) {
    deps.log(USAGE);
    return 1;
  }
  if (!ensureKnownCharacter(characterId, deps)) {
    return 1;
  }
  const records = deps.chronicle.listRecords(characterId);
  if (records.length === 0) {
    deps.log(`No chronicle records for '${characterId}'.`);
    return 0;
  }
  deps.log(`Chronicle for '${characterId}' (${records.length}):`);
  for (const record of records) {
    deps.log(`  - ${formatRecordSummary(record)}`);
  }
  return 0;
}

function runShow(argv: readonly string[], deps: ChronicleDeps): number {
  const characterId = argv[0];
  const recordId = argv[1];
  if (characterId === undefined || recordId === undefined || argv.length > 2) {
    deps.log(USAGE);
    return 1;
  }
  const record = deps.chronicle.getRecord(characterId, recordId);
  if (record === undefined) {
    deps.log(`No chronicle record '${recordId}' for '${characterId}'.`);
    return 1;
  }
  for (const line of formatRecordDetail(record)) {
    deps.log(line);
  }
  return 0;
}

function runSet(argv: readonly string[], deps: ChronicleDeps): number {
  const characterId = argv[0];
  const recordId = argv[1];
  if (characterId === undefined || recordId === undefined) {
    deps.log(USAGE);
    return 1;
  }
  const parsed = parseSetFlags(argv.slice(2));
  if (!parsed.ok) {
    deps.log(`${parsed.message}\n${USAGE}`);
    return 1;
  }
  if (Object.keys(parsed.patch).length === 0) {
    deps.log('Nothing to update: pass --portability and/or --visibility.');
    return 1;
  }
  return applyUpdate(characterId, recordId, parsed.patch, deps);
}

function runArchive(argv: readonly string[], deps: ChronicleDeps): number {
  const characterId = argv[0];
  const recordId = argv[1];
  if (characterId === undefined || recordId === undefined || argv.length > 2) {
    deps.log(USAGE);
    return 1;
  }
  return applyUpdate(characterId, recordId, { portability: 'archived' }, deps);
}

function applyUpdate(
  characterId: string,
  recordId: string,
  patch: UpdateCharacterChronicleRecordInput,
  deps: ChronicleDeps,
): number {
  if (deps.chronicle.getRecord(characterId, recordId) === undefined) {
    deps.log(`No chronicle record '${recordId}' for '${characterId}'.`);
    return 1;
  }
  try {
    const updated = deps.chronicle.updateRecord(characterId, recordId, {
      ...patch,
      at: deps.now(),
    });
    deps.log(`Updated ${formatRecordSummary(updated)}`);
    return 0;
  } catch (error) {
    deps.log(`Chronicle update failed: ${(error as Error).message}`);
    return 1;
  }
}

interface ParsedSetFlags {
  readonly ok: true;
  readonly patch: UpdateCharacterChronicleRecordInput;
}

interface ParseError {
  readonly ok: false;
  readonly message: string;
}

function parseSetFlags(argv: readonly string[]): ParsedSetFlags | ParseError {
  const patch: {
    portability?: CharacterChroniclePortability;
    visibility?: CharacterChronicleVisibility;
  } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--portability': {
        if (value === undefined) {
          return { ok: false, message: '--portability requires a value.' };
        }
        if (
          !PORTABILITY_VALUES.includes(value as CharacterChroniclePortability)
        ) {
          return {
            ok: false,
            message: `--portability must be one of: ${PORTABILITY_VALUES.join(', ')}.`,
          };
        }
        patch.portability = value as CharacterChroniclePortability;
        i += 1;
        break;
      }
      case '--visibility': {
        if (value === undefined) {
          return { ok: false, message: '--visibility requires a value.' };
        }
        if (
          !VISIBILITY_VALUES.includes(value as CharacterChronicleVisibility)
        ) {
          return {
            ok: false,
            message: `--visibility must be one of: ${VISIBILITY_VALUES.join(', ')}.`,
          };
        }
        patch.visibility = value as CharacterChronicleVisibility;
        i += 1;
        break;
      }
      default:
        return { ok: false, message: `Unknown option: ${flag}` };
    }
  }
  return { ok: true, patch };
}

/**
 * Report a clear error (and the available ids) when the character is not in the
 * registry, so `list` of an unknown id is not silently mistaken for "no
 * records". Returns true when the character is known.
 */
function ensureKnownCharacter(
  characterId: string,
  deps: ChronicleDeps,
): boolean {
  if (deps.registry.list().includes(characterId)) {
    return true;
  }
  deps.log(`Unknown character '${characterId}'.`);
  const ids = deps.registry.list();
  if (ids.length > 0) {
    deps.log(`Registered characters: ${ids.join(', ')}`);
  }
  return false;
}

function formatRecordSummary(record: CharacterChronicleRecord): string {
  return (
    `${record.id} [${record.category}] ` +
    `${record.portability}/${record.visibility}/${record.truthStatus}: ` +
    record.text
  );
}

function formatRecordDetail(record: CharacterChronicleRecord): string[] {
  const lines = [
    `${record.id} (${record.category})`,
    `  text: ${record.text}`,
    `  portability: ${record.portability}`,
    `  visibility: ${record.visibility}`,
    `  truth: ${record.truthStatus}`,
    `  source: campaign ${record.source.campaignId}, session ${record.source.sessionId} (${record.source.at})`,
  ];
  if (record.relatedRefs.length > 0) {
    lines.push(
      `  related: ${record.relatedRefs.map((ref) => ref.ref).join(', ')}`,
    );
  }
  lines.push(`  updated: ${record.updatedAt}`);
  return lines;
}

/** Terminal entrypoint: open the registry stores and run the command. */
export function runChronicleSubcommand(argv: readonly string[]): number {
  const dataRoot = resolveDataRoot();
  const stores = openCharacterRegistryStores(dataRoot);
  return runChronicleCommand(argv, {
    chronicle: stores.chronicle,
    registry: stores.registry,
    log: (message: string) => console.log(message),
    now: () => new Date().toISOString(),
  });
}
