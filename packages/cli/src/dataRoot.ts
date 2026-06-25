/**
 * Per-user Eshyra data root (ADR 0004).
 *
 * Eshyra keeps one managed directory per user holding the config file, the
 * campaign registry, managed campaign databases, installed rules packs, and the
 * managed Dolt binary cache. This module resolves that root and the paths
 * inside it; it is a pure path layer with one lazy `mkdir` helper and no other
 * I/O.
 *
 * Default location:
 *  - Windows: `%LOCALAPPDATA%\Eshyra` (the canonical per-user, non-roaming
 *    application-data location — campaign databases and the cached Dolt binary
 *    are large and machine-specific and must not be synced by roaming
 *    profiles).
 *  - macOS / Linux: `~/.eshyra`.
 *
 * `ESHYRA_HOME` overrides the default on every platform.
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

type Env = Record<string, string | undefined>;

/**
 * Resolve the per-user Eshyra data root. `platform` is injectable so the
 * Windows and POSIX branches are both testable on one host.
 */
export function resolveDataRoot(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = env.ESHYRA_HOME?.trim();
  if (override) {
    return override;
  }
  if (platform === 'win32') {
    const localAppData =
      env.LOCALAPPDATA?.trim() || join(homedir(), 'AppData', 'Local');
    return join(localAppData, 'Eshyra');
  }
  return join(homedir(), '.eshyra');
}

/** `<root>/config.json` — non-secret CLI preferences. */
export function configFilePath(root: string): string {
  return join(root, 'config.json');
}

/** `<root>/registry.json` — the known-campaign index. */
export function registryFilePath(root: string): string {
  return join(root, 'registry.json');
}

/** `<root>/campaigns` — managed campaign SQLite databases and their sidecars. */
export function campaignsDir(root: string): string {
  return join(root, 'campaigns');
}

/** `<root>/rules-packs` — installed (non-bundled) RPG rules packs. */
export function rulesPacksDir(root: string): string {
  return join(root, 'rules-packs');
}

/**
 * `<root>/adventure-modules` — installed adventure module packs, one per
 * subdirectory (each holding an `adventure-module.json`). The subdirectory is
 * the path-safe form of the module id (module ids may be `:`-namespaced, which
 * is illegal in a Windows path). Mirrors the `rules-packs` convention; the
 * adventure audit resolves module source from here. Population of first-party
 * modules is later eh54 work (eshyra-eh54.7).
 */
export function adventureModulesDir(root: string): string {
  return join(root, 'adventure-modules');
}

/** `<root>/dolt` — the managed Dolt binary cache. */
export function doltCacheDir(root: string): string {
  return join(root, 'dolt');
}

/** `<root>/debug` — opt-in per-session debug artifacts (eshyra-iu18). */
export function debugDir(root: string): string {
  return join(root, 'debug');
}

/**
 * `<root>/drafts/characters` — resumable guided-character-creation drafts, one
 * JSON file per draft id (eshyra-b69j.10). Drafts are pre-finalization
 * work-in-progress and live outside the campaign databases.
 */
export function characterDraftsDir(root: string): string {
  return join(root, 'drafts', 'characters');
}

/** `<root>/diagnostics` — model usage and diagnostics store (eshyra-cuxm). */
export function diagnosticsDir(root: string): string {
  return join(root, 'diagnostics');
}

/**
 * Create the data root and its managed subdirectories if they are absent.
 * Idempotent (recursive `mkdir`), and called lazily — only on a command that
 * writes managed data, never on a bare banner run. The Dolt cache is created
 * by the Dolt installer when it is actually needed, so it is not created here.
 */
export function ensureDataRoot(root: string): void {
  mkdirSync(campaignsDir(root), { recursive: true });
  mkdirSync(rulesPacksDir(root), { recursive: true });
}
