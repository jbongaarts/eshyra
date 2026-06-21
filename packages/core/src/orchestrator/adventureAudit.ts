// Adventure module progress audit/debug output (eshyra-eh54.5 -> eshyra-eh54.6).
//
// Module support is hard to debug from narration alone: the model can appear to
// forget the adventure, reveal a secret too early, repeat a completed scene, or
// ignore a player-driven deviation, and none of that is visible in the prose.
// This module makes the invisible inspectable, in the spirit of the SRD audit
// tooling (`rules/srdAudit.ts`). It deliberately separates the FOUR things that
// are easy to conflate (ADR 0012):
//
//   1. Immutable source module content (the authored scenario).
//   2. The campaign-owned adventure run / module binding (which module is
//      active, its status, and session markers).
//   3. Mutable progress and deviations (visited, revealed, completed, bypassed,
//      claimed, active clocks, explicit deviations).
//   4. The bounded runtime context slice the DM actually receives (eshyra-eh54.5).
//
// This is a read-only inspector: it never mutates the campaign or the module.

import type { AdventureModule } from '../adventure/types.js';
import type {
  AdventureRun,
  AdventureRunProgress,
} from '../campaign/adventureRun.js';
import { listAdventureRuns } from '../campaign/adventureRun.js';
import type { Db } from '../persistence/db.js';
import type { AdventureContextSlice } from './adventureContext.js';
import {
  buildAdventureContextSlice,
  renderAdventureContextSlice,
} from './adventureContext.js';
import type { AdventureModuleResolver } from './contextAssembler.js';

/** Authored-source counts and identity for one module (section 1). */
export interface AdventureModuleSourceSummary {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly startingSceneId: string;
  readonly counts: {
    readonly scenes: number;
    readonly locations: number;
    readonly npcs: number;
    readonly objectives: number;
    readonly encounters: number;
    readonly secrets: number;
    readonly treasure: number;
    readonly clocks: number;
  };
}

/** Revealed vs unrevealed secrets, resolved against module source (section 3). */
export interface AdventureSecretAuditView {
  readonly revealed: readonly string[];
  readonly unrevealed: readonly string[];
  /** Revealed ids that are not authored secrets in the module (drift signal). */
  readonly unknownRevealed: readonly string[];
}

/** Objective status against the authored objective set (section 3). */
export interface AdventureObjectiveAuditView {
  readonly completed: readonly string[];
  readonly failed: readonly string[];
  /** Authored objective ids that are neither completed nor failed. */
  readonly remaining: readonly string[];
}

/** The full audit view for one campaign-owned adventure run / module binding. */
export interface AdventureRunAudit {
  // 2. Binding.
  readonly runId: string;
  readonly moduleId: string;
  readonly status: AdventureRun['status'];
  readonly startedAtSessionId: string | undefined;
  readonly completedAtSessionId: string | undefined;
  readonly notes: string;
  /** Whether the resolver supplied the immutable module source. */
  readonly moduleResolved: boolean;
  // 1. Source (when resolved).
  readonly source: AdventureModuleSourceSummary | undefined;
  // 3. Mutable progress (raw) plus derived views.
  readonly progress: AdventureRunProgress;
  readonly secrets: AdventureSecretAuditView | undefined;
  readonly objectives: AdventureObjectiveAuditView | undefined;
  // 4. Bounded runtime context slice (when resolved).
  readonly contextSlice: AdventureContextSlice | undefined;
}

export interface CampaignAdventureAudit {
  readonly campaignId: string;
  /** Live current location (campaign truth from the clock), when set. */
  readonly currentLocationId: string | undefined;
  readonly runs: readonly AdventureRunAudit[];
}

export interface BuildCampaignAdventureAuditInput {
  readonly campaignId: string;
  /**
   * Resolves immutable module source by id (same contract as context
   * assembly). When omitted or when a module does not resolve, the audit still
   * reports the binding and mutable progress; only the source summary, derived
   * secret/objective views, and the runtime slice are omitted.
   */
  readonly resolveAdventureModule?: AdventureModuleResolver;
  /**
   * Override the live current location. Defaults to the campaign clock's
   * `current_location_id` so the captured slice matches what the runtime would
   * build this turn.
   */
  readonly currentLocationId?: string;
}

interface ClockLocationRow {
  readonly current_location_id: string | null;
}

/** Read the campaign clock's current location without requiring a character. */
function readClockLocation(db: Db): string | undefined {
  const row = db
    .prepare('SELECT current_location_id FROM clock WHERE id = 1')
    .get() as ClockLocationRow | undefined;
  return row?.current_location_id ?? undefined;
}

