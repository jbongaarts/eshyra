import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import type {
  DiscoveryTrace,
  FactClassification,
  PacketCandidate,
} from '../../../src/internal.js';

/**
 * Evidence surface for every statement-only fixture field-9 requirement.
 *
 * M9 measures requirements carrying `exactSubstring` or `typedPath` directly.
 * A statement-only requirement states something about the packet, the loaded
 * substrate, superseded state, or an explicit non-claim; none of those is a
 * retained source string, so none is measurable as one. Previously they were
 * swept into a `proseOnlyNotCheckable` bucket that nothing asserted, which let
 * a declared requirement stay completely unproven while M9 reported green.
 *
 * Every entry below is keyed `P<probe>[<index>]` against
 * `DiagnosticFixture.requiredRetainedFacts`. A statement-only fact with no
 * entry makes M9 indeterminate and fails its probe, so this table cannot
 * silently fall behind the corpus. `packet-semantic` and `substrate-fact`
 * entries must name an assertion in ASSERTIONS below, and that assertion runs
 * for real during the probe.
 */
export const FACT_EVIDENCE: Readonly<Record<string, FactClassification>> = {
  'P1[2]': {
    kind: 'packet-semantic',
    assertionId: 'cover-reached-without-its-name',
    why: 'The claim is that the cue, not a name mention, proposed the record.',
  },
  'P3[3]': {
    kind: 'packet-semantic',
    assertionId: 'dragon-success-branch-disclosed',
    why: 'The claim is that the packet must not present 12d8 as unconditional.',
  },
  'P4[6]': {
    kind: 'packet-semantic',
    assertionId: 'fireball-area-disclosed',
    why: 'The claim is that the packet discloses the absent typed area.',
  },
  'P5[3]': {
    kind: 'packet-semantic',
    assertionId: 'concentration-reached-by-cue-not-edge',
    why: 'The claim is about which route class reached the record.',
  },
  'P6[4]': {
    kind: 'historical-annotation',
    why: 'Records that an earlier framing named a key the pack does not use.',
  },
  'P7[3]': {
    kind: 'packet-semantic',
    assertionId: 'cube-blocked-by-readiness',
    guardPath: 'packages/core/test/itemState.test.ts',
    why: 'The packet-visible claim is the blocked preflight; the runtime call ordering inside useItem is guarded by the item-state tests.',
  },
  'P7[4]': {
    kind: 'non-claim',
    why: 'Explicitly disclaims a ruling persistence model; asserts no output.',
  },
  'P8[4]': {
    kind: 'packet-semantic',
    assertionId: 'ammunition-c2-engine-pending-disclosed',
    why: 'The claim is that the unexecuted sibling clause is disclosed.',
  },
  'P8[5]': {
    kind: 'non-claim',
    why: 'Explicitly disclaims that green-with-no-cost operations are capability evidence.',
  },
  'P9[2]': {
    kind: 'packet-semantic',
    assertionId: 'encounter-identity-retained',
    why: 'The claim is about the authored encounter content reaching the packet.',
  },
  'P9[3]': {
    kind: 'substrate-fact',
    assertionId: 'module-location-and-no-stat-block-ref',
    why: 'A checkable claim about the loaded module, not about the packet.',
  },
  'P9[4]': {
    kind: 'substrate-fact',
    assertionId: 'module-rules-refs-are-exactly-two',
    why: 'A checkable claim about the loaded module, not about the packet.',
  },
  'P9[5]': {
    kind: 'historical-annotation',
    why: 'Records that blocker B1 is discharged; corrects stale design state.',
  },
  'P9[6]': {
    kind: 'historical-annotation',
    why: 'Records that blocker B2 is closed; corrects stale design state.',
  },
  'P10[2]': {
    kind: 'packet-semantic',
    assertionId: 'house-rule-governs-beside-source',
    why: 'The load-bearing precedence requirement: the rule governs beside, and does not replace or hide, the SRD source.',
  },
  'P10[3]': {
    kind: 'packet-semantic',
    assertionId: 'house-rule-is-not-an-ambiguity-choice',
    why: 'The claim distinguishes a house rule from an ambiguity ruling.',
  },
  'P11[0]': {
    kind: 'substrate-fact',
    assertionId: 'override-chain-preserved',
    why: 'A checkable claim about the resolved stack entry.',
  },
  'P11[1]': {
    kind: 'substrate-fact',
    assertionId: 'strict-stack-identity-agrees',
    why: 'A checkable claim about the resolved stack identity.',
  },
  'P11[2]': {
    kind: 'historical-annotation',
    why: 'Records the pre-B3 divergence explicitly as history, not current state.',
  },
  'P11[3]': {
    kind: 'external-guard',
    guardPath: 'packages/core/test/campaignRulesStackParity.test.ts',
    why: 'The deterministic half of the parity claim is proven by that test.',
  },
  'P11[4]': {
    kind: 'external-guard',
    guardPath: 'packages/core/test/campaignRulesStackParity.test.ts',
    why: 'The fixture names that test as the owning guard rather than duplicating it.',
  },
  'P12[0]': {
    kind: 'external-guard',
    guardPath: 'packages/core/src/character/srdStartingWealth.ts',
    why: 'The character-creation reporting path is owned outside discovery.',
  },
  'P12[1]': {
    kind: 'historical-annotation',
    why: 'Historical false-authority evidence about a removed record.',
  },
  'P12[2]': {
    kind: 'historical-annotation',
    why: 'Historical false-authority evidence, deliberately not bound to the live pack.',
  },
  'P12[3]': {
    kind: 'external-guard',
    guardPath: 'packages/core/test/srdGeneratedPack.test.ts',
    why: 'The fixture names that test as the standing absence guard.',
  },
  'P12[4]': {
    kind: 'packet-semantic',
    assertionId: 'no-false-provenance-laundered',
    why: 'The claim is that the removed record never reaches the packet.',
  },
};

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

export function assertGuardExists(classification: FactClassification): void {
  if (classification.guardPath === undefined) return;
  expect(
    existsSync(join(process.cwd(), classification.guardPath)),
    `named guard ${classification.guardPath} does not exist`,
  ).toBe(true);
}
