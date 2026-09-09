import { describe, expect, it } from 'vitest';
import type { BlockerRepairObservation } from '../../src/internal.js';
import {
  createDefaultToolRegistry,
  getBundledDnd5eSrdPack,
  observeBlockerRepairs,
  resolveRulesStack,
  resolveStrictCampaignRulesStack,
  writeCampaignRulesBinding,
} from '../../src/internal.js';
import {
  CURSED_ATTUNEMENT_OVERRIDDEN_ITEM_REF,
  installCursedAttunementAddon,
} from '../support/cursedAttunementAddon.js';
import { freshDbWithSession } from '../support/db.js';
import { SYNTHETIC_STARTING_WEALTH_PACK } from '../support/startingWealthSupplement.js';

/**
 * The blocker probes are the mechanism that keeps a pre-repair shadow capture
 * from being read as a baseline (design section 9.6), so their REJECTIONS are
 * what has to be proved. An earlier revision of B3 read the strict rules stack
 * — the side of B3 that was never broken — so the historical base-only
 * deterministic consumers would have satisfied it unchanged and every capture
 * would have carried a `repaired` marker for a defect it still contained.
 *
 * Each case below therefore drives a probe to `unrepaired` or
 * `not-discriminable` with a real condition, not a stub.
 */

const AT = '2026-05-20T09:00:00.000Z';

function statusOf(
  observations: readonly BlockerRepairObservation[],
  blockerId: BlockerRepairObservation['blockerId'],
): BlockerRepairObservation {
  const found = observations.find((item) => item.blockerId === blockerId);
  if (found === undefined) throw new Error(`no observation for ${blockerId}`);
  return found;
}

function observe(
  db: ReturnType<typeof freshDbWithSession>,
  overrides: Partial<Parameters<typeof observeBlockerRepairs>[0]> = {},
): readonly BlockerRepairObservation[] {
  return observeBlockerRepairs({
    db,
    tools: createDefaultToolRegistry(),
    adventureResolverSupplied: false,
    ...overrides,
    stack:
      overrides.stack ??
      resolveStrictCampaignRulesStack(db, overrides.resolveRulesPack),
  });
}