function summarizeSource(
  module: AdventureModule,
): AdventureModuleSourceSummary {
  return {
    id: module.id,
    title: module.title,
    summary: module.summary,
    startingSceneId: module.startingSceneId,
    counts: {
      scenes: module.scenes.length,
      locations: module.locations.length,
      npcs: module.npcs.length,
      objectives: module.objectives.length,
      encounters: module.encounters.length,
      secrets: module.secrets.length,
      treasure: module.treasure.length,
      clocks: module.clocksOrThreats.length,
    },
  };
}

function auditSecrets(
  module: AdventureModule,
  progress: AdventureRunProgress,
): AdventureSecretAuditView {
  const moduleSecretIds = new Set(module.secrets.map((s) => s.id));
  const revealedSet = new Set(progress.revealedSecrets);
  const revealed = module.secrets
    .filter((s) => revealedSet.has(s.id))
    .map((s) => s.id);
  const unrevealed = module.secrets
    .filter((s) => !revealedSet.has(s.id))
    .map((s) => s.id);
  const unknownRevealed = progress.revealedSecrets.filter(
    (id) => !moduleSecretIds.has(id),
  );
  return { revealed, unrevealed, unknownRevealed };
}

function auditObjectives(
  module: AdventureModule,
  progress: AdventureRunProgress,
): AdventureObjectiveAuditView {
  const completedSet = new Set(progress.completedObjectives);
  const failedSet = new Set(progress.failedObjectives);
  const remaining = module.objectives
    .filter((o) => !completedSet.has(o.id) && !failedSet.has(o.id))
    .map((o) => o.id);
  return {
    completed: progress.completedObjectives,
    failed: progress.failedObjectives,
    remaining,
  };
}

function auditRun(
  run: AdventureRun,
  module: AdventureModule | undefined,
  currentLocationId: string | undefined,
): AdventureRunAudit {
  const base = {
    runId: run.runId,
    moduleId: run.moduleId,
    status: run.status,
    startedAtSessionId: run.startedAtSessionId,
    completedAtSessionId: run.completedAtSessionId,
    notes: run.notes,
    progress: run.progress,
  };
  if (module === undefined) {
    return {
      ...base,
      moduleResolved: false,
      source: undefined,
      secrets: undefined,
      objectives: undefined,
      contextSlice: undefined,
    };
  }
  // The runtime only feeds a bounded slice for ACTIVE runs (eshyra-eh54.5), so
  // the audit captures one only for active runs. Source/progress views are still
  // built for completed/abandoned runs; the slice is simply not applicable.
  return {
    ...base,
    moduleResolved: true,
    source: summarizeSource(module),
    secrets: auditSecrets(module, run.progress),
    objectives: auditObjectives(module, run.progress),
    contextSlice:
      run.status === 'active'
        ? buildAdventureContextSlice(module, run, { currentLocationId })
        : undefined,
  };
}

/**
 * Build the structured adventure audit for a campaign: every campaign-owned
 * adventure run / module binding, its mutable progress, derived secret/objective
 * views, and the bounded runtime slice that would be supplied this turn. Pure
 * read; never mutates the campaign or the module.
 */
export function buildCampaignAdventureAudit(
  db: Db,
  input: BuildCampaignAdventureAuditInput,
): CampaignAdventureAudit {
  const runs = listAdventureRuns(db, { campaignId: input.campaignId });
  const currentLocationId = input.currentLocationId ?? readClockLocation(db);
  const resolve = input.resolveAdventureModule;
  return {
    campaignId: input.campaignId,
    currentLocationId,
    runs: runs.map((run) =>
      auditRun(
        run,
        resolve === undefined ? undefined : resolve(run.moduleId),
        currentLocationId,
      ),
    ),
  };
}

function renderIds(ids: readonly string[]): string {
  return ids.length > 0 ? ids.join(', ') : '(none)';
}

