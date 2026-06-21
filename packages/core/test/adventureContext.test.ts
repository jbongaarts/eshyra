import { describe, expect, it } from 'vitest';
import {
  buildAdventureContextSlice,
  renderAdventureContextSlice,
} from '../src/internal.js';
import {
  makeTestAdventureModule,
  makeTestAdventureRun,
} from './support/adventureModuleFixture.js';

describe('buildAdventureContextSlice', () => {
  it('seats a fresh run at the starting scene with the opening situation', () => {
    const slice = buildAdventureContextSlice(
      makeTestAdventureModule(),
      makeTestAdventureRun(),
    );

    expect(slice.moduleId).toBe('test-delve');
    expect(slice.runStatus).toBe('active');
    // No progress -> starting situation framing is included.
    expect(slice.startingSituation).toContain('strange lights');
    expect(slice.currentScene?.id).toBe('scene-arrival');
    // Falls back to the scene's first declared location when no live location.
    expect(slice.currentLocation?.id).toBe('loc-inn');
    // Exit to the cellar surfaces as a nearby location.
    expect(slice.nearbyLocations.map((l) => l.id)).toEqual(['loc-cellar']);
    expect(slice.relevantNpcs.map((n) => n.id)).toEqual(['npc-innkeeper']);
    // Scene's only objective is active.
    expect(slice.activeObjectives.map((o) => o.id)).toEqual([
      'obj-investigate',
    ]);
  });

  it('seats at the live current location and overrides the scene guess', () => {
    const slice = buildAdventureContextSlice(
      makeTestAdventureModule(),
      makeTestAdventureRun(),
      { currentLocationId: 'loc-cellar' },
    );

    expect(slice.currentLocation?.id).toBe('loc-cellar');
    expect(slice.currentScene?.id).toBe('scene-cellar');
    // Cellar scene exposes the giant-rat encounter and the shrine secret.
    expect(slice.pendingEncounters.map((e) => e.id)).toEqual(['enc-rats']);
    expect(slice.unrevealedSecrets.map((s) => s.id)).toEqual(['secret-shrine']);
    // Both scene objectives are active (none resolved yet).
    expect(slice.activeObjectives.map((o) => o.id)).toEqual([
      'obj-investigate',
      'obj-recover',
    ]);
  });

  it('drops the starting situation once any progress exists', () => {
    const slice = buildAdventureContextSlice(
      makeTestAdventureModule(),
      makeTestAdventureRun({ visitedLocations: ['loc-inn'] }),
    );
    expect(slice.startingSituation).toBeUndefined();
  });

  it('applies campaign truth: resolved encounters, revealed secrets, met objectives drop out', () => {
    const run = makeTestAdventureRun({
      completedOrBypassedScenes: ['scene-arrival'],
      visitedLocations: ['loc-inn', 'loc-cellar'],
      completedObjectives: ['obj-investigate'],
      revealedSecrets: ['secret-shrine'],
      encounterOutcomes: [{ encounterId: 'enc-rats', outcome: 'defeated' }],
    });
    const slice = buildAdventureContextSlice(makeTestAdventureModule(), run, {
      currentLocationId: 'loc-cellar',
    });

    // Resolved encounter is no longer pending.
    expect(slice.pendingEncounters).toEqual([]);
    // Revealed secret no longer surfaces as unrevealed.
    expect(slice.unrevealedSecrets).toEqual([]);
    // Completed objective drops; the optional one remains active.
    expect(slice.activeObjectives.map((o) => o.id)).toEqual(['obj-recover']);
    // Visited destinations are flagged.
    expect(slice.currentLocation?.visited).toBe(true);
    expect(slice.currentLocation?.exits[0]?.toLocationVisited).toBe(true);
    // Resolved/revealed/completed elements are summarized.
    expect(slice.completed.objectives).toEqual(['obj-investigate']);
    expect(slice.completed.revealedSecrets).toEqual(['secret-shrine']);
    expect(slice.completed.resolvedEncounters).toEqual([
      { encounterId: 'enc-rats', outcome: 'defeated' },
    ]);
  });

  it('applies the campaign clock fill onto the authored clock shape', () => {
    const slice = buildAdventureContextSlice(
      makeTestAdventureModule(),
      makeTestAdventureRun({
        activeClocks: [{ clockId: 'clock-corruption', filled: 2 }],
      }),
    );
    const clock = slice.activeClocks.find((c) => c.id === 'clock-corruption');
    expect(clock).toBeDefined();
    expect(clock?.filled).toBe(2);
    expect(clock?.segments).toBe(4);
  });

  it('surfaces campaign deviations as overriding facts', () => {
    const slice = buildAdventureContextSlice(
      makeTestAdventureModule(),
      makeTestAdventureRun({
        deviations: [
          {
            id: 'dev-1',
            description: 'The innkeeper was killed in session 2.',
          },
        ],
      }),
    );
    expect(slice.deviations).toEqual([
      { id: 'dev-1', description: 'The innkeeper was killed in session 2.' },
    ]);
  });

  it('falls back to the next unfinished scene when the start is done and no live location', () => {
    const slice = buildAdventureContextSlice(
      makeTestAdventureModule(),
      makeTestAdventureRun({ completedOrBypassedScenes: ['scene-arrival'] }),
    );
    expect(slice.currentScene?.id).toBe('scene-cellar');
  });

  it('does not fall back to another location’s unfinished scene when the live location’s scene is done', () => {
    // Party is at the inn; the inn's only scene is completed, but the cellar
    // scene is still unfinished. Campaign truth (the live location) must win:
    // no current scene, and certainly not the cellar's.
    const slice = buildAdventureContextSlice(
      makeTestAdventureModule(),
      makeTestAdventureRun({ completedOrBypassedScenes: ['scene-arrival'] }),
      { currentLocationId: 'loc-inn' },
    );
    expect(slice.currentScene).toBeUndefined();
    expect(slice.currentLocation?.id).toBe('loc-inn');
    // The cellar's encounter / secret must NOT leak in via a wrong scene guess.
    expect(slice.pendingEncounters).toEqual([]);
    expect(slice.unrevealedSecrets).toEqual([]);
  });

  it('does not seat the module at the starting scene when the live location is outside its keyed space', () => {
    const slice = buildAdventureContextSlice(
      makeTestAdventureModule(),
      makeTestAdventureRun(),
      { currentLocationId: 'loc-not-in-module' },
    );
    expect(slice.currentScene).toBeUndefined();
    expect(slice.currentLocation).toBeUndefined();
    expect(slice.relevantNpcs).toEqual([]);
    expect(slice.pendingEncounters).toEqual([]);
    expect(slice.unrevealedSecrets).toEqual([]);
    // Global pressures (clocks) and deviations are still available.
    expect(slice.activeClocks.map((c) => c.id)).toEqual(['clock-corruption']);
  });

  it('renders a compact DM-only section without empty groups', () => {
    const text = renderAdventureContextSlice(
      buildAdventureContextSlice(
        makeTestAdventureModule(),
        makeTestAdventureRun(),
        { currentLocationId: 'loc-cellar' },
      ),
    );
    expect(text).toContain('A Small Test Delve');
    expect(text).toContain('Current scene: Into the Cellar');
    expect(text).toContain('Pending encounters:');
    expect(text).toContain('Unrevealed secrets (DM-only):');
    expect(text).toContain('Clocks/threats:');
    // A fresh run has no deviations / completed roll-up lines.
    expect(text).not.toContain('Campaign deviations');
    expect(text).not.toContain('Already resolved');
  });
});
