import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EMBERFALL_HOLLOW,
  getCampaign,
  openDatabase,
  readCampaignRulesBinding,
} from '@eshyra/core';
import { DND5E_SRD_PACK_ID, DND5E_SRD_SYSTEM_ID } from '@eshyra/core/internal';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type CampaignDeps,
  resolvePlayCampaign,
  runCampaignsCommand,
  runNewCommand,
} from '../src/campaigns.js';
import type { CliIO } from '../src/play.js';
import { loadRegistry } from '../src/registry.js';

interface Harness {
  root: string;
  deps: CampaignDeps;
  logs: string[];
  written: string[];
}

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* SQLite files can briefly EPERM on Windows; OS temp cleanup covers it */
    }
  }
});

/** Build a harness with a fresh data root and a scripted prompt queue. */
function harness(answers: Array<string | undefined> = []): Harness {
  const root = join(mkdtempSync(join(tmpdir(), 'lw-camp-')), 'data');
  roots.push(root);
  const logs: string[] = [];
  const written: string[] = [];
  let next = 0;
  const io: CliIO = {
    write: (line) => written.push(line),
    prompt: async () => answers[next++],
  };
  let counter = 0;
  const deps: CampaignDeps = {
    root,
    io,
    log: (message) => logs.push(message),
    now: () => '2026-05-22T12:00:00.000Z',
    nextId: (prefix) => `${prefix}-${++counter}`,
    pack: EMBERFALL_HOLLOW,
    openDb: (path) => openDatabase(path),
  };
  return { root, deps, logs, written };
}

