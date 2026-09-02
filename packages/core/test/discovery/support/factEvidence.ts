import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import type { DiscoveryTrace, PacketCandidate } from '../../../src/internal.js';
import type { EvidenceNote } from '../../diagnostics/index.js';

/**
 * Assertions the fixtures' `evidenceNotes` (field 14) name.
 *
 * Design amendment 11.1 moved non-retention material out of field 9, so M9 is
 * now exactly the packet-retention facts and carries no classification logic.
 * What remains here are the assertions a `packet-semantic` or `substrate-fact`
 * note names; the probe runner executes them, so a note cannot be satisfied by
 * being labelled. `external-guard` notes name a path AND a symbol, and both
 * are checked — a guard proven only by a file existing proves nothing.
 */
export interface AssertionContext {
  readonly trace: DiscoveryTrace;
  readonly candidate: (key: string) => PacketCandidate | undefined;
  readonly playerInput: string;
  readonly moduleJson: Record<string, unknown> | undefined;
}

function routeClasses(candidate: PacketCandidate | undefined): string[] {
  return (candidate?.routes ?? []).map((route) => route.routeClass);
}

function proseOf(candidate: PacketCandidate | undefined): string {
  return JSON.stringify(candidate?.sourceProse ?? {});
}

/** Typed assertions naming each packet-semantic and substrate-fact claim. */
export const ASSERTIONS: Readonly<
  Record<string, (context: AssertionContext) => void>
