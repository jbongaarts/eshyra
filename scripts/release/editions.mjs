// Distribution editions for the self-contained GitHub Release CLI artifact.
//
// Decision: ADR 0011 (bead eshyra-7zhm). Eshyra supports more than one gameplay
// provider, and each agent-harness provider ships a large per-platform CLI
// binary through its SDK's npm `optionalDependencies` (the Claude Agent SDK
// vendors the Claude Code CLI; the Codex SDK vendors the `@openai/codex` CLI).
// Bundling every provider binary into one archive is wasteful, so we publish
// per-EDITION self-contained archives and let the one-line installer pick one.
//
// An edition is a named subset of the *optional provider packages* that get
// installed into the packed `app/node_modules` tree:
//
//   api    — lean: api-native SDKs only, NO agent CLI binary (smallest).
//   claude — Node + the Claude Agent SDK (≈ today's artifact).
//   codex  — Node + the Codex CLI binary.
//   full   — Node + both agent binaries.
//
// The api-native SDKs (`@anthropic-ai/sdk`, an OpenAI SDK) are ordinary, small
// `dependencies` with no CLI binary, so they ship in EVERY edition and are not
// listed here. Only the heavy, provider-specific agent SDKs are gated, and they
// are declared as `optionalDependencies` in packages/core/package.json so the
// production install can omit them and re-add exactly the edition's subset.
//
// This module is the single source of truth for the edition catalogue. The
// build script (build-release-artifact.mjs), the validator, and the release
// workflow matrix all derive from it so they can never drift.

/**
 * The npm package names of the heavy, per-edition agent SDKs. These are the
 * packages that carry a large vendored CLI binary via their own
 * optionalDependencies. The build script gates these on/off per edition; every
 * other production dependency ships in all editions.
 *
 * NOTE (coordination with bead eshyra-jl8n / the adapter stream): the adapter
 * stream owns adding `@openai/codex-sdk` to packages/core/package.json and
 * (per ADR 0011) moving these agent SDKs into `optionalDependencies`. This
 * catalogue names the packages independently of which dependency block they
 * live in; the build script resolves the actual install targets by intersecting
 * this list with the dependency sets declared in package.json, so it tolerates
 * the package being absent (edition simply ships without it) until the adapter
 * stream lands the dep.
 */
const AGENT_SDK_PACKAGES = {
  claude: '@anthropic-ai/claude-agent-sdk',
  codex: '@openai/codex-sdk',
};

/**
 * What to actually delete from the staged tree when a provider is excluded.
 *
 * The heavy weight is NOT the JS wrapper in {@link AGENT_SDK_PACKAGES} — it is
 * the per-platform CLI binary each wrapper pulls through ITS OWN
 * `optionalDependencies` (e.g. `@anthropic-ai/claude-agent-sdk-linux-x64` is
 * ~223 MB; the wrapper itself is ~3.6 MB). The Codex wrapper additionally pulls
 * a launcher package (`@openai/codex`) plus its own `@openai/codex-<platform>`
 * binary. Pruning only the wrapper saves almost nothing, so each provider key
 * maps to a matcher over the FULL npm package name (`@scope/name`) covering the
 * wrapper AND every binary/launcher sibling it brings in. The build walks every
 * `node_modules` in the stage (npm may nest these under `@eshyra/core`) and
 * removes each directory whose package name matches.
 */
const AGENT_SDK_REMOVAL = {
  claude: (name) =>
    name === '@anthropic-ai/claude-agent-sdk' ||
    name.startsWith('@anthropic-ai/claude-agent-sdk-'),
  codex: (name) =>
    name === '@openai/codex-sdk' ||
    name === '@openai/codex' ||
    name.startsWith('@openai/codex-'),
};

/**
 * Does any excluded provider's removal matcher claim this `@scope/name` package?
 * `excludedKeys` are AGENT_SDK_PACKAGES keys (e.g. `['claude']`).
 */
function isRemovablePackage(packageName, excludedKeys) {
  return excludedKeys.some((key) => AGENT_SDK_REMOVAL[key]?.(packageName));
}

/**
 * The edition catalogue. `optionalProviders` lists the AGENT_SDK_PACKAGES keys
 * (NOT the raw npm names) the edition includes. The `default` flag marks the
 * single edition the installer selects when none is requested — kept here so the
 * builder, installers, and docs share one named default.
 */
const EDITIONS = {
  api: {
    optionalProviders: [],
    summary: 'lean: api-native SDKs only, no bundled agent CLI binary',
  },
  claude: {
    optionalProviders: ['claude'],
    summary: 'Claude Agent SDK (Claude Code CLI) bundled',
    default: true,
  },
  codex: {
    optionalProviders: ['codex'],
    summary: 'Codex SDK (@openai/codex CLI) bundled',
  },
  full: {
    optionalProviders: ['claude', 'codex'],
    summary: 'both the Claude Agent SDK and the Codex CLI bundled',
  },
};

/** Stable, deterministic list of edition names (catalogue insertion order). */
const EDITION_NAMES = Object.keys(EDITIONS);

/**
 * The single default edition. Centralized so install.sh, install.ps1, the build
 * matrix, and the docs cannot disagree about which edition is selected when the
 * user does not ask for one. `claude` preserves today's artifact behavior.
 */
const DEFAULT_EDITION =
  EDITION_NAMES.find((name) => EDITIONS[name].default) ?? 'claude';

/** True when `name` is a known edition. */
function isEdition(name) {
  return Object.hasOwn(EDITIONS, name);
}

/**
 * Resolve the npm package names an edition includes among AGENT_SDK_PACKAGES.
 * Throws on an unknown edition so a typo in CI or the installer fails loudly.
 */
function editionPackages(edition) {
  if (!isEdition(edition)) {
    throw new Error(
      `unknown edition: "${edition}" (known: ${EDITION_NAMES.join(', ')})`,
    );
  }
  return EDITIONS[edition].optionalProviders.map(
    (key) => AGENT_SDK_PACKAGES[key],
  );
}

/**
 * The provider keys an edition EXCLUDES (the complement of its
 * `optionalProviders` within the catalogue) — i.e. the providers whose packages
 * must be pruned from this edition's staged tree. Throws on an unknown edition.
 */
function excludedProviderKeys(edition) {
  if (!isEdition(edition)) {
    throw new Error(
      `unknown edition: "${edition}" (known: ${EDITION_NAMES.join(', ')})`,
    );
  }
  const included = new Set(EDITIONS[edition].optionalProviders);
  return Object.keys(AGENT_SDK_PACKAGES).filter((key) => !included.has(key));
}

export {
  AGENT_SDK_PACKAGES,
  AGENT_SDK_REMOVAL,
  DEFAULT_EDITION,
  EDITION_NAMES,
  EDITIONS,
  editionPackages,
  excludedProviderKeys,
  isEdition,
  isRemovablePackage,
};
