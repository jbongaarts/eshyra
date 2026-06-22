import { describe, expect, it } from 'vitest';
import type { RulesRecord, RulesRecordKind } from '../src/internal.js';
import {
  assertShippableRulesPack,
  evaluateRulesPackPolicy,
  getBundledDnd5eSrdPack,
  lookupRulesRecord,
  PATHFINDER2E_REMASTER_RULES_PACK,
  RulesPackError,
  resolveRulesStack,
  validateRulesPack,
} from '../src/internal.js';

// The bundled D&D SRD pack is the importer-generated runtime pack (ADR 0013),
// loaded from the packaged data dir rather than an in-code constant.
const DND5E_SRD_RULES_PACK = getBundledDnd5eSrdPack();

describe('rules pack fixtures', () => {
  it('validates the D&D 5e SRD rules pack as a base pack', () => {
    const pack = validateRulesPack(DND5E_SRD_RULES_PACK);
    expect(pack.meta.systemId).toBe('dnd5e-srd');
    expect(pack.meta.packId).toBe('rules:dnd5e-srd-5.1');
    expect(pack.meta.role).toBe('base');
    expect(pack.meta.version).toBe('5.1');
    expect(pack.meta.license.licenseName).toContain('Creative Commons');
    expect(pack.records.length).toBeGreaterThan(0);
  });

  it('validates the Pathfinder 2e Remaster rules pack as a base pack', () => {
    const pack = validateRulesPack(PATHFINDER2E_REMASTER_RULES_PACK);
    expect(pack.meta.systemId).toBe('pathfinder2e-remaster');
    expect(pack.meta.role).toBe('base');
    expect(pack.meta.license.licenseName).toContain('ORC');
    expect(pack.records.length).toBeGreaterThan(0);
  });

  it('uses distinct system identities for D&D and Pathfinder packs', () => {
    expect(DND5E_SRD_RULES_PACK.meta.systemId).not.toBe(
      PATHFINDER2E_REMASTER_RULES_PACK.meta.systemId,
    );
    expect(DND5E_SRD_RULES_PACK.meta.packId).not.toBe(
      PATHFINDER2E_REMASTER_RULES_PACK.meta.packId,
    );
  });

  it('exposes ORC-licensed source metadata on the Pathfinder fixture', () => {
    const license = PATHFINDER2E_REMASTER_RULES_PACK.meta.license;
    expect(license.licenseName).toContain('ORC');
    expect(license.licenseClass).toBe('open');
    expect(license.attributionText.length).toBeGreaterThan(0);
    expect(license.sourceMaterialDescription).toMatch(/ORC|Open RPG Creative/);

    for (const record of PATHFINDER2E_REMASTER_RULES_PACK.records) {
      expect(record.license.licenseName).toContain('ORC');
      expect(record.source.length).toBeGreaterThan(0);
    }
  });

  it('carries source and license metadata on every D&D record', () => {
    for (const record of DND5E_SRD_RULES_PACK.records) {
      expect(record.systemId).toBe('dnd5e-srd');
      expect(record.source.length).toBeGreaterThan(0);
      expect(record.license.licenseName).toContain('Creative Commons');
    }
  });

  it('marks both fixtures shippable under the rules-pack policy', () => {
    expect(
      evaluateRulesPackPolicy(DND5E_SRD_RULES_PACK.meta.license).shippable,
    ).toBe(true);
    expect(
      evaluateRulesPackPolicy(PATHFINDER2E_REMASTER_RULES_PACK.meta.license)
        .shippable,
    ).toBe(true);
    expect(() =>
      assertShippableRulesPack(DND5E_SRD_RULES_PACK.meta.license),
    ).not.toThrow();
    expect(() =>
      assertShippableRulesPack(PATHFINDER2E_REMASTER_RULES_PACK.meta.license),
    ).not.toThrow();
  });

  it('resolves each fixture into a single-base stack and looks up records', () => {
    for (const pack of [
      DND5E_SRD_RULES_PACK,
      PATHFINDER2E_REMASTER_RULES_PACK,
    ]) {
      const stack = resolveRulesStack({ base: pack });
      expect(stack.base.meta.systemId).toBe(pack.meta.systemId);

      const first = pack.records[0] as RulesRecord;
      const byRef = lookupRulesRecord(stack, {
        kind: first.kind,
        ref: first.key,
      });
      expect(byRef.ok).toBe(true);
      if (byRef.ok) {
        expect(byRef.record.key).toBe(first.key);
        expect(byRef.pack.systemId).toBe(pack.meta.systemId);
      }

      // Name lookup resolves to the same record when the name is unique within
      // its kind, or reports ambiguity listing the key when the audited SRD
      // legitimately repeats the name (ADR 0013) — it never silently mis-picks.
      const byName = lookupRulesRecord(stack, {
        kind: first.kind,
        name: first.name,
      });
      if (byName.ok) {
        expect(byName.record.key).toBe(first.key);
      } else {
        expect(byName.code).toBe('ambiguous');
        if (byName.code === 'ambiguous') {
          expect(byName.candidateKeys).toContain(first.key);
        }
      }
    }
  });

  it('rejects a stack that mixes Pathfinder and D&D as both base packs', () => {
    expect(() =>
      resolveRulesStack({
        base: DND5E_SRD_RULES_PACK,
        addons: [PATHFINDER2E_REMASTER_RULES_PACK],
      }),
    ).toThrow(RulesPackError);
  });

  it('covers the broad PF level-1 character record kinds in the Pathfinder fixture', () => {
    const requiredKinds: RulesRecordKind[] = [
      'ancestry',
      'background',
      'class',
      'feat',
      'equipment',
      'spell',
    ];
    const kinds = new Set(
      PATHFINDER2E_REMASTER_RULES_PACK.records.map((r) => r.kind),
    );
    for (const kind of requiredKinds) {
      expect(kinds.has(kind)).toBe(true);
    }
  });
});
