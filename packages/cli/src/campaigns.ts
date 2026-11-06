/**
 * Campaign management commands and the `play` campaign picker (ADR 0004).
 *
 * When `ESHYRA_DB_PATH` is set the CLI opens that explicit, unmanaged
 * database and never consults the registry — that path is handled by the
 * caller. Everything here is the *managed* path: `eshyra new`, the
 * `eshyra campaigns` subcommands, and resolving which registered campaign
 * `eshyra play` should open.
 *
 * The module owns no game-rule logic. Creating a campaign delegates to the
 * core `createCampaign`; this layer only allocates a database path under the
 * data root, records pointer metadata in the registry, and sequences picker
 * I/O.
 */

import { existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import {
  createCampaign,
  type Db,
  getCampaign,
  initSchema,
  type ModulePack,
} from '@eshyra/core';
import type { AcquireWriterLock } from './campaignLock.js';
import { campaignsDir, ensureDataRoot } from './dataRoot.js';
import type { CliIO } from './play.js';
import {
  addCampaign,
  type CampaignRegistry,
  type CampaignRegistryEntry,
  findCampaign,
  loadRegistry,
  removeCampaign,
  saveRegistry,
  uniqueId,
  updateCampaign,
} from './registry.js';

/** Everything the campaign commands and picker need from their host. */
export interface CampaignDeps {
  /** The resolved per-user data root. */
  root: string;
  /** Interactive prompt/output seam (the picker and create confirmation). */
  io: CliIO;
  /** Non-interactive log sink for command output. */
  log: (message: string) => void;
  /** ISO-8601 timestamp source. */
  now: () => string;
  /** Unique id source for new campaigns' internal campaign ids. */
  nextId: (prefix: string) => string;
  /** Module template forked into a brand-new campaign. */
  pack: ModulePack;
  /** Open (creating the file if absent) a campaign database at a path. */
  openDb: (path: string) => Db;
  /** Take the single-writer lock for a campaign database (ADR 0012). */
  acquireWriterLock: AcquireWriterLock;
}

/** A campaign resolved for `play`, or an actionable failure message. */
export type PlayTarget =
  | { ok: true; entry: CampaignRegistryEntry }
  | { ok: false; message: string };

/** Forge a campaign database at `dbPath`: schema + a forked module template. */
function forkNewCampaignDb(dbPath: string, deps: CampaignDeps): void {
  // Created under the writer lock like any other campaign write (ADR 0012); a
  // refusal surfaces as the caller's "could not create campaign" error.
  const lock = deps.acquireWriterLock(dbPath);
  try {
    const db = deps.openDb(dbPath);
    try {
      initSchema(db);
      if (getCampaign(db) === undefined) {
        createCampaign(db, {
          campaignId: deps.nextId('campaign'),
          pack: deps.pack,
        });
      }
    } finally {
      db.close();
    }
  } finally {
    lock.release();
  }
}

/**
 * Create a managed campaign: allocate `campaigns/<slug>.db` under the data
 * root, fork the module into it, and register it. Returns the new entry.
 */
function createManagedCampaign(
  name: string,
  deps: CampaignDeps,
): CampaignRegistryEntry {
  ensureDataRoot(deps.root);
  const registry = loadRegistry(deps.root);
  const id = uniqueId(name, registry);
  const dbPath = resolve(join(campaignsDir(deps.root), `${id}.db`));
  if (existsSync(dbPath)) {
    throw new Error(
      `a database already exists at ${dbPath}; choose a different name`,
    );
  }
  forkNewCampaignDb(dbPath, deps);
  const entry: CampaignRegistryEntry = {
    id,
    name: name.trim(),
    dbPath,
    createdAt: deps.now(),
    module: deps.pack.meta.packId,
  };
  saveRegistry(deps.root, addCampaign(registry, entry));
  return entry;
}

/** `eshyra new [name...]` — create and register a campaign. */
export function runNewCommand(args: string[], deps: CampaignDeps): number {
  const name = args.join(' ').trim() || 'Campaign';
  try {
    const entry = createManagedCampaign(name, deps);
    deps.log(
      `Created campaign '${entry.name}' (id: ${entry.id}) at ${entry.dbPath}`,
    );
    deps.log(`Play it with: eshyra play ${entry.id}`);
    return 0;
  } catch (err) {
    deps.log(`could not create campaign: ${(err as Error).message}`);
    return 1;
  }
}

function describeEntry(entry: CampaignRegistryEntry): string {
  const played = entry.lastPlayedAt
    ? `last played ${entry.lastPlayedAt}`
    : 'never played';
  return `${entry.id}  —  ${entry.name}  (${played})`;
}

/** `eshyra campaigns list` — print every registered campaign. */
function runList(deps: CampaignDeps): number {
  const registry = loadRegistry(deps.root);
  if (registry.campaigns.length === 0) {
    deps.log('No campaigns registered. Create one with: eshyra new <name>');
    return 0;
  }
  deps.log(`Registered campaigns (${registry.campaigns.length}):`);
  for (const entry of registry.campaigns) {
    deps.log(`  ${describeEntry(entry)}`);
  }
  return 0;
}

/** `eshyra campaigns add <path> [name...]` — register an external DB. */
function runAdd(args: string[], deps: CampaignDeps): number {
  const rawPath = args[0];
  if (!rawPath) {
    deps.log('usage: eshyra campaigns add <database-path> [name]');
    return 1;
  }
  const dbPath = resolve(rawPath);
  if (!existsSync(dbPath)) {
    deps.log(`no file at ${dbPath}`);
    return 1;
  }
  const name =
    args.slice(1).join(' ').trim() || basename(dbPath, extname(dbPath));
  ensureDataRoot(deps.root);
  const registry = loadRegistry(deps.root);
  if (registry.campaigns.some((c) => resolve(c.dbPath) === dbPath)) {
    deps.log('that database is already registered');
    return 1;
  }
  const entry: CampaignRegistryEntry = {
    id: uniqueId(name, registry),
    name,
    dbPath,
    createdAt: deps.now(),
  };
  saveRegistry(deps.root, addCampaign(registry, entry));
  deps.log(`Registered campaign '${entry.name}' (id: ${entry.id})`);
  return 0;
}

/**
 * `eshyra campaigns remove <id>` — unregister a campaign. The database
 * file is left on disk; only the registry pointer is dropped.
 */
function runRemove(args: string[], deps: CampaignDeps): number {
  const id = args[0];
  if (!id) {
    deps.log('usage: eshyra campaigns remove <id>');
    return 1;
  }
  const registry = loadRegistry(deps.root);
  if (!findCampaign(registry, id)) {
    deps.log(`no campaign with id '${id}'`);
    return 1;
  }
  saveRegistry(deps.root, removeCampaign(registry, id));
  deps.log(`Unregistered campaign '${id}'. Its database file was kept.`);
  return 0;
}

/** `eshyra campaigns rename <id> <new name...>` — change a display name. */
function runRename(args: string[], deps: CampaignDeps): number {
  const id = args[0];
  const name = args.slice(1).join(' ').trim();
  if (!id || !name) {
    deps.log('usage: eshyra campaigns rename <id> <new name>');
    return 1;
  }
  const registry = loadRegistry(deps.root);
  if (!findCampaign(registry, id)) {
    deps.log(`no campaign with id '${id}'`);
    return 1;
  }
  saveRegistry(
    deps.root,
    updateCampaign(registry, id, (entry) => ({ ...entry, name })),
  );
  deps.log(`Renamed campaign '${id}' to '${name}'`);
  return 0;
}

/**
 * Resolve a campaign database path non-interactively, for commands that act on
 * an existing campaign (checkpoints). `ESHYRA_DB_PATH` wins; then a named
 * registry campaign; then the sole registered campaign.
 */
export function resolveCampaignDbPath(
  root: string,
  opts: { explicitDbPath?: string; campaignId?: string },
): { ok: true; dbPath: string } | { ok: false; message: string } {
  if (opts.explicitDbPath) {
    return { ok: true, dbPath: opts.explicitDbPath };
  }
  const registry = loadRegistry(root);
  if (opts.campaignId) {
    const entry = findCampaign(registry, opts.campaignId);
    return entry
      ? { ok: true, dbPath: entry.dbPath }
      : {
          ok: false,
          message: `no campaign with id '${opts.campaignId}'. Run 'eshyra campaigns list'.`,
        };
  }
  if (registry.campaigns.length === 1) {
    return { ok: true, dbPath: registry.campaigns[0].dbPath };
  }
  if (registry.campaigns.length === 0) {
    return {
      ok: false,
      message: "no campaigns registered. Create one with 'eshyra new <name>'.",
    };
  }
  return {
    ok: false,
    message: 'several campaigns are registered — pass a campaign id.',
  };
}

/** `eshyra campaigns <subcommand>` dispatcher. */
export function runCampaignsCommand(
  args: string[],
  deps: CampaignDeps,
): number {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case 'list':
      return runList(deps);
    case 'add':
      return runAdd(rest, deps);
    case 'remove':
      return runRemove(rest, deps);
    case 'rename':
      return runRename(rest, deps);
    default:
      deps.log('usage: eshyra campaigns <list|add|remove|rename> ...');
      return subcommand === undefined ? 1 : 1;
  }
}