function renderRunAudit(run: AdventureRunAudit): string {
  const lines: string[] = [];
  // Section 2: binding.
  lines.push(`### Adventure run: ${run.runId} -> module ${run.moduleId}`);
  const markers: string[] = [`status: ${run.status}`];
  if (run.startedAtSessionId !== undefined) {
    markers.push(`started@ ${run.startedAtSessionId}`);
  }
  if (run.completedAtSessionId !== undefined) {
    markers.push(`completed@ ${run.completedAtSessionId}`);
  }
  lines.push(`Binding: ${markers.join(', ')}`);
  if (run.notes.length > 0) {
    lines.push(`Notes: ${run.notes}`);
  }

  // Section 1: immutable source.
  if (run.source === undefined) {
    lines.push(
      'Source module: UNRESOLVED — authored content not available to this audit.',
    );
  } else {
    const c = run.source.counts;
    lines.push(
      `Source module: "${run.source.title}" — start scene ${run.source.startingSceneId}; ` +
        `${c.scenes} scenes, ${c.locations} locations, ${c.npcs} NPCs, ` +
        `${c.objectives} objectives, ${c.encounters} encounters, ` +
        `${c.secrets} secrets, ${c.treasure} treasure, ${c.clocks} clocks.`,
    );
  }

  // Section 3: mutable progress + derived views.
  const p = run.progress;
  lines.push('Progress (campaign-owned, mutable):');
  lines.push(`- visited locations: ${renderIds(p.visitedLocations)}`);
  lines.push(
    `- completed/bypassed scenes: ${renderIds(p.completedOrBypassedScenes)}`,
  );
  if (run.objectives === undefined) {
    lines.push(`- completed objectives: ${renderIds(p.completedObjectives)}`);
    lines.push(`- failed objectives: ${renderIds(p.failedObjectives)}`);
  } else {
    lines.push(
      `- objectives completed: ${renderIds(run.objectives.completed)}`,
    );
    lines.push(`- objectives failed: ${renderIds(run.objectives.failed)}`);
    lines.push(
      `- objectives remaining: ${renderIds(run.objectives.remaining)}`,
    );
  }
  if (run.secrets === undefined) {
    lines.push(`- revealed secrets: ${renderIds(p.revealedSecrets)}`);
  } else {
    lines.push(`- secrets revealed: ${renderIds(run.secrets.revealed)}`);
    lines.push(`- secrets unrevealed: ${renderIds(run.secrets.unrevealed)}`);
    if (run.secrets.unknownRevealed.length > 0) {
      lines.push(
        `- revealed ids not in module (drift): ${renderIds(run.secrets.unknownRevealed)}`,
      );
    }
  }
  lines.push(
    `- encounter outcomes: ${
      p.encounterOutcomes.length > 0
        ? p.encounterOutcomes
            .map((o) => `${o.encounterId}=${o.outcome}`)
            .join(', ')
        : '(none)'
    }`,
  );
  lines.push(`- claimed treasure: ${renderIds(p.claimedTreasure)}`);
  lines.push(
    `- active clocks: ${
      p.activeClocks.length > 0
        ? p.activeClocks.map((c) => `${c.clockId}=${c.filled}`).join(', ')
        : '(none)'
    }`,
  );
  lines.push(
    `- deviations: ${
      p.deviations.length > 0
        ? p.deviations.map((d) => `${d.id} (${d.description})`).join('; ')
        : '(none)'
    }`,
  );

  // Section 4: bounded runtime slice. Only active runs are fed to the DM, so an
  // inactive run never has a slice even when its module resolves — distinguish
  // that from an unresolved module so the audit is not misleading.
  if (run.contextSlice !== undefined) {
    lines.push('Runtime context slice (bounded, as fed to the DM):');
    lines.push(renderAdventureContextSlice(run.contextSlice));
  } else if (!run.moduleResolved) {
    lines.push(
      'Runtime context slice: UNAVAILABLE — module source did not resolve.',
    );
  } else {
    lines.push(
      `Runtime context slice: NOT BUILT — run is ${run.status}; only active runs are fed to the DM.`,
    );
  }
  return lines.join('\n');
}

/**
 * Render the campaign adventure audit into an inspectable report. The four
 * layers are clearly separated per run; the runtime slice reuses the same
 * renderer the DM context uses, so what you read is what the model receives.
 */
export function formatCampaignAdventureAudit(
  audit: CampaignAdventureAudit,
): string {
  const header = [
    `# Adventure audit — campaign ${audit.campaignId}`,
    `Current location (clock): ${audit.currentLocationId ?? '(unset)'}`,
  ];
  if (audit.runs.length === 0) {
    header.push('');
    header.push(
      'No adventure runs / module bindings recorded for this campaign.',
    );
    return header.join('\n');
  }
  const active = audit.runs.filter((r) => r.status === 'active').length;
  header.push(`Adventure runs: ${audit.runs.length} (${active} active).`);
  const body = audit.runs.map(renderRunAudit).join('\n\n');
  return `${header.join('\n')}\n\n${body}`;
}
