// Bounded adventure-module context slice (eshyra-eh54.5).
//
// Composes the immutable adventure module source (eshyra-eh54.2/.3) with the
// campaign-owned adventure run / module binding progress (eshyra-eh54.4) into a
// small, situation-relevant slice for the DM runtime. The whole point is to
// guide the DM with the authored scenario WITHOUT dumping the entire module
// every turn: the slice is scoped to the campaign's current scene/location and
// to live pressures (clocks, objectives, secrets) that are still in play.
//
// Hard rule (ADR 0012): the module source is read-only and campaign truth wins.
// Where the campaign progress and the authored module disagree — a resolved
// encounter, a revealed secret, a completed objective, an advanced clock, an
// explicit deviation — the campaign state overrides the authored assumption.
// This module never mutates either input.

import type {
  AdventureEncounterCreature,
  AdventureLocation,
  AdventureModule,
  AdventureScene,
  SceneKind,
} from '../adventure/types.js';
import type {
  AdventureEncounterOutcome,
  AdventureModuleDeviation,
  AdventureRun,
  AdventureRunStatus,
  EncounterResolution,
} from '../campaign/adventureRun.js';

export type AdventureObjectiveStatus = 'active' | 'completed' | 'failed';

/** An authored objective with the campaign's current status applied. */
export interface AdventureObjectiveContext {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly optional: boolean;
  readonly successCondition: string;
  readonly failureCondition: string | undefined;
  readonly status: AdventureObjectiveStatus;
}

/** An exit from the current location, annotated with where it leads. */
export interface AdventureExitContext {
  readonly direction: string;
  readonly toLocationId: string;
  readonly toLocationName: string | undefined;
  readonly requirement: string | undefined;
  /** Whether the campaign has already visited the destination. */
  readonly toLocationVisited: boolean;
}

export interface AdventureLocationContext {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly visited: boolean;
  readonly exits: readonly AdventureExitContext[];
}

/** A scenario NPC. The DM-only `secret` is included because the entire slice is
 * DM-facing context, never narrated verbatim. */
export interface AdventureNpcContext {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly disposition: string;
  readonly summary: string;
  readonly secret: string;
}

/** A pending encounter (no recorded outcome) relevant to the current beat. */
export interface AdventureEncounterContext {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly locationId: string | undefined;
  readonly creatures: readonly AdventureEncounterCreature[];
  readonly reward: string;
}

/** A clock/threat with the campaign's live fill applied to the authored shape. */
export interface AdventureClockContext {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly segments: number;
  /** Campaign-owned live fill (0 when the campaign has not advanced it). */
  readonly filled: number;
  readonly advanceWhen: string;
  readonly resultWhenFilled: string;
  readonly linkedObjectiveId: string | undefined;
}

/** An unrevealed secret revealable in the current situation (DM-only). */
export interface AdventureSecretContext {
  readonly id: string;
  readonly title: string;
  readonly dmText: string;
}

export interface AdventureSceneContext {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly kind: SceneKind;
}

/** Compact roll-up of module elements the campaign has already resolved. */
export interface AdventureCompletedElements {
  readonly scenes: readonly string[];
  readonly objectives: readonly string[];
  readonly failedObjectives: readonly string[];
  readonly revealedSecrets: readonly string[];
  readonly claimedTreasure: readonly string[];
  readonly resolvedEncounters: readonly AdventureEncounterOutcome[];
}

/**
 * The bounded slice handed to the DM runtime for one active adventure run. Only
 * current-situation-relevant authored content is included; resolved/revealed/
 * completed elements are filtered out of the live lists and summarized in
 * {@link AdventureContextSlice.completed} instead.
 */