/** Prompt the player to choose from several campaigns. */
async function pickCampaign(
  registry: CampaignRegistry,
  deps: CampaignDeps,
  defaultCampaignId: string | undefined,
): Promise<CampaignRegistryEntry | undefined> {
  const entries = registry.campaigns;
  const defaultIndex = entries.findIndex((e) => e.id === defaultCampaignId);
  deps.io.write('Select a campaign:');
  entries.forEach((entry, i) => {
    const marker = i === defaultIndex ? ' (default)' : '';
    deps.io.write(`  ${i + 1}) ${describeEntry(entry)}${marker}`);
  });
  const hint =
    defaultIndex >= 0
      ? `1-${entries.length}, default ${defaultIndex + 1}`
      : `1-${entries.length}`;
  const answer = await deps.io.prompt(`Campaign [${hint}]: `);
  if (answer === undefined) {
    return undefined;
  }
  if (answer.length === 0) {
    return defaultIndex >= 0 ? entries[defaultIndex] : undefined;
  }
  const choice = Number.parseInt(answer, 10);
  if (!Number.isInteger(choice) || choice < 1 || choice > entries.length) {
    return undefined;
  }
  return entries[choice - 1];
}

/**
 * Resolve which registered campaign `eshyra play` should open when
 * `ESHYRA_DB_PATH` is not set:
 *
 *  - an explicit `campaignArg` selects that campaign by id;
 *  - an empty registry offers to create the first campaign;
 *  - a single campaign opens directly;
 *  - several campaigns go through the picker (honoring `defaultCampaignId`).
 *
 * On success the chosen entry's `lastPlayedAt` is stamped and persisted.
 */