> = {
  'cover-reached-without-its-name': ({ candidate, playerInput }) => {
    expect(playerInput.toLowerCase()).not.toContain('cover');
    expect(routeClasses(candidate('rule:cover'))).toContain('situation-cue');
    expect(routeClasses(candidate('rule:cover'))).not.toContain(
      'explicit-name-or-alias',
    );
  },
  'dragon-success-branch-disclosed': ({ candidate }) => {
    const note = candidate(
      'creature:adult-black-dragon',
    )?.projectionLimits.find(
      (item) =>
        item.kind === 'success-branch' &&
        item.evidence.path === '/data/actions/5/mechanics/saves',
    );
    expect(note).toBeDefined();
    expect(note?.preservedProse).toContain(
      'or half as much damage on a successful one',
    );
  },
  'fireball-area-disclosed': ({ candidate }) => {
    const note = candidate('spell:fireball')?.projectionLimits.find(
      (item) => item.kind === 'area',
    );
    expect(note).toBeDefined();
    expect(note?.preservedProse).toContain('20-foot-radius sphere');
  },
  'concentration-reached-by-cue-not-edge': ({ candidate, trace }) => {
    expect(routeClasses(candidate('rule:concentration'))).toContain(
      'situation-cue',
    );
    expect(routeClasses(candidate('rule:concentration'))).not.toContain(
      'typed-relationship',
    );
    for (const traversal of [
      ...trace.expansion.traversals,
      ...trace.ruleExpansion.traversals,
    ])
      expect(
        traversal.sourceRecordKey === 'condition:incapacitated' &&
          traversal.targetRecordKey === 'rule:concentration',
      ).toBe(false);
  },
  'cube-blocked-by-readiness': ({ candidate }) => {
    const item = candidate('magic-item:cube-of-force');
    expect(item?.capability?.status).toBe('blocked');
    const note = item?.projectionLimits.find(
      (limit) => limit.kind === 'execution-readiness',
    );
    expect(JSON.stringify(note?.evidence ?? {})).toContain('press-face-1');
  },
  'ammunition-c2-engine-pending-disclosed': ({ candidate }) => {
    const note = candidate(
      'magic-item:ammunition-1-2-or-3',
    )?.projectionLimits.find((item) => item.kind === 'execution-readiness');
    expect(note).toBeDefined();
    const evidence = JSON.stringify(note?.evidence ?? {});
    expect(evidence).toContain('c2-static-ammunition-rarity-attack-damage');
    expect(evidence).toContain('F8');
  },
  'encounter-identity-retained': ({ candidate }) => {
    const encounter = candidate(
      'eshyra:hollow-beneath-emberfall#encounter:enc-mouth-ambush',
    );
    expect(encounter).toBeDefined();
    const prose = proseOf(encounter);
    expect(prose).toContain('Ambush at the Mouth');
    expect(prose).toContain('loc-watchtower-mouth');
    expect(prose).toContain('creature:goblin');
  },
  'module-location-and-no-stat-block-ref': ({ moduleJson }) => {
    const locations = (moduleJson?.locations ?? []) as {
      id: string;
    }[];
    expect(locations.map((item) => item.id)).toContain('loc-watchtower-mouth');
    expect(JSON.stringify(moduleJson ?? {})).not.toContain('stat-block:');
  },
  'module-rules-refs-are-exactly-two': ({ moduleJson }) => {
    const refs = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (typeof value !== 'object' || value === null) return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'rulesRef' && typeof child === 'string') refs.add(child);
        else walk(child);
      }
    };
    walk(moduleJson);
    expect([...refs].sort()).toEqual([
      'creature:goblin',
      'magic-item:potion-of-healing',
    ]);
  },
  'house-rule-governs-beside-source': ({ candidate }) => {
    const fireball = candidate('spell:fireball');
    const rule = fireball?.campaignRules[0];
    // The rule is present with its identity, scope and provenance...
    expect(rule).toBeDefined();
    expect(rule?.ruleIdentity.length ?? 0).toBeGreaterThan(0);
    expect(rule?.scope.length ?? 0).toBeGreaterThan(0);
    expect(rule?.provenance.length ?? 0).toBeGreaterThan(0);
    // ...beside an SRD source that it neither replaced nor hid.
    const prose = proseOf(fireball);
    expect(prose).toContain('A target takes 8d6 fire damage on a failed save');
    expect(prose).toContain('"V","S","M"');
    expect(fireball?.provenance.sourceRef).toContain('wizards.com');
  },
  'house-rule-is-not-an-ambiguity-choice': ({ candidate }) => {
    const fireball = candidate('spell:fireball');
    expect(fireball?.campaignRules[0].ruleKind).toBe('house-rule');
    expect(fireball?.campaignRulings).toEqual([]);
    expect(fireball?.ambiguities).toEqual([]);
  },
  'override-chain-preserved': ({ trace }) => {
    const entry = trace.stack.recordsByKey.get('magic-item:ring-of-protection');
    expect(entry?.overrideChain.length).toBeGreaterThan(0);
    expect(entry?.pack.meta.packId).toBe('rules:test-cursed-attunement-addon');
    expect(entry?.overrideChain[0].pack.meta.packId).toBe(
      'rules:dnd5e-srd-5.1',
    );
  },
  'strict-stack-identity-agrees': ({ trace }) => {
    expect(trace.stack.base.meta.systemId).toBe('dnd5e-srd');
    expect(trace.stack.base.meta.version).toBe('5.1');
    expect(trace.stack.addons.map((pack) => pack.meta.packId)).toEqual([
      'rules:test-cursed-attunement-addon',
    ]);
  },
  'no-false-provenance-laundered': ({ trace }) => {
    expect(
      trace.packet.packet.candidates.map((item) => item.identity.key),
    ).not.toContain('table:starting-wealth-by-class');
    expect(trace.stack.recordsByKey.has('table:starting-wealth-by-class')).toBe(
      false,
    );
  },
};

export function assertEvidenceNote(
  note: EvidenceNote,
  context: AssertionContext,
): void {
  if (note.kind === 'packet-semantic' || note.kind === 'substrate-fact') {
    const assertion = ASSERTIONS[note.assertionId as string];
    expect(
      assertion,
      `evidence note names missing assertion ${note.assertionId}`,
    ).toBeDefined();
    assertion(context);
    return;
  }
  if (note.kind !== 'external-guard') return;
  const path = join(process.cwd(), note.guardPath as string);
  expect(existsSync(path), `named guard ${note.guardPath} does not exist`).toBe(
    true,
  );
  // The symbol is what ties the guard to the claim; existence alone would let
  // any file stand in for any requirement.
  expect(
    readFileSync(path, 'utf8').includes(note.guardSymbol as string),
    `guard ${note.guardPath} does not contain ${note.guardSymbol}`,
  ).toBe(true);
}
