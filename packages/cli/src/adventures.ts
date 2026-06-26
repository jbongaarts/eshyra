/**
 * `eshyra adventures` command (eshyra-eh54.6).
 *
 * A read-only inspector over a campaign's adventure module state. It prints the
 * structured audit produced by the core `buildCampaignAdventureAudit`, which
 * separates the four easily-conflated layers (ADR 0012): immutable source
 * module, the campaign-owned adventure run / module binding, mutable progress /
 * deviations, and the bounded runtime context slice the DM receives.
 *
 * Module SOURCE is resolved from `<root>/adventure-modules/<dirName>/`, where
 * `<dirName>` is the path-safe form of the module id (module ids may be
 * namespaced with `:` per eshyra-eh54.2, which is illegal in a Windows path, so
 * any path-unsafe character is mapped to `_`). When a module is absent the audit
 * still reports the binding and mutable progress; only the source summary and
 * runtime slice are omitted. The directory name is derived from the module id
 * via the shared `adventureModuleDirName` convention, so a namespaced id
 * resolves to the same directory the fixture installs under. The active campaign
 * database is opened read-only-in-spirit: this command never writes to it.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AdventureModule,
  adventureModuleDirName,
  buildCampaignAdventureAudit,
  type Db,
  formatCampaignAdventureAudit,
  getCampaign,
  loadAdventureModuleFromDir,
  openDatabase,
} from '@eshyra/core';
import { resolveCampaignDbPath } from './campaigns.js';
import { adventureModulesDir } from './dataRoot.js';

/** Host seam for the adventures command. */
export interface AdventuresDeps {
  /** The resolved per-user data root (registry lookup + module source). */
  root: string;
  /** Environment map — read for the `ESHYRA_DB_PATH` explicit override. */
  env: Record<string, string | undefined>;
  /** Output sink. */
  log: (message: string) => void;
  /** Open a campaign database at a path. Injectable for tests. */
  openDb?: (path: string) => Db;
}

/**
 * Build a module-source resolver over `<root>/adventure-modules/<dirName>/`,
 * where `<dirName>` is `adventureModuleDirName(moduleId)` — the shared core
 * convention, so a namespaced id resolves to the same directory the fixture
 * installs under. Missing or unparseable modules resolve to `undefined` (the
 * audit degrades) rather than throwing, so an inspection never fails because a
 * pack is absent.
 */
function makeModuleResolver(
  root: string,
): (moduleId: string) => AdventureModule | undefined {
  const cache = new Map<string, AdventureModule | undefined>();
  return (moduleId) => {
    if (cache.has(moduleId)) {
      return cache.get(moduleId);
    }
    const dir = join(
      adventureModulesDir(root),
      adventureModuleDirName(moduleId),
    );
    let module: AdventureModule | undefined;
    if (existsSync(dir)) {
      try {
        module = loadAdventureModuleFromDir(dir);
      } catch {
        module = undefined;
      }
    }
    cache.set(moduleId, module);
    return module;
  };
}

/** `eshyra adventures [campaign-id]` — print the adventure audit. */
function runShow(rest: string[], deps: AdventuresDeps): number {
  const resolved = resolveCampaignDbPath(deps.root, {
    explicitDbPath: deps.env.ESHYRA_DB_PATH?.trim() || undefined,
    campaignId: rest[0],
  });
  if (!resolved.ok) {
    deps.log(resolved.message);
    return 1;
  }
  const open = deps.openDb ?? openDatabase;
  const db = open(resolved.dbPath);
  try {
    const campaign = getCampaign(db);
    if (campaign === undefined) {
      deps.log('that database has no campaign — nothing to audit.');
      return 1;
    }
    const audit = buildCampaignAdventureAudit(db, {
      campaignId: campaign.campaignId,
      resolveAdventureModule: makeModuleResolver(deps.root),
    });
    deps.log(formatCampaignAdventureAudit(audit));
    return 0;
  } catch (err) {
    deps.log(`could not audit adventures: ${(err as Error).message}`);
    return 1;
  } finally {
    db.close();
  }
}

/** `eshyra adventures <show|...>` dispatcher. */
export function runAdventuresCommand(
  args: string[],
  deps: AdventuresDeps,
): number {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case undefined:
    case 'show':
      return runShow(rest, deps);
    default:
      // Treat a bare id as `show <id>` so `eshyra adventures my-campaign` works.
      return runShow(args, deps);
  }
}