describe('capture-time blocker repair probes', () => {
  describe('B1 — lookup_rules must accept stat-block', () => {
    it('reports unrepaired against the historical enum that omitted it', () => {
      const db = freshDbWithSession();
      try {
        const pre = statusOf(
          observe(db, {
            tools: {
              // The pre-B1 schema verbatim in the shape that mattered: every
              // other kind accepted, `stat-block` absent from the enum.
              get: () => ({
                inputSchema: {
                  type: 'object' as const,
                  properties: {
                    kind: { type: 'string' as const, enum: ['spell', 'rule'] },
                    ref: { type: 'string' as const },
                  },
                  required: ['kind'],
                },
              }),
            },
          }),
          'B1',
        );
        expect(pre.status).toBe('unrepaired');
        expect(statusOf(observe(db), 'B1').status).toBe('repaired');
      } finally {
        db.close();
      }
    });

    it('refuses to conclude anything when the control kind is also rejected', () => {
      const db = freshDbWithSession();
      try {
        const observation = statusOf(
          observe(db, {
            tools: {
              get: () => ({
                inputSchema: {
                  type: 'object' as const,
                  properties: {
                    kind: { type: 'string' as const, enum: ['creature'] },
                  },
                  required: ['kind'],
                },
              }),
            },
          }),
          'B1',
        );
        expect(observation.status).toBe('not-discriminable');
        expect(observation.evidence).toContain('control kind');
      } finally {
        db.close();
      }
    });

    it('refuses to conclude anything when the turn has no lookup_rules tool', () => {
      const db = freshDbWithSession();
      try {
        expect(
          statusOf(observe(db, { tools: { get: () => undefined } }), 'B1')
            .status,
        ).toBe('not-discriminable');
      } finally {
        db.close();
      }
    });
  });

  describe('B2 — the CLI adventure-resolver handoff', () => {
    it('never claims repair from caller injection, and records the turn fact', () => {
      const db = freshDbWithSession();
      try {
        const without = statusOf(observe(db), 'B2');
        const with_ = statusOf(
          observe(db, { adventureResolverSupplied: true }),
          'B2',
        );
        // The defect was the CLI handoff; a direct caller could always supply
        // a resolver, before and after the repair. Neither state is evidence.
        expect(without.status).toBe('not-discriminable');
        expect(with_.status).toBe('not-discriminable');
        // ... and the probe is not simply constant: it still records which.
        expect(without.evidence).toContain('was not supplied');
        expect(with_.evidence).toContain('was supplied');
      } finally {
        db.close();
      }
    });
  });

  describe('B3 — deterministic consumers must resolve the exact stack', () => {
    it('reports unrepaired when the deterministic lookup returns the base record', () => {
      const db = freshDbWithSession();
      const base = getBundledDnd5eSrdPack();
      try {
        const resolver = installCursedAttunementAddon(db, AT);
        // The stack the capture resolved carries the add-on override...
        const stack = resolveStrictCampaignRulesStack(db, resolver);
        // ... while the deterministic consumer path reads a base-only binding,
        // which is exactly what the pre-B3 `lookupCampaignRecord` did when it
        // selected a base by packId and ignored every add-on.
        writeCampaignRulesBinding(db, {
          base: {
            systemId: base.meta.systemId,
            packId: base.meta.packId,
            version: base.meta.version,
          },
          addons: [],
          resolvedAt: AT,
        });
        const observation = statusOf(
          observe(db, { stack, resolveRulesPack: resolver }),
          'B3',
        );
        expect(observation.status).toBe('unrepaired');
        expect(observation.evidence).toContain(
          CURSED_ATTUNEMENT_OVERRIDDEN_ITEM_REF,
        );
        expect(observation.evidence).toContain('BASE record');
      } finally {
        db.close();
      }
    });

    it('reports repaired when the deterministic lookup returns the override', () => {
      const db = freshDbWithSession();
      try {
        const resolver = installCursedAttunementAddon(db, AT);
        const observation = statusOf(
          observe(db, {
            stack: resolveStrictCampaignRulesStack(db, resolver),
            resolveRulesPack: resolver,
          }),
          'B3',
        );
        expect(observation.status).toBe('repaired');
        expect(observation.evidence).toContain(
          CURSED_ATTUNEMENT_OVERRIDDEN_ITEM_REF,
        );
      } finally {
        db.close();
      }
    });

    it('refuses to conclude anything without an add-on override to compare', () => {
      const db = freshDbWithSession();
      try {
        const observation = statusOf(observe(db), 'B3');
        expect(observation.status).toBe('not-discriminable');
        expect(observation.evidence).toContain('0 add-on(s) bound');
        // The gate it names is the corrected one (design 9.6 Erratum 1).
        expect(observation.gates.join(' ')).toContain('M12');
      } finally {
        db.close();
      }
    });
  });

  describe('B4 — starting wealth must be gone from SRD authority', () => {
    it('reports unrepaired when the resolved stack still supplies the table', () => {
      const db = freshDbWithSession();
      try {
        const observation = statusOf(
          observe(db, {
            stack: resolveRulesStack({
              base: getBundledDnd5eSrdPack(),
              addons: [SYNTHETIC_STARTING_WEALTH_PACK],
            }),
          }),
          'B4',
        );
        expect(observation.status).toBe('unrepaired');
        expect(observation.evidence).toContain(
          'rules:test-starting-wealth-supplement',
        );
      } finally {
        db.close();
      }
    });

    it('reports repaired only when both the SRD pack and the stack are clean', () => {
      const db = freshDbWithSession();
      try {
        const observation = statusOf(observe(db), 'B4');
        expect(observation.status).toBe('repaired');
        expect(observation.evidence).toContain('bundled SRD pack');
      } finally {
        db.close();
      }
    });
  });

  describe('B5 — an unrecognized readiness scope must fail closed', () => {
    it('reports repaired against the live readiness contract', () => {
      const db = freshDbWithSession();
      try {
        const observation = statusOf(observe(db), 'B5');
        expect(observation.status).toBe('repaired');
        // The probe's discriminator is its own control pair: the same record
        // with a `parent` scope must NOT throw, or the throw proves nothing.
        expect(observation.evidence).toContain('while a parent scope does not');
      } finally {
        db.close();
      }
    });
  });
});