export interface AdventureContextSlice {
  readonly moduleId: string;
  readonly moduleTitle: string;
  readonly runId: string;
  readonly runStatus: AdventureRunStatus;
  /** Opening framing, present only for a fresh run with no recorded progress. */
  readonly startingSituation: string | undefined;
  readonly currentScene: AdventureSceneContext | undefined;
  readonly currentLocation: AdventureLocationContext | undefined;
  readonly nearbyLocations: readonly AdventureLocationContext[];
  readonly relevantNpcs: readonly AdventureNpcContext[];
  readonly activeObjectives: readonly AdventureObjectiveContext[];
  readonly pendingEncounters: readonly AdventureEncounterContext[];
  readonly activeClocks: readonly AdventureClockContext[];
  readonly unrevealedSecrets: readonly AdventureSecretContext[];
  readonly completed: AdventureCompletedElements;
  /** Campaign-recorded divergences from authored assumptions (campaign truth). */
  readonly deviations: readonly AdventureModuleDeviation[];
}

export interface BuildAdventureContextOptions {
  /**
   * The campaign's live current location (campaign truth, e.g. from the clock).
   * Used to seat the slice; when it resolves to a module location it overrides
   * any scene-derived guess.
   */
  readonly currentLocationId?: string;
}

function indexById<T extends { readonly id: string }>(
  items: readonly T[],
): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(item.id, item);
  }
  return map;
}

function hasAnyProgress(run: AdventureRun): boolean {
  const p = run.progress;
  return (
    p.visitedLocations.length > 0 ||
    p.completedOrBypassedScenes.length > 0 ||
    p.revealedSecrets.length > 0 ||
    p.completedObjectives.length > 0 ||
    p.failedObjectives.length > 0 ||
    p.encounterOutcomes.length > 0 ||
    p.claimedTreasure.length > 0 ||
    p.activeClocks.length > 0 ||
    p.deviations.length > 0
  );
}

/**
 * Pick the campaign's current scene. Campaign truth drives the choice and is
 * never overridden by an authored fallback:
 *
 * - When the caller supplies live location truth (`hasLocationTruth`), the scene
 *   must belong to that location. If the live location resolves to a module
 *   location with an unfinished scene, that scene is current; if it has no
 *   unfinished scene, or the live location is outside the module's keyed space
 *   (does not resolve), there is NO current scene — we never seat the party at a
 *   different location's scene or at the authored start as though they were
 *   there.
 * - Only when the caller supplies no location truth at all (a fresh or
 *   location-unknown run) do we fall back to the authored `startingSceneId` (for
 *   a run with no completed scenes) or the next unfinished scene.
 */
function pickCurrentScene(
  module: AdventureModule,
  completedScenes: ReadonlySet<string>,
  currentLocation: AdventureLocation | undefined,
  hasLocationTruth: boolean,
): AdventureScene | undefined {
  if (hasLocationTruth) {
    // The party's location is known. A scene is only "current" if it is staged
    // at that location and still unfinished; otherwise leave it undefined.
    if (currentLocation === undefined) {
      return undefined;
    }
    return module.scenes.find(
      (s) =>
        !completedScenes.has(s.id) &&
        s.locationIds.includes(currentLocation.id),
    );
  }
  // No live location truth: fall back to the authored start, then the next
  // unfinished scene.
  if (completedScenes.size === 0) {
    const starting = module.scenes.find((s) => s.id === module.startingSceneId);
    if (starting !== undefined) {
      return starting;
    }
  }
  return module.scenes.find((s) => !completedScenes.has(s.id));
}

function toLocationContext(
  location: AdventureLocation,
  visited: ReadonlySet<string>,
  locationsById: ReadonlyMap<string, AdventureLocation>,
): AdventureLocationContext {
  return {
    id: location.id,
    name: location.name,
    summary: location.summary,
    visited: visited.has(location.id),
    exits: location.exits.map((exit) => ({
      direction: exit.direction,
      toLocationId: exit.toLocationId,
      toLocationName: locationsById.get(exit.toLocationId)?.name,
      requirement: exit.requirement,
      toLocationVisited: visited.has(exit.toLocationId),
    })),
  };
}

/**
 * Build the bounded adventure context slice for one active run by composing the
 * immutable module source with the campaign's recorded progress. Pure: neither
 * the module nor the run is mutated.
 */
