import {
  type CharacterChronicleStore,
  type CharacterRegistryStore,
  type CharacterSheet,
  createCharacterChronicleStore,
  createCharacterRegistryStore,
  type Db,
  ensureCharacterRegistrySchema,
  openDatabase,
} from '@eshyra/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ChronicleDeps, runChronicleCommand } from '../src/chronicle.js';

const AT = '2026-06-28T06:00:00.000Z';
const LATER = '2026-06-28T06:05:00.000Z';

// A minimal structurally-valid head sheet: the registry only requires the
// binding columns (schemaVersion/system/rulesPackId) to be present and
// non-empty. The chronicle, not the sheet, is the subject under test here.
function makeSheet(): CharacterSheet {
  return {
    schemaVersion: 1,
    system: 'dnd5e-srd',
    rulesPackId: 'rules__dnd5e-srd-5.1',
    identity: { name: 'Mira' },
    level: 1,
  } as unknown as CharacterSheet;
}

describe('runChronicleCommand', () => {
  let db: Db;
  let chronicle: CharacterChronicleStore;
  let registry: CharacterRegistryStore;
  let output: string[];
  let deps: ChronicleDeps;

  beforeEach(() => {
    db = openDatabase(':memory:');
    ensureCharacterRegistrySchema(db);
    registry = createCharacterRegistryStore(db);
    chronicle = createCharacterChronicleStore(db, () => AT);
    registry.save('mira', makeSheet());
    chronicle.appendRecord({
      globalCharacterId: 'mira',
      category: 'relationship',
      text: 'Remembers King Aldren',
      source: { campaignId: 'camp-a', sessionId: 's1', at: AT },
      portability: 'portable',
      visibility: 'player-visible',
      truthStatus: 'remembered',
      relatedRefs: [],
    });
    output = [];
    deps = {
      chronicle,
      registry,
      log: (message: string) => output.push(message),
      now: () => LATER,
    };
  });

  afterEach(() => {
    db.close();
  });

  it('lists chronicle records for a registry character', () => {
    const code = runChronicleCommand(['list', 'mira'], deps);
    expect(code).toBe(0);
    expect(output.join('\n')).toContain('chronicle-1');
    expect(output.join('\n')).toContain('Remembers King Aldren');
    expect(output.join('\n')).toContain('portable/player-visible/remembered');
  });

  it('reports unknown characters instead of an empty list', () => {
    const code = runChronicleCommand(['list', 'nobody'], deps);
    expect(code).toBe(1);
    expect(output.join('\n')).toContain("Unknown character 'nobody'");
    expect(output.join('\n')).toContain('Registered characters: mira');
  });

  it('shows a single record in detail', () => {
    const code = runChronicleCommand(['show', 'mira', 'chronicle-1'], deps);
    expect(code).toBe(0);
    const text = output.join('\n');
    expect(text).toContain('chronicle-1 (relationship)');
    expect(text).toContain('campaign camp-a, session s1');
  });

  it('updates portability and visibility via set', () => {
    const code = runChronicleCommand(
      [
        'set',
        'mira',
        'chronicle-1',
        '--portability',
        'campaign-local',
        '--visibility',
        'private',
      ],
      deps,
    );
    expect(code).toBe(0);
    const record = chronicle.getRecord('mira', 'chronicle-1');
    expect(record?.portability).toBe('campaign-local');
    expect(record?.visibility).toBe('private');
    expect(record?.updatedAt).toBe(LATER);
  });

  it('archives a record', () => {
    const code = runChronicleCommand(['archive', 'mira', 'chronicle-1'], deps);
    expect(code).toBe(0);
    expect(chronicle.getRecord('mira', 'chronicle-1')?.portability).toBe(
      'archived',
    );
  });

  it('records an auditable update event for curation', () => {
    runChronicleCommand(['archive', 'mira', 'chronicle-1'], deps);
    const events = chronicle.listEvents('mira', 'chronicle-1');
    const updates = events.filter((event) => event.kind === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.changes).toMatchObject({ portability: 'archived' });
  });

  it('rejects an invalid portability value', () => {
    const code = runChronicleCommand(
      ['set', 'mira', 'chronicle-1', '--portability', 'bogus'],
      deps,
    );
    expect(code).toBe(1);
    expect(output.join('\n')).toContain('--portability must be one of');
    expect(chronicle.getRecord('mira', 'chronicle-1')?.portability).toBe(
      'portable',
    );
  });

  it('requires at least one field to set', () => {
    const code = runChronicleCommand(['set', 'mira', 'chronicle-1'], deps);
    expect(code).toBe(1);
    expect(output.join('\n')).toContain('Nothing to update');
  });

  it('reports a missing record on set', () => {
    const code = runChronicleCommand(
      ['set', 'mira', 'chronicle-9', '--visibility', 'private'],
      deps,
    );
    expect(code).toBe(1);
    expect(output.join('\n')).toContain("No chronicle record 'chronicle-9'");
  });

  it('prints usage for an unknown subcommand', () => {
    const code = runChronicleCommand(['frobnicate'], deps);
    expect(code).toBe(1);
    expect(output.join('\n')).toContain('Unknown chronicle command');
  });
});