export async function resolvePlayCampaign(
  deps: CampaignDeps,
  opts: { campaignArg?: string; defaultCampaignId?: string },
): Promise<PlayTarget> {
  const registry = loadRegistry(deps.root);

  let entry: CampaignRegistryEntry | undefined;
  if (opts.campaignArg) {
    entry = findCampaign(registry, opts.campaignArg);
    if (!entry) {
      return {
        ok: false,
        message: `no campaign with id '${opts.campaignArg}'. Run 'eshyra campaigns list'.`,
      };
    }
  } else if (registry.campaigns.length === 0) {
    const answer = await deps.io.prompt(
      'No campaigns yet. Create one now? [Y/n] ',
    );
    if (answer === undefined) {
      return {
        ok: false,
        message:
          "no campaigns registered. Create one with 'eshyra new <name>'.",
      };
    }
    if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
      return { ok: false, message: 'no campaign selected.' };
    }
    try {
      entry = createManagedCampaign('Campaign', deps);
      deps.io.write(`Created campaign '${entry.name}' (id: ${entry.id}).`);
    } catch (err) {
      return {
        ok: false,
        message: `could not create campaign: ${(err as Error).message}`,
      };
    }
  } else if (registry.campaigns.length === 1) {
    entry = registry.campaigns[0];
  } else {
    entry = await pickCampaign(registry, deps, opts.defaultCampaignId);
    if (!entry) {
      return { ok: false, message: 'no campaign selected.' };
    }
  }

  // Stamp the play time and persist. Reloaded so a picker-time create is kept.
  const stamped: CampaignRegistryEntry = {
    ...entry,
    lastPlayedAt: deps.now(),
  };
  saveRegistry(
    deps.root,
    updateCampaign(loadRegistry(deps.root), stamped.id, () => stamped),
  );
  return { ok: true, entry: stamped };
}