describe('runNewCommand', () => {
  it('creates a campaign database and registers it', () => {
    const h = harness();
    const code = runNewCommand(['Ember', 'Quest'], h.deps);
    expect(code).toBe(0);

    const registry = loadRegistry(h.root);
    expect(registry.campaigns).toHaveLength(1);
    const entry = registry.campaigns[0];
    expect(entry.id).toBe('ember-quest');
    expect(entry.name).toBe('Ember Quest');
    expect(existsSync(entry.dbPath)).toBe(true);

    const db = openDatabase(entry.dbPath);
    try {
      expect(getCampaign(db)).toBeDefined();
      // `eshyra new` persists the default D&D SRD rules binding so
      // managed campaigns ship with an authoritative system identity.
      const binding = readCampaignRulesBinding(db);
      expect(binding).toBeDefined();
      expect(binding?.base.systemId).toBe(DND5E_SRD_SYSTEM_ID);
      expect(binding?.base.packId).toBe(DND5E_SRD_PACK_ID);
      expect(binding?.addons).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('disambiguates a colliding slug', () => {
    const h = harness();
    runNewCommand(['Quest'], h.deps);
    runNewCommand(['Quest'], h.deps);
    const ids = loadRegistry(h.root).campaigns.map((c) => c.id);
    expect(ids).toEqual(['quest', 'quest-2']);
  });

  it('defaults the name when none is given', () => {
    const h = harness();
    runNewCommand([], h.deps);
    expect(loadRegistry(h.root).campaigns[0].name).toBe('Campaign');
  });
});

describe('runCampaignsCommand', () => {
  it('lists registered campaigns', () => {
    const h = harness();
    runNewCommand(['Quest'], h.deps);
    h.logs.length = 0;
    expect(runCampaignsCommand(['list'], h.deps)).toBe(0);
    expect(h.logs.join('\n')).toContain('quest');
  });

  it('reports an empty registry on list', () => {
    const h = harness();
    expect(runCampaignsCommand(['list'], h.deps)).toBe(0);
    expect(h.logs.join('\n')).toContain('No campaigns registered');
  });

  it('renames a campaign', () => {
    const h = harness();
    runNewCommand(['Quest'], h.deps);
    expect(runCampaignsCommand(['rename', 'quest', 'New Name'], h.deps)).toBe(
      0,
    );
    expect(loadRegistry(h.root).campaigns[0].name).toBe('New Name');
  });

  it('removes a campaign without deleting its database file', () => {
    const h = harness();
    runNewCommand(['Quest'], h.deps);
    const dbPath = loadRegistry(h.root).campaigns[0].dbPath;
    expect(runCampaignsCommand(['remove', 'quest'], h.deps)).toBe(0);
    expect(loadRegistry(h.root).campaigns).toHaveLength(0);
    expect(existsSync(dbPath)).toBe(true);
  });

  it('adds an externally-located database', () => {
    const h = harness();
    mkdirSync(h.root, { recursive: true });
    const external = join(h.root, 'external.db');
    openDatabase(external).close();
    expect(runCampaignsCommand(['add', external, 'Imported'], h.deps)).toBe(0);
    const entry = loadRegistry(h.root).campaigns[0];
    expect(entry.name).toBe('Imported');
    expect(entry.dbPath).toBe(external);
  });

  it('rejects adding a path with no file', () => {
    const h = harness();
    expect(
      runCampaignsCommand(['add', join(h.root, 'missing.db')], h.deps),
    ).toBe(1);
  });

  it('rejects an unknown subcommand', () => {
    const h = harness();
    expect(runCampaignsCommand(['frobnicate'], h.deps)).toBe(1);
  });
});

describe('resolvePlayCampaign', () => {
  it('opens the only campaign without prompting', async () => {
    const h = harness();
    runNewCommand(['Quest'], h.deps);
    const target = await resolvePlayCampaign(h.deps, {});
    expect(target.ok).toBe(true);
    if (target.ok) {
      expect(target.entry.id).toBe('quest');
      expect(target.entry.lastPlayedAt).toBe('2026-05-22T12:00:00.000Z');
    }
  });

  it('selects a campaign by explicit id argument', async () => {
    const h = harness();
    runNewCommand(['One'], h.deps);
    runNewCommand(['Two'], h.deps);
    const target = await resolvePlayCampaign(h.deps, { campaignArg: 'two' });
    expect(target.ok && target.entry.id).toBe('two');
  });

  it('fails for an unknown campaign id', async () => {
    const h = harness();
    runNewCommand(['One'], h.deps);
    const target = await resolvePlayCampaign(h.deps, { campaignArg: 'nope' });
    expect(target.ok).toBe(false);
  });

  it('offers to create the first campaign on an empty registry', async () => {
    const h = harness(['y']);
    const target = await resolvePlayCampaign(h.deps, {});
    expect(target.ok).toBe(true);
    expect(loadRegistry(h.root).campaigns).toHaveLength(1);
  });

  it('does not create a campaign when the offer is declined', async () => {
    const h = harness(['n']);
    const target = await resolvePlayCampaign(h.deps, {});
    expect(target.ok).toBe(false);
    expect(loadRegistry(h.root).campaigns).toHaveLength(0);
  });

  it('fails on an empty registry with no interactive input', async () => {
    const h = harness([undefined]);
    const target = await resolvePlayCampaign(h.deps, {});
    expect(target.ok).toBe(false);
  });

  it('picks from several campaigns by number', async () => {
    const h = harness(['2']);
    runNewCommand(['One'], h.deps);
    runNewCommand(['Two'], h.deps);
    const target = await resolvePlayCampaign(h.deps, {});
    expect(target.ok && target.entry.id).toBe('two');
  });

  it('honors defaultCampaignId on a blank picker answer', async () => {
    const h = harness(['']);
    runNewCommand(['One'], h.deps);
    runNewCommand(['Two'], h.deps);
    const target = await resolvePlayCampaign(h.deps, {
      defaultCampaignId: 'two',
    });
    expect(target.ok && target.entry.id).toBe('two');
  });

  it('fails on an out-of-range picker answer', async () => {
    const h = harness(['9']);
    runNewCommand(['One'], h.deps);
    runNewCommand(['Two'], h.deps);
    const target = await resolvePlayCampaign(h.deps, {});
    expect(target.ok).toBe(false);
  });
});