export function buildAdventureContextSlice(
  module: AdventureModule,
  run: AdventureRun,
  options: BuildAdventureContextOptions = {},
): AdventureContextSlice {
  const progress = run.progress;
  const completedScenes = new Set(progress.completedOrBypassedScenes);
  const visited = new Set(progress.visitedLocations);
  const completedObjectives = new Set(progress.completedObjectives);
  const failedObjectives = new Set(progress.failedObjectives);
  const revealedSecrets = new Set(progress.revealedSecrets);
  const encounterOutcomeById = new Map(
    progress.encounterOutcomes.map((o) => [o.encounterId, o]),
  );
  const clockFillById = new Map(
    progress.activeClocks.map((c) => [c.clockId, c.filled]),
  );

  const locationsById = indexById(module.locations);

  // Whether the caller asserted the party's live location (campaign truth). When
  // asserted, it governs scene selection even if it does not resolve to a keyed
  // module location — we must not silently seat the party elsewhere.
  const liveLocationId = options.currentLocationId;
  const hasLocationTruth = liveLocationId !== undefined;
  const liveLocation =
    liveLocationId !== undefined
      ? locationsById.get(liveLocationId)
      : undefined;

  const currentScene = pickCurrentScene(
    module,
    completedScenes,
    liveLocation,
    hasLocationTruth,
  );

  // Seat the slice at the live location when it resolves; otherwise fall back to
  // the current scene's first declared location.
  let currentLocation = liveLocation;
  if (currentLocation === undefined && currentScene !== undefined) {
    for (const id of currentScene.locationIds) {
      const loc = locationsById.get(id);
      if (loc !== undefined) {
        currentLocation = loc;
        break;
      }
    }
  }

  // NPCs: those wired into the current scene, plus any standing at the current
  // location. Union, de-duped, in module order.
  const npcIds = new Set<string>();
  if (currentScene !== undefined) {
    for (const id of currentScene.npcIds) {
      npcIds.add(id);
    }
  }
  if (currentLocation !== undefined) {
    for (const npc of module.npcs) {
      if (npc.locationId === currentLocation.id) {
        npcIds.add(npc.id);
      }
    }
  }
  const relevantNpcs: AdventureNpcContext[] = module.npcs
    .filter((n) => npcIds.has(n.id))
    .map((n) => ({
      id: n.id,
      name: n.name,
      role: n.role,
      disposition: n.disposition,
      summary: n.summary,
      secret: n.secret,
    }));

  // Objectives: those wired into the current scene or related to it / the
  // current location, restricted to those still active (campaign truth).
  const objectiveIds = new Set<string>();
  if (currentScene !== undefined) {
    for (const id of currentScene.objectiveIds) {
      objectiveIds.add(id);
    }
  }
  for (const obj of module.objectives) {
    const relatedToScene =
      currentScene !== undefined &&
      obj.relatedSceneIds.includes(currentScene.id);
    const relatedToLocation =
      currentLocation !== undefined &&
      obj.relatedLocationIds.includes(currentLocation.id);
    if (relatedToScene || relatedToLocation) {
      objectiveIds.add(obj.id);
    }
  }
  const activeObjectives: AdventureObjectiveContext[] = module.objectives
    .filter(
      (o) =>
        objectiveIds.has(o.id) &&
        !completedObjectives.has(o.id) &&
        !failedObjectives.has(o.id),
    )
    .map((o) => ({
      id: o.id,
      title: o.title,
      description: o.description,
      optional: o.optional,
      successCondition: o.successCondition,
      failureCondition: o.failureCondition,
      status: 'active' as const,
    }));

  // Encounters: those wired into the current scene or staged at the current
  // location, restricted to those without a recorded outcome (still pending).
  const encounterIds = new Set<string>();
  if (currentScene !== undefined) {
    for (const id of currentScene.encounterIds) {
      encounterIds.add(id);
    }
  }
  if (currentLocation !== undefined) {
    for (const enc of module.encounters) {
      if (enc.locationId === currentLocation.id) {
        encounterIds.add(enc.id);
      }
    }
  }
  const pendingEncounters: AdventureEncounterContext[] = module.encounters
    .filter((e) => encounterIds.has(e.id) && !encounterOutcomeById.has(e.id))
    .map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      locationId: e.locationId,
      creatures: e.creatures,
      reward: e.reward,
    }));

  // Secrets: unrevealed secrets revealable at the current scene or location.
  const secretIds = new Set<string>();
  if (currentScene !== undefined) {
    for (const id of currentScene.secretIds) {
      secretIds.add(id);
    }
  }
  for (const secret of module.secrets) {
    const here =
      (currentScene !== undefined &&
        secret.revealableSceneIds.includes(currentScene.id)) ||
      (currentLocation !== undefined &&
        secret.revealableLocationIds.includes(currentLocation.id));
    if (here) {
      secretIds.add(secret.id);
    }
  }
  const unrevealedSecrets: AdventureSecretContext[] = module.secrets
    .filter((s) => secretIds.has(s.id) && !revealedSecrets.has(s.id))
    .map((s) => ({ id: s.id, title: s.title, dmText: s.dmText }));

  // Nearby locations: the destinations of the current location's exits.
  const nearbyLocations: AdventureLocationContext[] = [];
  if (currentLocation !== undefined) {
    const seen = new Set<string>();
    for (const exit of currentLocation.exits) {
      if (seen.has(exit.toLocationId)) {
        continue;
      }
      seen.add(exit.toLocationId);
      const dest = locationsById.get(exit.toLocationId);
      if (dest !== undefined) {
        nearbyLocations.push(toLocationContext(dest, visited, locationsById));
      }
    }
  }

  // Clocks/threats: all authored clocks with the campaign's live fill applied.
  // These are global pressures (typically few) and stay in the slice regardless
  // of scene so the DM can keep advancing them.
  const activeClocks: AdventureClockContext[] = module.clocksOrThreats.map(
    (c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      segments: c.segments,
      filled: clockFillById.get(c.id) ?? 0,
      advanceWhen: c.advanceWhen,
      resultWhenFilled: c.resultWhenFilled,
      linkedObjectiveId: c.linkedObjectiveId,
    }),
  );

  const completed: AdventureCompletedElements = {
    scenes: progress.completedOrBypassedScenes,
    objectives: progress.completedObjectives,
    failedObjectives: progress.failedObjectives,
    revealedSecrets: progress.revealedSecrets,
    claimedTreasure: progress.claimedTreasure,
    resolvedEncounters: progress.encounterOutcomes,
  };

  return {
    moduleId: module.id,
    moduleTitle: module.title,
    runId: run.runId,
    runStatus: run.status,
    startingSituation: hasAnyProgress(run)
      ? undefined
      : module.startingSituation,
    currentScene:
      currentScene === undefined
        ? undefined
        : {
            id: currentScene.id,
            title: currentScene.title,
            summary: currentScene.summary,
            kind: currentScene.kind,
          },
    currentLocation:
      currentLocation === undefined
        ? undefined
        : toLocationContext(currentLocation, visited, locationsById),
    nearbyLocations,
    relevantNpcs,
    activeObjectives,
    pendingEncounters,
    activeClocks,
    unrevealedSecrets,
    completed,
    deviations: progress.deviations,
  };
}

