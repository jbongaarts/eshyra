import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { registryFilePath } from '../src/dataRoot.js';
import {
  addCampaign,
  type CampaignRegistry,
  type CampaignRegistryEntry,
  emptyRegistry,
  findCampaign,
  loadRegistry,
  RegistryError,
  removeCampaign,
  saveRegistry,
  slugify,
  uniqueId,
  updateCampaign,
} from '../src/registry.js';

function entry(
  over: Partial<CampaignRegistryEntry> = {},
): CampaignRegistryEntry {
  return {
    id: 'emberfall',
    name: 'Emberfall',
    dbPath: '/data/campaigns/emberfall.db',
    createdAt: '2026-05-22T00:00:00.000Z',
    ...over,
  };
}

describe('loadRegistry / saveRegistry', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const dir of roots.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  function freshRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'lw-reg-'));
    roots.push(root);
    return root;
  }

  it('returns an empty registry when no file exists', () => {
    expect(loadRegistry(freshRoot())).toEqual(emptyRegistry());
  });

  it('round-trips a saved registry', () => {
    const root = freshRoot();
    const registry = addCampaign(emptyRegistry(), entry());
    saveRegistry(root, registry);
    expect(loadRegistry(root)).toEqual(registry);
  });

  it('rejects malformed JSON', () => {
    const root = freshRoot();
    writeFileSync(registryFilePath(root), '{ broken', 'utf8');
    expect(() => loadRegistry(root)).toThrow(RegistryError);
  });

  it('rejects a campaigns array with a malformed entry', () => {
    const root = freshRoot();
    writeFileSync(
      registryFilePath(root),
      JSON.stringify({ version: 1, campaigns: [{ id: 'x' }] }),
      'utf8',
    );
    expect(() => loadRegistry(root)).toThrow(/campaigns/);
  });
});

describe('slugify / uniqueId', () => {
  it('reduces a display name to a slug', () => {
    expect(slugify('  The Ember Fall!! ')).toBe('the-ember-fall');
  });

  it('falls back to "campaign" for an empty slug', () => {
    expect(slugify('!!!')).toBe('campaign');
  });

  it('disambiguates a colliding id with a numeric suffix', () => {
    let registry = emptyRegistry();
    registry = addCampaign(registry, entry({ id: 'ember' }));
    registry = addCampaign(registry, entry({ id: 'ember-2' }));
    expect(uniqueId('Ember', registry)).toBe('ember-3');
  });
});

describe('registry mutations', () => {
  it('addCampaign rejects a duplicate id', () => {
    const registry = addCampaign(emptyRegistry(), entry());
    expect(() => addCampaign(registry, entry())).toThrow(RegistryError);
  });

  it('removeCampaign drops the entry and rejects an unknown id', () => {
    const registry = addCampaign(emptyRegistry(), entry());
    expect(removeCampaign(registry, 'emberfall').campaigns).toHaveLength(0);
    expect(() => removeCampaign(registry, 'nope')).toThrow(RegistryError);
  });

  it('updateCampaign replaces a single entry', () => {
    const registry = addCampaign(emptyRegistry(), entry());
    const renamed = updateCampaign(registry, 'emberfall', (c) => ({
      ...c,
      name: 'Renamed',
    }));
    expect(findCampaign(renamed, 'emberfall')?.name).toBe('Renamed');
  });

  it('does not mutate the input registry', () => {
    const registry: CampaignRegistry = emptyRegistry();
    addCampaign(registry, entry());
    expect(registry.campaigns).toHaveLength(0);
  });
});