const RESOLUTION_LABEL: Record<EncounterResolution, string> = {
  defeated: 'defeated',
  bypassed: 'bypassed',
  fled: 'fled',
  negotiated: 'negotiated',
  other: 'resolved',
};

/**
 * Render one adventure context slice into the DM-only Markdown section. Kept
 * compact: empty groups are dropped so the slice never balloons the prompt.
 */
export function renderAdventureContextSlice(
  slice: AdventureContextSlice,
): string {
  const lines: string[] = [
    `### Adventure: ${slice.moduleTitle} (${slice.moduleId})`,
  ];
  if (slice.runStatus !== 'active') {
    lines.push(`Run status: ${slice.runStatus}.`);
  }
  if (slice.startingSituation !== undefined) {
    lines.push(`Starting situation: ${slice.startingSituation}`);
  }
  if (slice.currentScene !== undefined) {
    const sc = slice.currentScene;
    lines.push(`Current scene: ${sc.title} [${sc.kind}] — ${sc.summary}`);
  }
  if (slice.currentLocation !== undefined) {
    const loc = slice.currentLocation;
    const visited = loc.visited ? ' (visited)' : '';
    lines.push(`Current location: ${loc.name}${visited} — ${loc.summary}`);
  }
  if (slice.nearbyLocations.length > 0 || slice.currentLocation !== undefined) {
    const exits = slice.currentLocation?.exits ?? [];
    if (exits.length > 0) {
      const exitText = exits
        .map((e) => {
          const dest = e.toLocationName ?? e.toLocationId;
          const req = e.requirement ? ` [requires: ${e.requirement}]` : '';
          const seen = e.toLocationVisited ? ' (visited)' : '';
          return `${e.direction} → ${dest}${seen}${req}`;
        })
        .join('; ');
      lines.push(`Exits: ${exitText}`);
    }
  }
  if (slice.relevantNpcs.length > 0) {
    lines.push('Relevant NPCs:');
    for (const npc of slice.relevantNpcs) {
      lines.push(
        `- ${npc.name} (${npc.role}, ${npc.disposition}): ${npc.summary} — DM-only: ${npc.secret}`,
      );
    }
  }
  if (slice.activeObjectives.length > 0) {
    lines.push('Active objectives:');
    for (const obj of slice.activeObjectives) {
      const optional = obj.optional ? ' (optional)' : '';
      lines.push(`- ${obj.title}${optional}: ${obj.successCondition}`);
    }
  }
  if (slice.pendingEncounters.length > 0) {
    lines.push('Pending encounters:');
    for (const enc of slice.pendingEncounters) {
      const creatures = enc.creatures
        .map((c) => `${c.count}× ${c.rulesRef}`)
        .join(', ');
      const where = enc.locationId ? ` @ ${enc.locationId}` : '';
      const creatureText = creatures.length > 0 ? ` [${creatures}]` : '';
      lines.push(`- ${enc.name}${where}: ${enc.description}${creatureText}`);
    }
  }
  if (slice.activeClocks.length > 0) {
    lines.push('Clocks/threats:');
    for (const clock of slice.activeClocks) {
      lines.push(
        `- ${clock.name}: ${clock.filled}/${clock.segments} — advances when ${clock.advanceWhen}; at full: ${clock.resultWhenFilled}`,
      );
    }
  }
  if (slice.unrevealedSecrets.length > 0) {
    lines.push('Unrevealed secrets (DM-only):');
    for (const secret of slice.unrevealedSecrets) {
      lines.push(`- ${secret.title}: ${secret.dmText}`);
    }
  }
  if (slice.deviations.length > 0) {
    lines.push('Campaign deviations (override module assumptions):');
    for (const dev of slice.deviations) {
      lines.push(`- ${dev.description}`);
    }
  }
  const completedBits: string[] = [];
  if (slice.completed.scenes.length > 0) {
    completedBits.push(`scenes: ${slice.completed.scenes.join(', ')}`);
  }
  if (slice.completed.objectives.length > 0) {
    completedBits.push(`objectives: ${slice.completed.objectives.join(', ')}`);
  }
  if (slice.completed.failedObjectives.length > 0) {
    completedBits.push(
      `failed objectives: ${slice.completed.failedObjectives.join(', ')}`,
    );
  }
  if (slice.completed.resolvedEncounters.length > 0) {
    const enc = slice.completed.resolvedEncounters
      .map((o) => `${o.encounterId} (${RESOLUTION_LABEL[o.outcome]})`)
      .join(', ');
    completedBits.push(`encounters: ${enc}`);
  }
  if (slice.completed.revealedSecrets.length > 0) {
    completedBits.push(
      `revealed secrets: ${slice.completed.revealedSecrets.join(', ')}`,
    );
  }
  if (slice.completed.claimedTreasure.length > 0) {
    completedBits.push(
      `claimed treasure: ${slice.completed.claimedTreasure.join(', ')}`,
    );
  }
  if (completedBits.length > 0) {
    lines.push(`Already resolved — ${completedBits.join('; ')}.`);
  }
  return lines.join('\n');
}
